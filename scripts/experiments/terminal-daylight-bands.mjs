// NOTE: run 2026-10-17 on the BRIGHTNESS feature set (per-cell brightness minus
// the frame mean, models v1–v8). terminal-features.js now extracts localStd-v1
// texture, so a fresh cache would measure a different thing; the cached
// training-data/experiments/cache/terminal-features.json holds the brightness
// features this write-up used. Write-up: docs/experiments/2026-10-17-terminal-daylight-bands.md
// Terminal-cars classifier: shipped v5 (and archived v6) scored per solar
// elevation band on all labeled terminal frames, by label source.
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const SCRATCH = join(REPO, 'training-data/experiments/cache')
const { extractTerminalFeatures, TERMINAL_FEATURE_LENGTH } = await import(REPO + '/functions/lib/terminal-features.js')
const { scoreTerminalFeatures } = await import(REPO + '/functions/lib/terminal-classifier.js')
const { solarElevation } = await import(REPO + '/functions/lib/daylight.js')
const DATA = join(REPO, 'training-data')
const cacheF = join(SCRATCH, 'terminal-features.json')
const cache = existsSync(cacheF) ? JSON.parse(readFileSync(cacheF, 'utf8')) : {}
const rows = []
for (const line of readFileSync(join(DATA, 'terminal-manifest.csv'), 'utf8').trim().split('\n').slice(1)) {
  const [path, sailingKey, ts, label, source] = line.split(',')
  if (label !== '0' && label !== '1') continue
  const file = join(DATA, 'frames', path)
  if (!existsSync(file)) continue
  let f = cache[path]
  if (!f) { try { f = Array.from(await extractTerminalFeatures(readFileSync(file)), (v) => Math.round(v * 255)) } catch { continue }; cache[path] = f }
  rows.push({ path, sailingKey, ts: Number(ts), y: Number(label), source, elev: solarElevation(Number(ts)), features: Float32Array.from(f, (v) => v / 255) })
}
writeFileSync(cacheF, JSON.stringify(cache))
console.log(`labeled terminal frames with pixels: ${rows.length} (hand ${rows.filter((r) => r.source === 'hand').length}, rider ${rows.filter((r) => r.source === 'rider').length})`)
const band = (e) => (e < -7 ? 'a <-7 dark' : e < 0 ? 'b -7..0 twilight' : e < 8 ? 'c 0..8' : e < 15 ? 'd 8..15' : e < 25 ? 'e 15..25' : e < 35 ? 'f 25..35' : 'g 35+')
const r3 = (n, d) => (d ? (n / d).toFixed(3) : '  -  ')
const hourVan = (ts) => new Date(ts).toLocaleString('en-CA', { timeZone: 'America/Vancouver', hour: '2-digit', hour12: false })
function table(title, set, m) {
  console.log(`\n== ${title} (threshold ${m.threshold}, emptyThreshold ${m.emptyThreshold})`)
  console.log('band              n   pos   P     R     acc   fp  fn  unsure%')
  for (const b of [...new Set(set.map((s) => band(s.elev)))].sort()) {
    const ss = set.filter((s) => band(s.elev) === b); let tp = 0, fp = 0, fn = 0, tn = 0, unsure = 0
    for (const s of ss) { const p = scoreTerminalFeatures(s.features, m); const yh = p >= m.threshold ? 1 : 0; if (p < m.threshold && p >= m.emptyThreshold) unsure++; if (yh && s.y) tp++; else if (yh && !s.y) fp++; else if (!yh && s.y) fn++; else tn++ }
    console.log(`${b.padEnd(17)} ${String(ss.length).padStart(4)} ${String(tp + fn).padStart(5)}  ${r3(tp, tp + fp)} ${r3(tp, tp + fn)} ${r3(tp + tn, ss.length)} ${String(fp).padStart(3)} ${String(fn).padStart(3)}  ${(100 * unsure / ss.length).toFixed(0)}%`)
  }
}
const v5 = JSON.parse(readFileSync(join(REPO, 'functions/models/terminal-cars-classifier.json'), 'utf8'))
const v6 = JSON.parse(readFileSync(join(REPO, 'functions/models/history/terminal-cars-classifier-v6.json'), 'utf8'))
table(`shipped terminal v${v5.version} — HAND labels (its own training data)`, rows.filter((r) => r.source === 'hand'), v5)
table(`shipped terminal v${v5.version} — RIDER labels (out-of-sample; riders were steered to frames v5 found unsure)`, rows.filter((r) => r.source === 'rider'), v5)
table(`archived terminal v${v6.version} — RIDER labels`, rows.filter((r) => r.source === 'rider'), v6)
// morning hours: rider-label error rate by hour
{
  const set = rows.filter((r) => r.source === 'rider'); const h = {}
  for (const s of set) { const k = hourVan(s.ts); h[k] ??= { n: 0, err: 0, fp: 0, fn: 0 }; h[k].n++; const yh = scoreTerminalFeatures(s.features, v5) >= v5.threshold ? 1 : 0; if (yh !== s.y) { h[k].err++; if (yh) h[k].fp++; else h[k].fn++ } }
  console.log('\nrider-labeled frames: v5 error rate by hour (Vancouver)')
  console.log(Object.entries(h).sort().map(([k, v]) => `${k}h n=${String(v.n).padStart(3)} err=${(100 * v.err / v.n).toFixed(0)}% (fp ${v.fp}, fn ${v.fn})`).join('\n'))
}
// dark frames: rider label distribution + model
{
  const set = rows.filter((r) => r.elev < -7)
  console.log(`\ndark terminal frames labeled: ${set.length}, positive ${set.filter((s) => s.y).length}; by week:`)
  const w = {}; for (const s of set) { const d = s.sailingKey.slice(0, 10); w[d] = (w[d] || 0) + 1 }
  console.log(Object.entries(w).sort().map(([k, v]) => `${k}:${v}`).join(' '))
}
