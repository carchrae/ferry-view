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

// Version stamped by the training script; null on legacy unversioned models.
// Recorded on every confirmed verdict so results can be compared per model.
export function terminalModelVersion(m = model) {
  return m?.version ?? null
}

export function scoreTerminalFeatures(features, m = model) {
  let z = m.bias || 0
  for (let i = 0; i < m.weights.length; i++) z += m.weights[i] * features[i]
  return 1 / (1 + Math.exp(-z))
}

// TWO thresholds, deliberately asymmetric (2026-08-16):
//   p >= threshold (0.5)       → cars present
//   p <  emptyThreshold (0.35) → confidently empty
//   in between                 → UNKNOWN (null)
// The model is decisive about cars (median p 0.95 on labeled cars frames) but
// mushy about empty (median 0.39), so a single 0.5 cut let coin-flip frames
// confirm "the terminal emptied" — 140 of 210 verdicts rested on a frame
// scoring above 0.25. Only the EMPTY side is tightened: raising the cars
// threshold would weaken the cars-first guard and the "still loading" reading.
// Callers must treat null as unknown, never as empty (terminalEmptyFrameTs
// does: it breaks a pair and counts as neither).
export function terminalState(probability, m = model) {
  if (probability >= (m.threshold ?? 0.5)) return true
  if (probability < (m.emptyThreshold ?? 0.35)) return false
  return null
}

// JPEG buffer → { probability, carsPresent: true|false|null } or null
// (disabled / failed).
export async function classifyTerminal(buf, m = model) {
  if (!terminalModelUsable(m)) return null
  try {
    const features = await extractTerminalFeatures(buf)
    const probability = scoreTerminalFeatures(features, m)
    return { probability, carsPresent: terminalState(probability, m) }
  } catch (e) {
    logger.warn('Terminal-cars classification failed:', e.message)
    return null
  }
}
