import sharp from 'sharp'
import {
  cellStdGrid,
  standardizeRegions,
  featureMask,
  regionRect,
  TERMINAL_FEATURE_SET,
} from './terminal-feature-math.js'

export { TERMINAL_FEATURE_SET }

// Feature extraction for the TERMINAL-CARS classifier — "are there cars
// waiting in the Bowen terminal frame?" — fully independent of the crosswalk
// classifier (lineup-features.js): its own region, grid, and model file.
// The arithmetic lives in terminal-feature-math.js (shared with the browser
// mirror and the trainer); this file owns the geometry and the sharp I/O.
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
// are forced to exactly 0 AFTER standardising, and are excluded from the
// region statistics — so they can neither shift them nor earn a weight
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

// Per-feature keep flags, computed once from the region grids: a cell's frame
// coordinate is its centre within the region's crop.
export const TERMINAL_FEATURE_MASK = featureMask(TERMINAL_REGIONS, TERMINAL_MASKS)

// JPEG buffer → Float32Array of TERMINAL_FEATURE_LENGTH values: per-cell
// LOCAL STANDARD DEVIATION of the native greyscale pixels, standardised per
// region (feature set localStd-v1 — the why is in terminal-feature-math.js).
// The old per-frame mean-centred brightness (2026-07 … 2026-10) could not
// tell a grey car from grey asphalt at low sun. Same code at training and
// inference, so there is no skew.
export async function extractTerminalFeatures(buf) {
  const meta = await sharp(buf).metadata()
  const out = new Float32Array(TERMINAL_FEATURE_LENGTH)
  let offset = 0
  for (const { roi, width, height } of TERMINAL_REGIONS) {
    const rect = regionRect(roi, meta.width, meta.height)
    const gray = await sharp(buf).extract(rect).greyscale().raw().toBuffer()
    cellStdGrid(gray, rect.width, rect.height, width, height, out, offset)
    offset += width * height
  }
  // Bytes → units before standardising (the z-score is scale-free, but the
  // browser mirror works in 0..1 and the trainer's L2 assumes that range).
  for (let i = 0; i < out.length; i++) out[i] /= 255
  return standardizeRegions(out, TERMINAL_REGIONS, TERMINAL_FEATURE_MASK)
}
