// Terminal-cars classifier: which FEATURE pipeline survives low sun?
//
// 2026-10-18: the Sunday 08:45 departure frames (visibly empty road, low
// October sun on the hill) scored p 0.81–0.89 "cars" on model v5. Breakdown:
// bias +1.79 (0.86 before any pixel), near lane −0.4 (says empty), far queue
// +0.1…+0.7 — the sun-lit upper-left of the far-queue box is BRIGHT relative
// to the frame mean, and the model learned "far queue brighter than the rest
// of the frame" as cars (when the near lane is full of dark cars, the frame
// mean drops and the far road reads bright: a confound of frame-global
// mean-centering). Rider-tagged "room" sailings get a robot not-full flag
// 76% of the time at 05:15 (street light) but 19–24% at 07:30/08:45.
//
// This script compares feature pipelines with 5-fold CV by sailing, scored
// three ways: per-frame on hand labels (by solar-elevation band), per-frame
// on rider labels, and per-SAILING against rider capacity tags with the
// deployed tail rules (not-full coverage / wrong flags, and the false "cars
// to the end" rate that feeds the full call). Raw region pixels are cached
// once (training-data/experiments/cache/), so re-runs with new variants are
// quick.
//
//   node scripts/experiments/terminal-features-experiment.mjs [--variants base,region,...] [--epochs 600] [--lr 0.2]
// Write-up: docs/experiments/2026-10-18-terminal-features-daybreak.md
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { TERMINAL_REGIONS, TERMINAL_FEATURE_MASK, TERMINAL_FEATURE_LENGTH } from '../../functions/lib/terminal-features.js'
import { terminalEmptyFrameTs, FULL_TAIL_FRAMES, FULL_CONFIDENT_P } from '../../functions/lib/lineup-labels.js'
import { solarElevation } from '../../functions/lib/daylight.js'

const ROOT = join(import.meta.dirname, '../..')
const DATA = join(ROOT, 'training-data')
const CACHE = join(DATA, 'experiments/cache')
const sharp = createRequire(join(ROOT, 'functions/package.json'))('sharp')

const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d }
const EPOCHS = Number(flag('epochs', '600'))
const LR = Number(flag('lr', '0.2'))
const L2 = 1e-4
const VARIANTS = flag('variants', 'base,grad+zscore+bal,std+z+bal,sobel+z+bal,hp+z+bal,clahe+z+bal,grad+std+z+bal,sobel+std+clahe+z+bal,grad+hp+z+bal,bgref+z+bal,grad+bgref+z+bal').split(',')

// --- manifest ---------------------------------------------------------------
const rows = readFileSync(join(DATA, 'terminal-manifest.csv'), 'utf8').trim().split('\n').slice(1).map((l) => {
  const [path, sailingKey, ts, label, source] = l.split(',')
  return { path, sailingKey, ts: Number(ts), y: label === '0' ? 0 : label === '1' ? 1 : null, source: source || null }
})
const frames = rows.filter((r) => existsSync(join(DATA, 'frames', r.path)))
const EMPTY_REFS = [] // hand-labelled empty frames, filled once features are indexed
frames.sort((a, b) => a.ts - b.ts)
console.log(`frames on disk: ${frames.length} (hand labels ${frames.filter((f) => f.y != null && f.source === 'hand').length}, rider ${frames.filter((f) => f.y != null && f.source === 'rider').length})`)

// --- raw pixel cache ----------------------------------------------------------
// coarse: the deployed grids (32x18 + 20x18 = 936 bytes); fine: 2x grids
// (64x36 + 40x36 = 3744 bytes) for gradient features.
const COARSE = TERMINAL_FEATURE_LENGTH
const FINE_REGIONS = TERMINAL_REGIONS.map((r) => ({ ...r, width: r.width * 2, height: r.height * 2 }))
const FINE = FINE_REGIONS.reduce((a, r) => a + r.width * r.height, 0)
mkdirSync(CACHE, { recursive: true })
const idxPath = join(CACHE, 'terminal-raw-index.json')
const coarsePath = join(CACHE, 'terminal-raw-coarse.u8')
const finePath = join(CACHE, 'terminal-raw-fine.u8')
let index = existsSync(idxPath) ? JSON.parse(readFileSync(idxPath, 'utf8')) : {}
let coarseBuf = existsSync(coarsePath) ? readFileSync(coarsePath) : Buffer.alloc(0)
let fineBuf = existsSync(finePath) ? readFileSync(finePath) : Buffer.alloc(0)

async function extractRaw(buf, regions) {
  const meta = await sharp(buf).metadata()
  const parts = []
  for (const { roi, width, height } of regions) {
    const left = Math.round(roi.left * meta.width)
    const top = Math.round(roi.top * meta.height)
    const region = { left, top, width: Math.max(1, Math.min(Math.round(roi.width * meta.width), meta.width - left)), height: Math.max(1, Math.min(Math.round(roi.height * meta.height), meta.height - top)) }
    parts.push(await sharp(buf).extract(region).resize(width, height, { fit: 'fill' }).greyscale().raw().toBuffer())
  }
  return Buffer.concat(parts)
}
{
  const missing = frames.filter((f) => index[f.path] === undefined)
  if (missing.length) {
    console.log(`extracting raw pixels for ${missing.length} frames…`)
    const newCoarse = [], newFine = []
    let n = Object.keys(index).length, done = 0, t0 = Date.now()
    for (const f of missing) {
      try {
        const bytes = readFileSync(join(DATA, 'frames', f.path))
        const c = await extractRaw(bytes, TERMINAL_REGIONS)
        const fi = await extractRaw(bytes, FINE_REGIONS)
        if (c.length !== COARSE || fi.length !== FINE) throw new Error('bad length')
        newCoarse.push(c); newFine.push(fi); index[f.path] = n++
      } catch (e) {
        index[f.path] = -1 // unreadable
      }
      if (++done % 1000 === 0) console.log(`  ${done}/${missing.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
    }
    coarseBuf = Buffer.concat([coarseBuf, ...newCoarse]); fineBuf = Buffer.concat([fineBuf, ...newFine])
    writeFileSync(coarsePath, coarseBuf); writeFileSync(finePath, fineBuf); writeFileSync(idxPath, JSON.stringify(index))
  }
}
// Second cache: per-cell statistics from the NATIVE-resolution crop (frames
// are 320x240, so the near lane is ~179x101 px, ~5.6 px per cell):
//   std    local standard deviation (texture)
//   sobel  mean Sobel gradient magnitude (edges)
//   hp     mean |pixel − 3px box blur| (high-pass: sun gradients removed)
//   clahe  mean of the CLAHE-equalised crop (local contrast stretch)
// Each quantised to u8; 4 channels × 936 cells per frame.
const STATS = ['std', 'sobel', 'hp', 'clahe']
const statsPath = join(CACHE, 'terminal-stats.u8')
const statsIdxPath = join(CACHE, 'terminal-stats-index.json')
let statsIndex = existsSync(statsIdxPath) ? JSON.parse(readFileSync(statsIdxPath, 'utf8')) : {}
let statsBuf = existsSync(statsPath) ? readFileSync(statsPath) : Buffer.alloc(0)
const q = (x, scale) => Math.max(0, Math.min(255, Math.round(x * scale)))
async function extractStats(buf) {
  const meta = await sharp(buf).metadata()
  const out = Buffer.alloc(STATS.length * COARSE)
  let offC = 0
  for (const { roi, width, height } of TERMINAL_REGIONS) {
    const left = Math.round(roi.left * meta.width), top = Math.round(roi.top * meta.height)
    const region = { left, top, width: Math.max(1, Math.min(Math.round(roi.width * meta.width), meta.width - left)), height: Math.max(1, Math.min(Math.round(roi.height * meta.height), meta.height - top)) }
    const W = region.width, H = region.height
    const g = await sharp(buf).extract(region).greyscale().raw().toBuffer()
    const bl = await sharp(buf).extract(region).greyscale().blur(3).raw().toBuffer()
    const cl = await sharp(buf).extract(region).greyscale().clahe({ width: 16, height: 16, maxSlope: 3 }).raw().toBuffer()
    // per native pixel: sobel magnitude
    const sob = new Float32Array(W * H)
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x
      const gx = -g[i - W - 1] + g[i - W + 1] - 2 * g[i - 1] + 2 * g[i + 1] - g[i + W - 1] + g[i + W + 1]
      const gy = -g[i - W - 1] - 2 * g[i - W] - g[i - W + 1] + g[i + W - 1] + 2 * g[i + W] + g[i + W + 1]
      sob[i] = Math.hypot(gx, gy) / 8 / 255
    }
    for (let cy = 0; cy < height; cy++) for (let cx = 0; cx < width; cx++) {
      const x0 = Math.floor((cx / width) * W), x1 = Math.max(x0 + 1, Math.floor(((cx + 1) / width) * W))
      const y0 = Math.floor((cy / height) * H), y1 = Math.max(y0 + 1, Math.floor(((cy + 1) / height) * H))
      let n = 0, s1 = 0, s2 = 0, ss = 0, sh = 0, sc = 0
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = y * W + x, v = g[i] / 255
        n++; s1 += v; s2 += v * v; ss += sob[i]; sh += Math.abs(g[i] - bl[i]) / 255; sc += cl[i] / 255
      }
      const mean = s1 / n, sd = Math.sqrt(Math.max(0, s2 / n - mean * mean))
      const c = offC + cy * width + cx
      out[0 * COARSE + c] = q(sd, 255 * 4)
      out[1 * COARSE + c] = q(ss / n, 255 * 4)
      out[2 * COARSE + c] = q(sh / n, 255 * 4)
      out[3 * COARSE + c] = q(sc / n, 255)
    }
    offC += width * height
  }
  return out
}
{
  const missing = frames.filter((f) => index[f.path] >= 0 && statsIndex[f.path] === undefined)
  if (missing.length) {
    console.log(`extracting native-res stats for ${missing.length} frames…`)
    const chunks = []
    let n = Object.keys(statsIndex).length, done = 0, t0 = Date.now()
    for (const f of missing) {
      try { chunks.push(await extractStats(readFileSync(join(DATA, 'frames', f.path)))); statsIndex[f.path] = n++ } catch { statsIndex[f.path] = -1 }
      if (++done % 1000 === 0) console.log(`  ${done}/${missing.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
    }
    statsBuf = Buffer.concat([statsBuf, ...chunks]); writeFileSync(statsPath, statsBuf); writeFileSync(statsIdxPath, JSON.stringify(statsIndex))
  }
}
const usable = frames.filter((f) => index[f.path] >= 0 && statsIndex[f.path] >= 0)
for (const f of usable) {
  f.i = index[f.path]
  f.elev = solarElevation(f.ts)
  f.date = f.path.split('/')[2]
  f.fold = createHash('md5').update(f.sailingKey).digest()[0] % 5
  f.si = statsIndex[f.path]
}
for (const f of usable) if (f.y === 0 && f.source === 'hand') EMPTY_REFS.push(f)
console.log(`certified empty references: ${EMPTY_REFS.length}`)
const statChannel = (f, ch) => { const k = STATS.indexOf(ch); return statsBuf.subarray(f.si * STATS.length * COARSE + k * COARSE, f.si * STATS.length * COARSE + (k + 1) * COARSE) }
const rawCoarse = (f) => coarseBuf.subarray(f.i * COARSE, (f.i + 1) * COARSE)
const rawFine = (f) => fineBuf.subarray(f.i * FINE, (f.i + 1) * FINE)
console.log(`usable frames: ${usable.length}`)

// --- lighting bands ----------------------------------------------------------
const band = (e) => (e < -7 ? 'night' : e < 8 ? 'twilight' : e < 25 ? 'low sun' : 'high sun')
const BANDS = ['night', 'twilight', 'low sun', 'high sun']

// --- feature pipelines ---------------------------------------------------------
const MASK = TERMINAL_FEATURE_MASK
const regionSpans = (() => { const s = []; let off = 0; for (const r of TERMINAL_REGIONS) { s.push([off, off + r.width * r.height]); off += r.width * r.height } return s })()

function frameCenter(v) { // deployed: one mean over unmasked cells, masked → 0
  let m = 0, k = 0
  for (let i = 0; i < v.length; i++) if (MASK[i]) { m += v[i]; k++ }
  m /= k || 1
  const out = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = MASK[i] ? v[i] - m : 0
  return out
}
function regionCenter(v, z = false) { // per-region mean (and std), masked → 0
  const out = new Float32Array(v.length)
  for (const [a, b] of regionSpans) {
    let m = 0, k = 0
    for (let i = a; i < b; i++) if (MASK[i]) { m += v[i]; k++ }
    m /= k || 1
    let sd = 1
    if (z) { let s = 0; for (let i = a; i < b; i++) if (MASK[i]) s += (v[i] - m) ** 2; sd = Math.sqrt(s / (k || 1)) || 1 }
    // keep the z-scored scale comparable to the 0..1 pixel range (÷5) so one LR suits all variants
    for (let i = a; i < b; i++) out[i] = MASK[i] ? (v[i] - m) / (z ? sd * 5 : 1) : 0
  }
  return out
}
const toUnit = (u8) => { const v = new Float32Array(u8.length); for (let i = 0; i < u8.length; i++) v[i] = u8[i] / 255; return v }

// Gradient magnitude on the 2x grid, pooled 2x2 back to the deployed grid.
function gradFeatures(f) {
  const fine = rawFine(f)
  const out = new Float32Array(COARSE)
  let offF = 0, offC = 0
  for (const r of FINE_REGIONS) {
    const W = r.width, H = r.height
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = fine[offF + y * W + x]
      const dx = x + 1 < W ? Math.abs(fine[offF + y * W + x + 1] - p) : 0
      const dy = y + 1 < H ? Math.abs(fine[offF + (y + 1) * W + x] - p) : 0
      out[offC + (y >> 1) * (W / 2) + (x >> 1)] += (dx + dy) / 255 / 4
    }
    offF += W * H; offC += (W / 2) * (H / 2)
  }
  return out
}

// Background: per-cell median of raw pixels over frames from the previous
// 1–14 days at a similar solar elevation (±4°), up to 60 nearest in
// elevation. Cached per (date, 2° bin). Static road marks and the sun/shadow
// pattern for that time of day cancel; cars (transient) remain.
const DAY = 86400000
const bgCache = new Map()
const byDate = new Map()
for (const f of usable) { if (!byDate.has(f.date)) byDate.set(f.date, []); byDate.get(f.date).push(f) }
const dateList = [...byDate.keys()].sort()
function background(f) {
  const bin = Math.round(f.elev / 2)
  const key = `${f.date}|${bin}`
  if (bgCache.has(key)) return bgCache.get(key)
  const t0 = f.ts - 14 * DAY, t1 = f.ts - (f.ts % DAY) // strictly earlier days (UTC day boundary is fine here)
  let cands = []
  for (const d of dateList) {
    const arr = byDate.get(d)
    if (arr[0].ts < t0 || arr[0].ts >= t1) continue
    for (const g of arr) if (Math.abs(g.elev - f.elev) <= 4) cands.push(g)
  }
  cands.sort((a, b) => Math.abs(a.elev - f.elev) - Math.abs(b.elev - f.elev))
  cands = cands.slice(0, 60)
  let bg = null
  if (cands.length >= 10) {
    bg = new Float32Array(COARSE)
    const col = new Uint8Array(cands.length)
    const raws = cands.map(rawCoarse)
    for (let i = 0; i < COARSE; i++) {
      for (let k = 0; k < raws.length; k++) col[k] = raws[k][i]
      col.sort()
      bg[i] = col[col.length >> 1] / 255
    }
  }
  bgCache.set(key, bg)
  return bg
}
let bgMiss = 0
function bgFeatures(f, z) {
  const v = toUnit(rawCoarse(f))
  const bg = background(f)
  if (!bg) { bgMiss++; return regionCenter(v, z) }
  const d = new Float32Array(COARSE)
  for (let i = 0; i < COARSE; i++) d[i] = v[i] - bg[i]
  return regionCenter(d, z) // re-center so a global exposure shift between days drops out
}

// Background subtraction against CERTIFIED empty frames (Tom, 2026-10-18):
// the reference must be a frame known to have no cars — the hand label 0 —
// not a blind median that still holds the queue front. Lighting need not
// match: each reference box is gain/offset-matched to the current frame's
// box (mean and std) before subtracting. The k nearest references by solar
// elevation (other sailings only) are used and the SMALLEST per-cell
// difference kept, so a cell only counts when no empty reference explains it.
const BGREF_K = 3
function bgrefFeatures(cur, elev, sailingKey, z = true) {
  const cands = EMPTY_REFS.filter((r) => r.sailingKey !== sailingKey)
    .sort((a, b) => Math.abs(a.elev - elev) - Math.abs(b.elev - elev)).slice(0, BGREF_K)
  const v = toUnit(cur)
  const best = new Float32Array(COARSE).fill(1)
  for (const r of cands) {
    const rv = toUnit(rawCoarse(r))
    for (const [a, b] of regionSpans) {
      let m1 = 0, m2 = 0, k = 0
      for (let i = a; i < b; i++) if (MASK[i]) { m1 += v[i]; m2 += rv[i]; k++ }
      m1 /= k || 1; m2 /= k || 1
      let s1 = 0, s2 = 0
      for (let i = a; i < b; i++) if (MASK[i]) { s1 += (v[i] - m1) ** 2; s2 += (rv[i] - m2) ** 2 }
      const gain = Math.sqrt(s1 / (k || 1)) / (Math.sqrt(s2 / (k || 1)) || 1e-6)
      for (let i = a; i < b; i++) {
        if (!MASK[i]) continue
        const adj = (rv[i] - m2) * Math.min(3, Math.max(0.33, gain)) + m1
        const d = Math.abs(v[i] - adj)
        if (d < best[i]) best[i] = d
      }
    }
  }
  for (let i = 0; i < COARSE; i++) if (!MASK[i]) best[i] = 0
  return regionCenter(best, z)
}
const concat = (...arrs) => { const out = new Float32Array(arrs.reduce((a, b) => a + b.length, 0)); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length } return out }
const statFeat = (f, ch, z) => regionCenter(toUnit(statChannel(f, ch)), z)
const PIPELINES = {
  'std+z+bal': (f) => statFeat(f, 'std', true),
  'std+z': (f) => statFeat(f, 'std', true),
  'std': (f) => statFeat(f, 'std', false),
  'sobel+z+bal': (f) => statFeat(f, 'sobel', true),
  'hp+z+bal': (f) => statFeat(f, 'hp', true),
  'clahe+z+bal': (f) => statFeat(f, 'clahe', true),
  'grad+std+z+bal': (f) => concat(regionCenter(gradFeatures(f), true), statFeat(f, 'std', true)),
  'sobel+std+clahe+z+bal': (f) => concat(statFeat(f, 'sobel', true), statFeat(f, 'std', true), statFeat(f, 'clahe', true)),
  'grad+hp+z+bal': (f) => concat(regionCenter(gradFeatures(f), true), statFeat(f, 'hp', true)),
  'bgref+z+bal': (f) => bgrefFeatures(rawCoarse(f), f.elev, f.sailingKey),
  'grad+bgref+z+bal': (f) => concat(regionCenter(gradFeatures(f), true), bgrefFeatures(rawCoarse(f), f.elev, f.sailingKey)),
  base: (f) => frameCenter(toUnit(rawCoarse(f))),
  region: (f) => regionCenter(toUnit(rawCoarse(f))),
  zscore: (f) => regionCenter(toUnit(rawCoarse(f)), true),
  'zscore+bal': (f) => regionCenter(toUnit(rawCoarse(f)), true),
  bg: (f) => bgFeatures(f, false),
  'bg+zscore': (f) => bgFeatures(f, true),
  grad: (f) => regionCenter(gradFeatures(f)),
  'grad+zscore+bal': (f) => regionCenter(gradFeatures(f), true),
}
const balanced = (name) => name.includes('+bal')

// --- training -------------------------------------------------------------------
const sigmoid = (z) => 1 / (1 + Math.exp(-z))
function train(set, weighted) {
  const N = set[0].x.length
  const w = new Float64Array(N)
  let b = 0
  const pos = set.filter((s) => s.y === 1).length, neg = set.length - pos
  const wNeg = weighted ? pos / Math.max(1, neg) : 1
  const predict = (x) => { let z = b; for (let i = 0; i < N; i++) z += w[i] * x[i]; return sigmoid(z) }
  for (let e = 0; e < EPOCHS; e++) {
    const gw = new Float64Array(N)
    let gb = 0, norm = 0
    for (const s of set) {
      const cw = s.y === 1 ? 1 : wNeg
      const err = (predict(s.x) - s.y) * cw
      for (let i = 0; i < N; i++) gw[i] += err * s.x[i]
      gb += err; norm += cw
    }
    for (let i = 0; i < N; i++) w[i] -= LR * (gw[i] / norm + L2 * w[i])
    b -= LR * (gb / norm)
  }
  return { predict, bias: b }
}

// --- capacity tags for the sailing-level score ---------------------------------
const tagBySailing = new Map()
for (const t of JSON.parse(readFileSync(join(DATA, 'capacity-tags.json'), 'utf8'))) {
  if (!t.sailingKey?.endsWith('_To HSB')) continue
  const prev = tagBySailing.get(t.sailingKey)
  if (!prev || (t.recordedAt || 0) > (prev.recordedAt || 0)) tagBySailing.set(t.sailingKey, t)
}
try { for (const k of Object.keys(JSON.parse(readFileSync(join(DATA, 'tag-corrections.json'), 'utf8')))) tagBySailing.delete(k) } catch {}

// --- Sunday 2026-10-18 08:45 frames (the complaint; fetched from the public
// production bucket into the cache on first run) ---------------------------------
const SUNDAY_TS = [1792337714623, 1792337777056, 1792337837079, 1792337893449, 1792337947833, 1792338013739, 1792338067167, 1792338138449, 1792338188853, 1792338252544, 1792338313638, 1792338368043, 1792338435178]
const sundayDir = join(CACHE, 'frames-2026-10-18-0845')
mkdirSync(sundayDir, { recursive: true })
const sunday = []
for (const ts of SUNDAY_TS) {
  const file = join(sundayDir, `${ts}.jpg`)
  if (!existsSync(file)) {
    const url = `https://storage.googleapis.com/bowen-ferry.firebasestorage.app/webcams/bowen/2026-10-18/timelapse/${encodeURIComponent('08:45_To HSB_' + ts + '.jpg')}`
    try { writeFileSync(file, Buffer.from(await (await fetch(url)).arrayBuffer())) } catch { continue }
  }
  const bytes = readFileSync(file)
  const c = await extractRaw(bytes, TERMINAL_REGIONS), fi = await extractRaw(bytes, FINE_REGIONS), st = await extractStats(bytes)
  sunday.push({ ts, elev: solarElevation(ts), date: '2026-10-18', c, fi, st })
}

// --- run variants -------------------------------------------------------------
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—')
const r3 = (x) => (x == null ? '—' : x.toFixed(3))
function frameMetrics(set) {
  let tp = 0, fp = 0, fn = 0, ok = 0
  for (const s of set) { const yh = s.p >= 0.5 ? 1 : 0; if (yh === s.y) ok++; if (yh && s.y) tp++; if (yh && !s.y) fp++; if (!yh && s.y) fn++ }
  const P = tp + fp ? tp / (tp + fp) : null, R = tp + fn ? tp / (tp + fn) : null
  return { n: set.length, acc: set.length ? ok / set.length : null, P, R, F1: P && R ? (2 * P * R) / (P + R) : null }
}
const results = {}
for (const name of VARIANTS) {
  const pipe = PIPELINES[name]
  if (!pipe) { console.log(`unknown variant ${name}`); continue }
  bgMiss = 0
  const t0 = Date.now()
  for (const f of usable) f.x = pipe(f)
  const hand = usable.filter((f) => f.y != null && f.source === 'hand')
  const biases = []
  for (const fold of [0, 1, 2, 3, 4]) {
    const m = train(hand.filter((s) => s.fold !== fold), balanced(name))
    biases.push(m.bias)
    for (const f of usable) if (f.fold === fold) f.p = m.predict(f.x)
  }
  // frame level
  const out = { name, bias: biases.reduce((a, b) => a + b, 0) / 5, hand: frameMetrics(hand), rider: frameMetrics(usable.filter((f) => f.y != null && f.source === 'rider')), bands: {} }
  for (const b of BANDS) out.bands[b] = frameMetrics(hand.filter((f) => band(f.elev) === b))
  // sailing level: tail rules on OOF predictions, against rider tags
  const bySailing = new Map()
  for (const f of usable) { if (!bySailing.has(f.sailingKey)) bySailing.set(f.sailingKey, []); bySailing.get(f.sailingKey).push(f) }
  const slots = {}
  let roomN = 0, roomFlag = 0, fullN = 0, fullWrong = 0, roomCarsEnd = 0, fullCarsEnd = 0
  for (const [key, fr] of bySailing) {
    const tag = tagBySailing.get(key)
    if (!tag || fr.length < 2) continue
    fr.sort((a, b) => a.ts - b.ts)
    const room = tag.capacity !== 'Full'
    const nf = terminalEmptyFrameTs(fr.map((f) => ({ ts: f.ts, carsPresent: f.p >= 0.5 }))) != null
    const tail = fr.slice(-FULL_TAIL_FRAMES)
    const carsEnd = tail.length === FULL_TAIL_FRAMES && tail.every((f) => f.p >= FULL_CONFIDENT_P)
    const slot = band(fr[fr.length - 1].elev)
    slots[slot] ??= { roomN: 0, roomFlag: 0, roomCarsEnd: 0, fullN: 0, fullWrong: 0 }
    if (room) { roomN++; slots[slot].roomN++; if (nf) { roomFlag++; slots[slot].roomFlag++ } if (carsEnd) { roomCarsEnd++; slots[slot].roomCarsEnd++ } }
    else { fullN++; slots[slot].fullN++; if (nf) { fullWrong++; slots[slot].fullWrong++ } if (carsEnd) fullCarsEnd++ }
  }
  out.sailing = { roomN, roomFlag, fullN, fullWrong, roomCarsEnd, fullCarsEnd, slots }
  // Sunday frames, model trained on all hand labels
  if (sunday.length) {
    const m = train(hand, balanced(name))
    out.sunday = sunday.map((s) => {
      const fake = { i: null, elev: s.elev, date: s.date, ts: s.ts }
      let x
      const sChan = (ch) => regionCenter(toUnit(s.st.subarray(STATS.indexOf(ch) * COARSE, (STATS.indexOf(ch) + 1) * COARSE)), true)
      const z = name.includes('zscore') || name.includes('+z')
      if (name in STAT_VARIANTS) x = STAT_VARIANTS[name](s, sChan)
      else if (name.startsWith('grad')) { const g = gradFromFine(s.fi); x = regionCenter(g, z) }
      else if (name.startsWith('bg')) { const bg = background(fake); const v = toUnit(s.c); const d = new Float32Array(COARSE); for (let i = 0; i < COARSE; i++) d[i] = v[i] - (bg ? bg[i] : 0); x = regionCenter(d, name.includes('zscore')) }
      else if (name === 'base') x = frameCenter(toUnit(s.c))
      else x = regionCenter(toUnit(s.c), name.includes('zscore'))
      return m.predict(x)
    })
  }
  results[name] = out
  console.log(`\n=== ${name} (${((Date.now() - t0) / 1000).toFixed(0)}s${bgMiss ? `, ${bgMiss} frames without background` : ''}) bias ${out.bias.toFixed(2)}`)
  console.log(`  hand OOF: acc ${r3(out.hand.acc)} P ${r3(out.hand.P)} R ${r3(out.hand.R)} F1 ${r3(out.hand.F1)} | rider: acc ${r3(out.rider.acc)} P ${r3(out.rider.P)} R ${r3(out.rider.R)}`)
  for (const b of BANDS) { const m = out.bands[b]; console.log(`    ${b.padEnd(9)} n ${String(m.n).padStart(3)} acc ${r3(m.acc)} P ${r3(m.P)} R ${r3(m.R)}`) }
  console.log(`  sailings: room-tagged ${roomN} → not-full flagged ${pct(roomFlag, roomN)} | Full-tagged ${fullN} → wrong not-full ${fullWrong} | "cars to the end" on room-tagged ${pct(roomCarsEnd, roomN)} (false-full feed), on Full-tagged ${pct(fullCarsEnd, fullN)}`)
  for (const b of BANDS) { const s = slots[b]; if (s) console.log(`    ${b.padEnd(9)} room ${String(s.roomN).padStart(3)} flagged ${pct(s.roomFlag, s.roomN).padStart(4)} cars-to-end ${pct(s.roomCarsEnd, s.roomN).padStart(4)} | full ${s.fullN} wrong ${s.fullWrong}`) }
  if (out.sunday) console.log(`  Sun 10-18 08:45 frames p: ${out.sunday.map((p) => p.toFixed(2)).join(' ')}`)
}
writeFileSync(join(DATA, 'experiments/terminal-features-experiment.json'), JSON.stringify(results, null, 1))
console.log('\nwritten training-data/experiments/terminal-features-experiment.json (copy the one you report into docs/experiments/)')
