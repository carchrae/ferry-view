// Shared crosswalk-tag semantics. This module is the single source of truth
// for turning raw lineupReports into an effective crosswalk time and frame
// labels — the SAME code runs in the app's Cloud Function triggers
// (index.js) and in the training pipeline (scripts/export-lineup-dataset.mjs),
// so the classifier can never drift from what riders see in the UI.
//
// Kept free of native deps (no sharp) so the exporter can run it anywhere.

// A report counts only when it has an author and either a numeric mark or the
// notYet refute flag ("the lineup has NOT passed the crosswalk") — the same
// validity check the triggers and client loaders apply.
export function isValidLineupReport(r) {
  return Boolean(r && r.userUid && (typeof r.crosswalkAt === 'number' || r.notYet === true))
}

// The app's "latest wins" rule: of a sailing's valid reports (positive marks
// AND notYet refutes), the one most recently recorded defines the sailing's
// crosswalk state. Returns { at, notYet, recordedAt } or null when no valid
// report exists — at is null when the latest word is a refute.
export function effectiveCrosswalk(reports) {
  let latest = null
  for (const r of reports || []) {
    if (!isValidLineupReport(r)) continue
    if (!latest || (r.recordedAt || 0) > (latest.recordedAt || 0)) latest = r
  }
  if (!latest) return null
  return latest.notYet === true
    ? { at: null, notYet: true, recordedAt: latest.recordedAt || 0 }
    : { at: latest.crosswalkAt, notYet: false, recordedAt: latest.recordedAt || 0 }
}

// Numeric shortcut kept for the training exporter: the effective crosswalk
// time, or null when there is none — including when the latest word is a
// refute (a refuted sailing's frames stay unlabeled, never mislabeled).
export function effectiveCrosswalkAt(reports) {
  const eff = effectiveCrosswalk(reports)
  return eff && !eff.notYet ? eff.at : null
}

// Whether the robot may record its confirmed detection as the sailing's
// crosswalk report: only when no report exists AND no human "not yet" refute
// is fresher than the detection frame (the lineup can genuinely pass after an
// accurate refute, so a newer detection still counts).
export function robotMayFillCrosswalk(cur, detectionTs) {
  if (cur?.crosswalkFullAt != null) return false
  return cur?.crosswalkNotYetAt == null || detectionTs > cur.crosswalkNotYetAt
}

// --- Per-frame terminal labels (frameLabels collection) ----------------------
// Riders answer a FRAME question — "were cars waiting in this photo?" — which
// is what the terminal-cars classifier actually predicts. Capacity tags answer
// a SEQUENCE question ("did the ferry leave full?") and cannot say which frame
// was misread, so they can never supervise this model.
export function isValidFrameLabel(r) {
  return Boolean(r && r.userUid && typeof r.carsWaiting === 'boolean' && r.framePath)
}

// One frame's label from all reports about it: each rider's latest word counts
// once (re-labelling corrects, it doesn't stack), then the majority wins. A
// tie means the riders genuinely disagree, so the frame stays unlabeled rather
// than teaching the model a coin flip.
//
// Pass LIVE reports only — never the exporter's archive, where deleted labels
// are kept with `deleted: true` and would otherwise vote forever.
// Returns 1 (cars), 0 (no cars), or null.
export function effectiveFrameLabel(reports) {
  const latestByUser = new Map()
  for (const r of reports || []) {
    if (!isValidFrameLabel(r)) continue
    const prev = latestByUser.get(r.userUid)
    if (!prev || (r.recordedAt || 0) > (prev.recordedAt || 0)) latestByUser.set(r.userUid, r)
  }
  let cars = 0
  let empty = 0
  for (const r of latestByUser.values()) r.carsWaiting ? cars++ : empty++
  if (cars === empty) return null
  return cars > empty ? 1 : 0
}

// Label a timelapse frame from the effective crosswalk time: frames captured
// at or after it show a lineup that has reached the crosswalk.
export function labelForTimestamp(frameTs, crosswalkAt) {
  if (typeof frameTs !== 'number' || typeof crosswalkAt !== 'number') return null
  return frameTs >= crosswalkAt ? 1 : 0
}

// The sequence decision: the lineup "passed the crosswalk" at the ts of the
// first positive frame that is immediately confirmed by the next frame also
// being positive — a lone positive (glare, a passing truck) is noise, two in
// a row is a lineup. `frames` is capture-ordered [{ ts, positive }].
// Returns the first frame's ts, or null when never confirmed. The streaming
// equivalent in webcam.js (pending → confirm) must match this rule.
export function firstSustainedPositiveTs(frames) {
  for (let i = 0; i + 1 < (frames?.length || 0); i++) {
    if (frames[i].positive && frames[i + 1].positive) return frames[i].ts
  }
  return null
}

// Terminal-camera "ferry was not full" rule. `frames` is capture-ordered
// [{ ts, carsPresent }] from the departure timelapse. An empty terminal
// frame before departure means everyone waiting got on — the ferry left
// with room. Two safeguards:
//  - CONFIRMATION: a lone empty frame is noise (per-frame false-empty rate
//    was ~25% in the 2026-07 evaluation) — it takes two CONSECUTIVE empty
//    frames to count, mirroring firstSustainedPositiveTs.
//  - ONE-WAY: cars in the FINAL frames prove nothing (they may have arrived
//    past the cutoff), so a car-filled ending never negates an earlier
//    confirmed-empty pair.
//  - CARS FIRST, softened: a pair normally only counts after at least one
//    cars-present frame — a window that was empty from its very first frame
//    may have simply missed the loading (late capture start). EXCEPT when
//    the window is long: MIN_ALL_EMPTY_FRAMES observed-empty frames with no
//    cars ever is a genuinely quiet sailing (measured: all-empty windows of
//    10+ frames are tagged Not Full / 25% by riders, never Full; the two
//    shorter ones on record were degenerate).
//  - carsPresent === null means UNKNOWN (e.g. a dark frame): it breaks a
//    pair, never sets cars-seen, and doesn't count as observed.
// Returns the ts of the last frame of the last confirmed-empty pair, or
// null when never confirmed (inconclusive — NOT "full").
export const MIN_ALL_EMPTY_FRAMES = 10
export function terminalEmptyFrameTs(frames) {
  const list = frames || []
  const anyCars = list.some((f) => f?.carsPresent === true)
  const observedEmpty = list.filter((f) => f?.carsPresent === false).length
  let lastPair = null
  let lastPairAfterCars = null
  let carsSeen = false
  for (let i = 0; i + 1 < list.length; i++) {
    if (list[i]?.carsPresent === true) carsSeen = true
    if (
      list[i]?.carsPresent === false &&
      list[i + 1]?.carsPresent === false &&
      typeof list[i + 1].ts === 'number'
    ) {
      lastPair = list[i + 1].ts
      if (carsSeen) lastPairAfterCars = list[i + 1].ts
    }
  }
  if (lastPairAfterCars != null) return lastPairAfterCars
  if (!anyCars && observedEmpty >= MIN_ALL_EMPTY_FRAMES) return lastPair
  return null
}
