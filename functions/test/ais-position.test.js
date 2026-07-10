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
})
