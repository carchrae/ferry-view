import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import {
  extractTerminalFeatures,
  TERMINAL_REGIONS,
  TERMINAL_FEATURE_MASK,
} from '../lib/terminal-features.js'
import {
  grayFromRgba,
  cellStdGrid,
  standardizeRegions,
  regionRect,
} from '../lib/terminal-feature-math.js'
import { scoreWithMembers } from '../lib/model-members.js'

// The browser mirror (src/composables/useTerminalClassifier.js) cannot run
// here — no canvas — but its arithmetic is exactly this: RGBA bytes from
// getImageData → grayFromRgba → cellStdGrid per region → standardizeRegions,
// over the same regionRect crops the server uses. Feeding it the decoded
// pixels sharp would hand a canvas pins the two paths together: the only
// differences left are the luma weights (Rec. 601 in the browser, libvips'
// greyscale on the server) and the JPEG decoder, and this test says how
// much those may move a score. Measured 2026-10-18 in headless Chromium on
// 48 frames across all light bands: max score delta 0.009.
const FIXTURES = dirname(fileURLToPath(import.meta.url)) + '/fixtures'
const model = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../models/terminal-cars-classifier.json'), 'utf8'),
)

async function browserPathFeatures(buf) {
  const meta = await sharp(buf).metadata()
  const length = TERMINAL_REGIONS.reduce((a, r) => a + r.width * r.height, 0)
  const features = new Float32Array(length)
  let offset = 0
  for (const { roi, width, height } of TERMINAL_REGIONS) {
    const rect = regionRect(roi, meta.width, meta.height)
    // What drawImage + getImageData yield: RGBA, 4 bytes per pixel, row-major.
    const rgba = await sharp(buf).extract(rect).ensureAlpha().raw().toBuffer()
    const gray = grayFromRgba(rgba)
    cellStdGrid(gray, rect.width, rect.height, width, height, features, offset)
    offset += width * height
  }
  return standardizeRegions(features, TERMINAL_REGIONS, TERMINAL_FEATURE_MASK)
}

const frames = [
  ['terminal-frame-day-cars.jpg', 1],
  ['terminal-frame-night-cars.jpg', 1],
  ['terminal-frame-dusk-empty.jpg', 0],
]

describe('terminal features: browser arithmetic vs server extractor', () => {
  for (const [file, label] of frames) {
    it(`${file}: same features and score within tolerance`, async () => {
      const buf = readFileSync(join(FIXTURES, file))
      const server = await extractTerminalFeatures(buf)
      const browser = await browserPathFeatures(buf)
      expect(browser.length).toBe(server.length)
      let maxDelta = 0
      for (let i = 0; i < server.length; i++) {
        maxDelta = Math.max(maxDelta, Math.abs(server[i] - browser[i]))
        if (!TERMINAL_FEATURE_MASK[i]) expect(browser[i]).toBe(0)
      }
      // Standardised features span about ±0.6. The luma weights move a cell
      // by a few thousandths in a textured frame; in a flat dusk frame the
      // region's spread is tiny and the z-score magnifies the same difference
      // (0.020 on the dusk-empty fixture, 2026-10-18).
      expect(maxDelta).toBeLessThan(0.05)
      const ts = 1784871623624
      const pServer = scoreWithMembers(model, server, ts)
      const pBrowser = scoreWithMembers(model, browser, ts)
      expect(Math.abs(pServer - pBrowser)).toBeLessThan(0.02)
      // And both land on the hand label's side of the threshold.
      expect(pServer >= (model.threshold ?? 0.5) ? 1 : 0).toBe(label)
      expect(pBrowser >= (model.threshold ?? 0.5) ? 1 : 0).toBe(label)
    })
  }

  it('grayFromRgba is Rec. 601 luma in 0..1', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255])
    const g = grayFromRgba(data)
    expect(Array.from(g).map((v) => +v.toFixed(3))).toEqual([0.299, 0.587, 0.114, 1])
  })
})
