#!/usr/bin/env node
// Build the review page for labels CLAUDE added to the terminal-cars training
// set (training-data/terminal-labels-claude.json, merged into
// terminal-labels.json and used to train the shipped model).
//
// These were produced by an LLM reading contact sheets, not by a rider who was
// there — so they need a human pass before anyone trusts the model built on
// them. The page shows every one with the current model's score, lets you
// keep / flip / drop each, and downloads your assessment as JSON.
//
//   npm run terminal:review-claude
//   <open the page, mark disagreements, click "download assessment">
//   <hand back training-data/terminal-labels-claude-reviewed.json>
//
// Applying a review: see scripts/apply-label-review.mjs.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractTerminalFeatures } from '../functions/lib/terminal-features.js'
import { isDarkAt } from '../functions/lib/daylight.js'
import { fmtTime, esc } from './lib/classifier-report.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(repoRoot, 'training-data')
const CLAUDE_LABELS = join(DATA, 'terminal-labels-claude.json')
const OUT = join(DATA, 'report', 'claude-labels-review.html')

if (!existsSync(CLAUDE_LABELS)) {
  console.error(`No ${CLAUDE_LABELS} — nothing to review.`)
  process.exit(1)
}
const claudeLabels = JSON.parse(readFileSync(CLAUDE_LABELS, 'utf8'))
const model = JSON.parse(
  readFileSync(join(repoRoot, 'functions/models/terminal-cars-classifier.json'), 'utf8'),
)
const score = (f) => {
  let z = model.bias || 0
  for (let i = 0; i < model.weights.length; i++) z += model.weights[i] * f[i]
  return 1 / (1 + Math.exp(-z))
}

// Frame metadata from the manifest (sailing + capture time).
const meta = new Map()
for (const line of readFileSync(join(DATA, 'terminal-manifest.csv'), 'utf8')
  .trim()
  .split('\n')
  .slice(1)) {
  const [path, sailingKey, ts] = line.split(',')
  meta.set(path, { sailingKey, ts: Number(ts) })
}

const rows = []
for (const [path, label] of Object.entries(claudeLabels)) {
  const file = join(DATA, 'frames', path)
  if (!existsSync(file)) continue
  const bytes = readFileSync(file)
  if (!bytes.length) continue
  const p = score(await extractTerminalFeatures(bytes))
  const m = meta.get(path) || {}
  rows.push({
    path,
    label,
    p,
    sailingKey: m.sailingKey || path,
    ts: m.ts ?? null,
    dark: m.ts != null ? isDarkAt(m.ts) : false,
    // The model was TRAINED on these labels, so agreement is expected;
    // disagreement means even the model it taught doesn't buy the label —
    // the highest-value frames to look at first.
    modelDisagrees: (p >= (model.threshold ?? 0.5) ? 1 : 0) !== label,
  })
}
// Suspect first: model disagreements, then closest to the decision boundary.
rows.sort(
  (a, b) =>
    Number(b.modelDisagrees) - Number(a.modelDisagrees) ||
    Math.abs(a.p - 0.5) - Math.abs(b.p - 0.5),
)

const card = (r, i) => `
  <figure class="tile" data-path="${esc(r.path)}" data-orig="${r.label}" data-i="${i}">
    <img loading="lazy" src="../frames/${r.path.split('/').map(encodeURIComponent).join('/')}" alt="">
    <figcaption>
      <strong class="claude"></strong><br>
      <span class="meta">${esc(r.sailingKey)}${r.ts != null ? ` · ${esc(fmtTime(r.ts))}` : ''}</span><br>
      <span class="meta">model p ${r.p.toFixed(2)}${r.dark ? ' · dark' : ''}${
        r.modelDisagrees ? ' · <b class="warn">model disagrees</b>' : ''
      }</span>
    </figcaption>
  </figure>`

const disagreeCount = rows.filter((r) => r.modelDisagrees).length
const carsCount = rows.filter((r) => r.label === 1).length

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(
  OUT,
  `<!doctype html>
<meta charset="utf-8">
<title>Review Claude's terminal labels</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 1.5rem; }
  nav { position: sticky; top: 0; background: Canvas; padding: 0.6rem 0; z-index: 2;
    border-bottom: 1px solid #8884; }
  nav button { padding: 0.35rem 0.8rem; cursor: pointer; margin-right: 0.4rem; }
  .tiles { display: flex; flex-wrap: wrap; gap: 0.7rem; margin-top: 0.8rem; }
  .tile { margin: 0; width: 260px; border: 3px solid #8884; border-radius: 6px;
    cursor: pointer; overflow: hidden; }
  .tile img { width: 100%; display: block; }
  .tile figcaption { font-size: 0.75rem; padding: 0.25rem 0.4rem; }
  .tile .meta { opacity: 0.75; }
  .warn { color: #d33; }
  /* verdict states */
  .tile.keep { border-color: #2a7; }
  .tile.flip { border-color: #e70; }
  .tile.drop { border-color: #d33; opacity: 0.55; }
  .counts { font-size: 0.9rem; opacity: 0.85; margin-left: 0.5rem; }
  .legend { font-size: 0.85rem; opacity: 0.8; }
  code { background: #8882; padding: 0 0.25rem; border-radius: 3px; }
</style>
<h1>Review Claude's terminal labels</h1>
<p class="legend">
  These <strong>${rows.length}</strong> frames were labeled by Claude (2026-08-10) from contact
  sheets, not by someone at the terminal. They are merged into
  <code>training-data/terminal-labels.json</code> and the shipped model
  <strong>v${model.version}</strong> was trained on them — they are
  <strong>18% of the training set</strong>, and skewed (${carsCount} cars vs
  ${rows.length - carsCount} no-cars), which is part of why the model is confident about cars and
  mushy about empty.
</p>
<p class="legend">
  Click a frame to cycle: <strong style="color:#2a7">keep</strong> (Claude's label is right) →
  <strong style="color:#e70">flip</strong> (it's the other one) →
  <strong style="color:#d33">drop</strong> (unusable / can't tell) → keep.
  Sorted worst-first: the ${disagreeCount} where even the model it trained disagrees come first,
  then the closest calls.
</p>
<nav>
  <button id="download">download assessment</button>
  <button id="copy">copy JSON</button><span id="copied" hidden>copied ✓</span>
  <button id="flipAll">flip all visible</button>
  <button id="reset">reset</button>
  <span class="counts" id="counts"></span>
</nav>
<div class="tiles">${rows.map(card).join('')}</div>
<script>
  const ROWS = ${JSON.stringify(rows.map((r) => ({ path: r.path, label: r.label })))}
  const STATES = ['keep', 'flip', 'drop']
  const state = {} // path -> 'keep' | 'flip' | 'drop'
  const labelText = (v) => (v === 1 ? 'Claude: CARS' : 'Claude: NO CARS')
  const tiles = [...document.querySelectorAll('.tile')]

  function paint(tile) {
    const path = tile.dataset.path
    const s = state[path] || 'keep'
    tile.classList.remove(...STATES)
    tile.classList.add(s)
    const orig = Number(tile.dataset.orig)
    const verdict = s === 'keep' ? labelText(orig)
      : s === 'flip' ? labelText(orig === 1 ? 0 : 1) + ' (corrected)'
      : 'dropped'
    tile.querySelector('.claude').textContent = verdict
  }
  function counts() {
    const n = (s) => ROWS.filter((r) => (state[r.path] || 'keep') === s).length
    document.getElementById('counts').textContent =
      n('keep') + ' kept · ' + n('flip') + ' flipped · ' + n('drop') + ' dropped'
  }
  function render() { tiles.forEach(paint); counts() }

  tiles.forEach((tile) => {
    tile.onclick = () => {
      const path = tile.dataset.path
      const cur = state[path] || 'keep'
      state[path] = STATES[(STATES.indexOf(cur) + 1) % STATES.length]
      paint(tile); counts()
    }
  })

  // Assessment JSON: { path: 1 | 0 | null } — the CORRECTED label, null to
  // drop the label entirely.
  function assessment() {
    const out = {}
    for (const r of ROWS) {
      const s = state[r.path] || 'keep'
      out[r.path] = s === 'drop' ? null : s === 'flip' ? (r.label === 1 ? 0 : 1) : r.label
    }
    return JSON.stringify(out, null, 1)
  }
  document.getElementById('download').onclick = () => {
    const blob = new Blob([assessment()], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'terminal-labels-claude-reviewed.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }
  document.getElementById('copy').onclick = async () => {
    await navigator.clipboard.writeText(assessment())
    const c = document.getElementById('copied')
    c.hidden = false
    setTimeout(() => { c.hidden = true }, 1500)
  }
  document.getElementById('flipAll').onclick = () => {
    for (const r of ROWS) state[r.path] = 'flip'
    render()
  }
  document.getElementById('reset').onclick = () => {
    for (const r of ROWS) delete state[r.path]
    render()
  }
  render()
</script>
`,
)
console.log(`${rows.length} Claude labels (${disagreeCount} the model disagrees with)`)
console.log(`Review page: file://${encodeURI(OUT)}`)
console.log('Mark disagreements → "download assessment" → hand back the JSON.')
