// Pure (Vue/Firebase-free) scoring for the reporter leaderboard, so it can be
// unit-tested under `node --test`. Everything here operates on plain report
// objects: { sailingKey, capacity, recordedAt, userUid, userName }.
//
// Credit model (see plan / schema.md capacity semantics):
//   Reports collapse into two agreement CAMPS, because "Not Full" agrees with
//   any non-Full value:
//     FULL     = "Full"
//     NOTFULL  = "Not Full", "25%" (75% full), "10%" (90% full), any percent
//   Per sailing, keep each user's LATEST report, order by recordedAt, then:
//     - Undisputed (one camp only):   first reporter 1.0, later agreers +0.1
//     - Disputed & resolved (both camps, one has a strict plurality):
//         winning camp first 1.0, other winners 0.5 each, losers 0.1 each
//     - Disputed & tied (both camps equal): everyone 0.1, sailing "Conflicting"

export const CREDIT_FIRST = 1.0 // first correct reporter of the winning camp
export const CREDIT_CONFIRM = 0.5 // additional reporter who confirms a disputed win
export const CREDIT_AGREE = 0.1 // redundant agreement / participation / losing camp

// Which agreement camp a reported value belongs to. Only "Full" means the deck
// filled; everything else ("Not Full" and any percent-available) agrees that
// there was room.
export function capacityCamp(value) {
  return value === 'Full' ? 'FULL' : 'NOTFULL'
}

// Keep only each user's most recent report, sorted oldest-first by recordedAt.
function latestPerUser(reports) {
  const latest = new Map()
  for (const r of reports) {
    if (!r || !r.userUid) continue
    const prev = latest.get(r.userUid)
    if (!prev || (r.recordedAt || 0) > (prev.recordedAt || 0)) latest.set(r.userUid, r)
  }
  return [...latest.values()].sort((a, b) => (a.recordedAt || 0) - (b.recordedAt || 0))
}

// Score a single sailing's reports.
// Returns { credits: Map<uid, number>, disputed, resolved, winner }.
//   disputed  — both a FULL and a NOTFULL report exist
//   resolved  — a clear winner is known (undisputed, or a strict plurality)
//   winner    — 'FULL' | 'NOTFULL' | null (null only while disputed & tied)
export function scoreSailing(reports) {
  const list = latestPerUser(reports || [])
  const credits = new Map()
  if (list.length === 0) return { credits, disputed: false, resolved: false, winner: null }

  const camps = { FULL: [], NOTFULL: [] }
  for (const r of list) camps[capacityCamp(r.capacity)].push(r) // preserves time order
  const nFull = camps.FULL.length
  const nNot = camps.NOTFULL.length
  const disputed = nFull > 0 && nNot > 0

  // Undisputed: single camp. First reporter earns the base credit; every later
  // agreer earns the participation credit.
  if (!disputed) {
    list.forEach((r, i) => credits.set(r.userUid, i === 0 ? CREDIT_FIRST : CREDIT_AGREE))
    return { credits, disputed: false, resolved: true, winner: capacityCamp(list[0].capacity) }
  }

  // Disputed & tied: nobody is confirmed correct yet — everyone gets the
  // participation credit and the sailing is flagged as conflicting.
  if (nFull === nNot) {
    for (const r of list) credits.set(r.userUid, CREDIT_AGREE)
    return { credits, disputed: true, resolved: false, winner: null }
  }

  // Disputed & resolved: the larger camp wins. Its earliest reporter was first &
  // correct (1.0); the others confirmed a contested result (0.5). The losing
  // camp still earns the participation credit (0.1).
  const winner = nFull > nNot ? 'FULL' : 'NOTFULL'
  const loser = winner === 'FULL' ? 'NOTFULL' : 'FULL'
  camps[winner].forEach((r, i) => credits.set(r.userUid, i === 0 ? CREDIT_FIRST : CREDIT_CONFIRM))
  for (const r of camps[loser]) credits.set(r.userUid, CREDIT_AGREE)
  return { credits, disputed: true, resolved: true, winner }
}

// Aggregate a flat list of reports (across many sailings) into a ranked
// leaderboard. Returns [{ userUid, userName, credits, reportCount }] sorted by
// credits desc, then report count desc.
export function aggregateLeaderboard(reports) {
  const bySailing = new Map()
  for (const r of reports || []) {
    if (!r || !r.userUid || !r.sailingKey) continue
    if (!bySailing.has(r.sailingKey)) bySailing.set(r.sailingKey, [])
    bySailing.get(r.sailingKey).push(r)
  }

  const totals = new Map() // uid -> { userUid, userName, credits, reportCount }
  for (const sailingReports of bySailing.values()) {
    const { credits } = scoreSailing(sailingReports)
    // Latest-per-user, so each user counts once per sailing for both credit and
    // report count. Track the newest userName we've seen for the display label.
    const latest = latestPerUser(sailingReports)
    for (const r of latest) {
      const entry = totals.get(r.userUid) || {
        userUid: r.userUid,
        userName: null,
        credits: 0,
        reportCount: 0,
        _nameAt: -1,
      }
      entry.credits += credits.get(r.userUid) || 0
      entry.reportCount += 1
      if (r.userName && (r.recordedAt || 0) >= entry._nameAt) {
        entry.userName = r.userName
        entry._nameAt = r.recordedAt || 0
      }
      totals.set(r.userUid, entry)
    }
  }

  return [...totals.values()]
    .map((e) => ({
      userUid: e.userUid,
      userName: e.userName,
      credits: round1(e.credits),
      reportCount: e.reportCount,
    }))
    .sort((a, b) => b.credits - a.credits || b.reportCount - a.reportCount)
}

// Round to 1 decimal, avoiding floating-point noise like 0.30000000000000004.
export function round1(n) {
  return Math.round(n * 10) / 10
}

// Display a reporter's name as first name + last initial:
//   "Tom Carchrae" -> "Tom C.", "Tom" -> "Tom", "tom@x.com" -> "tom".
// Falls back to "A rider" when no usable name is stored (legacy reports).
export function formatReporterName(name) {
  if (!name || typeof name !== 'string') return 'A rider'
  let n = name.trim()
  if (!n) return 'A rider'
  if (n.includes('@')) n = n.split('@')[0].trim() // email -> local part
  const parts = n.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'A rider'
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`
}
