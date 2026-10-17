import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { logger } from 'firebase-functions/logger'
import { extractFeatures, FEATURE_LENGTH, REGIONS } from './lineup-features.js'
import { sameGeometry } from './model-geometry.js'

// Runtime for the "lineup full to crosswalk" classifier. The model is a
// plain logistic regression trained by scripts/train-lineup-classifier.mjs.
// The bundled models/lineup-classifier.json is the fallback that ships with
// the functions deploy; the LIVE model comes from Firestore
// (classifierModels/live → classifierModels/lineup-v{n}, see
// classifier-models.js refreshLiveModels) and is swapped in with
// setLineupModel() without a deploy. Until some usable model is in place,
// classifyLineup() returns null and costs nothing.
const MODEL_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../models/lineup-classifier.json',
)

let bundled = { enabled: false }
try {
  bundled = JSON.parse(readFileSync(MODEL_PATH, 'utf8'))
} catch {
  // A missing or corrupt model file simply leaves the classifier disabled.
}
let model = bundled

export function modelUsable(m = model) {
  return Boolean(m?.enabled) && Array.isArray(m.weights) && m.weights.length === FEATURE_LENGTH
}

// May this model run against THIS deploy's feature extraction? Usable, and
// trained on the crops the code cuts (geometry, not names) — a model from
// Firestore that predates an ROI change would otherwise score garbage.
export function lineupModelAcceptable(m) {
  return modelUsable(m) && sameGeometry(m.regions, REGIONS)
}

// Swap the active model (the live one from Firestore, or back to the
// bundled fallback with null). Rejects an unacceptable model and says so.
export function setLineupModel(m) {
  const next = m == null ? bundled : m
  if (m != null && !lineupModelAcceptable(m)) return false
  model = next
  return true
}

export const activeLineupModel = () => model
export const bundledLineupModel = () => bundled

// Version stamped by the training script; null on legacy unversioned models.
// Recorded on every confirmed verdict so results can be compared per model.
export function lineupModelVersion(m = model) {
  return m?.version ?? null
}

// Sigmoid of the linear score. Exported for the trainer/tests.
export function scoreFeatures(features, m = model) {
  let z = m.bias || 0
  for (let i = 0; i < m.weights.length; i++) z += m.weights[i] * features[i]
  return 1 / (1 + Math.exp(-z))
}

// JPEG buffer → { probability, fullToCrosswalk } or null (disabled / failed).
// Pure CPU dot product — microseconds per frame.
export async function classifyLineup(buf, m = model) {
  if (!modelUsable(m)) return null
  try {
    const features = await extractFeatures(buf)
    const probability = scoreFeatures(features, m)
    return { probability, fullToCrosswalk: probability >= (m.threshold ?? 0.7) }
  } catch (e) {
    logger.warn('Lineup classification failed:', e.message)
    return null
  }
}
