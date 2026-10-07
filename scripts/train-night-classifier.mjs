#!/usr/bin/env node
// Train the NIGHT crosswalk classifier: the same logistic regression and the
// same two regions as the day model (scripts/train-lineup-classifier.mjs),
// but on stable-pixel COMPOSITES of dark frames (functions/lib/lineup-features.js
// COMPOSITE / extractCompositeFeatures). The day model is blind at night in
// both directions — headlight blooms read as a queue and a real pre-dawn
// queue reads as nothing (docs/lineup-classifier.md "Night: stable-pixel
// composites") — so night gets its own weights and production switches on
// the dark gate.
//
// Labels, for DARK frames only (solar elevation below DARK_ELEVATION_DEG):
//   1. training-data/lineup-dark-labels.json  { path: 0|1 } — hand labels
//      from training-data/lineup-dark-labeling.html (build-dark-label-page.mjs)
//   2. else the manifest label (a rider's crosswalk mark on that sailing,
//      frames at/after the mark are 1) — the day trainer ignores these on dark
//      frames; here they are the point.
// Features: the trailing window (≤ COMPOSITE.k frames, no gap over
// COMPOSITE.maxGapMs) → stable composite → the day feature extraction. A
// frame with no earlier frame in its window still trains (composite of one
// = itself) but is flagged, so --min-window 2 can exclude it.
//
// Usage:
//   node scripts/train-night-classifier.mjs [--data training-data]
//     [--out functions/models/lineup-night-classifier.json]
//     [--epochs 1000] [--lr 0.1] [--l2 1e-2] [--threshold 0.7]
//     [--min-window 1] [--force]
// Refuses to write a model whose held-out precision or recall is below 0.8
// unless --force. Few labels vs 1632 weights: the L2 default is 100x the
// day model's.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import {
  REGIONS,
  FEATURE_LENGTH,
  COMPOSITE,
  extractCompositeFeatures,
} from '../functions/lib/lineup-features.js'
import { isDarkAt } from '../functions/lib/daylight.js'
import { firstSustainedPositiveTs } from '../functions/lib/lineup-labels.js'

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : dflt
}
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = flag('data', join(repoRoot, 'training-data'))
const OUT = flag('out', join(repoRoot, 'functions/models/lineup-night-classifier.json'))
const EPOCHS = Number(flag('epochs', '1000'))
const LR = Number(flag('lr', '0.1'))
const L2 = Number(flag('l2', '1e-2'))
const THRESHOLD = Number(flag('threshold', '0.7'))
const MIN_WINDOW = Number(flag('min-window', '1'))
const FORCE = args.includes('--force')
const METRIC_FLOOR = 0.8

// --- Load ----------------------------------------------------------------------
const handPath = join(DATA, 'lineup-dark-labels.json')
const hand = existsSync(handPath) ? JSON.parse(readFileSync(handPath, 'utf8')) : {}
const rows = []
for (const line of readFileSync(join(DATA, 'manifest.csv'), 'utf8').trim().split('\n').slice(1)) {
  const [path, sailingKey, ts, label, crosswalkAt] = line.split(',')
  if (!path.startsWith('webcams/community/')) continue
  const file = join(DATA, 'frames', path)
  if (!existsSync(file)) continue
  rows.push({
    path,
    sailingKey,
    ts: Number(ts),
    crosswalkAt: crosswalkAt ? Number(crosswalkAt) : null,
    riderLabel: label === '0' ? 0 : label === '1' ? 1 : null,
    file,
    dark: isDarkAt(Number(ts)),
  })
}
const bySailing = new Map()
for (const r of rows) {
  if (!bySailing.has(r.sailingKey)) bySailing.set(r.sailingKey, [])
  bySailing.get(r.sailingKey).push(r)
}
for (const l of bySailing.values()) l.sort((a, b) => a.ts - b.ts)

// Dark frames → composite features (+ label when there is one).
const samples = []
let handUsed = 0
let riderUsed = 0
let unreadable = 0
for (const [key, list] of bySailing) {
  if (!list.some((r) => r.dark)) continue
  for (let i = 0; i < list.length; i++) {
    const r = list[i]
    if (!r.dark) continue
    const win = [r]
    for (let j = i - 1; j >= 0 && win.length < COMPOSITE.k; j--) {
      if (win[0].ts - list[j].ts > COMPOSITE.maxGapMs) break
      win.unshift(list[j])
    }
    let features
    try {
      features = await extractCompositeFeatures(win.map((w) => readFileSync(w.file)))
    } catch (e) {
      unreadable++
      continue
    }
    let y = null
    if (hand[r.path] === 0 || hand[r.path] === 1) {
      y = hand[r.path]
      handUsed++
    } else if (r.riderLabel != null) {
      y = r.riderLabel
      riderUsed++
    }
    samples.push({ path: r.path, sailingKey: key, ts: r.ts, crosswalkAt: r.crosswalkAt, y, window: win.length, features })
  }
}
console.log(
  `${samples.length} dark frames composited in ${new Set(samples.map((s) => s.sailingKey)).size} sailings ` +
    `(${unreadable} unreadable skipped); labels: ${handUsed} hand, ${riderUsed} from rider marks`,
)
const labeled = samples.filter((s) => s.y != null && s.window >= MIN_WINDOW)
const nPos = labeled.filter((s) => s.y === 1).length
console.log(`${labeled.length} labeled (${nPos} past crosswalk, ${labeled.length - nPos} not yet)`)
if (labeled.length < 20 || nPos < 5 || labeled.length - nPos < 5) {
  console.error('Not enough night labels of both kinds to train — label more via training-data/lineup-dark-labeling.html.')
  process.exit(1)
}

// Deterministic ~80/20 split by sailing — the same hash rule as the day trainer.
const isTest = (key) => createHash('md5').update(key).digest()[0] % 5 === 0
const train = labeled.filter((s) => !isTest(s.sailingKey))
const test = labeled.filter((s) => isTest(s.sailingKey))
console.log(`train ${train.length} (${train.filter((s) => s.y === 1).length} pos) · test ${test.length} (${test.filter((s) => s.y === 1).length} pos)`)
if (!train.length || !test.length) {
  console.error('Empty train or test split — need labels on more sailings.')
  process.exit(1)
}

// --- Logistic regression, batch gradient descent --------------------------------
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

function metrics(set) {
  let tp = 0, fp = 0, fn = 0, correct = 0
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

// Sequence check over dark frames only (the night path runs where the day
// path is gated off): first positive confirmed by the next.
let agree = 0, early = 0, late = 0, missed = 0, phantom = 0, unknown = 0
for (const [key, list] of bySailing) {
  const frames = samples.filter((s) => s.sailingKey === key).sort((a, c) => a.ts - c.ts)
  if (frames.length < 2) continue
  const det = firstSustainedPositiveTs(frames.map((s) => ({ ts: s.ts, positive: predict(s.features) >= THRESHOLD })))
  const human = list[0].crosswalkAt
  const humanDark = human != null && frames.some((s) => s.ts >= human)
  if (det == null) {
    if (humanDark) missed++
    continue
  }
  if (human == null) {
    // No human mark: a hand "not yet" on the detection frame makes it a phantom.
    if (hand[frames.find((s) => s.ts === det)?.path] === 0) phantom++
    else unknown++
    continue
  }
  const d = (det - human) / 60000
  if (d <= -10) early++
  else if (d < 10) agree++
  else late++
}
console.log(`sequence (dark frames): agree ${agree} · early ${early} · late ${late} · missed ${missed} · phantom ${phantom} · unknown ${unknown}`)

if (!FORCE && ((testM.precision ?? 0) < METRIC_FLOOR || (testM.recall ?? 0) < METRIC_FLOOR)) {
  console.error(`Held-out precision/recall below ${METRIC_FLOOR} — not writing ${OUT} (use --force to override).`)
  process.exit(2)
}

let version = 1
try {
  version = (JSON.parse(readFileSync(OUT, 'utf8')).version ?? 0) + 1
} catch {
  // first night model
}
const model = {
  enabled: true,
  type: 'logistic',
  night: true,
  version,
  regions: REGIONS,
  composite: { mode: 'stable', k: COMPOSITE.k, tau: COMPOSITE.tau, width: COMPOSITE.width, height: COMPOSITE.height },
  weights: [...w],
  bias: b,
  threshold: THRESHOLD,
  metrics: { train: trainM, test: testM, trainFrames: train.length, testFrames: test.length, sequence: { agree, early, late, missed, phantom, unknown } },
  dataset: {
    labeledFrames: labeled.length,
    handLabels: handUsed,
    riderLabels: riderUsed,
    sailings: new Set(labeled.map((s) => s.sailingKey)).size,
    from: [...bySailing.keys()].sort()[0]?.slice(0, 10) ?? null,
    to: [...bySailing.keys()].sort().pop()?.slice(0, 10) ?? null,
  },
  trainedAt: new Date().toISOString(),
}
writeFileSync(OUT, JSON.stringify(model, null, 1) + '\n')
console.log(`Wrote ${OUT} (night model v${version}, ${FEATURE_LENGTH} weights)`)
