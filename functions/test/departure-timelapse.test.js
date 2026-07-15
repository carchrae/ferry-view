import { describe, it, expect } from 'vitest'
import { departureTimelapseDecision } from '../lib/webcam.js'
import { timeToDate } from '../lib/time.js'

const at = (hhmm) => timeToDate(hhmm)

// Arrival state defaults to "ferry docked at Bowen all along" (AIS level
// signal from early morning) so the schedule-window tests read like the ferry
// is waiting at the berth. Omit `arrival` entirely for degraded-mode tests.
function data(schedule, arrival = { aisLocation: 'Bowen', aisLocationSince: at('06:00').valueOf() }) {
  return { dateIso: '2026-07-13', bowenSchedule: schedule, ...arrival }
}

const dockedSince = (hhmm) => ({ aisLocation: 'Bowen', aisLocationSince: at(hhmm).valueOf() })

describe('departureTimelapseDecision', () => {
  const schedule = () => [{ time: '10:00' }, { time: '11:15' }, { time: '12:35' }]

  it('captures within 10 minutes before a departure when the ferry has arrived', () => {
    expect(departureTimelapseDecision(data(schedule()), at('09:50'))).toEqual({
      capture: true,
      sailingTime: '10:00',
    })
    // exactly at scheduled time, not yet departed
    expect(departureTimelapseDecision(data(schedule()), at('10:00')).sailingTime).toBe('10:00')
  })

  it('does not capture earlier than 10 minutes before, even with the ferry docked', () => {
    expect(departureTimelapseDecision(data(schedule()), at('09:49')).capture).toBe(false)
  })

  it('does not capture while the ferry has not arrived back (detection healthy)', () => {
    const d = data(schedule(), { aisLocation: 'transit' })
    expect(departureTimelapseDecision(d, at('09:55')).capture).toBe(false)
  })

  it('starts at arrival when the ferry is late: no frames before, frames after', () => {
    // Ferry docks at 10:05 for the 10:00 sailing.
    const late = () => data(schedule(), dockedSince('10:05'))
    expect(departureTimelapseDecision(data(schedule(), { aisLocation: 'transit' }), at('10:02')).capture).toBe(false)
    expect(departureTimelapseDecision(late(), at('10:06')).sailingTime).toBe('10:00')
  })

  it('captures a very late arrival the old T+20 cap would have suppressed', () => {
    const d = data(schedule(), dockedSince('10:25'))
    expect(departureTimelapseDecision(d, at('10:26')).sailingTime).toBe('10:00')
  })

  it('safety cap: stops 30 minutes after the effective start', () => {
    // Arrived early → effective start is T−10 (09:50); cap at 10:20.
    expect(departureTimelapseDecision(data(schedule()), at('10:20')).sailingTime).toBe('10:00')
    expect(departureTimelapseDecision(data(schedule()), at('10:21')).capture).toBe(false)
    // Arrived late (10:05) → cap runs from arrival instead.
    const late = data(schedule(), dockedSince('10:05'))
    expect(departureTimelapseDecision(late, at('10:35')).sailingTime).toBe('10:00')
    expect(departureTimelapseDecision(late, at('10:36')).capture).toBe(false)
  })

  it('never targets a sailing more than 60 minutes past schedule', () => {
    // A never-matched 10:00 ghost must not adopt the arrival that belongs to
    // the 14:05 sailing's cycle.
    const d = data([{ time: '10:00' }, { time: '14:05' }], dockedSince('13:55'))
    expect(departureTimelapseDecision(d, at('14:00'))).toEqual({
      capture: true,
      sailingTime: '14:05',
    })
  })

  it('stops once the sailing has departed (matchedDepartureTime set)', () => {
    const s = schedule()
    s[0].matchedDepartureTime = '10:03'
    // 10:04: 10:00 departed → excluded; 11:15 is >10 min away → no capture
    expect(departureTimelapseDecision(data(s), at('10:04')).capture).toBe(false)
  })

  it('targets the imminent sailing when in its window', () => {
    // 11:06 → within 10 min of 11:15, 10:00 long gone (>60 min stale)
    expect(departureTimelapseDecision(data(schedule()), at('11:06')).sailingTime).toBe('11:15')
  })

  it('no capture outside any window', () => {
    expect(departureTimelapseDecision(data(schedule()), at('10:40')).capture).toBe(false)
  })

  // No AIS classification and no Bowen events at all: arrivals are invisible,
  // so fall back to the legacy schedule-only window (T−10..T+20) rather than
  // never capturing during an AIS outage.
  describe('degraded mode (arrival undetectable)', () => {
    const blind = (s) => data(s, {})

    it('captures in the legacy window', () => {
      expect(departureTimelapseDecision(blind(schedule()), at('09:50')).sailingTime).toBe('10:00')
      expect(departureTimelapseDecision(blind(schedule()), at('10:12')).sailingTime).toBe('10:00')
    })

    it('keeps the legacy T+20 cap', () => {
      expect(departureTimelapseDecision(blind(schedule()), at('10:20')).sailingTime).toBe('10:00')
      expect(departureTimelapseDecision(blind(schedule()), at('10:21')).capture).toBe(false)
    })

    it('still respects the window opening', () => {
      expect(departureTimelapseDecision(blind(schedule()), at('09:49')).capture).toBe(false)
    })
  })
})
