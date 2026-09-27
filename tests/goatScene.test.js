import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  goatScene,
  createGoatScene,
  seasonSampler,
  halfStart,
  breaksDown,
  whaleCrossing,
  rampJams,
  H,
  BERTHS,
  CAR_CAPACITY,
  PED_CAPACITY,
} from '../src/components/goat-scene.js'

const ids = (list) =>
  list
    .map((d) => d.id)
    .sort()
    .join(' ')

describe('goatScene', () => {
  it('berths at a dock, then crosses to the other one', () => {
    assert.equal(goatScene(0.5).ferryX, BERTHS[0])
    assert.equal(goatScene(H + 0.5).ferryX, BERTHS[1])
    const mid = goatScene(H - 1.4).ferryX
    assert.ok(mid > BERTHS[0] && mid < BERTHS[1])
  })

  it('everyone who boards gets off at the other side', () => {
    for (let h = 1; h < 40; h++) {
      const before = goatScene(halfStart(h) - 0.001)
      const after = goatScene(halfStart(h) + 0.001)
      assert.equal(ids(before.deck), ids(after.deck), `cars at arrival ${h}`)
      assert.equal(ids(before.riders), ids(after.riders), `walk-ons at arrival ${h}`)
    }
  })

  it('varies the load, never exceeds capacity, and sometimes leaves people behind', () => {
    const loads = new Set()
    let full = 0
    let mad = 0
    for (let h = 1; h < 60; h++) {
      const s = goatScene(halfStart(h + 1) - 0.01)
      assert.ok(s.deck.length <= CAR_CAPACITY)
      assert.ok(s.riders.length <= PED_CAPACITY)
      loads.add(s.deck.length)
      if (s.deck.length === CAR_CAPACITY) full++
      if (goatScene(halfStart(h) + 4).peds.some((p) => p.mad)) mad++
    }
    assert.ok(loads.size >= 4, `loads seen: ${[...loads]}`)
    assert.ok(full > 0 && full < 59, `full sailings: ${full}`)
    assert.ok(mad > 0 && mad < 59, `visits with walk-ons left behind: ${mad}`)
  })

  it('never renders the same car or person twice in a frame', () => {
    for (let t = 0; t < 120; t += 0.25) {
      const s = goatScene(t)
      for (const list of [s.carsIn, s.carsOut, s.deck, s.peds, s.riders]) {
        assert.equal(new Set(list.map((x) => x.id)).size, list.length, `t=${t}`)
      }
    }
  })

  it('a breakdown at sea stalls the ferry mid-channel, smoking, with confused riders', () => {
    const h = [...Array(40).keys()].find((i) => breaksDown(i) && !rampJams(i))
    let stalled = null
    let stallT = null
    for (let t = halfStart(h); t < halfStart(h + 1); t += 0.05) {
      const s = goatScene(t)
      if (s.stalled) {
        stalled = s
        stallT = t
        break
      }
    }
    assert.ok(stalled, `half ${h} should stall`)
    assert.ok(stalled.ferryX > Math.min(...BERTHS) && stalled.ferryX < Math.max(...BERTHS))
    const mid = goatScene(stallT + 1)
    assert.ok(mid.stalled && mid.smoke.length > 0, 'smoking while stalled')
    assert.equal(mid.ferryX, stalled.ferryX, 'not moving while stalled')
    assert.ok(stalled.riders.every((r) => r.confused))
    // …and it still arrives at the other dock
    assert.equal(goatScene(halfStart(h + 1) + 0.5).ferryX, BERTHS[(h + 1) % 2])
  })

  it('a jammed ramp flaps and holds up unloading on arrival', () => {
    const h = [...Array(40).keys()].find((i) => rampJams(i))
    const early = goatScene(halfStart(h) + 1)
    const later = goatScene(halfStart(h) + 1.2)
    const side = h % 2
    assert.notEqual(early.ramps[side], later.ramps[side]) // flapping
    assert.equal(early.carsOut.length, 0) // nobody has driven off yet
    assert.ok(early.smoke.length > 0)
  })

  it('season sampler replays real loads: a Full sailing overflows the ferry', () => {
    const docs = []
    for (let i = 0; i < 8; i++) {
      const time = `${String(7 + i).padStart(2, '0')}:00`
      docs.push({
        dateIso: '2026-08-02',
        sailingTime: time,
        direction: 'To HSB',
        lastCapacity: 'Full',
      })
      docs.push({
        dateIso: '2026-08-02',
        sailingTime: time,
        direction: 'To Bowen',
        lastCapacity: '90%',
      })
    }
    const sampler = seasonSampler(docs, () => 0)
    assert.equal(sampler.dateIso, '2026-08-02')
    assert.deepEqual(sampler.sailing(0), {
      dateIso: '2026-08-02',
      time: '07:00',
      direction: 'To HSB',
      capacity: 'Full',
    })
    assert.equal(sampler.load(0), 'full')
    assert.ok(Math.abs(sampler.load(1) - 0.1) < 1e-9) // 90% space left = 10% full
    const scene = createGoatScene({ sampler })
    // Bowen sailings are all Full: the ferry leaves Bowen with every spot taken
    assert.equal(scene(halfStart(2) + 3.9).deck.length, CAR_CAPACITY)
    assert.equal(scene(halfStart(2) + 3.9).sailing.capacity, 'Full')
  })

  it('season sampler needs a day with enough capacity data', () => {
    assert.equal(seasonSampler([{ dateIso: 'x', sailingTime: '07:00', direction: 'To HSB' }]), null)
  })

  it('on a whale crossing the ferry stops just short of the tail, then carries on', () => {
    const h = [...Array(40).keys()].find((i) => whaleCrossing(i) && !breaksDown(i))
    const seen = []
    for (let t = halfStart(h); t < halfStart(h + 1); t += 0.05) {
      const s = goatScene(t)
      if (s.whale) seen.push(s)
    }
    assert.ok(seen.length > 20, 'whale visible for a while')
    const dir = Math.sign(BERTHS[(h + 1) % 2] - BERTHS[h % 2])
    for (const s of seen) {
      const gap = (s.whale.x - s.ferryX) * dir
      assert.ok(gap > 66 && gap < 140, `whale just ahead of the bow (gap ${gap})`)
      assert.equal(s.ferryX, seen[0].ferryX, 'ferry waits while the whale is up')
    }
    assert.equal(goatScene(halfStart(h + 1) + 0.5).ferryX, BERTHS[(h + 1) % 2])
  })
})
