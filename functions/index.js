import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { onRequest } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { defineSecret } from 'firebase-functions/params'

import { fetchFerryData, checkDataChanged, sanitizeForCompare } from './lib/api.js'
import { configureWebPush } from './lib/notify.js'
import { checkLatenessAndNotify } from './lib/lateness.js'
import {
  augmentRecentActivity,
  matchDepartures,
  enrichDeckCapacity,
  augmentFromCapacityHistory,
} from './lib/enrich.js'
import { recordCapacityChanges, recordDepartureTimes } from './lib/record.js'
import { captureBowenWebcam, captureBowenCommunityWebcam, cleanupOldWebcams } from './lib/webcam.js'
import { nowInVancouver } from './lib/time.js'

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

    const now = nowInVancouver()

    // Compare raw API data BEFORE enrichment mutates it
    const existingDoc = await db.collection('ferryStatus').doc('current').get()
    const existingData = existingDoc.exists ? existingDoc.data() : null

    const newDataSanitized = sanitizeForCompare(data)
    const existingDataSanitized = existingData ? sanitizeForCompare(existingData) : null
    const dataChanged = checkDataChanged(newDataSanitized, existingDataSanitized)

    // Now enrich (mutates data in place)
    await augmentRecentActivity(db, data)
    const { hsbPast, bowenPast } = matchDepartures(data, now)
    enrichDeckCapacity(data, existingData)
    await augmentFromCapacityHistory(db, data)

    if (!dataChanged) {
      console.log('No changes detected, skipping save')
      await maybeSendNotifications(data)
      return
    }

    console.log('Data changed, saving...')

    await db.collection('ferryStatus').doc('current').set(data)
    console.log('Saved ferry status to Firestore')

    await recordCapacityChanges(db, data, existingData)
    await recordDepartureTimes(db, data, hsbPast, bowenPast)

    for (const entry of bowenPast) {
      if (!entry._hasDep || !entry.time || !entry._depDisplay) continue
      const sailingKey = `${data.dateIso}_${entry.time}_To HSB`
      captureBowenWebcam(
        db,
        sailingKey,
        entry.time,
        data.dateIso,
        entry._depDisplay || entry.time,
      ).catch((e) => console.error(`Webcam capture failed for ${sailingKey}:`, e))
    }

    // Capture Bowen community webcam when the ferry arrives at Bowen
    const bowenArrivals = data.recentActivity.filter(
      (e) => e.action === 'Arrived' && e.location === 'Bowen',
    )
    if (bowenArrivals.length > 0) {
      const latest = bowenArrivals[0]
      captureBowenCommunityWebcam(db, latest.time, data.dateIso).catch((e) =>
        console.error('Community webcam capture failed:', e),
      )
    }

    if (process.env.NOTIFY_ENABLED === 'true') {
      await maybeSendNotifications(data)
    }
  },
)

async function maybeSendNotifications(data) {
  if (!VAPID_PUBLIC_KEY.value() || !VAPID_PRIVATE_KEY.value()) {
    console.log('VAPID keys not configured, skipping notification')
    return
  }
  configureWebPush(VAPID_PUBLIC_KEY.value(), VAPID_PRIVATE_KEY.value())
  await checkLatenessAndNotify(data)
}

export const getFerryStatus = onRequest(async (req, res) => {
  const doc = await db.collection('ferryStatus').doc('current').get()

  if (!doc.exists) {
    res.status(404).json({ error: 'No data available' })
    return
  }

  res.json(doc.data())
})

export const cleanupWebcams = onSchedule(
  {
    schedule: 'every day 00:00',
    timeZone: 'America/Vancouver',
  },
  async () => {
    console.log('Running webcam cleanup...')
    await cleanupOldWebcams()
  },
)
