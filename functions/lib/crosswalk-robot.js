// The lineup robot's live crosswalk call, one classified frame at a time.
// Pure (no Firestore/logger deps) so every transition is unit-testable; the
// caller (captureLineupTimelapse in webcam.js) applies the result.
//
// Riders want the call as soon as the robot sees it, but a lone positive
// frame is sometimes noise. So the robot reports on the FIRST positive frame
// and then checks itself with extra photos one minute apart (the regular
// cadence stays 5 minutes):
//
//   off      --positive-->  checking   report published at once, marked
//                                      "checking" (crosswalkChecking)
//   checking --positive-->  on         confirmed (crosswalkFullAtAuto)
//   checking --negative-->  checking   one miss: one more photo
//   checking --2nd miss-->  off        report withdrawn
//   on       --negative-->  doubt      the report stays, marked "checking"
//   doubt    --positive-->  on
//   doubt    --2nd miss-->  off        report withdrawn — the line really
//                                      shortened before the ferry came back
//
// Corrections stop once the ferry has arrived at Bowen: after that a shorter
// line is just loading, so a negative frame settles any open check in favour
// of the current call instead of counting as a miss.
//
// A check is only trusted when its frames are CONSECUTIVE: if the previous
// frame of an open check is older than MAX_GAP_MS (failed fetches, a stalled
// or dark camera), the frames in between are unknown — the check restarts
// from the current frame (positive) or gives up (negative).
//
// State lives on the sailingStatus doc as `crosswalkRobot`:
//   { state: 'checking'|'on'|'doubt', ts, prob, misses, lastTs }
// ts = first frame of the positive run (the reported crosswalk time),
// lastTs = the newest frame that fed the state. Absent = off.

export const MAX_GAP_MS = 7 * 60 * 1000
const MISSES_TO_WITHDRAW = 2

// Pre-deploy docs carry the old two-frame state: an unconfirmed
// crosswalkAutoPending (nothing was reported yet) or a confirmed
// crosswalkFullAtAuto.
function currentState(cur) {
  if (cur.crosswalkRobot) return cur.crosswalkRobot
  if (cur.crosswalkFullAtAuto != null) {
    return { state: 'on', ts: cur.crosswalkFullAtAuto, prob: cur.crosswalkAutoProb ?? null, misses: 0 }
  }
  if (cur.crosswalkAutoPending) {
    const p = cur.crosswalkAutoPending
    return { state: 'checking', ts: p.ts, prob: p.prob, misses: 0, lastTs: p.ts, legacy: true }
  }
  return null
}

// cur: the sailingStatus doc (or {}), verdict: { probability, fullToCrosswalk },
// ts: frame time (epoch ms), opts:
//   arrived  — the ferry is back at Bowen (no more corrections),
//   mayFill(cur, ts) — whether the robot may report at ts (no rider mark,
//                      no fresher rider "not yet"; robotMayFillCrosswalk),
//   DELETE   — the field-delete sentinel (FieldValue.delete()),
//   model    — classifier model version or null.
// Returns:
//   fields  — sailingStatus fields to merge (may be empty),
//   agg     — bowenSailings aggregate changes { set: {...}, clear: [...] },
//   event   — { ev: 'report'|'confirm'|'move'|'doubt'|'withdraw', at, frame, p }
//             or null — appended to the doc's crosswalkRobotLog,
//   changed — the rider-visible call changed (caller forces a status refresh),
//   check   — take another photo next minute.
export function crosswalkRobotStep(cur, verdict, ts, { arrived = false, mayFill, DELETE, model = null }) {
  const out = { fields: {}, agg: { set: {}, clear: [] }, event: null, changed: false, check: false }
  if (!verdict) return out
  const pos = verdict.fullToCrosswalk
  const prob = Math.round(verdict.probability * 1000) / 1000
  const s = currentState(cur)
  const robotReport = cur.crosswalkSource === 'robot' && cur.crosswalkFullAt != null
  const open = s && (s.state === 'checking' || s.state === 'doubt')
  const fresh = open && ts - (s.lastTs ?? s.ts) <= MAX_GAP_MS
  const f = out.fields
  const log = (ev, at) => {
    out.event = { ev, at, frame: ts, p: prob }
  }
  // Publishing (or re-stamping) the robot's report, when no rider owns it.
  const report = (at, checking) => {
    if (robotReport) {
      if (cur.crosswalkFullAt !== at) {
        f.crosswalkFullAt = at
        out.agg.set.cw = at
        out.changed = true
      }
    } else if (mayFill(cur, at)) {
      f.crosswalkFullAt = at
      f.crosswalkSource = 'robot'
      out.agg.set.cw = at
      out.agg.set.cws = 'robot'
      out.changed = true
    } else {
      return
    }
    if (checking && !cur.crosswalkChecking) {
      f.crosswalkChecking = true
      out.changed = true
    } else if (!checking && cur.crosswalkChecking) {
      f.crosswalkChecking = DELETE
      out.changed = true
    }
  }
  const confirm = (run) => {
    f.crosswalkRobot = { state: 'on', ts: run.ts, prob: run.prob, misses: 0, lastTs: ts }
    if (cur.crosswalkFullAtAuto !== run.ts) {
      f.crosswalkFullAtAuto = run.ts
      f.crosswalkAutoProb = run.prob
      if (model != null) f.crosswalkAutoModel = model
      out.agg.set.cwa = run.ts
      out.agg.set.cwp = run.prob
    }
    report(run.ts, false)
  }
  const withdraw = () => {
    f.crosswalkRobot = DELETE
    if (cur.crosswalkFullAtAuto != null) {
      f.crosswalkFullAtAuto = DELETE
      f.crosswalkAutoProb = DELETE
      f.crosswalkAutoModel = DELETE
      out.agg.clear.push('cwa', 'cwp')
    }
    if (robotReport) {
      f.crosswalkFullAt = DELETE
      f.crosswalkSource = DELETE
      out.agg.clear.push('cw', 'cws')
      out.changed = true
    }
    if (cur.crosswalkChecking) {
      f.crosswalkChecking = DELETE
      out.changed = true
    }
    log('withdraw', null)
  }
  const startCheck = () => {
    f.crosswalkRobot = { state: 'checking', ts, prob, misses: 0, lastTs: ts }
    report(ts, true)
    log(s?.state === 'checking' ? 'move' : 'report', ts)
    out.check = true
  }
  if (s?.legacy) f.crosswalkAutoPending = DELETE

  if (!s) {
    // No new calls once the ferry is loading: the lineup is on its way out.
    if (pos && !arrived) startCheck()
    return out
  }

  if (pos) {
    if (s.state === 'checking') {
      if (fresh) {
        confirm(s)
        log('confirm', s.ts)
      } else {
        startCheck()
      }
    } else if (s.state === 'doubt') {
      confirm(s)
      log('confirm', s.ts)
    } else {
      // Already on: just note the frame, so a later doubt measures its gap
      // from here.
      f.crosswalkRobot = { ...s, misses: 0, lastTs: ts }
    }
    return out
  }

  // Negative frame.
  if (arrived) {
    // The line drains onto the boat: settle an open check as it stands.
    if (open) {
      confirm(s)
      log('confirm', s.ts)
    }
    return out
  }
  if (s.state === 'on') {
    f.crosswalkRobot = { ...s, state: 'doubt', misses: 1, lastTs: ts }
    if (robotReport && !cur.crosswalkChecking) {
      f.crosswalkChecking = true
      out.changed = true
    }
    log('doubt', s.ts)
    out.check = true
    return out
  }
  // checking / doubt
  const misses = (s.misses || 0) + 1
  if (!fresh || misses >= MISSES_TO_WITHDRAW) {
    withdraw()
  } else {
    f.crosswalkRobot = { ...s, misses, lastTs: ts }
    delete f.crosswalkRobot.legacy
    out.check = true
  }
  return out
}
