import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { logger } from 'firebase-functions/logger'

// Mirrors each bundled classifier model into Firestore so every robot report
// can be traced back to the exact model — weights, metrics, training-set
// date range and image counts — that produced it (sailingStatus stamps
// crosswalkAutoModel / terminalAutoModel with the version number).
//
// The training scripts can't write Firestore (they only have the public
// read-only REST access), and the doc should describe the model actually
// DEPLOYED — so the functions upsert it themselves. Doc id is
// classifierModels/{name}-v{version}; versions are immutable, so an existing
// doc is never rewritten. Memoized per cold start: two reads on the first
// call, writes only when a newly-versioned model ships. Models without a
// version field predate versioning and are skipped.
const MODELS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../models')
const MODELS = [
  { name: 'lineup', file: 'lineup-classifier.json' },
  { name: 'terminal-cars', file: 'terminal-cars-classifier.json' },
]

let synced = null

export function ensureClassifierModelDocs(db) {
  if (!synced) {
    synced = syncModels(db).catch((e) => {
      // Reset so the next poll retries — a transient Firestore error must not
      // leave the registry unsynced for the whole instance lifetime.
      synced = null
      logger.error('Classifier model registry sync failed:', e)
    })
  }
  return synced
}

async function syncModels(db) {
  for (const { name, file } of MODELS) {
    let model
    try {
      model = JSON.parse(readFileSync(join(MODELS_DIR, file), 'utf8'))
    } catch {
      continue
    }
    if (!model?.version) continue
    const ref = db.collection('classifierModels').doc(`${name}-v${model.version}`)
    const snap = await ref.get()
    if (snap.exists) continue
    await ref.set({ name, ...model, syncedAt: Date.now() })
    logger.log(`Recorded classifier model ${name}-v${model.version} (trained ${model.trainedAt})`)
  }
}

// Test hook: clears the cold-start memo.
export function resetClassifierModelSync() {
  synced = null
}

// --- the LIVE model -----------------------------------------------------------
// A retrain should not need a functions deploy. `npm run models:publish`
// (functions/publish-models.js) writes the trained model as a versioned doc
// and points classifierModels/live at it:
//   { lineup: { version, featureSet, trainedAt, publishedAt },
//     'terminal-cars': { … } }
// The runtime asks liveModel() for the model to classify with: the pointed-to
// version when it is usable by THIS code (the caller's `usable` predicate —
// feature length, and for the terminal model the feature set), else the
// bundled one. So an older functions build keeps working on its bundled
// model until it is redeployed, and a feature-set change still needs the
// deploy — but a plain retrain reaches production the moment it is published.
// The pointer is re-read at most every LIVE_TTL_MS (one read per instance per
// ten minutes — nothing next to the one-minute poll); versioned docs are
// immutable and cached for the instance lifetime.
export const LIVE_DOC = 'live'
export const LIVE_TTL_MS = 10 * 60 * 1000

let livePointer = { data: null, at: 0 } // the live doc's data, with the time it was read
const liveByVersion = new Map() // `${name}-v${version}` → model data (or null when the doc is missing)

export async function liveModel(db, name, bundled, usable = () => true, now = Date.now()) {
  try {
    if (now - livePointer.at > LIVE_TTL_MS) {
      const snap = await db.collection('classifierModels').doc(LIVE_DOC).get()
      livePointer = { data: snap.exists ? snap.data() : null, at: now }
    }
    const want = livePointer.data?.[name]?.version
    if (want == null || want === bundled?.version) return bundled
    const key = `${name}-v${want}`
    if (!liveByVersion.has(key)) {
      const snap = await db.collection('classifierModels').doc(key).get()
      liveByVersion.set(key, snap.exists ? snap.data() : null)
    }
    const live = liveByVersion.get(key)
    if (!live || !usable(live)) {
      logger.warn(
        `Live ${name} model v${want} ${live ? 'is not usable by this build' : 'has no doc'} — using bundled v${bundled?.version ?? '?'}`,
      )
      return bundled
    }
    return live
  } catch (e) {
    // A Firestore hiccup must never stop classification: fall back to the
    // bundled model and try the pointer again next time.
    logger.warn(`Live ${name} model lookup failed — using bundled:`, e.message)
    livePointer = { data: livePointer.data, at: 0 }
    return bundled
  }
}

// Test hook: forget the live pointer and cached versions.
export function resetLiveModelCache() {
  livePointer = { data: null, at: 0 }
  liveByVersion.clear()
}
