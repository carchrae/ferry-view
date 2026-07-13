import { describe, it, expect } from 'vitest'
import { timelapseDecision } from '../lib/webcam.js'
import { timeToDate } from '../lib/time.js'

const at = (hhmm) => timeToDate(hhmm)

// Typical mid-day Bowen schedule around a 13:55 sailing, plus the evening
// tail for the 9 pm cutoff cases.
const bowenSchedule = ['12:35', '13:55', '15:15', '20:25', '21:30', '22:30'].map((time) => ({
  time,
}))

const departed = (time) => ({ action: 'Departed', location: 'Bowen', time })

function data(overrides = {}) {
  return {
    dateIso: '2026-07-13',
    bowenSchedule,
    recentActivity: [departed('12:36')],
    ...overrides,
  }
}

describe('timelapseDecision', () => {
  it('captures on a 5-minute mark, 30+ min after the last departure, for the next sailing', () => {
    const d = timelapseDecision(data(), at('13:10'))
    expect(d).toEqual({ capture: true, sailingTime: '13:55' })
  })

  it('skips off-cadence minutes', () => {
    expect(timelapseDecision(data(), at('13:11')).capture).toBe(false)
    expect(timelapseDecision(data(), at('13:09')).capture).toBe(false)
  })

  it('waits 30 minutes after the previous departure', () => {
    expect(timelapseDecision(data(), at('13:05')).capture).toBe(false) // 29 min
    expect(timelapseDecision(data(), at('13:10')).capture).toBe(true) // 34 min
  })

  it('skips departures scheduled at/after 9 pm', () => {
    // Last departure 20:26, next is 21:30 → no timelapse for it.
    const d = data({ recentActivity: [departed('20:26')] })
    expect(timelapseDecision(d, at('21:00')).capture).toBe(false)
  })

  it('still captures for the 20:25 sailing (before the cutoff)', () => {
    const d = data({ recentActivity: [departed('15:16')] })
    expect(timelapseDecision(d, at('19:00'))).toEqual({ capture: true, sailingTime: '20:25' })
  })

  it('skips when nothing has departed today (early morning / overnight)', () => {
    const d = data({
      recentActivity: [],
      bowenSchedule: [{ time: '15:15' }, { time: '20:25' }],
    })
    expect(timelapseDecision(d, at('14:00')).capture).toBe(false)
  })

  it('falls back to the last past scheduled time when the log has no Bowen departure', () => {
    const d = data({ recentActivity: [{ action: 'Arrived', location: 'Bowen', time: '13:40' }] })
    // Last scheduled sailing in the past is 13:55; 14:30 is 35 min later.
    expect(timelapseDecision(d, at('14:30'))).toEqual({ capture: true, sailingTime: '15:15' })
    expect(timelapseDecision(d, at('14:20')).capture).toBe(false) // only 25 min
  })

  it('skips when there is no later sailing today', () => {
    const d = data({
      recentActivity: [departed('22:31')],
      bowenSchedule: [{ time: '22:30' }],
    })
    expect(timelapseDecision(d, at('23:05')).capture).toBe(false)
  })
})
