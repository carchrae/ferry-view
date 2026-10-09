import { describe, it, expect } from 'vitest'
import { logTimeToDate, timeToDate, isRecent } from '../lib/time.js'

describe('logTimeToDate', () => {
  it('binds a time earlier today to today', () => {
    const now = timeToDate('10:30')
    expect(logTimeToDate('10:12', now).isSame(timeToDate('10:12'))).toBe(true)
  })

  it('tolerates a few minutes of clock skew ahead of now', () => {
    const now = timeToDate('10:30')
    expect(logTimeToDate('10:33', now).isSame(timeToDate('10:33'))).toBe(true)
  })

  it('moves a time well ahead of now back to yesterday', () => {
    // 00:05: the log's "22:31" is last night's departure, not tonight's.
    const now = timeToDate('00:05')
    const t = logTimeToDate('22:31', now)
    expect(t.isSame(timeToDate('22:31').subtract(1, 'day'))).toBe(true)
    expect(t.isBefore(now)).toBe(true)
  })

  it('returns null for garbage', () => {
    expect(logTimeToDate('', timeToDate('10:00'))).toBeNull()
    expect(logTimeToDate('nope', timeToDate('10:00'))).toBeNull()
  })
})

describe('isRecent', () => {
  it('is false for a time that is only "recent" because it is last night\'s', () => {
    // Pick a wall-clock time 6 hours ahead of the real now: as a dateless log
    // time it resolves to yesterday, ~18 hours ago — not within 10 minutes.
    const ahead = timeToDate('00:00').add(
      (new Date().getUTCHours() + 24 - 7 + 6) % 24,
      'hour',
    )
    expect(isRecent(ahead.format('HH:mm'), 10 * 60 * 1000)).toBe(false)
  })
})
