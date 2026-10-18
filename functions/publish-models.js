// Publish the trained classifier models and the classifier results pages —
// the one command to run after a retrain:
//
//   npm run models:publish                 # staging project + staging results bucket
//   npm run models:publish:production
//   node functions/publish-models.js --project bowen-ferry [--dry-run] [--skip-pages]
//
// What it does, per model file in functions/models/ (lineup-classifier.json,
// terminal-cars-classifier.json):
//   1. writes the model as classifierModels/{name}-v{version} if that doc
//      doesn't exist yet (versions are immutable — never rewritten),
//   2. points classifierModels/live.{name} at it:
//      { version, featureSet, trainedAt, publishedAt }.
// The functions read that pointer (classifier-models.js liveModel, re-read
// every ten minutes) and classify with the published version as long as the
// running build can use it — same feature length and, for the terminal model,
// the same feature set. So a plain retrain goes live from here with NO
// functions deploy. Two things still need a deploy, and the script says so:
//   - a feature-set change (new extraction code) — deploy functions, and the
//     webapp, which bundles the model for its browser mirror;
//   - the browser mirror in general: it uses the bundled model from the last
//     webapp deploy (git push), so publish, then push when convenient.
//   3. publishes public/classifier-results/ (pages + thumbnails) to the
//      results bucket via scripts/deploy-classifier-results.sh — the pages the
//      trainer regenerated for this model. --skip-pages leaves them.
//
// --project is required; nothing falls back to another project. Auth via
// connectAdmin() (firebase login, or GOOGLE_APPLICATION_CREDENTIALS).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { connectAdmin } from './script-auth.js'

const here = dirname(fileURLToPath(import.meta.url))
const MODELS = [
  { name: 'lineup', file: 'lineup-classifier.json' },
  { name: 'terminal-cars', file: 'terminal-cars-classifier.json' },
]
const RESULTS_BUCKET = { 'bowen-ferry': 'production', 'bowen-ferry-staging': 'staging' }

const args = process.argv.slice(2)
const flag = args.indexOf('--project')
const projectId = flag !== -1 ? args[flag + 1] : null
const dryRun = args.includes('--dry-run')
const skipPages = args.includes('--skip-pages')
if (!projectId || !RESULTS_BUCKET[projectId]) {
  console.error('Usage: node functions/publish-models.js --project <bowen-ferry|bowen-ferry-staging> [--dry-run] [--skip-pages]')
  process.exit(1)
}

const models = []
for (const { name, file } of MODELS) {
  let model
  try {
    model = JSON.parse(readFileSync(join(here, 'models', file), 'utf8'))
  } catch (e) {
    console.error(`Cannot read models/${file}: ${e.message}`)
    process.exit(1)
  }
  if (!model.enabled || !model.version || !Array.isArray(model.weights)) {
    console.error(`models/${file} is not a trained, enabled, versioned model — nothing published.`)
    process.exit(1)
  }
  models.push({ name, file, model })
}

console.log(`Publishing to ${projectId}${dryRun ? ' (dry run)' : ''}:`)
for (const { name, model } of models) {
  console.log(
    `  ${name}: v${model.version}${model.featureSet ? ` (${model.featureSet})` : ''}, trained ${model.trainedAt}` +
      (model.metrics?.test ? `, test P ${model.metrics.test.precision} / R ${model.metrics.test.recall}` : ''),
  )
}

// Whether the running functions can be expected to pick this up without a
// deploy: not when the model's feature set differs from the previously
// published one, and not on the very first publish (the deployed build may
// predate live-model loading altogether).
let needsDeploy = false
if (!dryRun) {
  const { db, via } = await connectAdmin(projectId)
  console.log(`Connected as ${via}`)
  const col = db.collection('classifierModels')
  const liveRef = col.doc('live')
  const live = (await liveRef.get()).data() || {}
  const pointer = {}
  for (const { name, model } of models) {
    const ref = col.doc(`${name}-v${model.version}`)
    if ((await ref.get()).exists) console.log(`  ${name}-v${model.version}: already recorded`)
    else {
      await ref.set({ name, ...model, syncedAt: Date.now(), publishedBy: via })
      console.log(`  ${name}-v${model.version}: recorded`)
    }
    const prev = live[name]
    if (prev?.version === model.version) console.log(`  ${name}: live pointer already at v${model.version}`)
    else console.log(`  ${name}: live pointer ${prev ? `v${prev.version}` : '(none)'} → v${model.version}`)
    if (!prev || (prev.featureSet ?? null) !== (model.featureSet ?? null)) needsDeploy = true
    pointer[name] = {
      version: model.version,
      featureSet: model.featureSet ?? null,
      trainedAt: model.trainedAt ?? null,
      publishedAt: Date.now(),
    }
  }
  await liveRef.set(pointer, { merge: true })
  console.log('  live pointer written — functions pick it up within ten minutes')
} else {
  console.log('  (dry run: no Firestore writes)')
}

if (skipPages) console.log('Results pages: skipped (--skip-pages)')
else {
  const script = join(here, '..', 'scripts', 'deploy-classifier-results.sh')
  const extra = [RESULTS_BUCKET[projectId] === 'production' ? '--production' : null, dryRun ? '--dry-run' : null].filter(Boolean)
  console.log(`Results pages: bash scripts/deploy-classifier-results.sh ${extra.join(' ')}`)
  const r = spawnSync('bash', [script, ...extra], { stdio: 'inherit' })
  if (r.status !== 0) {
    console.error('Results pages publish failed (models were published).')
    process.exit(r.status ?? 1)
  }
}

console.log('')
const fnDeploy = `npm run deploy:functions${projectId === 'bowen-ferry' ? ':production' : ''}`
if (dryRun) {
  console.log('Dry run: whether a functions deploy is needed is decided against the live pointer at publish time.')
} else if (needsDeploy) {
  console.log('NOTE: first publish for a model, or its feature set changed. The running functions keep')
  console.log('using their bundled model until you deploy, and the webapp needs a deploy for its browser')
  console.log(`mirror:  ${fnDeploy}  and  npm run deploy:webapp`)
} else {
  console.log('No functions deploy needed for this retrain. The browser mirror picks up the model on')
  console.log('the next webapp deploy (npm run deploy:webapp).')
}
