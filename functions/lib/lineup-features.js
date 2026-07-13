import sharp from 'sharp'

// Shared preprocessing for the lineup classifier. The SAME code runs at
// training time (scripts/train-lineup-classifier.mjs) and at inference time
// (lib/lineup-classifier.js), so there is no Python/JS drift to worry about.
//
// The community camera never moves, so the classifier only looks at a fixed
// region of interest: the car lane approaching the terminal, up to the
// crosswalk. Fractions of the frame, not pixels, so the crop survives a
// camera resolution change. PLACEHOLDER: currently the lower half of the
// frame — tune by eye against real timelapse frames before the first real
// training run (any ROI change invalidates trained weights; retrain).
export const ROI = { left: 0.0, top: 0.5, width: 1.0, height: 0.5 }

export const FEATURE_WIDTH = 48
export const FEATURE_HEIGHT = 27
export const FEATURE_LENGTH = FEATURE_WIDTH * FEATURE_HEIGHT

// JPEG buffer → Float32Array of FEATURE_LENGTH grayscale values in [0, 1]:
// ROI crop, downscale, greyscale, normalize.
export async function extractFeatures(buf) {
  const meta = await sharp(buf).metadata()
  const left = Math.round(ROI.left * meta.width)
  const top = Math.round(ROI.top * meta.height)
  const region = {
    left,
    top,
    width: Math.max(1, Math.min(Math.round(ROI.width * meta.width), meta.width - left)),
    height: Math.max(1, Math.min(Math.round(ROI.height * meta.height), meta.height - top)),
  }
  const raw = await sharp(buf)
    .extract(region)
    .resize(FEATURE_WIDTH, FEATURE_HEIGHT, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer()
  const out = new Float32Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw[i] / 255
  return out
}

// Label a timelapse frame from a human crosswalk tag: frames captured at or
// after the tag show a lineup that has reached the crosswalk. Used by the
// dataset exporter; kept here so it's unit-tested alongside the classifier.
export function labelForTimestamp(frameTs, crosswalkAt) {
  if (typeof frameTs !== 'number' || typeof crosswalkAt !== 'number') return null
  return frameTs >= crosswalkAt ? 1 : 0
}
