import { logger } from 'firebase-functions/logger'
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

async function refreshFerryData(db, {forceUpdate = false} = {}) {
  const data = await fetchFerryData()
  if (!data) return null

  const now = nowInVancouver()

  const existingDoc = await db.collection('ferryStatus').doc('current').get()
  const existingData = existingDoc.exists ? existingDoc.data() : null

  const newDataSanitized = sanitizeForCompare(data)
  const existingDataSanitized = existingData ? sanitizeForCompare(existingData) : null
  const dataChanged = forceUpdate || checkDataChanged(newDataSanitized, existingDataSanitized)

  await augmentRecentActivity(db, data)
  const { hsbPast, bowenPast } = matchDepartures(data, now)
  enrichDeckCapacity(data, existingData)
  await augmentFromCapacityHistory(db, data)

  if (dataChanged) {
    await db.collection('ferryStatus').doc('current').set(data)
    await recordCapacityChanges(db, data, existingData)
    await recordDepartureTimes(db, data, hsbPast, bowenPast)
  } else{
    logger.debug('No changes detected, skipping save');
  }

  return { data, hsbPast, bowenPast, dataChanged }
}

function captureWebcams(bowenPast, data) {
  for (const entry of bowenPast) {
    if (!entry._hasDep || !entry.time || !entry._depDisplay) continue
    const sailingKey = `${data.dateIso}_${entry.time}_To HSB`
    captureBowenWebcam(
      db,
      sailingKey,
      entry.time,
      data.dateIso,
      entry._depDisplay || entry.time,
    ).catch((e) => logger.error(`Webcam capture failed for ${sailingKey}:`, e))
  }

  // Capture Bowen community webcam when the ferry arrives at Bowen
  const bowenArrivals = data.recentActivity.filter(
    (e) => e.action === 'Arrived' && e.location === 'Bowen',
  )
  if (bowenArrivals.length > 0) {
    const latest = bowenArrivals[0]
    captureBowenCommunityWebcam(db, latest.time, data.dateIso).catch((e) =>
      logger.error('Community webcam capture failed:', e),
    )
  }
}

export const pollFerryStatus = onSchedule(
  {
    schedule: 'every 1 minutes',
    secrets: [VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY],
  },
  async (context) => {
    logger.log('Polling ferry status...')
    const result = await refreshFerryData(db)
    if (!result) {
      logger.log('No ferry data fetched')
      return
    }
    const { data, hsbPast, bowenPast, dataChanged } = result

    captureWebcams(bowenPast, data)

    if (!dataChanged) {
      logger.log('No changes detected, skipping save')
      await maybeSendNotifications(data)
      return
    }

    await maybeSendNotifications(data)
  },
)

async function maybeSendNotifications(data) {
  if (process.env.NOTIFY_ENABLED !== 'true') {
    return
  }
  if (!VAPID_PUBLIC_KEY.value() || !VAPID_PRIVATE_KEY.value()) {
    logger.log('VAPID keys not configured, skipping notification')
    return
  }
  configureWebPush(VAPID_PUBLIC_KEY.value(), VAPID_PRIVATE_KEY.value())
  await checkLatenessAndNotify(data)
}

export const getFerryStatus = onRequest(async (req, res) => {
  const result = await refreshFerryData(db, {forceUpdate: true})
  if (!result) {
    res.status(500).json({ error: 'Failed to fetch ferry data' })
    return
  }
  res.json(result.data)
})

export const cleanupWebcams = onSchedule(
  {
    schedule: 'every day 00:00',
    timeZone: 'America/Vancouver',
  },
  async () => {
    logger.log('Running webcam cleanup...')
    await cleanupOldWebcams()
  },
)
