import model from '../../functions/models/terminal-cars-classifier.json'
import { terminalEmptyFrameTs, terminalFullAtDeparture } from '../../functions/lib/lineup-labels.js'

// Browser-side terminal-cars classifier — the "ferry left not full" signal.
// Mirrors useLineupClassifier.js but for the Bowen terminal (departure)
// timelapse and the terminal model: frames are classified in capture order
// and the shared TAIL rule (terminalEmptyFrameTs) applies — two consecutive
// empty frames AFTER the last solid cars frame mean everyone waiting got on.
// Because a later solid cars frame invalidates an earlier empty window
// (it was mid-sailing, not departure), the verdict can only be evaluated
// once ALL frames are classified — no early stop.
//
// Like the crosswalk classifier, this exists so verdicts appear without any
// server deploy or backfill: any sailing whose terminal frames are still in
// Storage gets judged on the spot, cached per device.
//
// Terminal features are PER-FRAME MEAN-CENTERED (the camera spans day-to-
// night; see functions/lib/terminal-features.js) — the canvas extraction
// here must match.

// Single decision threshold, mirroring functions/lib/terminal-classifier.js:
// cars at p >= THRESHOLD, else empty. EMPTY_THRESHOLD survives only as the
// UI band boundary below — 'unsure' frames are where a rider's label is
// worth most, but they no longer gate the verdict (the tail rule does; see
// lineup-labels.js).
export const THRESHOLD = model.threshold ?? 0.5
export const EMPTY_THRESHOLD = model.emptyThreshold ?? 0.35
const terminalState = (p) => p >= THRESHOLD

// Which side of the two thresholds a score falls on — 'unsure' is the band
// where the model is least useful and a rider's label is worth most.
export const terminalBand = (p) =>
  p >= THRESHOLD ? 'cars' : p < EMPTY_THRESHOLD ? 'empty' : 'unsure'

export const terminalClassifierReady = Boolean(
  model?.enabled && Array.isArray(model.weights) && Array.isArray(model.regions),
)

function proxyUrl(path) {
  return (
    '/webcam/' +
    path
      .replace(/^webcams\//, '')
      .split('/')
      .map(encodeURIComponent)
      .join('/')
  )
}

const frameTs = (path) => {
  const m = /_(\d{10,})\.jpg$/.exec(path || '')
  return m ? Number(m[1]) : null
}

// Masked cells (model.masks — static clutter like the signpost and the
// walkway) are excluded from the mean and forced to 0, exactly as
// functions/lib/terminal-features.js does. The masks ride along in the model
// file so this mirror can never drift from the trained geometry.
const inMask = (fx, fy) =>
  (model.masks || []).some(
    ({ roi }) =>
      fx >= roi.left && fx < roi.left + roi.width && fy >= roi.top && fy < roi.top + roi.height,
  )
const FEATURE_MASK = (() => {
  const keep = []
  for (const { roi, width, height } of model.regions) {
    for (let gy = 0; gy < height; gy++) {
      for (let gx = 0; gx < width; gx++) {
        keep.push(
          inMask(
            roi.left + ((gx + 0.5) / width) * roi.width,
            roi.top + ((gy + 0.5) / height) * roi.height,
          )
            ? 0
            : 1,
        )
      }
    }
  }
  return keep
})()

function extractFeatures(bitmap) {
  const features = []
  for (const { roi, width, height } of model.regions) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(
      bitmap,
      Math.round(roi.left * bitmap.width),
      Math.round(roi.top * bitmap.height),
      Math.max(1, Math.round(roi.width * bitmap.width)),
      Math.max(1, Math.round(roi.height * bitmap.height)),
      0,
      0,
      width,
      height,
    )
    const { data } = ctx.getImageData(0, 0, width, height)
    for (let i = 0; i < width * height; i++) {
      const o = i * 4
      features.push((0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) / 255)
    }
  }
  let sum = 0
  let kept = 0
  for (let i = 0; i < features.length; i++)
    if (FEATURE_MASK[i]) {
      sum += features[i]
      kept++
    }
  const mean = sum / (kept || 1)
  return features.map((v, i) => (FEATURE_MASK[i] ? v - mean : 0))
}

function score(features) {
  let z = model.bias || 0
  for (let i = 0; i < model.weights.length; i++) z += model.weights[i] * features[i]
  return 1 / (1 + Math.exp(-z))
}

async function classifyFrame(path) {
  const res = await fetch(proxyUrl(path))
  if (!res.ok) throw new Error(`frame fetch ${res.status}`)
  const bitmap = await createImageBitmap(await res.blob())
  try {
    const p = score(extractFeatures(bitmap))
    return { ts: frameTs(path), p, carsPresent: terminalState(p) }
  } finally {
    bitmap.close?.()
  }
}

// Classify EVERY frame of a sailing (no early stop) — evidence for the
// "show details" dialog: per-frame probability in capture order, plus the
// proxied image URL. Frames come from the browser HTTP cache when the
// verdict pass already fetched them.
export async function classifyAllTerminalFrames(departureTimelapsePaths) {
  if (!terminalClassifierReady) return null
  const paths = [...(departureTimelapsePaths || [])]
    .filter((p) => frameTs(p) != null)
    .sort((a, b) => frameTs(a) - frameTs(b))
  if (!paths.length) return null
  const frames = []
  for (const path of paths) {
    frames.push({ ...(await classifyFrame(path)), url: proxyUrl(path) })
  }
  return frames
}

// v4: adds the full verdict (fullAt/fullProb) beside the not-full one; v3
// entries lack it and must be recomputed. Entries cache only the FRAME
// facts — the crosswalk veto on full is applied at read time, so a verdict
// can appear later when the crosswalk evidence arrives without reclassifying.
const CACHE_KEY = 'terminalAutoVerdicts.v4'
let cache = null
function loadCache() {
  if (cache) return cache
  try {
    const stored = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
    cache = stored.model === model.trainedAt ? stored : { model: model.trainedAt, sailings: {} }
  } catch {
    cache = { model: model.trainedAt, sailings: {} }
  }
  cache.sailings = cache.sailings || {}
  return cache
}
function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Full/blocked storage just means re-classifying next visit.
  }
}

// Turn a cache entry's frame facts into the verdict the caller sees.
// `crosswalkOk` = the lineup demonstrably reached the crosswalk (robot
// detection or a human mark) — Tom's rule: never reaching it vetoes any
// full claim. The two verdicts are mutually exclusive by construction
// (four confident-cars frames at the end preclude an empty tail).
function resolveVerdict(entry, crosswalkOk) {
  if (!entry) return null
  if (entry.emptyTs != null)
    return { kind: 'notFull', emptyTs: entry.emptyTs, prob: entry.prob ?? null }
  if (entry.fullAt != null && crosswalkOk)
    return { kind: 'full', fullAt: entry.fullAt, prob: entry.fullProb ?? null }
  return null
}

// Cached verdict lookup (no network, no side effects) — lets the departures
// page re-apply an already-computed certainty after the live aggregate
// subscription rebuilds its sailing objects.
export function cachedTerminal(sailingKey, { crosswalkOk = false } = {}) {
  return resolveVerdict(loadCache().sailings[sailingKey], crosswalkOk)
}

// Classify a sailing's terminal frames and return the three-state verdict:
//   { kind: 'notFull', emptyTs, prob } — tail rule: empty pair after the
//     last solid cars frame; prob is the confirming frame's empty
//     confidence (1 − p), the number the server stamps as terminalEmptyProb.
//   { kind: 'full', fullAt, prob } — the last FULL_TAIL_FRAMES frames all
//     confidently cars AND crosswalkOk (the veto, see resolveVerdict);
//     prob is the last frame's cars confidence.
//   null — inconclusive (never a claim either way).
// NO early stop: later frames can invalidate either verdict, so it only
// exists once every frame is classified. `final` marks a departed sailing
// whose verdict may cache. `force` re-classifies past a cached
// no-detection — used by the explicit "question robot" button, where a
// stale null shouldn't make the click a silent no-op.
export async function predictTerminal(
  sailingKey,
  departureTimelapsePaths,
  { final = true, force = false, crosswalkOk = false } = {},
) {
  if (!terminalClassifierReady) return null
  const c = loadCache()
  const hit = c.sailings[sailingKey]
  // A positive from a finished sailing is settled; one from a sailing still
  // boarding can be invalidated by later frames, so force recomputes it.
  if (hit && (hit.emptyTs != null || hit.fullAt != null) && (hit.final || !force))
    return resolveVerdict(hit, crosswalkOk)
  if (hit?.final && !force) return null

  const paths = [...(departureTimelapsePaths || [])]
    .filter((p) => frameTs(p) != null)
    .sort((a, b) => frameTs(a) - frameTs(b))
  if (paths.length < 2) return null

  const frames = []
  try {
    for (const path of paths) frames.push(await classifyFrame(path))
  } catch {
    // Frames unreachable (aged out / network) — don't cache, retry later.
    return null
  }
  const emptyTs = terminalEmptyFrameTs(frames)
  const fullAt = emptyTs == null ? terminalFullAtDeparture(frames) : null
  const confirming = emptyTs != null ? frames.find((f) => f.ts === emptyTs) : null
  const entry = {
    emptyTs,
    prob: confirming ? Math.round((1 - confirming.p) * 1000) / 1000 : null,
    fullAt,
    fullProb:
      fullAt != null
        ? Math.round((frames[frames.length - 1]?.p ?? 0) * 1000) / 1000
        : null,
    final,
  }
  if (emptyTs != null || fullAt != null || final) {
    c.sailings[sailingKey] = entry
    saveCache()
  }
  return resolveVerdict(entry, crosswalkOk)
}
