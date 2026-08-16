import model from '../../functions/models/terminal-cars-classifier.json'
import { terminalEmptyFrameTs } from '../../functions/lib/lineup-labels.js'

// Browser-side terminal-cars classifier — the "ferry left not full" signal.
// Mirrors useLineupClassifier.js but for the Bowen terminal (departure)
// timelapse and the terminal model: frames are classified in capture order
// and the shared confirmed-pair rule (terminalEmptyFrameTs) applies — two
// consecutive empty frames before departure mean everyone waiting got on.
// One-way: late cars never cancel a confirmed empty pair.
//
// Like the crosswalk classifier, this exists so verdicts appear without any
// server deploy or backfill: any sailing whose terminal frames are still in
// Storage gets judged on the spot, cached per device.
//
// Terminal features are PER-FRAME MEAN-CENTERED (the camera spans day-to-
// night; see functions/lib/terminal-features.js) — the canvas extraction
// here must match.

// Two thresholds, mirroring functions/lib/terminal-classifier.js: cars at
// p >= THRESHOLD, confidently empty at p < EMPTY_THRESHOLD, unknown between
// (null — breaks a confirming pair, counts as neither).
const THRESHOLD = model.threshold ?? 0.5
const EMPTY_THRESHOLD = model.emptyThreshold ?? 0.35
const terminalState = (p) => (p >= THRESHOLD ? true : p < EMPTY_THRESHOLD ? false : null)

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

// v2: adds `prob` (the confirming frame's empty-confidence) to cache entries.
const CACHE_KEY = 'terminalAutoVerdicts.v2'
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

// Cached verdict lookup (no network, no side effects) — lets the departures
// page re-apply an already-computed certainty after the live aggregate
// subscription rebuilds its sailing objects.
export function cachedNotFull(sailingKey) {
  const hit = loadCache().sailings[sailingKey]
  return hit && hit.emptyTs != null ? { emptyTs: hit.emptyTs, prob: hit.prob ?? null } : null
}

// Classify a sailing's terminal frames and return { emptyTs, prob } when a
// confirmed empty pair says the ferry left not full, or null (inconclusive —
// never "full"). `prob` is the confirming frame's empty-confidence (1 − p),
// same number the server stamps as terminalEmptyProb. Unlike the crosswalk
// detector this cannot early-stop on the first hit (the LAST confirmed pair
// matters less than any pair, so the first confirmed pair is already
// decisive) — it stops as soon as one pair confirms. `final` marks a
// departed sailing whose null verdict may cache. `force` re-classifies past
// a cached no-detection — used by the explicit "ask robot" button, where a
// stale null (cached before the sailing finished, or by an older model pass)
// shouldn't make the click a silent no-op.
export async function predictNotFull(
  sailingKey,
  departureTimelapsePaths,
  { final = true, force = false } = {},
) {
  if (!terminalClassifierReady) return null
  const c = loadCache()
  const hit = c.sailings[sailingKey]
  if (hit && hit.emptyTs != null) return { emptyTs: hit.emptyTs, prob: hit.prob ?? null }
  if (hit?.final && !force) return null

  const paths = [...(departureTimelapsePaths || [])]
    .filter((p) => frameTs(p) != null)
    .sort((a, b) => frameTs(a) - frameTs(b))
  if (paths.length < 2) return null

  const frames = []
  try {
    for (const path of paths) {
      frames.push(await classifyFrame(path))
      const emptyTs = terminalEmptyFrameTs(frames)
      if (emptyTs != null) {
        const confirming = frames.find((f) => f.ts === emptyTs)
        const prob = confirming ? Math.round((1 - confirming.p) * 1000) / 1000 : null
        c.sailings[sailingKey] = { emptyTs, prob, final: true }
        saveCache()
        return { emptyTs, prob }
      }
    }
  } catch {
    // Frames unreachable (aged out / network) — don't cache, retry later.
    return null
  }
  if (final) {
    c.sailings[sailingKey] = { emptyTs: null, final: true }
    saveCache()
  }
  return null
}
