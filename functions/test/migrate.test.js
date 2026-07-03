import { describe, it, expect } from 'vitest'
import { parseBadDate, parseBadKey, normalizeTime } from '../scripts/migrate-bad-sailing-keys.js'

describe('parseBadDate', () => {
  // Abbreviated months (the format the API started returning ~June 1 2026)
  it('parses abbreviated month with ordinal: "Friday Jul 3rd"', () => {
    expect(parseBadDate('Friday Jul 3rd', 2026)).toBe('2026-07-03')
  })

  it('parses abbreviated month with ordinal: "Monday Jun 1st"', () => {
    expect(parseBadDate('Monday Jun 1st', 2026)).toBe('2026-06-01')
  })

  it('parses abbreviated month with ordinal: "Monday Jun 29th"', () => {
    expect(parseBadDate('Monday Jun 29th', 2026)).toBe('2026-06-29')
  })

  it('parses abbreviated month with ordinal: "Wednesday May 20th"', () => {
    expect(parseBadDate('Wednesday May 20th', 2026)).toBe('2026-05-20')
  })

  it('parses abbreviated month with ordinal: "Tuesday Jun 2nd"', () => {
    expect(parseBadDate('Tuesday Jun 2nd', 2026)).toBe('2026-06-02')
  })

  it('parses abbreviated month with ordinal: "Thursday Jun 12th"', () => {
    expect(parseBadDate('Thursday Jun 12th', 2026)).toBe('2026-06-12')
  })

  // Full month names (old API format — should still work)
  it('parses full month name with ordinal: "Friday July 3rd"', () => {
    expect(parseBadDate('Friday July 3rd', 2026)).toBe('2026-07-03')
  })

  it('parses full month name without ordinal: "Friday July 3"', () => {
    expect(parseBadDate('Friday July 3', 2026)).toBe('2026-07-03')
  })

  it('parses full month name: "Monday June 1st"', () => {
    expect(parseBadDate('Monday June 1st', 2026)).toBe('2026-06-01')
  })

  // Edge cases
  it('returns null for already-ISO dates', () => {
    expect(parseBadDate('2026-07-03', 2026)).toBe(null)
  })

  it('returns null for empty string', () => {
    expect(parseBadDate('', 2026)).toBe(null)
  })

  it('returns null for garbage input', () => {
    expect(parseBadDate('not a date at all', 2026)).toBe(null)
  })

  it('uses provided year', () => {
    expect(parseBadDate('Friday Jul 3rd', 2025)).toBe('2025-07-03')
  })

  it('defaults to year 2026', () => {
    expect(parseBadDate('Monday Jun 1st')).toBe('2026-06-01')
  })
})

describe('normalizeTime', () => {
  it('passes through already-24h time', () => {
    expect(normalizeTime('04:40')).toBe('04:40')
    expect(normalizeTime('23:30')).toBe('23:30')
  })

  it('converts 12-hour AM times', () => {
    expect(normalizeTime('6:50 AM')).toBe('06:50')
    expect(normalizeTime('10:00 AM')).toBe('10:00')
    expect(normalizeTime('12:00 AM')).toBe('00:00') // midnight
  })

  it('converts 12-hour PM times', () => {
    expect(normalizeTime('1:10 PM')).toBe('13:10')
    expect(normalizeTime('3:55 PM')).toBe('15:55')
    expect(normalizeTime('12:00 PM')).toBe('12:00') // noon
  })

  it('returns null for null/empty', () => {
    expect(normalizeTime(null)).toBe(null)
    expect(normalizeTime('')).toBe(null)
  })

  it('returns null for unparseable string', () => {
    expect(normalizeTime('garbage')).toBe(null)
  })
})

describe('parseBadKey', () => {
  it('parses a bad sailingStatus key', () => {
    expect(parseBadKey('Friday Jul 3rd_04:40_To Bowen', 2026)).toEqual({
      dateIso: '2026-07-03',
      sailingTime: '04:40',
      direction: 'To Bowen',
    })
  })

  it('parses a key with "To HSB" direction', () => {
    expect(parseBadKey('Friday Jul 3rd_05:15_To HSB', 2026)).toEqual({
      dateIso: '2026-07-03',
      sailingTime: '05:15',
      direction: 'To HSB',
    })
  })

  it('parses a key with 23:30 sailing time', () => {
    expect(parseBadKey('Monday Jun 29th_23:30_To HSB', 2026)).toEqual({
      dateIso: '2026-06-29',
      sailingTime: '23:30',
      direction: 'To HSB',
    })
  })

  it('reconstructed key matches expected format', () => {
    const parsed = parseBadKey('Monday Jun 1st_11:55_To Bowen', 2026)
    const newKey = `${parsed.dateIso}_${parsed.sailingTime}_${parsed.direction}`
    expect(newKey).toBe('2026-06-01_11:55_To Bowen')
  })

  it('returns null for an already-correct key', () => {
    expect(parseBadKey('2026-07-03_04:40_To Bowen', 2026)).toBe(null)
  })

  it('returns null for a key with unparseable date', () => {
    expect(parseBadKey('garbage_04:40_To Bowen', 2026)).toBe(null)
  })

  it('returns null for malformed key (missing time/direction)', () => {
    expect(parseBadKey('Friday Jul 3rd', 2026)).toBe(null)
  })

  // Older May 18-21 records use 12-hour time format
  it('parses a key with 12-hour AM time', () => {
    expect(parseBadKey('Monday May 18th_10:00 AM_To HSB', 2026)).toEqual({
      dateIso: '2026-05-18',
      sailingTime: '10:00',
      direction: 'To HSB',
    })
  })

  it('parses a key with 12-hour PM time', () => {
    expect(parseBadKey('Wednesday May 20th_1:10 PM_To Bowen', 2026)).toEqual({
      dateIso: '2026-05-20',
      sailingTime: '13:10',
      direction: 'To Bowen',
    })
  })

  it('parses a key with 6:50 AM', () => {
    expect(parseBadKey('Monday May 18th_6:50 AM_To Bowen', 2026)).toEqual({
      dateIso: '2026-05-18',
      sailingTime: '06:50',
      direction: 'To Bowen',
    })
  })
})
