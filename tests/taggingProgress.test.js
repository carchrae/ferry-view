import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mergeFrameEvidence,
  isDecided,
  taggingProgress,
  progressLine,
  crosswalkProgress,
  impliedCrosswalk,
} from '../src/lib/tagging-progress.js'

// Frames one minute apart; scores keyed by path. `ps` is the robot's p per
// frame (null = unscored).
const frames = (n) => Array.from({ length: n }, (_, i) => ({ path: `f${i}`, ts: 1000 + i * 60000 }))
const scoresFrom = (ps) =>
  new Map(ps.map((p, i) => [`f${i}`, p]).filter(([, p]) => typeof p === 'number'))
const run = (ps, labels = {}, extra = {}) =>
  taggingProgress(frames(ps.length), { scores: scoresFrom(ps), labels, ...extra })

test('mergeFrameEvidence: human beats robot, unsure is unknown, unscored is null', () => {
  const seq = mergeFrameEvidence(frames(4), scoresFrom([0.9, 0.42, 0.1, null]), { f0: false })
  assert.deepEqual(
    seq.map((f) => [f.source, f.carsPresent, f.p, f.band]),
    [
      ['human', false, 0, 'empty'],
      ['robot', null, 0.42, 'unsure'],
      ['robot', false, 0.1, 'empty'],
      [null, null, null, null],
    ],
  )
  // A score object with its own band is taken as given.
  const withBand = mergeFrameEvidence(frames(1), new Map([['f0', { p: 0.6, band: 'cars' }]]))
  assert.equal(withBand[0].carsPresent, true)
})

test('isDecided: human, confident empty, confident cars — but not weak cars or unsure', () => {
  assert.equal(isDecided({ source: 'human', p: 0 }), true)
  assert.equal(isDecided({ source: 'robot', band: 'empty', p: 0.1 }), true)
  assert.equal(isDecided({ source: 'robot', band: 'cars', p: 0.9 }), true)
  assert.equal(isDecided({ source: 'robot', band: 'cars', p: 0.6 }), false)
  assert.equal(isDecided({ source: 'robot', band: 'unsure', p: 0.42 }), false)
  assert.equal(isDecided({ source: null, p: null }), false)
})

test('confident not-full: empties after solid cars decide with nothing needed', () => {
  const p = run([0.9, 0.9, 0.9, 0.1, 0.1])
  assert.equal(p.verdict, 'notFull')
  assert.equal(p.verdictTs, 1000 + 4 * 60000)
  assert.deepEqual(p.needed, [])
  assert.equal(p.enough, true)
  assert.equal(p.labelled, 0)
})

test('full needs the crosswalk: vetoed without it, full with it', () => {
  const ps = [0.9, 0.9, 0.9, 0.9, 0.9]
  const vetoed = run(ps)
  assert.equal(vetoed.verdict, null)
  assert.equal(vetoed.vetoed, true)
  assert.deepEqual(vetoed.needed, [])
  assert.equal(vetoed.enough, true)
  const full = run(ps, {}, { crosswalkOk: true })
  assert.equal(full.verdict, 'full')
  assert.equal(full.verdictTs, 1000 + 4 * 60000)
})

test('needed = the undecided tail frames only, latest first', () => {
  const p = run([0.9, 0.9, 0.42, 0.9, 0.9, 0.42, 0.9])
  // Tail is indices 3..6; only index 5 is undecided. Index 2 is unsure but
  // outside the tail → optional.
  assert.deepEqual(p.needed, [5])
  assert.deepEqual(p.unsure, [2])
  assert.equal(p.walkOrder[0], 5)
  assert.equal(p.enough, false)
})

test('a human answer overrides the robot and can flip the verdict', () => {
  const ps = [0.9, 0.9, 0.9, 0.42, 0.9]
  assert.equal(run(ps).verdict, null)
  // Saying the unsure frame was empty isn't enough on its own (lone empty,
  // and the robot still sees cars on the departure frame).
  const one = run(ps, { f3: false })
  assert.equal(one.verdict, null)
  assert.deepEqual(one.needed, [])
  assert.equal(one.enough, true)
  // Labelling the last frame empty too makes a confirmed empty tail.
  const two = run(ps, { f3: false, f4: false })
  assert.equal(two.verdict, 'notFull')
  assert.equal(two.verdictTs, 1000 + 4 * 60000)
  assert.equal(two.labelled, 2)
  assert.equal(two.decidedBy, 'human')
})

test('a rider\'s answer on the departure frame decides: cars → full (no veto), empty pair → not full', () => {
  // Mixed tail the robot's rules can't call: cars at departure but not four in a row.
  const mixed = [0.9, 0.9, 0.1, 0.9, 0.9]
  const m = run(mixed)
  assert.equal(m.verdict, null)
  assert.equal(m.reason, 'mixed')
  const full = run(mixed, { f4: true }, { crosswalkOk: true })
  assert.equal(full.verdict, 'full')
  assert.equal(full.vetoed, false)
  assert.equal(full.decidedBy, 'human')
  assert.equal(full.reason, 'human-cars-last')
  // Without the crosswalk the cars probably rolled up late: no verdict, the
  // rider is asked to confirm.
  const late = run(mixed, { f4: true })
  assert.equal(late.verdict, null)
  assert.equal(late.vetoed, true)
  assert.equal(late.reason, 'human-cars-last-noxwalk')
  assert.equal(late.decidedBy, 'human')
  assert.equal(late.enough, true)
  // Late arrivals settled by the rider: four empties by their hand, then
  // three cars frames to departure, no lineup to the crosswalk (the 1:55pm
  // on 2026-10-18) — the lot had cleared before those cars came, so not full.
  const lateRun = [0.16, 0.15, 0.16, 0.16, 0.98, 0.98, 0.98]
  const settled = run(lateRun, { f1: false, f2: false, f3: false, f4: true, f5: true, f6: true })
  assert.equal(settled.verdict, 'notFull')
  assert.equal(settled.reason, 'human-late-arrivals')
  assert.equal(settled.decidedBy, 'human')
  assert.equal(settled.verdictTs, frames(7)[3].ts)
  assert.equal(settled.vetoed, false)
  assert.deepEqual(settled.needed, [])
  // The robot's cars on the run count too: the rider need only empty the
  // frame before it and confirm the departure frame.
  assert.equal(run(lateRun, { f3: false, f6: true }).reason, 'human-late-arrivals')
  // With the crosswalk reached, the same tags still mean full.
  assert.equal(run(lateRun, { f3: false, f6: true }, { crosswalkOk: true }).verdict, 'full')
  // The robot's empty before the run is not enough: the question stands and
  // that frame is the one to ask about.
  const robotEmpty = run(lateRun, { f6: true })
  assert.equal(robotEmpty.reason, 'human-cars-last-noxwalk')
  assert.deepEqual(robotEmpty.needed, [3])
  assert.equal(robotEmpty.walkOrder[0], 3)
  assert.equal(robotEmpty.enough, true)
  // An unsure frame between the rider's empty and the cars breaks the run.
  const gap = run([0.16, 0.16, 0.45, 0.98, 0.98], { f1: false, f4: true })
  assert.equal(gap.reason, 'human-cars-last-noxwalk')
  assert.deepEqual(gap.needed, [2])
  // The robot calls this one not-full (loading seen, then an empty gap);
  // a rider saying cars WERE waiting on the last frame wins only with the
  // crosswalk reached. Without it those cars are the late arrivals the gap
  // predicts, so the robot's verdict stands (one-way rule, 2026-10-19).
  const blip = [0.9, 0.9, 0.1, 0.1, 0.9]
  assert.equal(run(blip).verdict, 'notFull')
  assert.equal(run(blip).reason, 'robot-empty-pair')
  assert.equal(run(blip, { f4: true }, { crosswalkOk: true }).verdict, 'full')
  const lateCar = run(blip, { f4: true })
  assert.equal(lateCar.verdict, 'notFull')
  assert.equal(lateCar.reason, 'robot-empty-pair')
  assert.equal(lateCar.verdictTs, frames(5)[3].ts)
  assert.equal(lateCar.vetoed, false)
  assert.deepEqual(lateCar.needed, [])
  // Same shape as the 05:15 on 2026-10-19: three cars frames, empties, a
  // late car on the departure frame — decided not full by the robot alone.
  const morning = run([0.99, 0.99, 0.99, 0.05, 0.04, 0.64, 0.04, 0.36, 0.05, 0.92, 0.78])
  assert.equal(morning.verdict, 'notFull')
  assert.equal(morning.verdictTs, frames(11)[4].ts)
  assert.equal(morning.decidedBy, 'robot')
  // Same when the rider says the last frame was empty and the one before was empty too.
  const quiet = run([0.1, 0.1, 0.1], { f2: false })
  assert.equal(quiet.verdict, 'notFull')
  assert.equal(quiet.decidedBy, 'human')
  assert.equal(quiet.reason, 'human-empty-pair')
  // A lone human "empty" at the end after cars isn't confirmed.
  assert.equal(run([0.9, 0.9, 0.9, 0.9], { f3: false }).verdict, null)
  // The robot deciding alone is marked as such.
  assert.equal(run([0.9, 0.9, 0.9, 0.1, 0.1]).decidedBy, 'robot')
  const rf = run([0.9, 0.9, 0.9, 0.9, 0.9], {}, { crosswalkOk: true })
  assert.equal(rf.reason, 'robot-cars-tail')
  assert.equal(run([0.9, 0.9, 0.9, 0.9, 0.9]).reason, 'vetoed')
})

test('a human "cars" counts as p=1 and unlocks a full verdict blocked by weak cars', () => {
  const ps = [0.9, 0.6, 0.9, 0.9, 0.9]
  const before = run(ps, {}, { crosswalkOk: true })
  assert.equal(before.verdict, null)
  assert.deepEqual(before.needed, [1])
  const after = run(ps, { f1: true }, { crosswalkOk: true })
  assert.equal(after.verdict, 'full')
})

test('unscored frames: in the tail they are needed, earlier they are just unlabelled', () => {
  const p = run([null, 0.9, 0.9, 0.9, null, 0.9])
  assert.deepEqual(p.needed, [4])
  assert.deepEqual(p.unsure, [])
  assert.ok(p.walkOrder.includes(0))
  assert.equal(p.walkOrder[0], 4)
})

test('walkOrder covers every unlabelled frame exactly once, latest first per bucket', () => {
  const p = run([0.42, 0.9, 0.1, 0.42, 0.9, 0.42, 0.9, 0.42], { f6: true })
  const unlabelled = [0, 1, 2, 3, 4, 5, 7]
  assert.deepEqual([...p.walkOrder].sort((a, b) => a - b), unlabelled)
  assert.equal(new Set(p.walkOrder).size, p.walkOrder.length)
  // needed: tail 4..7 undecided & unlabelled → 7, 5 (latest first)
  assert.deepEqual(p.needed, [7, 5])
  // then the remaining unsure, latest first
  assert.deepEqual(p.unsure, [3, 0])
  // then the rest
  assert.deepEqual(p.walkOrder.slice(4), [4, 2, 1])
})

test('short all-empty window: no verdict, nothing needed, enough to ask an opinion', () => {
  const p = run([0.1, 0.1, 0.1, 0.1, 0.1])
  assert.equal(p.verdict, null)
  assert.equal(p.vetoed, false)
  assert.deepEqual(p.needed, [])
  assert.equal(p.enough, true)
})

test('prior labels (a Map) count as labelled and override robot scores', () => {
  const labels = new Map([
    ['f3', false],
    ['f4', false],
  ])
  const p = run([0.9, 0.9, 0.9, 0.9, 0.9], labels)
  assert.equal(p.labelled, 2)
  assert.equal(p.verdict, 'notFull')
})

test('progressLine copy', () => {
  const pending = run([null, null, null, null, null])
  assert.equal(progressLine(pending, { scoresReady: false }), '0 of 5 frames tagged — robot is scoring the frames…')
  assert.equal(progressLine(run([0.9, 0.9, 0.42, 0.9, 0.9, 0.42, 0.42])), '0 of 7 frames tagged — 2 more to decide')
  assert.equal(progressLine(run([0.9, 0.9, 0.9, 0.42, 0.9])), '0 of 5 frames tagged — 1 more to decide')
  assert.equal(progressLine(run([0.9, 0.9, 0.9, 0.1, 0.1], { f0: true })), '1 of 5 frames tagged — enough to decide')
  assert.equal(
    progressLine(run([0.42, 0.9, 0.9, 0.9, 0.1, 0.9])),
    '0 of 6 frames tagged — tail done; 1 more the robot is unsure about (optional)',
  )
  assert.equal(progressLine(run([0.9, 0.9, 0.9, 0.1, 0.9])), '0 of 5 frames tagged')
})

test('crosswalkProgress: first yes after a no pins the crossing', () => {
  const p = crosswalkProgress(frames(5), { f1: false, f2: true, f3: true })
  assert.equal(p.verdict, 'at')
  assert.equal(p.crossingTs, 1000 + 2 * 60000)
  assert.equal(p.reason, 'pinned')
  assert.equal(p.decidedBy, 'human')
  assert.deepEqual(p.needed, [])
  assert.equal(p.enough, true)
  assert.equal(p.labelled, 3)
})

test('crosswalkProgress: a yes on the earliest frame decides; a yes with an untagged frame before needs it', () => {
  const first = crosswalkProgress(frames(4), { f0: true })
  assert.equal(first.verdict, 'at')
  assert.equal(first.reason, 'first-frame')
  const gap = crosswalkProgress(frames(5), { f3: true })
  assert.equal(gap.verdict, null)
  assert.deepEqual(gap.needed, [2])
  assert.equal(gap.reason, 'need-before')
  assert.equal(gap.walkOrder[0], 2)
  assert.equal(gap.enough, false)
  // The earliest yes wins even when later frames were tagged first.
  const later = crosswalkProgress(frames(5), { f4: true, f1: false, f2: true })
  assert.equal(later.crossingTs, 1000 + 2 * 60000)
})

test('crosswalkProgress: only noes — decided by a no on the last frame, else that frame is needed', () => {
  const notYet = crosswalkProgress(frames(4), { f1: false, f3: false })
  assert.equal(notYet.verdict, 'notYet')
  assert.equal(notYet.reason, 'last-no')
  assert.equal(notYet.crossingTs, null)
  const open = crosswalkProgress(frames(4), { f1: false })
  assert.equal(open.verdict, null)
  assert.deepEqual(open.needed, [3])
  assert.equal(open.reason, 'need-last')
  const nothing = crosswalkProgress(frames(4), {})
  assert.equal(nothing.reason, null)
  assert.deepEqual(nothing.needed, [])
  assert.deepEqual(nothing.walkOrder, [3, 2, 1, 0])
  // progressLine copy is shared with the fullness dialog.
  assert.equal(progressLine(open), '1 of 4 frames tagged — 1 more to decide')
  assert.equal(progressLine(notYet), '2 of 4 frames tagged — enough to decide')
})

test('impliedCrosswalk: a pinned crossing implies not-yet before it and at-crosswalk from it on', () => {
  const p = crosswalkProgress(frames(5), { f1: false, f2: true })
  assert.equal(p.verdict, 'at')
  const ts = (i) => 1000 + i * 60000
  assert.equal(impliedCrosswalk(p, ts(0)), false)
  // The rider's own answers imply nothing — they are answers.
  assert.equal(impliedCrosswalk(p, ts(1)), null)
  assert.equal(impliedCrosswalk(p, ts(2)), null)
  assert.equal(impliedCrosswalk(p, ts(3)), true)
  assert.equal(impliedCrosswalk(p, ts(4)), true)
})

test('impliedCrosswalk: a No on the last frame implies not-yet on every earlier frame; nothing without a verdict', () => {
  const notYet = crosswalkProgress(frames(4), { f3: false })
  assert.equal(notYet.verdict, 'notYet')
  assert.equal(impliedCrosswalk(notYet, 1000), false)
  assert.equal(impliedCrosswalk(notYet, 1000 + 2 * 60000), false)
  assert.equal(impliedCrosswalk(notYet, 1000 + 3 * 60000), null)
  const open = crosswalkProgress(frames(4), { f1: false })
  assert.equal(impliedCrosswalk(open, 1000), null)
  assert.equal(impliedCrosswalk(null, 1000), null)
  assert.equal(impliedCrosswalk(notYet, undefined), null)
})
