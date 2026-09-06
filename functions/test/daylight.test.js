import { describe, it, expect } from 'vitest'
import { solarElevation, isDarkAt } from '../lib/daylight.js'

// Reference times for Bowen Island (America/Vancouver). Sunset Aug 3 2026 is
// ~20:53 PDT, civil twilight ends ~21:27; winter sunset mid-Dec is ~16:15.
const ts = (iso) => Date.parse(iso)

describe('daylight', () => {
  it('summer noon is bright, summer midnight is dark', () => {
    expect(solarElevation(ts('2026-08-03T13:00:00-07:00'))).toBeGreaterThan(50)
    expect(isDarkAt(ts('2026-08-03T13:00:00-07:00'))).toBe(false)
    expect(isDarkAt(ts('2026-08-03T23:59:00-07:00'))).toBe(true)
  })

  it('the 2026-08-03 21:30 sailing frames (21:39–21:57 PDT) count as dark', () => {
    expect(isDarkAt(ts('2026-08-03T21:39:00-07:00'))).toBe(true)
    expect(isDarkAt(ts('2026-08-03T21:57:00-07:00'))).toBe(true)
    // but the 20:25 sailing's frames around 20:49 are still civil twilight
    expect(isDarkAt(ts('2026-08-03T20:30:00-07:00'))).toBe(false)
  })

  it('winter evening sailings are dark, winter noon is not', () => {
    expect(isDarkAt(ts('2026-12-15T17:30:00-08:00'))).toBe(true)
    expect(isDarkAt(ts('2026-12-15T12:00:00-08:00'))).toBe(false)
  })

  // The formula pinned against a PUBLIC daylight table, so trusting it never
  // requires trusting the astronomy: these instants are published
  // sunrise/sunset and civil-twilight times for Snug Cove (49.38, -123.33)
  // from api.sunrise-sunset.org (fetched 2026-09-06), spanning equinox, both
  // solstices, and the DST change. At a published civil-twilight instant the
  // geometric elevation is -6° by definition (measured agreement: ±0.07°);
  // at published sunrise/sunset it is -0.833° (solar radius + refraction) —
  // the formula omits refraction, so the tolerance there is wider. Refraction
  // is irrelevant at the -7° gate this module exists for.
  it('matches the published Vancouver daylight table across the year', () => {
    const twilight = [
      '2026-06-22T05:06:42+00:00', // Jun civil dusk ends
      '2026-09-06T13:04:35+00:00', // Sep civil dawn begins
      '2026-12-22T00:54:23+00:00', // Dec civil dusk ends
    ]
    for (const iso of twilight) {
      expect(Math.abs(solarElevation(ts(iso)) - -6)).toBeLessThan(0.2)
    }
    const sunEdges = [
      '2026-03-20T14:13:28+00:00', // equinox sunrise
      '2026-06-21T12:05:11+00:00', // solstice sunrise
      '2026-09-23T02:12:57+00:00', // equinox sunset
      '2026-11-01T15:00:27+00:00', // Nov 1 sunrise (the former DST-end date)
      '2026-12-21T16:04:30+00:00', // solstice sunrise
    ]
    for (const iso of sunEdges) {
      expect(Math.abs(solarElevation(ts(iso)) - -0.833)).toBeLessThan(0.5)
    }
  })
})
