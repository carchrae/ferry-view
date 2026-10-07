import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import {
  COMPOSITE,
  toCanonicalGrey,
  compositeMedian,
  compositeStable,
  greyToJpeg,
  extractCompositeFeatures,
  FEATURE_LENGTH,
} from '../lib/lineup-features.js'

const grey = (...vals) => Buffer.from(vals)

describe('composite helpers', () => {
  it('median of 3 is the middle value, of 2 the mean, of 1 itself', () => {
    expect([...compositeMedian([grey(10, 200), grey(50, 100), grey(30, 150)])]).toEqual([30, 150])
    expect([...compositeMedian([grey(10), grey(30)])]).toEqual([20])
    expect([...compositeMedian([grey(7)])]).toEqual([7])
    // General k (5) matches a sort.
    expect([...compositeMedian([grey(9), grey(1), grey(5), grey(3), grey(7)])]).toEqual([5])
  })

  it('stable keeps the median where the window agrees and the minimum where it moves', () => {
    const a = grey(20, 20, 200)
    const b = grey(22, 60, 10)
    const c = grey(21, 40, 15)
    // px0: range 2 < tau → median 21; px1: range 40 ≥ 24 → min 20;
    // px2: a headlight bloom in one frame → min 10.
    expect([...compositeStable([a, b, c], 24)]).toEqual([21, 20, 10])
    expect([...compositeStable([a], 24)]).toEqual([20, 20, 200])
  })

  it('canonical grey is 640x360x1 whatever the input size, and the pipeline yields model features', async () => {
    const small = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#808080' } })
      .jpeg()
      .toBuffer()
    const big = await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#404040' } })
      .jpeg()
      .toBuffer()
    const gs = await toCanonicalGrey(small)
    const gb = await toCanonicalGrey(big)
    expect(gs.length).toBe(COMPOSITE.width * COMPOSITE.height)
    expect(gb.length).toBe(COMPOSITE.width * COMPOSITE.height)
    expect(gs[0]).toBeGreaterThan(gb[0])
    const jpeg = await greyToJpeg(compositeStable([gs, gb, gs]))
    const meta = await sharp(jpeg).metadata()
    expect([meta.width, meta.height]).toEqual([640, 360])
    const f = await extractCompositeFeatures([small, big, small])
    expect(f.length).toBe(FEATURE_LENGTH)
    // Flat frames at 128 / 64 / 128: the range (64) exceeds tau, so the
    // stable composite takes the window MINIMUM (64 → 0.25), not the median.
    expect(f[0]).toBeGreaterThan(0.2)
    expect(f[0]).toBeLessThan(0.3)
    // With a flat window the stable composite is the median (two of three).
    const fm = await extractCompositeFeatures([small, small, big], { tau: 255 })
    expect(fm[0]).toBeGreaterThan(0.45)
    expect(fm[0]).toBeLessThan(0.55)
  })
})
