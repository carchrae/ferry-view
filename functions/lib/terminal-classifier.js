import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { logger } from 'firebase-functions/logger'
import { extractTerminalFeatures, TERMINAL_FEATURE_LENGTH } from './terminal-features.js'

// Runtime for the terminal-cars classifier ("are there cars waiting in the
// Bowen terminal frame?") — independent of the crosswalk classifier but the
// same shape: logistic weights trained by scripts/train-terminal-classifier.mjs,
// shipped as JSON with the functions deploy. Until a trained model with
// enabled:true is committed, classifyTerminal() returns null and costs
// nothing.
const MODEL_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../models/terminal-cars-classifier.json',
)

let model = { enabled: false }
try {
  model = JSON.parse(readFileSync(MODEL_PATH, 'utf8'))
} catch {
  // A missing or corrupt model file simply leaves the classifier disabled.
}

export function terminalModelUsable(m = model) {
  return Boolean(m?.enabled) && Array.isArray(m.weights) && m.weights.length === TERMINAL_FEATURE_LENGTH
}

export function scoreTerminalFeatures(features, m = model) {
  let z = m.bias || 0
  for (let i = 0; i < m.weights.length; i++) z += m.weights[i] * features[i]
  return 1 / (1 + Math.exp(-z))
}

// JPEG buffer → { probability, carsPresent } or null (disabled / failed).
export async function classifyTerminal(buf, m = model) {
  if (!terminalModelUsable(m)) return null
  try {
    const features = await extractTerminalFeatures(buf)
    const probability = scoreTerminalFeatures(features, m)
    return { probability, carsPresent: probability >= (m.threshold ?? 0.5) }
  } catch (e) {
    logger.warn('Terminal-cars classification failed:', e.message)
    return null
  }
}
