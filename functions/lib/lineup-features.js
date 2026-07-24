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
