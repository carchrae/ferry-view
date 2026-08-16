#!/usr/bin/env node
// Train the lineup classifier from the exported dataset and write the model
// that ships with the functions deploy.
//
// Plain-JS logistic regression over the shared feature extraction in
// functions/lib/lineup-features.js — the exact code that runs at inference,
// so there is no train/serve preprocessing drift. Trains in seconds on a
// laptop; no Python, no GPU.
//
// Usage:
//   node scripts/train-lineup-classifier.mjs [--data training-data]
//     [--out functions/models/lineup-classifier.json]
//     [--epochs 1000] [--lr 0.1] [--l2 1e-4] [--threshold 0.7] [--force]
//
// The train/test split is BY SAILING (not by frame): frames within one
// sailing are near-duplicates, so a frame-level split would leak and inflate
// the metrics. Refuses to write a model whose test precision or recall is
// below 0.8 unless --force.
//
// Every run also regenerates the classifier-results pages (summary +
// crosswalk examples; see scripts/lib/classifier-report.mjs) locally under
// <data>/report/ and in public/classifier-results/, even when the metric
// floor blocks the model.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import {
  extractFeatures,
  thumbnailJpeg,
  firstSustainedPositiveTs,
  FEATURE_LENGTH,
  REGIONS,
} from '../functions/lib/lineup-features.js'
import {
  buildExamplesPage,
  buildSummaryPage,
  esc,
  fmtTime,
  thumbName,
  encodeFeatures,
} from './lib/classifier-report.mjs'

const args = process.argv.slice(2)
function flag(name, dflt) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : dflt
}
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = flag('data', join(repoRoot, 'training-data'))
const OUT = flag('out', join(repoRoot, 'functions/models/lineup-classifier.json'))
// lr 0.5 was tuned on the ~640-frame 2026-07 dataset; on the ~1500-frame set
// full-batch GD diverges at that rate (loss oscillates, ends all-positive).
// 0.1 for 1000 epochs converges and clears the metric floor.
const EPOCHS = Number(flag('epochs', '1000'))
const LR = Number(flag('lr', '0.1'))
const L2 = Number(flag('l2', '1e-4'))
const THRESHOLD = Number(flag('threshold', '0.7'))
const FORCE = args.includes('--force')
// A model only ships when the held-out split clears this. Note the split is
// small (~100 frames), so a run can dip under it while 5-fold CV says the
// true metrics are fine (2026-07-24: CV precision 0.875) — use --force in
// that case, knowingly.
const METRIC_FLOOR = 0.8

// --- Load dataset -------------------------------------------------------------
const manifest = join(DATA, 'manifest.csv')
const lines = readFileSync(manifest, 'utf8').trim().split('\n').slice(1)
// ALL frames with pixels on disk — unlabeled ones (y: null) can't train, but
// the per-sailing sequence prediction in the report classifies every frame.
const samples = []
for (const line of lines) {
  const [path, sailingKey, ts, label, crosswalkAt] = line.split(',')
  const file = join(DATA, 'frames', path)
  if (!existsSync(file)) continue
  const bytes = readFileSync(file)
  if (!bytes.length) {
    console.warn(`Skipping empty frame file: ${path}`)
    continue
  }
  samples.push({
    path,
    sailingKey,
    ts: Number(ts),
    crosswalkAt: crosswalkAt ? Number(crosswalkAt) : null,
    y: label === '0' ? 0 : label === '1' ? 1 : null,
    features: await extractFeatures(bytes),
  })
}
const labeled = samples.filter((s) => s.y != null)
if (labeled.length < 20) {
  console.error(`Only ${labeled.length} labeled frames with pixels on disk — not enough to train.`)
  process.exit(1)
}

// Deterministic ~80/20 split by sailing.
const isTest = (key) => createHash('md5').update(key).digest()[0] % 5 === 0
const train = labeled.filter((s) => !isTest(s.sailingKey))
const test = labeled.filter((s) => isTest(s.sailingKey))
const pos = (set) => set.filter((s) => s.y === 1).length
console.log(
  `train: ${train.length} frames (${pos(train)} positive) — test: ${test.length} frames (${pos(test)} positive)`,
)
if (!train.length || !test.length) {
  console.error('Empty train or test split — need more tagged sailings.')
  process.exit(1)
}

// --- Logistic regression, batch gradient descent ------------------------------
const w = new Float64Array(FEATURE_LENGTH)
let b = 0
const sigmoid = (z) => 1 / (1 + Math.exp(-z))
const predict = (f) => {
  let z = b
  for (let i = 0; i < FEATURE_LENGTH; i++) z += w[i] * f[i]
  return sigmoid(z)
}

for (let epoch = 0; epoch < EPOCHS; epoch++) {
  const gw = new Float64Array(FEATURE_LENGTH)
  let gb = 0
  for (const s of train) {
    const err = predict(s.features) - s.y
    for (let i = 0; i < FEATURE_LENGTH; i++) gw[i] += err * s.features[i]
    gb += err
  }
  for (let i = 0; i < FEATURE_LENGTH; i++) w[i] -= LR * (gw[i] / train.length + L2 * w[i])
  b -= LR * (gb / train.length)
}

// --- Metrics -------------------------------------------------------------------
function metrics(set) {
  let tp = 0,
    fp = 0,
    fn = 0,
    correct = 0
  for (const s of set) {
    const yhat = predict(s.features) >= THRESHOLD ? 1 : 0
    if (yhat === s.y) correct++
    if (yhat === 1 && s.y === 1) tp++
    if (yhat === 1 && s.y === 0) fp++
    if (yhat === 0 && s.y === 1) fn++
  }
  const r = (n, d) => (d ? Math.round((n / d) * 1000) / 1000 : null)
  return { accuracy: r(correct, set.length), precision: r(tp, tp + fp), recall: r(tp, tp + fn) }
}
const trainM = metrics(train)
const testM = metrics(test)
console.log('train:', trainM)
console.log('test :', testM)

// --- Per-frame predictions & sequence results (shared by report + JSON) -------
const rows = samples.map((s) => {
  const p = predict(s.features)
  const yhat = p >= THRESHOLD ? 1 : 0
  // The exact grayscale the model saw, one byte per pixel — lets the page
  // reproduce the decision pixel-for-pixel client-side. Only labeled frames
  // get a card (and hence an explain button).
  const fb64 =
    s.y == null
      ? null
      : Buffer.from(Uint8Array.from(s.features, (f) => Math.round(f * 255))).toString('base64')
  return { ...s, p, yhat, fb64, split: isTest(s.sailingKey) ? 'test' : 'train' }
})
const cardRows = rows.filter((r) => r.y != null)

// Sequence predictions: every frame of every sailing (labeled or not), in
// capture order, through the shared rule (first positive confirmed by the
// next frame).
const seqGroups = new Map()
for (const r of rows) {
  if (!seqGroups.has(r.sailingKey)) seqGroups.set(r.sailingKey, [])
  seqGroups.get(r.sailingKey).push(r)
}
const predictions = [...seqGroups.keys()]
  .sort()
  .reverse()
  .map((key) => {
    const frames = seqGroups.get(key).sort((a, b) => a.ts - b.ts)
    const detectedTs = firstSustainedPositiveTs(
      frames.map((f) => ({ ts: f.ts, positive: f.yhat === 1 })),
    )
    const idx = frames.findIndex((f) => f.ts === detectedTs)
    return {
      key,
      frames,
      detectedTs,
      before: idx > 0 ? frames[idx - 1] : null,
      after: idx >= 0 ? frames[idx] : null,
      humanTs: frames[0].crosswalkAt,
    }
  })
const detected = predictions.filter((s) => s.detectedTs != null)
const compared = detected.filter((s) => s.humanTs != null)
const meanAbsMin = compared.length
  ? Math.round(
      compared.reduce((a, s) => a + Math.abs(s.detectedTs - s.humanTs), 0) /
        compared.length /
        60000,
    )
  : null

// Persist per-sailing conclusions for downstream use (the fullness pipeline
// joins these with the terminal-cars classifier). notFullByCrosswalk: the
// lineup never confirmed past the crosswalk, so the ferry DEFINITELY left
// with room — except for today's still-boarding sailing (inProgress), where
// the lineup may simply not have built yet.
const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
const PREDICTIONS_JSON = join(DATA, 'predictions.json')
writeFileSync(
  PREDICTIONS_JSON,
  JSON.stringify(
    predictions.map((s) => ({
      sailingKey: s.key,
      frames: s.frames.length,
      crosswalkDetectedTs: s.detectedTs,
      crosswalkDetectedProb: s.after ? Math.round(s.after.p * 1000) / 1000 : null,
      humanCrosswalkTs: s.humanTs,
      notFullByCrosswalk: s.detectedTs == null && s.frames.length >= 2,
      inProgress: s.key.startsWith(todayIso),
    })),
    null,
    1,
  ) + '\n',
)
console.log(`Per-sailing predictions saved: ${PREDICTIONS_JSON}`)

// --- Report pages -------------------------------------------------------------
// Always written — even when the metric floor blocks the model below, a failed
// run is exactly the one worth reviewing. Pages (shared builders in
// scripts/lib/classifier-report.mjs):
//   index.html      summary of BOTH classifiers
//   crosswalk.html  this classifier's examples + predicted times + ROI picker
// written twice: training-data/report/ (full-size ../frames/ photos) and
// public/classifier-results/ (committed thumbnails; ships with the webapp at
// /classifier-results, not linked from the app UI).
const freshModel = {
  weights: [...w],
  bias: b,
  threshold: THRESHOLD,
  metrics: { train: trainM, test: testM, trainFrames: train.length, testFrames: test.length },
  trainedAt: new Date().toISOString(),
}

const cardRowsFor = () =>
  cardRows.map((r) => ({ ...r, fb64: r.fb64 ?? encodeFeatures(r.features, 0) }))

function predictionsSectionHtml(srcFor) {
  return `
<section class="predictions">
  <h2>Predicted crosswalk times</h2>
  <p>Frames of each sailing are classified <em>in capture order</em>; the lineup is
  deemed past the crosswalk at the <strong>first positive frame confirmed by the next
  frame also being positive</strong> (a lone positive is treated as noise).
  Detected ${detected.length} of ${predictions.length} sailings${
    meanAbsMin != null
      ? ` · mean |Δ| vs human tag: ${meanAbsMin} min over ${compared.length} tagged sailings`
      : ''
  }.</p>
  <details class="predlist">
  <summary>${detected.length} detected sailings — predicted times with before/after photos</summary>
  ${detected
    .map((s) => {
      const d = s.humanTs != null ? Math.round((s.detectedTs - s.humanTs) / 60000) : null
      return `
  <div class="pred">
    <figure>${
      s.before
        ? `<img loading="lazy" src="${esc(srcFor(s.before))}" alt="">
      <figcaption>before · ${esc(fmtTime(s.before.ts))} · p ${s.before.p.toFixed(2)}</figcaption>`
        : `<div class="nopic">no earlier frame</div><figcaption>detection at first frame</figcaption>`
    }</figure>
    <figure class="hit"><img loading="lazy" src="${esc(srcFor(s.after))}" alt="">
      <figcaption>first past-crosswalk · ${esc(fmtTime(s.after.ts))} · p ${s.after.p.toFixed(2)}</figcaption></figure>
    <div class="pred-info">
      <strong>${esc(s.key)}</strong><br>
      predicted: <strong>${esc(fmtTime(s.detectedTs))}</strong><br>
      ${
        s.humanTs != null
          ? `human tag: ${esc(fmtTime(s.humanTs))} (Δ ${d > 0 ? '+' : ''}${d} min)`
          : 'no human tag'
      }
    </div>
  </div>`
    })
    .join('')}
  </details>
  ${
    predictions.length > detected.length
      ? `<details><summary>${predictions.length - detected.length} sailings with no detection —
  the lineup never confirmed past the crosswalk, so the robot believes these
  ferries left <strong>not full</strong></summary>
  <p>${predictions
    .filter((s) => s.detectedTs == null)
    .map((s) => esc(`${s.key} (${s.frames.length} frames)`))
    .join(' · ')}</p></details>`
      : ''
  }
</section>`
}

function crosswalkPage(srcFor) {
  return buildExamplesPage({
    title: 'Crosswalk classifier — examples',
    modelName: 'crosswalk',
    model: freshModel,
    regions: REGIONS,
    foff: 0,
    posLabel: 'past crosswalk',
    negLabel: 'not yet',
    statsLine: `${cardRows.length} labeled frames (${rows.length} total) · threshold ${THRESHOLD} · trained ${esc(freshModel.trainedAt)}`,
    topSections: predictionsSectionHtml(srcFor),
    rows: cardRowsFor(),
    groupSummary: (key, list) => {
      const mark = list.find((r) => Number.isFinite(r.crosswalkAt))?.crosswalkAt
      const bad = list.filter((r) => r.yhat !== r.y).length
      return `mark at ${mark ? esc(fmtTime(mark)) : '—'} · ${list.length} frames${bad ? ` · <em>${bad} misclassified</em>` : ''}`
    },
    pickerSrc: srcFor(detected[0]?.after || rows[0]),
    frameAspect: '16 / 9', // community cam
    srcFor,
  })
}

// Backdrop frames for the region diagrams: a real photo with a lineup in it,
// so every region drawing is anchored to what the camera actually sees.
const backdropCrosswalk = rows.find((r) => r.y === 1) || rows[0]
const backdropTerminalPath = (() => {
  const tm = join(DATA, 'terminal-manifest.csv')
  if (!existsSync(tm)) return null
  const line = readFileSync(tm, 'utf8')
    .trim()
    .split('\n')
    .slice(1)
    .find((l) => /,1$/.test(l) && existsSync(join(DATA, 'frames', l.split(',')[0])))
  return line ? line.split(',')[0] : null
})()

// Summary page covers both classifiers: fresh in-memory data for this one,
// the shipped model file for the other (absent → placeholder note).
function summaryPage(srcFor) {
  let terminal = null
  try {
    const tm = JSON.parse(readFileSync(join(repoRoot, 'functions/models/terminal-cars-classifier.json'), 'utf8'))
    if (tm.enabled) {
      const tmanifest = join(DATA, 'terminal-manifest.csv')
      const tRows = existsSync(tmanifest)
        ? readFileSync(tmanifest, 'utf8').trim().split('\n').slice(1)
        : []
      terminal = {
        model: tm,
        regions: tm.regions,
        foff: -0.5,
        photo: backdropTerminalPath ? srcFor({ path: backdropTerminalPath }) : null,
        statsLine: `${tRows.filter((l) => l.split(',')[3] === '0' || l.split(',')[3] === '1').length} labeled of ${tRows.length} archived terminal frames`,
      }
    }
  } catch {
    // No terminal model yet — the summary shows a placeholder.
  }
  return buildSummaryPage({
    crosswalk: {
      model: freshModel,
      regions: REGIONS,
      foff: 0,
      photo: srcFor(backdropCrosswalk),
      statsLine: `${cardRows.length} labeled of ${rows.length} archived lineup frames`,
    },
    terminal,
  })
}

const LOCAL_DIR = join(DATA, 'report')
mkdirSync(LOCAL_DIR, { recursive: true })
const localSrc = (r) => '../frames/' + r.path.split('/').map(encodeURIComponent).join('/')
writeFileSync(join(LOCAL_DIR, 'crosswalk.html'), crosswalkPage(localSrc))
writeFileSync(join(LOCAL_DIR, 'index.html'), summaryPage(localSrc))
console.log(`\nReport pages: file://${encodeURI(join(LOCAL_DIR, 'index.html'))}`)

const PUB_DIR = join(repoRoot, 'public', 'classifier-results')
const THUMBS = join(PUB_DIR, 'thumbs')
mkdirSync(THUMBS, { recursive: true })
for (const s of samples) {
  const dest = join(THUMBS, thumbName(s.path))
  if (existsSync(dest)) continue // frames are immutable
  writeFileSync(dest, await thumbnailJpeg(readFileSync(join(DATA, 'frames', s.path))))
}
if (backdropTerminalPath) {
  // The summary page's terminal diagram sits on a terminal frame, which is not
  // one of this trainer's samples — thumbnail it too or the public copy 404s.
  const dest = join(THUMBS, thumbName(backdropTerminalPath))
  if (!existsSync(dest))
    writeFileSync(dest, await thumbnailJpeg(readFileSync(join(DATA, 'frames', backdropTerminalPath))))
}
// Relative thumbs/ paths: they resolve against the local files written just
// below when the report is opened locally, and against the same bucket prefix
// once deployed (npm run deploy:classifier-results uploads pages + thumbs
// together), so the published copy is self-contained.
const pubSrc = (r) => 'thumbs/' + thumbName(r.path)
writeFileSync(join(PUB_DIR, 'crosswalk.html'), crosswalkPage(pubSrc))
writeFileSync(join(PUB_DIR, 'index.html'), summaryPage(pubSrc))
console.log(`Webapp copy: ${join(PUB_DIR, 'index.html')} (commit + deploy → /classifier-results)\n`)

if (!FORCE && ((testM.precision ?? 0) < METRIC_FLOOR || (testM.recall ?? 0) < METRIC_FLOOR)) {
  console.error(
    `Test precision/recall below ${METRIC_FLOOR} — not writing model (use --force to override).`,
  )
  process.exit(1)
}

// Each shipped model gets a monotonically increasing version plus a snapshot
// of the training set it saw (date range, image counts). The functions sync
// versioned models into Firestore (classifierModels/{name}-v{version}, see
// functions/lib/classifier-models.js) and stamp the version on every robot
// verdict, so predictions stay attributable to their exact model.
let prevVersion = 0
try {
  prevVersion = JSON.parse(readFileSync(OUT, 'utf8')).version || 0
} catch {
  // First versioned model.
}
const dates = samples.map((s) => s.sailingKey.slice(0, 10)).sort()
const dataset = {
  from: dates[0] ?? null,
  to: dates[dates.length - 1] ?? null,
  frames: samples.length,
  labeledFrames: labeled.length,
  sailings: new Set(samples.map((s) => s.sailingKey)).size,
}

writeFileSync(
  OUT,
  JSON.stringify(
    {
      enabled: true,
      type: 'logistic',
      version: prevVersion + 1,
      regions: REGIONS,
      weights: [...w].map((x) => Math.round(x * 1e6) / 1e6),
      bias: Math.round(b * 1e6) / 1e6,
      threshold: THRESHOLD,
      metrics: { train: trainM, test: testM, trainFrames: train.length, testFrames: test.length },
      dataset,
      trainedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + '\n',
)
console.log(`Model v${prevVersion + 1} written to ${OUT} — deploy functions to activate.`)
