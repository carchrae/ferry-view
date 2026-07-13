import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { logger } from 'firebase-functions/logger'
import { extractFeatures, FEATURE_LENGTH } from './lineup-features.js'

// Runtime for the "lineup full to crosswalk" classifier. The model is a
// plain logistic regression trained by scripts/train-lineup-classifier.mjs;
// its weights live in models/lineup-classifier.json and ship with the
// functions deploy. Until a trained model with enabled:true is committed,
// classifyLineup() returns null and costs nothing.
const MODEL_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../models/lineup-classifier.json',
)

let model = { enabled: false }
try {
  model = JSON.parse(readFileSync(MODEL_PATH, 'utf8'))
} catch {
  // A missing or corrupt model file simply leaves the classifier disabled.
}

export function modelUsable(m = model) {
  return Boolean(m?.enabled) && Array.isArray(m.weights) && m.weights.length === FEATURE_LENGTH
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
