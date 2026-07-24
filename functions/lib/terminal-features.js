import sharp from 'sharp'

// Feature extraction for the TERMINAL-CARS classifier — "are there cars
// waiting in the Bowen terminal frame?" — fully independent of the crosswalk
// classifier (lineup-features.js): its own region, grid, and model file.
//
// The terminal camera looks down the loading road; cars queue along the
// center-left lane. The region covers that lane and excludes the timestamp
// banner across the bottom and the static pole/sign on the right edge.
// PLACEHOLDER drawn by eye from 2026-07-23 frames — refine with the report's
// ROI picker workflow before serious training (a region change invalidates
// trained weights; retrain).
export const TERMINAL_REGIONS = [
  {
    name: 'loading lane',
    roi: { left: 0.2, top: 0.05, width: 0.55, height: 0.75 },
    width: 32,
    height: 32,
  },
]

export const TERMINAL_FEATURE_LENGTH = TERMINAL_REGIONS.reduce(
  (a, r) => a + r.width * r.height,
  0,
)

// JPEG buffer → Float32Array of TERMINAL_FEATURE_LENGTH grayscale values in
// [0, 1] — same crop→downscale→greyscale→normalize shape as the crosswalk
// pipeline, so the trainer/runtime code mirrors it.
export async function extractTerminalFeatures(buf) {
  const meta = await sharp(buf).metadata()
  const out = new Float32Array(TERMINAL_FEATURE_LENGTH)
  let offset = 0
  for (const { roi, width, height } of TERMINAL_REGIONS) {
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
