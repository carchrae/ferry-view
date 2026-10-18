// Write-up: docs/experiments/2026-10-17-lineup-seasonal-drift.md
// 5-fold CV by sailing: trainer default vs recency-weighted training.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const SCRATCH = join(REPO, 'training-data/experiments/cache')
const { FEATURE_LENGTH } = await import(REPO + '/functions/lib/lineup-features.js')
const { isDarkAt } = await import(REPO + '/functions/lib/daylight.js')
const { effectiveCrosswalk, firstSustainedPositiveTs } = await import(REPO + '/functions/lib/lineup-labels.js')
const DATA = join(REPO, 'training-data')
const SPLIT_DATE = '2026-09-06'
const paths = JSON.parse(readFileSync(join(SCRATCH, 'features-index.json'), 'utf8'))
const bin = readFileSync(join(SCRATCH, 'features.bin'))
const idx = new Map(paths.map((p, i) => [p, i]))
const samples = []
for (const line of readFileSync(join(DATA, 'manifest.csv'), 'utf8').trim().split('\n').slice(1)) {
  const [path, sailingKey, ts, label, crosswalkAt] = line.split(',')
  if (!idx.has(path)) continue
  const i = idx.get(path)
  samples.push({ path, sailingKey, ts: Number(ts), date: sailingKey.slice(0, 10), crosswalkAt: crosswalkAt ? Number(crosswalkAt) : null,
    y: label === '0' ? 0 : label === '1' ? 1 : null, dark: isDarkAt(Number(ts)),
    features: Float32Array.from(bin.subarray(i * FEATURE_LENGTH, (i + 1) * FEATURE_LENGTH), (v) => v / 255) })
}
const newest = samples.map((s) => s.date).sort().at(-1)
const ageDays = (s) => (new Date(newest) - new Date(s.date)) / 864e5
const labeled = samples.filter((s) => s.y != null && !s.dark)
const sigmoid = (z) => 1 / (1 + Math.exp(-z))
const scorer = (m) => (f) => { let z = m.bias; for (let i = 0; i < FEATURE_LENGTH; i++) z += m.weights[i] * f[i]; return sigmoid(z) }
const refuted = new Set()
{ const byKey = new Map(); for (const r of JSON.parse(readFileSync(join(DATA, 'lineup-reports.json'), 'utf8'))) { if (r.deleted) continue; if (!byKey.has(r.sailingKey)) byKey.set(r.sailingKey, []); byKey.get(r.sailingKey).push(r) }
  for (const [k, l] of byKey) if (effectiveCrosswalk(l)?.notYet) refuted.add(k) }
const groups = new Map()
for (const s of samples) { if (!groups.has(s.sailingKey)) groups.set(s.sailingKey, []); groups.get(s.sailingKey).push(s) }
for (const g of groups.values()) g.sort((a, b) => a.ts - b.ts)
const SEQ_COSTS = { phantom: 10, early30: 6, early10: 2, late10: 1, late30: 2, missed: 2 }
function severity(keys, score, th) {
  const c = { phantom: 0, early30: 0, early10: 0, agree: 0, late10: 0, late30: 0, missed: 0, unknown: 0 }
  for (const key of keys) {
    const frames = groups.get(key); const lit = frames.filter((f) => !f.dark); if (lit.length < 2) continue
    const det = firstSustainedPositiveTs(lit.map((f) => ({ ts: f.ts, positive: score(f.features) >= th })))
    const human = frames[0].crosswalkAt
    if (det == null) { if (human != null) c.missed++; continue }
    if (human == null) { if (refuted.has(key)) c.phantom++; else c.unknown++; continue }
    const d = (det - human) / 60000
    if (d <= -30) c.early30++; else if (d <= -10) c.early10++; else if (d < 10) c.agree++; else if (d < 30) c.late10++; else c.late30++
  }
  c.cost = Object.entries(SEQ_COSTS).reduce((a, [k, w]) => a + w * c[k], 0)
  return c
}
function frameCounts(set, score, th) { let tp = 0, fp = 0, fn = 0; for (const s of set) { const yh = score(s.features) >= th ? 1 : 0; if (yh && s.y) tp++; else if (yh && !s.y) fp++; else if (!yh && s.y) fn++ } return { tp, fp, fn } }
function trainLR(set, weights, { epochs = 1000, lr = 0.1, l2 = 1e-4 } = {}) {
  const w = new Float64Array(FEATURE_LENGTH); let b = 0; const wsum = weights.reduce((a, x) => a + x, 0)
  for (let e = 0; e < epochs; e++) {
    const gw = new Float64Array(FEATURE_LENGTH); let gb = 0
    for (let j = 0; j < set.length; j++) { const s = set[j]; let z = b; const f = s.features; for (let i = 0; i < FEATURE_LENGTH; i++) z += w[i] * f[i]; const err = (sigmoid(z) - s.y) * weights[j]; for (let i = 0; i < FEATURE_LENGTH; i++) gw[i] += err * f[i]; gb += err }
    for (let i = 0; i < FEATURE_LENGTH; i++) w[i] -= lr * (gw[i] / wsum + l2 * w[i]); b -= lr * (gb / wsum)
  }
  return { weights: w, bias: b }
}
const variants = {
  'default (w=1)': () => 1,
  'autumn x2': (s) => (s.date >= SPLIT_DATE ? 2 : 1),
  'autumn x3': (s) => (s.date >= SPLIT_DATE ? 3 : 1),
  'autumn x5': (s) => (s.date >= SPLIT_DATE ? 5 : 1),
  'last 28d x3': (s) => (ageDays(s) <= 28 ? 3 : 1),
  'last 42d x3': (s) => (ageDays(s) <= 42 ? 3 : 1),
  'last 42d x3 + 14d x5': (s) => (ageDays(s) <= 14 ? 5 : ageDays(s) <= 42 ? 3 : 1),
  'decay 1+3e^(-age/21)': (s) => 1 + 3 * Math.exp(-ageDays(s) / 21),
}
const TH = 0.7
const fold = (key) => createHash('md5').update(key).digest()[0] % 5
const tot = {}
for (const name of Object.keys(variants)) tot[name] = { summer: { tp: 0, fp: 0, fn: 0, cost: 0, agree: 0, missed: 0, phantom: 0 }, autumn: { tp: 0, fp: 0, fn: 0, cost: 0, agree: 0, missed: 0, phantom: 0 } }
for (let k = 0; k < 5; k++) {
  const train = labeled.filter((s) => fold(s.sailingKey) !== k)
  const test = labeled.filter((s) => fold(s.sailingKey) === k)
  const testKeys = [...groups.keys()].filter((key) => fold(key) === k)
  for (const [name, wf] of Object.entries(variants)) {
    const m = trainLR(train, train.map(wf)); const sc = scorer(m)
    for (const p of ['summer', 'autumn']) {
      const inP = (d) => (d >= SPLIT_DATE) === (p === 'autumn')
      const fc = frameCounts(test.filter((s) => inP(s.date)), sc, TH)
      const sv = severity(testKeys.filter((key) => inP(key.slice(0, 10))), sc, TH)
      const t = tot[name][p]; t.tp += fc.tp; t.fp += fc.fp; t.fn += fc.fn; t.cost += sv.cost; t.agree += sv.agree; t.missed += sv.missed; t.phantom += sv.phantom
    }
  }
  console.error(`fold ${k} done`)
}
const r3 = (n, d) => (d ? (n / d).toFixed(3) : '-')
console.log(`\n5-fold CV by sailing, ${labeled.length} labeled daylight frames (autumn = since ${SPLIT_DATE}; newest frame ${newest})`)
console.log('variant'.padEnd(24), '| summer  P     R     cost agree miss phant', '| autumn  P     R     cost agree miss phant', '| total cost')
for (const [name, t] of Object.entries(tot)) {
  const s = t.summer, a = t.autumn
  console.log(name.padEnd(24), `|         ${r3(s.tp, s.tp + s.fp)} ${r3(s.tp, s.tp + s.fn)} ${String(s.cost).padStart(4)} ${String(s.agree).padStart(5)} ${String(s.missed).padStart(4)} ${String(s.phantom).padStart(5)}`,
    `|         ${r3(a.tp, a.tp + a.fp)} ${r3(a.tp, a.tp + a.fn)} ${String(a.cost).padStart(4)} ${String(a.agree).padStart(5)} ${String(a.missed).padStart(4)} ${String(a.phantom).padStart(5)}`, `| ${s.cost + a.cost}`)
}
