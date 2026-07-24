import sharp from 'sharp'

// Feature extraction for the TERMINAL-CARS classifier — "are there cars
// waiting in the Bowen terminal frame?" — fully independent of the crosswalk
// classifier (lineup-features.js): its own region, grid, and model file.
//
// The terminal camera looks down the loading road; cars queue along the
// center-left lane, receding up-left with perspective. Two regions, tuned by
// eye against 2026-07 frames with overlays:
//  - near lane: the queue front — the last part to empty before departure.
//    Right edge stops at the road's center line so oncoming (unloading)
//    traffic and the static blue sign stay out.
//  - far queue: the uphill tail. Starts high enough (top 42%) to clear the
//    ebike shop's golf cart, which parks in the LOWER left third of the
//    frame and must never read as a waiting car.
// The bottom timestamp banner (y > 0.87) is excluded from both.
// A region change invalidates trained weights; retrain.
export const TERMINAL_REGIONS = [
  {
    name: 'near lane',
    roi: { left: 0.34, top: 0.42, width: 0.27, height: 0.45 },
    width: 24,
    height: 24,
  },
  {
    name: 'far queue',
    roi: { left: 0.18, top: 0.05, width: 0.42, height: 0.37 },
    width: 32,
    height: 12,
  },
]

export const TERMINAL_FEATURE_LENGTH = TERMINAL_REGIONS.reduce(
  (a, r) => a + r.width * r.height,
  0,
)

// JPEG buffer → Float32Array of TERMINAL_FEATURE_LENGTH grayscale values,
// PER-FRAME MEAN-CENTERED (each value minus the frame's mean brightness).
// The terminal cam spans full daylight to night: raw intensities encode
// time-of-day more than content, and centering removes that global term —
// in the 2026-07 experiments it lifted test accuracy from 0.60 to 0.84.
// Same code at training and inference, so there is no skew.
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
  let mean = 0
  for (let i = 0; i < out.length; i++) mean += out[i]
  mean /= out.length
  for (let i = 0; i < out.length; i++) out[i] -= mean
  return out
}
