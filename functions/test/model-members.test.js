import { describe, it, expect } from 'vitest'
import { selectMember, scoreWithMembers, membersUsable, describeMembers } from '../lib/model-members.js'
import { solarElevation } from '../lib/daylight.js'

// Noon and midnight in Vancouver on 2026-10-17 (PDT = UTC−7).
const NOON = Date.parse('2026-10-17T19:00:00Z')
const MIDNIGHT = Date.parse('2026-10-17T07:00:00Z')

const model = {
  weights: [1, 1],
  bias: 0,
  members: [
    { name: 'night', elevation: { max: 0 }, weights: [-5, -5], bias: 0 },
    { name: 'day', elevation: { min: 0 }, weights: [5, 5], bias: 0 },
  ],
}

describe('model members', () => {
  it('the sun is up at noon and down at midnight (sanity for the fixtures)', () => {
    expect(solarElevation(NOON)).toBeGreaterThan(20)
    expect(solarElevation(MIDNIGHT)).toBeLessThan(-20)
  })
  it('picks the member whose band holds the frame elevation', () => {
    expect(selectMember(model, NOON).name).toBe('day')
    expect(selectMember(model, MIDNIGHT).name).toBe('night')
  })
  it('falls back to the top-level weights without a timestamp, without members, or outside every band', () => {
    expect(selectMember(model, null)).toBe(model)
    expect(selectMember({ weights: [1], bias: 0 }, NOON).weights).toEqual([1])
    const gap = { weights: [1, 1], bias: 0, members: [{ elevation: { min: 50 }, weights: [9, 9], bias: 0 }] }
    expect(selectMember(gap, MIDNIGHT)).toBe(gap)
  })
  it('scores with the selected member', () => {
    const f = [0.5, 0.5]
    expect(scoreWithMembers(model, f, NOON)).toBeGreaterThan(0.99)
    expect(scoreWithMembers(model, f, MIDNIGHT)).toBeLessThan(0.01)
    expect(scoreWithMembers(model, f, null)).toBeCloseTo(1 / (1 + Math.exp(-1)), 6)
  })
  it('membersUsable requires full-length weights and a band on every member', () => {
    expect(membersUsable(model, 2)).toBe(true)
    expect(membersUsable(model, 3)).toBe(false)
    expect(membersUsable({ members: [{ weights: [1, 2] }] }, 2)).toBe(false)
    expect(membersUsable({ weights: [1, 2] }, 2)).toBe(true)
  })
  it('describes the bands', () => {
    expect(describeMembers(model)).toBe('<0°, ≥0°')
    expect(describeMembers({ members: [{ elevation: { min: -7, max: 8 } }] })).toBe('-7°…8°')
    expect(describeMembers({})).toBe('single model')
  })
})
