import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { logger } from 'firebase-functions/logger'
import {
  setLineupModel,
  activeLineupModel,
  lineupModelAcceptable,
} from './lineup-classifier.js'
import {
  setTerminalModel,
  activeTerminalModel,
  terminalModelAcceptable,
} from './terminal-classifier.js'

// The classifier model registry in Firestore, and the LIVE pointer that
// decides which version the robots run — so a retrained model reaches
// production with a Firestore write (functions/publish-classifier-models.js)
// instead of a functions deploy.
//
//   classifierModels/{name}-v{version}   immutable: the full model + metrics
//   classifierModels/live                { lineup: 5, 'terminal-cars': 7, … }
//
// Two jobs here:
//  1. ensureClassifierModelDocs — mirror the BUNDLED model JSONs into the
//     registry (memoized per cold start) so every version that ever shipped
//     in a deploy is on record, and robot verdicts (crosswalkAutoModel /
//     terminalAutoModel stamp the version) stay attributable.
//  2. refreshLiveModels — read the live pointer and install the versions it
//     names into the runtimes. Called at the top of every poll: one small doc
//     read a minute, plus one model doc the poll after a publish. No pointer
//     (or a field missing from it) means the bundled model, exactly as
//     before. A pointed-at version that is missing, disabled or trained on
//     different crops than this deploy's feature code (model-geometry.js) is
//     refused — the current model stays and the refusal is logged once per
//     version, so a bad publish degrades to "nothing changed", never to
//     garbage verdicts.
const MODELS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../models')
export const LIVE_DOC = 'live'
export const MODELS = [
  {
    name: 'lineup',
    file: 'lineup-classifier.json',
    acceptable: lineupModelAcceptable,
    install: setLineupModel,
    active: activeLineupModel,
  },
  {
    name: 'terminal-cars',
    file: 'terminal-cars-classifier.json',
    acceptable: terminalModelAcceptable,
    install: setTerminalModel,
    active: activeTerminalModel,
  },
]

export function readBundledModel(file) {
  try {
    return JSON.parse(readFileSync(join(MODELS_DIR, file), 'utf8'))
  } catch {
    return null
  }
}

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

// Upsert one versioned model doc; versions are immutable, so an existing doc
// is never rewritten. Returns true when it wrote. Shared with the publish
// script, which registers archived versions the same way.
export async function registerModelDoc(db, name, model) {
  if (!model?.version) return false
  const ref = db.collection('classifierModels').doc(`${name}-v${model.version}`)
  const snap = await ref.get()
  if (snap.exists) return false
  await ref.set({ name, ...model, syncedAt: Date.now() })
  return true
}

async function syncModels(db) {
  for (const { name, file } of MODELS) {
    const model = readBundledModel(file)
    if (!model?.version) continue
    if (await registerModelDoc(db, name, model)) {
      logger.log(`Recorded classifier model ${name}-v${model.version} (trained ${model.trainedAt})`)
    }
  }
}

// --- Live pointer ---------------------------------------------------------------
// Per classifier: the version the pointer last named, so an unchanged
// pointer costs no model-doc read; and the versions already refused, so a
// bad pointer is logged once rather than every minute.
const seen = new Map()
const refused = new Set()

export async function refreshLiveModels(db) {
  let live
  try {
    const snap = await db.collection('classifierModels').doc(LIVE_DOC).get()
    live = snap.exists ? snap.data() : null
  } catch (e) {
    logger.warn('Live classifier pointer unreadable — keeping current models:', e.message)
    return
  }
  for (const { name, acceptable, install, active } of MODELS) {
    const version = live?.[name]
    if (version == null) {
      // No pointer for this classifier: bundled model, as before a publish.
      if (seen.has(name)) {
        install(null)
        seen.delete(name)
        logger.log(`Classifier ${name}: live pointer cleared — bundled v${active()?.version} active`)
      }
      continue
    }
    if (seen.get(name) === version) continue
    const key = `${name}-v${version}`
    if (refused.has(key)) continue
    let model
    try {
      const snap = await db.collection('classifierModels').doc(key).get()
      model = snap.exists ? snap.data() : null
    } catch (e) {
      logger.warn(`Classifier ${key} unreadable — keeping current model:`, e.message)
      continue
    }
    if (!model) {
      refused.add(key)
      logger.error(`Live pointer names classifierModels/${key} but no such doc — keeping v${active()?.version}`)
      continue
    }
    if (!acceptable(model)) {
      refused.add(key)
      logger.error(
        `Live model ${key} refused (disabled, wrong feature length, or crops differ from this deploy) — keeping v${active()?.version}`,
      )
      continue
    }
    install(model)
    seen.set(name, version)
    logger.log(`Classifier ${name}: live v${version} installed (trained ${model.trainedAt})`)
  }
}

// The versions the robots are running right now — what ferryStatus/current
// carries as `classifierModels`, so the webapp learns the live versions from
// the doc it already listens to instead of an extra read of the pointer.
// These are the ACTIVE versions (bundled when no pointer, or when the pointed
// version was refused), i.e. what verdicts are actually stamped with.
export function activeClassifierVersions() {
  const out = {}
  for (const { name, active } of MODELS) out[name] = active()?.version ?? null
  return out
}

// Test hook: clears the cold-start memo and the live-pointer state.
export function resetClassifierModelSync() {
  synced = null
  seen.clear()
  refused.clear()
  for (const { install } of MODELS) install(null)
}
