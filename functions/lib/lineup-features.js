import sharp from 'sharp'

// Shared preprocessing for the lineup classifier. The SAME code runs at
// training time (scripts/train-lineup-classifier.mjs) and at inference time
// (lib/lineup-classifier.js), so there is no Python/JS drift to worry about.
//
// The community camera never moves, so the classifier looks at two fixed
// regions (fractions of the frame, hand-drawn with the report's ROI picker):
//  - left:  the lane where the queue tail builds — the strong "long line"
//    signal (a tail this long usually means it has passed the crosswalk),
//  - right: the crosswalk itself — weak alone at this resolution, but
//    combined it confirms the crossing (recall 0.86 → 0.93 in the ROI
//    experiments; see docs/lineup-classifier.md).
// Features are the two crops' grayscale pixels concatenated, left first.
// Any region change invalidates trained weights; retrain.
export const REGIONS = [
  {
    name: 'left lane',
    roi: { left: 0.002, top: 0.45, width: 0.567, height: 0.244 },
    width: 48,
    height: 27,
  },
  {
    name: 'crosswalk',
    roi: { left: 0.578, top: 0.424, width: 0.349, height: 0.153 },
    width: 24,
    height: 14,
  },
]

export const FEATURE_LENGTH = REGIONS.reduce((a, r) => a + r.width * r.height, 0)

// JPEG buffer → Float32Array of FEATURE_LENGTH grayscale values in [0, 1]:
// per region crop → downscale → greyscale → normalize, then concatenate.
export async function extractFeatures(buf) {
  const meta = await sharp(buf).metadata()
  const out = new Float32Array(FEATURE_LENGTH)
  let offset = 0
  for (const { roi, width, height } of REGIONS) {
    const left = Math.round(roi.left * meta.width)
    const top = Math.round(roi.top * meta.height)
    const region = {
      left,
      top,
      width: Math.max(1, Math.min(Math.round(roi.width * meta.width), meta.width - left)),
      height: Math.max(1, Math.min(Math.round(roi.height * meta.height), meta.height - top)),
    }
    const raw = await sharp(buf)
      .extract(region)
      .resize(width, height, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer()
    for (let i = 0; i < raw.length; i++) out[offset + i] = raw[i] / 255
    offset += raw.length
  }
  return out
}

// --- Night: stable-pixel composites ------------------------------------------
// The community cam doesn't auto-expose: night frames are near-black and a
// passing car's headlights bloom across both regions, which the day model
// reads as a queue (2026-10-07 experiment, docs/lineup-classifier.md "Night:
// stable-pixel composites"). Compositing a trailing window of frames and
// keeping only the pixels that are STABLE across it removes the sweeping
// blooms while a stationary queue's lights stay. These helpers are the one
// implementation shared by the night trainer, the labelling page and the
// server's night path, so train/serve preprocessing can't drift.
//
// Every frame is first reduced to a canonical 640x360 single-channel grey
// buffer (the stored size; the rare uncompressed 1280x720 fallback is
// resized), composited pixel-wise, re-encoded as JPEG q80 (the same bytes
// shape the day path classifies) and run through extractFeatures above.
export const COMPOSITE = {
  width: 640,
  height: 360,
  // Trailing window: this many distinct frames, ~1 min apart in production
  // (per-minute probes), 5 min apart in the archive.
  k: 3,
  // A pixel whose min..max range across the window is under tau is stable
  // and keeps its median; a moving pixel takes the window minimum.
  tau: 24,
  // Frames further apart than this can't share a window (a capture gap).
  maxGapMs: 7 * 60 * 1000,
}

export async function toCanonicalGrey(buf, { width = COMPOSITE.width, height = COMPOSITE.height } = {}) {
  const { data, info } = await sharp(buf)
    .resize(width, height, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (info.channels !== 1 || data.length !== width * height) {
    throw new Error(`canonical grey: unexpected ${info.width}x${info.height}x${info.channels}`)
  }
  return data
}

// Per-pixel median of 1..n equal-length grey buffers (2 → mean).
export function compositeMedian(greys) {
  const k = greys.length
  const n = greys[0].length
  const out = Buffer.alloc(n)
  if (k === 1) return Buffer.from(greys[0])
  if (k === 2) {
    for (let i = 0; i < n; i++) out[i] = (greys[0][i] + greys[1][i]) >> 1
    return out
  }
  if (k === 3) {
    const [a, b, c] = greys
    for (let i = 0; i < n; i++) {
      out[i] = Math.max(Math.min(a[i], b[i]), Math.min(Math.max(a[i], b[i]), c[i]))
    }
    return out
  }
  const tmp = new Array(k)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < k; j++) tmp[j] = greys[j][i]
    tmp.sort((p, q) => p - q)
    out[i] = k % 2 ? tmp[(k - 1) / 2] : (tmp[k / 2 - 1] + tmp[k / 2]) >> 1
  }
  return out
}

// Stable-pixel composite: median where the window agrees (range < tau),
// window minimum where it moves. One frame passes through unchanged.
export function compositeStable(greys, tau = COMPOSITE.tau) {
  const n = greys[0].length
  if (greys.length === 1) return Buffer.from(greys[0])
  const med = compositeMedian(greys)
  const out = Buffer.alloc(n)
  for (let i = 0; i < n; i++) {
    let mn = 255
    let mx = 0
    for (const g of greys) {
      const v = g[i]
      if (v < mn) mn = v
      if (v > mx) mx = v
    }
    out[i] = mx - mn < tau ? med[i] : mn
  }
  return out
}

export async function greyToJpeg(grey, { width = COMPOSITE.width, height = COMPOSITE.height, quality = 80 } = {}) {
  return sharp(grey, { raw: { width, height, channels: 1 } }).jpeg({ quality }).toBuffer()
}

// JPEG buffers of a trailing window (oldest first, the frame being judged
// last) → the night model's features: canonical grey each, stable composite,
// JPEG q80, then the same crop/downscale as the day features.
export async function extractCompositeFeatures(jpegs, { tau = COMPOSITE.tau } = {}) {
  const greys = []
  for (const j of jpegs) greys.push(await toCanonicalGrey(j))
  return extractFeatures(await greyToJpeg(compositeStable(greys, tau)))
}

// Tag→label semantics live in lineup-labels.js (shared with the app's
// triggers and the exporter, and free of the sharp dependency); re-exported
// here so feature+label consumers (the trainer) have one import.
export {
  labelForTimestamp,
  effectiveCrosswalkAt,
  firstSustainedPositiveTs,
} from './lineup-labels.js'

// Small review-page thumbnail. Lives here (not in the trainer) because sharp
// resolves against functions/node_modules — repo-root scripts can't import
// it directly.
export async function thumbnailJpeg(buf, { width = 320, quality = 60 } = {}) {
  return sharp(buf).resize({ width }).jpeg({ quality }).toBuffer()
}
