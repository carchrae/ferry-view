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

const THRESHOLD = model.threshold ?? 0.5

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
  const mean = features.reduce((a, v) => a + v, 0) / features.length
  return features.map((v) => v - mean)
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
    return { ts: frameTs(path), carsPresent: p >= THRESHOLD }
  } finally {
    bitmap.close?.()
  }
}

const CACHE_KEY = 'terminalAutoVerdicts.v1'
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

// Classify a sailing's terminal frames and return { emptyTs } when a
// confirmed empty pair says the ferry left not full, or null (inconclusive —
// never "full"). Unlike the crosswalk detector this cannot early-stop on
// the first hit (the LAST confirmed pair matters less than any pair, so the
// first confirmed pair is already decisive) — it stops as soon as one pair
// confirms. `final` marks a departed sailing whose null verdict may cache.
export async function predictNotFull(sailingKey, departureTimelapsePaths, { final = true } = {}) {
  if (!terminalClassifierReady) return null
  const c = loadCache()
  const hit = c.sailings[sailingKey]
  if (hit && (hit.emptyTs != null || hit.final)) {
    return hit.emptyTs != null ? { emptyTs: hit.emptyTs } : null
  }

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
        c.sailings[sailingKey] = { emptyTs, final: true }
        saveCache()
        return { emptyTs }
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
