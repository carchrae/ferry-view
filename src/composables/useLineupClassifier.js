import model from '../../functions/models/lineup-classifier.json'
import { firstSustainedPositiveTs } from '../../functions/lib/lineup-labels.js'

// Browser-side lineup classifier — phase 1 of automated crosswalk detection.
//
// Runs the SAME model the server uses (functions/models/lineup-classifier.json,
// bundled at build time) over a sailing's lineup-timelapse frames, in capture
// order, applying the shared sequence rule (firstSustainedPositiveTs): the
// lineup passed the crosswalk at the first positive frame confirmed by the
// next frame. Predictions feed the "Robot says…" agree-tag so riders can
// confirm or correct them — testing the model's accuracy against humans
// without waiting for server-side captures to accumulate (no backfill: any
// sailing whose frames are still in Storage can be classified on the spot).
//
// Preprocessing caveat: the server extracts features with sharp; here we use
// canvas drawImage + a luma grayscale, which resamples slightly differently.
// Borderline frames can flip, which is acceptable for phase 1 — agreement
// data will tell us how much it matters.
//
// Frames are fetched via the same-origin /webcam proxy (Netlify rewrite in
// production, devServer proxy in dev) because the bucket serves no CORS
// headers, so a cross-origin canvas would be tainted. Frames are immutable
// and long-cached, so refetches are usually free.

const THRESHOLD = model.threshold ?? 0.7

export const browserClassifierReady = Boolean(
  model?.enabled && Array.isArray(model.weights) && Array.isArray(model.regions),
)

// webcams/community/<date>/timelapse/<file>.jpg → /webcam/community/…
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

// Mirror of functions/lib/lineup-features.js extractFeatures, on a canvas:
// per region crop → downscale → grayscale (luma) → normalize → concatenate.
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
  return features
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
    return { ts: frameTs(path), p, positive: p >= THRESHOLD }
  } finally {
    bitmap.close?.()
  }
}

// Predictions are cached per device: a classified sailing is never refetched,
// and predictions for frames that later age out of Storage survive locally.
// Keyed by model.trainedAt so a retrained model re-classifies everything.
const CACHE_KEY = 'lineupAutoPredictions.v1'
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

// Classify a sailing's lineup frames in capture order and return
// { ts, prob } for the first confirmed positive, or null when the lineup
// never (yet) reads as past the crosswalk. Early-stops at confirmation, so
// negative tails aren't fetched. `final` marks a sailing that can gain no
// more frames — only those cache a null result.
export async function predictCrosswalk(sailingKey, lineupTimelapsePaths, { final = true } = {}) {
  if (!browserClassifierReady) return null
  const c = loadCache()
  const hit = c.sailings[sailingKey]
  if (hit && (hit.ts != null || hit.final)) return hit.ts != null ? { ts: hit.ts, prob: hit.prob } : null

  const paths = [...(lineupTimelapsePaths || [])]
    .filter((p) => frameTs(p) != null)
    .sort((a, b) => frameTs(a) - frameTs(b))
  if (paths.length < 2) return null

  const frames = []
  try {
    for (const path of paths) {
      frames.push(await classifyFrame(path))
      const ts = firstSustainedPositiveTs(frames)
      if (ts != null) {
        const first = frames.find((f) => f.ts === ts)
        c.sailings[sailingKey] = { ts, prob: Math.round(first.p * 1000) / 1000, final: true }
        saveCache()
        return { ts, prob: c.sailings[sailingKey].prob }
      }
    }
  } catch {
    // A frame failed to load (aged out of Storage mid-sailing, network) —
    // don't cache; a later visit may succeed or the frames are simply gone.
    return null
  }
  if (final) {
    c.sailings[sailingKey] = { ts: null, final: true }
    saveCache()
  }
  return null
}
