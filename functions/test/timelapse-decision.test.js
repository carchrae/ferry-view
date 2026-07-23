import { describe, it, expect } from 'vitest'
import { timelapseDecision } from '../lib/webcam.js'
import { arrivalLineupTarget } from '../lib/webcam-decision.js'
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

  it('keeps crediting a sailing running very late (past the old 30-min ceiling), until the next sailing supersedes it', () => {
    const d = data({
      bowenSchedule: sched(['07:30', '08:45', '10:00'], '07:30'),
      recentActivity: [departed('07:31')],
    })
    // 08:45 is 55 min late — well past the old flat 30-min ceiling, but its
    // window (bounded by 10:00) stays open until 09:55.
    expect(timelapseDecision(d, at('09:40'))).toEqual({ capture: true, sailingTime: '08:45' })
    // Once 08:45's window closes (5 min before 10:00), the next sailing takes over.
    expect(timelapseDecision(d, at('09:55'))).toEqual({ capture: true, sailingTime: '10:00' })
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
    // Last scheduled sailing in the past is 13:55; 14:30 is 35 min later — still
    // well within 13:55's window (open until 15:10, 5 min before 15:15), so it
    // stays the target rather than being abandoned to the next sailing.
    expect(timelapseDecision(d, at('14:30'))).toEqual({ capture: true, sailingTime: '13:55' })
    expect(timelapseDecision(d, at('14:05')).capture).toBe(false) // only 10 min
  })

  it('skips when there is no later sailing today', () => {
    const d = data({
      bowenSchedule: sched(['22:30'], '22:30'),
      recentActivity: [departed('22:31')],
    })
    expect(timelapseDecision(d, at('23:05')).capture).toBe(false)
  })

  it('keeps capturing for 10 minutes after the ferry arrives (Arrived event)', () => {
    const d = data({
      recentActivity: [{ action: 'Arrived', location: 'Bowen', time: '13:45' }, departed('12:36')],
    })
    // 5 min after arrival: still capturing (the lineup draining onto the boat,
    // and late-arriving cars, are worth seeing).
    expect(timelapseDecision(d, at('13:50'))).toEqual({ capture: true, sailingTime: '13:55' })
    // 10 min after arrival: done.
    expect(timelapseDecision(d, at('13:55')).capture).toBe(false)
  })

  it('keeps capturing for 10 minutes after the ferry arrives (AIS level signal)', () => {
    const d = data({
      aisLocation: 'Bowen',
      aisLocationSince: at('13:45').valueOf(),
    })
    expect(timelapseDecision(d, at('13:50'))).toEqual({ capture: true, sailingTime: '13:55' })
    expect(timelapseDecision(d, at('13:55')).capture).toBe(false)
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

describe('arrivalLineupTarget', () => {
  it('picks the next scheduled sailing for an on-time arrival', () => {
    const d = data() // 12:35 departed; next is 13:55
    expect(arrivalLineupTarget(d, at('13:45'), at('13:45'))?.time).toBe('13:55')
  })

  it('keeps a late-boarding sailing even when the arrival is past its scheduled time', () => {
    // Ferry arrives at 14:01 for the 13:55 sailing (running late, not yet
    // departed). The photo must land on 13:55 — where the lineup frames are —
    // not 15:15 (the old "next scheduled time after the arrival" rule).
    const d = data()
    expect(arrivalLineupTarget(d, at('14:01'), at('14:01'))?.time).toBe('13:55')
  })

  it('still pairs correctly when the arrival and following departure land in one poll', () => {
    // Batched atberth update: arrival 13:45 and the 13:55 sailing's departure
    // arrive in the same poll. 13:55 already carries matchedDepartureTime
    // (13:55), but that departure came after this arrival, so the arrival
    // still belongs to it.
    const d = data({ bowenSchedule: sched(MIDDAY, '13:55') })
    expect(arrivalLineupTarget(d, at('13:45'), at('14:00'))?.time).toBe('13:55')
  })

  it('keeps a sailing running 20+ min late (2026-07-23 incident)', () => {
    // Real data: ferry ~25-40 min late all day; the 11:15 sailing's ferry
    // docked at 11:37 (22 min past scheduled). The old rule stamped the photo
    // on 12:35 — every arrival photo that day landed one sailing forward.
    const d = data({
      bowenSchedule: sched(['10:00', '11:15', '12:35', '13:55'], '10:00'),
      recentActivity: [departed('10:29')],
    })
    expect(arrivalLineupTarget(d, at('11:37'), at('11:37'))?.time).toBe('11:15')
  })

  it('skips sailings that departed before the arrival', () => {
    // 12:35 departed at 12:35 — an arrival at 13:45 serves 13:55, not 12:35.
    const d = data()
    expect(arrivalLineupTarget(d, at('13:45'), at('13:45'))?.time).toBe('13:55')
  })

  it('returns null when nothing is left to serve', () => {
    const d = data({ bowenSchedule: sched(['12:35'], '12:35') })
    expect(arrivalLineupTarget(d, at('13:45'), at('13:45'))).toBeNull()
  })
})
