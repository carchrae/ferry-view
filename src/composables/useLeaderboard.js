import { collection, doc, getDocs, onSnapshot, query, where, Timestamp } from 'firebase/firestore'
import { db } from 'src/boot/firebase'
import {
  scoreSailing,
  scoreCrosswalk,
  aggregateLeaderboard,
  aggregateRideLeaderboard,
  formatReporterName,
} from '../../functions/lib/leaderboard-score.js'
import { loadRecentLineupReports } from 'src/composables/useLineupReport'

// Reads the user-submitted capacity reports (capacityHistory is world-readable)
// and derives the reporter leaderboard + per-sailing report/conflict info. All
// scoring lives in the Firebase-free functions/lib/leaderboard-score.js module,
// shared with the server-side recompute.
export function useLeaderboard() {
  // All user reports (userUid present) recorded in the last `days` days.
  // Grouping by sailingKey means a sailing is scored from the reports inside the
  // window — fine for a rolling 30-day board (older sailings lose their photos).
  async function loadRecentUserReports(days = 30) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    // Only user-contributed records carry userReport:true, so this skips all the
    // automated (scraped) capacityHistory noise at the query level.
    const snap = await getDocs(
      query(
        collection(db, 'capacityHistory'),
        where('userReport', '==', true),
        where('recordedAt', '>=', cutoff),
      ),
    )
    const reports = []
    snap.forEach((docSnap) => {
      const d = docSnap.data()
      if (!d.userUid) return // defensive: automated records shouldn't match anyway
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
    return reports
  }

  // Ranked leaderboard for the past `days` days. Crosswalk marks earn credit
  // alongside capacity reports.
  async function getLeaderboard(days = 30) {
    const [reports, crosswalkReports] = await Promise.all([
      loadRecentUserReports(days),
      loadRecentLineupReports(days),
    ])
    return aggregateLeaderboard(reports, crosswalkReports)
  }

  // All rides (offers + requests) posted in the last `days` days.
  async function loadRecentRides(days = 30) {
    const cutoff = Timestamp.fromMillis(Date.now() - days * 24 * 60 * 60 * 1000)
    const snap = await getDocs(query(collection(db, 'rides'), where('createdAt', '>=', cutoff)))
    const rides = []
    snap.forEach((docSnap) => {
      const d = docSnap.data()
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
    return rides
  }

  // Ranked ride-share leaderboard for the past `days` days.
  async function getRideLeaderboard(days = 30) {
    const rides = await loadRecentRides(days)
    return aggregateRideLeaderboard(rides)
  }

  // Live-subscribe to the server-precomputed board (aggregates/leaderboard),
  // avoiding a full collection scan on every page load. onData receives
  // { reporters, riders, exists, updatedAt }; `exists` is false until the first
  // server recompute has run, so callers can fall back to client aggregation.
  // Returns the unsubscribe function.
  function subscribeLeaderboard(onData, onError) {
    return onSnapshot(
      doc(db, 'aggregates', 'leaderboard'),
      (snap) => {
        const d = snap.data()
        onData({
          reporters: d?.reporters || [],
          riders: d?.riders || [],
          exists: snap.exists(),
          updatedAt: d?.updatedAt || null,
        })
      },
      onError,
    )
  }

  // A single user's reports (capacity + crosswalk marks) over the past `days`
  // days, newest first, each annotated with the credit it earned within its
  // sailing. Crosswalk entries carry `crosswalkAt` instead of `capacity`.
  async function getUserReports(userUid, days = 30) {
    const [reports, crosswalkReports] = await Promise.all([
      loadRecentUserReports(days),
      loadRecentLineupReports(days),
    ])

    // One entry per sailing the user reported on: their latest report of that
    // kind plus the credit the scoring model gives it.
    function collect(list, scoreFn, pick) {
      const bySailing = new Map()
      for (const r of list) {
        if (!bySailing.has(r.sailingKey)) bySailing.set(r.sailingKey, [])
        bySailing.get(r.sailingKey).push(r)
      }
      const out = []
      for (const [sailingKey, sailingReports] of bySailing) {
        const mine = sailingReports.filter((r) => r.userUid === userUid)
        if (!mine.length) continue
        const latest = mine.reduce((a, b) => ((b.recordedAt || 0) > (a.recordedAt || 0) ? b : a))
        const { credits } = scoreFn(sailingReports)
        out.push({
          sailingKey,
          recordedAt: latest.recordedAt,
          credit: credits.get(userUid) || 0,
          ...pick(latest),
        })
      }
      return out
    }

    return [
      ...collect(reports, scoreSailing, (r) => ({ capacity: r.capacity })),
      ...collect(crosswalkReports, scoreCrosswalk, (r) => ({ crosswalkAt: r.crosswalkAt })),
    ].sort((a, b) => (b.recordedAt || 0) - (a.recordedAt || 0))
  }

  return {
    loadRecentUserReports,
    getLeaderboard,
    getUserReports,
    getRideLeaderboard,
    subscribeLeaderboard,
  }
}

export { scoreSailing, formatReporterName }
