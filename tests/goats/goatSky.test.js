import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { skyAt, skyColors, wallMinutesToMs } from '../../src/components/goats/goat-sky.js'
import { isDarkAt } from '../../functions/lib/daylight.js'

// Simulated-clock minutes for a wall time at the terminal (see simClock).
const wall = (dateIso, hh, mm = 0) =>
  (Date.parse(`${dateIso}T00:00:00Z`) / 86400000) * 1440 + hh * 60 + mm

describe('goat sky', () => {
  it('turns wall time into the real moment, summer and winter', () => {
    assert.equal(wallMinutesToMs(wall('2026-08-20', 12)), Date.parse('2026-08-20T12:00:00-07:00'))
    assert.equal(wallMinutesToMs(wall('2026-12-21', 12)), Date.parse('2026-12-21T12:00:00-08:00'))
  })

  it('is dark exactly when the crosswalk camera says so', () => {
    for (const [d, hh, mm] of [
      ['2026-06-21', 21, 30],
      ['2026-06-21', 22, 30],
      ['2026-09-28', 19, 20],
      ['2026-09-28', 19, 50],
      ['2026-12-21', 7, 0],
    ]) {
      const ms = wallMinutesToMs(wall(d, hh, mm))
      assert.equal(skyAt(ms).dark, isDarkAt(ms), `${d} ${hh}:${mm}`)
    }
    // midsummer: still light at 9:30pm; late September: dark by then
    assert.equal(skyAt(wallMinutesToMs(wall('2026-06-21', 21, 30))).dark, false)
    assert.equal(skyAt(wallMinutesToMs(wall('2026-09-28', 21, 30))).dark, true)
  })

  it('night sky below deep twilight, full day high up, blended between', () => {
    assert.deepEqual(skyColors(-30, true), skyColors(-18, false))
    assert.deepEqual(skyColors(60, true), skyColors(30, false))
    assert.notDeepEqual(skyColors(-2, true), skyColors(-2, false)) // dawn pink vs sunset orange
    assert.match(skyColors(-5, true)[0], /^rgb\(/)
  })
})
