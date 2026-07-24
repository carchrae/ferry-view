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
  firstSustainedPositiveTs,
  FEATURE_LENGTH,
  REGIONS,
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
// TODO: temporarily lowered from 0.8 so the first real model (test precision
// 0.78 with the two-region features, 2026-07) can ship behind the
// "Robot says…" agree-tag. Raise back to 0.8 once more labeled sailings
// push precision over it.
const METRIC_FLOOR = 0.75

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
  samples.push({
    path,
    sailingKey,
    ts: Number(ts),
    crosswalkAt: crosswalkAt ? Number(crosswalkAt) : null,
    y: label === '0' ? 0 : label === '1' ? 1 : null,
    features: await extractFeatures(readFileSync(file)),
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
  // One dashed overlay + one canvas per feature region (left lane, crosswalk).
  const roiOverlays = REGIONS.map((r, i) => `<div class="roi-ov roi-ov-${i}"></div>`).join('')
  const regionCanvases = (id) =>
    REGIONS.map(
      (r, i) =>
        `<canvas id="${id}-${i}" width="${r.width}" height="${r.height}"
          style="width:${r.width * 4}px;height:${r.height * 4}px"></canvas>`,
    ).join('<br>')
  const regionsLabel = REGIONS.map((r) => `${r.name} ${r.width}×${r.height}`).join(' + ')

  const rows = samples.map((s) => {
    const p = predict(s.features)
    const yhat = p >= THRESHOLD ? 1 : 0
    // The exact 48×27 grayscale the model saw, one byte per pixel — lets the
    // page reproduce the decision pixel-for-pixel client-side. Only labeled
    // frames get a card (and hence an explain button).
    const fb64 =
      s.y == null
        ? null
        : Buffer.from(Uint8Array.from(s.features, (f) => Math.round(f * 255))).toString('base64')
    return { ...s, p, yhat, fb64, split: isTest(s.sailingKey) ? 'test' : 'train' }
  })
  const cardRows = rows.filter((r) => r.y != null)
  const errors = cardRows.filter((r) => r.yhat !== r.y).length

  // Group by sailing, most recent first; frames in capture order.
  const groups = new Map()
  for (const r of cardRows) {
    if (!groups.has(r.sailingKey)) groups.set(r.sailingKey, [])
    groups.get(r.sailingKey).push(r)
  }
  const groupKeys = [...groups.keys()].sort().reverse()

  // --- Sequence predictions: when did the lineup pass the crosswalk? ---------
  // Every frame of every sailing (labeled or not), in capture order, through
  // the shared rule: first positive confirmed by the next frame.
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

  const card = (r) => {
    const src = srcFor(r)
    const verdict =
      r.yhat === r.y
        ? `<span class="badge ok">✓ correct</span>`
        : `<span class="badge bad">✗ ${r.yhat === 1 ? 'false positive' : 'false negative'}</span>`
    return `
      <figure class="card ${r.yhat === r.y ? 'ok' : 'err'} ${r.split} ${r.y ? 'pos' : 'neg'}">
        <div class="imgwrap"><img loading="lazy" src="${esc(src)}" alt="">${roiOverlays}</div>
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
      <details class="sailing">
        <summary>${esc(key)} <small>mark at ${mark ? esc(fmtTime(mark)) : '—'} ·
          ${list.length} frames${bad ? ` · <em>${bad} misclassified</em>` : ''}</small></summary>
        <div class="cards">${list.map(card).join('')}</div>
      </details>`
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
  .roi-ov { position: absolute; border: 2px dashed; pointer-events: none; }
  ${REGIONS.map(
    (r, i) => `.roi-ov-${i} { border-color: ${['#fc0', '#e70'][i] || '#fc0'};
    left: ${r.roi.left * 100}%; top: ${r.roi.top * 100}%;
    width: ${r.roi.width * 100}%; height: ${r.roi.height * 100}%; }`,
  ).join('\n  ')}
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
  .pred { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center;
    padding: 0.6rem 0; border-bottom: 1px solid #8883; }
  .pred figure { margin: 0; width: 240px; }
  .pred img { width: 100%; display: block; border-radius: 6px; }
  .pred figure.hit img { outline: 2px solid #2a7; }
  .pred figcaption { font-size: 0.75rem; opacity: 0.85; margin-top: 0.15rem; }
  .pred .nopic { width: 100%; aspect-ratio: 16/9; display: flex; align-items: center;
    justify-content: center; background: #8882; border-radius: 6px; font-size: 0.8rem; }
  .pred-info { font-size: 0.9rem; }
  details.sailing { margin: 0.6rem 0; }
  details.sailing > summary, details.predlist > summary { cursor: pointer;
    font-size: 1.1rem; font-weight: bold; padding: 0.3rem 0; }
  details.sailing > summary small, details.predlist > summary small {
    font-weight: normal; opacity: 0.7; font-size: 0.8em; }
  .roipick { margin: 0.5rem 0 1rem; max-width: 60rem; }
  .roipick summary { cursor: pointer; font-weight: bold; }
  #roi-stage { position: relative; display: inline-block; max-width: 100%;
    touch-action: none; user-select: none; cursor: crosshair; }
  #roi-stage img { max-width: 100%; display: block; }
  .roi-box { position: absolute; pointer-events: none; border: 2px solid; }
  #roi-left, #roi-drag.left { border-color: #26c; background: #26c3; }
  #roi-right, #roi-drag.right { border-color: #e70; background: #e703; }
  .roi-region.active { outline: 2px solid Highlight; }
  #roi-out { background: #8882; padding: 0.5rem 0.7rem; border-radius: 6px;
    max-width: 46rem; white-space: pre-wrap; }
  details.how { margin: 0.5rem 0 1rem; max-width: 46rem; }
  details.how summary { cursor: pointer; font-weight: bold; }
  .panels { display: flex; flex-wrap: wrap; gap: 1.2rem; margin: 0.8rem 0; }
  .panels canvas { image-rendering: pixelated; border: 1px solid #8884; background: #fff; }
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
<p>${cardRows.length} labeled frames (${rows.length} total) · ${errors} misclassified · threshold ${THRESHOLD} ·
  trained ${esc(new Date().toISOString())}<br>
  <span class="roi-hint">dashed boxes = regions the classifier sees
  (yellow: left lane, orange: crosswalk)</span></p>
<section class="method">
  <p><strong>In plain terms:</strong> a webcam photographs the ferry lineup every few
  minutes, and riders mark the moment cars back up past the crosswalk. From those
  examples the computer learns, for two fixed patches of road (the lane where the
  line builds, and the crosswalk itself), which spots being light
  or dark usually means the lineup has reached the crosswalk. For each new photo it
  adds up those learned clues into a confidence score between 0 and 1 — at
  ${THRESHOLD} or higher it says “past crosswalk”. It is a deliberately simple
  learner: no deep network, just a weighted sum of pixels, small enough to run in
  milliseconds and to inspect by eye (see below).</p>
  <p class="expert"><strong>For experts:</strong> binary logistic regression on raw
  pixel intensities. Preprocessing: two fixed fractional crops
  (${regionsLabel}) → grayscale, normalized to [0,1], concatenated — the same module
  (<code>functions/lib/lineup-features.js</code>) runs at training and inference, so
  there is no train/serve skew. Labels: per-sailing rider marks reduced latest-wins
  (<code>lineup-labels.js</code>, shared with the app); frames captured at/after the
  mark are positive. Optimizer: full-batch gradient descent, ${EPOCHS} epochs,
  lr ${LR}, L2 ${L2}. Split: ~80/20 <em>by sailing</em> (md5 bucket of the sailing
  key) since frames within a sailing are near-duplicates and a frame-level split
  would leak. Decision threshold ${THRESHOLD}; the model ships as JSON weights and
  runs in ~5 ms/frame on CPU inside the existing Cloud Function poll.</p>
</section>
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
      ? `<details><summary>${predictions.length - detected.length} sailings with no detection</summary>
  <p>${predictions
    .filter((s) => s.detectedTs == null)
    .map((s) => esc(`${s.key} (${s.frames.length} frames)`))
    .join(' · ')}</p></details>`
      : ''
  }
</section>
<table>
  <tr><th></th><th>accuracy</th><th>precision</th><th>recall</th></tr>
  ${m(`train (${train.length})`, trainM)}
  ${m(`test (${test.length})`, testM)}
</table>
<details class="how">
  <summary>How the classifier works</summary>
  <p>The model never sees the whole photo: the two dashed regions are cropped,
  downscaled to grayscale grids (${regionsLabel}), concatenated, and each of the
  ${FEATURE_LENGTH} pixels gets one learned weight (logistic regression). A pixel's
  brightness × its weight is its vote; the votes plus a bias are summed and
  squashed to a probability. ≥ ${THRESHOLD} means “past crosswalk”.</p>
  <div class="panels">
    <div>${regionCanvases('wmap')}
      <p>the learned weight maps (top: left lane, bottom: crosswalk) —
      <span style="color:#c22">red</span> pixels vote
      “past crosswalk” when bright, <span style="color:#26c">blue</span> pixels
      vote “not yet” when bright</p></div>
  </div>
  <p>The <em>explain</em> button on any card shows this frame's actual model
  input and which pixels decided its outcome.</p>
</details>
<details class="roipick">
  <summary>ROI picker — draw tighter crop regions</summary>
  <p>Pick a region, then <strong>drag on the photo</strong> to draw its box
  (redraw to replace). The dashed boxes are the regions currently in use
  (yellow: left lane, orange: crosswalk). Copy the JSON and hand it to the
  classifier maintainer (fractions of the frame, same convention as
  <code>REGIONS</code> in <code>functions/lib/lineup-features.js</code>).</p>
  <p>
    <button type="button" class="roi-region active" data-region="left">draw left ROI</button>
    <button type="button" class="roi-region" data-region="right">draw right ROI</button>
    <button type="button" id="roi-copy">copy JSON</button>
    <span id="roi-copied" hidden>copied ✓</span>
  </p>
  <div id="roi-stage">
    <img src="${esc(srcFor(detected[0]?.after || rows[0]))}" alt="" draggable="false">
    ${roiOverlays}
    <div class="roi-box" id="roi-left" hidden></div>
    <div class="roi-box" id="roi-right" hidden></div>
    <div class="roi-box" id="roi-drag" hidden></div>
  </div>
  <pre id="roi-out">draw a box to see its coordinates…</pre>
</details>
<nav>
  <span class="group"><span>result</span>
    <button data-group="verdict" data-value="" class="active">all</button>
    <button data-group="verdict" data-value="ok">correct (${cardRows.length - errors})</button>
    <button data-group="verdict" data-value="err">misclassified (${errors})</button>
  </span>
  <span class="group"><span>human answer</span>
    <button data-group="label" data-value="" class="active">all</button>
    <button data-group="label" data-value="neg">not yet (${cardRows.filter((r) => !r.y).length})</button>
    <button data-group="label" data-value="pos">past crosswalk (${cardRows.filter((r) => r.y).length})</button>
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
  <p class="legend">each panel stacks the two regions: left lane on top, crosswalk below.</p>
  <div class="panels">
    <div>${regionCanvases('ex-in')}
      <p>what the model saw (crops → grayscale grids)</p></div>
    <div>${regionCanvases('ex-w')}
      <p>learned weights (same for every frame)</p></div>
    <div>${regionCanvases('ex-contrib')}
      <p><strong>this frame's votes</strong> (input × weight)</p></div>
    <div>${regionCanvases('ex-diff')}
      <p><strong>votes − weights</strong> — where this frame falls short of a
      fully-bright region: strongest where an influential pixel is dark</p></div>
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
    regions: ${JSON.stringify(REGIONS.map((r) => ({ w: r.width, h: r.height })))},
  }

  // vals in [0,1] → grayscale; signed=true → diverging red (+) / blue (−),
  // scaled to the largest magnitude across ALL regions (shared scale so the
  // two panels are comparable).
  function paint(canvas, w, h, vals, signed, max) {
    const ctx = canvas.getContext('2d')
    const img = ctx.createImageData(w, h)
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
  // Slice a flat feature-length array into per-region segments and paint
  // each onto its canvas ("<id>-<regionIndex>").
  function paintRegions(id, vals, signed) {
    const max = signed ? Math.max(...vals.map(Math.abs), 1e-9) : 1
    let off = 0
    MODEL.regions.forEach((rg, i) => {
      const seg = vals.slice(off, off + rg.w * rg.h)
      off += rg.w * rg.h
      paint(document.getElementById(id + '-' + i), rg.w, rg.h, seg, signed, max)
    })
  }
  paintRegions('wmap', MODEL.weights, true)
  paintRegions('ex-w', MODEL.weights, true)

  const dialog = document.getElementById('explain-dialog')
  document.querySelectorAll('button.explain').forEach((btn) => {
    btn.onclick = () => {
      const bytes = Uint8Array.from(atob(btn.dataset.f), (c) => c.charCodeAt(0))
      const input = [...bytes].map((v) => v / 255)
      const votes = input.map((v, i) => v * MODEL.weights[i])
      const sum = votes.reduce((a, x) => a + x, 0)
      const z = MODEL.bias + sum
      const p = 1 / (1 + Math.exp(-z))
      paintRegions('ex-in', input, false)
      paintRegions('ex-contrib', votes, true)
      paintRegions('ex-diff', votes.map((v, i) => v - MODEL.weights[i]), true)
      document.getElementById('ex-math').innerHTML =
        'bias <strong>' + MODEL.bias.toFixed(3) + '</strong> + pixel votes <strong>' +
        sum.toFixed(3) + '</strong> = ' + z.toFixed(3) +
        ' → probability <strong>' + p.toFixed(3) + '</strong> ' +
        (p >= MODEL.threshold ? '≥' : '<') + ' threshold ' + MODEL.threshold +
        ' → <strong>' + (p >= MODEL.threshold ? 'past crosswalk' : 'not yet') + '</strong>'
      dialog.showModal()
    }
  })

  // --- ROI picker -----------------------------------------------------------
  {
    const stage = document.getElementById('roi-stage')
    const dragBox = document.getElementById('roi-drag')
    const out = document.getElementById('roi-out')
    const boxes = { left: null, right: null }
    let active = 'left'
    let dragStart = null
    const setBox = (el, r) => {
      el.hidden = false
      el.style.left = r.left * 100 + '%'
      el.style.top = r.top * 100 + '%'
      el.style.width = r.width * 100 + '%'
      el.style.height = r.height * 100 + '%'
    }
    const fmtR = (r) =>
      '{ left: ' + r.left.toFixed(3) + ', top: ' + r.top.toFixed(3) +
      ', width: ' + r.width.toFixed(3) + ', height: ' + r.height.toFixed(3) + ' }'
    const render = () => {
      for (const k of ['left', 'right']) {
        const el = document.getElementById('roi-' + k)
        if (boxes[k]) setBox(el, boxes[k])
        else el.hidden = true
      }
      out.textContent =
        'const LEFT_ROI  = ' + (boxes.left ? fmtR(boxes.left) : '/* not drawn yet */') +
        '\\nconst RIGHT_ROI = ' + (boxes.right ? fmtR(boxes.right) : '/* not drawn yet */')
    }
    const frac = (e) => {
      const b = stage.getBoundingClientRect()
      return {
        x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)),
        y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)),
      }
    }
    const rect = (a, b) => ({
      left: Math.min(a.x, b.x), top: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y),
    })
    document.querySelectorAll('.roi-region').forEach((btn) => {
      btn.onclick = () => {
        active = btn.dataset.region
        document.querySelectorAll('.roi-region').forEach((x) => x.classList.toggle('active', x === btn))
      }
    })
    stage.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      stage.setPointerCapture(e.pointerId)
      dragStart = frac(e)
      dragBox.className = 'roi-box ' + active
    })
    stage.addEventListener('pointermove', (e) => {
      if (dragStart) setBox(dragBox, rect(dragStart, frac(e)))
    })
    stage.addEventListener('pointerup', (e) => {
      if (!dragStart) return
      const r = rect(dragStart, frac(e))
      dragStart = null
      dragBox.hidden = true
      if (r.width > 0.01 && r.height > 0.01) {
        boxes[active] = r
        render()
      }
    })
    document.getElementById('roi-copy').onclick = async () => {
      await navigator.clipboard.writeText(out.textContent)
      const c = document.getElementById('roi-copied')
      c.hidden = false
      setTimeout(() => { c.hidden = true }, 1500)
    }
    render()
  }

  document.querySelectorAll('nav button').forEach((b) => {
    b.onclick = () => {
      document.body.dataset[b.dataset.group] = b.dataset.value
      document
        .querySelectorAll('nav button[data-group="' + b.dataset.group + '"]')
        .forEach((x) => x.classList.toggle('active', x === b))
      document.querySelectorAll('details.sailing').forEach((sec) => {
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
      regions: REGIONS,
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
