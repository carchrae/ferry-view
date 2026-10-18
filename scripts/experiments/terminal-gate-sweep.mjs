// NOTE: run 2026-10-17 on the BRIGHTNESS feature set (per-cell brightness minus
// the frame mean, models v1–v8). terminal-features.js now extracts localStd-v1
// texture, so a fresh cache would measure a different thing; the cached
// training-data/experiments/cache/terminal-features.json holds the brightness
// features this write-up used. Write-up: docs/experiments/2026-10-17-terminal-daylight-bands.md
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
  rows.push({ sailingKey, y: Number(label), elev: solarElevation(Number(ts)), features: Float32Array.from(cache[path], (v) => v / 255) })
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
const fold = (k) => createHash('md5').update(k).digest()[0] % 5
// each config: gate elevation G, low model trains on elev < G+ov, high on elev >= G-ov
const configs = []
for (const G of [0, 4, 8, 12]) for (const ov of [3, 6, 10]) configs.push({ name: `gate ${G}° overlap ±${ov}`, G, ov })
configs.unshift({ name: 'one model', G: null })
const out = {}
for (let k = 0; k < 5; k++) {
  const train = rows.filter((s) => fold(s.sailingKey) !== k), test = rows.filter((s) => fold(s.sailingKey) === k)
  for (const c of configs) {
    const o = (out[c.name] ??= { low: { tp: 0, fp: 0, fn: 0, n: 0 }, high: { tp: 0, fp: 0, fn: 0, n: 0 } })
    let lo, hi
    if (c.G == null) { lo = hi = trainLR(train) } else { lo = trainLR(train.filter((s) => s.elev < c.G + c.ov)); hi = trainLR(train.filter((s) => s.elev >= c.G - c.ov)) }
    for (const s of test) {
      const isLow = s.elev < (c.G ?? 8)
      const yh = (isLow ? lo : hi)(s.features) >= 0.5 ? 1 : 0
      const r = o[isLow ? 'low' : 'high']; r.n++
      if (yh && s.y) r.tp++; else if (yh && !s.y) r.fp++; else if (!yh && s.y) r.fn++
    }
  }
  console.error('fold', k)
}
const f = (r) => { const P = r.tp / (r.tp + r.fp), R = r.tp / (r.tp + r.fn); return `P=${P.toFixed(3)} R=${R.toFixed(3)} fp=${String(r.fp).padStart(3)} fn=${String(r.fn).padStart(3)} n=${r.n}` }
console.log('terminal: gate position sweep (5-fold CV). low = frames below the gate (for "one model", below 8°)')
for (const [name, o] of Object.entries(out)) {
  const T = { tp: o.low.tp + o.high.tp, fp: o.low.fp + o.high.fp, fn: o.low.fn + o.high.fn, n: o.low.n + o.high.n }
  const P = T.tp / (T.tp + T.fp), R = T.tp / (T.tp + T.fn)
  console.log(`${name.padEnd(22)} low: ${f(o.low)} | high: ${f(o.high)} | ALL F1=${((2 * P * R) / (P + R)).toFixed(3)} fp=${T.fp} fn=${T.fn}`)
}
