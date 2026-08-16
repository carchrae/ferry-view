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

// Single threshold again (2026-08-16, second revision): p >= threshold (0.5)
// → cars, else empty. The 0.35 emptyThreshold band (frames the model was
// unsure about mapping to null) was tried first, but the sweep in
// training-data/experiments/empty-threshold-sweep.mjs showed it was the
// wrong mechanism: it cut not-full coverage from 74% to 43% while every
// actually-wrong verdict came from empty windows MID-sailing with cars
// returning after — which no per-frame threshold catches. Correctness now
// comes from the TAIL rule in terminalEmptyFrameTs (the confirming pair must
// follow the LAST solid cars frame). emptyThreshold stays in the model JSON
// purely as the UI "unsure" band (terminalBand in useTerminalClassifier.js)
// that prioritizes frames for rider labelling. Callers must still treat a
// null carsPresent as unknown (reserved for e.g. a future night model
// declining to answer) — terminalEmptyFrameTs does.
export function terminalState(probability, m = model) {
  return probability >= (m.threshold ?? 0.5)
}

// JPEG buffer → { probability, carsPresent: true|false } or null
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
