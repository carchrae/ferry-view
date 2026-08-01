import { logger } from 'firebase-functions/logger'
import { FieldValue } from 'firebase-admin/firestore'
import { nowInVancouver } from './time.js'
import { upsertBowenSailing } from './bowen-sailings-aggregate.js'
import { isValidLineupReport, effectiveCrosswalk } from './lineup-labels.js'

// Applies lineupReports docs to their sailingStatus doc — the crosswalk
// analogue of user-capacity.js, extracted from the index.js triggers so the
// notYet-refute branching is unit-testable.
//
// Two report shapes share the collection (see schema.md):
//   positive mark:  { crosswalkAt: <epoch ms>, ... }  — "lineup passed at T"
//   notYet refute:  { crosswalkAt: null, notYet: true, ... } — "has NOT passed"
// A refute clears the sailing's crosswalk claim (whoever made it) and arms
// crosswalkNotYetAt, which blocks the robot from re-filling its own detection
// unless that detection is fresher than the refute (see robotMayFillCrosswalk).

const KEY_RE = /^(\d{4}-\d{2}-\d{2})_(.+)_(To\s.+)$/

// Applies a new lineup report (mark or refute). Returns true when the report
// is for today's date (caller should force a ferryStatus refresh), false
// otherwise (including no-ops).
export async function applyLineupReport(db, r) {
  if (!isValidLineupReport(r)) return false
  const m = KEY_RE.exec(r.sailingKey || '')
  if (!m) {
    logger.warn('Ignoring lineup report with malformed sailingKey:', r.sailingKey)
    return false
  }
  const [, dateIso, time, direction] = m
  const base = { sailingKey: r.sailingKey, sailingTime: time, direction, dateIso }
  const ref = db.collection('sailingStatus').doc(r.sailingKey)

  if (r.notYet === true) {
    // Human says the lineup has NOT passed: clear the claim (robot's or
    // another rider's) and arm the robot-refill guard. The robot's own
    // crosswalkFullAtAuto stays untouched for comparison.
    await ref.set(
      {
        ...base,
        crosswalkFullAt: FieldValue.delete(),
        crosswalkSource: FieldValue.delete(),
        crosswalkNotYetAt: r.recordedAt || Date.now(),
      },
      { merge: true },
    )
    if (direction === 'To HSB') {
      await upsertBowenSailing(db, { dateIso, sailingTime: time, clearKeys: ['cw', 'cws'] })
    }
  } else {
    await ref.set(
      {
        ...base,
        crosswalkFullAt: r.crosswalkAt,
        // Human marks always overwrite a robot-recorded crosswalk time; the
        // robot's own crosswalkFullAtAuto stays untouched for comparison.
        crosswalkSource: 'user',
        // A newer positive mark supersedes any earlier refute.
        crosswalkNotYetAt: FieldValue.delete(),
      },
      { merge: true },
    )
    if (direction === 'To HSB') {
      await upsertBowenSailing(db, { dateIso, sailingTime: time, cw: r.crosswalkAt, clearKeys: ['cws'] })
    }
  }

  return dateIso === nowInVancouver().format('YYYY-MM-DD')
}

// Re-derives a sailing's crosswalk state after a report deletion, from the
// reports that remain. Latest-wins: a remaining positive mark is stamped; a
// remaining refute keeps the claim cleared and the robot-refill guard armed
// (NO robot fallback while someone's word is "not yet"); with no reports left
// the classifier's confirmed time returns as the robot's claim, else the
// state clears entirely. Returns true when the sailing is today's.
export async function rederiveCrosswalkAfterDelete(db, sailingKey) {
  const m = KEY_RE.exec(sailingKey || '')
  if (!m) return false
  const [, dateIso, time, direction] = m
  const ref = db.collection('sailingStatus').doc(sailingKey)

  const snap = await db.collection('lineupReports').where('sailingKey', '==', sailingKey).get()
  const eff = effectiveCrosswalk(snap.docs.map((doc) => doc.data()))

  if (eff && !eff.notYet) {
    await ref.set(
      {
        crosswalkFullAt: eff.at,
        crosswalkSource: 'user',
        crosswalkNotYetAt: FieldValue.delete(),
      },
      { merge: true },
    )
    if (direction === 'To HSB') {
      await upsertBowenSailing(db, { dateIso, sailingTime: time, cw: eff.at, clearKeys: ['cws'] })
    }
  } else if (eff) {
    // Latest remaining word is a refute: stay cleared, keep the guard.
    await ref.set(
      {
        crosswalkFullAt: FieldValue.delete(),
        crosswalkSource: FieldValue.delete(),
        crosswalkNotYetAt: eff.recordedAt,
      },
      { merge: true },
    )
    if (direction === 'To HSB') {
      await upsertBowenSailing(db, { dateIso, sailingTime: time, clearKeys: ['cw', 'cws'] })
    }
  } else {
    // No human reports left — fall back to the classifier's confirmed
    // crosswalk time if it has one (the auto verdict is never deleted),
    // else clear the mark entirely.
    const cur = (await ref.get()).data()
    const autoAt = cur?.crosswalkFullAtAuto
    if (autoAt != null) {
      await ref.set(
        {
          crosswalkFullAt: autoAt,
          crosswalkSource: 'robot',
          crosswalkNotYetAt: FieldValue.delete(),
        },
        { merge: true },
      )
      if (direction === 'To HSB') {
        await upsertBowenSailing(db, { dateIso, sailingTime: time, cw: autoAt, cws: 'robot' })
      }
    } else {
      await ref.set(
        {
          crosswalkFullAt: FieldValue.delete(),
          crosswalkSource: FieldValue.delete(),
          crosswalkNotYetAt: FieldValue.delete(),
        },
        { merge: true },
      )
      if (direction === 'To HSB') {
        await upsertBowenSailing(db, { dateIso, sailingTime: time, clearKeys: ['cw', 'cws'] })
      }
    }
  }

  return dateIso === nowInVancouver().format('YYYY-MM-DD')
}
