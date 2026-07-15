import { describe, it, expect } from 'vitest'
import {
  lastBowenDeparture,
  bowenArrivalForCurrentCycle,
  arrivalSignalAvailable,
} from '../lib/webcam.js'
import { timeToDate } from '../lib/time.js'

const at = (hhmm) => timeToDate(hhmm)

describe('lastBowenDeparture', () => {
  it('prefers the newest Departed/Bowen event', () => {
    const d = {
      recentActivity: [
        { action: 'Departed', location: 'Bowen', time: '12:36' },
        { action: 'Departed', location: 'Bowen', time: '11:20' },
      ],
      bowenSchedule: [{ time: '12:35' }],
    }
    expect(lastBowenDeparture(d, at('13:00')).format('HH:mm')).toBe('12:36')
  })

  it('falls back to the most recent past scheduled time', () => {
    const d = { recentActivity: [], bowenSchedule: [{ time: '10:00' }, { time: '11:15' }] }
    expect(lastBowenDeparture(d, at('11:30')).format('HH:mm')).toBe('11:15')
  })

  it('returns null before the first sailing with an empty log', () => {
    const d = { recentActivity: [], bowenSchedule: [{ time: '10:00' }] }
    expect(lastBowenDeparture(d, at('09:00'))).toBeNull()
  })
})

describe('bowenArrivalForCurrentCycle', () => {
  it('AIS docked at Bowen counts as arrived, dated by aisLocationSince', () => {
    const d = { aisLocation: 'Bowen', aisLocationSince: at('13:45').valueOf() }
    expect(bowenArrivalForCurrentCycle(d, at('13:50')).format('HH:mm')).toBe('13:45')
  })

  it('AIS docked at Bowen still counts past the scheduled time (late boarding)', () => {
    const d = {
      aisLocation: 'Bowen',
      aisLocationSince: at('09:40').valueOf(),
      recentActivity: [],
      bowenSchedule: [{ time: '10:00' }],
    }
    // 10:05: the schedule-inferred "departure" at 10:00 must not erase the
    // arrival — the ferry is demonstrably at the dock.
    expect(bowenArrivalForCurrentCycle(d, at('10:05')).format('HH:mm')).toBe('09:40')
  })

  it('AIS anywhere else means not arrived, even with a newer Arrived event', () => {
    const d = {
      aisLocation: 'transit',
      recentActivity: [{ action: 'Arrived', location: 'Bowen', time: '13:45' }],
    }
    expect(bowenArrivalForCurrentCycle(d, at('13:50'))).toBeNull()
  })

  it('without AIS, uses the newest Arrived/Bowen event', () => {
    const d = {
      recentActivity: [
        { action: 'Arrived', location: 'Bowen', time: '13:45' },
        { action: 'Departed', location: 'Bowen', time: '12:36' },
      ],
      bowenSchedule: [],
    }
    expect(bowenArrivalForCurrentCycle(d, at('13:50')).format('HH:mm')).toBe('13:45')
  })

  it('without AIS, an arrival older than the last departure does not count', () => {
    const d = {
      recentActivity: [
        { action: 'Departed', location: 'Bowen', time: '12:36' },
        { action: 'Arrived', location: 'Bowen', time: '12:30' },
      ],
      bowenSchedule: [],
    }
    expect(bowenArrivalForCurrentCycle(d, at('13:00'))).toBeNull()
  })

  it('without AIS, a stale log (arrival before a passed scheduled time) does not count', () => {
    const d = {
      recentActivity: [{ action: 'Arrived', location: 'Bowen', time: '13:40' }],
      bowenSchedule: [{ time: '13:55' }],
    }
    expect(bowenArrivalForCurrentCycle(d, at('14:30'))).toBeNull()
  })
})

describe('arrivalSignalAvailable', () => {
  it('true with any AIS classification', () => {
    expect(arrivalSignalAvailable({ aisLocation: 'transit' })).toBe(true)
  })

  it('true with a Bowen event in the log', () => {
    expect(
      arrivalSignalAvailable({
        recentActivity: [{ action: 'Departed', location: 'Bowen', time: '12:36' }],
      }),
    ).toBe(true)
  })

  it('false with no AIS and no Bowen events', () => {
    expect(
      arrivalSignalAvailable({
        recentActivity: [{ action: 'Arrived', location: 'Horseshoe Bay', time: '12:10' }],
      }),
    ).toBe(false)
  })
})
