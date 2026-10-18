// Write-up: docs/experiments/2026-10-17-lineup-seasonal-drift.md
// Lineup classifier by solar elevation band: v4 errors per band, night-frame
// luminance per week (IR mode?), and CV of elevation-gated models vs one model.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const SCRATCH = join(REPO, 'training-data/experiments/cache')
const { FEATURE_LENGTH } = await import(REPO + '/functions/lib/lineup-features.js')
const { isDarkAt, solarElevation } = await import(REPO + '/functions/lib/daylight.js')
const DATA = join(REPO, 'training-data')
const paths = JSON.parse(readFileSync(join(SCRATCH, 'features-index.json'), 'utf8'))
const bin = readFileSync(join(SCRATCH, 'features.bin'))
const idx = new Map(paths.map((p, i) => [p, i]))
const samples = []
for (const line of readFileSync(join(DATA, 'manifest.csv'), 'utf8').trim().split('\n').slice(1)) {
  const [path, sailingKey, ts, label] = line.split(',')
  if (!idx.has(path)) continue
  const i = idx.get(path)
  const f = Float32Array.from(bin.subarray(i * FEATURE_LENGTH, (i + 1) * FEATURE_LENGTH), (v) => v / 255)
  let lum = 0; for (let k = 0; k < FEATURE_LENGTH; k++) lum += f[k]; lum /= FEATURE_LENGTH
  samples.push({ path, sailingKey, ts: Number(ts), date: sailingKey.slice(0, 10), y: label === '0' ? 0 : label === '1' ? 1 : null,
    dark: isDarkAt(Number(ts)), elev: solarElevation(Number(ts)), lum, features: f })
}
const isoWeek = (d) => { const dt = new Date(d + 'T12:00:00Z'); const day = (dt.getUTCDay() + 6) % 7; dt.setUTCDate(dt.getUTCDate() - day + 3); const y1 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4)); const wk = 1 + Math.round(((dt - y1) / 864e5 - 3 + ((y1.getUTCDay() + 6) % 7)) / 7); return `W${String(wk).padStart(2, '0')}` }
const hourVan = (ts) => new Date(ts).toLocaleString('en-CA', { timeZone: 'America/Vancouver', hour: '2-digit', hour12: false })
const band = (e) => (e < -7 ? 'a <-7 dark' : e < 0 ? 'b -7..0 twilight' : e < 8 ? 'c 0..8' : e < 15 ? 'd 8..15' : e < 25 ? 'e 15..25' : e < 35 ? 'f 25..35' : 'g 35+')
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN }

// --- night frames: luminance per week (black vs IR) ---
console.log('== dark frames (elev < -7): count, median luminance, p10, p90 per week — all frames incl. unlabeled')
const byW = new Map()
for (const s of samples.filter((s) => s.dark)) { if (!byW.has(isoWeek(s.date))) byW.set(isoWeek(s.date), []); byW.get(isoWeek(s.date)).push(s.lum) }
for (const [w, l] of [...byW].sort()) { const s = [...l].sort((a, b) => a - b); console.log(`${w} n=${String(l.length).padStart(4)} med=${med(l).toFixed(3)} p10=${s[Math.floor(s.length * 0.1)].toFixed(3)} p90=${s[Math.floor(s.length * 0.9)].toFixed(3)}`) }
console.log('\n== twilight frames (-7..0): median luminance per week')
const byW2 = new Map()
for (const s of samples.filter((s) => s.elev >= -7 && s.elev < 0)) { if (!byW2.has(isoWeek(s.date))) byW2.set(isoWeek(s.date), []); byW2.get(isoWeek(s.date)).push(s) }
for (const [w, l] of [...byW2].sort()) console.log(`${w} n=${String(l.length).padStart(4)} med=${med(l.map((s) => s.lum)).toFixed(3)} labeled=${l.filter((s) => s.y != null).length} pos=${l.filter((s) => s.y === 1).length}`)

// --- v4 by band ---
const sigmoid = (z) => 1 / (1 + Math.exp(-z))
const scorer = (m) => (f) => { let z = m.bias; for (let i = 0; i < FEATURE_LENGTH; i++) z += m.weights[i] * f[i]; return sigmoid(z) }
const v4 = JSON.parse(readFileSync(join(REPO, 'functions/models/lineup-classifier.json'), 'utf8'))
const r3 = (n, d) => (d ? (n / d).toFixed(3) : '  -  ')
function table(title, rows, score, th = 0.7) {
  console.log(`\n== ${title}`)
  console.log('band              n    pos   P     R     acc   fp  fn  medLum')
  const bands = [...new Set(rows.map((s) => band(s.elev)))].sort()
  for (const b of bands) {
    const set = rows.filter((s) => band(s.elev) === b)
    let tp = 0, fp = 0, fn = 0, tn = 0
    for (const s of set) { const yh = score(s.features) >= th ? 1 : 0; if (yh && s.y) tp++; else if (yh && !s.y) fp++; else if (!yh && s.y) fn++; else tn++ }
    console.log(`${b.padEnd(17)} ${String(set.length).padStart(4)} ${String(tp + fn).padStart(5)}   ${r3(tp, tp + fp)} ${r3(tp, tp + fn)} ${r3(tp + tn, set.length)} ${String(fp).padStart(3)} ${String(fn).padStart(3)}  ${med(set.map((s) => s.lum)).toFixed(3)}`)
  }
}
const labeledAll = samples.filter((s) => s.y != null)
table('shipped v4 — SUMMER labeled frames (mostly in-sample), incl. dark', labeledAll.filter((s) => s.date < '2026-09-06'), scorer(v4))
table('shipped v4 — AUTUMN labeled frames (out-of-sample), incl. dark', labeledAll.filter((s) => s.date >= '2026-09-06'), scorer(v4))
// autumn FN by hour vs elevation: are afternoon misses low-sun?
{
  const fns = labeledAll.filter((s) => s.date >= '2026-09-06' && !s.dark && s.y === 1 && scorer(v4)(s.features) < 0.7)
  const all1 = labeledAll.filter((s) => s.date >= '2026-09-06' && !s.dark && s.y === 1)
  console.log('\nautumn positives: miss rate by hour (Vancouver):')
  const h = {}; for (const s of all1) { const k = hourVan(s.ts); h[k] ??= { n: 0, fn: 0, elev: [] }; h[k].n++; h[k].elev.push(s.elev) }
  for (const s of fns) h[hourVan(s.ts)].fn++
  console.log(Object.entries(h).sort().map(([k, v]) => `${k}h n=${v.n} miss=${v.fn} (${(100 * v.fn / v.n).toFixed(0)}%) elev~${med(v.elev).toFixed(0)}`).join('\n'))
}

// --- CV: one model vs elevation-gated models (daylight frames only) ---
function trainLR(set, weights, { epochs = 1000, lr = 0.1, l2 = 1e-4 } = {}) {
  const w = new Float64Array(FEATURE_LENGTH); let b = 0; const wsum = weights.reduce((a, x) => a + x, 0)
  for (let e = 0; e < epochs; e++) {
    const gw = new Float64Array(FEATURE_LENGTH); let gb = 0
    for (let j = 0; j < set.length; j++) { const s = set[j]; let z = b; const f = s.features; for (let i = 0; i < FEATURE_LENGTH; i++) z += w[i] * f[i]; const err = (sigmoid(z) - s.y) * weights[j]; for (let i = 0; i < FEATURE_LENGTH; i++) gw[i] += err * f[i]; gb += err }
    for (let i = 0; i < FEATURE_LENGTH; i++) w[i] -= lr * (gw[i] / wsum + l2 * w[i]); b -= lr * (gb / wsum)
  }
  return { weights: w, bias: b }
}
const newest = samples.map((s) => s.date).sort().at(-1)
const ageDays = (s) => (new Date(newest) - new Date(s.date)) / 864e5
const decay = (s) => 1 + 3 * Math.exp(-ageDays(s) / 21)
const labeled = samples.filter((s) => s.y != null && !s.dark)
const fold = (key) => createHash('md5').update(key).digest()[0] % 5
// gates: low sun (<15°) vs high; train low model on frames <20° (overlap), high on >=10°
const GATES = {
  'one model (decay wt)': [{ test: () => true, train: () => true }],
  'gated 2: <15 / >=15 (overlap 10-20)': [{ test: (e) => e < 15, train: (e) => e < 20 }, { test: (e) => e >= 15, train: (e) => e >= 10 }],
  'gated 2: <8 / >=8 (overlap 4-12)': [{ test: (e) => e < 8, train: (e) => e < 12 }, { test: (e) => e >= 8, train: (e) => e >= 4 }],
  'gated 3: <8 / 8-25 / >=25': [{ test: (e) => e < 8, train: (e) => e < 12 }, { test: (e) => e >= 8 && e < 25, train: (e) => e >= 4 && e < 30 }, { test: (e) => e >= 25, train: (e) => e >= 20 }],
}
const res = {}
for (let k = 0; k < 5; k++) {
  const train = labeled.filter((s) => fold(s.sailingKey) !== k)
  const test = labeled.filter((s) => fold(s.sailingKey) === k)
  for (const [name, gates] of Object.entries(GATES)) {
    res[name] ??= {}
    const models = gates.map((g) => { const set = train.filter((s) => g.train(s.elev)); return { g, sc: scorer(trainLR(set, set.map(decay))) } })
    for (const s of test) {
      const m = models.find((m) => m.g.test(s.elev))
      const yh = m.sc(s.features) >= 0.7 ? 1 : 0
      const b = band(s.elev); res[name][b] ??= { tp: 0, fp: 0, fn: 0, n: 0 }; const r = res[name][b]; r.n++
      if (yh && s.y) r.tp++; else if (yh && !s.y) r.fp++; else if (!yh && s.y) r.fn++
    }
  }
  console.error(`fold ${k} done`)
}
console.log('\n== 5-fold CV, held-out frame metrics per elevation band (daylight frames, decay recency weights)')
for (const [name, bands] of Object.entries(res)) {
  console.log(name)
  let T = { tp: 0, fp: 0, fn: 0, n: 0 }
  for (const [b, r] of Object.entries(bands).sort()) { console.log(`   ${b.padEnd(17)} n=${String(r.n).padStart(4)} P=${r3(r.tp, r.tp + r.fp)} R=${r3(r.tp, r.tp + r.fn)} fp=${String(r.fp).padStart(3)} fn=${String(r.fn).padStart(3)}`); T.tp += r.tp; T.fp += r.fp; T.fn += r.fn; T.n += r.n }
  console.log(`   ${'ALL'.padEnd(17)} n=${T.n} P=${r3(T.tp, T.tp + T.fp)} R=${r3(T.tp, T.tp + T.fn)} fp=${T.fp} fn=${T.fn}`)
}
