import { describe, it, expect } from 'vitest'
import { departureTimelapseDecision } from '../lib/webcam.js'
import { timeToDate } from '../lib/time.js'

const at = (hhmm) => timeToDate(hhmm)

function data(schedule) {
  return { dateIso: '2026-07-13', bowenSchedule: schedule }
}

describe('departureTimelapseDecision', () => {
  const schedule = () => [{ time: '10:00' }, { time: '11:15' }, { time: '12:35' }]

  it('captures within 10 minutes before a departure', () => {
    expect(departureTimelapseDecision(data(schedule()), at('09:50'))).toEqual({
      capture: true,
      sailingTime: '10:00',
    })
    // exactly at scheduled time, not yet departed
    expect(departureTimelapseDecision(data(schedule()), at('10:00')).sailingTime).toBe('10:00')
  })

  it('does not capture earlier than 10 minutes before', () => {
    expect(departureTimelapseDecision(data(schedule()), at('09:49')).capture).toBe(false)
  })

  it('keeps capturing while the ferry runs late (until it actually departs)', () => {
    // 12 min after scheduled, still not departed → still capturing
    expect(departureTimelapseDecision(data(schedule()), at('10:12')).sailingTime).toBe('10:00')
  })

  it('stops once the sailing has departed (matchedDepartureTime set)', () => {
    const s = schedule()
    s[0].matchedDepartureTime = '10:03'
    // 10:04: 10:00 departed → excluded; 11:15 is >10 min away → no capture
    expect(departureTimelapseDecision(data(s), at('10:04')).capture).toBe(false)
  })

  it('safety cap: stops 20 minutes past scheduled even if never marked departed', () => {
    expect(departureTimelapseDecision(data(schedule()), at('10:21')).capture).toBe(false)
  })

  it('targets the imminent sailing when in its window', () => {
    // 11:06 → within 10 min of 11:15, 10:00 long gone
    expect(departureTimelapseDecision(data(schedule()), at('11:06')).sailingTime).toBe('11:15')
  })

  it('no capture outside any window', () => {
    expect(departureTimelapseDecision(data(schedule()), at('10:40')).capture).toBe(false)
  })
})
