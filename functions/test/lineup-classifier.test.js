import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import {
  extractFeatures,
  labelForTimestamp,
  FEATURE_LENGTH,
} from '../lib/lineup-features.js'
import {
  isValidLineupReport,
  effectiveCrosswalk,
  effectiveCrosswalkAt,
  firstSustainedPositiveTs,
  robotMayFillCrosswalk,
} from '../lib/lineup-labels.js'
import { classifyLineup, scoreFeatures } from '../lib/lineup-classifier.js'

async function solidJpeg(shade, width = 1280, height = 720) {
  return sharp({
    create: { width, height, channels: 3, background: { r: shade, g: shade, b: shade } },
  })
    .jpeg()
    .toBuffer()
}

// Weights that fire on a bright ROI: each pixel contributes up to 0.01, so an
// all-white crop scores sigmoid(-6 + 12.96) ≈ 1 and an all-black one
// sigmoid(-6) ≈ 0.002.
const brightModel = {
  enabled: true,
  weights: new Array(FEATURE_LENGTH).fill(0.01),
  bias: -6,
  threshold: 0.7,
}

describe('extractFeatures', () => {
  it('returns FEATURE_LENGTH normalized values, deterministically', async () => {
    const buf = await solidJpeg(128)
    const a = await extractFeatures(buf)
    const b = await extractFeatures(buf)
    expect(a.length).toBe(FEATURE_LENGTH)
    expect([...a].every((v) => v >= 0 && v <= 1)).toBe(true)
    expect([...a]).toEqual([...b])
    // A mid-grey frame should produce mid-range features.
    const mean = [...a].reduce((s, v) => s + v, 0) / a.length
    expect(mean).toBeGreaterThan(0.3)
    expect(mean).toBeLessThan(0.7)
  })
})

describe('labelForTimestamp', () => {
  it('labels frames at/after the crosswalk tag positive, earlier ones negative', () => {
    expect(labelForTimestamp(1000, 1000)).toBe(1)
    expect(labelForTimestamp(1001, 1000)).toBe(1)
    expect(labelForTimestamp(999, 1000)).toBe(0)
    expect(labelForTimestamp(null, 1000)).toBe(null)
    expect(labelForTimestamp(1000, undefined)).toBe(null)
  })
})

describe('effectiveCrosswalkAt', () => {
  it('picks the latest-recorded valid mark (the app rule)', () => {
    expect(
      effectiveCrosswalkAt([
        { userUid: 'a', crosswalkAt: 1000, recordedAt: 10 },
        { userUid: 'b', crosswalkAt: 2000, recordedAt: 30 },
        { userUid: 'c', crosswalkAt: 1500, recordedAt: 20 },
      ]),
    ).toBe(2000)
  })

  it('ignores invalid reports and returns null when none remain', () => {
    expect(
      effectiveCrosswalkAt([
        { userUid: 'a', crosswalkAt: 1000, recordedAt: 99 },
        { crosswalkAt: 2000, recordedAt: 100 }, // no userUid
        { userUid: 'b', crosswalkAt: 'soon', recordedAt: 101 }, // non-numeric
      ]),
    ).toBe(1000)
    expect(effectiveCrosswalkAt([])).toBe(null)
    expect(effectiveCrosswalkAt(undefined)).toBe(null)
  })

  it('treats a missing recordedAt as oldest', () => {
    expect(
      effectiveCrosswalkAt([
        { userUid: 'a', crosswalkAt: 1000 },
        { userUid: 'b', crosswalkAt: 2000, recordedAt: 1 },
      ]),
    ).toBe(2000)
  })

  it('returns null when the latest word is a notYet refute (frames stay unlabeled)', () => {
    expect(
      effectiveCrosswalkAt([
        { userUid: 'a', crosswalkAt: 1000, recordedAt: 10 },
        { userUid: 'b', crosswalkAt: null, notYet: true, recordedAt: 20 },
      ]),
    ).toBe(null)
  })
})

describe('isValidLineupReport', () => {
  it('accepts numeric marks and notYet refutes, requires an author', () => {
    expect(isValidLineupReport({ userUid: 'a', crosswalkAt: 1000 })).toBe(true)
    expect(isValidLineupReport({ userUid: 'a', crosswalkAt: null, notYet: true })).toBe(true)
    expect(isValidLineupReport({ crosswalkAt: null, notYet: true })).toBe(false)
    expect(isValidLineupReport({ userUid: 'a', crosswalkAt: null })).toBe(false)
    expect(isValidLineupReport({ userUid: 'a', crosswalkAt: 'soon' })).toBe(false)
    expect(isValidLineupReport(undefined)).toBe(false)
  })
})

describe('effectiveCrosswalk', () => {
  it('latest-wins across mixed positives and refutes', () => {
    const reports = [
      { userUid: 'a', crosswalkAt: 1000, recordedAt: 10 },
      { userUid: 'b', crosswalkAt: null, notYet: true, recordedAt: 20 },
    ]
    expect(effectiveCrosswalk(reports)).toEqual({ at: null, notYet: true, recordedAt: 20 })
    // A newer positive supersedes the refute.
    reports.push({ userUid: 'c', crosswalkAt: 3000, recordedAt: 30 })
    expect(effectiveCrosswalk(reports)).toEqual({ at: 3000, notYet: false, recordedAt: 30 })
  })

  it('returns null with no valid reports', () => {
    expect(effectiveCrosswalk([])).toBe(null)
    expect(effectiveCrosswalk([{ crosswalkAt: 1 }])).toBe(null)
  })
})

describe('robotMayFillCrosswalk', () => {
  it('never fills over an existing claim', () => {
    expect(robotMayFillCrosswalk({ crosswalkFullAt: 1000 }, 2000)).toBe(false)
  })

  it('fills freely when no refute guard is armed', () => {
    expect(robotMayFillCrosswalk({}, 2000)).toBe(true)
    expect(robotMayFillCrosswalk(undefined, 2000)).toBe(true)
  })

  it('is blocked by a refute at/after the detection, allowed by an older one', () => {
    expect(robotMayFillCrosswalk({ crosswalkNotYetAt: 3000 }, 2000)).toBe(false)
    expect(robotMayFillCrosswalk({ crosswalkNotYetAt: 2000 }, 2000)).toBe(false)
    expect(robotMayFillCrosswalk({ crosswalkNotYetAt: 1000 }, 2000)).toBe(true)
  })
})

describe('firstSustainedPositiveTs', () => {
  const f = (ts, positive) => ({ ts, positive })

  it('returns the first of two consecutive positives', () => {
    expect(firstSustainedPositiveTs([f(1, false), f(2, true), f(3, true), f(4, true)])).toBe(2)
  })

  it('ignores a lone positive blip', () => {
    expect(firstSustainedPositiveTs([f(1, true), f(2, false), f(3, true), f(4, true)])).toBe(3)
  })

  it('returns null when never confirmed', () => {
    expect(firstSustainedPositiveTs([f(1, false), f(2, true), f(3, false)])).toBe(null)
    expect(firstSustainedPositiveTs([f(1, true)])).toBe(null)
    expect(firstSustainedPositiveTs([])).toBe(null)
    expect(firstSustainedPositiveTs(undefined)).toBe(null)
  })
})

describe('classifyLineup', () => {
  it('returns a well-formed verdict with the shipped (trained, enabled) model', async () => {
    const verdict = await classifyLineup(await solidJpeg(255))
    expect(verdict).not.toBe(null)
    expect(verdict.probability).toBeGreaterThanOrEqual(0)
    expect(verdict.probability).toBeLessThanOrEqual(1)
    expect(typeof verdict.fullToCrosswalk).toBe('boolean')
  })

  it('returns null when the model is disabled', async () => {
    const buf = await solidJpeg(255)
    expect(await classifyLineup(buf, { enabled: false })).toBe(null)
  })

  it('classifies bright vs dark ROI with a hand-built model', async () => {
    const bright = await classifyLineup(await solidJpeg(250), brightModel)
    const dark = await classifyLineup(await solidJpeg(5), brightModel)
    expect(bright.fullToCrosswalk).toBe(true)
    expect(bright.probability).toBeGreaterThan(0.9)
    expect(dark.fullToCrosswalk).toBe(false)
    expect(dark.probability).toBeLessThan(0.1)
  })

  it('returns null rather than throwing on a non-image buffer', async () => {
    expect(await classifyLineup(Buffer.from('garbage'), brightModel)).toBe(null)
  })

  it('scoreFeatures is a plain logistic over the feature vector', () => {
    const f = new Float32Array(FEATURE_LENGTH).fill(1)
    const p = scoreFeatures(f, brightModel)
    expect(p).toBeCloseTo(1 / (1 + Math.exp(-(FEATURE_LENGTH * 0.01 - 6))), 5)
  })
})
