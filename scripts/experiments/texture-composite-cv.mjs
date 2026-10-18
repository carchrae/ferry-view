// Texture features on stable-pixel composites, crosswalk camera (Tom,
// 2026-10-18: "before we deploy i want to see some more testing on the
// composite … texture+composite"). The earlier composite experiments
// (day-composite-cv.mjs, 2026-10-17) were all on brightness features.
//
// Day frames: 5-fold CV by sailing, the trainer's recipe (recency weights,
// lr 0.1, 1000 epochs, threshold 0.7), four feature pipelines —
//   brightness raw        the deployed features (lineup-drift-eval cache)
//   brightness composite  deployed features of the composite (day-composite cache)
//   texture raw           per-cell std of the native crop, standardised per region
//   texture composite     the same on the composite, through the production
//                         path (compositeWindow → compositeStable → JPEG q80 → crops)
//   texture raw+composite both side by side
// scored per frame (all daylight, and the twilight band) and with the
// sequence severity; phantoms listed.
// Dark frames: the 979 hand labels (lineup-dark-labels.json), 5-fold by
// sailing, classes balanced, frame P/R/F1 per pipeline — a first look at what
// a night model would get from texture.
//   node scripts/experiments/texture-composite-cv.mjs
// Write-up: docs/experiments/2026-10-18-texture-composite.md
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { REGIONS, FEATURE_LENGTH, COMPOSITE, compositeWindow, compositeStable, greyToJpeg } from '../../functions/lib/lineup-features.js'
import { cellStdGrid, standardizeRegions, regionRect } from '../../functions/lib/terminal-feature-math.js'
import { isDarkAt, solarElevation } from '../../functions/lib/daylight.js'
import { effectiveCrosswalk, firstSustainedPositiveTs } from '../../functions/lib/lineup-labels.js'

const ROOT = join(import.meta.dirname, '../..'), DATA = join(ROOT, 'training-data'), CACHE = join(DATA, 'experiments/cache')
const sharp = createRequire(join(ROOT, 'functions/package.json'))('sharp')
const N = FEATURE_LENGTH
const KEEP = new Uint8Array(N).fill(1)

// --- frames, grouped by sailing -------------------------------------------------
const bySailing = new Map()
for (const line of readFileSync(join(DATA, 'manifest.csv'), 'utf8').trim().split('\n').slice(1)) {
  const [path, sailingKey, ts, label, crosswalkAt] = line.split(',')
  const file = join(DATA, 'frames', path)
  if (!existsSync(file)) continue
  if (!bySailing.has(sailingKey)) bySailing.set(sailingKey, [])
  bySailing.get(sailingKey).push({ path, sailingKey, ts: Number(ts), date: sailingKey.slice(0, 10), y: label === '0' ? 0 : label === '1' ? 1 : null, crosswalkAt: crosswalkAt ? Number(crosswalkAt) : null, dark: isDarkAt(Number(ts)), file })
}
for (const l of bySailing.values()) l.sort((a, b) => a.ts - b.ts)
const all = [...bySailing.values()].flat()
const darkLabels = JSON.parse(readFileSync(join(DATA, 'lineup-dark-labels.json'), 'utf8'))
for (const f of all) if (f.dark && darkLabels[f.path] != null) f.yDark = darkLabels[f.path]

// --- caches -----------------------------------------------------------------------
const rawPaths = JSON.parse(readFileSync(join(CACHE, 'features-index.json'), 'utf8')), rawBin = readFileSync(join(CACHE, 'features.bin'))
const rawIdx = new Map(rawPaths.map((p, i) => [p, i]))
const brightRaw = (p) => { const i = rawIdx.get(p); if (i == null) return null; return Float32Array.from(rawBin.subarray(i * N, (i + 1) * N), (v) => v / 255) }
const compIdx = JSON.parse(readFileSync(join(CACHE, 'composite-index.json'), 'utf8')), compBin = readFileSync(join(CACHE, 'composite.bin'))
const brightComp = (p) => { const e = compIdx[p]; if (!e) return null; return Float32Array.from(compBin.subarray(e.i * N, (e.i + 1) * N), (v) => v / 255) }
const stdIdx = JSON.parse(readFileSync(join(CACHE, 'lineup-std-index.json'), 'utf8')), stdBin = readFileSync(join(CACHE, 'lineup-std.u8'))
const texRaw = (p) => { const i = stdIdx[p]; if (i == null || i < 0) return null; const v = new Float32Array(N); for (let c = 0; c < N; c++) v[c] = stdBin[i * N + c] / 1020; return standardizeRegions(v, REGIONS, KEEP) }

async function textureOfJpeg(buf) {
  const meta = await sharp(buf).metadata()
  const o = new Float32Array(N); let off = 0
  for (const { roi, width, height } of REGIONS) { const rect = regionRect(roi, meta.width, meta.height); const g = await sharp(buf).extract(rect).greyscale().raw().toBuffer(); cellStdGrid(g, rect.width, rect.height, width, height, o, off); off += width * height }
  const u8 = Buffer.alloc(N); for (let i = 0; i < N; i++) u8[i] = Math.max(0, Math.min(255, Math.round((o[i] / 255) * 1020)))
  return u8
}
// texture of the composite, through the production path, cached
const tcIdxFile = join(CACHE, 'lineup-std-composite-index.json'), tcBinFile = join(CACHE, 'lineup-std-composite.u8')
const tcIdx = existsSync(tcIdxFile) ? JSON.parse(readFileSync(tcIdxFile, 'utf8')) : {}
let tcBin = existsSync(tcBinFile) ? readFileSync(tcBinFile) : Buffer.alloc(0)
{
  const todo = []
  for (const list of bySailing.values()) for (let i = 0; i < list.length; i++) if (!(list[i].path in tcIdx) && (list[i].y != null || list[i].yDark != null || !list[i].dark)) todo.push([list, i])
  if (todo.length) {
    console.error(`texture of composites for ${todo.length} frames…`)
    const chunks = [tcBin]; let n = Object.keys(tcIdx).length, done = 0, t0 = Date.now()
    for (const [list, i] of todo) {
      const win = [list[i]]
      for (let j = i - 1; j >= 0 && win.length < COMPOSITE.k; j--) { if (win[0].ts - list[j].ts > COMPOSITE.maxGapMs) break; win.unshift(list[j]) }
      try {
        const { greys } = await compositeWindow(win.map((w) => readFileSync(w.file)))
        const jpeg = await greyToJpeg(compositeStable(greys))
        chunks.push(await textureOfJpeg(jpeg)); tcIdx[list[i].path] = { i: n++, used: greys.length }
      } catch { tcIdx[list[i].path] = null }
      if (++done % 1000 === 0) console.error(`  ${done}/${todo.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
    }
    tcBin = Buffer.concat(chunks); writeFileSync(tcBinFile, tcBin); writeFileSync(tcIdxFile, JSON.stringify(tcIdx))
  }
}
const texComp = (p) => { const e = tcIdx[p]; if (!e) return null; const v = new Float32Array(N); for (let c = 0; c < N; c++) v[c] = tcBin[e.i * N + c] / 1020; return standardizeRegions(v, REGIONS, KEEP) }
const texBoth = (p) => { const a = texRaw(p), b = texComp(p); if (!a || !b) return null; const o = new Float32Array(2 * N); o.set(a, 0); o.set(b, N); return o }

// --- harness ---------------------------------------------------------------------
const newest = all.map((s) => s.date).sort().at(-1)
const ageDays = (s) => (new Date(newest) - new Date(s.date)) / 864e5
const recency = (s) => 1 + 3 * Math.exp(-ageDays(s) / 21)
const sigmoid = (z) => 1 / (1 + Math.exp(-z))
const fold = (k) => createHash('md5').update(k).digest()[0] % 5
const refuted = new Set()
{ const byKey = new Map(); for (const r of JSON.parse(readFileSync(join(DATA, 'lineup-reports.json'), 'utf8'))) { if (r.deleted) continue; if (!byKey.has(r.sailingKey)) byKey.set(r.sailingKey, []); byKey.get(r.sailingKey).push(r) } for (const [k, l] of byKey) if (effectiveCrosswalk(l)?.notYet) refuted.add(k) }
const SEQ = { phantom: 10, early30: 6, early10: 2, late10: 1, late30: 2, missed: 2 }
function trainLR(set, feat, dim, labelOf, { epochs = 1000, lr = 0.1, l2 = 1e-4, weights = null, balance = false } = {}) {
  const X = set.map((s) => feat(s.path)), Y = set.map(labelOf)
  const pos = Y.filter((y) => y === 1).length, wNeg = balance ? pos / Math.max(1, Y.length - pos) : 1
  const W = set.map((s, j) => (weights ? weights(s) : 1) * (Y[j] ? 1 : wNeg)), wsum = W.reduce((a, x) => a + x, 0)
  const w = new Float64Array(dim); let b = 0
  for (let e = 0; e < epochs; e++) {
    const gw = new Float64Array(dim); let gb = 0
    for (let j = 0; j < set.length; j++) { const f = X[j]; let z = b; for (let i = 0; i < dim; i++) z += w[i] * f[i]; const err = (sigmoid(z) - Y[j]) * W[j]; for (let i = 0; i < dim; i++) gw[i] += err * f[i]; gb += err }
    for (let i = 0; i < dim; i++) w[i] -= lr * (gw[i] / wsum + l2 * w[i]); b -= lr * (gb / wsum)
  }
  return (f) => { let z = b; for (let i = 0; i < dim; i++) z += w[i] * f[i]; return sigmoid(z) }
}
const pipelines = { 'brightness raw': [brightRaw, N], 'brightness composite': [brightComp, N], 'texture raw': [texRaw, N], 'texture composite': [texComp, N], 'texture raw+composite': [texBoth, 2 * N] }
const out = { day: {}, dark: {} }

// --- DAY --------------------------------------------------------------------------
{
  const labeled = all.filter((s) => s.y != null && !s.dark && Object.values(pipelines).every(([f]) => f(s.path)))
  const twilight = (s) => solarElevation(s.ts) < 0
  console.log(`\nDAY crosswalk, 5-fold CV by sailing, ${labeled.length} labelled daylight frames (${labeled.filter(twilight).length} twilight), recency weights on`)
  const phantoms = {}
  for (const [name, [feat, dim]] of Object.entries(pipelines)) {
    const t = { tp: 0, fp: 0, fn: 0, ttp: 0, tfp: 0, tfn: 0, cost: 0, agree: 0, missed: 0, phantom: 0, early: 0, sailings: 0 }
    for (let k = 0; k < 5; k++) {
      const train = labeled.filter((s) => fold(s.sailingKey) !== k), test = labeled.filter((s) => fold(s.sailingKey) === k)
      const sc = trainLR(train, feat, dim, (s) => s.y, { weights: recency })
      for (const s of test) { const yh = sc(feat(s.path)) >= 0.7 ? 1 : 0; const tw = twilight(s); if (yh && s.y) { t.tp++; if (tw) t.ttp++ } else if (yh && !s.y) { t.fp++; if (tw) t.tfp++ } else if (!yh && s.y) { t.fn++; if (tw) t.tfn++ } }
      for (const [key, frames] of bySailing) {
        if (fold(key) !== k) continue
        const lit = frames.filter((f) => !f.dark && feat(f.path)); if (lit.length < 2) continue; t.sailings++
        const scored = lit.map((f) => ({ ts: f.ts, p: sc(feat(f.path)) }))
        const det = firstSustainedPositiveTs(scored.map((f) => ({ ts: f.ts, positive: f.p >= 0.7 }))); const human = frames[0].crosswalkAt
        if (det == null) { if (human != null) t.missed++; continue }
        if (human == null) { if (refuted.has(key)) { t.phantom++; (phantoms[name] ??= []).push({ key, det: new Date(det).toISOString() }) } continue }
        const d = (det - human) / 60000
        if (d <= -30) { t.early++; t.cost += 6 } else if (d <= -10) { t.early++; t.cost += 2 } else if (d < 10) t.agree++; else if (d < 30) t.cost += 1; else t.cost += 2
      }
    }
    t.cost += t.phantom * SEQ.phantom + t.missed * SEQ.missed
    out.day[name] = { ...t, P: t.tp / (t.tp + t.fp || 1), R: t.tp / (t.tp + t.fn || 1), twilightP: t.ttp / (t.ttp + t.tfp || 1), twilightR: t.ttp / (t.ttp + t.tfn || 1), phantoms: phantoms[name] || [] }
    const o = out.day[name]
    console.log(`${name.padEnd(24)} P ${o.P.toFixed(3)} R ${o.R.toFixed(3)} | twilight P ${o.twilightP.toFixed(3)} R ${o.twilightR.toFixed(3)} | cost ${String(t.cost).padStart(4)} agree ${t.agree} missed ${t.missed} phantom ${t.phantom} early ${t.early}  (${t.sailings} sailings)`)
    if (o.phantoms.length) console.log(`    phantoms: ${o.phantoms.map((p) => `${p.key} det ${p.det.slice(11, 16)}Z`).join('; ')}`)
  }
}

// --- DARK --------------------------------------------------------------------------
{
  const labeled = all.filter((s) => s.yDark != null && Object.values(pipelines).every(([f]) => f(s.path)))
  const pos = labeled.filter((s) => s.yDark === 1).length
  console.log(`\nDARK crosswalk (sun < −7°), ${labeled.length} hand-labelled frames (${pos} with the line past the crosswalk, ${new Set(labeled.filter((s) => s.yDark === 1).map((s) => s.sailingKey)).size} sailings), 5-fold by sailing, classes balanced, no recency`)
  for (const [name, [feat, dim]] of Object.entries(pipelines)) {
    let tp = 0, fp = 0, fn = 0, tn = 0
    const preds = new Map()
    for (let k = 0; k < 5; k++) {
      const train = labeled.filter((s) => fold(s.sailingKey) !== k), test = labeled.filter((s) => fold(s.sailingKey) === k)
      if (!train.some((s) => s.yDark === 1)) { for (const s of test) preds.set(s.path, 0); continue }
      const sc = trainLR(train, feat, dim, (s) => s.yDark, { balance: true })
      for (const s of test) preds.set(s.path, sc(feat(s.path)))
    }
    for (const s of labeled) { const yh = preds.get(s.path) >= 0.7 ? 1 : 0; if (yh && s.yDark) tp++; else if (yh && !s.yDark) fp++; else if (!yh && s.yDark) fn++; else tn++ }
    // sailing level on the dark sailings: detected (≥2 sustained positives) vs the hand mark / none
    let detPos = 0, posS = 0, detNeg = 0, negS = 0
    for (const [key, frames] of bySailing) {
      const d = frames.filter((f) => f.yDark != null); if (d.length < 2) continue
      const isPos = d.some((f) => f.yDark === 1); if (isPos) posS++; else negS++
      const det = firstSustainedPositiveTs(d.map((f) => ({ ts: f.ts, positive: preds.get(f.path) >= 0.7 })))
      if (det != null) { if (isPos) detPos++; else detNeg++ }
    }
    out.dark[name] = { n: labeled.length, tp, fp, fn, tn, P: tp / (tp + fp || 1), R: tp / (tp + fn || 1), detPos, posS, detNeg, negS }
    const o = out.dark[name]
    console.log(`${name.padEnd(24)} frames P ${o.P.toFixed(3)} R ${o.R.toFixed(3)} (tp ${tp} fp ${fp} fn ${fn}) | sailings: detected ${detPos} of ${posS} positive, ${detNeg} false of ${negS} negative`)
  }
}
writeFileSync(join(DATA, 'experiments/texture-composite-cv.json'), JSON.stringify(out, null, 1))
console.log('\nwritten training-data/experiments/texture-composite-cv.json')
