// Shared HTML builders for the classifier-results pages. Both trainers use
// this module to produce a three-page set, written twice (local
// training-data/report/ with full-size frames, and public/classifier-results/
// with committed thumbnails):
//   index.html      summary of both classifiers (methods, metrics, weight maps)
//   crosswalk.html  crosswalk examples: predicted times + per-sailing cards
//   terminal.html   terminal examples: not-full verdicts + per-sailing cards
import { createHash } from 'node:crypto'

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
    border: 1px solid #8884; border-radius: 6px; margin: 0.6rem 0; }
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
    statsLine, topSections, rows, groupSummary, pickerSrc, srcFor,
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
  <p class="legend">each panel stacks the model's regions, first on top.</p>
  <div class="panels">
    <div>${regionCanvases(regions, 'ex-in')}
      <p>what the model saw (crops → grayscale grids)</p></div>
    <div>${regionCanvases(regions, 'ex-w')}
      <p>learned weights (same for every frame)</p></div>
    <div>${regionCanvases(regions, 'ex-contrib')}
      <p><strong>this frame's votes</strong> (input × weight)</p></div>
    <div>${regionCanvases(regions, 'ex-diff')}
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
<div class="wstage" style="aspect-ratio: ${frameAspect}">
  ${cfg.regions
    .map(
      (r, i) => `<div class="wregion" style="left:${r.roi.left * 100}%;top:${r.roi.top * 100}%;
      width:${r.roi.width * 100}%;height:${r.roi.height * 100}%;
      border-color:${REGION_COLORS[i] || '#fc0'}">
    <canvas id="wmap-${key}-${i}" width="${r.width}" height="${r.height}"></canvas>
    <span>${esc(r.name)}</span>
  </div>`,
    )
    .join('')}
</div>
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
labeled frame and every sequence decision.</p>
${cw}
${tm}
<script>
${paintScript(models)}
  for (const key of Object.keys(MODELS)) paintRegions(MODELS[key], 'wmap-' + key, MODELS[key].weights, true)
</script>
`
}
