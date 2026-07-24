#!/usr/bin/env node
// Train the terminal-cars classifier ("are there cars waiting in the Bowen
// terminal frame?") from the exported dataset, and (re)generate the labeling
// page used to produce its ground truth.
//
// Independent of the crosswalk classifier: its own features
// (functions/lib/terminal-features.js), manifest
// (training-data/terminal-manifest.csv, written by the exporter), labels
// (training-data/terminal-labels.json, written by hand via the labeling
// page) and model (functions/models/terminal-cars-classifier.json).
//
// Workflow:
//   npm run lineup:export        # downloads terminal frames + manifest
//   npm run terminal:train       # 1st run: writes terminal-labeling.html
//   <open the page, click frames: green = cars, red = no cars, copy JSON,
//    save as training-data/terminal-labels.json>
//   npm run lineup:export        # re-joins labels into the manifest
//   npm run terminal:train       # enough labels → trains + writes the model
//
// Usage:
//   node scripts/train-terminal-classifier.mjs [--label-only]
//     [--epochs 300] [--lr 0.5] [--l2 1e-4] [--threshold 0.5] [--force]

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import {
  extractTerminalFeatures,
  TERMINAL_FEATURE_LENGTH,
  TERMINAL_REGIONS,
} from '../functions/lib/terminal-features.js'

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : dflt
}
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(repoRoot, 'training-data')
const OUT = join(repoRoot, 'functions/models/terminal-cars-classifier.json')
const LABEL_PAGE = join(DATA, 'terminal-labeling.html')
const EPOCHS = Number(flag('epochs', '300'))
const LR = Number(flag('lr', '0.5'))
const L2 = Number(flag('l2', '1e-4'))
const THRESHOLD = Number(flag('threshold', '0.5'))
const FORCE = args.includes('--force')
const LABEL_ONLY = args.includes('--label-only')
const MIN_LABELS = 60
// Mirrors the (temporarily lowered) crosswalk floor — see
// train-lineup-classifier.mjs.
const METRIC_FLOOR = 0.75

// --- Load manifest ------------------------------------------------------------
const manifest = join(DATA, 'terminal-manifest.csv')
if (!existsSync(manifest)) {
  console.error('No terminal-manifest.csv — run `npm run lineup:export` first.')
  process.exit(1)
}
const rows = readFileSync(manifest, 'utf8')
  .trim()
  .split('\n')
  .slice(1)
  .map((line) => {
    const [path, sailingKey, ts, label] = line.split(',')
    return { path, sailingKey, ts: Number(ts), label }
  })
  .filter((r) => r.path && existsSync(join(DATA, 'frames', r.path)))

// --- Labeling page (always regenerated) ---------------------------------------
// One tile per frame on disk, grouped by sailing, newest first. Clicking
// cycles unlabeled → cars → no cars → unlabeled; existing labels prefill.
const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const groups = new Map()
for (const r of rows) {
  if (!groups.has(r.sailingKey)) groups.set(r.sailingKey, [])
  groups.get(r.sailingKey).push(r)
}
const prefill = {}
for (const r of rows) if (r.label === '0' || r.label === '1') prefill[r.path] = Number(r.label)

const sections = [...groups.keys()]
  .sort()
  .reverse()
  .map((key) => {
    const list = groups.get(key).sort((a, b) => a.ts - b.ts)
    return `
  <details class="sailing"><summary>${esc(key)} <small>${list.length} frames</small></summary>
    <div class="tiles">${list
      .map(
        (r) => `
      <figure class="tile" data-path="${esc(r.path)}">
        <img loading="lazy" src="frames/${esc(r.path.split('/').map(encodeURIComponent).join('/'))}" alt="">
        <figcaption></figcaption>
      </figure>`,
      )
      .join('')}
    </div>
  </details>`
  })
  .join('')

writeFileSync(
  LABEL_PAGE,
  `<!doctype html>
<meta charset="utf-8">
<title>Terminal frames — cars / no cars labeling</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 1.5rem; }
  nav { position: sticky; top: 0; background: Canvas; padding: 0.5rem 0; z-index: 1; }
  nav button { padding: 0.3rem 0.8rem; cursor: pointer; margin-right: 0.4rem; }
  details.sailing { margin: 0.6rem 0; }
  details.sailing summary { cursor: pointer; font-weight: bold; }
  .tiles { display: flex; flex-wrap: wrap; gap: 0.6rem; margin-top: 0.5rem; }
  .tile { margin: 0; width: 220px; cursor: pointer; border: 3px solid #8884; border-radius: 6px; }
  .tile img { width: 100%; display: block; }
  .tile figcaption { font-size: 0.75rem; text-align: center; padding: 0.15rem; }
  .tile.cars { border-color: #2a7; }
  .tile.nocars { border-color: #d33; }
  pre { background: #8882; padding: 0.5rem; border-radius: 6px; max-height: 12rem; overflow: auto; }
</style>
<h1>Terminal frames — label cars / no cars</h1>
<p>Click a frame to cycle: <em>unlabeled</em> → <strong style="color:#2a7">cars</strong> →
<strong style="color:#d33">no cars</strong> → unlabeled. When done, copy the JSON and save it
as <code>training-data/terminal-labels.json</code>, then run
<code>npm run lineup:export</code> and <code>npm run terminal:train</code>.</p>
<nav>
  <button id="copy">copy JSON</button><span id="copied" hidden>copied ✓</span>
  <span id="count"></span>
</nav>
${sections}
<pre id="out"></pre>
<script>
  const labels = ${JSON.stringify(prefill)}
  const out = document.getElementById('out')
  const count = document.getElementById('count')
  const apply = (tile) => {
    const v = labels[tile.dataset.path]
    tile.classList.toggle('cars', v === 1)
    tile.classList.toggle('nocars', v === 0)
    tile.querySelector('figcaption').textContent = v === 1 ? 'cars' : v === 0 ? 'no cars' : '—'
  }
  const render = () => {
    out.textContent = JSON.stringify(labels, null, 1)
    count.textContent = Object.keys(labels).length + ' labeled'
  }
  document.querySelectorAll('.tile').forEach((tile) => {
    apply(tile)
    tile.onclick = () => {
      const cur = labels[tile.dataset.path]
      if (cur === undefined) labels[tile.dataset.path] = 1
      else if (cur === 1) labels[tile.dataset.path] = 0
      else delete labels[tile.dataset.path]
      apply(tile)
      render()
    }
  })
  document.getElementById('copy').onclick = async () => {
    await navigator.clipboard.writeText(JSON.stringify(labels, null, 1))
    const c = document.getElementById('copied')
    c.hidden = false
    setTimeout(() => { c.hidden = true }, 1500)
  }
  render()
</script>
`,
)
console.log(`Labeling page: file://${encodeURI(LABEL_PAGE)}`)

// --- Train (when enough labels) ------------------------------------------------
const labeled = rows.filter((r) => r.label === '0' || r.label === '1')
if (LABEL_ONLY || labeled.length < MIN_LABELS) {
  console.log(
    `${labeled.length}/${MIN_LABELS} labeled terminal frames — label more via the page above, then re-run.`,
  )
  process.exit(0)
}

const samples = []
for (const r of labeled) {
  samples.push({
    sailingKey: r.sailingKey,
    y: Number(r.label),
    features: await extractTerminalFeatures(readFileSync(join(DATA, 'frames', r.path))),
  })
}
const isTest = (key) => createHash('md5').update(key).digest()[0] % 5 === 0
const train = samples.filter((s) => !isTest(s.sailingKey))
const test = samples.filter((s) => isTest(s.sailingKey))
console.log(`train: ${train.length} frames — test: ${test.length} frames`)
if (!train.length || !test.length) {
  console.error('Empty train or test split — need labels across more sailings.')
  process.exit(1)
}

const w = new Float64Array(TERMINAL_FEATURE_LENGTH)
let b = 0
const predict = (f) => {
  let z = b
  for (let i = 0; i < TERMINAL_FEATURE_LENGTH; i++) z += w[i] * f[i]
  return 1 / (1 + Math.exp(-z))
}
for (let epoch = 0; epoch < EPOCHS; epoch++) {
  const gw = new Float64Array(TERMINAL_FEATURE_LENGTH)
  let gb = 0
  for (const s of train) {
    const err = predict(s.features) - s.y
    for (let i = 0; i < TERMINAL_FEATURE_LENGTH; i++) gw[i] += err * s.features[i]
    gb += err
  }
  for (let i = 0; i < TERMINAL_FEATURE_LENGTH; i++) w[i] -= LR * (gw[i] / train.length + L2 * w[i])
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
      regions: TERMINAL_REGIONS,
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
