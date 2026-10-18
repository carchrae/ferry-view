// Write-up: docs/experiments/2026-10-17-composites-day-and-terminal.md
// Tom's question (2026-10-17): would the DAY crosswalk model also do better on
// stable-pixel composites — moving cars vanish, a standing queue stays? Same
// trainer recipe (recency-weighted logistic regression, deterministic
// by-sailing 5-fold CV, held-out severity cost) on raw frames vs composites
// of the trailing window (COMPOSITE rules: ≤3 frames, ≤7 min apart, same
// exposure). Features cached under experiments/cache/.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const CACHE = join(REPO, 'training-data/experiments/cache')
const { FEATURE_LENGTH, COMPOSITE, extractCompositeFeatures } = await import(REPO + '/functions/lib/lineup-features.js')
const { isDarkAt } = await import(REPO + '/functions/lib/daylight.js')
const { effectiveCrosswalk, firstSustainedPositiveTs } = await import(REPO + '/functions/lib/lineup-labels.js')
const DATA = join(REPO, 'training-data')

// --- raw features (cached by the drift eval) ----------------------------------
const rawPaths = JSON.parse(readFileSync(join(CACHE, 'features-index.json'), 'utf8'))
const rawBin = readFileSync(join(CACHE, 'features.bin'))
const rawIdx = new Map(rawPaths.map((p, i) => [p, i]))
const rawF = (p) => { const i = rawIdx.get(p); return Float32Array.from(rawBin.subarray(i * FEATURE_LENGTH, (i + 1) * FEATURE_LENGTH), (v) => v / 255) }

// --- manifest, grouped ------------------------------------------------------------
const bySailing = new Map()
for (const line of readFileSync(join(DATA, 'manifest.csv'), 'utf8').trim().split('\n').slice(1)) {
  const [path, sailingKey, ts, label, crosswalkAt] = line.split(',')
  if (!rawIdx.has(path)) continue
  if (!bySailing.has(sailingKey)) bySailing.set(sailingKey, [])
  bySailing.get(sailingKey).push({ path, sailingKey, ts: Number(ts), date: sailingKey.slice(0, 10), y: label === '0' ? 0 : label === '1' ? 1 : null, crosswalkAt: crosswalkAt ? Number(crosswalkAt) : null, dark: isDarkAt(Number(ts)), file: join(DATA, 'frames', path) })
}
for (const l of bySailing.values()) l.sort((a, b) => a.ts - b.ts)

// --- composite features (cached) --------------------------------------------------
const compIdxFile = join(CACHE, 'composite-index.json'), compBinFile = join(CACHE, 'composite.bin')
const compIdx = existsSync(compIdxFile) ? JSON.parse(readFileSync(compIdxFile, 'utf8')) : {}
let compBin = existsSync(compBinFile) ? readFileSync(compBinFile) : Buffer.alloc(0)
const todo = []
for (const list of bySailing.values()) for (let i = 0; i < list.length; i++) if (!(list[i].path in compIdx)) todo.push([list, i])
if (todo.length) {
  console.error(`compositing ${todo.length} frames…`)
  const chunks = [compBin]; let n = Object.keys(compIdx).length; let done = 0
  for (const [list, i] of todo) {
    const win = [list[i]]
    for (let j = i - 1; j >= 0 && win.length < COMPOSITE.k; j--) { if (win[0].ts - list[j].ts > COMPOSITE.maxGapMs) break; win.unshift(list[j]) }
    try {
      const f = await extractCompositeFeatures(win.map((w) => readFileSync(w.file)))
      chunks.push(Buffer.from(Uint8Array.from(f, (v) => Math.round(v * 255)))); compIdx[list[i].path] = { i: n++, used: f.framesUsed, win: win.length }
    } catch { compIdx[list[i].path] = null }
    if (++done % 500 === 0) console.error(`  ${done}/${todo.length}`)
  }
  compBin = Buffer.concat(chunks); writeFileSync(compBinFile, compBin); writeFileSync(compIdxFile, JSON.stringify(compIdx))
}
const compF = (p) => { const e = compIdx[p]; if (!e) return null; return Float32Array.from(compBin.subarray(e.i * FEATURE_LENGTH, (e.i + 1) * FEATURE_LENGTH), (v) => v / 255) }

// --- CV harness (same as seasonal-drift-cv.mjs) ----------------------------------
const all = [...bySailing.values()].flat()
const newest = all.map((s) => s.date).sort().at(-1)
const ageDays = (s) => (new Date(newest) - new Date(s.date)) / 864e5
const weight = (s) => 1 + 3 * Math.exp(-ageDays(s) / 21)
const sigmoid = (z) => 1 / (1 + Math.exp(-z))
const refuted = new Set()
{ const byKey = new Map(); for (const r of JSON.parse(readFileSync(join(DATA, 'lineup-reports.json'), 'utf8'))) { if (r.deleted) continue; if (!byKey.has(r.sailingKey)) byKey.set(r.sailingKey, []); byKey.get(r.sailingKey).push(r) }
  for (const [k, l] of byKey) if (effectiveCrosswalk(l)?.notYet) refuted.add(k) }
const SEQ_COSTS = { phantom: 10, early30: 6, early10: 2, late10: 1, late30: 2, missed: 2 }
const phantoms = {}
function severity(keys, feat, score, name) {
  const c = { phantom: 0, early30: 0, early10: 0, agree: 0, late10: 0, late30: 0, missed: 0, unknown: 0 }
  for (const key of keys) {
    const frames = bySailing.get(key); const lit = frames.filter((f) => !f.dark && feat(f.path)); if (lit.length < 2) continue
    const scored = lit.map((f) => ({ ts: f.ts, p: score(feat(f.path)) }))
    const det = firstSustainedPositiveTs(scored.map((f) => ({ ts: f.ts, positive: f.p >= 0.7 })))
    const human = frames[0].crosswalkAt
    if (det == null) { if (human != null) c.missed++; continue }
    if (human == null) { if (refuted.has(key)) { c.phantom++; (phantoms[name] ??= []).push({ key, det, scores: scored.map((f) => [f.ts, Math.round(f.p * 100) / 100]) }) } else c.unknown++; continue }
    const d = (det - human) / 60000
    if (d <= -30) c.early30++; else if (d <= -10) c.early10++; else if (d < 10) c.agree++; else if (d < 30) c.late10++; else c.late30++
  }
  c.cost = Object.entries(SEQ_COSTS).reduce((a, [k, w]) => a + w * c[k], 0); return c
}
function trainLR(set, feat, { epochs = 1000, lr = 0.1, l2 = 1e-4 } = {}) {
  const X = set.map((s) => feat(s.path)), W = set.map(weight), wsum = W.reduce((a, x) => a + x, 0)
  const w = new Float64Array(FEATURE_LENGTH); let b = 0
  for (let e = 0; e < epochs; e++) {
    const gw = new Float64Array(FEATURE_LENGTH); let gb = 0
    for (let j = 0; j < set.length; j++) { const f = X[j]; let z = b; for (let i = 0; i < FEATURE_LENGTH; i++) z += w[i] * f[i]; const err = (sigmoid(z) - set[j].y) * W[j]; for (let i = 0; i < FEATURE_LENGTH; i++) gw[i] += err * f[i]; gb += err }
    for (let i = 0; i < FEATURE_LENGTH; i++) w[i] -= lr * (gw[i] / wsum + l2 * w[i]); b -= lr * (gb / wsum)
  }
  return (f) => { let z = b; for (let i = 0; i < FEATURE_LENGTH; i++) z += w[i] * f[i]; return sigmoid(z) }
}
const fold = (k) => createHash('md5').update(k).digest()[0] % 5
const labeled = all.filter((s) => s.y != null && !s.dark && compF(s.path))
const variants = { 'raw frames': rawF, 'stable composite (≤3 frames)': compF }
const tot = {}
for (let k = 0; k < 5; k++) {
  const train = labeled.filter((s) => fold(s.sailingKey) !== k), test = labeled.filter((s) => fold(s.sailingKey) === k)
  const testKeys = [...bySailing.keys()].filter((key) => fold(key) === k)
  for (const [name, feat] of Object.entries(variants)) {
    const sc = trainLR(train, feat); const t = (tot[name] ??= { tp: 0, fp: 0, fn: 0, cost: 0, agree: 0, missed: 0, phantom: 0, early: 0 })
    for (const s of test) { const yh = sc(feat(s.path)) >= 0.7 ? 1 : 0; if (yh && s.y) t.tp++; else if (yh && !s.y) t.fp++; else if (!yh && s.y) t.fn++ }
    const sv = severity(testKeys, feat, sc, name); t.cost += sv.cost; t.agree += sv.agree; t.missed += sv.missed; t.phantom += sv.phantom; t.early += sv.early10 + sv.early30
  }
  console.error(`fold ${k} done`)
}
const usedDist = {}; for (const s of labeled) { const u = compIdx[s.path].used; usedDist[u] = (usedDist[u] || 0) + 1 }
console.log(`\nDay crosswalk model, 5-fold CV by sailing, ${labeled.length} labeled daylight frames (composite window used: ${JSON.stringify(usedDist)})`)
console.log('features'.padEnd(30), 'P      R      cost  agree  missed  phantom  early')
for (const [n, t] of Object.entries(tot)) console.log(n.padEnd(30), (t.tp / (t.tp + t.fp)).toFixed(3), ' ', (t.tp / (t.tp + t.fn)).toFixed(3), ' ', String(t.cost).padStart(4), String(t.agree).padStart(6), String(t.missed).padStart(7), String(t.phantom).padStart(8), String(t.early).padStart(6))

writeFileSync(join(CACHE, 'day-composite-phantoms.json'), JSON.stringify(phantoms, null, 1))
for (const [name, list] of Object.entries(phantoms)) console.log(`phantoms (${name}):`, list.map((p) => `${p.key} det ${new Date(p.det).toLocaleTimeString('en-CA', { timeZone: 'America/Vancouver', hour12: false })}`).join('; '))
