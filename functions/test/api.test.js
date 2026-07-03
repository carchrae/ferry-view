import { describe, it, expect } from 'vitest'
import { checkDataChanged, sanitizeForCompare, parseApiDate } from '../lib/api.js'

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
      const data = { foo: 'bar', speed: 10, fetchedAt: 123 }
      const result = sanitizeForCompare(data)
      expect(result).toEqual({ foo: 'bar', speed: 10 })
    })
  })
})