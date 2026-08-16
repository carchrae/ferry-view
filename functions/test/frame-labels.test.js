import { describe, it, expect } from 'vitest'
import { isValidFrameLabel, effectiveFrameLabel } from '../lib/lineup-labels.js'

const PATH = 'webcams/bowen/2026-08-16/timelapse/11:15_To HSB_1786212623431.jpg'
const label = (userUid, carsWaiting, recordedAt) => ({
  framePath: PATH,
  sailingKey: '2026-08-16_11:15_To HSB',
  userUid,
  carsWaiting,
  recordedAt,
})

describe('isValidFrameLabel', () => {
  it('needs an author, a boolean answer and a frame', () => {
    expect(isValidFrameLabel(label('u1', true, 1))).toBe(true)
    expect(isValidFrameLabel(label('u1', false, 1))).toBe(true) // false is a real answer
    expect(isValidFrameLabel({ ...label('u1', true, 1), userUid: undefined })).toBe(false)
    expect(isValidFrameLabel({ ...label('u1', true, 1), framePath: undefined })).toBe(false)
    expect(isValidFrameLabel({ ...label('u1', true, 1), carsWaiting: 'yes' })).toBe(false)
    expect(isValidFrameLabel(null)).toBe(false)
  })
})

describe('effectiveFrameLabel', () => {
  it('a single rider decides the frame', () => {
    expect(effectiveFrameLabel([label('u1', true, 100)])).toBe(1)
    expect(effectiveFrameLabel([label('u1', false, 100)])).toBe(0)
  })

  it("a rider's latest word replaces their earlier one — corrections do not stack", () => {
    expect(effectiveFrameLabel([label('u1', true, 100), label('u1', false, 200)])).toBe(0)
    // order in the array must not matter, only recordedAt
    expect(effectiveFrameLabel([label('u1', false, 200), label('u1', true, 100)])).toBe(0)
  })

  it('majority across riders wins', () => {
    expect(
      effectiveFrameLabel([label('u1', true, 1), label('u2', true, 2), label('u3', false, 3)]),
    ).toBe(1)
    expect(
      effectiveFrameLabel([label('u1', false, 1), label('u2', false, 2), label('u3', true, 3)]),
    ).toBe(0)
  })

  it('a tie leaves the frame unlabeled rather than teaching a coin flip', () => {
    expect(effectiveFrameLabel([label('u1', true, 1), label('u2', false, 2)])).toBe(null)
  })

  it('one rider flipping their own vote can break a tie', () => {
    // u1 says cars then changes to empty; u2 says empty → 0-2, not a tie
    expect(
      effectiveFrameLabel([label('u1', true, 1), label('u1', false, 3), label('u2', false, 2)]),
    ).toBe(0)
  })

  it('ignores invalid reports and empty input', () => {
    expect(effectiveFrameLabel([{ framePath: PATH, carsWaiting: true }])).toBe(null) // no author
    expect(effectiveFrameLabel([])).toBe(null)
    expect(effectiveFrameLabel(undefined)).toBe(null)
  })
})
