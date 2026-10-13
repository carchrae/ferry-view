import { describe, it, expect } from 'vitest'
import { crosswalkRobotStep, MAX_GAP_MS } from '../lib/crosswalk-robot.js'
import { robotMayFillCrosswalk } from '../lib/lineup-labels.js'

const DELETE = '<<delete>>'
const MIN = 60 * 1000
const T0 = 1_800_000_000_000
const POS = { probability: 0.91, fullToCrosswalk: true }
const NEG = { probability: 0.12, fullToCrosswalk: false }

// Applies a step the way Firestore's merge would (DELETE removes the field).
function apply(cur, fields) {
  const next = { ...cur }
  for (const [k, v] of Object.entries(fields)) {
    if (v === DELETE) delete next[k]
    else next[k] = v
  }
  return next
}

// Feeds frames [{ t (minutes after T0), v, arrived? }] through the robot.
function run(frames, start = {}) {
  let cur = start
  const steps = []
  for (const { t, v, arrived } of frames) {
    const step = crosswalkRobotStep(cur, v, T0 + t * MIN, {
      arrived,
      mayFill: robotMayFillCrosswalk,
      DELETE,
      model: 7,
    })
    cur = apply(cur, step.fields)
    steps.push(step)
  }
  return { cur, steps }
}

describe('crosswalkRobotStep', () => {
  it('reports on the first positive frame, marked checking, and asks for a check photo', () => {
    const { cur, steps } = run([{ t: 0, v: POS }])
    expect(cur).toMatchObject({
      crosswalkFullAt: T0,
      crosswalkSource: 'robot',
      crosswalkChecking: true,
      crosswalkRobot: { state: 'checking', ts: T0, misses: 0 },
    })
    expect(cur.crosswalkFullAtAuto).toBeUndefined()
    expect(steps[0]).toMatchObject({ changed: true, check: true, event: { ev: 'report', at: T0 } })
    expect(steps[0].agg.set).toEqual({ cw: T0, cws: 'robot' })
  })

  it('confirms on a positive check photo, keeping the first frame as the time', () => {
    const { cur, steps } = run([
      { t: 0, v: POS },
      { t: 1, v: POS },
    ])
    expect(cur).toMatchObject({
      crosswalkFullAt: T0,
      crosswalkFullAtAuto: T0,
      crosswalkAutoProb: 0.91,
      crosswalkAutoModel: 7,
      crosswalkRobot: { state: 'on', ts: T0 },
    })
    expect(cur.crosswalkChecking).toBeUndefined()
    expect(steps[1]).toMatchObject({ changed: true, check: false, event: { ev: 'confirm' } })
    expect(steps[1].agg.set).toEqual({ cwa: T0, cwp: 0.91 })
  })

  it('takes one more photo after a miss, and confirms when it is positive', () => {
    const { cur, steps } = run([
      { t: 0, v: POS },
      { t: 1, v: NEG },
      { t: 2, v: POS },
    ])
    expect(steps[1]).toMatchObject({ check: true, changed: false, event: null })
    expect(cur).toMatchObject({ crosswalkFullAtAuto: T0, crosswalkRobot: { state: 'on' } })
  })

  it('withdraws its report after two misses', () => {
    const { cur, steps } = run([
      { t: 0, v: POS },
      { t: 1, v: NEG },
      { t: 2, v: NEG },
    ])
    expect(cur.crosswalkFullAt).toBeUndefined()
    expect(cur.crosswalkSource).toBeUndefined()
    expect(cur.crosswalkChecking).toBeUndefined()
    expect(cur.crosswalkRobot).toBeUndefined()
    expect(steps[2]).toMatchObject({ changed: true, check: false, event: { ev: 'withdraw' } })
    expect(steps[2].agg.clear).toEqual(['cw', 'cws'])
  })

  it('withdraws a confirmed call when the line shortens before the ferry is back', () => {
    const { cur, steps } = run([
      { t: 0, v: POS },
      { t: 1, v: POS },
      { t: 5, v: NEG },
      { t: 6, v: NEG },
    ])
    expect(steps[2]).toMatchObject({ check: true, changed: true, event: { ev: 'doubt' } })
    expect(cur.crosswalkFullAt).toBeUndefined()
    expect(cur.crosswalkFullAtAuto).toBeUndefined()
    expect(steps[3].agg.clear).toEqual(['cwa', 'cwp', 'cw', 'cws'])
  })

  it('shows a doubted call as checking, and clears that when it holds', () => {
    const { steps, cur } = run([
      { t: 0, v: POS },
      { t: 1, v: POS },
      { t: 5, v: NEG },
    ])
    expect(cur.crosswalkChecking).toBe(true)
    const next = run([{ t: 6, v: POS }], cur)
    expect(next.cur.crosswalkChecking).toBeUndefined()
    expect(next.cur.crosswalkFullAt).toBe(T0)
    expect(steps).toHaveLength(3)
  })

  it('reports a new time when the line passes again after a withdrawal', () => {
    const { cur } = run([
      { t: 0, v: POS },
      { t: 1, v: NEG },
      { t: 2, v: NEG },
      { t: 10, v: POS },
      { t: 11, v: POS },
    ])
    const t10 = T0 + 10 * MIN
    expect(cur).toMatchObject({ crosswalkFullAt: t10, crosswalkFullAtAuto: t10 })
  })

  it('ignores negative frames once the ferry is back, settling an open check', () => {
    const confirmed = run([
      { t: 0, v: POS },
      { t: 1, v: POS },
      { t: 5, v: NEG, arrived: true },
    ])
    expect(confirmed.steps[2]).toMatchObject({ event: null, check: false, changed: false })
    expect(confirmed.cur.crosswalkFullAt).toBe(T0)

    const open = run([
      { t: 0, v: POS },
      { t: 1, v: NEG, arrived: true },
    ])
    expect(open.cur).toMatchObject({ crosswalkFullAtAuto: T0, crosswalkRobot: { state: 'on' } })
    expect(open.cur.crosswalkChecking).toBeUndefined()
  })

  it('makes no new call once the ferry is back', () => {
    const { cur, steps } = run([{ t: 0, v: POS, arrived: true }])
    expect(cur).toEqual({})
    expect(steps[0].event).toBeNull()
  })

  it('restarts a check whose last frame is too old, moving its report', () => {
    const gap = MAX_GAP_MS / MIN + 1
    const { cur, steps } = run([
      { t: 0, v: POS },
      { t: gap, v: POS },
    ])
    expect(steps[1].event).toMatchObject({ ev: 'move', at: T0 + gap * MIN })
    expect(cur).toMatchObject({ crosswalkFullAt: T0 + gap * MIN, crosswalkRobot: { state: 'checking' } })
  })

  it('gives up a check whose last frame is too old on a negative', () => {
    const gap = MAX_GAP_MS / MIN + 1
    const { cur } = run([
      { t: 0, v: POS },
      { t: gap, v: NEG },
    ])
    expect(cur.crosswalkFullAt).toBeUndefined()
    expect(cur.crosswalkRobot).toBeUndefined()
  })

  it('never touches a rider mark, but still keeps its own call for scoring', () => {
    const rider = { crosswalkFullAt: T0 - 3 * MIN, crosswalkSource: 'user' }
    const { cur, steps } = run(
      [
        { t: 0, v: POS },
        { t: 1, v: POS },
        { t: 5, v: NEG },
        { t: 6, v: NEG },
      ],
      rider,
    )
    expect(steps.some((s) => s.changed)).toBe(false)
    expect(cur).toMatchObject(rider)
    expect(cur.crosswalkChecking).toBeUndefined()
    expect(steps.map((s) => s.event?.ev ?? null)).toEqual(['report', 'confirm', 'doubt', 'withdraw'])
  })

  it('does not report over a fresher rider "not yet"', () => {
    const { cur } = run([{ t: 0, v: POS }], { crosswalkNotYetAt: T0 + MIN })
    expect(cur.crosswalkFullAt).toBeUndefined()
    expect(cur.crosswalkRobot).toMatchObject({ state: 'checking' })
  })

  it('carries a pre-deploy pending over as an open check', () => {
    const { cur } = run([{ t: 5, v: POS }], { crosswalkAutoPending: { ts: T0, prob: 0.8 } })
    expect(cur).toMatchObject({ crosswalkFullAtAuto: T0, crosswalkFullAt: T0, crosswalkSource: 'robot' })
    expect(cur.crosswalkAutoPending).toBeUndefined()
  })

  it('does nothing without a verdict', () => {
    const step = crosswalkRobotStep({}, null, T0, { mayFill: robotMayFillCrosswalk, DELETE })
    expect(step).toMatchObject({ fields: {}, event: null, changed: false, check: false })
  })
})
