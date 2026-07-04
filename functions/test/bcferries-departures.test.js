import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import {
  parseBowenDepartures,
  fetchBowenDepartures,
  isDepartureLogStale,
  augmentFromBCFerries,
  BC_FERRIES_HSB_URL,
} from '../lib/bcferries-departures.js'
import { timeToDate } from '../lib/time.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixture = readFileSync(join(__dirname, 'fixtures', 'hsb-departures.html'), 'utf8')

// timeToDate anchors to "today", so building `now` the same way keeps schedule
// times and now on the same day regardless of when the test runs.
const at = (hhmm) => timeToDate(hhmm)

describe('bcferries-departures', () => {
  describe('parseBowenDepartures', () => {
    const departures = parseBowenDepartures(fixture)

    it('extracts only the Bowen (Snug Cove) route, not Langdale/Nanaimo', () => {
      // Bowen route in the fixture has 14 sailings.
      expect(departures).toHaveLength(14)
    })

    it('reads scheduled + actual for a departed sailing, normalized to HH:mm', () => {
      expect(departures[0]).toEqual({ scheduled: '05:45', actual: '05:42', eta: '06:02' })
      // The 10:35 sailing that the stale bowenferry.ca feed was missing:
      expect(departures[4]).toEqual({ scheduled: '10:35', actual: '10:41', eta: '11:01' })
    })

    it('leaves actual/eta null for upcoming (not-yet-departed) sailings', () => {
      const upcoming = departures[7]
      expect(upcoming.scheduled).toBe('14:35')
      expect(upcoming.actual).toBeNull()
      expect(upcoming.eta).toBeNull()
    })

    it('returns [] when the Bowen route table is absent', () => {
      expect(parseBowenDepartures('<html><body>no tables</body></html>')).toEqual([])
    })
  })

  describe('fetchBowenDepartures', () => {
    it('sends a User-Agent and parses the returned HTML', async () => {
      let calledUrl, calledHeaders
      const fakeFetch = async (url, opts) => {
        calledUrl = url
        calledHeaders = opts?.headers
        return { ok: true, text: async () => fixture }
      }
      const result = await fetchBowenDepartures(fakeFetch)
      expect(calledUrl).toBe(BC_FERRIES_HSB_URL)
      expect(calledHeaders['User-Agent']).toMatch(/Mozilla/)
      expect(result).toHaveLength(14)
    })

    it('throws on a non-ok response', async () => {
      const fakeFetch = async () => ({ ok: false, status: 503, text: async () => '' })
      await expect(fetchBowenDepartures(fakeFetch)).rejects.toThrow(/503/)
    })
  })

  describe('isDepartureLogStale', () => {
    const schedule = {
      hsbSchedule: [{ time: '10:35' }, { time: '11:55' }, { time: '13:10' }, { time: '14:35' }],
      bowenSchedule: [{ time: '11:15' }, { time: '12:35' }, { time: '13:55' }],
    }

    it('is true when a past-due scheduled sailing is newer than the newest logged event', () => {
      // Newest log event 10:00, but 13:10 was due long before now (13:58).
      const data = { ...schedule, recentActivity: [{ action: 'Arrived', location: 'Horseshoe Bay', time: '10:20' }, { action: 'Departed', location: 'Bowen', time: '10:00' }] }
      expect(isDepartureLogStale(data, at('13:58'))).toBe(true)
    })

    it('is false during normal operation (log keeps up with the schedule)', () => {
      const data = { ...schedule, recentActivity: [{ action: 'Departed', location: 'Horseshoe Bay', time: '13:10' }] }
      expect(isDepartureLogStale(data, at('13:20'))).toBe(false)
    })

    it('is false overnight / before the first sailing (nothing is past-due)', () => {
      const data = { ...schedule, recentActivity: [] }
      expect(isDepartureLogStale(data, at('04:00'))).toBe(false)
    })
  })

  describe('augmentFromBCFerries', () => {
    it('injects correctly-shaped Departed events for actuals that have occurred', () => {
      const data = { recentActivity: [] }
      const departures = [
        { scheduled: '10:35', actual: '10:41', eta: '11:01' },
        { scheduled: '11:55', actual: '11:55', eta: '12:15' },
      ]
      const added = augmentFromBCFerries(data, departures, at('13:00'))
      expect(added).toBe(2)
      expect(data.recentActivity).toContainEqual({
        action: 'Departed',
        location: 'Horseshoe Bay',
        time: '10:41',
      })
    })

    it('dedups against existing recentActivity entries', () => {
      const data = {
        recentActivity: [{ action: 'Departed', location: 'Horseshoe Bay', time: '10:41' }],
      }
      const added = augmentFromBCFerries(
        data,
        [{ scheduled: '10:35', actual: '10:41', eta: '11:01' }],
        at('13:00'),
      )
      expect(added).toBe(0)
      expect(data.recentActivity).toHaveLength(1)
    })

    it('skips sailings without an actual, and actuals still in the future', () => {
      const data = { recentActivity: [] }
      const departures = [
        { scheduled: '14:35', actual: null, eta: null }, // not departed
        { scheduled: '15:55', actual: '15:58', eta: '16:18' }, // future relative to now
      ]
      const added = augmentFromBCFerries(data, departures, at('13:00'))
      expect(added).toBe(0)
      expect(data.recentActivity).toHaveLength(0)
    })
  })
})
