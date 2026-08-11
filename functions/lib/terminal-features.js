import sharp from 'sharp'

// Feature extraction for the TERMINAL-CARS classifier — "are there cars
// waiting in the Bowen terminal frame?" — fully independent of the crosswalk
// classifier (lineup-features.js): its own region, grid, and model file.
//
// The terminal camera looks down the loading road; cars queue along the
// center-left lane, receding up-left with perspective. Regions redrawn
// 2026-08-10 via the report page's ROI picker (previous set was narrower and
// missed part of the queue):
//  - near lane: the queue front and most of the lower road — the last part
//    to empty before departure. As drawn it reached y=0.996; the bottom is
//    trimmed to y=0.87 to exclude the timestamp banner, which 5-fold CV
//    showed costs ~1.4pt accuracy when included.
//  - far queue: the uphill tail, a vertical band on the upper left. Still
//    clears the ebike shop's golf cart (parks lower-left) — it must never
//    read as a waiting car.
// A region change invalidates trained weights; retrain.
export const TERMINAL_REGIONS = [
  {
    name: 'near lane',
    roi: { left: 0.373, top: 0.45, width: 0.558, height: 0.42 },
    width: 32,
    height: 18,
  },
  {
    name: 'far queue',
    // A wider box (left 0.287, w 0.35, top 0.10, h 0.352) was tried
    // 2026-08-11 to catch cars at the very top of the frame (e.g.
    // 2026-08-06 11:15): it did NOT change those frames' scores but cost
    // ~5pt frame precision and ~10 sailings of verdict coverage — reverted.
    // The crosswalk veto already suppresses the flag on that sailing.
    roi: { left: 0.277, top: 0.06, width: 0.228, height: 0.373 },
    width: 20,
    height: 18,
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
