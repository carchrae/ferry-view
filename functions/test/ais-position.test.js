import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import {
  mercatorToLatLon,
  haversineMeters,
  extractVesselPosition,
  classifyTerminal,
  augmentFromAisPosition,
  normalizeLocation,
  TERMINALS,
} from '../lib/ais-position.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const atBowenFixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'ais-at-bowen.json'), 'utf8'),
)
const atHsbFixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'ais-at-hsb.json'), 'utf8'),
)

const BOWEN = TERMINALS.find((t) => t.location === 'Bowen')
const HSB = TERMINALS.find((t) => t.location === 'Horseshoe Bay')

// A dayjs-like stub: augmentFromAisPosition only calls now.format('HH:mm').
const nowAt = (hhmm) => ({ format: () => hhmm })

describe('ais-position', () => {
  describe('mercatorToLatLon', () => {
    it('converts the observed vessel Point to Snug Cove (Bowen)', () => {
      const { lat, lon } = mercatorToLatLon(-13729111.8363729, 6339467.45733619)
      expect(lat).toBeCloseTo(49.3793, 3)
      expect(lon).toBeCloseTo(-123.3307, 3)
    })
  })

  describe('haversineMeters', () => {
    it('is ~0 for identical points', () => {
      expect(haversineMeters(BOWEN.lat, BOWEN.lon, BOWEN.lat, BOWEN.lon)).toBeCloseTo(0, 5)
    })

    it('measures the ~5 km channel between the two terminals', () => {
      const d = haversineMeters(BOWEN.lat, BOWEN.lon, HSB.lat, HSB.lon)
      expect(d).toBeGreaterThan(4000)
      expect(d).toBeLessThan(6000)
    })
  })

  describe('extractVesselPosition', () => {
    it('reads the vessel Point feature and converts it', () => {
      const pos = extractVesselPosition(atBowenFixture)
      expect(pos.lat).toBeCloseTo(49.3793, 3)
      expect(pos.lon).toBeCloseTo(-123.3307, 3)
    })

    it('falls back to the polygon centroid when there is no Point feature', () => {
      const polyOnly = { features: [atBowenFixture.features[0]] }
      const pos = extractVesselPosition(polyOnly)
      // Centroid of the footprint is still right at Snug Cove.
      expect(pos.lat).toBeCloseTo(49.379, 2)
      expect(pos.lon).toBeCloseTo(-123.331, 2)
    })

    it('returns null when there are no usable features', () => {
      expect(extractVesselPosition({ features: [] })).toBeNull()
      expect(extractVesselPosition(null)).toBeNull()
    })
  })

  describe('classifyTerminal', () => {
    it('classifies a stopped vessel at Bowen', () => {
      expect(classifyTerminal(extractVesselPosition(atBowenFixture), '0.00')).toBe('Bowen')
    })

    it('classifies a stopped vessel at Horseshoe Bay', () => {
      expect(classifyTerminal({ lat: HSB.lat, lon: HSB.lon }, '0.10')).toBe('Horseshoe Bay')
    })

    it('classifies the observed docked-at-HSB feed sample as Horseshoe Bay', () => {
      expect(classifyTerminal(extractVesselPosition(atHsbFixture), '0.00')).toBe('Horseshoe Bay')
    })

    it('returns null (in transit) when the vessel is moving, even at a dock', () => {
      expect(classifyTerminal({ lat: BOWEN.lat, lon: BOWEN.lon }, '8.5')).toBeNull()
    })

    // Root cause of the "speed blip = false departure" edge (see the scenario block
    // below): classification is speed+radius only, so any SOG just over the stopped
    // threshold declassifies the terminal even though the vessel hasn't left the berth.
    it('declassifies the terminal on a small speed blip while still at the dock', () => {
      const atDock = { lat: BOWEN.lat, lon: BOWEN.lon }
      expect(classifyTerminal(atDock, '0.50')).toBe('Bowen') // below threshold: docked
      expect(classifyTerminal(atDock, '0.70')).toBeNull() // barely above: reads as transit
    })

    it('returns null when stopped but far from any terminal (mid-channel)', () => {
      const mid = { lat: (BOWEN.lat + HSB.lat) / 2, lon: (BOWEN.lon + HSB.lon) / 2 }
      expect(classifyTerminal(mid, '0.00')).toBeNull()
    })

    it('returns null for a missing position', () => {
      expect(classifyTerminal(null, '0.00')).toBeNull()
    })
  })

  describe('normalizeLocation', () => {
    it('collapses each Horseshoe Bay berth to "Horseshoe Bay"', () => {
      expect(normalizeLocation('HSB 1')).toBe('Horseshoe Bay')
      expect(normalizeLocation('HSB 2')).toBe('Horseshoe Bay')
      expect(normalizeLocation('HSB 3')).toBe('Horseshoe Bay')
    })

    it('collapses bare "HSB" and lowercase/extra-whitespace variants', () => {
      expect(normalizeLocation('HSB')).toBe('Horseshoe Bay')
      expect(normalizeLocation('hsb 2')).toBe('Horseshoe Bay')
      expect(normalizeLocation('  HSB  3 ')).toBe('Horseshoe Bay')
    })

    it('passes Bowen and other locations through unchanged', () => {
      expect(normalizeLocation('Bowen')).toBe('Bowen')
      expect(normalizeLocation('Horseshoe Bay')).toBe('Horseshoe Bay')
    })

    it('passes non-string input through unchanged', () => {
      expect(normalizeLocation(null)).toBeNull()
      expect(normalizeLocation(undefined)).toBeUndefined()
    })
  })

  describe('augmentFromAisPosition', () => {
    it('emits Departed on leaving a terminal for transit', () => {
      const data = { aisLocation: 'transit', recentActivity: [] }
      const added = augmentFromAisPosition(data, { aisLocation: 'Bowen' }, nowAt('10:05'))
      expect(added).toBe(1)
      expect(data.recentActivity).toContainEqual({
        action: 'Departed',
        location: 'Bowen',
        time: '10:05',
      })
    })

    it('emits Arrived on reaching a terminal from transit', () => {
      const data = { aisLocation: 'Horseshoe Bay', recentActivity: [] }
      const added = augmentFromAisPosition(data, { aisLocation: 'transit' }, nowAt('10:25'))
      expect(added).toBe(1)
      expect(data.recentActivity).toContainEqual({
        action: 'Arrived',
        location: 'Horseshoe Bay',
        time: '10:25',
      })
    })

    it('emits both Departed and Arrived when the terminal flips between polls', () => {
      const data = { aisLocation: 'Horseshoe Bay', recentActivity: [] }
      const added = augmentFromAisPosition(data, { aisLocation: 'Bowen' }, nowAt('10:25'))
      expect(added).toBe(2)
      expect(data.recentActivity).toContainEqual({
        action: 'Departed',
        location: 'Bowen',
        time: '10:25',
      })
      expect(data.recentActivity).toContainEqual({
        action: 'Arrived',
        location: 'Horseshoe Bay',
        time: '10:25',
      })
    })

    it('emits nothing when the classification is unchanged', () => {
      const data = { aisLocation: 'Bowen', recentActivity: [] }
      expect(augmentFromAisPosition(data, { aisLocation: 'Bowen' }, nowAt('10:25'))).toBe(0)
      expect(data.recentActivity).toHaveLength(0)
    })

    it('emits nothing on the first run (no prior state)', () => {
      const data = { aisLocation: 'Bowen', recentActivity: [] }
      expect(augmentFromAisPosition(data, null, nowAt('10:25'))).toBe(0)
      expect(augmentFromAisPosition(data, {}, nowAt('10:25'))).toBe(0)
    })

    it('suppresses the Departed HSB event when emitHsbDepartures is false', () => {
      // Scrape is the authoritative HSB source; AIS shouldn't compete on that side.
      const data = { aisLocation: 'transit', recentActivity: [] }
      const added = augmentFromAisPosition(data, { aisLocation: 'Horseshoe Bay' }, nowAt('17:20'), {
        emitHsbDepartures: false,
      })
      expect(added).toBe(0)
      expect(data.recentActivity).toHaveLength(0)
    })

    it('still emits Departed Bowen and Arrived HSB when HSB departures are suppressed', () => {
      // Terminal flips Bowen -> HSB: the Bowen departure and HSB arrival are unaffected;
      // only a Departed/Horseshoe Bay would be suppressed (and there is none here).
      const data = { aisLocation: 'Horseshoe Bay', recentActivity: [] }
      const added = augmentFromAisPosition(data, { aisLocation: 'Bowen' }, nowAt('17:00'), {
        emitHsbDepartures: false,
      })
      expect(added).toBe(2)
      expect(data.recentActivity).toContainEqual({
        action: 'Departed',
        location: 'Bowen',
        time: '17:00',
      })
      expect(data.recentActivity).toContainEqual({
        action: 'Arrived',
        location: 'Horseshoe Bay',
        time: '17:00',
      })
    })

    it('still emits Departed HSB by default (backup when the scrape fails)', () => {
      const data = { aisLocation: 'transit', recentActivity: [] }
      const added = augmentFromAisPosition(data, { aisLocation: 'Horseshoe Bay' }, nowAt('17:20'))
      expect(added).toBe(1)
      expect(data.recentActivity).toContainEqual({
        action: 'Departed',
        location: 'Horseshoe Bay',
        time: '17:20',
      })
    })

    it('does not duplicate an event already present in recentActivity', () => {
      const data = {
        aisLocation: 'transit',
        recentActivity: [{ action: 'Departed', location: 'Bowen', time: '10:05' }],
      }
      expect(augmentFromAisPosition(data, { aisLocation: 'Bowen' }, nowAt('10:05'))).toBe(0)
      expect(data.recentActivity).toHaveLength(1)
    })
  })

  // Behavioural documentation for how a run of successive polls turns into
  // arrival/departure events. Each poll carries a fresh `recentActivity` (from that
  // poll's fetch) and the previous poll's `aisLocation` as prior state — exactly how
  // refreshFerryData threads it. These answer three concrete questions about the edges:
  //   1. does a speed blip at the dock (no real departure) emit a Departed?
  //   2. when does the departure time occur?
  //   3. what happens when the ferry leaves and then returns, staying in the area?
  describe('arrival/departure scenarios (poll sequences)', () => {
    // Replay a list of { loc, time } polls, threading prior state and collecting every
    // event augmentFromAisPosition emits across the run.
    const runPolls = (polls, opts) => {
      const events = []
      let prev = null
      for (const { loc, time } of polls) {
        const data = { aisLocation: loc, recentActivity: [] }
        augmentFromAisPosition(data, prev == null ? null : { aisLocation: prev }, nowAt(time), opts)
        events.push(...data.recentActivity)
        prev = loc
      }
      return events
    }

    // Q1: the ferry slows down and speeds up again but never actually leaves the berth.
    // A single poll catches SOG above the stopped threshold, so classifyTerminal reports
    // 'transit' for that one poll (Bowen -> transit -> Bowen). Current logic treats that
    // as a genuine departure+arrival. This test PINS the (arguably wrong) current
    // behaviour so a future fix — e.g. requiring the vessel to actually clear the dock
    // radius, or debouncing single-poll transit blips — will visibly flip it here.
    it('Q1: a one-poll speed blip at the dock emits a spurious Departed then Arrived', () => {
      const events = runPolls([
        { loc: 'Bowen', time: '10:00' }, // sitting docked
        { loc: 'transit', time: '10:01' }, // brief SOG blip over threshold, still at berth
        { loc: 'Bowen', time: '10:02' }, // settled again, never left
      ])
      expect(events).toEqual([
        { action: 'Departed', location: 'Bowen', time: '10:01' },
        { action: 'Arrived', location: 'Bowen', time: '10:02' },
      ])
    })

    // Q2: the departure time is the wall-clock time of the poll at which the
    // terminal -> transit transition is first DETECTED — not when the vessel physically
    // left. It is quantized to the poll cadence: the ferry may have pushed off at 10:03:40
    // but if the first poll to see it in transit runs at 10:05, the Departed is stamped
    // 10:05. Steady-docked polls before the transition emit nothing.
    it('Q2: departure time is stamped at the first poll that sees transit, not earlier', () => {
      const events = runPolls([
        { loc: 'Bowen', time: '10:00' }, // docked, no event
        { loc: 'Bowen', time: '10:02' }, // still docked, no event
        { loc: 'transit', time: '10:05' }, // first poll to observe it gone -> Departed @ 10:05
        { loc: 'transit', time: '10:10' }, // still in transit, no further event
      ])
      expect(events).toEqual([{ action: 'Departed', location: 'Bowen', time: '10:05' }])
    })

    // Q3a: the ferry leaves the dock, is seen in transit, then returns to the SAME
    // terminal (e.g. a false start, or repositioning across berths that dipped it out of
    // the dock radius). Because a transit poll was observed in between, this reads as a
    // full Departed + Arrived round-trip at the same terminal rather than one sailing.
    it('Q3a: leaving then returning to the same terminal emits Departed then Arrived there', () => {
      const events = runPolls([
        { loc: 'Bowen', time: '09:00' },
        { loc: 'transit', time: '09:05' }, // pulled out -> Departed Bowen
        { loc: 'Bowen', time: '09:15' }, // came back to Bowen -> Arrived Bowen
      ])
      expect(events).toEqual([
        { action: 'Departed', location: 'Bowen', time: '09:05' },
        { action: 'Arrived', location: 'Bowen', time: '09:15' },
      ])
    })

    // Q3b: same round-trip, but it happens entirely BETWEEN two polls — no poll ever
    // classifies the vessel as transit, so aisLocation reads 'Bowen' both times and NO
    // event is emitted. The excursion is invisible to the detector.
    it('Q3b: a leave-and-return that no poll catches in transit emits nothing', () => {
      const events = runPolls([
        { loc: 'Bowen', time: '09:00' }, // docked
        { loc: 'Bowen', time: '09:15' }, // docked again; the excursion fell between polls
      ])
      expect(events).toEqual([])
    })

    // Contrast: a normal, complete sailing (leave Bowen, cross, dock at HSB) yields
    // exactly one Departed and one Arrived, at the correct terminals.
    it('a normal Bowen -> HSB sailing emits one Departed and one Arrived', () => {
      const events = runPolls([
        { loc: 'Bowen', time: '08:30' },
        { loc: 'transit', time: '08:35' }, // Departed Bowen
        { loc: 'transit', time: '08:50' },
        { loc: 'Horseshoe Bay', time: '08:55' }, // Arrived Horseshoe Bay
      ])
      expect(events).toEqual([
        { action: 'Departed', location: 'Bowen', time: '08:35' },
        { action: 'Arrived', location: 'Horseshoe Bay', time: '08:55' },
      ])
    })
  })
})
