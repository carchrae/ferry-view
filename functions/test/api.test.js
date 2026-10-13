import { describe, it, expect } from 'vitest'
import { checkDataChanged, sanitizeForCompare, sameAsSaved, liveFields, parseApiDate } from '../lib/api.js'

describe('api.js', () => {
  describe('parseApiDate', () => {
    // The live feed sends a weekday name plus an ordinal day, which dayjs
    // strict parsing can't consume — this used to throw and freeze the pipeline.
    it.each([
      ['Friday Jul 3rd', '2026-07-03'],
      ['Friday July 3rd', '2026-07-03'],
      ['Friday Jul 3', '2026-07-03'],
      ['Friday July 3', '2026-07-03'],
      ['Saturday Aug 22nd', '2026-08-22'],
      ['Sunday Sep 1st', '2026-09-01'],
      ['Wednesday Dec 25th', '2026-12-25'],
    ])('parses %j -> %s', (input, expected) => {
      expect(parseApiDate(input, 2026)).toBe(expected)
    })

    it('throws on an unparseable date', () => {
      expect(() => parseApiDate('not a date')).toThrow()
    })
  })

  describe('checkDataChanged', () => {
    it('returns true when there is no existing data', () => {
      const newData = { foo: 'bar' }
      expect(checkDataChanged(newData, null)).toBe(true)
    })

    it('returns true when data has changed', () => {
      const newData = { foo: 'bar', fetchedAt: 123 }
      const existingData = { foo: 'baz', fetchedAt: 456 }
      expect(checkDataChanged(newData, existingData)).toBe(true)
    })

    it('returns false when data is the same (excluding fetchedAt)', () => {
      const newData = { foo: 'bar', fetchedAt: 123 }
      const existingData = { foo: 'bar', fetchedAt: 456 }
      expect(checkDataChanged(newData, existingData)).toBe(false)
    })

    it('returns false when only lastUpdate differs', () => {
      const newData = { speed: 10, lastUpdate: 'now' }
      const existingData = { speed: 10, lastUpdate: 'then' }
      expect(checkDataChanged(newData, existingData)).toBe(false)
    })
  })

  describe('sanitizeForCompare', () => {
    it('removes fetchedAt', () => {
      const data = { foo: 'bar', fetchedAt: 123 }
      const result = sanitizeForCompare(data)
      expect(result).toEqual({ foo: 'bar' })
      expect(result.fetchedAt).toBeUndefined()
    })

    it('removes lastUpdate', () => {
      const data = { foo: 'bar', lastUpdate: 'now' }
      const result = sanitizeForCompare(data)
      expect(result).toEqual({ foo: 'bar' })
      expect(result.lastUpdate).toBeUndefined()
    })

    it('keeps other fields', () => {
      const data = { foo: 'bar', aisLocation: 'Bowen', fetchedAt: 123 }
      const result = sanitizeForCompare(data)
      expect(result).toEqual({ foo: 'bar', aisLocation: 'Bowen' })
    })

    // Patched separately (liveFields), so they never trigger the enrichment.
    it('removes live telemetry', () => {
      const data = { foo: 'bar', speed: 10, heading: 270, position: { lat: 1, lon: 2 }, isFresh: true }
      expect(sanitizeForCompare(data)).toEqual({ foo: 'bar' })
    })

    // The saved doc carries these source markers from enrichment; the fresh
    // fetch never does. Left in, every poll after the first tag read as changed.
    it('strips enrichment source markers from schedule entries', () => {
      const saved = sanitizeForCompare({
        bowenSchedule: [{ time: '16:40', crosswalkFullAt: 1, crosswalkSource: 'robot' }],
        hsbSchedule: [{ time: '17:00', lastCapacity: 'Full', capacitySource: 'user' }],
      })
      const fresh = sanitizeForCompare({ bowenSchedule: [{ time: '16:40' }], hsbSchedule: [{ time: '17:00' }] })
      expect(checkDataChanged(fresh, saved)).toBe(false)
    })
  })

  describe('liveFields', () => {
    it('picks only the live fields that are set', () => {
      const data = { speed: 10, heading: undefined, lastUpdate: '16:10', bowenSchedule: [] }
      expect(liveFields(data)).toEqual({ speed: 10, lastUpdate: '16:10' })
    })
  })

  describe('sameAsSaved', () => {
    const saved = { speed: 10, lastUpdate: '16:10', fetchedAt: 1, bowenSchedule: [{ time: '16:40', crosswalkSource: 'robot' }] }

    it('is false with no saved doc', () => {
      expect(sameAsSaved({ speed: 10 }, null)).toBe(false)
    })

    it('ignores fetchedAt and undefined fields', () => {
      expect(sameAsSaved({ ...saved, fetchedAt: 2, extra: undefined }, saved)).toBe(true)
    })

    it('sees a changed lastUpdate', () => {
      expect(sameAsSaved({ ...saved, lastUpdate: '16:11' }, saved)).toBe(false)
    })

    it('sees a changed enrichment field', () => {
      const next = { ...saved, bowenSchedule: [{ time: '16:40', crosswalkSource: 'user' }] }
      expect(sameAsSaved(next, saved)).toBe(false)
    })
  })
})