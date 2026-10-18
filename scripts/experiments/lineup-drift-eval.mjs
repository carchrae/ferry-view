// Write-up: docs/experiments/2026-10-17-lineup-seasonal-drift.md
// Drift diagnostic for the lineup (crosswalk) classifier.
// 1) extract features for every manifest frame on disk (cached),
// 2) score shipped v4 per ISO week (frame metrics + brightness),
// 3) sequence severity per period,
// 4) train fresh candidates (all / recency-weighted / autumn-only) and
//    compare on the deterministic held-out split, split by period.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const SCRATCH = join(REPO, 'training-data/experiments/cache')
const { extractFeatures, FEATURE_LENGTH, REGIONS } = await import(REPO + '/functions/lib/lineup-features.js')
const { isDarkAt } = await import(REPO + '/functions/lib/daylight.js')
const { effectiveCrosswalk, firstSustainedPositiveTs } = await import(REPO + '/functions/lib/lineup-labels.js')

const DATA = join(REPO, 'training-data')
const SPLIT_DATE = process.argv[2] || '2026-09-06' // first autumn day (v4 trained on data to 09-05)
const lines = readFileSync(join(DATA, 'manifest.csv'), 'utf8').trim().split('\n').slice(1)

// ---- features (cached as bytes; features are exactly byte/255) ----
const cacheIdx = join(SCRATCH, 'features-index.json')
const cacheBin = join(SCRATCH, 'features.bin')
let cache = { paths: [], bin: null }
if (existsSync(cacheIdx) && existsSync(cacheBin)) {
  cache.paths = JSON.parse(readFileSync(cacheIdx, 'utf8'))
  cache.bin = readFileSync(cacheBin)
}
const cached = new Map(cache.paths.map((p, i) => [p, i]))
const samples = []
let extracted = 0
for (const line of lines) {
  const [path, sailingKey, ts, label, crosswalkAt] = line.split(',')
  const file = join(DATA, 'frames', path)
  if (!existsSync(file)) continue
  let features
  if (cached.has(path)) {
    const i = cached.get(path)
    features = Float32Array.from(cache.bin.subarray(i * FEATURE_LENGTH, (i + 1) * FEATURE_LENGTH), (v) => v / 255)
  } else {
    const bytes = readFileSync(file)
    if (!bytes.length) continue
    try { features = await extractFeatures(bytes) } catch { continue }
    extracted++
  }
  samples.push({
    path, sailingKey, ts: Number(ts), date: sailingKey.slice(0, 10),
    crosswalkAt: crosswalkAt ? Number(crosswalkAt) : null,
    y: label === '0' ? 0 : label === '1' ? 1 : null,
    dark: isDarkAt(Number(ts)), features,
  })
}
if (extracted) {
  const bin = Buffer.alloc(samples.length * FEATURE_LENGTH)
  samples.forEach((s, i) => { for (let k = 0; k < FEATURE_LENGTH; k++) bin[i * FEATURE_LENGTH + k] = Math.round(s.features[k] * 255) })
  writeFileSync(cacheBin, bin)
  writeFileSync(cacheIdx, JSON.stringify(samples.map((s) => s.path)))
}
console.log(`frames with pixels: ${samples.length} (extracted ${extracted} new)`)

const isoWeek = (d) => { const dt = new Date(d + 'T12:00:00Z'); const day = (dt.getUTCDay() + 6) % 7; dt.setUTCDate(dt.getUTCDate() - day + 3); const y1 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4)); const wk = 1 + Math.round(((dt - y1) / 864e5 - 3 + ((y1.getUTCDay() + 6) % 7)) / 7); return `${dt.getUTCFullYear()}-W${String(wk).padStart(2, '0')}` }
const period = (s) => (s.date >= SPLIT_DATE ? 'autumn' : 'summer')
const sigmoid = (z) => 1 / (1 + Math.exp(-z))
const scorer = (m) => (f) => { let z = m.bias || 0; for (let i = 0; i < FEATURE_LENGTH; i++) z += m.weights[i] * f[i]; return sigmoid(z) }
const r3 = (n, d) => (d ? Math.round((n / d) * 1000) / 1000 : null)
function frameMetrics(set, score, th) {
  let tp = 0, fp = 0, fn = 0, tn = 0
  for (const s of set) { const yh = score(s.features) >= th ? 1 : 0; if (yh && s.y) tp++; else if (yh && !s.y) fp++; else if (!yh && s.y) fn++; else tn++ }
  return { n: set.length, pos: tp + fn, P: r3(tp, tp + fp), R: r3(tp, tp + fn), acc: r3(tp + tn, set.length), fp, fn }
}
const labeled = samples.filter((s) => s.y != null && !s.dark)
const isTest = (key) => createHash('md5').update(key).digest()[0] % 5 === 0

// refuted sailings (phantom detection target)
const refuted = new Set()
{ const byKey = new Map(); for (const r of JSON.parse(readFileSync(join(DATA, 'lineup-reports.json'), 'utf8'))) { if (r.deleted) continue; if (!byKey.has(r.sailingKey)) byKey.set(r.sailingKey, []); byKey.get(r.sailingKey).push(r) }
  for (const [k, l] of byKey) if (effectiveCrosswalk(l)?.notYet) refuted.add(k) }
const groups = new Map()
for (const s of samples) { if (!groups.has(s.sailingKey)) groups.set(s.sailingKey, []); groups.get(s.sailingKey).push(s) }
for (const g of groups.values()) g.sort((a, b) => a.ts - b.ts)
const SEQ_COSTS = { phantom: 10, early30: 6, early10: 2, late10: 1, late30: 2, missed: 2 }
function severity(keys, score, th) {
  const c = { phantom: 0, early30: 0, early10: 0, agree: 0, late10: 0, late30: 0, missed: 0, unknown: 0 }
  const phantoms = []
  for (const key of keys) {
    const frames = groups.get(key)
    const lit = frames.filter((f) => !f.dark)
    if (lit.length < 2) continue
    const det = firstSustainedPositiveTs(lit.map((f) => ({ ts: f.ts, positive: score(f.features) >= th })))
    const human = frames[0].crosswalkAt
    if (det == null) { if (human != null) c.missed++; continue }
    if (human == null) { if (refuted.has(key)) { c.phantom++; phantoms.push(key) } else c.unknown++; continue }
    const d = (det - human) / 60000
    if (d <= -30) c.early30++; else if (d <= -10) c.early10++; else if (d < 10) c.agree++; else if (d < 30) c.late10++; else c.late30++
  }
  const cost = Object.entries(SEQ_COSTS).reduce((a, [k, w]) => a + w * c[k], 0)
  return { ...c, cost, phantoms }
}
const fmt = (o) => Object.entries(o).filter(([k]) => k !== 'phantoms').map(([k, v]) => `${k}=${v}`).join(' ')

// ---- 2) shipped v4 per week ----
const v4 = JSON.parse(readFileSync(join(REPO, 'functions/models/lineup-classifier.json'), 'utf8'))
const s4 = scorer(v4)
console.log(`\n== shipped v${v4.version} (trained ${v4.trainedAt.slice(0, 10)}, data to ${v4.dataset.to}) — labeled daylight frames per ISO week`)
console.log('week      n   pos   P      R      acc    fp  fn  meanLum  darkLabeled')
const weeks = [...new Set(labeled.map((s) => isoWeek(s.date)))].sort()
for (const w of weeks) {
  const set = labeled.filter((s) => isoWeek(s.date) === w)
  const m = frameMetrics(set, s4, v4.threshold)
  const lum = set.reduce((a, s) => a + s.features.reduce((x, y) => x + y, 0) / FEATURE_LENGTH, 0) / set.length
  const dl = samples.filter((s) => s.y != null && s.dark && isoWeek(s.date) === w).length
  console.log(`${w}  ${String(m.n).padStart(4)} ${String(m.pos).padStart(5)}  ${String(m.P).padEnd(6)} ${String(m.R).padEnd(6)} ${String(m.acc).padEnd(6)} ${String(m.fp).padStart(3)} ${String(m.fn).padStart(3)}  ${lum.toFixed(3)}    ${dl}`)
}
for (const p of ['summer', 'autumn']) {
  const set = labeled.filter((s) => period(s) === p)
  console.log(`v4 ${p} (all labeled):`, fmt(frameMetrics(set, s4, v4.threshold)))
  console.log(`v4 ${p} (held-out split only):`, fmt(frameMetrics(set.filter((s) => isTest(s.sailingKey)), s4, v4.threshold)))
  const keys = [...groups.keys()].filter((k) => (k.slice(0, 10) >= SPLIT_DATE) === (p === 'autumn'))
  const sev = severity(keys, s4, v4.threshold)
  console.log(`v4 ${p} sequence (all sailings):`, fmt(sev))
  if (sev.phantoms.length) console.log('   phantoms:', sev.phantoms.join(', '))
}
// v4 false positives in autumn: by hour of day
{
  const fps = labeled.filter((s) => period(s) === 'autumn' && s.y === 0 && s4(s.features) >= v4.threshold)
  const fns = labeled.filter((s) => period(s) === 'autumn' && s.y === 1 && s4(s.features) < v4.threshold)
  const byHour = (arr) => { const h = {}; for (const s of arr) { const hr = new Date(s.ts).toLocaleString('en-CA', { timeZone: 'America/Vancouver', hour: '2-digit', hour12: false }); h[hr] = (h[hr] || 0) + 1 } return Object.entries(h).sort().map(([k, v]) => `${k}h:${v}`).join(' ') }
  console.log(`v4 autumn FP by hour: ${byHour(fps)}`)
  console.log(`v4 autumn FN by hour: ${byHour(fns)}`)
  const lumAll = (arr) => arr.length ? (arr.reduce((a, s) => a + s.features.reduce((x, y) => x + y, 0) / FEATURE_LENGTH, 0) / arr.length).toFixed(3) : '-'
  console.log(`mean luminance — autumn FP frames ${lumAll(fps)}, autumn FN frames ${lumAll(fns)}, autumn all ${lumAll(labeled.filter((s) => period(s) === 'autumn'))}, summer all ${lumAll(labeled.filter((s) => period(s) === 'summer'))}`)
}

// ---- 4) fresh candidates ----
function trainLR(set, weights, { epochs = 1000, lr = 0.1, l2 = 1e-4 } = {}) {
  const w = new Float64Array(FEATURE_LENGTH); let b = 0
  const wsum = weights.reduce((a, x) => a + x, 0)
  for (let e = 0; e < epochs; e++) {
    const gw = new Float64Array(FEATURE_LENGTH); let gb = 0
    for (let j = 0; j < set.length; j++) {
      const s = set[j]; let z = b; const f = s.features
      for (let i = 0; i < FEATURE_LENGTH; i++) z += w[i] * f[i]
      const err = (sigmoid(z) - s.y) * weights[j]
      for (let i = 0; i < FEATURE_LENGTH; i++) gw[i] += err * f[i]
      gb += err
    }
    for (let i = 0; i < FEATURE_LENGTH; i++) w[i] -= lr * (gw[i] / wsum + l2 * w[i])
    b -= lr * (gb / wsum)
  }
  return { weights: Array.from(w), bias: b, threshold: 0.7 }
}
const train = labeled.filter((s) => !isTest(s.sailingKey))
const test = labeled.filter((s) => isTest(s.sailingKey))
const testKeys = [...groups.keys()].filter(isTest)
const variants = {
  'all data (trainer default)': { set: train, w: train.map(() => 1) },
  'all data, autumn x3': { set: train, w: train.map((s) => (period(s) === 'autumn' ? 3 : 1)) },
  'autumn only': { set: train.filter((s) => period(s) === 'autumn'), w: train.filter((s) => period(s) === 'autumn').map(() => 1) },
}
const report = (label, m) => {
  const sc = scorer(m)
  const out = [label.padEnd(30)]
  for (const p of ['summer', 'autumn']) {
    const fm = frameMetrics(test.filter((s) => period(s) === p), sc, m.threshold)
    const sev = severity(testKeys.filter((k) => (k.slice(0, 10) >= SPLIT_DATE) === (p === 'autumn')), sc, m.threshold)
    out.push(`${p}: P=${fm.P} R=${fm.R} fp=${fm.fp} fn=${fm.fn} | seq cost=${sev.cost} agree=${sev.agree} missed=${sev.missed} phantom=${sev.phantom} early30=${sev.early30}`)
  }
  const fm = frameMetrics(test, sc, m.threshold)
  const sev = severity(testKeys, sc, m.threshold)
  out.push(`ALL: P=${fm.P} R=${fm.R} | seq cost=${sev.cost}`)
  console.log(out.join('\n    '))
}
console.log(`\n== held-out split (by sailing): test frames summer=${test.filter((s) => period(s) === 'summer').length} autumn=${test.filter((s) => period(s) === 'autumn').length}; train frames ${train.length} (autumn ${train.filter((s) => period(s) === 'autumn').length})`)
report(`shipped v${v4.version}`, v4)
for (const [label, v] of Object.entries(variants)) {
  const t0 = Date.now()
  const m = trainLR(v.set, v.w)
  report(`${label} [${((Date.now() - t0) / 1000).toFixed(0)}s]`, m)
  writeFileSync(join(SCRATCH, `cand-${label.replace(/[^a-z0-9]+/gi, '-')}.json`), JSON.stringify(m))
}
