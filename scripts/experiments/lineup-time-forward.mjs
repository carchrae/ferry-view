// Crosswalk model, time-forward: the trainer's recipe (recency-weighted
// logistic regression, lr 0.1, 1000 epochs, L2 1e-4, threshold 0.7) trained
// on every labelled daylight frame BEFORE a cutoff, scored on every frame
// from the cutoff on — per ISO week accuracy and the sequence severity. The
// whole-archive report cannot tell "better" from "seasonal" for a version
// trained on the weeks it is scored on; this can. Features from the
// lineup-drift-eval cache. Write-up: docs/experiments/2026-10-18-model-history-report.md
//   node scripts/experiments/lineup-time-forward.mjs [--cutoffs 2026-09-06,2026-10-01] [--recent-boost 3]
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FEATURE_LENGTH } from '../../functions/lib/lineup-features.js'
import { isDarkAt } from '../../functions/lib/daylight.js'
import { effectiveCrosswalk, firstSustainedPositiveTs } from '../../functions/lib/lineup-labels.js'
const ROOT = join(import.meta.dirname, '../..'), DATA = join(ROOT, 'training-data'), CACHE = join(DATA, 'experiments/cache')
const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d }
const CUTOFFS = flag('cutoffs', '2026-09-06,2026-10-01').split(',')
const BOOST = Number(flag('recent-boost', '3')), SCALE = 21, EPOCHS = Number(flag('epochs', '1000')), LR = 0.1, L2 = 1e-4, TH = 0.7
const idx = JSON.parse(readFileSync(join(CACHE, 'features-index.json'), 'utf8')), bin = readFileSync(join(CACHE, 'features.bin'))
const pos = new Map(idx.map((p, i) => [p, i]))
const rows = readFileSync(join(DATA, 'manifest.csv'), 'utf8').trim().split('\n').slice(1).map((l) => { const [path, sailingKey, ts, label, crosswalkAt] = l.split(','); return { path, sailingKey, ts: Number(ts), y: label === '0' ? 0 : label === '1' ? 1 : null, crosswalkAt: crosswalkAt ? Number(crosswalkAt) : null } }).filter((r) => pos.has(r.path))
for (const f of rows) { f.dark = isDarkAt(f.ts); f.x = Float32Array.from(bin.subarray(pos.get(f.path) * FEATURE_LENGTH, (pos.get(f.path) + 1) * FEATURE_LENGTH), (v) => v / 255) }
const isoWeek = (ts) => { const dt = new Date(ts); const day = (dt.getUTCDay() + 6) % 7; dt.setUTCDate(dt.getUTCDate() - day + 3); const y1 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4)); const wk = 1 + Math.round(((dt - y1) / 864e5 - 3 + ((y1.getUTCDay() + 6) % 7)) / 7); return `${dt.getUTCFullYear()}-W${String(wk).padStart(2, '0')}` }
const sig = (z) => 1 / (1 + Math.exp(-z))
function train(set) {
  const newest = Math.max(...set.map((s) => s.ts))
  const wts = set.map((s) => (BOOST > 0 ? 1 + BOOST * Math.exp(-((newest - s.ts) / 864e5) / SCALE) : 1))
  const wsum = wts.reduce((a, b) => a + b, 0)
  const w = new Float64Array(FEATURE_LENGTH); let b = 0
  for (let e = 0; e < EPOCHS; e++) {
    const gw = new Float64Array(FEATURE_LENGTH); let gb = 0
    for (let j = 0; j < set.length; j++) { const s = set[j]; let z = b; for (let i = 0; i < FEATURE_LENGTH; i++) z += w[i] * s.x[i]; const err = (sig(z) - s.y) * wts[j]; for (let i = 0; i < FEATURE_LENGTH; i++) gw[i] += err * s.x[i]; gb += err }
    for (let i = 0; i < FEATURE_LENGTH; i++) w[i] -= LR * (gw[i] / wsum + L2 * w[i]); b -= LR * (gb / wsum)
  }
  return (x) => { let z = b; for (let i = 0; i < FEATURE_LENGTH; i++) z += w[i] * x[i]; return sig(z) }
}
const refuted = new Set()
{ const byKey = new Map(); for (const r of JSON.parse(readFileSync(join(DATA, 'lineup-reports.json'), 'utf8'))) { if (r.deleted) continue; if (!byKey.has(r.sailingKey)) byKey.set(r.sailingKey, []); byKey.get(r.sailingKey).push(r) } for (const [k, l] of byKey) if (effectiveCrosswalk(l)?.notYet) refuted.add(k) }
const SEQ = { phantom: 10, early30: 6, early10: 2, late10: 1, late30: 2, missed: 2 }
const out = {}
for (const cut of CUTOFFS) {
  const t0 = Date.parse(cut + 'T00:00:00-07:00')
  const trainSet = rows.filter((f) => f.y != null && !f.dark && f.ts < t0)
  const evalFrames = rows.filter((f) => f.ts >= t0)
  const t = Date.now(); const predict = train(trainSet)
  for (const f of evalFrames) f.p = predict(f.x)
  const labeled = evalFrames.filter((f) => f.y != null && !f.dark)
  const weeks = [...new Set(labeled.map((f) => isoWeek(f.ts)))].sort()
  console.log(`\n=== trained on ${trainSet.length} labelled daylight frames before ${cut} (${((Date.now() - t) / 1000).toFixed(0)}s); scored on ${labeled.length} labelled frames after ===`)
  console.log('week      n    acc    P      R')
  const res = { trainFrames: trainSet.length, weeks: {} }
  for (const w of weeks) {
    const set = labeled.filter((f) => isoWeek(f.ts) === w); let tp = 0, fp = 0, fn = 0, tn = 0
    for (const s of set) { const yh = s.p >= TH ? 1 : 0; if (yh && s.y) tp++; else if (yh && !s.y) fp++; else if (!yh && s.y) fn++; else tn++ }
    res.weeks[w] = { n: set.length, acc: (tp + tn) / set.length, P: tp / (tp + fp || 1), R: tp / (tp + fn || 1) }
    console.log(`${w}  ${String(set.length).padStart(4)}  ${res.weeks[w].acc.toFixed(3)}  ${res.weeks[w].P.toFixed(3)}  ${res.weeks[w].R.toFixed(3)}`)
  }
  let tp = 0, fp = 0, fn = 0, tn = 0; for (const s of labeled) { const yh = s.p >= TH ? 1 : 0; if (yh && s.y) tp++; else if (yh && !s.y) fp++; else if (!yh && s.y) fn++; else tn++ }
  res.all = { n: labeled.length, acc: (tp + tn) / labeled.length, P: tp / (tp + fp || 1), R: tp / (tp + fn || 1) }
  // sequence severity on sailings after the cutoff
  const groups = new Map(); for (const f of evalFrames) { if (!groups.has(f.sailingKey)) groups.set(f.sailingKey, []); groups.get(f.sailingKey).push(f) }
  const c = { phantom: 0, early30: 0, early10: 0, agree: 0, late10: 0, late30: 0, missed: 0, unknown: 0, sailings: 0 }
  for (const [key, fr] of groups) { fr.sort((a, b) => a.ts - b.ts); const lit = fr.filter((f) => !f.dark); if (lit.length < 2) continue; c.sailings++
    const det = firstSustainedPositiveTs(lit.map((f) => ({ ts: f.ts, positive: f.p >= TH }))); const human = fr[0].crosswalkAt
    if (det == null) { if (human != null) c.missed++; continue } if (human == null) { if (refuted.has(key)) c.phantom++; else c.unknown++; continue }
    const d = (det - human) / 60000; if (d <= -30) c.early30++; else if (d <= -10) c.early10++; else if (d < 10) c.agree++; else if (d < 30) c.late10++; else c.late30++ }
  c.cost = Object.entries(SEQ).reduce((a, [k, w]) => a + w * c[k], 0)
  res.sequence = c
  console.log(`all after cutoff: acc ${res.all.acc.toFixed(3)} P ${res.all.P.toFixed(3)} R ${res.all.R.toFixed(3)} | sequence over ${c.sailings} sailings: cost ${c.cost} agree ${c.agree} missed ${c.missed} phantom ${c.phantom} early30 ${c.early30}`)
  out[cut] = res
}
writeFileSync(join(DATA, 'experiments/lineup-time-forward.json'), JSON.stringify(out, null, 1))
