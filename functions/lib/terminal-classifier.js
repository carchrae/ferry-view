import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { logger } from 'firebase-functions/logger'
import {
  extractTerminalFeatures,
  TERMINAL_FEATURE_LENGTH,
  TERMINAL_REGIONS,
  TERMINAL_MASKS,
} from './terminal-features.js'
import { sameGeometry, sameMasks } from './model-geometry.js'
import { scoreWithMembers, membersUsable } from './model-members.js'

// Runtime for the terminal-cars classifier ("are there cars waiting in the
// Bowen terminal frame?") — independent of the crosswalk classifier but the
// same shape: logistic weights trained by scripts/train-terminal-classifier.mjs.
// The bundled JSON is the deploy-time fallback; the LIVE model is read from
// Firestore (classifierModels/live → classifierModels/terminal-cars-v{n}, see
// classifier-models.js) and installed with setTerminalModel() — no deploy
// needed. Until some usable model is in place, classifyTerminal() returns
// null and costs nothing.
const MODEL_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../models/terminal-cars-classifier.json',
)

let bundled = { enabled: false }
try {
  bundled = JSON.parse(readFileSync(MODEL_PATH, 'utf8'))
} catch {
  // A missing or corrupt model file simply leaves the classifier disabled.
}
let model = bundled

export function terminalModelUsable(m = model) {
  return (
    Boolean(m?.enabled) &&
    Array.isArray(m.weights) &&
    m.weights.length === TERMINAL_FEATURE_LENGTH &&
    membersUsable(m, TERMINAL_FEATURE_LENGTH)
  )
}

// Usable AND trained on this deploy's crops and masks (terminal features are
// mean-centred over the unmasked cells, so a mask change moves every value).
export function terminalModelAcceptable(m) {
  return (
    terminalModelUsable(m) &&
    sameGeometry(m.regions, TERMINAL_REGIONS) &&
    sameMasks(m.masks, TERMINAL_MASKS)
  )
}

export function setTerminalModel(m) {
  const next = m == null ? bundled : m
  if (m != null && !terminalModelAcceptable(m)) return false
  model = next
  return true
}

export const activeTerminalModel = () => model
export const bundledTerminalModel = () => bundled

// Version stamped by the training script; null on legacy unversioned models.
// Recorded on every confirmed verdict so results can be compared per model.
export function terminalModelVersion(m = model) {
  return m?.version ?? null
}

// `ts` (capture time, epoch ms) picks the daylight-band member when the model
// has them (model-members.js); without it the all-band weights score.
export function scoreTerminalFeatures(features, m = model, ts = null) {
  return scoreWithMembers(m, features, ts)
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
export async function classifyTerminal(buf, m = model, { ts = null } = {}) {
  if (!terminalModelUsable(m)) return null
  try {
    const features = await extractTerminalFeatures(buf)
    const probability = scoreTerminalFeatures(features, m, ts)
    return { probability, carsPresent: terminalState(probability, m) }
  } catch (e) {
    logger.warn('Terminal-cars classification failed:', e.message)
    return null
  }
}
