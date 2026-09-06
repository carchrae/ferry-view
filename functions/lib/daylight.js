// Is it dark at the Bowen terminal at a given time? Clock-based, not
// image-based: the webcam's auto-exposure normalizes brightness (no archived
// frame has mean luminance below 0.35, day or night), so pixels can't tell —
// solar elevation can. NOAA-style approximation, good to a fraction of a
// degree, which is plenty for a twilight cutoff. No dependencies.
const LAT = 49.38 // Snug Cove, Bowen Island
const LON = -123.33

// Solar elevation in degrees at a JS epoch-ms timestamp.
export function solarElevation(tsMs, lat = LAT, lon = LON) {
  const d = tsMs / 86400000 - 10957.5 // days since J2000.0
  const g = ((357.529 + 0.98560028 * d) * Math.PI) / 180 // mean anomaly
  const q = 280.459 + 0.98564736 * d // mean longitude
  const L = ((q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * Math.PI) / 180 // ecliptic long.
  const e = ((23.439 - 0.00000036 * d) * Math.PI) / 180 // obliquity
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) // right ascension
  const dec = Math.asin(Math.sin(e) * Math.sin(L)) // declination
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24) * 15 // deg
  const ha = (((gmst + lon) * Math.PI) / 180 - ra + Math.PI * 3) % (Math.PI * 2) - Math.PI
  const latR = (lat * Math.PI) / 180
  const sinEl = Math.sin(latR) * Math.sin(dec) + Math.cos(latR) * Math.cos(dec) * Math.cos(ha)
  return (Math.asin(sinEl) * 180) / Math.PI
}

// Dark = sun below −7° (a bit past civil twilight's −6°). Where the line
// sits, from the 2026-09 archive (training-data/experiments/
// dark-frame-analysis.mjs, community cam):
//   - frames stay VISIBLE to about −8° (median luminance 0.34 in the
//     −8..−6 band vs 0.40 in daylight); below −8/−9 they go genuinely black
//     (0.15–0.19),
//   - but the crosswalk model is unreliable on dusk lighting even when the
//     image is visible — a rider-refuted detection sits at −6.9° with
//     luminance 0.36 — and NO real detection in the archive was ever lost
//     to gating anywhere below −6 (dawn twilight lineups never produced a
//     confirmed pair),
//   - −6 was measurably too pessimistic at dawn (2026-09-06: 06:00 was
//     −6.6°, image clearly visible, owl shown — Tom's report).
// −7 is the compromise: the visible early-dawn band classifies, the
// refuted −6.9 dusk case stays gated only via the pair rule, and −8 (full
// visibility) is the number to revisit once a twilight/night model exists.
// Terminal-cars frames in the dark are treated as UNKNOWN by callers — that
// camera's street light keeps its classifier active regardless.
export const DARK_ELEVATION_DEG = -7
export function isDarkAt(tsMs) {
  return solarElevation(tsMs) < DARK_ELEVATION_DEG
}
