// Shared HTML builders for the classifier-results pages. Both trainers use
// this module to produce a three-page set, written twice (local
// training-data/report/ with full-size frames, and public/classifier-results/
// with committed thumbnails):
//   index.html      summary of both classifiers (methods, metrics, weight maps)
//   crosswalk.html  crosswalk examples: predicted times + per-sailing cards
//   terminal.html   terminal examples: not-full verdicts + per-sailing cards
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'

// Past shipped models live as plain files in functions/models/history/
// (<name>-v<version>.json — committed, same versions classifier-models.js
// mirrors to Firestore). The directory is the registry the report reads;
// any version missing from it but present in git history (models shipped
// before the directory existed) is backfilled INTO it here, so the archive
// materializes itself on the first trainer run. The trainers also drop a
// copy in on every new ship (see archiveModel). Unversioned pre-registry
// models are skipped. Returns versioned models newest-first.
export function modelHistory(repoRoot, relPath) {
  const dir = join(repoRoot, dirname(relPath), 'history')
  const base = basename(relPath, '.json')
  const byVersion = new Map()
  try {
    for (const f of readdirSync(dir)) {
      const match = new RegExp(`^${base}-v(\\d+)\\.json$`).exec(f)
      if (!match) continue
      try {
        const m = JSON.parse(readFileSync(join(dir, f), 'utf8'))
        if (m?.version) byVersion.set(m.version, m)
      } catch {
        // Unreadable archive file — git backfill below may still cover it.
      }
    }
  } catch {
    // No history directory yet — created by the backfill.
  }
  try {
    const shas = execSync(`git log --format=%H -- "${relPath}"`, { cwd: repoRoot })
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean)
    for (const sha of shas) {
      let m
      try {
        m = JSON.parse(
          execSync(`git show ${sha}:"${relPath}"`, { cwd: repoRoot, maxBuffer: 64e6 }).toString(),
        )
      } catch {
        continue
      }
      if (!m?.version || byVersion.has(m.version)) continue
      byVersion.set(m.version, m)
      try {
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, `${base}-v${m.version}.json`), JSON.stringify(m, null, 1) + '\n')
      } catch {
        // Read-only checkout — history still returned, just not materialized.
      }
    }
  } catch {
    // Not a git checkout — directory contents alone.
  }
  return [...byVersion.values()].sort((a, b) => b.version - a.version)
}

// Each trainer computes rich history rows (re-scored on today's data) only
// for ITS OWN classifier, but both trainers rebuild the shared index.html.
// Persisting the rows lets the other trainer show this one's last computed
// table instead of falling back to as-trained-only — so `npm run train`
// (both trainers back-to-back) ends with both sections complete, whichever
// ran last. Stored under <data>/report/ (gitignored, regenerated).
export function saveHistoryRows(dataDir, key, rows) {
  const dir = join(dataDir, 'report')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `history-${key}.json`), JSON.stringify(rows, null, 1) + '\n')
}

// Loads the other classifier's saved rows, relabeling its 'this run' to the
// dated 'last run' it now is. Returns null when never saved (caller falls
// back to as-trained rows from the model archive).
export function loadHistoryRows(dataDir, key) {
  try {
    const rows = JSON.parse(readFileSync(join(dataDir, 'report', `history-${key}.json`), 'utf8'))
    return rows.map((r) =>
      r.label === 'this run'
        ? { ...r, label: `last run (${(r.trainedAt || '').slice(0, 10)})` }
        : r,
    )
  } catch {
    return null
  }
}

// --- Nightly auto-training log -----------------------------------------------
// Every --auto trainer run appends one entry per classifier to
// <data>/nightly-runs.json (persistent, survives report regeneration) and the
// nightly.html page renders them newest-first. Entry shape:
//   { at, classifier, candidate: {version, precision, recall, score},
//     scoreName, winner, previousLive, replaced, ranking: [{label, score}] }
export function recordNightlyRun(dataDir, entry) {
  const file = join(dataDir, 'nightly-runs.json')
  let runs = []
  try {
    runs = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    // First run.
  }
  runs.push(entry)
  writeFileSync(file, JSON.stringify(runs, null, 1) + '\n')
  return runs
}

export function recordAndRenderNightly(dataDir, repoRoot, entry) {
  const runs = recordNightlyRun(dataDir, entry)
  const html = buildNightlyPage(runs)
  for (const dir of [join(dataDir, 'report'), join(repoRoot, 'public', 'classifier-results')]) {
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'nightly.html'), html)
    } catch {
      // A missing public dir on a fresh checkout is not worth failing the run.
    }
  }
}

export function buildNightlyPage(runs) {
  const rows = [...runs]
    .reverse()
    .map((r) => {
      const c = r.candidate || {}
      return `
  <tr class="${r.replaced ? 'replaced' : ''}">
    <td>${esc((r.at || '?').slice(0, 16).replace('T', ' '))}</td>
    <td>${esc(r.classifier)}</td>
    <td>v${esc(c.version ?? '?')} — P ${c.precision ?? '—'} / R ${c.recall ?? '—'} · ${esc(r.scoreName || 'score')} ${c.score ?? '—'}</td>
    <td>${r.replaced ? `<strong>v${esc(r.winner)}</strong> replaced v${esc(r.previousLive)}` : `v${esc(r.winner)} kept`}</td>
    <td class="ranking">${esc((r.ranking || []).map((x) => `${x.label} ${x.score}`).join(' · '))}</td>
  </tr>`
    })
    .join('')
  return `<!doctype html>
<meta charset="utf-8">
<title>Nightly classifier training runs</title>
<style>${SHARED_CSS}
  tr.replaced td { background: #2a71; }
  td.ranking { font-size: 0.8rem; opacity: 0.8; }
</style>
<h1>Nightly training runs</h1>
<p class="method">Each night the trainers retrain on the freshest export, the
candidate is archived to <code>functions/models/history/</code> no matter how
it scores, and every archived version competes on TODAY's held-out data — the
winner becomes the live model (highlighted rows = the live model changed).
Crosswalk ranks by sequence severity cost (lower is better; ties by
precision+recall), terminal-cars by frame F1 (higher is better). Back to the
<a href="index.html">classifier summary</a>.</p>
<table>
  <tr><th>run</th><th>classifier</th><th>candidate</th><th>live decision</th><th>ranking (best first)</th></tr>
  ${rows || '<tr><td colspan="5"><em>No auto runs recorded yet.</em></td></tr>'}
</table>
`
}

// Console rendering of the same history rows the summary page tables show —
// every training run prints this after its own metrics, so the comparison
// against all prior models is right there in the terminal.
export function printHistory(title, rows) {
  if (!rows?.length) return
  const cols = [
    ['model', (r) => r.label],
    ['trained', (r) => (r.trainedAt || '?').slice(0, 10)],
    ['frames', (r) => r.frames ?? '—'],
    ['P/R own test', (r) => (r.asTrained ? `${r.asTrained.precision}/${r.asTrained.recall}` : '—')],
    ["P/R today's test", (r) => (r.today ? `${r.today.precision}/${r.today.recall}` : '—')],
    ['agree', (r) => r.seq?.agree ?? '—'],
    ['phantom', (r) => r.seq?.phantom ?? '—'],
    ['missed', (r) => r.seq?.missed ?? '—'],
    ['cost', (r) => r.seq?.cost ?? '—'],
  ]
  const table = [cols.map(([h]) => h), ...rows.map((r) => cols.map(([, f]) => String(f(r))))]
  const widths = cols.map((_, i) => Math.max(...table.map((row) => row[i].length)))
  console.log(`\n${title}`)
  for (const row of table) console.log('  ' + row.map((c, i) => c.padEnd(widths[i])).join('  '))
}

// Archive a freshly shipped model alongside the live file:
// <dir of outPath>/history/<name>-v<version>.json. Called by the trainers
// right after writing the live model; versions are immutable, so an existing
// archive file is left untouched.
export function archiveModel(outPath, model) {
  if (!model?.version) return
  const dir = join(dirname(outPath), 'history')
  const file = join(dir, `${basename(outPath, '.json')}-v${model.version}.json`)
  mkdirSync(dir, { recursive: true })
  try {
    readFileSync(file)
  } catch {
    writeFileSync(file, JSON.stringify(model, null, 1) + '\n')
  }
}

// The "Model history" table. `rows` come from the trainer, newest first:
//   { label, trainedAt, frames,                        // identity
//     asTrained: {precision, recall} | null,           // that version's own
//                                                      // held-out split
//     today: {precision, recall} | null,               // re-scored on the
//                                                      // CURRENT test split
//     seq: {agree, phantom, missed, cost} | null }     // severity profile on
//                                                      // the current dataset
// Only the lineup trainer fills today/seq (it has the features in memory);
// a summary regenerated by the other trainer shows '—' there.
function historyTableHtml(rows) {
  if (!rows?.length) return ''
  const n = (x) => (x == null ? '—' : x)
  const tr = (r) => `
  <tr>
    <th>${esc(r.label)}</th><td>${esc((r.trainedAt || '?').slice(0, 10))}</td>
    <td>${n(r.frames)}</td>
    <td>${r.asTrained ? `${r.asTrained.precision} / ${r.asTrained.recall}` : '—'}</td>
    <td>${r.today ? `${r.today.precision} / ${r.today.recall}` : '—'}</td>
    <td>${n(r.seq?.agree)}</td><td>${n(r.seq?.phantom)}</td><td>${n(r.seq?.missed)}</td>
    <td>${n(r.seq?.cost)}</td>
  </tr>`
  return `
<h3>Model history</h3>
<table>
  <tr><th>model</th><th>trained</th><th>labeled frames</th>
    <th>P / R (own test set)</th><th>P / R (today's test set)</th>
    <th>agree</th><th>phantom</th><th>missed</th><th>cost</th></tr>
  ${rows.map(tr).join('')}
</table>
<p class="legend">"own test set" is what each version measured at training
time — different data, different era, only roughly comparable. "today's test
set" and the severity columns re-score that version's weights on the CURRENT
dataset (same deterministic by-sailing split every version has always used),
so those columns compare like for like. agree/phantom/missed/cost are the
sequence severity profile (phantom = detected on a rider-refuted sailing;
cost weights phantom 10 … late 1).</p>`
}

export const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

export const fmtTime = (ms) =>
  new Date(ms).toLocaleString('en-CA', {
    timeZone: 'America/Vancouver',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

export const thumbName = (path) => createHash('md5').update(path).digest('hex').slice(0, 16) + '.jpg'

// Features → base64 bytes. `foff` is the value a zero byte decodes to
// (0 for raw [0,1] crosswalk features; -0.5 for mean-centered terminal
// features, clamped to [-0.5, 0.5]).
export const encodeFeatures = (features, foff) =>
  Buffer.from(
    Uint8Array.from(features, (f) => Math.max(0, Math.min(255, Math.round((f - foff) * 255)))),
  ).toString('base64')

const SHARED_CSS = `
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 1.5rem; }
  a { color: inherit; }
  h2 small, summary small { font-weight: normal; opacity: 0.7; font-size: 0.8em; }
  table { border-collapse: collapse; margin: 0.5rem 0 1rem; }
  th, td { padding: 0.2rem 0.8rem; text-align: left; border-bottom: 1px solid #8884; }
  nav.filters { position: sticky; top: 0; padding: 0.5rem 0; background: Canvas; z-index: 1; }
  nav.filters button { margin-right: 0.4rem; padding: 0.3rem 0.8rem; cursor: pointer; }
  nav.filters button.active { outline: 2px solid Highlight; }
  nav.filters .group { display: inline-block; margin-right: 1.2rem; }
  nav.filters .group > span { opacity: 0.6; font-size: 0.8rem; margin-right: 0.3rem; }
  .cards { display: flex; flex-wrap: wrap; gap: 1rem; }
  .card { margin: 0; width: 320px; border: 1px solid #8884; border-radius: 8px; overflow: hidden; }
  .card.err { border-color: #d33; box-shadow: 0 0 0 1px #d33; }
  .imgwrap { position: relative; }
  .imgwrap img { width: 100%; display: block; }
  figcaption { padding: 0.5rem 0.7rem; font-size: 0.85rem; }
  .row { margin-bottom: 0.3rem; }
  .badge { padding: 0.05rem 0.45rem; border-radius: 99px; font-size: 0.75em; border: 1px solid #8886; }
  .badge.ok { background: #2a72; } .badge.bad { background: #d334; }
  .prob { position: relative; height: 8px; border-radius: 4px; background: #8883; }
  .prob .fill { height: 100%; border-radius: 4px; background: #888; }
  .prob .fill.pos { background: #2a7; }
  .prob .thresh { position: absolute; top: -3px; width: 2px; height: 14px; background: #fc0; }
  button.explain { float: right; font-size: 0.75em; padding: 0.1rem 0.5rem; cursor: pointer; }
  .panels { display: flex; flex-wrap: wrap; gap: 1.2rem; margin: 0.8rem 0; }
  .panels canvas { image-rendering: pixelated; border: 1px solid #8884; background: #fff; }
  .panels p { margin: 0.3rem 0 0; font-size: 0.8rem; opacity: 0.8; max-width: 200px; }
  .panels > div { width: 200px; }
  dialog { border: 1px solid #8886; border-radius: 8px; max-width: 58rem; }
  dialog::backdrop { background: #0008; }
  .legend { font-size: 0.8rem; opacity: 0.8; }
  .roi-ov { position: absolute; border: 2px dashed; pointer-events: none; }
  .pred { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center;
    padding: 0.6rem 0; border-bottom: 1px solid #8883; }
  .pred figure { margin: 0; width: 240px; }
  .pred img { width: 100%; display: block; border-radius: 6px; }
  .pred figure.hit img { outline: 2px solid #2a7; }
  .pred figcaption { font-size: 0.75rem; opacity: 0.85; margin-top: 0.15rem; padding: 0; }
  .pred .nopic { width: 100%; aspect-ratio: 16/9; display: flex; align-items: center;
    justify-content: center; background: #8882; border-radius: 6px; font-size: 0.8rem; }
  .pred-info { font-size: 0.9rem; }
  details.sailing { margin: 0.6rem 0; }
  details.sailing > summary, details.predlist > summary { cursor: pointer;
    font-size: 1.1rem; font-weight: bold; padding: 0.3rem 0; }
  .method { max-width: 46rem; }
  .method .expert { font-size: 0.85rem; opacity: 0.85; }
  body[data-verdict="ok"] .card:not(.ok) { display: none; }
  body[data-verdict="err"] .card:not(.err) { display: none; }
  body[data-label="pos"] .card:not(.pos) { display: none; }
  body[data-label="neg"] .card:not(.neg) { display: none; }
  body[data-split="test"] .card:not(.test) { display: none; }
  body[data-split="train"] .card:not(.train) { display: none; }
  .wstage { position: relative; width: min(640px, 100%); background: #8882;
    border: 1px solid #8884; border-radius: 6px; margin: 0.6rem 0;
    overflow: hidden; }
  /* The real camera frame, faint, behind the regions — so every place we draw
     a region shows it where it actually sits in the photo. */
  .wstage .stage-bg { position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: fill; opacity: 0.28; pointer-events: none; }
  .wstage.mini { width: 100%; margin: 0; }
  .wstage.mini .wregion span { display: none; }
  .wregion { position: absolute; border: 2px dashed; }
  .wregion canvas { width: 100%; height: 100%; display: block; image-rendering: pixelated; }
  .wregion span { position: absolute; top: -1.2rem; left: 0; font-size: 0.7rem; opacity: 0.8;
    white-space: nowrap; }
  .roipick { margin: 0.5rem 0 1rem; max-width: 60rem; }
  .roipick summary { cursor: pointer; font-weight: bold; }
  #roi-stage { position: relative; display: inline-block; max-width: 100%;
    touch-action: none; user-select: none; cursor: crosshair; }
  #roi-stage img { max-width: 100%; display: block; }
  .roi-box { position: absolute; pointer-events: none; border: 2px solid; }
  #roi-left, #roi-drag.left { border-color: #fc0; background: #fc03; }
  #roi-right, #roi-drag.right { border-color: #0af; background: #0af3; }
  .roi-region.active { outline: 2px solid Highlight; }
  .roi-region .swatch { display: inline-block; width: 0.85em; height: 0.85em;
    border: 2px dashed; vertical-align: -0.1em; margin-right: 0.35em; }
  #roi-stage .roi-ov span { position: absolute; top: 0; left: 0; font-size: 0.7rem;
    color: #000; font-weight: bold; padding: 0 0.3em; }
  #roi-out { background: #8882; padding: 0.5rem 0.7rem; border-radius: 6px;
    max-width: 46rem; white-space: pre-wrap; }
`

// One color per region index, used for BOTH the dashed current-region
// overlays and the picker's drawn boxes: A = yellow, B = azure. Keep them
// far apart in hue — yellow vs orange proved indistinguishable on photos.
const REGION_COLORS = ['#fc0', '#0af']

const regionOverlayCss = (regions) =>
  regions
    .map(
      (r, i) => `.roi-ov-${i} { border-color: ${REGION_COLORS[i] || '#fc0'};
    left: ${r.roi.left * 100}%; top: ${r.roi.top * 100}%;
    width: ${r.roi.width * 100}%; height: ${r.roi.height * 100}%; }`,
    )
    .join('\n  ')

// Regions drawn where they actually are in the camera frame — same geometry
// everywhere (weight maps, explain panels, ROI picker) so "top" is always
// top — over a faint photo of a real lineup for orientation.
export const stageHtml = (regions, id, { photo, aspect = '4 / 3', mini = false } = {}) => `
<div class="wstage${mini ? ' mini' : ''}" style="aspect-ratio: ${aspect}">
  ${photo ? `<img class="stage-bg" src="${esc(photo)}" alt="">` : ''}
  ${regions
    .map(
      (r, i) => `<div class="wregion" style="left:${r.roi.left * 100}%;top:${r.roi.top * 100}%;
      width:${r.roi.width * 100}%;height:${r.roi.height * 100}%;
      border-color:${REGION_COLORS[i] || '#fc0'}">
    <canvas id="${id}-${i}" width="${r.width}" height="${r.height}"></canvas>
    <span>${esc(r.name || '')}</span>
  </div>`,
    )
    .join('')}
</div>`

const regionCanvases = (regions, id, scale = 4) =>
  regions
    .map(
      (r, i) =>
        `<canvas id="${id}-${i}" width="${r.width}" height="${r.height}"
          style="width:${r.width * scale}px;height:${r.height * scale}px"></canvas>`,
    )
    .join('<br>')

// Paint + explain client script, shared by every page that shows canvases.
// MODELS is a map name → { weights, bias, threshold, regions:[{w,h}], foff }.
const paintScript = (models) => `
  const MODELS = ${JSON.stringify(models)}
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
      } else r = g = bl = Math.max(0, Math.min(255, v * 255))
      img.data.set([r, g, bl, 255], i * 4)
    })
    ctx.putImageData(img, 0, 0)
  }
  function paintRegions(model, id, vals, signed) {
    const max = signed ? Math.max(...vals.map(Math.abs), 1e-9) : 1
    let off = 0
    model.regions.forEach((rg, i) => {
      const el = document.getElementById(id + '-' + i)
      const seg = vals.slice(off, off + rg.w * rg.h)
      off += rg.w * rg.h
      if (el) paint(el, rg.w, rg.h, seg, signed, max)
    })
  }
`

const explainScript = (modelName) => `
  {
    const M = MODELS[${JSON.stringify(modelName)}]
    paintRegions(M, 'wmap', M.weights, true)
    paintRegions(M, 'ex-w', M.weights, true)
    const dialog = document.getElementById('explain-dialog')
    document.querySelectorAll('button.explain').forEach((btn) => {
      btn.onclick = () => {
        const bytes = Uint8Array.from(atob(btn.dataset.f), (c) => c.charCodeAt(0))
        const input = [...bytes].map((v) => v / 255 + M.foff)
        const votes = input.map((v, i) => v * M.weights[i])
        const sum = votes.reduce((a, x) => a + x, 0)
        const z = M.bias + sum
        const p = 1 / (1 + Math.exp(-z))
        paintRegions(M, 'ex-in', input.map((v) => v - M.foff), false)
        paintRegions(M, 'ex-contrib', votes, true)
        paintRegions(M, 'ex-diff', votes.map((v, i) => v - M.weights[i]), true)
        document.getElementById('ex-math').innerHTML =
          'bias <strong>' + M.bias.toFixed(3) + '</strong> + pixel votes <strong>' +
          sum.toFixed(3) + '</strong> = ' + z.toFixed(3) +
          ' → probability <strong>' + p.toFixed(3) + '</strong> ' +
          (p >= M.threshold ? '≥' : '<') + ' threshold ' + M.threshold +
          ' → <strong>' + (p >= M.threshold ? M.posLabel : M.negLabel) + '</strong>'
        dialog.showModal()
      }
    })
  }
`

const filterScript = `
  document.querySelectorAll('nav.filters button').forEach((b) => {
    b.onclick = () => {
      document.body.dataset[b.dataset.group] = b.dataset.value
      document
        .querySelectorAll('nav.filters button[data-group="' + b.dataset.group + '"]')
        .forEach((x) => x.classList.toggle('active', x === b))
      document.querySelectorAll('details.sailing').forEach((sec) => {
        const any = [...sec.querySelectorAll('.card')].some((c) => getComputedStyle(c).display !== 'none')
        sec.style.display = any ? '' : 'none'
      })
    }
  })
`

const pickerHtml = (src, regions) => `
<details class="roipick">
  <summary>ROI picker — draw tighter crop regions</summary>
  <p>Pick a region, then <strong>drag on the photo</strong> to draw its box
  (redraw to replace). The dashed boxes are the regions currently in use —
  each is labeled and color-matched to its button below. Your drawn box uses
  the same color, solid. Copy the JSON and hand it to the classifier
  maintainer (fractions of the frame).</p>
  <p>
    <button type="button" class="roi-region active" data-region="left"><span
      class="swatch" style="border-color:${REGION_COLORS[0]}"></span>draw region A${
        regions[0]?.name ? ` — ${esc(regions[0].name)}` : ''
      }</button>
    <button type="button" class="roi-region" data-region="right"><span
      class="swatch" style="border-color:${REGION_COLORS[1]}"></span>draw region B${
        regions[1]?.name ? ` — ${esc(regions[1].name)}` : ''
      }</button>
    <button type="button" id="roi-copy">copy JSON</button>
    <span id="roi-copied" hidden>copied ✓</span>
  </p>
  <div id="roi-stage">
    <img src="${esc(src)}" alt="" draggable="false">
    ${regions
      .map(
        (r, i) => `<div class="roi-ov roi-ov-${i}"><span
          style="background:${REGION_COLORS[i] || '#fc0'}">${'AB'[i] || i + 1} · ${esc(r.name)}</span></div>`,
      )
      .join('')}
    <div class="roi-box" id="roi-left" hidden></div>
    <div class="roi-box" id="roi-right" hidden></div>
    <div class="roi-box" id="roi-drag" hidden></div>
  </div>
  <pre id="roi-out">draw a box to see its coordinates…</pre>
</details>`

const pickerScript = `
  {
    const stage = document.getElementById('roi-stage')
    if (stage) {
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
          'const REGION_A = ' + (boxes.left ? fmtR(boxes.left) : '/* not drawn yet */') +
          '\\nconst REGION_B = ' + (boxes.right ? fmtR(boxes.right) : '/* not drawn yet */')
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
  }
`

// One examples page (crosswalk.html or terminal.html).
// opts: { title, modelName, model {weights,bias,threshold}, regions, foff,
//   posLabel, negLabel, statsLine, topSections, rows, groupSummary(key,list),
//   pickerSrc, srcFor }
export function buildExamplesPage(opts) {
  const {
    title, modelName, model, regions, foff, posLabel, negLabel,
    statsLine, topSections, rows, groupSummary, pickerSrc, srcFor, frameAspect = '4 / 3',
  } = opts
  const pct = (x) => `${Math.round(x * 100)}%`
  const roiOverlays = regions.map((r, i) => `<div class="roi-ov roi-ov-${i}"></div>`).join('')

  const card = (r) => {
    const verdict =
      r.yhat === r.y
        ? `<span class="badge ok">✓ correct</span>`
        : `<span class="badge bad">✗ ${r.yhat === 1 ? 'false positive' : 'false negative'}</span>`
    return `
      <figure class="card ${r.yhat === r.y ? 'ok' : 'err'} ${r.split} ${r.y ? 'pos' : 'neg'}">
        <div class="imgwrap"><img loading="lazy" src="${esc(srcFor(r))}" alt="">${roiOverlays}</div>
        <figcaption>
          <div class="row"><strong>${esc(fmtTime(r.ts))}</strong>
            <span class="badge ${r.split}">${r.split}</span> ${verdict}
            <button class="explain" data-f="${r.fb64}" data-p="${r.p}">explain</button></div>
          <div class="row">human: <strong>${r.y ? posLabel : negLabel}</strong>
            &nbsp;·&nbsp; model: <strong>${r.p.toFixed(3)}</strong> → ${r.yhat ? posLabel : negLabel}</div>
          <div class="prob"><div class="fill ${r.yhat ? 'pos' : ''}" style="width:${pct(r.p)}"></div>
            <div class="thresh" style="left:${pct(model.threshold)}"></div></div>
        </figcaption>
      </figure>`
  }

  const groups = new Map()
  for (const r of rows) {
    if (!groups.has(r.sailingKey)) groups.set(r.sailingKey, [])
    groups.get(r.sailingKey).push(r)
  }
  const sections = [...groups.keys()]
    .sort()
    .reverse()
    .map((key) => {
      const list = groups.get(key).sort((a, b) => a.ts - b.ts)
      return `
      <details class="sailing">
        <summary>${esc(key)} <small>${groupSummary(key, list)}</small></summary>
        <div class="cards">${list.map(card).join('')}</div>
      </details>`
    })
    .join('')

  const errors = rows.filter((r) => r.yhat !== r.y).length

  return `<!doctype html>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>${SHARED_CSS}
  ${regionOverlayCss(regions)}
</style>
<p><a href="index.html">← classifier summary</a></p>
<h1>${esc(title)}</h1>
<p>${statsLine}</p>
${topSections}
<nav class="filters">
  <span class="group"><span>result</span>
    <button data-group="verdict" data-value="" class="active">all</button>
    <button data-group="verdict" data-value="ok">correct (${rows.length - errors})</button>
    <button data-group="verdict" data-value="err">misclassified (${errors})</button>
  </span>
  <span class="group"><span>human answer</span>
    <button data-group="label" data-value="" class="active">all</button>
    <button data-group="label" data-value="neg">${esc(negLabel)} (${rows.filter((r) => !r.y).length})</button>
    <button data-group="label" data-value="pos">${esc(posLabel)} (${rows.filter((r) => r.y).length})</button>
  </span>
  <span class="group"><span>split</span>
    <button data-group="split" data-value="" class="active">all</button>
    <button data-group="split" data-value="test">test (${rows.filter((r) => r.split === 'test').length})</button>
    <button data-group="split" data-value="train">train (${rows.filter((r) => r.split === 'train').length})</button>
  </span>
</nav>
${sections}
${pickerSrc ? pickerHtml(pickerSrc, regions) : ''}
<dialog id="explain-dialog">
  <h3>Why the model decided this</h3>
  <p class="legend">each panel shows the model's regions where they actually sit
  in the camera frame, over a faint real photo for orientation.</p>
  <div class="panels">
    <div>${stageHtml(regions, 'ex-in', { photo: pickerSrc, aspect: frameAspect, mini: true })}
      <p>what the model saw (crops → grayscale grids)</p></div>
    <div>${stageHtml(regions, 'ex-w', { photo: pickerSrc, aspect: frameAspect, mini: true })}
      <p>learned weights (same for every frame)</p></div>
    <div>${stageHtml(regions, 'ex-contrib', { photo: pickerSrc, aspect: frameAspect, mini: true })}
      <p><strong>this frame's votes</strong> (input × weight)</p></div>
    <div>${stageHtml(regions, 'ex-diff', { photo: pickerSrc, aspect: frameAspect, mini: true })}
      <p><strong>votes − weights</strong> — where this frame falls short of a
      fully-bright region</p></div>
  </div>
  <p id="ex-math"></p>
  <p class="legend"><span style="color:#c22">red</span> pushes toward “${esc(posLabel)}”,
    <span style="color:#26c">blue</span> toward “${esc(negLabel)}”; stronger color = stronger pull.</p>
  <form method="dialog"><button>close</button></form>
</dialog>
<div hidden>${regionCanvases(regions, 'wmap')}</div>
<script>
${paintScript({
  [modelName]: {
    weights: model.weights.map((x) => Math.round(x * 1e5) / 1e5),
    bias: Math.round(model.bias * 1e5) / 1e5,
    threshold: model.threshold,
    regions: regions.map((r) => ({ w: r.width, h: r.height })),
    foff,
    posLabel,
    negLabel,
  },
})}
${explainScript(modelName)}
${filterScript}
${pickerSrc ? pickerScript : ''}
</script>
`
}

// The index/summary page covering both classifiers.
// opts: { crosswalk: {model, regions, foff, labeled, total, statsLine},
//         terminal: {...} } — either may be null (not yet trained).
export function buildSummaryPage({ crosswalk, terminal }) {
  const models = {}
  const section = (key, title, cfg, method, pageHref, examplesLabel, frameAspect) => {
    if (!cfg) return `<h2>${esc(title)}</h2><p><em>Not trained yet.</em></p>`
    const m = cfg.model.metrics || {}
    const row = (label, x) =>
      x
        ? `<tr><th>${label}</th><td>${x.accuracy ?? '—'}</td><td>${x.precision ?? '—'}</td><td>${x.recall ?? '—'}</td></tr>`
        : ''
    models[key] = {
      weights: cfg.model.weights.map((x) => Math.round(x * 1e5) / 1e5),
      bias: 0,
      threshold: cfg.model.threshold,
      regions: cfg.regions.map((r) => ({ w: r.width, h: r.height })),
      foff: cfg.foff,
    }
    return `
<h2>${esc(title)}</h2>
<div class="method">${method}</div>
<table>
  <tr><th></th><th>accuracy</th><th>precision</th><th>recall</th></tr>
  ${row(`train (${m.trainFrames ?? '?'})`, m.train)}
  ${row(`test (${m.testFrames ?? '?'})`, m.test)}
</table>
<p>${cfg.statsLine} · threshold ${cfg.model.threshold} · trained ${esc(cfg.model.trainedAt || '?')}</p>
${historyTableHtml(cfg.history)}
${stageHtml(cfg.regions, `wmap-${key}`, { photo: cfg.photo, aspect: frameAspect })}
<p class="legend">the learned weight maps, drawn at the exact position each
region occupies in the camera frame (matching the dashed boxes on the example
pages) — <span style="color:#c22">red</span> pixels vote positive when bright,
<span style="color:#26c">blue</span> vote negative.</p>
<p><strong><a href="${pageHref}">${esc(examplesLabel)} →</a></strong></p>`
  }

  const crosswalkMethod = `
  <p><strong>In plain terms:</strong> a webcam photographs the ferry lineup every few
  minutes, and riders mark the moment cars back up past the crosswalk. From those
  examples the computer learns, for two fixed patches of road (the lane where the
  line builds, and the crosswalk itself), which spots being light or dark usually
  means the lineup has reached the crosswalk. Each new photo gets a confidence
  score; frames are read in capture order and the lineup counts as past the
  crosswalk at the first positive frame confirmed by the next one.</p>
  <p class="expert"><strong>For experts:</strong> binary logistic regression on raw
  pixel intensities; two fixed fractional crops → grayscale, normalized to [0,1],
  concatenated. Labels derive from rider marks (latest-wins). ~80/20 split by
  sailing to avoid near-duplicate leakage. Sequence rule: first-of-two-consecutive
  positives.</p>`

  const terminalMethod = `
  <p><strong>In plain terms:</strong> a second camera watches the Bowen terminal as
  the ferry loads. This classifier answers one question per photo: are there cars
  waiting? If the lane goes empty (two photos in a row, to be safe) before the
  ferry leaves, everyone got on — the ferry left <em>not full</em>. Cars appearing
  at the last minute prove nothing (they may have arrived too late), so a busy
  final photo never cancels an earlier empty one. A golf cart from the ebike shop
  parks at the left of the frame; the model's regions are drawn to ignore it.</p>
  <p class="expert"><strong>For experts:</strong> same logistic-regression recipe,
  independent model: two crops (near lane 24×24, far queue 32×12), grayscale,
  <em>per-frame mean-centered</em> (the camera spans day-to-night lighting; raw
  intensities encode time-of-day more than content). Labels were bootstrapped by a
  vision model over contact sheets and are re-joined from
  training-data/terminal-labels.json on every export. Verdict rule: two
  consecutive empty frames (~25% single-frame false-empty rate measured by CV);
  one-way — later car-filled frames never clear it.</p>`

  const cw = section('crosswalk', 'Crosswalk classifier — “has the lineup passed the crosswalk?”',
    crosswalk, crosswalkMethod, 'crosswalk.html', 'Browse crosswalk examples & predicted times', '733 / 411')
  const tm = section('terminal', 'Terminal-cars classifier — “did the ferry leave not full?”',
    terminal, terminalMethod, 'terminal.html', 'Browse terminal examples & not-full verdicts', '4 / 3')

  return `<!doctype html>
<meta charset="utf-8">
<title>Ferry lineup classifiers — results</title>
<style>${SHARED_CSS}</style>
<h1>Ferry lineup classifiers</h1>
<p class="method">Two tiny logistic-regression models watch the Bowen ferry
webcams: one detects when the car lineup passes the crosswalk, the other
detects an empty terminal (ferry left not full). They run in milliseconds,
ship as JSON weights, and everything they learn comes from rider tags and
reviewed labels. This page is the summary; the example pages show every
labeled frame and every sequence decision. Automated retraining decisions are
logged on the <a href="nightly.html">nightly training runs</a> page.</p>
${cw}
${tm}
<script>
${paintScript(models)}
  for (const key of Object.keys(MODELS)) paintRegions(MODELS[key], 'wmap-' + key, MODELS[key].weights, true)
</script>
`
}
