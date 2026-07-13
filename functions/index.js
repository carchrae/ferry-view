import { logger } from 'firebase-functions/logger'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { onRequest } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore'
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
import {
  captureBowenWebcam,
  captureBowenCommunityWebcam,
  captureLineupTimelapse,
  cleanupOldWebcams,
} from './lib/webcam.js'
import {
  isDepartureLogStale,
  fetchBowenDepartures,
  augmentFromBCFerries,
} from './lib/bcferries-departures.js'
import { augmentFromAisPosition, classificationDebug } from './lib/ais-position.js'
import { applyUserCapacityReport } from './lib/user-capacity.js'
import { recomputeLeaderboard, backfillUserReportFlag } from './lib/leaderboard-aggregate.js'
import { recomputeHistoricalStats } from './lib/history-aggregate.js'
import { nowInVancouver, timeToDate } from './lib/time.js'

const VAPID_PRIVATE_KEY = defineSecret('VAPID_PRIVATE_KEY')
const VAPID_PUBLIC_KEY = defineSecret('VAPID_PUBLIC_KEY')

initializeApp()

const db = getFirestore()

// AIS-position is being promoted from fallback to PRIMARY locator. Kept OFF until today's
// sailings are confirmed matching under the "HSB N" -> "Horseshoe Bay" normalization. When
// true, AIS position drives arrival/departure events every poll and the atberth log + BC
// Ferries scrape become fallback (consulted only when the AIS position feed is unusable).
const AIS_PRIMARY = true

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

  // Record the primary mechanism behind the live vessel status, so it's persisted
  // alongside the data:
  //   'ais-position'     — lat/long + speed classifier. PRIMARY when AIS_PRIMARY is on and
  //                        the feed is usable; otherwise the stale-log fallback (in which
  //                        case the BC Ferries scrape ALSO runs to backfill HSB).
  //   'atberth'          — bowenferry.ca's live arrival/departure log (primary when AIS is
  //                        not driving: flag off, or on but AIS momentarily unusable).
  //   'bcferries-scrape' — BC Ferries website scrape only (fallback, no usable AIS position)
  // Set before the change-diff so a source flip (even without a usingFallback flip)
  // triggers a persist on its own.
  const aisUsable = data.isFresh && data.position != null
  const aisPrimary = AIS_PRIMARY && aisUsable
  data.statusSource = aisPrimary
    ? 'ais-position'
    : !usingFallback
      ? 'atberth'
      : aisUsable
        ? 'ais-position'
        : 'bcferries-scrape'

  // Per-poll AIS position diagnostics. Logged every poll (one greppable line) so a missed
  // or spurious arrival/departure transition can be reconstructed from the log history:
  // the sequence of `classified` vs `prevAisLocation` around a bad event tells us whether
  // the vessel was ever classified at the terminal, and whether `prev` was correct when it
  // left. Filter logs for "AIS-DIAG" and paste the lines around the affected sailing.
  logger.log(
    'AIS-DIAG ' +
      JSON.stringify({
        now: now.format('HH:mm'),
        position: data.position,
        ...classificationDebug(data.position, data.speed),
        currentAisLocation: data.aisLocation,
        prevAisLocation: existingData?.aisLocation ?? null,
        aisLocationSince: data.aisLocationSince,
        isFresh: data.isFresh,
        usingFallback,
        aisUsable,
      }),
  )

  const newDataSanitized = sanitizeForCompare(data)
  const existingDataSanitized = existingData ? sanitizeForCompare(existingData) : null
  let dataChanged = forceUpdate || checkDataChanged(newDataSanitized, existingDataSanitized)

  // Recover arrival/departure events that the atberth log alone would miss, and inject them
  // so matching recovers. recentActivity is excluded from checkDataChanged, so any injection
  // must force a persist to save the recovered matches. Every source fires-and-logs so a
  // failure never breaks the poll.
  //
  // Two regimes, selected by AIS_PRIMARY:
  //   - AIS PRIMARY (aisPrimary): the AIS position classifier owns arrival/departure events
  //     and runs every poll (including HSB departures, since the scrape is now fallback).
  //     The atberth log + BC Ferries scrape are consulted only when AIS is unusable — i.e.
  //     when aisPrimary is false, which drops through to the fallback branch below.
  //   - AIS FALLBACK (flag off): the atberth log is primary; the two recovery sources only
  //     fire when it stalls (usingFallback). They are complementary, NOT mutually exclusive:
  //       - BC Ferries scrape: authoritative HSB->Bowen actuals, STATELESS — re-fetches the
  //         full day every poll, so a transient miss self-heals. Reliable owner of the HSB
  //         side, so it always runs in fallback.
  //       - AIS position: the only source for the Bowen->HSB side plus the live location.
  //         STATEFUL (fires once per terminal<->transit transition), so a missed poll loses
  //         that event permanently — why it can't be trusted alone for HSB. Covers HSB
  //         departures only as a backup when the scrape fails.
  if (aisPrimary) {
    // Primary locator: emit position-derived events every poll. AIS owns HSB too now, so
    // emit HSB departures. (Reaching this branch means AIS is usable, so the atberth log /
    // scrape are not consulted; when AIS goes unusable, aisPrimary is false and the
    // fallback branch below takes over automatically.)
    const added = augmentFromAisPosition(data, existingData, now, { emitHsbDepartures: true })
    if (added > 0) {
      dataChanged = true
      logger.log(`AIS primary: recovered ${added} event(s)`)
    }
  } else if (usingFallback) {
    let scraperOk = false
    try {
      const scraped = await fetchBowenDepartures()
      const added = augmentFromBCFerries(data, scraped, now)
      scraperOk = true
      if (added > 0) {
        dataChanged = true
        logger.log(`BC Ferries fallback: recovered ${added} HSB departure(s)`)
      }
    } catch (e) {
      logger.error('BC Ferries departures fallback failed:', e)
    }

    if (aisUsable) {
      const added = augmentFromAisPosition(data, existingData, now, {
        emitHsbDepartures: !scraperOk,
      })
      if (added > 0) {
        dataChanged = true
        logger.log(`AIS position fallback: recovered ${added} event(s)`)
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

  // Now backfill — reads freshly-corrected sailingStatus docs. Only when this
  // poll changed something (or was forced): on a no-change poll the enriched
  // result is never persisted (see the dataChanged guard below) and the poll
  // discards it, so running the backfills would spend ~30-50 Firestore reads
  // per minute for nothing. User reports arrive via onCapacityReport, which
  // re-runs this with forceUpdate, so they still get backfilled promptly.
  if (dataChanged) {
    await augmentRecentActivity(db, data)
    await augmentFromCapacityHistory(db, data)
  }

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

  // Capture Bowen community webcam when the ferry arrives at Bowen. The lineup
  // this predicts is the next scheduled Bowen departure strictly after the
  // arrival's own time — not "whatever departure was last matched so far".
  // That distinction matters when an arrival and the departure that follows
  // it land in the same poll (a batched/delayed atberth log update): using
  // "last matched" would already reflect that later departure and mis-pair
  // this arrival with the *next* sailing after it, leaving a stale lineup
  // photo attached to a sailing that hasn't actually happened yet.
  const bowenArrivals = data.recentActivity.filter(
    (e) => e.action === 'Arrived' && e.location === 'Bowen',
  )
  if (bowenArrivals.length > 0) {
    const latest = bowenArrivals[0]
    const latestTime = timeToDate(latest.time)
    const nextDep = latestTime
      ? data.bowenSchedule.find((s) => {
          const t = timeToDate(s.time)
          return t && t > latestTime
        })
      : null
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

    // Cadence-driven (every 5th poll during a lineup window), so it runs
    // whether or not this poll changed anything — unlike captureWebcams,
    // which is event-driven and gated behind dataChanged.
    try {
      await captureLineupTimelapse(db, data)
    } catch (e) {
      logger.error('Lineup timelapse capture failed:', e)
    }

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

// React to user capacity tags immediately: persist them to sailingStatus (past
// sailings included) and, for today's sailings, regenerate ferryStatus/current
// so other clients don't wait for the next 1-minute poll. Automated records
// (no userUid) are ignored, which also prevents any trigger loop via
// recordCapacityChanges.
export const onCapacityReport = onDocumentCreated('capacityHistory/{docId}', async (event) => {
  const record = event.data?.data()
  const isToday = await applyUserCapacityReport(db, record)
  if (isToday) {
    try {
      await refreshFerryData(db, { forceUpdate: true })
    } catch (e) {
      logger.error('Status refresh after user capacity report failed:', e)
    }
  }
  // Only user reports affect the leaderboard; automated (no-userUid) records are
  // ignored, which also avoids needless recomputes and any trigger loop.
  if (record?.userUid) {
    try {
      await recomputeLeaderboard(db)
    } catch (e) {
      logger.error('Leaderboard recompute after capacity report failed:', e)
    }
  }
})

// A rider marked the moment the car lineup reached the crosswalk. Stamp it on
// the sailing's doc — first tag wins (the interesting moment is when the
// lineup *becomes* that long); all raw reports stay in lineupReports as
// labeled training data for a future automated detector.
export const onLineupReport = onDocumentCreated('lineupReports/{docId}', async (event) => {
  const r = event.data?.data()
  if (!r?.userUid || typeof r.crosswalkAt !== 'number') return
  const m = /^(\d{4}-\d{2}-\d{2})_(.+)_(To\s.+)$/.exec(r.sailingKey || '')
  if (!m) {
    logger.warn('Ignoring lineup report with malformed sailingKey:', r.sailingKey)
    return
  }
  const [, dateIso, time, direction] = m
  const ref = db.collection('sailingStatus').doc(r.sailingKey)
  const snap = await ref.get()
  if (snap.exists && snap.data().crosswalkFullAt) return
  await ref.set(
    {
      sailingKey: r.sailingKey,
      sailingTime: time,
      direction,
      dateIso,
      crosswalkFullAt: r.crosswalkAt,
    },
    { merge: true },
  )
  // Surface the mark on the live schedule right away (augmentRecentActivity
  // copies crosswalkFullAt onto the bowenSchedule entry) instead of waiting
  // for the next changed poll — mirrors onCapacityReport.
  if (dateIso === nowInVancouver().format('YYYY-MM-DD')) {
    try {
      await refreshFerryData(db, { forceUpdate: true })
    } catch (e) {
      logger.error('Status refresh after lineup report failed:', e)
    }
  }
})

// Any ride create/edit/delete changes the ride-share board (a deleted ride must
// lose its credit). recomputeLeaderboard only writes to aggregates/*, so this
// can't loop.
export const onRideWrite = onDocumentWritten('rides/{rideId}', async () => {
  try {
    await recomputeLeaderboard(db)
  } catch (e) {
    logger.error('Leaderboard recompute after ride write failed:', e)
  }
})

// Daily refresh so the rolling 30-day window (and the champion) stays accurate
// on days with no user activity.
export const refreshLeaderboard = onSchedule(
  {
    schedule: 'every day 03:00',
    timeZone: 'America/Vancouver',
  },
  async () => {
    await recomputeLeaderboard(db)
  },
)

// Nightly rebuild of the historicalStats aggregate. Its window ends yesterday,
// so once-a-day is always fresh; clients read the one doc instead of range-
// scanning ~8 weeks of sailingStatus on every HomePage/HistoryPage mount.
export const refreshHistoryAggregate = onSchedule(
  {
    schedule: 'every day 03:10',
    timeZone: 'America/Vancouver',
  },
  async () => {
    await recomputeHistoricalStats(db)
  },
)

// Manual one-shot: seed aggregates/historicalStats. Hit once after deploy so
// clients don't fall back to direct range scans until the first 03:10 run.
export const rebuildHistoryAggregate = onRequest(async (req, res) => {
  try {
    const result = await recomputeHistoricalStats(db)
    res.json(result)
  } catch (e) {
    logger.error('rebuildHistoryAggregate failed:', e)
    res.status(500).json({ error: String(e) })
  }
})

// Manual one-shot: backfill the userReport flag on pre-existing user records,
// then seed/rebuild the aggregate doc. Hit once after deploying this change.
export const rebuildLeaderboard = onRequest(async (req, res) => {
  try {
    const backfilled = await backfillUserReportFlag(db)
    const { reporters, riders } = await recomputeLeaderboard(db)
    res.json({ backfilled, reporters: reporters.length, riders: riders.length })
  } catch (e) {
    logger.error('rebuildLeaderboard failed:', e)
    res.status(500).json({ error: String(e) })
  }
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
