// Publish classifier models to Firestore so the robots pick them up on the
// next poll — no functions deploy. Writes the versioned registry docs
// (classifierModels/{name}-v{n}, immutable; skipped when present) and then
// moves the live pointer (classifierModels/live) to them. The webapp reads
// the same pointer, so the browser mirror follows too.
//
//   node publish-classifier-models.js --project bowen-ferry-staging
//   node publish-classifier-models.js --project bowen-ferry              # production
//   node publish-classifier-models.js --project bowen-ferry --lineup 4   # pin/roll back one
//   node publish-classifier-models.js --project bowen-ferry --dry-run
//   node publish-classifier-models.js --project bowen-ferry --rewrite-registry
//
// Without --lineup / --terminal-cars, the versions in functions/models/*.json
// (what the trainers / champion selection left live locally) are published.
// A pinned version is read from functions/models/history/ when it is not the
// local live file, and registered if the registry lacks it. Before pointing
// at anything, the model is run through the same acceptance check the
// functions apply (lineupModelAcceptable / terminalModelAcceptable in
// functions/lib) — a model trained on different crops than the code in this
// checkout would be refused by the deploy too, so refusing it here is a
// gentler failure than a pointer nobody follows.
//
// The registry doc is what the robots will RUN, so it must be the file:
//  - a doc that already exists under this version is compared field by field
//    (weights, bias, thresholds, regions, masks, trainedAt) with the local
//    file, and a mismatch aborts. This has happened: a version number was
//    reused by a same-day retrain before the commit, so production's
//    terminal-cars-v5 doc is an earlier model than history/…-v5.json.
//    --rewrite-registry overwrites such a doc with the file (knowingly:
//    verdicts already stamped with that version then refer to the new one);
//  - after writing, every doc is read back and compared the same way before
//    the pointer moves, so a write that didn't land as sent never goes live.
//
// --project is required: this never falls back to another project.
// Auth: connectAdmin() in script-auth.js — `firebase login`, or
// GOOGLE_APPLICATION_CREDENTIALS pointing at a key file.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { connectAdmin } from './script-auth.js'
import { MODELS, LIVE_DOC, readBundledModel, registerModelDoc } from './lib/classifier-models.js'
import { regionGeometry, maskGeometry } from './lib/model-geometry.js'

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(`--${name}`)
  return i !== -1 ? args[i + 1] : null
}
const projectId = flag('project')
if (!projectId) {
  console.error(
    'Usage: node publish-classifier-models.js --project <id> [--lineup N] [--terminal-cars N] [--dry-run]',
  )
  process.exit(1)
}
const dryRun = args.includes('--dry-run')
const rewrite = args.includes('--rewrite-registry')

// The fields that decide what a model DOES: weights, bias, thresholds, crop
// geometry, masks. Compared canonically — Firestore returns numbers as
// integer or double and map keys in its own order, so JSON text would differ
// for identical models (checked 2026-10-17: every registry doc's weights match
// its file exactly). trainedAt is NOT part of it: a deterministic retrain on
// unchanged data re-stamps identical weights with a new time, and two such
// twins exist in production (lineup-v3, terminal-cars-v5) — reported below,
// never a reason to abort.
// Object.is, not ===: a field absent on both sides (the lineup model has no
// emptyThreshold) must compare equal, and NaN === NaN is false — which made
// every lineup publish abort as "DIFFERS" on 2026-10-18.
const sameNumber = (x, y) => Object.is(Number(x ?? NaN), Number(y ?? NaN))
const sameModel = (a, b) =>
  Array.isArray(a?.weights) &&
  Array.isArray(b?.weights) &&
  a.weights.length === b.weights.length &&
  a.weights.every((w, i) => Number(w) === Number(b.weights[i])) &&
  sameNumber(a.bias ?? 0, b.bias ?? 0) &&
  sameNumber(a.threshold, b.threshold) &&
  sameNumber(a.emptyThreshold, b.emptyThreshold) &&
  regionGeometry(a.regions) === regionGeometry(b.regions) &&
  maskGeometry(a.masks) === maskGeometry(b.masks)
const HISTORY = join(dirname(fileURLToPath(import.meta.url)), 'models/history')

// Resolve which model file each classifier publishes.
const picks = []
for (const { name, file, acceptable } of MODELS) {
  const pinned = flag(name)
  let model = readBundledModel(file)
  let source = `models/${file}`
  if (pinned != null) {
    const version = Number(pinned)
    if (!Number.isInteger(version) || version < 1) {
      console.error(`--${name} must be a version number, got ${pinned}`)
      process.exit(1)
    }
    if (model?.version !== version) {
      const archived = join(HISTORY, `${file.replace(/\.json$/, '')}-v${version}.json`)
      if (!existsSync(archived)) {
        console.error(`No ${name} v${version} in models/ or models/history/`)
        process.exit(1)
      }
      model = JSON.parse(readFileSync(archived, 'utf8'))
      source = `models/history/${archived.split('/').pop()}`
    }
  }
  if (!model?.version) {
    console.error(`${name}: ${source} has no version — nothing to publish`)
    process.exit(1)
  }
  if (!acceptable(model)) {
    console.error(
      `${name} v${model.version} (${source}) fails the acceptance check — disabled, wrong feature length, or its crops differ from functions/lib in this checkout. Not published.`,
    )
    process.exit(1)
  }
  picks.push({ name, model, source })
}

const { db, via } = await connectAdmin(projectId)
console.log(`Publishing classifier models on ${projectId} (as ${via})${dryRun ? ' — DRY RUN' : ''}`)

const liveRef = db.collection('classifierModels').doc(LIVE_DOC)
const before = (await liveRef.get()).data() || {}
const pointer = {}
let aborted = false
for (const { name, model, source } of picks) {
  const key = `${name}-v${model.version}`
  const ref = db.collection('classifierModels').doc(key)
  const snap = await ref.get()
  const existing = snap.exists ? snap.data() : null
  const summary = `${source}, trained ${model.trainedAt}, test P/R ${model.metrics?.test?.precision}/${model.metrics?.test?.recall}`
  let action
  if (!existing) action = dryRun ? 'would register' : 'registered'
  else if (sameModel(existing, model))
    action =
      'registered already, identical to the file' +
      (existing.trainedAt === model.trainedAt
        ? ''
        : ` (doc trainedAt ${existing.trainedAt} differs — same weights, a re-stamped retrain)`)
  else if (rewrite) action = dryRun ? 'would be REWRITTEN (differs from the file)' : 'REWRITTEN (differed from the file)'
  else {
    console.error(
      `  ${key}: registry doc DIFFERS from ${source} (doc trained ${existing.trainedAt}, file trained ${model.trainedAt}) — the robots would run the doc, not your file. Re-run with --rewrite-registry to replace it, or pin a different version.`,
    )
    aborted = true
    continue
  }
  if (!dryRun && (!existing || rewrite)) {
    if (existing) await ref.set({ name, ...model, syncedAt: Date.now() })
    else await registerModelDoc(db, name, model)
    // Read back: the pointer only moves to a doc proven to be the file.
    const stored = (await ref.get()).data()
    if (!sameModel(stored, model)) {
      console.error(`  ${key}: read-back after write does not match the file — NOT pointing at it.`)
      aborted = true
      continue
    }
    action += ', verified by read-back'
  }
  console.log(`  ${key}: ${action} (${summary})`)
  pointer[name] = model.version
  const was = before[name]
  console.log(`  live ${name}: ${was == null ? 'bundled (no pointer)' : `v${was}`} → v${model.version}`)
}
if (aborted) {
  console.error('Nothing pointed: fix the registry mismatch above and re-run (the pointer was not touched).')
  process.exit(1)
}
if (!dryRun) {
  await liveRef.set({ ...pointer, updatedAt: Date.now(), updatedBy: via }, { merge: true })
  console.log('Live pointer written — the functions switch on their next poll, the webapp on its next load.')
}
