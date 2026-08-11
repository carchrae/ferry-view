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

// Dark = sun below civil twilight (−6°). Terminal-cars frames taken in the
// dark are treated as UNKNOWN — the model misreads headlights/glare (night
// error is ~2× daytime), so dark frames neither confirm emptiness nor count
// as cars. In winter most evening sailings will be dark; a dedicated
// night model (more labeled dark frames) is the eventual fix.
export function isDarkAt(tsMs) {
  return solarElevation(tsMs) < -6
}
