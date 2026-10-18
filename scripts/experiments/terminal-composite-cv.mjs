// NOTE: run 2026-10-17 on the BRIGHTNESS feature set (per-cell brightness minus
// the frame mean, models v1–v8). terminal-features.js now extracts localStd-v1
// texture, so a fresh cache would measure a different thing; the cached
// training-data/experiments/cache/terminal-features.json holds the brightness
// features this write-up used. Write-up: docs/experiments/2026-10-17-composites-day-and-terminal.md
// Tom (2026-10-17): try stable-pixel composites on the TERMINAL (front of
// lineup) camera too — its departure timelapse runs at ~1-minute spacing, so
// a standing queue barely moves between frames while loading/leaving cars do.
// Same recipe as scripts/train-terminal-classifier.mjs (logistic, epochs 300,
// lr 0.5, l2 1e-4, masked features, by-sailing split), 5-fold CV, frame
// P/R/F1 overall and by solar-elevation band. Variants: raw frames, composite
// of the trailing 3 frames, composite of 5. Composites at the camera's native
// 320×240 with the shared window rule (same exposure mode + level, ≤ 7 min).
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const CACHE = join(REPO, 'training-data/experiments/cache')
const { extractTerminalFeatures, TERMINAL_FEATURE_LENGTH: N, TERMINAL_FEATURE_MASK } = await import(REPO + '/functions/lib/terminal-features.js')
const { compositeWindow, compositeStable, greyToJpeg, COMPOSITE } = await import(REPO + '/functions/lib/lineup-features.js')
const { solarElevation } = await import(REPO + '/functions/lib/daylight.js')
const DATA = join(REPO, 'training-data')
const W = 320, H = 240

const bySailing = new Map(), rows = []
for (const line of readFileSync(join(DATA, 'terminal-manifest.csv'), 'utf8').trim().split('\n').slice(1)) {
  const [path, sailingKey, ts, label, source] = line.split(',')
  const file = join(DATA, 'frames', path); if (!existsSync(file)) continue
  const r = { path, sailingKey, ts: Number(ts), y: label === '0' ? 0 : label === '1' ? 1 : null, source, elev: solarElevation(Number(ts)), file }
  if (!bySailing.has(sailingKey)) bySailing.set(sailingKey, []); bySailing.get(sailingKey).push(r); rows.push(r)
}
for (const l of bySailing.values()) l.sort((a, b) => a.ts - b.ts)
const labeled = rows.filter((r) => r.y != null)

// --- features, cached per variant ------------------------------------------------
const rawCache = JSON.parse(readFileSync(join(CACHE, 'terminal-features.json'), 'utf8'))
const rawF = (p) => Float32Array.from(rawCache[p], (v) => v / 255)
async function compositeFeatures(k) {
  const file = join(CACHE, `terminal-composite-k${k}.json`)
  const cache = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
  let n = 0
  for (const r of labeled) {
    if (cache[r.path]) continue
    const list = bySailing.get(r.sailingKey), i = list.indexOf(r)
    const win = [r]; for (let j = i - 1; j >= 0 && win.length < k; j--) { if (win[0].ts - list[j].ts > COMPOSITE.maxGapMs) break; win.unshift(list[j]) }
    try {
      const { greys } = await compositeWindow(win.map((w) => readFileSync(w.file)), { width: W, height: H })
      const f = await extractTerminalFeatures(await greyToJpeg(compositeStable(greys), { width: W, height: H }))
      cache[r.path] = { f: Array.from(f, (v) => Math.round(v * 255)), used: greys.length }
    } catch (e) { cache[r.path] = null }
    if (++n % 300 === 0) console.error(`k=${k}: ${n} composited`)
  }
  writeFileSync(file, JSON.stringify(cache))
  return { feat: (p) => (cache[p] ? Float32Array.from(cache[p].f, (v) => v / 255) : null), used: (p) => cache[p]?.used }
}
const c3 = await compositeFeatures(3), c5 = await compositeFeatures(5)

// --- CV -----------------------------------------------------------------------------
const sigmoid = (z) => 1 / (1 + Math.exp(-z))
function trainLR(set, feat, { epochs = 300, lr = 0.5, l2 = 1e-4 } = {}) {
  const X = set.map((s) => feat(s.path)); const w = new Float64Array(N); let b = 0; const n = set.length
  for (let e = 0; e < epochs; e++) {
    const gw = new Float64Array(N); let gb = 0
    for (let j = 0; j < n; j++) { const f = X[j]; let z = b; for (let i = 0; i < N; i++) z += w[i] * f[i]; const err = sigmoid(z) - set[j].y; for (let i = 0; i < N; i++) gw[i] += err * f[i]; gb += err }
    for (let i = 0; i < N; i++) w[i] = TERMINAL_FEATURE_MASK[i] ? w[i] - lr * (gw[i] / n + l2 * w[i]) : 0
    b -= lr * (gb / n)
  }
  return (f) => { let z = b; for (let i = 0; i < N; i++) z += w[i] * f[i]; return sigmoid(z) }
}
const band = (e) => (e < -7 ? 'a <-7 dark' : e < 0 ? 'b -7..0 twilight' : e < 8 ? 'c 0..8' : e < 25 ? 'd 8..25' : 'e 25+')
const fold = (k) => createHash('md5').update(k).digest()[0] % 5
// Variants are "scorers": given the training split they return a function
// (sample → probability). Single models use one feature type everywhere; the
// banded ones mirror the shipped v8 (two members split at 0°, trained with
// ±6° overlap) and may use different features per band — which is the
// question Tom asked after the first run: do composites help the low-sun
// member, where headlights are the problem, without hurting daylight?
const GATE = 0, OV = 6
const single = (feat) => (train) => { const sc = trainLR(train, feat); return (s) => sc(feat(s.path)) }
const banded = (lowFeat, highFeat) => (train) => {
  const lo = trainLR(train.filter((s) => s.elev < GATE + OV), lowFeat)
  const hi = trainLR(train.filter((s) => s.elev >= GATE - OV), highFeat)
  return (s) => (s.elev < GATE ? lo(lowFeat(s.path)) : hi(highFeat(s.path)))
}
const variants = {
  'single, raw frames': single(rawF),
  'single, composite k=3': single(c3.feat),
  'single, composite k=5': single(c5.feat),
  'banded @0°, raw / raw (= shipped v8 recipe)': banded(rawF, rawF),
  'banded @0°, composite k=3 below / raw above': banded(c3.feat, rawF),
  'banded @0°, composite k=5 below / raw above': banded(c5.feat, rawF),
  'banded @0°, composite k=3 / composite k=3': banded(c3.feat, c3.feat),
}
const usable = labeled.filter((r) => c3.feat(r.path) && c5.feat(r.path))
const res = {}
for (let k = 0; k < 5; k++) {
  const train = usable.filter((s) => fold(s.sailingKey) !== k), test = usable.filter((s) => fold(s.sailingKey) === k)
  for (const [name, make] of Object.entries(variants)) {
    const sc = make(train); res[name] ??= {}
    for (const s of test) { const yh = sc(s) >= 0.5 ? 1 : 0; const b = band(s.elev); const r = (res[name][b] ??= { tp: 0, fp: 0, fn: 0, n: 0 }); r.n++; if (yh && s.y) r.tp++; else if (yh && !s.y) r.fp++; else if (!yh && s.y) r.fn++ }
  }
  console.error(`fold ${k} done`)
}
const r3 = (n, d) => (d ? (n / d).toFixed(3) : '  -  ')
const used3 = {}; for (const r of usable) { const u = c3.used(r.path); used3[u] = (used3[u] || 0) + 1 }
console.log(`\nTerminal-cars model, 5-fold CV by sailing, ${usable.length} labeled frames (k=3 window actually used: ${JSON.stringify(used3)})`)
for (const [name, bands] of Object.entries(res)) {
  const T = { tp: 0, fp: 0, fn: 0, n: 0 }; const lines = []
  for (const [b, r] of Object.entries(bands).sort()) { lines.push(`   ${b.padEnd(17)} n=${String(r.n).padStart(4)} P=${r3(r.tp, r.tp + r.fp)} R=${r3(r.tp, r.tp + r.fn)} fp=${String(r.fp).padStart(3)} fn=${String(r.fn).padStart(3)}`); T.tp += r.tp; T.fp += r.fp; T.fn += r.fn; T.n += r.n }
  const P = T.tp / (T.tp + T.fp), R = T.tp / (T.tp + T.fn)
  console.log(`${name}: P=${P.toFixed(3)} R=${R.toFixed(3)} F1=${((2 * P * R) / (P + R)).toFixed(3)} fp=${T.fp} fn=${T.fn}`); console.log(lines.join('\n'))
}
