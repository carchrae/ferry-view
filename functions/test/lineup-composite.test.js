import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import {
  COMPOSITE,
  toCanonicalGrey,
  compositeMedian,
  compositeStable,
  greyToJpeg,
  extractCompositeFeatures,
  sameExposureWindow,
  meanLuminance,
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
    // Flat frames at 128 / 64 / 128: the 64 frame differs by 0.25 in mean
    // luminance from the judged frame — an exposure-mode change — so it is
    // dropped and the two 128 frames composite (mean of two = 128).
    expect(f.framesUsed).toBe(2)
    expect(f[0]).toBeGreaterThan(0.45)
    expect(f[0]).toBeLessThan(0.55)
    // Same-exposure frames composite normally: judged frame 64, neighbours 128
    // are dropped; judged frame 128 with 128 neighbours keeps all three.
    const fb = await extractCompositeFeatures([small, small, big])
    expect(fb.framesUsed).toBe(1)
    expect(fb[0]).toBeLessThan(0.3)
    const fs = await extractCompositeFeatures([small, small, small])
    expect(fs.framesUsed).toBe(3)
  })

  it('sameExposureWindow drops frames from another exposure mode, never the judged frame', () => {
    const dark = Buffer.alloc(100, 40) // 0.157
    const bright = Buffer.alloc(100, 120) // 0.47
    const darkish = Buffer.alloc(100, 50) // 0.196
    expect(meanLuminance(dark)).toBeCloseTo(40 / 255, 3)
    expect(sameExposureWindow([bright, darkish, dark])).toEqual([darkish, dark])
    expect(sameExposureWindow([dark, dark, bright])).toEqual([bright])
    expect(sameExposureWindow([dark, darkish, dark], 0.01)).toEqual([dark, dark])
  })
})
