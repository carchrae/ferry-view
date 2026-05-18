import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { onRequest } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { defineSecret } from 'firebase-functions/params'

import { fetchFerryData, checkDataChanged, sanitizeForCompare } from './lib/api.js'
import { buildPast, parseTimeToday } from './lib/matching.js'
import { configureWebPush } from './lib/notify.js'
import { checkLatenessAndNotify } from './lib/lateness.js'

const VAPID_PRIVATE_KEY = defineSecret('VAPID_PRIVATE_KEY')
const VAPID_PUBLIC_KEY = defineSecret('VAPID_PUBLIC_KEY')

initializeApp()

const db = getFirestore()

export const pollFerryStatus = onSchedule(
  {
    schedule: 'every 1 minutes',
    secrets: [VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY],
  },
  async (context) => {
    console.log('Polling ferry status...')

    const data = await fetchFerryData()
    if (!data) {
      console.log('No ferry data fetched')
      return
    }

    const now = new Date()

    // Augment recentActivity with historical departure data from sailingStatus
    // (the API only provides a rolling window of ~10-20 events; sailingStatus
    // captures departures permanently as they happen)
    try {
      const statusSnap = await db.collection('sailingStatus')
        .where('date', '==', data.date)
        .where('actualDepartureTime', '!=', null)
        .get()
      if (!statusSnap.empty) {
        const seen = new Set(data.recentActivity.map(e => `${e.time}_${e.location}`))
        let added = 0
        statusSnap.forEach(doc => {
          const s = doc.data()
          const location = s.direction === 'To Bowen' ? 'Horseshoe Bay' : 'Bowen'
          const key = `${s.actualDepartureTime}_${location}`
          if (!seen.has(key)) {
            data.recentActivity.push({ action: 'Departed', location, time: s.actualDepartureTime })
            seen.add(key)
            added++
          }
        })
        if (added) console.log(`Augmented recentActivity with ${added} historical departure(s) from sailingStatus`)
      }
    } catch (e) {
      console.error('Failed to query sailingStatus for augmentation:', e)
    }

    // Pre-compute matched departure data on schedule entries
    const hsbPast = buildPast(data.hsbSchedule, data.recentActivity, 'Horseshoe Bay', now, 'HSB')
    const bowenPast = buildPast(data.bowenSchedule, data.recentActivity, 'Bowen', now, 'Bowen')
    for (const entry of [...hsbPast, ...bowenPast]) {
      if (!entry._hasDep || !entry.time) continue
      const schedule = entry.label === 'HSB' ? data.hsbSchedule : data.bowenSchedule
      const scheduleEntry = schedule.find(s => s.time === entry.time)
      if (!scheduleEntry) continue
      scheduleEntry.matchedDepartureTime = entry._depDisplay
      scheduleEntry.latenessMinutes = entry._latenessMins
    }

    // Get existing data
    const existingDoc = await db.collection('ferryStatus').doc('current').get()
    const existingData = existingDoc.exists ? existingDoc.data() : null

    // Check if data has changed
    const newDataSanitized = sanitizeForCompare(data)
    const existingDataSanitized = existingData ? sanitizeForCompare(existingData) : null

    if (checkDataChanged(newDataSanitized, existingDataSanitized)) {
      console.log('Data changed, saving...')

      // Enrich schedule entries with the latest capacity info before saving
      if (data.deckSpace) {
        for (const entry of data.deckSpace) {
          const schedule = entry.direction === 'To Bowen' ? data.hsbSchedule : data.bowenSchedule
          const scheduleEntry = schedule.find(s => s.time === entry.time)
          if (!scheduleEntry) continue
          scheduleEntry.lastCapacity = entry.available
          if (entry.available === 'Full' && !scheduleEntry.filledAt) {
            const existingSchedule = entry.direction === 'To Bowen'
              ? existingData?.hsbSchedule : existingData?.bowenSchedule
            const existingEntry = existingSchedule?.find(s => s.time === entry.time)
            scheduleEntry.filledAt = existingEntry?.filledAt || new Date().toISOString()
          }
        }
      }

      await db
        .collection('ferryStatusHistory')
        .add({
          ...data,
          recordedAt: new Date().toISOString(),
      })

      await db.collection('ferryStatus').doc('current').set(data)
      console.log('Saved ferry status to Firestore')

      // Record capacity history for changed deck space entries
      // and track sailing status (lastCapacity, filledAt)
      if (data.deckSpace && existingData?.deckSpace) {
        const capacityWrites = []
        for (const entry of data.deckSpace) {
          const oldEntry = existingData.deckSpace.find(
            e => e.time === entry.time && e.direction === entry.direction
          )
          if (!oldEntry || oldEntry.available !== entry.available) {
            const sailingKey = `${data.date}_${entry.time}_${entry.direction}`
            capacityWrites.push(
              db.collection('capacityHistory').add({
                sailingKey,
                sailingTime: entry.time,
                direction: entry.direction,
                date: data.date,
                capacity: entry.available,
                recordedAt: new Date().toISOString(),
              })
            )

            capacityWrites.push(
              updateSailingStatus(sailingKey, entry.time, entry.direction, data.date, db, {
                lastCapacity: entry.available,
                filledAt: entry.available === 'Full' ? new Date().toISOString() : null,
              })
            )
          }
        }
        if (capacityWrites.length) {
          await Promise.all(capacityWrites)
          console.log(`Recorded ${capacityWrites.length} capacity history entries`)
        }
      }

      // Record actual departure times using buildPast results
      const allPast = [...hsbPast, ...bowenPast]
      const departureWrites = []
      for (const entry of allPast) {
        if (!entry._hasDep || !entry._depDisplay) continue
        const direction = entry.label === 'HSB' ? 'To Bowen' : 'To HSB'
        const sailingKey = `${data.date}_${entry.time}_${direction}`
        departureWrites.push(
          updateSailingStatus(sailingKey, entry.time, direction, data.date, db, {
            actualDepartureTime: entry._depDisplay,
          })
        )
      }
      if (departureWrites.length) {
        await Promise.all(departureWrites)
        console.log(`Recorded ${departureWrites.length} departure times`)
      }
    } else {
      console.log('No changes detected, skipping save')
    }

    if (VAPID_PUBLIC_KEY.value() && VAPID_PRIVATE_KEY.value()){
      configureWebPush(VAPID_PUBLIC_KEY.value(), VAPID_PRIVATE_KEY.value())

      await checkLatenessAndNotify(data)
    }else{
      console.log('VAPID keys not configured, skipping notification')
    }
  }
)

export const getFerryStatus = onRequest(async (req, res) => {
  const doc = await db.collection('ferryStatus').doc('current').get()

  if (!doc.exists) {
    res.status(404).json({ error: 'No data available' })
    return
  }

  res.json(doc.data())
})

async function updateSailingStatus(sailingKey, sailingTime, direction, date, db, overrides) {
  const docRef = db.collection('sailingStatus').doc(sailingKey)
  const snap = await docRef.get()
  const updates = { sailingKey, sailingTime, direction, date }

  if (overrides.lastCapacity !== undefined) {
    updates.lastCapacity = overrides.lastCapacity
  }

  if (!snap.exists) {
    if (overrides.filledAt) updates.filledAt = overrides.filledAt
    if (overrides.actualDepartureTime) updates.actualDepartureTime = overrides.actualDepartureTime
    await docRef.set(updates)
  } else {
    if (!snap.data().filledAt && overrides.filledAt) updates.filledAt = overrides.filledAt
    if (!snap.data().actualDepartureTime && overrides.actualDepartureTime) {
      updates.actualDepartureTime = overrides.actualDepartureTime
    }
    if (Object.keys(updates).length > 4) {
      await docRef.set(updates, { merge: true })
    }
  }
}
