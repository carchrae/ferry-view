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
import {
  isDepartureLogStale,
  fetchBowenDepartures,
  augmentFromBCFerries,
} from './lib/bcferries-departures.js'
import { augmentFromAisPosition } from './lib/ais-position.js'
import { nowInVancouver } from './lib/time.js'

const VAPID_PRIVATE_KEY = defineSecret('VAPID_PRIVATE_KEY')
const VAPID_PUBLIC_KEY = defineSecret('VAPID_PUBLIC_KEY')

initializeApp()

const db = getFirestore()

async function refreshFerryData(db, {forceUpdate = false} = {}) {
  const data = await fetchFerryData()
  if (!data) return null

  const now = nowInVancouver()

  // Detect a stalled departure log up front and record it on the doc, so the frontend
  // can switch to fallback display (unknown-time '?' for unrecoverable sailings) and
  // show an indicator. Setting it before the change-diff means a flip in/out of
  // fallback triggers a persist on its own.
  const usingFallback = isDepartureLogStale(data, now)
  data.usingFallback = usingFallback

  const existingDoc = await db.collection('ferryStatus').doc('current').get()
  const existingData = existingDoc.exists ? existingDoc.data() : null

  // Track when the current AIS location state began, so the frontend can show a reliable
  // "Docked for N min" even when the atberth log (recentActivity) has frozen. Carry the
  // timestamp forward while the classification is unchanged; reset it on a transition.
  data.aisLocationSince =
    existingData && existingData.aisLocation === data.aisLocation && existingData.aisLocationSince
      ? existingData.aisLocationSince
      : Date.now()

  // Record which mechanism produced the arrival/departure status, so it's persisted
  // alongside the data:
  //   'atberth'          — bowenferry.ca's live arrival/departure log (primary source)
  //   'ais-position'     — lat/long + speed classifier (fallback, live log stale)
  //   'bcferries-scrape' — BC Ferries website scrape (fallback, no usable AIS position)
  // Set before the change-diff so a source flip (even without a usingFallback flip)
  // triggers a persist on its own.
  const aisUsable = data.isFresh && data.position != null
  data.statusSource = !usingFallback ? 'atberth' : aisUsable ? 'ais-position' : 'bcferries-scrape'

  const newDataSanitized = sanitizeForCompare(data)
  const existingDataSanitized = existingData ? sanitizeForCompare(existingData) : null
  let dataChanged = forceUpdate || checkDataChanged(newDataSanitized, existingDataSanitized)

  // Fallback: if bowenferry.ca's departure log has stalled (live feed fresh but no new
  // Departed/Arrived events), recover arrival/departure events another way and inject them
  // so matching recovers. recentActivity is excluded from checkDataChanged, so any injection
  // must force a persist to save the recovered matches.
  //
  // Prefer the AIS position classifier: when the live position feed is fresh and we have
  // valid coordinates, the vessel's lat/long + speed tell us which terminal it's at, with
  // no extra network call and covering both directions. Only fall back to scraping BC
  // Ferries' website when the AIS position data isn't usable. Both fire-and-log so a
  // failure never breaks the poll.
  if (usingFallback) {
    if (aisUsable) {
      const added = augmentFromAisPosition(data, existingData, now)
      if (added > 0) {
        dataChanged = true
        logger.log(`AIS position fallback: recovered ${added} event(s)`)
      }
    } else {
      try {
        const scraped = await fetchBowenDepartures()
        const added = augmentFromBCFerries(data, scraped, now)
        if (added > 0) {
          dataChanged = true
          logger.log(`BC Ferries fallback: recovered ${added} HSB departure(s)`)
        }
      } catch (e) {
        logger.error('BC Ferries departures fallback failed:', e)
      }
    }
  }

  // Match against raw API recentActivity (plus any scraped fallback, no DB backfill yet)
  const { hsbPast, bowenPast } = matchDepartures(data, now)

  // Enrich and persist departure/capacity records before backfill,
  // so that sailingStatus docs have the correct actualDepartureTime
  // before augmentRecentActivity reads them.
  enrichDeckCapacity(data, existingData)
  if (dataChanged) {
    await recordCapacityChanges(db, data, existingData)
    await recordDepartureTimes(db, data, hsbPast, bowenPast)
  } else {
    logger.debug('No changes detected, skipping save')
  }

  // Now backfill — reads freshly-corrected sailingStatus docs
  await augmentRecentActivity(db, data)
  await augmentFromCapacityHistory(db, data)

  // Clear first-match artifacts from schedule so the second match
  // re-evaluates from scratch with the (now augmented) recentActivity.
  for (const entry of data.hsbSchedule) {
    delete entry.matchedDepartureTime
    delete entry.latenessMinutes
  }
  for (const entry of data.bowenSchedule) {
    delete entry.matchedDepartureTime
    delete entry.latenessMinutes
  }

  // Re-match for the frontend response (picks up any backfilled events)
  const { hsbPast: hsbPast2, bowenPast: bowenPast2 } = matchDepartures(data, now)

  // Save the fully-enriched data to Firestore
  if (dataChanged) {
    await db.collection('ferryStatus').doc('current').set(data)
  }

  return { data, hsbPast: hsbPast2, bowenPast: bowenPast2, dataChanged }
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
    const lastMatched = data.bowenSchedule
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.matchedDepartureTime)
      .pop()
    if (!lastMatched) {
      logger.error('No matched Bowen departure found for community webcam capture')
      return
    }
    const nextDep = data.bowenSchedule[lastMatched.i + 1]
    if (!nextDep) {
      logger.error('No upcoming Bowen departure for community webcam capture')
      return
    }
    captureBowenCommunityWebcam(db, nextDep.time, data.dateIso, latest.time).catch((e) =>
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

    if (!dataChanged) {
      logger.log('No changes detected, skipping save')
      await maybeSendNotifications(data)
      return
    }

    captureWebcams(bowenPast, data)

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
