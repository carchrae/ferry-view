import { dayjs, TZ } from '../../functions/lib/time.js'

// Pure helpers for rider reports (userReports). Kept free of Firebase so the
// visibility rule is unit-testable and shared by everything that lists them.

export const USER_REPORT_MAX_LENGTH = 280

// Reports more than two days old are hidden.
export const USER_REPORT_WINDOW_MS = 48 * 60 * 60 * 1000

// More than this many thumbs-down hides a report for everyone.
export const USER_REPORT_HIDE_DOWNVOTES = 3

// votes is {uid: 1 | -1}.
export function tallyVotes(votes) {
  let up = 0
  let down = 0
  for (const v of Object.values(votes || {})) {
    if (v === 1) up++
    else if (v === -1) down++
  }
  return { up, down }
}

export function isReportHidden(report) {
  return tallyVotes(report?.votes).down > USER_REPORT_HIDE_DOWNVOTES
}

// Popularity: thumbs up minus thumbs down.
export function reportScore(report) {
  const { up, down } = tallyVotes(report?.votes)
  return up - down
}

// Recent, not voted down, newest first.
export function visibleReports(reports, nowMs = Date.now()) {
  const cutoff = nowMs - USER_REPORT_WINDOW_MS
  return (reports || [])
    .filter((r) => typeof r.createdAt === 'number' && r.createdAt >= cutoff && !isReportHidden(r))
    .sort((a, b) => b.createdAt - a.createdAt)
}

// The vote to store when `uid` taps `dir` (1 or -1): tapping your current
// vote again withdraws it (null).
export function nextVote(votes, uid, dir) {
  return votes?.[uid] === dir ? null : dir
}

// Visible reports grouped by Vancouver calendar day, newest day first; within
// a day the most popular first, ties to the newest.
// @returns {Array<{day: string, label: string, reports: object[]}>}
export function groupReportsByDay(reports, nowMs = Date.now()) {
  const today = dayjs(nowMs).tz(TZ).startOf('day')
  const groups = new Map()
  for (const r of visibleReports(reports, nowMs)) {
    const day = dayjs(r.createdAt).tz(TZ).format('YYYY-MM-DD')
    if (!groups.has(day)) groups.set(day, [])
    groups.get(day).push(r)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([day, list]) => {
      const daysAgo = today.diff(dayjs.tz(day, TZ), 'day')
      const label =
        daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : dayjs.tz(day, TZ).format('dddd')
      list.sort((a, b) => reportScore(b) - reportScore(a) || b.createdAt - a.createdAt)
      return { day, label, reports: list }
    })
}
