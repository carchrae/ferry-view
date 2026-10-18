import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import { extractFeatures, REGIONS, LINEUP_FEATURE_MASK, LINEUP_FEATURE_SET } from '../lib/lineup-features.js'
import { grayFromRgba, cellStdGrid, standardizeRegions, regionRect } from '../lib/terminal-feature-math.js'
import { scoreWithMembers } from '../lib/model-members.js'

// The browser mirror (src/composables/useLineupClassifier.js) cannot run
// here — no canvas — but its arithmetic is exactly this: RGBA bytes from
// getImageData → grayFromRgba → cellStdGrid per region → standardizeRegions,
// over the same regionRect crops the server uses. Feeding it the decoded
// pixels sharp would hand a canvas pins the two paths together; what is left
// is the luma weights and the JPEG decoder, and this test says how far those
// may move a score. (Same contract as terminal-feature-parity.test.js.)
const HERE = dirname(fileURLToPath(import.meta.url))
const model = JSON.parse(readFileSync(join(HERE, '../models/lineup-classifier.json'), 'utf8'))

async function browserPathFeatures(buf) {
  const meta = await sharp(buf).metadata()
  const features = new Float32Array(REGIONS.reduce((a, r) => a + r.width * r.height, 0))
  let offset = 0
  for (const { roi, width, height } of REGIONS) {
    const rect = regionRect(roi, meta.width, meta.height)
    const rgba = await sharp(buf).extract(rect).ensureAlpha().raw().toBuffer()
    cellStdGrid(grayFromRgba(rgba), rect.width, rect.height, width, height, features, offset)
    offset += width * height
  }
  return standardizeRegions(features, REGIONS, LINEUP_FEATURE_MASK)
}

const frames = [
  ['lineup-frame-day-full.jpg', 1],
  ['lineup-frame-day-empty.jpg', 0],
  ['lineup-frame-twilight-full.jpg', 1],
]

describe('crosswalk features: browser arithmetic vs server extractor', () => {
  it('the bundled model is from this build’s feature set', () => {
    expect(model.featureSet).toBe(LINEUP_FEATURE_SET)
  })

  for (const [file, label] of frames) {
    it(`${file}: same features and score within tolerance`, async () => {
      const buf = readFileSync(join(HERE, 'fixtures', file))
      const server = await extractFeatures(buf)
      const browser = await browserPathFeatures(buf)
      expect(browser.length).toBe(server.length)
      let maxDelta = 0
      let sumDelta = 0
      for (let i = 0; i < server.length; i++) {
        const d = Math.abs(server[i] - browser[i])
        maxDelta = Math.max(maxDelta, d)
        sumDelta += d
      }
      // This camera is colour and its cells are small (~7×3 px), so the two
      // luma formulas can move one strongly coloured cell by up to ~0.14 of
      // a feature range of about ±0.6 (measured 2026-10-18: 0.08 and 0.14 on
      // the day fixtures); across the vector the difference is tiny, and the
      // score moves by under 0.01 (48 frames in headless Chromium, all
      // bands: max 0.0075).
      expect(maxDelta).toBeLessThan(0.2)
      expect(sumDelta / server.length).toBeLessThan(0.01)
      // Capture time only matters for a model with daylight members; the
      // crosswalk model is single-band, any daytime epoch will do.
      const ts = 1792069819027
      const pServer = scoreWithMembers(model, server, ts)
      const pBrowser = scoreWithMembers(model, browser, ts)
      expect(Math.abs(pServer - pBrowser)).toBeLessThan(0.02)
      const th = model.threshold ?? 0.7
      expect(pServer >= th ? 1 : 0).toBe(label)
      expect(pBrowser >= th ? 1 : 0).toBe(label)
    })
  }
})
