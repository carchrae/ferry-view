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
//     [--boundary-weight]  (downweight near-crosswalkAt labels — see below,
//                           off by default: CV showed it doubles phantoms)
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
import { isDarkAt } from '../functions/lib/daylight.js'
import { effectiveCrosswalk } from '../functions/lib/lineup-labels.js'
import { TZ } from '../functions/lib/time.js'
import {
  buildExamplesPage,
  buildSummaryPage,
  esc,
  fmtTime,
  thumbName,
  encodeFeatures,
  modelHistory,
  archiveModel,
  printHistory,
  saveHistoryRows,
  loadHistoryRows,
  recordAndRenderNightly,
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
  // A truncated JPEG (seen 2026-09-05: two 2026-08-22 frames cut off at
  // upload, broken in Storage itself) would otherwise abort the whole run.
  let features
  try {
    features = await extractFeatures(bytes)
  } catch (e) {
    console.warn(`Skipping unreadable frame file: ${path} (${e.message})`)
    continue
  }
  samples.push({
    path,
    sailingKey,
    ts: Number(ts),
    crosswalkAt: crosswalkAt ? Number(crosswalkAt) : null,
    y: label === '0' ? 0 : label === '1' ? 1 : null,
    dark: isDarkAt(Number(ts)),
    features,
  })
}
// Dark frames (lib/daylight.js) never train or evaluate: production skips
// them entirely (webcam.js gate, 2026-09-05 — the community cam goes black
// at night and headlights read as a queue), and a crosswalkAt-derived label
// on a black frame teaches exactly that mistake.
const labeled = samples.filter((s) => s.y != null && !s.dark)
const darkLabeled = samples.filter((s) => s.y != null && s.dark).length
if (darkLabeled) console.log(`${darkLabeled} labeled dark frames excluded from train/test`)
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
// Boundary weighting (--boundary-weight, OFF by default): downweight frames
// near the human crosswalkAt mark — the mark is only one 5-minute frame
// precise, so those labels are near-coin-flips. Weight = min(1, max(0.3,
// |ts − crosswalkAt| / 15 min)). Tried 2026-09-05
// (boundary-weight-experiment.mjs): the single held-out split looked like a
// clear win (recall 0.914 → 0.947, severity cost 22 → 16), but 5-fold CV
// over the whole dataset showed the trade it actually makes — +6 agreeing
// sailings and −2 missed, at the price of DOUBLING phantoms (2 → 4:
// detections on rider-refuted sailings), for a worse severity cost
// (140 → 149). A phantom pins a permanent wrong crosswalkFullAtAuto, so the
// default stays off; the flag remains for re-testing when the dataset
// grows. Hard EXCLUSION of the neighbor frames is strictly worse (precision
// drops, more too-early detections).
const BOUNDARY_WEIGHT = args.includes('--boundary-weight')
const MIN15 = 15 * 60 * 1000
const sampleWeight = (s) =>
  !BOUNDARY_WEIGHT || s.crosswalkAt == null
    ? 1
    : Math.min(1, Math.max(0.3, Math.abs(s.ts - s.crosswalkAt) / MIN15))
const w = new Float64Array(FEATURE_LENGTH)
let b = 0
const sigmoid = (z) => 1 / (1 + Math.exp(-z))
const predict = (f) => {
  let z = b
  for (let i = 0; i < FEATURE_LENGTH; i++) z += w[i] * f[i]
  return sigmoid(z)
}

const trainWeights = train.map(sampleWeight)
const weightSum = trainWeights.reduce((a, x) => a + x, 0)
for (let epoch = 0; epoch < EPOCHS; epoch++) {
  const gw = new Float64Array(FEATURE_LENGTH)
  let gb = 0
  for (let j = 0; j < train.length; j++) {
    const s = train[j]
    const err = (predict(s.features) - s.y) * trainWeights[j]
    for (let i = 0; i < FEATURE_LENGTH; i++) gw[i] += err * s.features[i]
    gb += err
  }
  for (let i = 0; i < FEATURE_LENGTH; i++) w[i] -= LR * (gw[i] / weightSum + L2 * w[i])
  b -= LR * (gb / weightSum)
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
// Dark labeled frames are in neither split (excluded above) — no card, or a
// black frame would render with a train/test badge and count as an error the
// model never made.
const cardRows = rows.filter((r) => r.y != null && !r.dark)

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
    // Dark frames are invisible to the sequence rule, as in production
    // (webcam.js never classifies them): confirmation needs two consecutive
    // daylight positives.
    const detectedTs = firstSustainedPositiveTs(
      frames.filter((f) => !f.dark).map((f) => ({ ts: f.ts, positive: f.yhat === 1 })),
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

// --- Detection-error severity profile -----------------------------------------
// Binary frame metrics treat every mistake equally, but the errors are not
// equal (Tom, 2026-09-05): a detection one frame before the human's mark is a
// near-miss, while a detection on a sailing the rider REFUTED ("never
// crossed") is a phantom — the worst failure the classifier can produce.
// Sailings whose latest human word is a notYet refute have no crosswalkAt in
// the manifest (never mislabeled), so refutes are read from the raw report
// archive; deleted reports are skipped, and effectiveCrosswalk() applies the
// same latest-wins rule as the app.
const refuted = new Set()
{
  const reportsPath = join(DATA, 'lineup-reports.json')
  if (existsSync(reportsPath)) {
    const byKey = new Map()
    for (const r of JSON.parse(readFileSync(reportsPath, 'utf8'))) {
      if (r.deleted) continue
      if (!byKey.has(r.sailingKey)) byKey.set(r.sailingKey, [])
      byKey.get(r.sailingKey).push(r)
    }
    for (const [key, list] of byKey) {
      if (effectiveCrosswalk(list)?.notYet) refuted.add(key)
    }
  }
}

// Severity buckets, worst first. `costs` turns the profile into one scalar
// for cross-version comparison — the weights encode "how bad", not
// probability: a phantom (10) pins a permanent wrong crosswalkFullAtAuto on
// a sailing the rider denied; very-early (6) fires the sticky save and a
// wrong robot report long before reality; slightly-early (2) and missed (2)
// are real but mild; late (1) still tells the truth, just slowly; within one
// cadence step either way (≤10 min, 'agree') is as correct as a 5-minute
// frame interval can express.
const SEQ_COSTS = { phantom: 10, early30: 6, early10: 2, late10: 1, late30: 2, missed: 2 }
function severityProfile(preds) {
  const buckets = {
    phantom: [],
    early30: [],
    early10: [],
    agree: [],
    late10: [],
    late30: [],
    missed: [],
    unknown: [],
  }
  for (const s of preds) {
    // Dark frames were never classified — a sailing needs two CLASSIFIABLE
    // frames before its non-detection can count as a miss.
    if (s.frames.filter((f) => !f.dark).length < 2) continue
    if (s.detectedTs == null) {
      if (s.humanTs != null) buckets.missed.push(s.key)
      continue
    }
    if (s.humanTs == null) {
      buckets[refuted.has(s.key) ? 'phantom' : 'unknown'].push(s.key)
      continue
    }
    const dMin = (s.detectedTs - s.humanTs) / 60000
    if (dMin <= -30) buckets.early30.push(s.key)
    else if (dMin <= -10) buckets.early10.push(s.key)
    else if (dMin < 10) buckets.agree.push(s.key)
    else if (dMin < 30) buckets.late10.push(s.key)
    else buckets.late30.push(s.key)
  }
  const counts = Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length]))
  const cost = Object.entries(SEQ_COSTS).reduce((a, [k, c]) => a + c * buckets[k].length, 0)
  return { buckets, counts, cost }
}
const seqProfile = severityProfile(predictions)
console.log('sequence severity:', seqProfile.counts, `cost=${seqProfile.cost}`)
for (const k of ['phantom', 'early30']) {
  for (const key of seqProfile.buckets[k]) console.log(`  ${k}: ${key}`)
}

// --- Model history: past versions re-scored on TODAY's data -------------------
// Past shipped models (functions/models/history/, git-backfilled — see
// modelHistory in classifier-report.mjs) are re-run over the current frames:
// same features, same deterministic by-sailing split every version has always
// used, so their held-out frame metrics and sequence severity are directly
// comparable to this run's. A version whose regions/feature-length no longer
// match gets its stored metrics only.
function evalHistorical(m) {
  if (!Array.isArray(m.weights) || m.weights.length !== FEATURE_LENGTH) return null
  // Feature LENGTH alone can't prove compatibility — an ROI moved without
  // resizing (it has happened: fe779d2) keeps the length while changing what
  // every pixel means. A model trained on different crops must not be
  // re-scored, or a meaningless score could win champion selection.
  if (JSON.stringify(m.regions) !== JSON.stringify(REGIONS)) return null
  const th = m.threshold ?? 0.7
  const score = (f) => {
    let z = m.bias || 0
    for (let i = 0; i < FEATURE_LENGTH; i++) z += m.weights[i] * f[i]
    return sigmoid(z)
  }
  let tp = 0
  let fp = 0
  let fn = 0
  for (const s of test) {
    const yhat = score(s.features) >= th ? 1 : 0
    if (yhat === 1 && s.y === 1) tp++
    if (yhat === 1 && s.y === 0) fp++
    if (yhat === 0 && s.y === 1) fn++
  }
  const preds = [...seqGroups.entries()].map(([key, frames]) => ({
    key,
    frames,
    detectedTs: firstSustainedPositiveTs(
      frames.filter((f) => !f.dark).map((f) => ({ ts: f.ts, positive: score(f.features) >= th })),
    ),
    humanTs: frames[0].crosswalkAt,
  }))
  const prof = severityProfile(preds)
  // Champion selection must NOT use the full-dataset cost: ~80% of those
  // sailings are in the fresh candidate's train split, so an overfit
  // candidate would beat honest past champions by memorization. Selection
  // uses the held-out sailings only; the full profile stays for display.
  const testProf = severityProfile(preds.filter((p) => isTest(p.key)))
  const r = (n, d) => (d ? Math.round((n / d) * 1000) / 1000 : null)
  return {
    today: { precision: r(tp, tp + fp), recall: r(tp, tp + fn) },
    seq: {
      agree: prof.counts.agree,
      phantom: prof.counts.phantom,
      missed: prof.counts.missed,
      cost: prof.cost,
    },
    testCost: testProf.cost,
  }
}

const asTrainedRow = (m) => ({
  label: `v${m.version}`,
  trainedAt: m.trainedAt,
  frames:
    (m.dataset?.labeledFrames ??
      (m.metrics?.trainFrames != null ? m.metrics.trainFrames + m.metrics.testFrames : null)) ||
    null,
  asTrained: m.metrics?.test
    ? { precision: m.metrics.test.precision, recall: m.metrics.test.recall }
    : null,
})

let deployedVersion = null
try {
  deployedVersion = JSON.parse(
    readFileSync(join(repoRoot, 'functions/models/lineup-classifier.json'), 'utf8'),
  ).version
} catch {
  // No deployed model.
}
const pastModels = modelHistory(repoRoot, 'functions/models/lineup-classifier.json')
const pastEvals = pastModels.map((m) => ({ m, ev: evalHistorical(m) }))
const crosswalkHistory = [
  {
    label: 'this run',
    trainedAt: new Date().toISOString(),
    frames: labeled.length,
    asTrained: { precision: testM.precision, recall: testM.recall },
    today: { precision: testM.precision, recall: testM.recall },
    seq: {
      agree: seqProfile.counts.agree,
      phantom: seqProfile.counts.phantom,
      missed: seqProfile.counts.missed,
      cost: seqProfile.cost,
    },
  },
  ...pastEvals.map(({ m, ev }) => ({
    ...asTrainedRow(m),
    label: `v${m.version}${m.version === deployedVersion ? ' (shipped)' : ''}`,
    ...(ev || {}),
  })),
]
const terminalHistory =
  loadHistoryRows(DATA, 'terminal') ??
  modelHistory(repoRoot, 'functions/models/terminal-cars-classifier.json').map(asTrainedRow)
saveHistoryRows(DATA, 'crosswalk', crosswalkHistory)
printHistory('vs prior models (crosswalk):', crosswalkHistory)

// Persist per-sailing conclusions for downstream use (the fullness pipeline
// joins these with the terminal-cars classifier). notFullByCrosswalk: the
// lineup never confirmed past the crosswalk, so the ferry DEFINITELY left
// with room — except for today's still-boarding sailing (inProgress), where
// the lineup may simply not have built yet.
const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: TZ })
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
      // Only CLASSIFIABLE (non-dark) frames are evidence of absence — an
      // all-dark sailing was never looked at and proves nothing.
      notFullByCrosswalk: s.detectedTs == null && s.frames.filter((f) => !f.dark).length >= 2,
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
  metrics: {
    train: trainM,
    test: testM,
    trainFrames: train.length,
    testFrames: test.length,
    sequence: { ...seqProfile.counts, cost: seqProfile.cost, meanAbsMin },
  },
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
  <p>Severity vs human word (sailings with ≥2 frames): ${esc(
    Object.entries(seqProfile.counts)
      .map(([k, n]) => `${k} ${n}`)
      .join(' · '),
  )} — cost ${seqProfile.cost} (phantom = detected on a rider-refuted sailing; early/late
  = distance from the rider's mark; a ≤10 min gap counts as agreement at the 5-minute
  frame cadence).</p>
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
        history: terminalHistory,
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
      history: crosswalkHistory,
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

// --auto (the nightly job): the metric floor is irrelevant — the candidate
// is always archived and only becomes live by BEATING every prior version on
// today's data, which is a stronger gate than any absolute floor.
const AUTO = args.includes('--auto')
if (!AUTO && !FORCE && ((testM.precision ?? 0) < METRIC_FLOOR || (testM.recall ?? 0) < METRIC_FLOOR)) {
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
let prevModel = null
try {
  prevModel = JSON.parse(readFileSync(OUT, 'utf8'))
} catch {
  // First versioned model.
}
const prevVersion = prevModel?.version || 0
const dates = samples.map((s) => s.sailingKey.slice(0, 10)).sort()
const dataset = {
  from: dates[0] ?? null,
  to: dates[dates.length - 1] ?? null,
  frames: samples.length,
  labeledFrames: labeled.length,
  sailings: new Set(samples.map((s) => s.sailingKey)).size,
}

// The live file may hold an OLDER version than the newest archive once the
// nightly selection keeps a past champion, so new versions number from the
// max across live + history — never reusing a burned number.
const nextVersion = Math.max(prevVersion, ...pastModels.map((m) => m.version || 0), 0) + 1
const shippedModel = {
  enabled: true,
  type: 'logistic',
  version: nextVersion,
  regions: REGIONS,
  weights: [...w].map((x) => Math.round(x * 1e6) / 1e6),
  bias: Math.round(b * 1e6) / 1e6,
  threshold: THRESHOLD,
  metrics: {
    train: trainM,
    test: testM,
    trainFrames: train.length,
    testFrames: test.length,
    sequence: { ...seqProfile.counts, cost: seqProfile.cost, meanAbsMin },
  },
  dataset,
  trainedAt: new Date().toISOString(),
}
// Training is deterministic, so unchanged data + config reproduces some
// earlier model's weights exactly — don't mint a new version for a duplicate.
const identicalTo = (m) =>
  m &&
  m.bias === shippedModel.bias &&
  m.threshold === shippedModel.threshold &&
  JSON.stringify(m.weights) === JSON.stringify(shippedModel.weights)
const dupOf = [prevModel, ...pastModels].find(identicalTo)

if (!AUTO) {
  if (dupOf && dupOf.version === prevModel?.version) {
    console.log(`Model identical to live v${dupOf.version} — nothing to write.`)
  } else if (dupOf) {
    // The retrain reproduced an ARCHIVED version that is not the live one
    // (e.g. --auto previously kept an older champion live). A manual train
    // means "ship what I just trained" — so the archived twin goes live,
    // keeping its original version number.
    writeFileSync(OUT, JSON.stringify(dupOf, null, 2) + '\n')
    console.log(
      `Model identical to archived v${dupOf.version} — made v${dupOf.version} live (was v${prevVersion}). Deploy functions to activate.`,
    )
  } else {
    // Past versions stay browsable as files (history/<name>-v<n>.json) — the
    // report's Model history table reads that directory.
    archiveModel(OUT, shippedModel)
    writeFileSync(OUT, JSON.stringify(shippedModel, null, 2) + '\n')
    console.log(`Model v${nextVersion} written to ${OUT} — deploy functions to activate.`)
  }
} else {
  // Nightly champion selection: archive the candidate unconditionally, then
  // let EVERY archived version compete on today's data — lowest sequence
  // severity cost wins (ties broken by frame precision+recall), and the
  // winner becomes the live model. A candidate that loses is still kept for
  // future nights (more data may vindicate it).
  let candidate = shippedModel
  if (dupOf) {
    candidate = dupOf
    console.log(`Candidate identical to v${dupOf.version} — not re-archived.`)
  } else {
    archiveModel(OUT, shippedModel)
    console.log(`Candidate archived as v${shippedModel.version}.`)
  }
  // Ranked on HELD-OUT sailings only (see evalHistorical) — the full-dataset
  // cost in the display tables is train-contaminated for the candidate.
  const candTestProfile = severityProfile(predictions.filter((s) => isTest(s.key)))
  const contenders = [
    {
      label: `candidate v${candidate.version}`,
      model: candidate,
      cost: candTestProfile.cost,
      pr: (testM.precision || 0) + (testM.recall || 0),
    },
    ...pastEvals
      .filter(({ m, ev }) => ev && m.version !== candidate.version)
      .map(({ m, ev }) => ({
        label: `v${m.version}`,
        model: m,
        cost: ev.testCost,
        pr: (ev.today.precision || 0) + (ev.today.recall || 0),
      })),
  ].sort((x, y) => x.cost - y.cost || y.pr - x.pr)
  const best = contenders[0]
  // "Beat every prior version" is vacuous when no archived version is
  // comparable (fresh checkout, or a REGIONS change invalidating the whole
  // archive) — fall back to the absolute floor rather than shipping an
  // ungated candidate.
  const vetoed =
    contenders.length === 1 &&
    ((testM.precision ?? 0) < METRIC_FLOOR || (testM.recall ?? 0) < METRIC_FLOOR)
  const replaced = !vetoed && best.model.version !== prevVersion
  if (vetoed) {
    console.log(
      `No comparable archived versions and candidate below the ${METRIC_FLOOR} floor — live model left unchanged.`,
    )
  } else if (replaced) {
    writeFileSync(OUT, JSON.stringify(best.model, null, 2) + '\n')
    console.log(
      `Live model replaced: v${prevVersion} → v${best.model.version} (severity cost ${best.cost}) — deploy functions to activate.`,
    )
  } else {
    console.log(`Live model stays v${prevVersion} (severity cost ${best.cost} — still the best).`)
  }
  recordAndRenderNightly(DATA, repoRoot, {
    at: shippedModel.trainedAt,
    classifier: 'crosswalk',
    scoreName: 'severity cost (held-out)',
    candidate: {
      version: candidate.version,
      precision: testM.precision,
      recall: testM.recall,
      score: candTestProfile.cost,
    },
    winner: vetoed ? prevVersion : best.model.version,
    previousLive: prevVersion,
    replaced,
    ranking: contenders.map((c) => ({ label: c.label, score: c.cost })),
  })
}
