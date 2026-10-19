import { computed } from 'vue'
import { terminalEmptyFrameTs, terminalFullAtDeparture } from '../../functions/lib/lineup-labels.js'
import { terminalModel, loadLiveModels } from 'src/composables/useClassifierModels'
import { scoreWithMembers } from '../../functions/lib/model-members.js'
import {
  cellStdGrid,
  grayFromRgba,
  standardizeRegions,
  featureMask as buildFeatureMask,
  regionRect,
  TERMINAL_FEATURE_SET,
} from '../../functions/lib/terminal-feature-math.js'

// Browser-side terminal-cars classifier — the "ferry left not full" signal.
// Mirrors useLineupClassifier.js but for the Bowen terminal (departure)
// timelapse and the terminal model: frames are classified in capture order
// and the shared one-way EMPTY-GAP rule (terminalEmptyFrameTs) applies —
// two consecutive empty frames once loading (solid cars) has been seen mean
// everyone waiting got on, and cars after that gap are late arrivals that
// never undo it (2026-10-19). The FULL rule can still be undone by a later
// frame, so both are evaluated once ALL frames are classified — no early
// stop.
//
// Like the crosswalk classifier, this exists so verdicts appear without any
// server deploy or backfill: any sailing whose terminal frames are still in
// Storage gets judged on the spot, cached per device. The model is whichever
// version classifierModels/live names (useClassifierModels.js), bundled
// JSON as fallback — same as the server.
//
// Terminal features are per-cell LOCAL TEXTURE (standard deviation of the
// native pixels), standardised per region — feature set localStd-v1, see
// functions/lib/terminal-feature-math.js, whose arithmetic this canvas
// extraction shares. A model from another feature set (the brightness
// models up to v8) is not ready here, exactly as the server refuses it.

// Single decision threshold, mirroring functions/lib/terminal-classifier.js:
// cars at p >= THRESHOLD, else empty. EMPTY_THRESHOLD survives only as the
// UI band boundary below — 'unsure' frames are where a rider's label is
// worth most, but they no longer gate the verdict (the empty-gap rule does;
// see lineup-labels.js).
loadLiveModels()
// The model in force right now — read at call time, never captured.
const current = () => terminalModel.value
const threshold = () => current().threshold ?? 0.5
const emptyThreshold = () => current().emptyThreshold ?? 0.35
export const THRESHOLD = computed(() => threshold())
export const EMPTY_THRESHOLD = computed(() => emptyThreshold())
const terminalState = (p) => p >= threshold()

// Which side of the two thresholds a score falls on — 'unsure' is the band
// where the model is least useful and a rider's label is worth most.
export const terminalBand = (p) =>
  p >= threshold() ? 'cars' : p < emptyThreshold() ? 'empty' : 'unsure'

export const terminalClassifierReady = computed(() => {
  const m = current()
  return Boolean(
    m?.enabled &&
      Array.isArray(m.weights) &&
      Array.isArray(m.regions) &&
      m.featureSet === TERMINAL_FEATURE_SET,
  )
})
export const terminalModelVersion = () => current().version ?? null

// The model's geometry, for drawing where it looks (RoiOverlay): the regions
// it reads and the masks it ignores. Straight from the model so the picture
// riders see can never drift from what was trained.
export const terminalRegions = computed(() => current().regions || [])
export const terminalMasks = computed(() => current().masks || [])

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
// walkway) are excluded from the region statistics and forced to 0, exactly
// as functions/lib/terminal-features.js does. The masks ride along in the
// model so this mirror can never drift from the trained geometry. Computed
// once per model object (the live model replaces the bundled one at most
// once per page load).
let maskFor = null
let maskKeep = null
function featureMask(model) {
  if (maskFor === model) return maskKeep
  maskFor = model
  maskKeep = buildFeatureMask(model.regions, model.masks || [])
  return maskKeep
}

// Each region is drawn at NATIVE size (no resampling — the texture is the
// signal), converted to luma, reduced to per-cell standard deviations on the
// model grid, then standardised per region. Mirrors extractTerminalFeatures.
function extractFeatures(bitmap, model) {
  const regions = model.regions
  const length = regions.reduce((a, r) => a + r.width * r.height, 0)
  const features = new Float32Array(length)
  let offset = 0
  for (const { roi, width, height } of regions) {
    const rect = regionRect(roi, bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = rect.width
    canvas.height = rect.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(bitmap, rect.left, rect.top, rect.width, rect.height, 0, 0, rect.width, rect.height)
    const { data } = ctx.getImageData(0, 0, rect.width, rect.height)
    const gray = grayFromRgba(data)
    cellStdGrid(gray, rect.width, rect.height, width, height, features, offset)
    offset += width * height
  }
  return standardizeRegions(features, regions, featureMask(model))
}

// Band-aware (model-members.js): the frame's capture time picks the
// daylight member when the model has them — the same rule as the server.
const score = (features, model, ts) => scoreWithMembers(model, features, ts)

async function classifyFrame(path) {
  const res = await fetch(proxyUrl(path))
  if (!res.ok) throw new Error(`frame fetch ${res.status}`)
  const bitmap = await createImageBitmap(await res.blob())
  try {
    const model = current()
    const ts = frameTs(path)
    const p = score(extractFeatures(bitmap, model), model, ts)
    return { ts, p, carsPresent: terminalState(p) }
  } finally {
    bitmap.close?.()
  }
}

// One frame's read: { ts, p, carsPresent }. Throws when the frame can't be
// fetched — callers scoring a list decide whether one miss spoils the rest
// (the tagging dialog keeps going, frame by frame).
export const classifyTerminalFrame = (path) => classifyFrame(path)

// Classify EVERY frame of a sailing (no early stop) — evidence for the
// "show details" dialog: per-frame probability in capture order, plus the
// proxied image URL. Frames come from the browser HTTP cache when the
// verdict pass already fetched them.
export async function classifyAllTerminalFrames(departureTimelapsePaths) {
  if (!terminalClassifierReady.value) return null
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
  const modelId = current().trainedAt
  // A live model arriving mid-session invalidates the memo too.
  if (cache && cache.model === modelId) return cache
  try {
    const stored = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
    cache = stored.model === modelId ? stored : { model: modelId, sailings: {} }
  } catch {
    cache = { model: modelId, sailings: {} }
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
//   { kind: 'notFull', emptyTs, prob } — empty-gap rule: the first empty
//     pair after loading was seen; prob is the confirming frame's empty
//     confidence (1 − p), the number the server stamps as terminalEmptyProb.
//     Outranks full on the same frames.
//   { kind: 'full', fullAt, prob } — the last FULL_TAIL_FRAMES frames all
//     confidently cars AND crosswalkOk (the veto, see resolveVerdict);
//     prob is the last frame's cars confidence.
//   null — inconclusive (never a claim either way).
// NO early stop: later frames can invalidate a full verdict, so verdicts
// only exist once every frame is classified. `final` marks a departed sailing
// whose verdict may cache. `force` re-classifies past a cached
// no-detection — used by the explicit "question robot" button, where a
// stale null shouldn't make the click a silent no-op.
export async function predictTerminal(
  sailingKey,
  departureTimelapsePaths,
  { final = true, force = false, crosswalkOk = false } = {},
) {
  if (!terminalClassifierReady.value) return null
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
