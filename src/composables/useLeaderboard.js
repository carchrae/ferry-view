import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from 'src/boot/firebase'
import {
  scoreSailing,
  aggregateLeaderboard,
  formatReporterName,
} from 'src/composables/leaderboardScore'

// Reads the user-submitted capacity reports (capacityHistory is world-readable)
// and derives the reporter leaderboard + per-sailing report/conflict info. All
// scoring lives in the Firebase-free leaderboardScore.js module.
export function useLeaderboard() {
  // All user reports (userUid present) recorded in the last `days` days.
  // Grouping by sailingKey means a sailing is scored from the reports inside the
  // window — fine for a rolling 30-day board (older sailings lose their photos).
  async function loadRecentUserReports(days = 30) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    const snap = await getDocs(
      query(collection(db, 'capacityHistory'), where('recordedAt', '>=', cutoff)),
    )
    const reports = []
    snap.forEach((docSnap) => {
      const d = docSnap.data()
      if (!d.userUid) return // skip automated (scraped) records
      reports.push({
        sailingKey: d.sailingKey,
        capacity: d.capacity,
        recordedAt: d.recordedAt,
        userUid: d.userUid,
        userName: d.userName || null,
      })
    })
    return reports
  }

  // Ranked leaderboard for the past `days` days.
  async function getLeaderboard(days = 30) {
    const reports = await loadRecentUserReports(days)
    return aggregateLeaderboard(reports)
  }

  // A single user's reports over the past `days` days, newest first, each
  // annotated with the credit it earned within its sailing.
  async function getUserReports(userUid, days = 30) {
    const reports = await loadRecentUserReports(days)
    const bySailing = new Map()
    for (const r of reports) {
      if (!bySailing.has(r.sailingKey)) bySailing.set(r.sailingKey, [])
      bySailing.get(r.sailingKey).push(r)
    }

    const out = []
    for (const [sailingKey, sailingReports] of bySailing) {
      const mine = sailingReports.filter((r) => r.userUid === userUid)
      if (!mine.length) continue
      const latest = mine.reduce((a, b) => ((b.recordedAt || 0) > (a.recordedAt || 0) ? b : a))
      const { credits } = scoreSailing(sailingReports)
      out.push({
        sailingKey,
        capacity: latest.capacity,
        recordedAt: latest.recordedAt,
        credit: credits.get(userUid) || 0,
      })
    }
    return out.sort((a, b) => (b.recordedAt || 0) - (a.recordedAt || 0))
  }

  return { loadRecentUserReports, getLeaderboard, getUserReports }
}

export { scoreSailing, formatReporterName }
