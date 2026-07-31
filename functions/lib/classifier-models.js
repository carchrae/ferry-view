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
