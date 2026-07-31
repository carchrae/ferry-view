import { describe, it, expect } from 'vitest'
import { getBcHolidays, getImpactedDates, getHolidayContext } from '../lib/holidays.js'

describe('getBcHolidays', () => {
  it('computes 2026 holidays', () => {
    const holidays = getBcHolidays(2026)
    expect(holidays.get('2026-08-03')).toBe('BC Day') // 1st Monday of August
    expect(holidays.get('2026-07-01')).toBe('Canada Day')
    expect(holidays.get('2026-04-03')).toBe('Good Friday')
    expect(holidays.get('2026-04-06')).toBe('Easter Monday')
  })
})

describe('getImpactedDates', () => {
  it('bridges the weekend before a Monday holiday (BC Day 2026)', () => {
    const dates = getImpactedDates('2026-07-25', '2026-08-10')
    expect([...dates].sort()).toEqual([
      '2026-07-31', // Friday
      '2026-08-01', // Saturday
      '2026-08-02', // Sunday
      '2026-08-03', // BC Day (Monday)
      '2026-08-04', // Tuesday
    ])
  })

  it('uses a plain ±1 day window for a midweek holiday (Canada Day 2026, a Wednesday)', () => {
    const dates = getImpactedDates('2026-06-20', '2026-07-15')
    expect([...dates].sort()).toEqual(['2026-06-30', '2026-07-01', '2026-07-02'])
  })

  it('covers Thu-Tue across Good Friday and Easter Monday 2026', () => {
    const dates = getImpactedDates('2026-03-25', '2026-04-15')
    expect([...dates].sort()).toEqual([
      '2026-04-02', // Thursday before Good Friday
      '2026-04-03', // Good Friday
      '2026-04-04',
      '2026-04-05',
      '2026-04-06', // Easter Monday
      '2026-04-07', // Tuesday after Easter Monday
    ])
  })

  it("reaches back across the year boundary from a Monday New Year's Day", () => {
    // Jan 1 2024 is a Monday; its window starts Friday Dec 29 2023.
    const dates = getImpactedDates('2023-12-28', '2023-12-31')
    expect(dates.has('2023-12-29')).toBe(true)
    expect(dates.has('2023-12-30')).toBe(true)
    expect(dates.has('2023-12-31')).toBe(true)
    expect(dates.has('2023-12-28')).toBe(false) // Thursday, outside every window
  })
})

describe('getHolidayContext', () => {
  it('flags the Friday before a Monday holiday as impacted', () => {
    expect(getHolidayContext('2026-07-31')).toEqual({
      impacted: true,
      name: 'BC Day',
      onHoliday: false,
    })
  })

  it('flags the weekend and Tuesday around a Monday holiday', () => {
    expect(getHolidayContext('2026-08-01').impacted).toBe(true)
    expect(getHolidayContext('2026-08-02').impacted).toBe(true)
    expect(getHolidayContext('2026-08-04').impacted).toBe(true)
  })

  it('marks the holiday itself with onHoliday', () => {
    expect(getHolidayContext('2026-08-03')).toEqual({
      impacted: true,
      name: 'BC Day',
      onHoliday: true,
    })
  })

  it('does not over-reach beyond the window', () => {
    expect(getHolidayContext('2026-07-30').impacted).toBe(false) // Thursday before
    expect(getHolidayContext('2026-08-05').impacted).toBe(false) // Wednesday after
    expect(getHolidayContext('2026-07-22').impacted).toBe(false) // ordinary Wednesday
  })
})
