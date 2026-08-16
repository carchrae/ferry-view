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
    // (That sailing's bad flag is handled by the stricter empty threshold,
    // not by the region.)
    roi: { left: 0.277, top: 0.06, width: 0.228, height: 0.373 },
    width: 20,
    height: 18,
  },
]

export const TERMINAL_FEATURE_LENGTH = TERMINAL_REGIONS.reduce(
  (a, r) => a + r.width * r.height,
  0,
)

// Static clutter inside the regions that never carries queue information but
// does change with the light (shadows, glare, wet/dry): the signpost with the
// fare sign, and the pedestrian walkway. Cells whose centre falls in a mask
// are forced to exactly 0 AFTER mean-centering, and are excluded from the
// mean itself — so they can neither shift the centering nor earn a weight
// (a feature that is always 0 gets zero gradient and decays under L2).
//
// The feature vector keeps its length, so the report's weight maps still line
// up with the region grids; masked cells simply render neutral. Changing a
// mask invalidates trained weights — retrain.
export const TERMINAL_MASKS = [
  // The pole leans left going down; the box spans its full travel plus the
  // blue fare sign hanging at y 0.53–0.79.
  { name: 'pole + fare sign', roi: { left: 0.645, top: 0.0, width: 0.17, height: 1.0 } },
  // Pedestrian walkway on the terminal side — people and bikes, never a
  // queued car.
  { name: 'walkway', roi: { left: 0.0, top: 0.4, width: 0.34, height: 0.6 } },
]

const inMask = (fx, fy) =>
  TERMINAL_MASKS.some(
    ({ roi }) =>
      fx >= roi.left && fx < roi.left + roi.width && fy >= roi.top && fy < roi.top + roi.height,
  )

// Per-feature keep flags, computed once from the region grids: a cell's frame
// coordinate is its centre within the region's crop.
export const TERMINAL_FEATURE_MASK = (() => {
  const keep = new Uint8Array(TERMINAL_FEATURE_LENGTH)
  let offset = 0
  for (const { roi, width, height } of TERMINAL_REGIONS) {
    for (let gy = 0; gy < height; gy++) {
      for (let gx = 0; gx < width; gx++) {
        const fx = roi.left + ((gx + 0.5) / width) * roi.width
        const fy = roi.top + ((gy + 0.5) / height) * roi.height
        keep[offset + gy * width + gx] = inMask(fx, fy) ? 0 : 1
      }
    }
    offset += width * height
  }
  return keep
})()

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
  // Mean over UNMASKED cells only, then zero the masked ones.
  let mean = 0
  let kept = 0
  for (let i = 0; i < out.length; i++) {
    if (TERMINAL_FEATURE_MASK[i]) {
      mean += out[i]
      kept++
    }
  }
  mean /= kept || 1
  for (let i = 0; i < out.length; i++) out[i] = TERMINAL_FEATURE_MASK[i] ? out[i] - mean : 0
  return out
}
