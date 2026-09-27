import { logger } from 'firebase-functions/logger'
import {
  aggregateLeaderboard,
  aggregateRideLeaderboard,
  attachAllTime,
} from './leaderboard-score.js'
import { isValidLineupReport } from './lineup-labels.js'

const DAY_MS = 24 * 60 * 60 * 1000
const WINDOW_DAYS = 30
const MAX_ENTRIES = 100 // keep the aggregate doc well under Firestore's 1 MB limit
const GOAT_COUNT = 3 // all-time top users shown as the "Bowen GOATs"

// Recompute both ranked boards from the last 30 days of activity and store them
// in a single doc (aggregates/leaderboard) so clients read one doc instead of
// scanning collections. Each entry also carries its all-time credits, and the
// all-time top few of each board are stored as `goats`. All activity is loaded
// once and the 30-day window is filtered in memory (a sailing's reports land
// within minutes of each other, so windowing by report time is unchanged).
// Called from the capacity/ride triggers and daily.
export async function recomputeLeaderboard(db) {
  const cutoff = Date.now() - WINDOW_DAYS * DAY_MS

  // Capacity reporters — only user-contributed records carry userReport:true,
  // so automated (scraped) records never enter the query.
  const capSnap = await db.collection('capacityHistory').where('userReport', '==', true).get()
  const reports = []
  capSnap.forEach((doc) => {
    const d = doc.data()
    if (!d.userUid) return
    reports.push({
      sailingKey: d.sailingKey,
      capacity: d.capacity,
      recordedAt: d.recordedAt,
      userUid: d.userUid,
      userName: d.userName || null,
      userPhoto: d.userPhoto || null,
      anonymous: d.anonymous || false,
    })
  })

  // Crosswalk marks — scored into the same reporter board as capacity reports.
  const cwSnap = await db.collection('lineupReports').get()
  const crosswalkReports = []
  cwSnap.forEach((doc) => {
    const d = doc.data()
    if (!isValidLineupReport(d)) return
    crosswalkReports.push({
      sailingKey: d.sailingKey,
      crosswalkAt: d.crosswalkAt,
      notYet: d.notYet === true,
      recordedAt: d.recordedAt || 0,
      userUid: d.userUid,
      userName: d.userName || null,
      userPhoto: d.userPhoto || null,
      anonymous: d.anonymous || false,
    })
  })

  // Ride sharers.
  const rideSnap = await db.collection('rides').get()
  const rides = []
  rideSnap.forEach((doc) => {
    const d = doc.data()
    if (!d.authorUid) return
    rides.push({
      authorUid: d.authorUid,
      authorName: d.authorName || null,
      authorPhoto: d.authorPhoto || null,
      createdAt: d.createdAt?.toMillis?.() || 0,
      anonymous: d.anonymous || false,
      type: d.type,
    })
  })

  const recent = (r) => (r.recordedAt || 0) >= cutoff
  const allTimeReporters = aggregateLeaderboard(reports, crosswalkReports)
  const allTimeRiders = aggregateRideLeaderboard(rides)
  const reporters = attachAllTime(
    aggregateLeaderboard(reports.filter(recent), crosswalkReports.filter(recent)),
    allTimeReporters,
  ).slice(0, MAX_ENTRIES)
  const riders = attachAllTime(
    aggregateRideLeaderboard(rides.filter((r) => r.createdAt >= cutoff)),
    allTimeRiders,
  ).slice(0, MAX_ENTRIES)
  const goats = {
    reporters: allTimeReporters.slice(0, GOAT_COUNT),
    riders: allTimeRiders.slice(0, GOAT_COUNT),
  }

  await db
    .collection('aggregates')
    .doc('leaderboard')
    .set({ reporters, riders, goats, updatedAt: Date.now() })

  logger.log(`Leaderboard recomputed: ${reporters.length} reporters, ${riders.length} riders`)
  return { reporters, riders }
}

// One-time backfill: pre-existing user reports predate the userReport flag, so
// the efficient query would miss them. Scan the last 30 days once and stamp
// userReport:true on any record that has a userUid but not the flag. Invoked by
// the manual rebuild endpoint after deploy.
export async function backfillUserReportFlag(db) {
  const cutoff = Date.now() - WINDOW_DAYS * DAY_MS
  const snap = await db.collection('capacityHistory').where('recordedAt', '>=', cutoff).get()

  let batch = db.batch()
  let pending = 0
  let updated = 0
  for (const doc of snap.docs) {
    const d = doc.data()
    if (!d.userUid || d.userReport === true) continue
    batch.update(doc.ref, { userReport: true })
    pending++
    updated++
    if (pending === 400) {
      await batch.commit()
      batch = db.batch()
      pending = 0
    }
  }
  if (pending > 0) await batch.commit()

  logger.log(`Backfilled userReport on ${updated} capacityHistory records`)
  return updated
}
