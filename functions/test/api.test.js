import { describe, it, expect } from 'vitest'
import { checkDataChanged, sanitizeForCompare } from '../lib/api.js'

describe('api.js', () => {
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