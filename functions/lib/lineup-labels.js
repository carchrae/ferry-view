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

// Terminal-camera "ferry left FULL" rule (2026-08-16). `frames` is
// capture-ordered [{ ts, p }] — raw probabilities, because full needs a
// stricter cut than the 0.5 cars/empty split: the last FULL_TAIL_FRAMES
// frames of the departure window must ALL read confidently cars
// (p >= FULL_CONFIDENT_P). Cars still waiting when the ferry leaves means
// somebody didn't get on. Callers must apply the crosswalk veto themselves
// (Tom's standing rule: the lineup never reaching the crosswalk vetoes any
// full claim) — the server reads the sailingStatus doc, the browser the
// sailing object, the trainer predictions.json; keeping the veto out of the
// pure rule keeps it testable. Measured (2026-08-16, 510 tagged sailings):
// with the crosswalk veto this scores 95.7% precision at 87% coverage of
// Full-tagged sailings; the handful of misses are riders' "10%" tags —
// nearly full, never "Not Full". NOT mutually exclusive with
// terminalEmptyFrameTs since the one-way empty-gap rule (2026-10-19): a
// lane can empty and then fill its last four frames with late arrivals.
// Not full wins — callers only consult this rule when terminalEmptyFrameTs
// returned null (the server likewise never stamps full over a not-full).
// Returns the LAST frame's ts, or null.
export const FULL_TAIL_FRAMES = 4
export const FULL_CONFIDENT_P = 0.7
export function terminalFullAtDeparture(frames) {
  const list = frames || []
  if (list.length < FULL_TAIL_FRAMES) return null
  const tail = list.slice(-FULL_TAIL_FRAMES)
  if (!tail.every((f) => typeof f?.p === 'number' && f.p >= FULL_CONFIDENT_P)) return null
  const lastTs = list[list.length - 1].ts
  return typeof lastTs === 'number' ? lastTs : null
}

// Terminal-camera "ferry was not full" EMPTY-GAP rule, one-way (2026-10-19,
// restoring the direction of the pre-2026-08-16 rule). `frames` is
// capture-ordered [{ ts, carsPresent }] from the departure timelapse. Once
// the lane has been seen loading and then reads empty on two consecutive
// frames, everyone who was waiting went aboard: the ferry had room. Vehicles
// that appear AFTER that gap are late arrivals — a car that rolls up a few
// minutes before (or as) the ferry leaves, after loading closed — and they
// never undo the verdict (Tom, 2026-10-19: the 05:15 that morning had three
// cars frames, two empties, and one late car on the departure frame, and the
// 2026-08-16 "tail" reading withdrew the Not Full it had already stamped).
//  - CONFIRMATION: a lone empty frame is noise (per-frame false-empty rate
//    was ~25% in the 2026-07 evaluation) — it takes two CONSECUTIVE empty
//    frames to count, mirroring firstSustainedPositiveTs.
//  - SOLID CARS: a cars frame only counts as loading when an adjacent frame
//    is also cars. An isolated single-frame "cars" blip between empties is
//    likelier a model false positive than a real queue: it breaks an empty
//    run but doesn't satisfy cars-first.
//  - CARS FIRST, softened: the pair only confirms after solid cars was seen
//    BEFORE it (a window empty from its very first frame may have missed
//    the loading) EXCEPT when the window is long: MIN_ALL_EMPTY_FRAMES
//    observed-empty frames with no solid cars yet is a genuinely quiet
//    sailing (measured: all-empty windows of 10+ frames are tagged Not
//    Full / 25% by riders, never Full).
//  - ONE-WAY: cars after the confirming pair — solid or not, right up to
//    the departure frame — prove nothing. The 2026-08-16 tail rule made
//    returning solid cars clear the verdict ("the empty window was
//    mid-sailing"); the archive replay in
//    docs/experiments/2026-10-19-empty-gap-one-way.md records what that
//    trade costs and buys.
//  - carsPresent === null means UNKNOWN (e.g. a dark frame): it breaks an
//    empty run, breaks cars solidity, and doesn't count as observed.
// Returns the ts of the CONFIRMING (second) frame of the FIRST qualifying
// empty pair — "everyone was aboard by then" — or null when never confirmed
// (inconclusive — NOT "full"). The streaming equivalent in webcam.js
// (pending → confirm, nothing ever clears a stamp) must match this rule.
// A not-full verdict outranks terminalFullAtDeparture on the same frames:
// callers evaluate the full rule only when this one returns null.
export const MIN_ALL_EMPTY_FRAMES = 10
export function terminalEmptyFrameTs(frames) {
  const list = frames || []
  const solid = (i) =>
    list[i]?.carsPresent === true &&
    (list[i - 1]?.carsPresent === true || list[i + 1]?.carsPresent === true)
  let carsSeen = false
  let observedEmpty = 0
  let run = 0
  for (let i = 0; i < list.length; i++) {
    const f = list[i]
    if (f?.carsPresent !== false) {
      run = 0
      if (solid(i)) carsSeen = true
      continue
    }
    observedEmpty++
    run++
    if (
      run >= 2 &&
      (carsSeen || observedEmpty >= MIN_ALL_EMPTY_FRAMES) &&
      typeof f.ts === 'number'
    ) {
      return f.ts
    }
  }
  return null
}
