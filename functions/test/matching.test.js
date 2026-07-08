import { describe, it, expect } from 'vitest'
import { buildPast, buildUpcoming } from '../lib/matching.js'
import { timeToDate } from '../lib/time.js'

const at = (hhmm) => timeToDate(hhmm)

// Bowen schedule; in fallback mode we have no Departed events for the Bowen side
// (the BC Ferries scraper only recovers Horseshoe Bay departures).
const bowenSchedule = ['10:00', '11:15', '12:35', '13:55'].map((time) => ({ time }))

describe('matching fallback mode', () => {
  describe('buildPast', () => {
    it('marks unrecoverable past sailings as unknown ("?"), not skipped or late', () => {
      const recentActivity = [{ action: 'Departed', location: 'Bowen', time: '10:00' }]
      const past = buildPast(bowenSchedule, recentActivity, 'Bowen', at('13:58'), 'Bowen', true)

      const matched = past.find((e) => e.scheduledTime === '10:00')
      expect(matched._hasDep).toBe(true)

      const unknown = past.filter((e) => e.unknownDeparture)
      expect(unknown.map((e) => e.scheduledTime).sort()).toEqual(['11:15', '12:35', '13:55'])
      for (const e of unknown) {
        expect(e.diffText).toBe('?')
        expect(e.diffColor).toBe('grey')
        expect(e.skipped).toBeUndefined()
        expect(e._hasDep).toBe(false)
      }
    })

    it('non-fallback mode drops those trailing unmatched sailings (unchanged behavior)', () => {
      const recentActivity = [{ action: 'Departed', location: 'Bowen', time: '10:00' }]
      const past = buildPast(bowenSchedule, recentActivity, 'Bowen', at('13:58'), 'Bowen', false)
      expect(past.some((e) => e.unknownDeparture)).toBe(false)
      expect(past.map((e) => e.scheduledTime)).toEqual(['10:00'])
    })
  })

  describe('buildUpcoming', () => {
    it('drops every past-scheduled sailing in fallback mode (they move to past as "?")', () => {
      const upcoming = buildUpcoming(
        bowenSchedule,
        at('13:58'),
        at('13:59'),
        'Bowen',
        new Set(),
        null,
        false, // not sailing
        true, // fallback
      )
      // Only 13:55 is <= now among these; all past ones excluded, none remain here.
      expect(upcoming.map((e) => e.shortTime)).toEqual([])
    })

    it('still returns future sailings in fallback mode', () => {
      const schedule = ['12:35', '13:55', '15:15', '16:40'].map((time) => ({ time }))
      const upcoming = buildUpcoming(schedule, at('14:00'), at('14:01'), 'Bowen', new Set(), null, false, true)
      expect(upcoming.map((e) => e.shortTime)).toEqual(['15:15', '16:40'])
    })
  })
})

describe('dangerous cargo / repositioning sailings', () => {
  it('buildPast still matches and includes a dangerousCargo sailing (not silently dropped)', () => {
    const schedule = [
      { time: '10:00' },
      { time: '13:55', dangerousCargo: true },
    ]
    const recentActivity = [
      { action: 'Departed', location: 'Bowen', time: '10:00' },
      { action: 'Departed', location: 'Bowen', time: '13:55' },
    ]
    const past = buildPast(schedule, recentActivity, 'Bowen', at('14:00'), 'Bowen', false)
    const entry = past.find((e) => e.scheduledTime === '13:55')
    expect(entry).toBeDefined()
    expect(entry.dangerousCargo).toBe(true)
    expect(entry._hasDep).toBe(true)
  })

  it('buildUpcoming still includes a repositioning sailing', () => {
    const schedule = [
      { time: '13:55', repositioning: true },
      { time: '15:15' },
    ]
    const upcoming = buildUpcoming(schedule, at('12:00'), at('12:01'), 'HSB', new Set(), null, false, false)
    const entry = upcoming.find((e) => e.shortTime === '13:55')
    expect(entry).toBeDefined()
    expect(entry.repositioning).toBe(true)
  })
})
