import { logger } from 'firebase-functions/logger'

// Position-based fallback for arrival/departure status. When bowenferry.ca's atberth
// event log freezes but its live AIS position feed keeps updating, we can still tell
// where the ferry is by its coordinates + speed: parked (SOG ~0) within a terminal's
// dock radius means it's "at" that terminal. Comparing that classification across polls
// yields Arrived/Departed events we inject back into `recentActivity` — the same shape
// the atberth log produces. Preferred over the BC Ferries website scrape (see index.js)
// because it needs no extra network call and recovers BOTH directions (the scraper only
// recovers HSB -> Bowen).

// Terminal reference points (WGS84). Bowen (Snug Cove) is taken from an observed
// docked-vessel position; Horseshoe Bay is the dock location (it has three berths, all
// within the dock radius below).
export const TERMINALS = [
  { location: 'Bowen', lat: 49.3793, lon: -123.3307 },
  { location: 'Horseshoe Bay', lat: 49.375995, lon: -123.271693 },
]

// The two terminals are ~5 km apart, so a generous radius can't ambiguously match both.
// 600 m also comfortably spans Horseshoe Bay's three berths.
export const DOCK_RADIUS_M = 600
// At or below this speed the vessel is considered stopped (docked), not maneuvering.
export const STOPPED_SOG_KNOTS = 0.6

// Web Mercator (EPSG:3857) sphere radius — the feed's coordinates are in metres on this
// projection (e.g. [-13729111, 6339467]).
const MERCATOR_R = 6378137.0
// Mean Earth radius (metres) for great-circle distance.
const EARTH_R = 6371000

/**
 * Inverse Web Mercator: EPSG:3857 metres -> {lat, lon} in degrees.
 */
export function mercatorToLatLon(x, y) {
  const lon = (x / MERCATOR_R) * (180 / Math.PI)
  const lat = (180 / Math.PI) * (2 * Math.atan(Math.exp(y / MERCATOR_R)) - Math.PI / 2)
  return { lat, lon }
}

/**
 * Great-circle distance in metres between two lat/lon points.
 */
export function haversineMeters(aLat, aLon, bLat, bLon) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.sqrt(s))
}

/**
 * Pull the vessel's position out of the raw AIS GeoJSON FeatureCollection.
 * Prefers an explicit vessel Point feature; falls back to the centroid of the
 * vessel-footprint Polygon. Returns {lat, lon} in degrees, or null if absent.
 */
export function extractVesselPosition(geojson) {
  const features = geojson?.features
  if (!Array.isArray(features)) return null

  const point = features.find(
    (f) => f?.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates),
  )
  if (point) {
    const [x, y] = point.geometry.coordinates
    return mercatorToLatLon(x, y)
  }

  const poly = features.find((f) => f?.geometry?.type === 'Polygon')
  const ring = poly?.geometry?.coordinates?.[0]
  if (Array.isArray(ring) && ring.length) {
    let sx = 0
    let sy = 0
    for (const [x, y] of ring) {
      sx += x
      sy += y
    }
    return mercatorToLatLon(sx / ring.length, sy / ring.length)
  }
  return null
}

/**
 * Classify where the vessel is from its position and speed.
 * @returns {'Bowen'|'Horseshoe Bay'|null} the terminal it is docked at (stopped and
 *   within dock radius), or null when moving / not near either terminal (in transit).
 */
export function classifyTerminal(position, sog) {
  if (!position) return null
  const speed = typeof sog === 'string' ? parseFloat(sog) : sog
  if (!Number.isFinite(speed) || speed > STOPPED_SOG_KNOTS) return null

  let best = null
  for (const t of TERMINALS) {
    const d = haversineMeters(position.lat, position.lon, t.lat, t.lon)
    if (d <= DOCK_RADIUS_M && (!best || d < best.d)) best = { location: t.location, d }
  }
  return best ? best.location : null
}

/**
 * Inject Arrived/Departed events derived from a change in the AIS-position
 * classification since the previous poll. `data.aisLocation` is the current token
 * (`'Bowen'` | `'Horseshoe Bay'` | `'transit'`, set in parseFerryData);
 * `existingData.aisLocation` is the previous poll's token. On a real transition we
 * emit a Departed for the terminal just left and/or an Arrived for the terminal just
 * reached, mirroring the atberth log's `{action, location, time}` shape.
 * @returns {number} count of events added.
 */
export function augmentFromAisPosition(data, existingData, now) {
  const current = data.aisLocation
  const prev = existingData?.aisLocation
  // No usable prior state, or no change -> nothing to emit. (First run just records
  // state; steady transit / steady docked emit nothing.)
  if (!current || !prev || prev === current) return 0

  const time = now.format('HH:mm')
  const seen = new Set((data.recentActivity || []).map((e) => `${e.action}_${e.location}_${e.time}`))
  let added = 0
  const emit = (action, location) => {
    const key = `${action}_${location}_${time}`
    if (seen.has(key)) return
    data.recentActivity.push({ action, location, time })
    seen.add(key)
    added++
  }

  if (prev !== 'transit') emit('Departed', prev)
  if (current !== 'transit') emit('Arrived', current)

  if (added) logger.log(`AIS position fallback: ${prev} -> ${current}, injected ${added} event(s)`)
  return added
}
