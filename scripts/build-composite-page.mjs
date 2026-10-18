#!/usr/bin/env node
// Build the "how night composites work" results page: composites.html in
// training-data/report/ and public/classifier-results/ (with its images under
// composites/). It explains the stable-pixel composite the night path uses and
// shows real cases from the archive — every frame that went into a window,
// the composite that came out, and a map of which pixels changed — grouped as:
//   1. standing queue survives (the hand-labelled dark crossings),
//   2. headlight sweep removed (the dark frames the composite changed most),
//   3. exposure-mode guard (windows where a colour/infrared neighbour was
//      dropped by the saturation check),
// plus the experiment numbers for the day and terminal models.
//
//   npm run lineup:composites-page      (reads training-data/dark-frames.json
//                                        from npm run lineup:dark-label)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import {
  COMPOSITE,
  compositeWindow,
  compositeStable,
  greyToJpeg,
  colourSaturation,
} from '../functions/lib/lineup-features.js'
import { isDarkAt } from '../functions/lib/daylight.js'
import { TZ } from '../functions/lib/time.js'

const sharp = createRequire(new URL('../functions/lib/lineup-features.js', import.meta.url))('sharp')
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(repoRoot, 'training-data')
const OUTS = [join(DATA, 'report'), join(repoRoot, 'public', 'classifier-results')]
for (const o of OUTS) mkdirSync(join(o, 'composites'), { recursive: true })

const sailings = JSON.parse(readFileSync(join(DATA, 'dark-frames.json'), 'utf8'))
const hand = existsSync(join(DATA, 'lineup-dark-labels.json')) ? JSON.parse(readFileSync(join(DATA, 'lineup-dark-labels.json'), 'utf8')) : {}
const frameFile = (path) => join(DATA, 'frames', path)
const fmt = (ts) => new Date(ts).toLocaleTimeString('en-CA', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const id = (s) => createHash('md5').update(s).digest('hex').slice(0, 12)

// Window for frame i of a sailing — the trainer's rule.
const windowOf = (frames, i) => {
  const win = [frames[i]]
  for (let j = i - 1; j >= 0 && win.length < COMPOSITE.k; j--) {
    if (win[0].ts - frames[j].ts > COMPOSITE.maxGapMs) break
    win.unshift(frames[j])
  }
  return win
}
const THUMB = 400
async function saveThumb(buf, name) {
  const out = await sharp(buf).resize({ width: THUMB }).jpeg({ quality: 72 }).toBuffer()
  for (const o of OUTS) writeFileSync(join(o, 'composites', name), out)
  return `composites/${name}`
}
// One example: the window's raw frames, the composite, the change map.
async function renderExample(frames, i, note) {
  const f = frames[i]
  const win = windowOf(frames, i)
  if (win.length < 2) return null
  const jpegs = win.map((w) => readFileSync(frameFile(w.path)))
  const sats = []
  for (const j of jpegs) sats.push(await colourSaturation(j))
  const { greys, infrared } = await compositeWindow(jpegs)
  const comp = compositeStable(greys)
  const judged = greys[greys.length - 1]
  // Change map: |composite − judged frame| ×3, so a replaced headlight bloom
  // shows white and untouched pixels black.
  const diff = Buffer.alloc(judged.length)
  let changed = 0
  for (let k = 0; k < judged.length; k++) { const d = Math.abs(comp[k] - judged[k]); diff[k] = Math.min(255, d * 3); if (d >= COMPOSITE.tau) changed++ }
  const base = id(f.path)
  const raws = []
  for (let k = 0; k < win.length; k++) {
    const dropped = greys.length < win.length && k < win.length - 1 && (sats[k] < COMPOSITE.maxInfraredSaturation) !== (sats[win.length - 1] < COMPOSITE.maxInfraredSaturation)
    raws.push({ src: await saveThumb(jpegs[k], `${base}-r${k}.jpg`), time: fmt(win[k].ts), dropped, mode: sats[k] < COMPOSITE.maxInfraredSaturation ? 'IR' : 'colour' })
  }
  return {
    key: f.sailingKey ?? frames[0].sailingKey, time: fmt(f.ts), note, infrared, used: greys.length, offered: win.length,
    changedPct: Math.round((changed / judged.length) * 1000) / 10, raws,
    comp: await saveThumb(await greyToJpeg(comp), `${base}-c.jpg`),
    diff: await saveThumb(await greyToJpeg(diff), `${base}-d.jpg`),
  }
}

// --- pick examples ---------------------------------------------------------------
const queue = [], sweeps = [], guard = []
for (const s of sailings) {
  const frames = s.frames.map((f) => ({ ...f, sailingKey: s.key }))
  const firstPos = frames.findIndex((f) => f.dark && hand[f.path] === 1)
  if (firstPos >= 0 && windowOf(frames, firstPos).length >= 2) queue.push({ frames, i: firstPos, note: 'hand label: lineup past the crosswalk from this frame' })
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    if (!f.dark || hand[f.path] !== 0) continue
    const win = windowOf(frames, i)
    if (win.length >= 2 && f.used < f.window) guard.push({ frames, i, note: 'a neighbour was dropped: different exposure mode (colour vs infrared)' })
  }
}
// Headlight sweeps: dark negatives whose composite differs most from the raw
// frame — measured here on a quick pass (cheap: a few thousand greys).
{
  const cands = []
  for (const s of sailings) {
    const frames = s.frames.map((f) => ({ ...f, sailingKey: s.key }))
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i]
      if (!f.dark || hand[f.path] !== 0 || f.used !== 3) continue
      cands.push({ frames, i })
    }
  }
  // Sample to keep the build quick, then score |composite − raw|.
  const step = Math.max(1, Math.floor(cands.length / 250))
  for (let c = 0; c < cands.length; c += step) {
    const { frames, i } = cands[c]
    const { greys } = await compositeWindow(windowOf(frames, i).map((w) => readFileSync(frameFile(w.path))))
    if (greys.length < 3) continue
    const comp = compositeStable(greys); const j = greys[greys.length - 1]
    let d = 0; for (let k = 0; k < j.length; k++) d += Math.abs(comp[k] - j[k])
    cands[c].score = d / j.length
  }
  const byDay = new Map()
  for (const c of cands.filter((c) => c.score != null).sort((a, b) => b.score - a.score)) {
    const day = c.frames[c.i].sailingKey.slice(0, 10)
    if (byDay.has(day)) continue
    byDay.set(day, c); sweeps.push({ ...c, note: 'hand label: not past the crosswalk — the composite removed what moved' })
    if (sweeps.length >= 8) break
  }
}
const sections = []
for (const [title, intro, list, max] of [
  ['A standing queue survives the composite', 'The first dark frame of each hand-labelled crossing. Cars that are queued are in the same place in every frame of the window, so they are "stable" pixels and keep their value.', queue, 14],
  ['A headlight sweep does not', 'The dark frames the composite changed most, one per night. Where a car’s lights swept across the lane in one frame, the pixels differ across the window and take the window minimum — the dark road.', sweeps, 8],
  ['The exposure-mode guard', 'The camera switches between colour and infrared at dusk and dawn. A neighbour from the other mode is dropped (shown greyed), so the composite never mixes the two exposures — mixing them ghosts the earlier frame’s cars into the later one.', guard, 4],
]) {
  const examples = []
  for (const ex of list.slice(0, max)) { const r = await renderExample(ex.frames, ex.i, ex.note); if (r) examples.push(r) }
  sections.push({ title, intro, examples })
}

// --- page --------------------------------------------------------------------------
const exampleHtml = (e) => `
<div class="ex">
  <div class="cap"><b>${esc(e.key)}</b> · judged frame ${esc(e.time)} · ${e.infrared ? 'infrared' : 'colour'} · ${e.used} of ${e.offered} frames used · ${e.changedPct}% of pixels replaced<br><span class="note">${esc(e.note)}</span></div>
  <div class="row">
    ${e.raws.map((r, i) => `<figure class="${r.dropped ? 'dropped' : ''}"><img loading="lazy" src="${r.src}"><figcaption>${i === e.raws.length - 1 ? 'judged frame' : 'earlier frame'} ${esc(r.time)} · ${r.mode}${r.dropped ? ' · dropped' : ''}</figcaption></figure>`).join('')}
    <div class="arrow">→</div>
    <figure class="comp"><img loading="lazy" src="${e.comp}"><figcaption>stable composite</figcaption></figure>
    <figure><img loading="lazy" src="${e.diff}"><figcaption>what changed (white = replaced)</figcaption></figure>
  </div>
</div>`
const html = `<!doctype html>
<meta charset="utf-8">
<title>Night composites — how the lineup classifier sees in the dark</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0 auto; max-width: 1400px; padding: 16px; color: #222; background: #fff; }
  h1 { font-size: 22px; } h2 { font-size: 18px; margin-top: 32px; } p { max-width: 80ch; line-height: 1.45; }
  code { background: #f2f2f2; padding: 0 4px; border-radius: 3px; }
  table { border-collapse: collapse; margin: 8px 0; } td, th { border: 1px solid #ddd; padding: 3px 8px; font-size: 13px; text-align: right; } th:first-child, td:first-child { text-align: left; }
  .ex { margin: 14px 0 22px; padding: 10px; background: #111; color: #eee; border-radius: 8px; }
  .cap { font-size: 13px; margin-bottom: 6px; } .note { color: #bbb; }
  .row { display: flex; gap: 8px; align-items: flex-start; overflow-x: auto; }
  figure { margin: 0; flex: 0 0 auto; width: ${THUMB / 2}px; } figure img { width: 100%; display: block; border-radius: 4px; background: #000; }
  figcaption { font-size: 11px; color: #bbb; margin-top: 3px; } figure.comp img { outline: 2px solid #f0a030; } figure.dropped img { opacity: .35; }
  .arrow { align-self: center; font-size: 26px; color: #f0a030; padding: 0 4px; }
  nav a { margin-right: 14px; }
</style>
<nav><a href="index.html">← results</a><a href="crosswalk.html">crosswalk examples</a><a href="terminal.html">terminal examples</a><a href="nightly.html">nightly runs</a></nav>
<h1>Night composites — how the lineup classifier can see in the dark</h1>
<p><strong>In plain terms:</strong> after dark the community camera switches to infrared and
passing cars' headlights bloom across the whole lane, which looks to the day model exactly like
a queue of cars. But a real queue stands still while headlights sweep past. So before a night
frame is classified it is combined with the one or two frames taken just before it: wherever the
frames agree the pixel is kept (a parked car, a street light, the crosswalk paint); wherever they
disagree the darkest value wins (a bloom that was only there for one frame disappears, leaving
the dark road). The classifier then reads that composite instead of the raw frame.</p>
<p><strong>For experts:</strong> each frame is reduced to a 640×360 grey canonical image. The window is
the judged frame plus up to ${COMPOSITE.k - 1} earlier frames no more than ${COMPOSITE.maxGapMs / 60000} minutes
apart, keeping only frames in the same exposure mode (infrared vs colour, decided by mean colour
saturation — infrared frames score 0, colour frames 30+; threshold ${COMPOSITE.maxInfraredSaturation}) and within
${COMPOSITE.maxLuminanceDelta} mean luminance of the judged frame. Per pixel: if the window's
max−min range is below ${COMPOSITE.tau} grey levels the pixel is stable and takes the median,
otherwise it takes the minimum. The composite is re-encoded as JPEG q80 and goes through the
same two crops as the day model (<code>functions/lib/lineup-features.js</code>:
<code>compositeWindow</code>, <code>compositeStable</code>, <code>extractCompositeFeatures</code>).
The same code runs in the trainer, on the labelling page, and on the server.</p>
<h2>Where it stands</h2>
<p>The night model is not shipped yet: it needs more labelled night crossings (${queue.length} dark
sailings are labelled as reaching the crosswalk so far, almost all pre-dawn 06:15 boats — the dusk
boats join as sunset moves earlier). Composites were also tried for the two daytime models and
<em>not</em> adopted. With the brightness features both models used until 2026-10-18, the crosswalk
composite at 5-minute spacing fixed nothing and added two empty-scene false positives, and on the
terminal camera a daylight-banded model beat composites in every band. Since 2026-10-18 both models
read <strong>texture</strong> (how much each small patch of the picture varies, not how bright it is);
texture on raw frames is the best pipeline by day on every measure, and a headlight bloom, being
smooth, reads as little texture — so the composite is not needed to make the day model safe. In the
dark, on the ${queue.length}-sailing hand-labelled set, texture on raw frames finds the most crossings
and raises no false alarm on 118 quiet dark sailings, but still misses more than half, so the robot
stays off in the dark until more night crossings are labelled.</p>
<table><tr><th>experiment (5-fold CV by sailing)</th><th>raw frames</th><th>composite</th></tr>
<tr><td>crosswalk, day frames, brightness features — held-out severity cost (lower is better)</td><td>165</td><td>184</td></tr>
<tr><td>crosswalk, day frames, <strong>texture</strong> features — severity cost</td><td><strong>124</strong></td><td>154</td></tr>
<tr><td>crosswalk, dark hand-labelled frames, texture — positive sailings found of 11 / false of 118</td><td><strong>4 / 0</strong></td><td>3 / 0</td></tr>
<tr><td>terminal, brightness, single model — F1</td><td>0.906</td><td>0.896</td></tr>
<tr><td>terminal, brightness, banded at 0° — F1 (composite only below the horizon)</td><td>0.928</td><td>0.918</td></tr></table>
${sections.map((s) => `<h2>${esc(s.title)}</h2><p>${esc(s.intro)}</p>${s.examples.length ? s.examples.map(exampleHtml).join('') : '<p><em>No examples in the current archive.</em></p>'}`).join('')}
<p class="note">Built ${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z from training-data/dark-frames.json (npm run lineup:dark-label) by scripts/build-composite-page.mjs.</p>
`
for (const o of OUTS) writeFileSync(join(o, 'composites.html'), html)
console.log(`composites.html: ${sections.map((s) => `${s.examples.length} ${s.title.toLowerCase()}`).join(' · ')} → ${OUTS.join(', ')}`)
