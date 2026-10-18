// Contact sheet: what each candidate feature pipeline "sees" on example
// TERMINAL-camera frames (webcams/bowen), per region, next to v5's view.
// Needs the caches written by terminal-features-experiment.mjs (run it first).
// Writes training-data/experiments/out/terminal-feature-sheet.html; screenshot
// it (Playwright, width ~2300) for docs/experiments/img/.
// Write-up: docs/experiments/2026-10-18-terminal-features-daybreak.md
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { TERMINAL_REGIONS, TERMINAL_FEATURE_MASK, TERMINAL_FEATURE_LENGTH } from '../../functions/lib/terminal-features.js'
import { solarElevation } from '../../functions/lib/daylight.js'

const ROOT = join(import.meta.dirname, '../..')
const DATA = join(ROOT, 'training-data')
const CACHE = join(DATA, 'experiments/cache')
const OUT = join(DATA, 'experiments/out/terminal-feature-sheet')
mkdirSync(OUT, { recursive: true })
const sharp = createRequire(join(ROOT, 'functions/package.json'))('sharp')
const COARSE = TERMINAL_FEATURE_LENGTH
const MASK = TERMINAL_FEATURE_MASK
const spans = (() => { const s = []; let o = 0; for (const r of TERMINAL_REGIONS) { s.push([o, o + r.width * r.height]); o += r.width * r.height } return s })()
// v5 — the last brightness-feature model (archived); the live model may differ.
const model = JSON.parse(readFileSync(join(ROOT, 'functions/models/history/terminal-cars-classifier-v5.json'), 'utf8'))

// ---- caches + manifest (for the certified-empty references and to train the texture model) ----
const rawIndex = JSON.parse(readFileSync(join(CACHE, 'terminal-raw-index.json'), 'utf8'))
const rawBuf = readFileSync(join(CACHE, 'terminal-raw-coarse.u8'))
const statsIndex = JSON.parse(readFileSync(join(CACHE, 'terminal-stats-index.json'), 'utf8'))
const statsBuf = readFileSync(join(CACHE, 'terminal-stats.u8'))
const rows = readFileSync(join(DATA, 'terminal-manifest.csv'), 'utf8').trim().split('\n').slice(1).map((l) => { const [path, sailingKey, ts, label, source] = l.split(','); return { path, sailingKey, ts: Number(ts), y: label === '0' ? 0 : label === '1' ? 1 : null, source } })
const hand = rows.filter((r) => r.y != null && r.source === 'hand' && rawIndex[r.path] >= 0 && statsIndex[r.path] >= 0)
for (const r of hand) r.elev = solarElevation(r.ts)
const rawOf = (r) => rawBuf.subarray(rawIndex[r.path] * COARSE, (rawIndex[r.path] + 1) * COARSE)
const stdOf = (r) => statsBuf.subarray(statsIndex[r.path] * 4 * COARSE, statsIndex[r.path] * 4 * COARSE + COARSE)
const refs = hand.filter((r) => r.y === 0)

// ---- feature math (same as the experiment) ----
const toUnit = (u8) => Float32Array.from(u8, (v) => v / 255)
function regionZ(v, z = true) {
  const out = new Float32Array(v.length)
  for (const [a, b] of spans) {
    let m = 0, k = 0; for (let i = a; i < b; i++) if (MASK[i]) { m += v[i]; k++ } m /= k || 1
    let sd = 1; if (z) { let s = 0; for (let i = a; i < b; i++) if (MASK[i]) s += (v[i] - m) ** 2; sd = Math.sqrt(s / (k || 1)) || 1 }
    for (let i = a; i < b; i++) out[i] = MASK[i] ? (v[i] - m) / (z ? sd * 5 : 1) : 0
  }
  return out
}
function frameCenter(v) { let m = 0, k = 0; for (let i = 0; i < v.length; i++) if (MASK[i]) { m += v[i]; k++ } m /= k || 1; return Float32Array.from(v, (x, i) => (MASK[i] ? x - m : 0)) }
function refDiff(cur, elev, sailingKey) {
  const cands = refs.filter((r) => r.sailingKey !== sailingKey).sort((a, b) => Math.abs(a.elev - elev) - Math.abs(b.elev - elev)).slice(0, 3)
  const v = toUnit(cur), best = new Float32Array(COARSE).fill(1)
  for (const r of cands) {
    const rv = toUnit(rawOf(r))
    for (const [a, b] of spans) {
      let m1 = 0, m2 = 0, k = 0; for (let i = a; i < b; i++) if (MASK[i]) { m1 += v[i]; m2 += rv[i]; k++ } m1 /= k || 1; m2 /= k || 1
      let s1 = 0, s2 = 0; for (let i = a; i < b; i++) if (MASK[i]) { s1 += (v[i] - m1) ** 2; s2 += (rv[i] - m2) ** 2 }
      const gain = Math.min(3, Math.max(0.33, Math.sqrt(s1 / (k || 1)) / (Math.sqrt(s2 / (k || 1)) || 1e-6)))
      for (let i = a; i < b; i++) if (MASK[i]) { const d = Math.abs(v[i] - ((rv[i] - m2) * gain + m1)); if (d < best[i]) best[i] = d }
    }
  }
  for (let i = 0; i < COARSE; i++) if (!MASK[i]) best[i] = 0
  return { map: best, refs: cands.map((r) => `${r.path.split('/')[2]} ${r.path.split('_')[0].split('/').pop()} (${r.elev.toFixed(0)}°)`) }
}

// ---- train the recommended texture model (local std, per-box z, balanced) on all hand labels ----
const sigmoid = (z) => 1 / (1 + Math.exp(-z))
function train(set) {
  const N = COARSE, w = new Float64Array(N); let b = 0
  const pos = set.filter((s) => s.y === 1).length, neg = set.length - pos, wNeg = pos / Math.max(1, neg)
  const pred = (x) => { let z = b; for (let i = 0; i < N; i++) z += w[i] * x[i]; return sigmoid(z) }
  for (let e = 0; e < 600; e++) {
    const gw = new Float64Array(N); let gb = 0, norm = 0
    for (const s of set) { const cw = s.y === 1 ? 1 : wNeg; const err = (pred(s.x) - s.y) * cw; for (let i = 0; i < N; i++) gw[i] += err * s.x[i]; gb += err; norm += cw }
    for (let i = 0; i < N; i++) w[i] -= 0.2 * (gw[i] / norm + 1e-4 * w[i]); b -= 0.2 * (gb / norm)
  }
  return pred
}
const texModel = train(hand.map((r) => ({ y: r.y, x: regionZ(toUnit(stdOf(r)), true) })))
const v5 = (x) => { let z = model.bias; for (let i = 0; i < COARSE; i++) z += model.weights[i] * x[i]; return sigmoid(z) }

// ---- per-frame extraction of native crops + maps ----
async function analyse(buf) {
  const meta = await sharp(buf).metadata()
  const regions = []
  const coarse = Buffer.alloc(COARSE), stdMap = new Float32Array(COARSE), sobMap = new Float32Array(COARSE), hpMap = new Float32Array(COARSE), clMap = new Float32Array(COARSE)
  let offC = 0
  for (const { roi, width, height, name } of TERMINAL_REGIONS) {
    const left = Math.round(roi.left * meta.width), top = Math.round(roi.top * meta.height)
    const region = { left, top, width: Math.max(1, Math.min(Math.round(roi.width * meta.width), meta.width - left)), height: Math.max(1, Math.min(Math.round(roi.height * meta.height), meta.height - top)) }
    const W = region.width, H = region.height
    const g = await sharp(buf).extract(region).greyscale().raw().toBuffer()
    const bl = await sharp(buf).extract(region).greyscale().blur(3).raw().toBuffer()
    const cl = await sharp(buf).extract(region).greyscale().clahe({ width: 16, height: 16, maxSlope: 3 }).raw().toBuffer()
    const small = await sharp(buf).extract(region).resize(width, height, { fit: 'fill' }).greyscale().raw().toBuffer()
    small.copy(coarse, offC)
    const sob = new Float32Array(W * H)
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; const gx = -g[i - W - 1] + g[i - W + 1] - 2 * g[i - 1] + 2 * g[i + 1] - g[i + W - 1] + g[i + W + 1]; const gy = -g[i - W - 1] - 2 * g[i - W] - g[i - W + 1] + g[i + W - 1] + 2 * g[i + W] + g[i + W + 1]; sob[i] = Math.hypot(gx, gy) / 8 / 255 }
    for (let cy = 0; cy < height; cy++) for (let cx = 0; cx < width; cx++) {
      const x0 = Math.floor((cx / width) * W), x1 = Math.max(x0 + 1, Math.floor(((cx + 1) / width) * W)), y0 = Math.floor((cy / height) * H), y1 = Math.max(y0 + 1, Math.floor(((cy + 1) / height) * H))
      let n = 0, s1 = 0, s2 = 0, ss = 0, sh = 0, sc = 0
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * W + x, v = g[i] / 255; n++; s1 += v; s2 += v * v; ss += sob[i]; sh += Math.abs(g[i] - bl[i]) / 255; sc += cl[i] / 255 }
      const mean = s1 / n, c = offC + cy * width + cx
      stdMap[c] = Math.sqrt(Math.max(0, s2 / n - mean * mean)); sobMap[c] = ss / n; hpMap[c] = sh / n; clMap[c] = sc / n
    }
    regions.push({ name, W, H, g, cl, width, height })
    offC += width * height
  }
  return { coarse, stdMap, sobMap, hpMap, clMap, regions }
}

// ---- render helpers ----
let n = 0
async function png(raw, w, h, scale) { const f = join(OUT, `m${n++}.png`); await sharp(Buffer.from(raw), { raw: { width: w, height: h, channels: 1 } }).resize(Math.round(w * scale), Math.round(h * scale), { kernel: 'nearest' }).png().toFile(f); return f }
const q = (x) => Math.max(0, Math.min(255, Math.round(x)))
async function mapPng(map, region, [a], w, h, scale, mode) {
  const out = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) { const v = map[a + i]; out[i] = mode === 'signed' ? q(128 + v * 255) : mode === 'raw' ? q(v * 255) : q(v * 255 * 4) }
  return png(out, w, h, scale)
}

// ---- example frames ----
// Archived hand-labelled examples (one per lighting band; picked 2026-10-18).
const picks = {
  'night cars': ['webcams/bowen/2026-07-23/timelapse/22:30_To HSB_1784871791956.jpg'],
  'night empty': ['webcams/bowen/2026-07-19/timelapse/22:30_To HSB_1784525407238.jpg'],
  'high sun empty': ['webcams/bowen/2026-07-17/timelapse/18:00_To HSB_1784336357671.jpg'],
}
const bucket = 'https://storage.googleapis.com/bowen-ferry.firebasestorage.app/'
const sunday = join(CACHE, 'frames-2026-10-18-0845')
const examples = [
  { title: 'Sun 10-18 08:44 — empty, low sun (the complaint)', file: join(sunday, '1792338252544.jpg'), ts: 1792338252544, key: '2026-10-18_08:45_To HSB' },
  { title: 'Sun 10-18 08:35 — car loading, low sun', file: join(sunday, '1792337714623.jpg'), ts: 1792337714623, key: '2026-10-18_08:45_To HSB' },
  { title: 'Sat 10-17 18:00 — last frame, sunset (no verdict either way)', url: bucket + encodeURIComponent('webcams/bowen/2026-10-17/timelapse/18:00_To HSB_1792285225806.jpg').replace(/%2F/g, '/'), ts: 1792285225806, key: '2026-10-17_18:00_To HSB' },
  { title: 'night, cars (hand label)', path: picks['night cars'][0] },
  { title: 'night, empty (hand label)', path: picks['night empty'][0] },
  { title: 'high sun, empty (hand label)', path: picks['high sun empty'][0] },
]
const COLS = [['native crop', 'raw'], ['v5: minus frame mean', 'signed'], ['local std (recommended)', 'pos'], ['Sobel edges', 'pos'], ['high-pass', 'pos'], ['CLAHE mean', 'raw'], ['certified-empty diff', 'pos']]
let html = `<!doctype html><meta charset="utf-8"><style>body{font:12px -apple-system,sans-serif;margin:12px;background:#fff;width:2260px}h2{font-size:14px;margin:14px 0 4px}table{border-collapse:collapse}td{vertical-align:top;padding:2px 4px}th{font-weight:600;font-size:11px;text-align:left;padding:0 4px}img{display:block}.sm{color:#555;font-size:11px}.frame{width:240px}</style>
<h1 style="font-size:17px;margin:0">Terminal camera (webcams/bowen): what each feature pipeline sees</h1>
<p class="sm">Per example: full frame, then the near-lane box (top strip) and far-queue box (bottom strip) under each transform. Maps are per-cell on the model grid (32×18 / 20×18). v5 map: grey = frame mean, dark/bright = below/above it. Texture maps: brighter = more structure in that cell. Certified-empty diff: brighter = differs from every nearby hand-labelled empty frame after brightness matching. Masked cells (pole, walkway) are black.</p>`
for (const ex of examples) {
  let buf
  if (ex.file) buf = readFileSync(ex.file)
  else if (ex.url) buf = Buffer.from(await (await fetch(ex.url)).arrayBuffer())
  else { buf = readFileSync(join(DATA, 'frames', ex.path)); ex.ts = Number(/_(\d+)\.jpg$/.exec(ex.path)[1]); ex.key = ex.path.split('/').pop().replace(/_\d+\.jpg$/, '').replace(/^/, ex.path.split('/')[2] + '_') }
  const elev = solarElevation(ex.ts)
  const A = await analyse(buf)
  const v5p = v5(frameCenter(toUnit(A.coarse)))
  const texp = texModel(regionZ(A.stdMap, true))
  const rd = refDiff(A.coarse, elev, ex.key)
  const framePng = join(OUT, `f${n++}.png`); await sharp(buf).resize(240).png().toFile(framePng)
  html += `<h2>${ex.title} · sun ${elev.toFixed(0)}° · <b>v5 p ${v5p.toFixed(2)}</b> · <b>texture model p ${texp.toFixed(2)}</b></h2><p class="sm">empty references used: ${rd.refs.join(' · ')}</p><table><tr><th></th>${COLS.map((c) => `<th>${c[0]}</th>`).join('')}</tr>`
  for (let ri = 0; ri < TERMINAL_REGIONS.length; ri++) {
    const r = A.regions[ri], sp = spans[ri], scale = ri === 0 ? 1.5 : 1.8, ms = ri === 0 ? (r.W * scale) / r.width : (r.W * scale) / r.width
    const cells = []
    cells.push(await png(r.g, r.W, r.H, scale))
    cells.push(await mapPng(frameCenter(toUnit(A.coarse)), r, sp, r.width, r.height, ms, 'signed'))
    cells.push(await mapPng(A.stdMap, r, sp, r.width, r.height, ms, 'pos'))
    cells.push(await mapPng(A.sobMap, r, sp, r.width, r.height, ms, 'pos'))
    cells.push(await mapPng(A.hpMap, r, sp, r.width, r.height, ms, 'pos'))
    cells.push(await png(r.cl, r.W, r.H, scale))
    cells.push(await mapPng(rd.map, r, sp, r.width, r.height, ms, 'pos'))
    html += `<tr><td>${ri === 0 ? `<img class="frame" src="file://${framePng}"><div class="sm">${r.name}</div>` : `<div class="sm">${r.name}</div>`}</td>${cells.map((c) => `<td><img src="file://${c}"></td>`).join('')}</tr>`
  }
  html += '</table>'
}
writeFileSync(join(DATA, 'experiments/out/terminal-feature-sheet.html'), html)
console.log('written training-data/experiments/out/terminal-feature-sheet.html')
