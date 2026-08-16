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
//     [--epochs 300] [--lr 0.5] [--l2 1e-4] [--threshold 0.5]
//     [--empty-threshold 0.35] [--force]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import {
  extractTerminalFeatures,
  TERMINAL_FEATURE_LENGTH,
  TERMINAL_REGIONS,
  TERMINAL_MASKS,
} from '../functions/lib/terminal-features.js'
import { thumbnailJpeg } from '../functions/lib/lineup-features.js'
import { terminalEmptyFrameTs } from '../functions/lib/lineup-labels.js'
import { isDarkAt } from '../functions/lib/daylight.js'
import {
  buildExamplesPage,
  buildSummaryPage,
  esc as escHtml,
  fmtTime,
  thumbName,
  encodeFeatures,
  thumbFallbackScript,
} from './lib/classifier-report.mjs'

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
// Asymmetric on purpose (see functions/lib/terminal-classifier.js): cars at
// p >= THRESHOLD, confidently empty only at p < EMPTY_THRESHOLD, unknown in
// between. Frame-level metrics and the labeled cards still use THRESHOLD —
// that is the cars/no-cars question the labels answer; EMPTY_THRESHOLD only
// gates what may CONFIRM a not-full verdict.
const EMPTY_THRESHOLD = Number(flag('empty-threshold', '0.35'))
const FORCE = args.includes('--force')
const LABEL_ONLY = args.includes('--label-only')
const MIN_LABELS = 60
// Mirrors the crosswalk floor — the held-out split is small, so a run can
// dip under while CV says the true metrics are fine; --force knowingly.
const METRIC_FLOOR = 0.8

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

// ALL frames get features — unlabeled ones can't train, but the per-sailing
// not-full verdicts in the report classify every frame.
const samples = []
for (const r of rows) {
  samples.push({
    path: r.path,
    sailingKey: r.sailingKey,
    ts: r.ts,
    y: r.label === '0' || r.label === '1' ? Number(r.label) : null,
    features: await extractTerminalFeatures(readFileSync(join(DATA, 'frames', r.path))),
  })
}
const labeledSamples = samples.filter((s) => s.y != null)
const isTest = (key) => createHash('md5').update(key).digest()[0] % 5 === 0
const train = labeledSamples.filter((s) => !isTest(s.sailingKey))
const test = labeledSamples.filter((s) => isTest(s.sailingKey))
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

// --- Report pages (always written, even when the floor blocks the model) ------
const freshModel = {
  weights: [...w],
  bias: b,
  threshold: THRESHOLD,
  emptyThreshold: EMPTY_THRESHOLD,
  metrics: { train: trainM, test: testM, trainFrames: train.length, testFrames: test.length },
  trainedAt: new Date().toISOString(),
}

// Per-sailing verdicts over EVERY archived frame, via the shared
// confirmed-pair rule.
const bySailing = new Map()
for (const s of samples) {
  if (!bySailing.has(s.sailingKey)) bySailing.set(s.sailingKey, [])
  bySailing.get(s.sailingKey).push(s)
}
const verdicts = [...bySailing.keys()]
  .sort()
  .reverse()
  .map((key) => {
    const frames = bySailing.get(key).sort((a, b) => a.ts - b.ts)
    const seq = frames.map((s) => {
      const p = predict(s.features)
      // dark (below civil twilight, daylight.js) is DISPLAY-ONLY: night
      // frames still count in verdicts, but they're marked in the report —
      // the model's night error is ~2× daytime, so a verdict built on dark
      // frames deserves a skeptical eye (and a night model, come winter).
      const carsPresent = p >= THRESHOLD ? true : p < EMPTY_THRESHOLD ? false : null
      return { ...s, p, dark: isDarkAt(s.ts), carsPresent }
    })
    const emptyTs = terminalEmptyFrameTs(seq)
    const idx = seq.findIndex((f) => f.ts === emptyTs)
    // Context photos: the last cars-present frame, then BOTH frames of the
    // confirming pair (emptyTs is the second/confirming frame's ts).
    const before = idx >= 0 ? [...seq.slice(0, idx)].reverse().find((f) => f.carsPresent) : null
    return {
      key,
      frames: seq,
      emptyTs,
      hit: idx >= 0 ? seq[idx] : null,
      first: idx >= 1 ? seq[idx - 1] : null,
      before,
    }
  })
const flagged = verdicts.filter((v) => v.emptyTs != null)

// Context for each verdict: the crosswalk classifier's call on the same
// sailing (training-data/predictions.json, written by lineup:train) and the
// latest human capacity tag (training-data/capacity-tags.json, export step
// 1b; latest recordedAt wins, mirroring lineup-report semantics). `capacity`
// is percent AVAILABLE — "Full" means 0% available, so a human "Full"
// contradicts a robot not-full verdict; anything else confirms it.
const cwBySailing = new Map()
try {
  for (const p of JSON.parse(readFileSync(join(DATA, 'predictions.json'), 'utf8')))
    cwBySailing.set(p.sailingKey, p)
} catch {
  // No crosswalk predictions exported yet — verdict lines show "no data".
}
const tagBySailing = new Map()
try {
  for (const t of JSON.parse(readFileSync(join(DATA, 'capacity-tags.json'), 'utf8'))) {
    const prev = tagBySailing.get(t.sailingKey)
    if (!prev || (t.recordedAt || 0) > (prev.recordedAt || 0)) tagBySailing.set(t.sailingKey, t)
  }
} catch {
  // No capacity tags exported yet — every verdict counts as untagged.
}
// Known-bad tags (training-data/tag-corrections.json, hand-curated): the tag
// is disregarded — the sailing scores as untagged, and the row says why.
let tagCorrections = {}
try {
  tagCorrections = JSON.parse(readFileSync(join(DATA, 'tag-corrections.json'), 'utf8'))
} catch {
  // No corrections file — nothing to disregard.
}
for (const key of Object.keys(tagCorrections)) tagBySailing.delete(key)
for (const v of verdicts) {
  v.cw = cwBySailing.get(v.key) ?? null
  v.tag = tagBySailing.get(v.key) ?? null
  // Not-full verdict vs tag: only a human "Full" contradicts it.
  v.match = !v.tag ? 'untagged' : v.tag.capacity === 'Full' ? 'mismatch' : 'match'
  // Full verdict vs tag — STRICT: "full" means 0% available, so only a
  // human "Full" agrees; any percent-available tag (10%, 25%, Not Full)
  // means the ferry left with room and counts as contradicting. The
  // crosswalk signal itself only claims ≥75% full, so a "10%" row is the
  // signal working as designed but the strict claim being too strong —
  // the row shows the actual tag so the two cases are distinguishable.
  v.matchFull = !v.tag ? 'untagged' : v.tag.capacity === 'Full' ? 'match' : 'mismatch'
  v.darkFrames = v.frames.filter((f) => f.dark).length
}
// Sailings the crosswalk classifier called full (only those with terminal
// frames appear on this page; the crosswalk page lists them all).
const flaggedFull = verdicts.filter((v) => v.cw?.crosswalkDetectedTs != null)
// The crosswalk reading is CONTEXT on a not-full verdict, never a veto: a
// lineup that reached the crosswalk and then all boarded is still "everyone
// waiting got on". (A veto was tried 2026-08-10 and removed 2026-08-16 —
// see functions/lib/webcam.js.) It is flagged here only so a busy sailing
// with an empty terminal is easy to spot and sanity-check.
for (const v of flagged) v.busyLineup = v.cw?.crosswalkDetectedTs != null

const cardRows = labeledSamples.map((s) => {
  const p = predict(s.features)
  return {
    ...s,
    p,
    yhat: p >= THRESHOLD ? 1 : 0,
    fb64: encodeFeatures(s.features, -0.5),
    split: isTest(s.sailingKey) ? 'test' : 'train',
  }
})

// One block per terminal frame, capture order: green = cars, red = empty,
// stronger color = more confident (p for cars, 1−p for empty); the confirmed
// empty pair is outlined. Exact time + p in the tooltip.
function scoreStripHtml(v) {
  const hitIdx = v.frames.findIndex((f) => f.ts === v.emptyTs)
  return `<div class="fstrip">${v.frames
    .map((f, i) => {
      const conf = hitIdx >= 0 && (i === hitIdx || i === hitIdx - 1)
      // Three states: cars / empty / unsure (between the thresholds — grey,
      // and never able to confirm a verdict).
      const cls = f.carsPresent === true ? 'cars' : f.carsPresent === false ? 'empty' : 'unsure'
      const op =
        f.carsPresent === null ? '1' : Math.max(0.25, f.carsPresent ? f.p : 1 - f.p).toFixed(2)
      return `<span class="${cls}${conf ? ' conf' : ''}${f.dark ? ' dk' : ''}" style="opacity:${op}" title="${escHtml(fmtTime(f.ts))} · p ${f.p.toFixed(2)}${f.carsPresent === null ? ' · unsure' : ''}${f.dark ? ' · dark' : ''}"></span>`
    })
    .join('')}</div>`
}

const capLabel = (c) => (c === 'Full' || c === 'Not Full' ? c : `${c} available`)
function verdictContextHtml(v, matchField) {
  const cw = !v.cw
    ? 'no lineup frames archived'
    : v.cw.crosswalkDetectedTs != null
      ? `past crosswalk ${escHtml(fmtTime(v.cw.crosswalkDetectedTs))} (p ${(v.cw.crosswalkDetectedProb ?? 0).toFixed(2)})`
      : `never past crosswalk (${v.cw.frames} frames)`
  const tag = tagCorrections[v.key]
    ? `<em>disregarded — ${escHtml(tagCorrections[v.key])}</em>`
    : !v.tag
      ? '<em>none</em>'
      : v[matchField] === 'mismatch'
        ? `<strong class="bad-tag">${escHtml(capLabel(v.tag.capacity))} ✗ contradicts</strong>`
        : `${escHtml(capLabel(v.tag.capacity))} ✓`
  return `crosswalk: ${cw}<br>human tag: ${tag}`
}

const filterNavHtml = (list, matchField) => {
  const c = { match: 0, mismatch: 0, untagged: 0 }
  for (const v of list) c[v[matchField]]++
  return `<nav class="vfilter">verdict vs human tag:
    <button data-v="" class="active">all (${list.length})</button>
    <button data-v="match">agree (${c.match})</button>
    <button data-v="mismatch">contradict (${c.mismatch})</button>
    <button data-v="untagged">no tag (${c.untagged})</button>
  </nav>`
}

// Contradiction rate by day of week, for both verdict kinds — is the robot
// worse on busy days? Only tagged sailings can be scored.
function weekdayTableHtml() {
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const rows = DOW.map((name, d) => {
    const cell = (list, matchField) => {
      const tagged = list.filter(
        (v) => new Date(v.key.slice(0, 10) + 'T00:00Z').getUTCDay() === d && v[matchField] !== 'untagged',
      )
      const bad = tagged.filter((v) => v[matchField] === 'mismatch').length
      return tagged.length
        ? `${bad}/${tagged.length}${bad ? ` (${Math.round((bad / tagged.length) * 100)}%)` : ''}`
        : '—'
    }
    return `<tr><td>${name}</td><td>${cell(flagged, 'match')}</td><td>${cell(flaggedFull, 'matchFull')}</td></tr>`
  }).join('')
  return `
  <details><summary>contradictions by day of week</summary>
  <table class="dowtable">
    <tr><th></th><th>not-full flags<br><small>wrong / tagged</small></th><th>full flags<br><small>wrong / tagged</small></th></tr>
    ${rows}
  </table>
  <p><small>Counts only sailings with a human capacity tag. "wrong" = the tag
  contradicts the robot verdict (see each list's rules above).</small></p>
  </details>`
}

function verdictsSectionHtml(srcFor) {
  const nfCounts = { match: 0, mismatch: 0, untagged: 0 }
  for (const v of flagged) nfCounts[v.match]++
  const fullCounts = { match: 0, mismatch: 0, untagged: 0 }
  for (const v of flaggedFull) fullCounts[v.matchFull]++

  const photo = (f, caption, hit) =>
    `<figure${hit ? ' class="hit"' : ''}><img loading="lazy" src="${escHtml(srcFor(f))}" alt="">
      <figcaption>${caption} · ${escHtml(fmtTime(f.ts))} · p ${f.p.toFixed(2)}</figcaption></figure>`

  const notFullRow = (v) => `
  <div class="pred v${v.match}">
    <figure>${
      v.before
        ? `<img loading="lazy" src="${escHtml(srcFor(v.before))}" alt="">
      <figcaption>last cars seen · ${escHtml(fmtTime(v.before.ts))} · p ${v.before.p.toFixed(2)}</figcaption>`
        : `<div class="nopic">no earlier cars frame</div><figcaption>empty from the start</figcaption>`
    }</figure>
    ${v.first ? photo(v.first, 'first empty', false) : ''}
    ${photo(v.hit, 'confirmed empty', true)}
    <div class="pred-info">
      <strong>${escHtml(v.key)}</strong><br>
      not full — terminal empty at <strong>${escHtml(fmtTime(v.emptyTs))}</strong> · ${v.frames.length} frames${
        v.darkFrames ? ` (${v.darkFrames} dark)` : ''
      }${
        v.busyLineup
          ? '<br><span class="veto-tag">busy sailing — the lineup reached the crosswalk and still cleared</span>'
          : ''
      }${
        v.hit?.dark || v.first?.dark
          ? '<br><strong class="veto-tag">⚠ night verdict — the confirming pair is after civil twilight (model error ~2× at night)</strong>'
          : ''
      }<br>
      ${scoreStripHtml(v)}
      ${verdictContextHtml(v, 'match')}
    </div>
  </div>`

  // Full verdicts come from the crosswalk cam; the terminal photos here show
  // the terminal state at departure (a still-loaded lane corroborates "full").
  const fullRow = (v) => {
    const secondLast = v.frames.length > 1 ? v.frames[v.frames.length - 2] : null
    const last = v.frames[v.frames.length - 1]
    return `
  <div class="pred v${v.matchFull}">
    ${secondLast ? photo(secondLast, 'second-last frame', false) : ''}
    ${photo(last, 'last before departure', true)}
    <div class="pred-info">
      <strong>${escHtml(v.key)}</strong><br>
      full — lineup past crosswalk at <strong>${escHtml(fmtTime(v.cw.crosswalkDetectedTs))}</strong>
      · ${v.frames.length} terminal frames${v.darkFrames ? ` (${v.darkFrames} dark)` : ''}${
        v.emptyTs != null
          ? '<br><strong class="bad-tag">⚠ also flagged not full by the terminal rule</strong>'
          : ''
      }<br>
      ${scoreStripHtml(v)}
      ${verdictContextHtml(v, 'matchFull')}
    </div>
  </div>`
  }

  return `
<style>
  .fstrip { display: flex; gap: 2px; flex-wrap: wrap; margin: 0.3rem 0; max-width: 480px; }
  .fstrip span { width: 9px; height: 22px; border-radius: 2px; }
  .fstrip span.cars { background: #2a7; }
  .fstrip span.empty { background: #d33; }
  .fstrip span.unsure { background: #999; }
  .fstrip span.dk { box-shadow: inset 0 -6px 0 #113; }
  .fstrip span.conf { outline: 2px solid #fc0; outline-offset: 1px; }
  .pred-info .bad-tag { color: #d33; }
  .pred-info .veto-tag { color: #b80; }
  nav.vfilter { margin: 0.4rem 0; }
  nav.vfilter button { padding: 0.2rem 0.6rem; cursor: pointer; margin-right: 0.3rem; }
  nav.vfilter button.active { font-weight: bold; }
  details.predlist[data-vmatch="match"] .pred:not(.vmatch) { display: none; }
  details.predlist[data-vmatch="mismatch"] .pred:not(.vmismatch) { display: none; }
  details.predlist[data-vmatch="untagged"] .pred:not(.vuntagged) { display: none; }
  .dowtable { border-collapse: collapse; margin: 0.5rem 0; }
  .dowtable th, .dowtable td { border: 1px solid #8884; padding: 0.25rem 0.7rem; text-align: center; }
</style>
<section class="predictions" id="verdicts">
  <h2>Ferry not-full verdicts</h2>
  <p>Every archived frame of every sailing is classified in capture order; the
  ferry counts as having left <strong>not full</strong> when the terminal reads
  empty in <strong>two consecutive frames</strong> before departure (a lone empty
  frame misreads ~25% of the time) — both frames of the confirming pair are shown.
  A frame only counts as empty at <strong>p &lt; ${EMPTY_THRESHOLD}</strong>, stricter
  than the p ≥ ${THRESHOLD} used to call cars: scores between the two are
  <strong>unsure</strong> (grey in the strips) and confirm nothing, because the model
  is decisive about cars but mushy about empty.
  The pair must come <strong>after a cars-present frame</strong>, unless the whole
  window is a long quiet one (10+ observed-empty frames, cars never seen).
  <strong>Dark frames</strong> (sun below civil twilight) still count, but they are
  marked — navy band on the strip block, "dark" in the tooltip — because the
  model's error at night is ~2× daytime; night verdicts carry a ⚠ note.
  The signal is one-way: late-arriving cars in the final frames never cancel an
  earlier confirmed-empty pair.
  Flagged ${flagged.length} of ${verdicts.length} sailings —
  ${nfCounts.match} agree with a human capacity tag, <strong>${nfCounts.mismatch}
  contradict one (human said Full)</strong>, ${nfCounts.untagged} have no tag.
  ${flagged.filter((v) => v.busyLineup).length} of them are busy sailings whose lineup
  reached the crosswalk and still cleared — that is not a contradiction, just the
  interesting case.</p>
  <details class="predlist">
  <summary>${flagged.length} sailings flagged not full — context and confirming photos</summary>
  ${filterNavHtml(flagged, 'match')}
  ${flagged.map(notFullRow).join('')}
  </details>

  <h2>Ferry full verdicts</h2>
  <p>The crosswalk classifier (see <a href="crosswalk.html">crosswalk page</a>)
  deems the ferry <strong>at least 75% full</strong> when the lineup passes the
  crosswalk — note it never claims <em>completely</em> full.
  ${flaggedFull.length} of the ${verdicts.length} sailings with terminal frames
  were flagged. Scored <strong>strictly</strong> (full = 0% available, so any
  percent-available tag means the ferry left with room):
  ${fullCounts.match} agree (human said Full),
  <strong>${fullCounts.mismatch} contradict — the ferry left with room</strong>
  (each row shows how much), ${fullCounts.untagged} have no tag.
  Photos show the terminal at departure.</p>
  <details class="predlist">
  <summary>${flaggedFull.length} sailings flagged full — context photos and terminal scores</summary>
  ${filterNavHtml(flaggedFull, 'matchFull')}
  ${flaggedFull.map(fullRow).join('')}
  </details>

  ${weekdayTableHtml()}
</section>
<script>
  document.querySelectorAll('#verdicts nav.vfilter').forEach((nav) => {
    const details = nav.closest('details')
    nav.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        nav.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b))
        if (b.dataset.v) details.dataset.vmatch = b.dataset.v
        else delete details.dataset.vmatch
        details.open = true
      }
    })
  })
</script>`
}

function terminalPage(srcFor) {
  return buildExamplesPage({
    title: 'Terminal-cars classifier — examples',
    modelName: 'terminal',
    model: freshModel,
    regions: TERMINAL_REGIONS,
    foff: -0.5,
    posLabel: 'cars waiting',
    negLabel: 'no cars',
    statsLine: `${labeledSamples.length} labeled frames (${samples.length} total) · cars p≥${THRESHOLD}, empty p&lt;${EMPTY_THRESHOLD} · trained ${escHtml(freshModel.trainedAt)}`,
    topSections: verdictsSectionHtml(srcFor),
    rows: cardRows,
    groupSummary: (key, list) => {
      const bad = list.filter((r) => r.yhat !== r.y).length
      return `${list.length} labeled frames${bad ? ` · <em>${bad} misclassified</em>` : ''}`
    },
    pickerSrc: srcFor(flagged[0]?.hit || cardRows[0]),
    frameAspect: '4 / 3', // Bowen terminal cam
    srcFor,
  })
}

// Backdrop frames for the region diagrams (see classifier-report stageHtml).
const backdropTerminal = cardRows.find((r) => r.y === 1) || cardRows[0]
const backdropCrosswalkPath = (() => {
  const cm = join(DATA, 'manifest.csv')
  if (!existsSync(cm)) return null
  const line = readFileSync(cm, 'utf8')
    .trim()
    .split('\n')
    .slice(1)
    .find((l) => /,1,\d*$/.test(l) && existsSync(join(DATA, 'frames', l.split(',')[0])))
  return line ? line.split(',')[0] : null
})()

function summaryPage(srcFor) {
  let crosswalk = null
  try {
    const cm = JSON.parse(
      readFileSync(join(repoRoot, 'functions/models/lineup-classifier.json'), 'utf8'),
    )
    if (cm.enabled) {
      const cLines = readFileSync(join(DATA, 'manifest.csv'), 'utf8').trim().split('\n').slice(1)
      crosswalk = {
        model: cm,
        regions: cm.regions,
        foff: 0,
        photo: backdropCrosswalkPath ? srcFor({ path: backdropCrosswalkPath }) : null,
        statsLine: `${cLines.filter((l) => /,[01],\d*$/.test(l)).length} labeled of ${cLines.length} archived lineup frames`,
      }
    }
  } catch {
    // No crosswalk model — placeholder shown.
  }
  return buildSummaryPage({
    crosswalk,
    terminal: {
      model: freshModel,
      regions: TERMINAL_REGIONS,
      foff: -0.5,
      photo: srcFor(backdropTerminal),
      statsLine: `${labeledSamples.length} labeled of ${samples.length} archived terminal frames · ${flagged.length}/${verdicts.length} sailings flagged not full`,
    },
  })
}

const LOCAL_DIR = join(DATA, 'report')
mkdirSync(LOCAL_DIR, { recursive: true })
const localSrc = (r) => '../frames/' + r.path.split('/').map(encodeURIComponent).join('/')
writeFileSync(join(LOCAL_DIR, 'terminal.html'), terminalPage(localSrc))
writeFileSync(join(LOCAL_DIR, 'index.html'), summaryPage(localSrc))
console.log(`Report pages: file://${encodeURI(join(LOCAL_DIR, 'index.html'))}`)

// Public copy: thumbs only for frames the pages actually reference (labeled
// cards + verdict photos) — the full terminal archive would be ~25 MB.
const PUB_DIR = join(repoRoot, 'public', 'classifier-results')
const THUMBS = join(PUB_DIR, 'thumbs')
mkdirSync(THUMBS, { recursive: true })
const referenced = new Map()
for (const r of cardRows) referenced.set(r.path, r)
for (const v of flagged) {
  if (v.before) referenced.set(v.before.path, v.before)
  if (v.first) referenced.set(v.first.path, v.first)
  referenced.set(v.hit.path, v.hit)
}
for (const v of flaggedFull) {
  if (v.frames.length > 1) referenced.set(v.frames[v.frames.length - 2].path, v.frames[v.frames.length - 2])
  referenced.set(v.frames[v.frames.length - 1].path, v.frames[v.frames.length - 1])
}
for (const r of referenced.values()) {
  const dest = join(THUMBS, thumbName(r.path))
  if (existsSync(dest)) continue
  writeFileSync(dest, await thumbnailJpeg(readFileSync(join(DATA, 'frames', r.path))))
}
if (backdropCrosswalkPath) {
  // Community-cam backdrop for the summary's crosswalk diagram — not one of
  // this trainer's samples, so thumbnail it explicitly.
  const dest = join(THUMBS, thumbName(backdropCrosswalkPath))
  if (!existsSync(dest))
    writeFileSync(dest, await thumbnailJpeg(readFileSync(join(DATA, 'frames', backdropCrosswalkPath))))
}
// Pages reference thumbs/ relative paths, which resolve against the files
// written just below — so a local run (dev server or file://) shows them
// immediately. Those files are gitignored, so on a fresh checkout and on the
// deployed site the fallback script rewrites misses to the published Cloud
// Storage copy (npm run classifier:publish-thumbs).
const THUMB_BASE =
  process.env.CLASSIFIER_THUMB_BASE ||
  'https://storage.googleapis.com/bowen-ferry.firebasestorage.app/classifier-results/thumbs/'
const pubSrc = (r) => 'thumbs/' + thumbName(r.path)
writeFileSync(join(PUB_DIR, 'terminal.html'), terminalPage(pubSrc) + thumbFallbackScript(THUMB_BASE))
writeFileSync(join(PUB_DIR, 'index.html'), summaryPage(pubSrc) + thumbFallbackScript(THUMB_BASE))
console.log(`Webapp copy: ${join(PUB_DIR, 'terminal.html')}`)

if (!FORCE && ((testM.precision ?? 0) < METRIC_FLOOR || (testM.recall ?? 0) < METRIC_FLOOR)) {
  console.error(
    `Test precision/recall below ${METRIC_FLOOR} — not writing model (use --force to override).`,
  )
  process.exit(1)
}

// Version + training-set snapshot, mirroring train-lineup-classifier.mjs —
// the functions sync versioned models into Firestore (classifierModels/
// terminal-cars-v{version}) and stamp the version on every robot verdict.
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
  labeledFrames: labeledSamples.length,
  sailings: new Set(samples.map((s) => s.sailingKey)).size,
}

writeFileSync(
  OUT,
  JSON.stringify(
    {
      enabled: true,
      type: 'logistic',
      version: prevVersion + 1,
      regions: TERMINAL_REGIONS,
      masks: TERMINAL_MASKS,
      weights: [...w].map((x) => Math.round(x * 1e6) / 1e6),
      bias: Math.round(b * 1e6) / 1e6,
      threshold: THRESHOLD,
      emptyThreshold: EMPTY_THRESHOLD,
      metrics: { train: trainM, test: testM, trainFrames: train.length, testFrames: test.length },
      dataset,
      trainedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + '\n',
)
console.log(`Model v${prevVersion + 1} written to ${OUT} — deploy functions to activate.`)
