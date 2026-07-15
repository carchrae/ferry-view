import { describe, it, expect } from 'vitest'
import { timelapseDecision } from '../lib/webcam.js'
import { timeToDate } from '../lib/time.js'

const at = (hhmm) => timeToDate(hhmm)

// Fresh schedule per call so matchedDepartureTime set in one test can't leak.
// `departedBefore` marks every sailing at/before that time as departed (the
// poll stamps matchedDepartureTime on sailings that have left).
function sched(times, departedBefore) {
  return times.map((time) => {
    const s = { time }
    if (departedBefore && time <= departedBefore) s.matchedDepartureTime = time
    return s
  })
}

const MIDDAY = ['12:35', '13:55', '15:15', '20:25', '21:30', '22:30']
const departed = (time) => ({ action: 'Departed', location: 'Bowen', time })

function data(overrides = {}) {
  return {
    dateIso: '2026-07-13',
    bowenSchedule: sched(MIDDAY, '12:35'),
    recentActivity: [departed('12:36')],
    ...overrides,
  }
}

describe('timelapseDecision', () => {
  it('captures on a 5-minute mark, 30+ min after the last departure, for the next sailing', () => {
    const d = timelapseDecision(data(), at('13:10'))
    expect(d).toEqual({ capture: true, sailingTime: '13:55' })
  })

  it('attributes frames to a sailing boarding past its scheduled time, not the next one', () => {
    // 07:30 departed; 08:45 is boarding late (08:50, not yet departed). Its
    // lineup must be credited to 08:45 — not 10:00 (the old "time > now" bug).
    const d = data({
      bowenSchedule: sched(['07:30', '08:45', '10:00'], '07:30'),
      recentActivity: [departed('07:31')],
    })
    expect(timelapseDecision(d, at('08:50'))).toEqual({ capture: true, sailingTime: '08:45' })
  })

  it('moves to the next sailing once the current one has departed', () => {
    const d = data({
      bowenSchedule: sched(['07:30', '08:45', '10:00'], '08:45'),
      recentActivity: [departed('08:47')],
    })
    expect(timelapseDecision(d, at('09:20'))).toEqual({ capture: true, sailingTime: '10:00' })
  })

  it('skips off-cadence minutes', () => {
    expect(timelapseDecision(data(), at('13:11')).capture).toBe(false)
    expect(timelapseDecision(data(), at('13:09')).capture).toBe(false)
  })

  it('waits 15 minutes after the previous departure', () => {
    expect(timelapseDecision(data(), at('12:50')).capture).toBe(false) // 14 min
    expect(timelapseDecision(data(), at('12:55')).capture).toBe(true) // 19 min
  })

  it('skips departures scheduled at/after 9 pm', () => {
    const d = data({
      bowenSchedule: sched(MIDDAY, '20:25'),
      recentActivity: [departed('20:26')],
    })
    expect(timelapseDecision(d, at('21:00')).capture).toBe(false)
  })

  it('still captures for the 20:25 sailing (before the cutoff)', () => {
    const d = data({
      bowenSchedule: sched(MIDDAY, '15:15'),
      recentActivity: [departed('15:16')],
    })
    expect(timelapseDecision(d, at('19:00'))).toEqual({ capture: true, sailingTime: '20:25' })
  })

  it('skips when nothing has departed today (early morning / overnight)', () => {
    const d = data({
      recentActivity: [],
      bowenSchedule: sched(['15:15', '20:25']),
    })
    expect(timelapseDecision(d, at('14:00')).capture).toBe(false)
  })

  it('falls back to the last past scheduled time when the log has no Bowen departure', () => {
    const d = data({ recentActivity: [{ action: 'Arrived', location: 'Bowen', time: '13:40' }] })
    // Last scheduled sailing in the past is 13:55; 14:30 is 35 min later.
    expect(timelapseDecision(d, at('14:30'))).toEqual({ capture: true, sailingTime: '15:15' })
    expect(timelapseDecision(d, at('14:05')).capture).toBe(false) // only 10 min
  })

  it('skips when there is no later sailing today', () => {
    const d = data({
      bowenSchedule: sched(['22:30'], '22:30'),
      recentActivity: [departed('22:31')],
    })
    expect(timelapseDecision(d, at('23:05')).capture).toBe(false)
  })

  it('stops once the ferry arrives back at Bowen (Arrived event)', () => {
    const d = data({
      recentActivity: [{ action: 'Arrived', location: 'Bowen', time: '13:45' }, departed('12:36')],
    })
    expect(timelapseDecision(d, at('13:50')).capture).toBe(false)
  })

  it('stops once the ferry arrives back at Bowen (AIS level signal)', () => {
    const d = data({
      aisLocation: 'Bowen',
      aisLocationSince: at('13:45').valueOf(),
    })
    expect(timelapseDecision(d, at('13:50')).capture).toBe(false)
  })

  it("ignores the previous cycle's arrival (event predates the last departure)", () => {
    const d = data({
      recentActivity: [departed('12:36'), { action: 'Arrived', location: 'Bowen', time: '12:30' }],
    })
    expect(timelapseDecision(d, at('13:10'))).toEqual({ capture: true, sailingTime: '13:55' })
  })

  it('keeps capturing while AIS has the ferry at the other terminal', () => {
    const d = data({
      aisLocation: 'Horseshoe Bay',
      aisLocationSince: at('12:50').valueOf(),
    })
    expect(timelapseDecision(d, at('13:10'))).toEqual({ capture: true, sailingTime: '13:55' })
  })

  it('resumes for the next cycle after the ferry departs again', () => {
    const d = data({
      bowenSchedule: sched(MIDDAY, '13:55'),
      recentActivity: [
        departed('13:58'),
        { action: 'Arrived', location: 'Bowen', time: '13:45' },
        departed('12:36'),
      ],
    })
    expect(timelapseDecision(d, at('14:30'))).toEqual({ capture: true, sailingTime: '15:15' })
  })
})
