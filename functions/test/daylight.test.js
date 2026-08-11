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
})
