// Pure (Vue/Firebase-free) scoring for the reporter leaderboard, so it can be
// unit-tested under `node --test`. Everything here operates on plain report
// objects: { sailingKey, capacity, recordedAt, userUid, userName }.
//
// Credit model (see plan / schema.md capacity semantics):
//   Reports are compared by their EXACT reported value ("Full", "Not Full",
//   "25%" = 75% full, "10%" = 90% full) — any two different values disagree.
//   Per sailing, keep each user's LATEST report, order by recordedAt, then:
//     - Undisputed (one value only):  first reporter 1.0, later agreers +0.1
//     - Disputed & resolved (several values, one has a strict plurality):
//         winning value first 1.0, other winners 0.5 each, losers 0.1 each
//     - Disputed & tied (top values equal): everyone 0.1, sailing shows a
//       disagreement

export const CREDIT_FIRST = 1.0 // first correct reporter of the winning camp
export const CREDIT_CONFIRM = 0.5 // additional reporter who confirms a disputed win
export const CREDIT_AGREE = 0.1 // redundant agreement / participation / losing camp

export const RIDE_OFFER_CREDIT = 10 // posting a ride offer (has a spare seat)
export const RIDE_REQUEST_CREDIT = 5 // posting a ride request (looking for a seat)

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

// Group a latest-per-user list by key and find the plurality winner.
// Returns { disputed, resolved, winnerKey, winners }:
//   disputed  — more than one distinct key
//   resolved  — a clear winner is known (undisputed, or a strict plurality)
//   winnerKey — the winning key (null while disputed & tied)
//   winners   — the reports carrying the winning key, in time order (empty
//               while tied)
function pluralityBy(list, keyFn) {
  const groups = new Map()
  for (const r of list) {
    const k = keyFn(r)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(r) // preserves time order
  }
  const ranked = [...groups.values()].sort((a, b) => b.length - a.length)
  const disputed = groups.size > 1
  const resolved = groups.size > 0 && (!disputed || ranked[0].length > ranked[1].length)
  return {
    disputed,
    resolved,
    winnerKey: resolved ? keyFn(ranked[0][0]) : null,
    winners: resolved ? ranked[0] : [],
  }
}

// Assign credits to a latest-per-user list grouped by key: the winning key's
// earliest reporter was first & correct (1.0); the other winners either agreed
// with an unopposed value (0.1) or confirmed a contested one (0.5); everyone
// else — losers, or everybody while tied — earns the participation credit (0.1).
function creditsByPlurality(list, keyFn) {
  const credits = new Map()
  if (list.length === 0)
    return { credits, disputed: false, resolved: false, winnerKey: null, winners: [] }

  const { disputed, resolved, winnerKey, winners } = pluralityBy(list, keyFn)
  winners.forEach((r, i) =>
    credits.set(r.userUid, i === 0 ? CREDIT_FIRST : disputed ? CREDIT_CONFIRM : CREDIT_AGREE),
  )
  for (const r of list) if (!credits.has(r.userUid)) credits.set(r.userUid, CREDIT_AGREE)
  return { credits, disputed, resolved, winnerKey, winners }
}

// Score a single sailing's capacity reports.
// Returns { credits: Map<uid, number>, disputed, resolved, winner }.
//   disputed  — reports name more than one capacity value
//   resolved  — a clear winner is known (undisputed, or a strict plurality)
//   winner    — the winning capacity value (null only while disputed & tied)
export function scoreSailing(reports) {
  const list = latestPerUser(reports || [])
  const { credits, disputed, resolved, winnerKey } = creditsByPlurality(list, (r) => r.capacity)
  return { credits, disputed, resolved, winner: winnerKey }
}

// Score a single sailing's full-to-crosswalk marks — same credit model as
// capacity. Marks are timestamps, so exact equality is meaningless: each
// user's latest mark is bucketed into a CROSSWALK_BUCKET_MS window and buckets
// are compared like capacity values — different buckets disagree, a strict
// plurality resolves.
// Returns { credits, disputed, resolved, winners } — winners are the marks in
// the winning bucket, or every mark while undisputed/tied (so nothing
// disappears from the UI).
export const CROSSWALK_BUCKET_MS = 5 * 60 * 1000
export function scoreCrosswalk(reports, bucketMs = CROSSWALK_BUCKET_MS) {
  const list = latestPerUser(reports || [])
  const { credits, disputed, resolved, winners } = creditsByPlurality(list, (r) =>
    Math.round((r.crosswalkAt || 0) / bucketMs),
  )
  return { credits, disputed, resolved, winners: disputed && resolved ? winners : list }
}

// Aggregate flat lists of capacity reports and crosswalk marks (across many
// sailings) into one ranked reporter leaderboard. Both earn under the same
// credit model, scored per sailing. Returns
// [{ userUid, userName, userPhoto, credits, reportCount }] sorted by credits
// desc, then report count desc.
export function aggregateLeaderboard(reports, crosswalkReports = []) {
  const totals = new Map() // uid -> { userUid, userName, credits, reportCount }

  // Group one kind of report by sailingKey, score each sailing with scoreFn,
  // and fold each user's credit into the shared totals. Latest-per-user, so
  // each user counts once per sailing for both credit and report count; track
  // the newest userName we've seen for the display label.
  function fold(list, scoreFn) {
    const bySailing = new Map()
    for (const r of list || []) {
      if (!r || !r.userUid || !r.sailingKey) continue
      if (!bySailing.has(r.sailingKey)) bySailing.set(r.sailingKey, [])
      bySailing.get(r.sailingKey).push(r)
    }
    for (const sailingReports of bySailing.values()) {
      const { credits } = scoreFn(sailingReports)
      for (const r of latestPerUser(sailingReports)) {
        const entry = totals.get(r.userUid) || newEntry(r.userUid)
        entry.credits += credits.get(r.userUid) || 0
        entry.reportCount += 1
        applyIdentity(entry, r.recordedAt || 0, r.userName, r.userPhoto, r.anonymous)
        totals.set(r.userUid, entry)
      }
    }
  }

  fold(reports, scoreSailing)
  fold(crosswalkReports, scoreCrosswalk)

  return finalizeBoard(totals)
}

// Ride-share leaderboard. Offering a ride (a spare seat helps more people) is
// worth more than asking for one. Input is a flat list of
// { authorUid, authorName, authorPhoto, createdAt, type }, where type is
// 'offer' or 'request' (anything else defaults to the request credit). Returns
// the same entry shape as aggregateLeaderboard so both boards render
// identically. Riders with only a single post are excluded — the board
// rewards repeat participation.
export function aggregateRideLeaderboard(rides) {
  const totals = new Map() // uid -> entry (see newEntry)
  for (const r of rides || []) {
    if (!r || !r.authorUid) continue
    const entry = totals.get(r.authorUid) || newEntry(r.authorUid)
    entry.credits += r.type === 'offer' ? RIDE_OFFER_CREDIT : RIDE_REQUEST_CREDIT
    entry.reportCount += 1
    applyIdentity(entry, r.createdAt || 0, r.authorName, r.authorPhoto, r.anonymous)
    totals.set(r.authorUid, entry)
  }

  return finalizeBoard(totals).filter((e) => e.reportCount >= 2)
}

// --- Shared leaderboard-entry helpers (used by both boards) ---

function newEntry(userUid) {
  return {
    userUid,
    userName: null,
    userPhoto: null,
    anonymous: false,
    credits: 0,
    reportCount: 0,
    lastAt: -1, // newest activity, used as the tie-breaker
    _nameAt: -1,
    _photoAt: -1,
  }
}

// Fold one record's identity into an entry. Name and photo each keep the newest
// non-empty value independently. The `anonymous` flag and `lastAt` follow the
// single most-recent record (a fresh non-anonymous report un-hides the user).
function applyIdentity(entry, at, name, photo, anonymous) {
  if (name && at >= entry._nameAt) {
    entry.userName = name
    entry._nameAt = at
  }
  if (photo && at >= entry._photoAt) {
    entry.userPhoto = photo
    entry._photoAt = at
  }
  if (at >= entry.lastAt) {
    entry.lastAt = at
    entry.anonymous = !!anonymous
  }
}

// Ranked, credits desc, then report count desc, then most-recent activity desc.
function finalizeBoard(totals) {
  return [...totals.values()]
    .map((e) => ({
      userUid: e.userUid,
      userName: e.userName,
      userPhoto: e.userPhoto,
      anonymous: e.anonymous,
      credits: round1(e.credits),
      reportCount: e.reportCount,
      lastAt: e.lastAt,
    }))
    .sort(
      (a, b) =>
        b.credits - a.credits || b.reportCount - a.reportCount || b.lastAt - a.lastAt,
    )
}

// Round to 1 decimal, avoiding floating-point noise like 0.30000000000000004.
export function round1(n) {
  return Math.round(n * 10) / 10
}

// Display a reporter's name as first name + last initial:
//   "Tom Carchrae" -> "Tom C.", "Tom" -> "Tom", "tom@x.com" -> "tom".
// Falls back to "Anonymous" when no usable name is stored (legacy reports).
export function formatReporterName(name) {
  if (!name || typeof name !== 'string') return 'Anonymous'
  let n = name.trim()
  if (!n) return 'Anonymous'
  if (n.includes('@')) n = n.split('@')[0].trim() // email -> local part
  const parts = n.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'Anonymous'
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`
}
