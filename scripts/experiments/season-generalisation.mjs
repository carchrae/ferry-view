// Are we building ONE model that covers every season, or a model per season?
// (Tom, 2026-10-18: "how well does the current model perform on the earlier
// dates? are we developing a model which no longer needs to be switched to a
// previous model, or are we making models that are specific to the season.")
//
// For each camera and feature set, the trainer's own recipe is trained on one
// slice of time and scored on another, so no row is in-sample:
//   forward    train < 2026-09-01, score >= 2026-09-01   (summer → autumn)
//   backward   train >= 2026-09-01, score < 2026-09-01   (autumn → summer)
//   LOMO-<m>   train on every month but m, score on m    (interpolation at
//              Aug/Sep, extrapolation at the edges Jul/Oct)
// A feature set whose model carries both ways and interpolates well is one
// that generalises across light; one that only scores well in its training
// season is seasonal and must keep being retrained.
//
// Terminal-cars: brightness (v1–v8 recipe) and localStd-v1 texture, from the
// terminal-features-experiment caches; hand + rider labels, balanced, lr 0.2,
// 600 epochs. Crosswalk: the deployed brightness features (lineup-drift-eval
// cache) and an experimental TEXTURE set (per-cell std of the native crop,
// standardised per region, same grids) built and cached here; lr 0.1, 1000
// epochs, threshold 0.7, recency weights OFF (they measure age from the
// training set's newest frame, which is meaningless with a month held out).
//
//   node scripts/experiments/season-generalisation.mjs [--only terminal|lineup]
// Write-up: docs/experiments/2026-10-18-season-generalisation.md
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { TERMINAL_REGIONS, TERMINAL_FEATURE_MASK, TERMINAL_FEATURE_LENGTH } from '../../functions/lib/terminal-features.js'
import { standardizeRegions, cellStdGrid, regionRect } from '../../functions/lib/terminal-feature-math.js'
import { REGIONS as LINEUP_REGIONS, FEATURE_LENGTH as LINEUP_LENGTH } from '../../functions/lib/lineup-features.js'
import { isDarkAt, solarElevation } from '../../functions/lib/daylight.js'
import { terminalEmptyFrameTs, effectiveCrosswalk, firstSustainedPositiveTs } from '../../functions/lib/lineup-labels.js'

const ROOT = join(import.meta.dirname, '../..'), DATA = join(ROOT, 'training-data'), CACHE = join(DATA, 'experiments/cache')
const sharp = createRequire(join(ROOT, 'functions/package.json'))('sharp')
const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d }
const ONLY = flag('only', null)
const SPLIT = Date.parse('2026-09-01T00:00:00-07:00')
const monthOf = (ts) => new Date(ts).toLocaleString('en-CA', { timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit' }).slice(0, 7)
const sig = (z) => 1 / (1 + Math.exp(-z))
const r3 = (x) => (x == null || Number.isNaN(x) ? '—' : x.toFixed(3))
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—')
const out = {}

function trainLR(set, N, { epochs, lr, l2, balance }) {
  const w = new Float64Array(N); let b = 0
  const pos = set.filter((s) => s.y === 1).length
  const wNeg = balance ? pos / Math.max(1, set.length - pos) : 1
  const norm = set.reduce((a, s) => a + (s.y ? 1 : wNeg), 0)
  for (let e = 0; e < epochs; e++) {
    const gw = new Float64Array(N); let gb = 0
    for (const s of set) { let z = b; const x = s.x; for (let i = 0; i < N; i++) z += w[i] * x[i]; const err = (sig(z) - s.y) * (s.y ? 1 : wNeg); for (let i = 0; i < N; i++) gw[i] += err * x[i]; gb += err }
    for (let i = 0; i < N; i++) w[i] -= lr * (gw[i] / norm + l2 * w[i]); b -= lr * (gb / norm)
  }
  return (x) => { let z = b; for (let i = 0; i < N; i++) z += w[i] * x[i]; return sig(z) }
}
function frameMetrics(set, th) {
  let tp = 0, fp = 0, fn = 0, tn = 0
  for (const s of set) { const yh = s.p >= th ? 1 : 0; if (yh && s.y) tp++; else if (yh && !s.y) fp++; else if (!yh && s.y) fn++; else tn++ }
  return { n: set.length, acc: (tp + tn) / (set.length || 1), P: tp / (tp + fp || 1), R: tp / (tp + fn || 1) }
}
// The time slices: [name, isTrain(ts), isEval(ts)]
import { createHash } from 'node:crypto'
const foldOf = (key) => createHash('md5').update(key).digest()[0] % 5
// Pooled out-of-fold predictions over 5 folds by sailing: the trainer's own
// comparison, all seasons mixed, so a feature set can be judged against the
// shipped recipe's usual numbers as well as across time.
function cvPredict(rows, labeledPred, dim, opts) {
  for (const f of rows) f.fold = foldOf(f.sailingKey)
  for (const k of [0, 1, 2, 3, 4]) {
    const predict = trainLR(rows.filter((f) => labeledPred(f) && f.fold !== k), dim, opts)
    for (const f of rows) if (f.fold === k) f.p = predict(f.x)
  }
}
function slices(months) {
  const s = [
    ['forward  (summer→autumn)', (ts) => ts < SPLIT, (ts) => ts >= SPLIT],
    ['backward (autumn→summer)', (ts) => ts >= SPLIT, (ts) => ts < SPLIT],
  ]
  for (const m of months) s.push([`LOMO ${m}`, (ts) => monthOf(ts) !== m, (ts) => monthOf(ts) === m])
  return s
}

// ============================ TERMINAL ======================================
if (ONLY !== 'lineup') {
  const N = TERMINAL_FEATURE_LENGTH, STATS = 4
  const rawIdx = JSON.parse(readFileSync(join(CACHE, 'terminal-raw-index.json'), 'utf8')), rawBuf = readFileSync(join(CACHE, 'terminal-raw-coarse.u8'))
  const stIdx = JSON.parse(readFileSync(join(CACHE, 'terminal-stats-index.json'), 'utf8')), stBuf = readFileSync(join(CACHE, 'terminal-stats.u8'))
  const rows = readFileSync(join(DATA, 'terminal-manifest.csv'), 'utf8').trim().split('\n').slice(1).map((l) => { const [path, sailingKey, ts, label, source] = l.split(','); return { path, sailingKey, ts: Number(ts), y: label === '0' ? 0 : label === '1' ? 1 : null, source: source || null } }).filter((r) => rawIdx[r.path] >= 0 && stIdx[r.path] >= 0)
  const feats = {
    brightness: (f) => { const i = rawIdx[f.path]; const v = new Float32Array(N); let m = 0, k = 0; for (let c = 0; c < N; c++) { v[c] = rawBuf[i * N + c] / 255; if (TERMINAL_FEATURE_MASK[c]) { m += v[c]; k++ } } m /= k || 1; for (let c = 0; c < N; c++) v[c] = TERMINAL_FEATURE_MASK[c] ? v[c] - m : 0; return v },
    texture: (f) => { const i = stIdx[f.path]; const v = new Float32Array(N); for (let c = 0; c < N; c++) v[c] = stBuf[i * STATS * N + c] / 1020; return standardizeRegions(v, TERMINAL_REGIONS, TERMINAL_FEATURE_MASK) },
  }
  const tagBySailing = new Map()
  for (const t of JSON.parse(readFileSync(join(DATA, 'capacity-tags.json'), 'utf8'))) { if (!t.sailingKey?.endsWith('_To HSB')) continue; const prev = tagBySailing.get(t.sailingKey); if (!prev || (t.recordedAt || 0) > (prev.recordedAt || 0)) tagBySailing.set(t.sailingKey, t) }
  try { for (const k of Object.keys(JSON.parse(readFileSync(join(DATA, 'tag-corrections.json'), 'utf8')))) tagBySailing.delete(k) } catch {}
  const bySailing = new Map(); for (const f of rows) { if (!bySailing.has(f.sailingKey)) bySailing.set(f.sailingKey, []); bySailing.get(f.sailingKey).push(f) }
  for (const fr of bySailing.values()) fr.sort((a, b) => a.ts - b.ts)
  const months = [...new Set(rows.filter((r) => r.y != null).map((r) => monthOf(r.ts)))].sort()
  out.terminal = {}
  console.log(`\n######## TERMINAL-CARS — ${rows.length} frames, ${rows.filter((r) => r.y != null).length} labels (hand + rider), months ${months.join(' ')}`)
  console.log(`${'slice'.padEnd(26)} ${'features'.padEnd(11)} train  eval   acc    P      R    | room flagged  wrong  cars-to-end(room)`)
  for (const [fname, fx] of Object.entries(feats)) {
    for (const f of rows) f.x = fx(f)
    for (const [name, isTrain, isEval] of slices(months)) {
      const trainSet = rows.filter((f) => f.y != null && isTrain(f.ts))
      const evalLabeled = rows.filter((f) => f.y != null && isEval(f.ts))
      if (!trainSet.length || !evalLabeled.length) continue
      const predict = trainLR(trainSet, N, { epochs: 600, lr: 0.2, l2: 1e-4, balance: true })
      for (const f of rows) f.p = isEval(f.ts) ? predict(f.x) : undefined
      const fm = frameMetrics(evalLabeled, 0.5)
      let roomN = 0, roomFlag = 0, fullN = 0, wrong = 0, carsEnd = 0
      for (const [key, fr] of bySailing) {
        const tag = tagBySailing.get(key); if (!tag || fr.length < 2 || !isEval(fr[0].ts)) continue
        const nf = terminalEmptyFrameTs(fr.map((f) => ({ ts: f.ts, carsPresent: f.p >= 0.5 }))) != null
        const tail = fr.slice(-4); const ce = tail.length === 4 && tail.every((f) => f.p >= 0.7)
        if (tag.capacity !== 'Full') { roomN++; if (nf) roomFlag++; if (ce) carsEnd++ } else { fullN++; if (nf) wrong++ }
      }
      ;(out.terminal[fname] ??= {})[name] = { train: trainSet.length, eval: evalLabeled.length, ...fm, roomN, roomFlag, fullN, wrong, carsEnd }
      console.log(`${name.padEnd(26)} ${fname.padEnd(11)} ${String(trainSet.length).padStart(5)} ${String(evalLabeled.length).padStart(5)}  ${r3(fm.acc)}  ${r3(fm.P)}  ${r3(fm.R)} | ${pct(roomFlag, roomN).padStart(5)} of ${String(roomN).padStart(3)}  ${String(wrong).padStart(3)}    ${pct(carsEnd, roomN)}`)
    }
    {
      cvPredict(rows, (f) => f.y != null, N, { epochs: 600, lr: 0.2, l2: 1e-4, balance: true })
      const labeled = rows.filter((f) => f.y != null)
      const fm = frameMetrics(labeled, 0.5)
      let roomN = 0, roomFlag = 0, fullN = 0, wrong = 0, carsEnd = 0
      for (const [key, fr] of bySailing) {
        const tag = tagBySailing.get(key); if (!tag || fr.length < 2) continue
        const nf = terminalEmptyFrameTs(fr.map((f) => ({ ts: f.ts, carsPresent: f.p >= 0.5 }))) != null
        const tail = fr.slice(-4); const ce = tail.length === 4 && tail.every((f) => f.p >= 0.7)
        if (tag.capacity !== 'Full') { roomN++; if (nf) roomFlag++; if (ce) carsEnd++ } else { fullN++; if (nf) wrong++ }
      }
      out.terminal[fname]['5-fold CV by sailing'] = { eval: labeled.length, ...fm, roomN, roomFlag, fullN, wrong, carsEnd }
      console.log(`${'5-fold CV by sailing'.padEnd(26)} ${fname.padEnd(11)} ${'—'.padStart(5)} ${String(labeled.length).padStart(5)}  ${r3(fm.acc)}  ${r3(fm.P)}  ${r3(fm.R)} | ${pct(roomFlag, roomN).padStart(5)} of ${String(roomN).padStart(3)}  ${String(wrong).padStart(3)}    ${pct(carsEnd, roomN)}`)
    }
  }
}

// ============================ CROSSWALK =====================================
if (ONLY !== 'terminal') {
  const N = LINEUP_LENGTH
  const idx = JSON.parse(readFileSync(join(CACHE, 'features-index.json'), 'utf8')), bin = readFileSync(join(CACHE, 'features.bin'))
  const pos = new Map(idx.map((p, i) => [p, i]))
  const rows = readFileSync(join(DATA, 'manifest.csv'), 'utf8').trim().split('\n').slice(1).map((l) => { const [path, sailingKey, ts, label, crosswalkAt] = l.split(','); return { path, sailingKey, ts: Number(ts), y: label === '0' ? 0 : label === '1' ? 1 : null, crosswalkAt: crosswalkAt ? Number(crosswalkAt) : null } }).filter((r) => pos.has(r.path) && existsSync(join(DATA, 'frames', r.path)))
  for (const f of rows) f.dark = isDarkAt(f.ts)
  // texture cache: per-cell std of the native greyscale crop on the deployed grids
  const stIdxPath = join(CACHE, 'lineup-std-index.json'), stPath = join(CACHE, 'lineup-std.u8')
  let stIdx = existsSync(stIdxPath) ? JSON.parse(readFileSync(stIdxPath, 'utf8')) : {}
  let stBuf = existsSync(stPath) ? readFileSync(stPath) : Buffer.alloc(0)
  const missing = rows.filter((r) => stIdx[r.path] === undefined)
  if (missing.length) {
    console.log(`\nextracting crosswalk texture for ${missing.length} frames…`)
    const chunks = []; let n = Object.keys(stIdx).length, done = 0, t0 = Date.now()
    for (const f of missing) {
      try {
        const buf = readFileSync(join(DATA, 'frames', f.path)); const meta = await sharp(buf).metadata()
        const o = new Float32Array(N); let off = 0
        for (const { roi, width, height } of LINEUP_REGIONS) { const rect = regionRect(roi, meta.width, meta.height); const g = await sharp(buf).extract(rect).greyscale().raw().toBuffer(); cellStdGrid(g, rect.width, rect.height, width, height, o, off); off += width * height }
        const u8 = Buffer.alloc(N); for (let i = 0; i < N; i++) u8[i] = Math.max(0, Math.min(255, Math.round((o[i] / 255) * 1020)))
        chunks.push(u8); stIdx[f.path] = n++
      } catch { stIdx[f.path] = -1 }
      if (++done % 1000 === 0) console.log(`  ${done}/${missing.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
    }
    stBuf = Buffer.concat([stBuf, ...chunks]); writeFileSync(stPath, stBuf); writeFileSync(stIdxPath, JSON.stringify(stIdx))
  }
  const usable = rows.filter((r) => stIdx[r.path] >= 0)
  const keepAll = new Uint8Array(N).fill(1)
  const bright = (f) => Float32Array.from(bin.subarray(pos.get(f.path) * N, (pos.get(f.path) + 1) * N), (v) => v / 255)
  const texture = (f) => { const i = stIdx[f.path]; const v = new Float32Array(N); for (let c = 0; c < N; c++) v[c] = stBuf[i * N + c] / 1020; return standardizeRegions(v, LINEUP_REGIONS, keepAll) }
  const feats = { brightness: bright, texture, 'bright+texture': (f) => { const a = bright(f), b = texture(f); const o = new Float32Array(2 * N); o.set(a, 0); o.set(b, N); return o } }
  const refuted = new Set()
  { const byKey = new Map(); for (const r of JSON.parse(readFileSync(join(DATA, 'lineup-reports.json'), 'utf8'))) { if (r.deleted) continue; if (!byKey.has(r.sailingKey)) byKey.set(r.sailingKey, []); byKey.get(r.sailingKey).push(r) } for (const [k, l] of byKey) if (effectiveCrosswalk(l)?.notYet) refuted.add(k) }
  const groups = new Map(); for (const f of usable) { if (!groups.has(f.sailingKey)) groups.set(f.sailingKey, []); groups.get(f.sailingKey).push(f) }
  for (const g of groups.values()) g.sort((a, b) => a.ts - b.ts)
  const SEQ = { phantom: 10, early30: 6, early10: 2, late10: 1, late30: 2, missed: 2 }
  const months = [...new Set(usable.filter((r) => r.y != null && !r.dark).map((r) => monthOf(r.ts)))].sort()
  out.lineup = {}
  console.log(`\n######## CROSSWALK — ${usable.length} frames, ${usable.filter((r) => r.y != null && !r.dark).length} daylight labels, months ${months.join(' ')}`)
  console.log(`${'slice'.padEnd(26)} ${'features'.padEnd(15)} train  eval   acc    P      R    | sailings  cost  agree  missed  phantom`)
  for (const [fname, fx] of Object.entries(feats)) {
    const dim = fname === 'bright+texture' ? 2 * N : N
    for (const f of usable) f.x = fx(f)
    for (const [name, isTrain, isEval] of slices(months)) {
      const trainSet = usable.filter((f) => f.y != null && !f.dark && isTrain(f.ts))
      const evalLabeled = usable.filter((f) => f.y != null && !f.dark && isEval(f.ts))
      if (!trainSet.length || !evalLabeled.length) continue
      const predict = trainLR(trainSet, dim, { epochs: 1000, lr: 0.1, l2: 1e-4, balance: false })
      for (const f of usable) f.p = isEval(f.ts) ? predict(f.x) : undefined
      const fm = frameMetrics(evalLabeled, 0.7)
      const c = { phantom: 0, early30: 0, early10: 0, agree: 0, late10: 0, late30: 0, missed: 0, unknown: 0, sailings: 0 }
      for (const [key, fr] of groups) {
        if (!isEval(fr[0].ts)) continue
        const lit = fr.filter((f) => !f.dark); if (lit.length < 2) continue; c.sailings++
        const det = firstSustainedPositiveTs(lit.map((f) => ({ ts: f.ts, positive: f.p >= 0.7 }))); const human = fr[0].crosswalkAt
        if (det == null) { if (human != null) c.missed++; continue } if (human == null) { if (refuted.has(key)) c.phantom++; else c.unknown++; continue }
        const d = (det - human) / 60000; if (d <= -30) c.early30++; else if (d <= -10) c.early10++; else if (d < 10) c.agree++; else if (d < 30) c.late10++; else c.late30++
      }
      c.cost = Object.entries(SEQ).reduce((a, [k, w]) => a + w * c[k], 0)
      ;(out.lineup[fname] ??= {})[name] = { train: trainSet.length, eval: evalLabeled.length, ...fm, sequence: c }
      console.log(`${name.padEnd(26)} ${fname.padEnd(15)} ${String(trainSet.length).padStart(5)} ${String(evalLabeled.length).padStart(5)}  ${r3(fm.acc)}  ${r3(fm.P)}  ${r3(fm.R)} | ${String(c.sailings).padStart(5)}    ${String(c.cost).padStart(4)}  ${String(c.agree).padStart(5)}  ${String(c.missed).padStart(6)}  ${String(c.phantom).padStart(7)}`)
    }
    {
      cvPredict(usable, (f) => f.y != null && !f.dark, dim, { epochs: 1000, lr: 0.1, l2: 1e-4, balance: false })
      const labeled = usable.filter((f) => f.y != null && !f.dark)
      const fm = frameMetrics(labeled, 0.7)
      const bandOf = (f) => { const e = solarElevation(f.ts); return e < 0 ? 'twilight' : e < 15 ? 'low' : e < 30 ? 'mid' : 'high' }
      const bands = {}; for (const b of ['twilight', 'low', 'mid', 'high']) bands[b] = frameMetrics(labeled.filter((f) => bandOf(f) === b), 0.7)
      const c = { phantom: 0, early30: 0, early10: 0, agree: 0, late10: 0, late30: 0, missed: 0, unknown: 0, sailings: 0 }
      for (const [key, fr] of groups) {
        const lit = fr.filter((f) => !f.dark); if (lit.length < 2) continue; c.sailings++
        const det = firstSustainedPositiveTs(lit.map((f) => ({ ts: f.ts, positive: f.p >= 0.7 }))); const human = fr[0].crosswalkAt
        if (det == null) { if (human != null) c.missed++; continue } if (human == null) { if (refuted.has(key)) c.phantom++; else c.unknown++; continue }
        const d = (det - human) / 60000; if (d <= -30) c.early30++; else if (d <= -10) c.early10++; else if (d < 10) c.agree++; else if (d < 30) c.late10++; else c.late30++
      }
      c.cost = Object.entries(SEQ).reduce((a, [k, w]) => a + w * c[k], 0)
      out.lineup[fname]['5-fold CV by sailing'] = { eval: labeled.length, ...fm, bands, sequence: c }
      console.log(`${'5-fold CV by sailing'.padEnd(26)} ${fname.padEnd(15)} ${'—'.padStart(5)} ${String(labeled.length).padStart(5)}  ${r3(fm.acc)}  ${r3(fm.P)}  ${r3(fm.R)} | ${String(c.sailings).padStart(5)}    ${String(c.cost).padStart(4)}  ${String(c.agree).padStart(5)}  ${String(c.missed).padStart(6)}  ${String(c.phantom).padStart(7)}`)
      console.log(`    by sun: ${Object.entries(bands).map(([b, m]) => `${b} n${m.n} P${r3(m.P)} R${r3(m.R)}`).join(' | ')}`)
    }
  }
}
writeFileSync(join(DATA, 'experiments/season-generalisation.json'), JSON.stringify(out, null, 1))
console.log('\nwritten training-data/experiments/season-generalisation.json')
