import { describe, it, expect } from 'vitest'
import { shouldRun, STAGING_PROJECT_ID } from '../lib/control.js'

const NOW = 1_800_000_000_000

describe('shouldRun (staging cost switch)', () => {
  it('always runs outside the staging project', () => {
    expect(shouldRun('bowen-ferry', null, NOW)).toBe(true)
    expect(shouldRun('bowen-ferry', 0, NOW)).toBe(true)
    expect(shouldRun(null, NOW + 1000, NOW)).toBe(true)
  })

  it('runs on staging while activeUntil is in the future', () => {
    expect(shouldRun(STAGING_PROJECT_ID, NOW + 60_000, NOW)).toBe(true)
  })

  it('is dormant on staging when the flag is past, missing, or garbage', () => {
    expect(shouldRun(STAGING_PROJECT_ID, NOW - 1, NOW)).toBe(false)
    expect(shouldRun(STAGING_PROJECT_ID, NOW, NOW)).toBe(false) // boundary: expired
    expect(shouldRun(STAGING_PROJECT_ID, null, NOW)).toBe(false)
    expect(shouldRun(STAGING_PROJECT_ID, undefined, NOW)).toBe(false)
    expect(shouldRun(STAGING_PROJECT_ID, '2026-07-15', NOW)).toBe(false)
    expect(shouldRun(STAGING_PROJECT_ID, 0, NOW)).toBe(false) // the "off" value
  })
})
