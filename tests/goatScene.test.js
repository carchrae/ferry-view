import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { goatScene, H, BERTHS, CAR_CAPACITY, PED_CAPACITY } from '../src/components/goat-scene.js'

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
      const before = goatScene(h * H - 0.001)
      const after = goatScene(h * H + 0.001)
      assert.equal(ids(before.deck), ids(after.deck), `cars at arrival ${h}`)
      assert.equal(ids(before.riders), ids(after.riders), `walk-ons at arrival ${h}`)
    }
  })

  it('varies the load, never exceeds capacity, and sometimes leaves people behind', () => {
    const loads = new Set()
    let full = 0
    let mad = 0
    for (let h = 1; h < 60; h++) {
      const s = goatScene(h * H - 0.01)
      assert.ok(s.deck.length <= CAR_CAPACITY)
      assert.ok(s.riders.length <= PED_CAPACITY)
      loads.add(s.deck.length)
      if (s.deck.length === CAR_CAPACITY) full++
      if (goatScene((h - 1) * H + 4).peds.some((p) => p.mad)) mad++
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
})
