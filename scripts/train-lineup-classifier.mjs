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
//
// Every run also writes <data>/report.html — a per-example review page
// (photo + ROI overlay, human answer, model probability) — and prints its
// file:// link. It is written even when the metric floor blocks the model.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import {
  extractFeatures,
  thumbnailJpeg,
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
  const [path, sailingKey, ts, label, crosswalkAt] = line.split(',')
  if (label !== '0' && label !== '1') continue
  const file = join(DATA, 'frames', path)
  if (!existsSync(file)) continue
  samples.push({
    path,
    sailingKey,
    ts: Number(ts),
    crosswalkAt: Number(crosswalkAt),
    y: Number(label),
    features: await extractFeatures(readFileSync(file)),
  })
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

// --- Per-example review report ------------------------------------------------
// Always written — even when the metric floor blocks the model below, a failed
// run is exactly the one worth reviewing. One card per frame: the photo (with
// the ROI the classifier actually sees outlined), the human answer, and the
// model's probability.
//
// Two copies:
//  - training-data/report.html — local, full-size photos from frames/
//  - public/classifier-results/index.html — ships with the webapp (served at
//    /classifier-results; not linked from the app). Frames vanish from
//    Storage after 14 days, so this copy uses small committed thumbnails
//    (hashed filenames: colon/space-free and Windows-safe).
const REPORT = join(DATA, 'report.html')
writeFileSync(
  REPORT,
  buildReport((r) => 'frames/' + r.path.split('/').map(encodeURIComponent).join('/')),
)
console.log(`\nPer-example review report: file://${encodeURI(REPORT)}`)

const PUB_DIR = join(repoRoot, 'public', 'classifier-results')
const THUMBS = join(PUB_DIR, 'thumbs')
mkdirSync(THUMBS, { recursive: true })
const thumbName = (path) => createHash('md5').update(path).digest('hex').slice(0, 16) + '.jpg'
for (const s of samples) {
  const dest = join(THUMBS, thumbName(s.path))
  if (existsSync(dest)) continue // frames are immutable
  writeFileSync(dest, await thumbnailJpeg(readFileSync(join(DATA, 'frames', s.path))))
}
writeFileSync(join(PUB_DIR, 'index.html'), buildReport((r) => 'thumbs/' + thumbName(r.path)))
console.log(`Webapp copy: ${join(PUB_DIR, 'index.html')} (commit + deploy → /classifier-results)\n`)

function buildReport(srcFor) {
  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const fmtTime = (ms) =>
    new Date(ms).toLocaleString('en-CA', {
      timeZone: 'America/Vancouver',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  const pct = (x) => `${Math.round(x * 100)}%`

  const rows = samples.map((s) => {
    const p = predict(s.features)
    const yhat = p >= THRESHOLD ? 1 : 0
    // The exact 48×27 grayscale the model saw, one byte per pixel — lets the
    // page reproduce the decision pixel-for-pixel client-side.
    const fb64 = Buffer.from(Uint8Array.from(s.features, (f) => Math.round(f * 255))).toString(
      'base64',
    )
    return { ...s, p, yhat, fb64, split: isTest(s.sailingKey) ? 'test' : 'train' }
  })
  const errors = rows.filter((r) => r.yhat !== r.y).length

  // Group by sailing, most recent first; frames in capture order.
  const groups = new Map()
  for (const r of rows) {
    if (!groups.has(r.sailingKey)) groups.set(r.sailingKey, [])
    groups.get(r.sailingKey).push(r)
  }
  const groupKeys = [...groups.keys()].sort().reverse()

  const card = (r) => {
    const src = srcFor(r)
    const verdict =
      r.yhat === r.y
        ? `<span class="badge ok">✓ correct</span>`
        : `<span class="badge bad">✗ ${r.yhat === 1 ? 'false positive' : 'false negative'}</span>`
    return `
      <figure class="card ${r.yhat === r.y ? 'ok' : 'err'} ${r.split} ${r.y ? 'pos' : 'neg'}">
        <div class="imgwrap"><img loading="lazy" src="${esc(src)}" alt=""><div class="roi"></div></div>
        <figcaption>
          <div class="row"><strong>${esc(fmtTime(r.ts))}</strong>
            <span class="badge ${r.split}">${r.split}</span> ${verdict}
            <button class="explain" data-f="${r.fb64}" data-p="${r.p}">explain</button></div>
          <div class="row">human: <strong>${r.y ? 'past crosswalk' : 'not yet'}</strong>
            &nbsp;·&nbsp; model: <strong>${r.p.toFixed(3)}</strong> → ${r.yhat ? 'past crosswalk' : 'not yet'}</div>
          <div class="prob"><div class="fill ${r.yhat ? 'pos' : ''}" style="width:${pct(r.p)}"></div>
            <div class="thresh" style="left:${pct(THRESHOLD)}"></div></div>
        </figcaption>
      </figure>`
  }

  const sections = groupKeys
    .map((key) => {
      const list = groups.get(key)
      list.sort((a, b) => a.ts - b.ts)
      const mark = list.find((r) => Number.isFinite(r.crosswalkAt))?.crosswalkAt
      const bad = list.filter((r) => r.yhat !== r.y).length
      return `
      <section>
        <h2>${esc(key)} <small>mark at ${mark ? esc(fmtTime(mark)) : '—'} ·
          ${list.length} frames${bad ? ` · <em>${bad} misclassified</em>` : ''}</small></h2>
        <div class="cards">${list.map(card).join('')}</div>
      </section>`
    })
    .join('')

  const m = (label, x) =>
    `<tr><th>${label}</th><td>${x.accuracy ?? '—'}</td><td>${x.precision ?? '—'}</td><td>${x.recall ?? '—'}</td></tr>`

  return `<!doctype html>
<meta charset="utf-8">
<title>Lineup classifier — training review</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 1.5rem; }
  h2 small { font-weight: normal; opacity: 0.7; font-size: 0.8em; }
  table { border-collapse: collapse; margin: 0.5rem 0 1rem; }
  th, td { padding: 0.2rem 0.8rem; text-align: left; border-bottom: 1px solid #8884; }
  nav { position: sticky; top: 0; padding: 0.5rem 0; background: Canvas; z-index: 1; }
  nav button { margin-right: 0.4rem; padding: 0.3rem 0.8rem; cursor: pointer; }
  nav button.active { outline: 2px solid Highlight; }
  .cards { display: flex; flex-wrap: wrap; gap: 1rem; }
  .card { margin: 0; width: 320px; border: 1px solid #8884; border-radius: 8px; overflow: hidden; }
  .card.err { border-color: #d33; box-shadow: 0 0 0 1px #d33; }
  .imgwrap { position: relative; }
  .imgwrap img { width: 100%; display: block; }
  .roi { position: absolute; border: 2px dashed #fc0; pointer-events: none;
    left: ${ROI.left * 100}%; top: ${ROI.top * 100}%;
    width: ${ROI.width * 100}%; height: ${ROI.height * 100}%; }
  figcaption { padding: 0.5rem 0.7rem; font-size: 0.85rem; }
  .row { margin-bottom: 0.3rem; }
  .badge { padding: 0.05rem 0.45rem; border-radius: 99px; font-size: 0.75em; border: 1px solid #8886; }
  .badge.ok { background: #2a72; } .badge.bad { background: #d334; }
  .prob { position: relative; height: 8px; border-radius: 4px; background: #8883; }
  .prob .fill { height: 100%; border-radius: 4px; background: #888; }
  .prob .fill.pos { background: #2a7; }
  .prob .thresh { position: absolute; top: -3px; width: 2px; height: 14px; background: #fc0; }
  nav .group { display: inline-block; margin-right: 1.2rem; }
  nav .group > span { opacity: 0.6; font-size: 0.8rem; margin-right: 0.3rem; }
  button.explain { float: right; font-size: 0.75em; padding: 0.1rem 0.5rem; cursor: pointer; }
  .method { max-width: 46rem; }
  .method .expert { font-size: 0.85rem; opacity: 0.85; }
  details.how { margin: 0.5rem 0 1rem; max-width: 46rem; }
  details.how summary { cursor: pointer; font-weight: bold; }
  .panels { display: flex; flex-wrap: wrap; gap: 1.2rem; margin: 0.8rem 0; }
  .panels canvas { width: 192px; height: 108px; image-rendering: pixelated; border: 1px solid #8884; background: #fff; }
  .panels p { margin: 0.3rem 0 0; font-size: 0.8rem; opacity: 0.8; max-width: 192px; }
  dialog { border: 1px solid #8886; border-radius: 8px; max-width: 58rem; }
  dialog::backdrop { background: #0008; }
  .legend { font-size: 0.8rem; opacity: 0.8; }
  body[data-verdict="ok"] .card:not(.ok) { display: none; }
  body[data-verdict="err"] .card:not(.err) { display: none; }
  body[data-label="pos"] .card:not(.pos) { display: none; }
  body[data-label="neg"] .card:not(.neg) { display: none; }
  body[data-split="test"] .card:not(.test) { display: none; }
  body[data-split="train"] .card:not(.train) { display: none; }
</style>
<h1>Lineup classifier — training review</h1>
<p>${rows.length} labeled frames · ${errors} misclassified · threshold ${THRESHOLD} ·
  trained ${esc(new Date().toISOString())}<br>
  <span class="roi-hint">dashed box = region of interest the classifier sees</span></p>
<section class="method">
  <p><strong>In plain terms:</strong> a webcam photographs the ferry lineup every few
  minutes, and riders mark the moment cars back up past the crosswalk. From those
  examples the computer learns, for one fixed strip of road, which spots being light
  or dark usually means the lineup has reached the crosswalk. For each new photo it
  adds up those learned clues into a confidence score between 0 and 1 — at
  ${THRESHOLD} or higher it says “past crosswalk”. It is a deliberately simple
  learner: no deep network, just a weighted sum of pixels, small enough to run in
  milliseconds and to inspect by eye (see below).</p>
  <p class="expert"><strong>For experts:</strong> binary logistic regression on raw
  pixel intensities. Preprocessing: fixed fractional ROI crop →
  ${FEATURE_WIDTH}×${FEATURE_HEIGHT} grayscale, normalized to [0,1] — the same module
  (<code>functions/lib/lineup-features.js</code>) runs at training and inference, so
  there is no train/serve skew. Labels: per-sailing rider marks reduced latest-wins
  (<code>lineup-labels.js</code>, shared with the app); frames captured at/after the
  mark are positive. Optimizer: full-batch gradient descent, ${EPOCHS} epochs,
  lr ${LR}, L2 ${L2}. Split: ~80/20 <em>by sailing</em> (md5 bucket of the sailing
  key) since frames within a sailing are near-duplicates and a frame-level split
  would leak. Decision threshold ${THRESHOLD}; the model ships as JSON weights and
  runs in ~5 ms/frame on CPU inside the existing Cloud Function poll.</p>
</section>
<table>
  <tr><th></th><th>accuracy</th><th>precision</th><th>recall</th></tr>
  ${m(`train (${train.length})`, trainM)}
  ${m(`test (${test.length})`, testM)}
</table>
<details class="how">
  <summary>How the classifier works</summary>
  <p>The model never sees the whole photo: the dashed region of interest is
  cropped, downscaled to ${FEATURE_WIDTH}×${FEATURE_HEIGHT} grayscale, and each of the
  ${FEATURE_LENGTH} pixels gets one learned weight (logistic regression). A pixel's
  brightness × its weight is its vote; the votes plus a bias are summed and
  squashed to a probability. ≥ ${THRESHOLD} means “past crosswalk”.</p>
  <div class="panels">
    <div><canvas id="wmap" width="${FEATURE_WIDTH}" height="${FEATURE_HEIGHT}"></canvas>
      <p>the learned weight map — <span style="color:#c22">red</span> pixels vote
      “past crosswalk” when bright, <span style="color:#26c">blue</span> pixels
      vote “not yet” when bright</p></div>
  </div>
  <p>The <em>explain</em> button on any card shows this frame's actual model
  input and which pixels decided its outcome.</p>
</details>
<nav>
  <span class="group"><span>result</span>
    <button data-group="verdict" data-value="" class="active">all</button>
    <button data-group="verdict" data-value="ok">correct (${rows.length - errors})</button>
    <button data-group="verdict" data-value="err">misclassified (${errors})</button>
  </span>
  <span class="group"><span>human answer</span>
    <button data-group="label" data-value="" class="active">all</button>
    <button data-group="label" data-value="neg">not yet (${rows.filter((r) => !r.y).length})</button>
    <button data-group="label" data-value="pos">past crosswalk (${rows.filter((r) => r.y).length})</button>
  </span>
  <span class="group"><span>split</span>
    <button data-group="split" data-value="" class="active">all</button>
    <button data-group="split" data-value="test">test (${test.length})</button>
    <button data-group="split" data-value="train">train (${train.length})</button>
  </span>
</nav>
${sections}
<dialog id="explain-dialog">
  <h3 id="ex-title">Why the model decided this</h3>
  <div class="panels">
    <div><canvas id="ex-in" width="${FEATURE_WIDTH}" height="${FEATURE_HEIGHT}"></canvas>
      <p>what the model saw (ROI → ${FEATURE_WIDTH}×${FEATURE_HEIGHT} grayscale)</p></div>
    <div><canvas id="ex-w" width="${FEATURE_WIDTH}" height="${FEATURE_HEIGHT}"></canvas>
      <p>learned weights (same for every frame)</p></div>
    <div><canvas id="ex-contrib" width="${FEATURE_WIDTH}" height="${FEATURE_HEIGHT}"></canvas>
      <p><strong>this frame's votes</strong> (input × weight)</p></div>
    <div><canvas id="ex-diff" width="${FEATURE_WIDTH}" height="${FEATURE_HEIGHT}"></canvas>
      <p><strong>votes − weights</strong> — where this frame falls short of a
      fully-bright ROI: strongest where an influential pixel is dark</p></div>
  </div>
  <p id="ex-math"></p>
  <p class="legend"><span style="color:#c22">red</span> pushes toward “past crosswalk”,
    <span style="color:#26c">blue</span> toward “not yet”; stronger color = stronger pull.</p>
  <form method="dialog"><button>close</button></form>
</dialog>
<script>
  const MODEL = {
    weights: ${JSON.stringify([...w].map((x) => Math.round(x * 1e5) / 1e5))},
    bias: ${Math.round(b * 1e5) / 1e5},
    threshold: ${THRESHOLD},
    w: ${FEATURE_WIDTH}, h: ${FEATURE_HEIGHT},
  }

  // vals in [0,1] → grayscale; signed=true → diverging red (+) / blue (−),
  // scaled to the largest magnitude.
  function paint(canvas, vals, signed) {
    const ctx = canvas.getContext('2d')
    const img = ctx.createImageData(MODEL.w, MODEL.h)
    const max = signed ? Math.max(...vals.map(Math.abs), 1e-9) : 1
    vals.forEach((v, i) => {
      let r, g, bl
      if (signed) {
        const t = v / max
        r = t > 0 ? 255 : 255 * (1 + t)
        bl = t < 0 ? 255 : 255 * (1 - t)
        g = 255 * (1 - Math.abs(t))
      } else r = g = bl = v * 255
      img.data.set([r, g, bl, 255], i * 4)
    })
    ctx.putImageData(img, 0, 0)
  }
  paint(document.getElementById('wmap'), MODEL.weights, true)
  paint(document.getElementById('ex-w'), MODEL.weights, true)

  const dialog = document.getElementById('explain-dialog')
  document.querySelectorAll('button.explain').forEach((btn) => {
    btn.onclick = () => {
      const bytes = Uint8Array.from(atob(btn.dataset.f), (c) => c.charCodeAt(0))
      const input = [...bytes].map((v) => v / 255)
      const votes = input.map((v, i) => v * MODEL.weights[i])
      const sum = votes.reduce((a, x) => a + x, 0)
      const z = MODEL.bias + sum
      const p = 1 / (1 + Math.exp(-z))
      paint(document.getElementById('ex-in'), input, false)
      paint(document.getElementById('ex-contrib'), votes, true)
      paint(document.getElementById('ex-diff'), votes.map((v, i) => v - MODEL.weights[i]), true)
      document.getElementById('ex-math').innerHTML =
        'bias <strong>' + MODEL.bias.toFixed(3) + '</strong> + pixel votes <strong>' +
        sum.toFixed(3) + '</strong> = ' + z.toFixed(3) +
        ' → probability <strong>' + p.toFixed(3) + '</strong> ' +
        (p >= MODEL.threshold ? '≥' : '<') + ' threshold ' + MODEL.threshold +
        ' → <strong>' + (p >= MODEL.threshold ? 'past crosswalk' : 'not yet') + '</strong>'
      dialog.showModal()
    }
  })

  document.querySelectorAll('nav button').forEach((b) => {
    b.onclick = () => {
      document.body.dataset[b.dataset.group] = b.dataset.value
      document
        .querySelectorAll('nav button[data-group="' + b.dataset.group + '"]')
        .forEach((x) => x.classList.toggle('active', x === b))
      document.querySelectorAll('section').forEach((sec) => {
        const any = [...sec.querySelectorAll('.card')].some((c) => getComputedStyle(c).display !== 'none')
        sec.style.display = any ? '' : 'none'
      })
    }
  })
</script>
`
}

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
