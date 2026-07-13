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
//     [--epochs 300] [--lr 0.5] [--l2 1e-4] [--threshold 0.7] [--force]
//
// The train/test split is BY SAILING (not by frame): frames within one
// sailing are near-duplicates, so a frame-level split would leak and inflate
// the metrics. Refuses to write a model whose test precision or recall is
// below 0.8 unless --force.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import {
  extractFeatures,
  FEATURE_LENGTH,
  FEATURE_WIDTH,
  FEATURE_HEIGHT,
  ROI,
} from '../functions/lib/lineup-features.js'

const args = process.argv.slice(2)
function flag(name, dflt) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : dflt
}
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = flag('data', join(repoRoot, 'training-data'))
const OUT = flag('out', join(repoRoot, 'functions/models/lineup-classifier.json'))
const EPOCHS = Number(flag('epochs', '300'))
const LR = Number(flag('lr', '0.5'))
const L2 = Number(flag('l2', '1e-4'))
const THRESHOLD = Number(flag('threshold', '0.7'))
const FORCE = args.includes('--force')
const METRIC_FLOOR = 0.8

// --- Load dataset -------------------------------------------------------------
const manifest = join(DATA, 'manifest.csv')
const lines = readFileSync(manifest, 'utf8').trim().split('\n').slice(1)
const samples = []
for (const line of lines) {
  const [path, sailingKey, , label] = line.split(',')
  if (label !== '0' && label !== '1') continue
  const file = join(DATA, 'frames', path)
  if (!existsSync(file)) continue
  samples.push({ sailingKey, y: Number(label), features: await extractFeatures(readFileSync(file)) })
}
if (samples.length < 20) {
  console.error(`Only ${samples.length} labeled frames with pixels on disk — not enough to train.`)
  process.exit(1)
}

// Deterministic ~80/20 split by sailing.
const isTest = (key) => createHash('md5').update(key).digest()[0] % 5 === 0
const train = samples.filter((s) => !isTest(s.sailingKey))
const test = samples.filter((s) => isTest(s.sailingKey))
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

if (!FORCE && ((testM.precision ?? 0) < METRIC_FLOOR || (testM.recall ?? 0) < METRIC_FLOOR)) {
  console.error(
    `Test precision/recall below ${METRIC_FLOOR} — not writing model (use --force to override).`,
  )
  process.exit(1)
}

writeFileSync(
  OUT,
  JSON.stringify(
    {
      enabled: true,
      type: 'logistic',
      roi: ROI,
      size: [FEATURE_WIDTH, FEATURE_HEIGHT],
      weights: [...w].map((x) => Math.round(x * 1e6) / 1e6),
      bias: Math.round(b * 1e6) / 1e6,
      threshold: THRESHOLD,
      metrics: { train: trainM, test: testM, trainFrames: train.length, testFrames: test.length },
      trainedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + '\n',
)
console.log(`Model written to ${OUT} — deploy functions to activate.`)
