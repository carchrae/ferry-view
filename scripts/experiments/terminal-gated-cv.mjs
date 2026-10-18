// NOTE: run 2026-10-17 on the BRIGHTNESS feature set (per-cell brightness minus
// the frame mean, models v1–v8). terminal-features.js now extracts localStd-v1
// texture, so a fresh cache would measure a different thing; the cached
// training-data/experiments/cache/terminal-features.json holds the brightness
// features this write-up used. Write-up: docs/experiments/2026-10-17-terminal-daylight-bands.md
// Terminal-cars classifier 5-fold CV (by sailing): one model on all labels
// vs. an elevation-gated pair, per elevation band. Trainer hyperparams.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const SCRATCH = join(REPO, 'training-data/experiments/cache')
const { TERMINAL_FEATURE_LENGTH: N, TERMINAL_FEATURE_MASK } = await import(REPO + '/functions/lib/terminal-features.js')
const { solarElevation } = await import(REPO + '/functions/lib/daylight.js')
const cache = JSON.parse(readFileSync(join(SCRATCH, 'terminal-features.json'), 'utf8'))
const rows = []
for (const line of readFileSync(join(REPO, 'training-data/terminal-manifest.csv'), 'utf8').trim().split('\n').slice(1)) {
  const [path, sailingKey, ts, label, source] = line.split(',')
  if (!cache[path]) continue
  rows.push({ path, sailingKey, ts: Number(ts), y: Number(label), source, elev: solarElevation(Number(ts)), features: Float32Array.from(cache[path], (v) => v / 255) })
}
const sigmoid = (z) => 1 / (1 + Math.exp(-z))
function trainLR(set, { epochs = 300, lr = 0.5, l2 = 1e-4 } = {}) {
  const w = new Float64Array(N); let b = 0; const n = set.length
  for (let e = 0; e < epochs; e++) {
    const gw = new Float64Array(N); let gb = 0
    for (const s of set) { let z = b; const f = s.features; for (let i = 0; i < N; i++) z += w[i] * f[i]; const err = sigmoid(z) - s.y; for (let i = 0; i < N; i++) gw[i] += err * f[i]; gb += err }
    for (let i = 0; i < N; i++) w[i] = TERMINAL_FEATURE_MASK[i] ? w[i] - lr * (gw[i] / n + l2 * w[i]) : 0
    b -= lr * (gb / n)
  }
  return (f) => { let z = b; for (let i = 0; i < N; i++) z += w[i] * f[i]; return sigmoid(z) }
}
const band = (e) => (e < -7 ? 'a <-7 dark' : e < 0 ? 'b -7..0 twilight' : e < 8 ? 'c 0..8' : e < 15 ? 'd 8..15' : e < 25 ? 'e 15..25' : e < 35 ? 'f 25..35' : 'g 35+')
const r3 = (n, d) => (d ? (n / d).toFixed(3) : '  -  ')
const fold = (k) => createHash('md5').update(k).digest()[0] % 5
const GATES = {
  'one model, all labels': [{ test: () => true, train: () => true }],
  'one model, hand labels only (≈ shipped v5 recipe)': [{ test: () => true, train: () => true, hand: true }],
  'gated: <8° / ≥8° (overlap 3..13)': [{ test: (e) => e < 8, train: (e) => e < 13 }, { test: (e) => e >= 8, train: (e) => e >= 3 }],
  'gated 3: <-7 / -7..8 / ≥8': [{ test: (e) => e < -7, train: (e) => e < -3 }, { test: (e) => e >= -7 && e < 8, train: (e) => e >= -10 && e < 13 }, { test: (e) => e >= 8, train: (e) => e >= 3 }],
}
const res = {}
for (let k = 0; k < 5; k++) {
  const train = rows.filter((s) => fold(s.sailingKey) !== k), test = rows.filter((s) => fold(s.sailingKey) === k)
  for (const [name, gates] of Object.entries(GATES)) {
    res[name] ??= {}
    const models = gates.map((g) => ({ g, sc: trainLR(train.filter((s) => g.train(s.elev) && (!g.hand || s.source === 'hand'))) }))
    for (const s of test) {
      const yh = models.find((m) => m.g.test(s.elev)).sc(s.features) >= 0.5 ? 1 : 0
      const b = band(s.elev); const r = (res[name][b] ??= { tp: 0, fp: 0, fn: 0, n: 0 }); r.n++
      if (yh && s.y) r.tp++; else if (yh && !s.y) r.fp++; else if (!yh && s.y) r.fn++
    }
  }
  console.error(`fold ${k}`)
}
console.log(`terminal 5-fold CV by sailing on ${rows.length} labeled frames (hand+rider), held-out per band`)
for (const [name, bands] of Object.entries(res)) {
  console.log(name); const T = { tp: 0, fp: 0, fn: 0, n: 0 }
  for (const [b, r] of Object.entries(bands).sort()) { console.log(`   ${b.padEnd(17)} n=${String(r.n).padStart(4)} P=${r3(r.tp, r.tp + r.fp)} R=${r3(r.tp, r.tp + r.fn)} fp=${String(r.fp).padStart(3)} fn=${String(r.fn).padStart(3)}`); T.tp += r.tp; T.fp += r.fp; T.fn += r.fn; T.n += r.n }
  const P = T.tp / (T.tp + T.fp), R = T.tp / (T.tp + T.fn)
  console.log(`   ALL               n=${T.n} P=${P.toFixed(3)} R=${R.toFixed(3)} F1=${((2 * P * R) / (P + R)).toFixed(3)} fp=${T.fp} fn=${T.fn}`)
}
