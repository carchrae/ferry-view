// Every archived model version, re-run over the WHOLE frame archive on disk
// (Tom, 2026-10-18): are successive versions converging on something better,
// or is each one tuned to its season? Do the versions agree with each other?
//
// Terminal-cars: brightness versions v5–v8 are scored from the cached raw
// cell brightness (the experiment cache, frame-mean-centred, masked cells 0 —
// the pre-2026-10-18 extractor), texture versions v9+ from the cached
// per-cell std (localStd-v1; matches the shipped extractor to 0.003 in score).
// Crosswalk: every version shares the feature geometry, so all are scored on
// the cached deployed features.
//
// Per ISO week: frame accuracy against hand + rider labels per version;
// sailing-level rules against rider capacity tags per version (terminal) and
// the sequence severity against crosswalk marks (lineup); pairwise decision
// agreement between versions over all frames.
//
//   node scripts/experiments/model-history-report.mjs
// Caches come from terminal-features-experiment.mjs and lineup-drift-eval.mjs
// (run those first if training-data/experiments/cache/ is empty).
// Write-up: docs/experiments/2026-10-18-model-history-report.md
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { TERMINAL_REGIONS, TERMINAL_FEATURE_MASK, TERMINAL_FEATURE_LENGTH } from '../../functions/lib/terminal-features.js'
import { standardizeRegions } from '../../functions/lib/terminal-feature-math.js'
import { scoreWithMembers } from '../../functions/lib/model-members.js'
import { sameGeometry, sameMasks } from '../../functions/lib/model-geometry.js'
import { solarElevation, isDarkAt } from '../../functions/lib/daylight.js'
import { terminalEmptyFrameTs, FULL_TAIL_FRAMES, FULL_CONFIDENT_P, effectiveCrosswalk, firstSustainedPositiveTs } from '../../functions/lib/lineup-labels.js'
import { FEATURE_LENGTH } from '../../functions/lib/lineup-features.js'

const ROOT = join(import.meta.dirname, '../..')
const DATA = join(ROOT, 'training-data')
const CACHE = join(DATA, 'experiments/cache')
const HIST = join(ROOT, 'functions/models/history')
const out = { generatedAt: new Date().toISOString(), terminal: {}, lineup: {} }

const isoWeek = (ts) => { const dt = new Date(ts); const day = (dt.getUTCDay() + 6) % 7; dt.setUTCDate(dt.getUTCDate() - day + 3); const y1 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4)); const wk = 1 + Math.round(((dt - y1) / 864e5 - 3 + ((y1.getUTCDay() + 6) % 7)) / 7); return `${dt.getUTCFullYear()}-W${String(wk).padStart(2, '0')}` }
const r3 = (n, d) => (d ? Math.round((n / d) * 1000) / 1000 : null)
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—')
const pad = (s, n) => String(s ?? '—').padEnd(n)
const padL = (s, n) => String(s ?? '—').padStart(n)
function frameMetrics(set, key) {
  let tp = 0, fp = 0, fn = 0, tn = 0
  for (const s of set) { const yh = s.dec[key]; if (yh && s.y) tp++; else if (yh && !s.y) fp++; else if (!yh && s.y) fn++; else tn++ }
  return { n: set.length, acc: r3(tp + tn, set.length), P: r3(tp, tp + fp), R: r3(tp, tp + fn), fp, fn }
}
function agreementMatrix(frames, keys) {
  const m = {}
  for (const a of keys) { m[a] = {}; for (const b of keys) { let agree = 0; for (const f of frames) if (f.dec[a] === f.dec[b]) agree++; m[a][b] = r3(agree, frames.length) } }
  return m
}
function printMatrix(title, m, keys) {
  console.log(`\n${title}`)
  console.log('        ' + keys.map((k) => padL(k, 6)).join(''))
  for (const a of keys) console.log(padL(a, 7) + ' ' + keys.map((b) => padL(a === b ? '·' : m[a][b].toFixed(2), 6)).join(''))
}
const models = (prefix) => readdirSync(HIST).filter((f) => f.startsWith(prefix)).map((f) => JSON.parse(readFileSync(join(HIST, f), 'utf8'))).sort((a, b) => a.version - b.version)

// ============================ TERMINAL ======================================
{
  const N = TERMINAL_FEATURE_LENGTH, STATS = 4
  const rawIdx = JSON.parse(readFileSync(join(CACHE, 'terminal-raw-index.json'), 'utf8'))
  const rawBuf = readFileSync(join(CACHE, 'terminal-raw-coarse.u8'))
  const stIdx = JSON.parse(readFileSync(join(CACHE, 'terminal-stats-index.json'), 'utf8'))
  const stBuf = readFileSync(join(CACHE, 'terminal-stats.u8'))
  const rows = readFileSync(join(DATA, 'terminal-manifest.csv'), 'utf8').trim().split('\n').slice(1).map((l) => { const [path, sailingKey, ts, label, source] = l.split(','); return { path, sailingKey, ts: Number(ts), y: label === '0' ? 0 : label === '1' ? 1 : null, source: source || null } })
  const frames = rows.filter((r) => rawIdx[r.path] >= 0 && stIdx[r.path] >= 0)
  // brightness features as the old extractor made them: cell mean brightness
  // (0..1) minus the frame mean over unmasked cells, masked cells 0.
  const bright = (f) => { const i = rawIdx[f.path]; const v = new Float32Array(N); let m = 0, k = 0; for (let c = 0; c < N; c++) { v[c] = rawBuf[i * N + c] / 255; if (TERMINAL_FEATURE_MASK[c]) { m += v[c]; k++ } } m /= k || 1; for (let c = 0; c < N; c++) v[c] = TERMINAL_FEATURE_MASK[c] ? v[c] - m : 0; return v }
  const texture = (f) => { const i = stIdx[f.path]; const v = new Float32Array(N); for (let c = 0; c < N; c++) v[c] = stBuf[i * STATS * N + c] / 1020; return standardizeRegions(v, TERMINAL_REGIONS, TERMINAL_FEATURE_MASK) }
  const versions = models('terminal-cars-classifier-v').filter((m) => m.weights.length === N && sameGeometry(m.regions, TERMINAL_REGIONS) && sameMasks(m.masks, TERMINAL_REGIONS && m.masks ? m.masks : m.masks) && (m.masks || []).length === 2)
  const keys = versions.map((m) => `v${m.version}`)
  console.log(`\n######## TERMINAL-CARS: ${frames.length} frames on disk, versions ${keys.join(' ')} (${versions.map((m) => m.featureSet || 'brightness').join('/')})`)
  for (const f of frames) {
    f.dec = {}; f.p = {}
    const fb = bright(f), ft = texture(f)
    for (const m of versions) { const p = scoreWithMembers(m, m.featureSet ? ft : fb, f.ts); f.p[`v${m.version}`] = p; f.dec[`v${m.version}`] = p >= (m.threshold ?? 0.5) ? 1 : 0 }
    f.week = isoWeek(f.ts)
  }
  const labeled = frames.filter((f) => f.y != null)
  const weeks = [...new Set(frames.map((f) => f.week))].sort()
  console.log(`\nFrame accuracy on labelled frames per ISO week (hand+rider), by version; labels: ${labeled.length}`)
  console.log(pad('week', 9) + padL('n', 5) + keys.map((k) => padL(k, 7)).join(''))
  out.terminal.weeks = {}
  for (const w of weeks) {
    const set = labeled.filter((f) => f.week === w)
    if (!set.length) continue
    out.terminal.weeks[w] = { n: set.length }
    for (const k of keys) out.terminal.weeks[w][k] = frameMetrics(set, k)
    console.log(pad(w, 9) + padL(set.length, 5) + keys.map((k) => padL(out.terminal.weeks[w][k].acc?.toFixed(3), 7)).join(''))
  }
  const periods = { 'July (hand)': (f) => f.ts < Date.UTC(2026, 7, 1), 'Aug': (f) => f.ts >= Date.UTC(2026, 7, 1) && f.ts < Date.UTC(2026, 8, 1), 'Sep': (f) => f.ts >= Date.UTC(2026, 8, 1) && f.ts < Date.UTC(2026, 9, 1), 'Oct': (f) => f.ts >= Date.UTC(2026, 9, 1) }
  console.log(`\nFrame P / R per period and version`)
  out.terminal.periods = {}
  for (const [name, pred] of Object.entries(periods)) {
    const set = labeled.filter(pred); if (!set.length) continue
    out.terminal.periods[name] = { n: set.length }
    const cells = keys.map((k) => { const m = frameMetrics(set, k); out.terminal.periods[name][k] = m; return padL(`${m.P?.toFixed(2)}/${m.R?.toFixed(2)}`, 11) })
    console.log(pad(name, 12) + padL(set.length, 5) + cells.join(''))
  }
  // sailing level against rider capacity tags
  const tagBySailing = new Map()
  for (const t of JSON.parse(readFileSync(join(DATA, 'capacity-tags.json'), 'utf8'))) { if (!t.sailingKey?.endsWith('_To HSB')) continue; const prev = tagBySailing.get(t.sailingKey); if (!prev || (t.recordedAt || 0) > (prev.recordedAt || 0)) tagBySailing.set(t.sailingKey, t) }
  try { for (const k of Object.keys(JSON.parse(readFileSync(join(DATA, 'tag-corrections.json'), 'utf8')))) tagBySailing.delete(k) } catch {}
  const bySailing = new Map()
  for (const f of frames) { if (!bySailing.has(f.sailingKey)) bySailing.set(f.sailingKey, []); bySailing.get(f.sailingKey).push(f) }
  for (const fr of bySailing.values()) fr.sort((a, b) => a.ts - b.ts)
  const month = (k) => k.slice(0, 7)
  console.log(`\nSailing-level rules per month and version: room-tagged sailings flagged not-full | wrong not-full on Full-tagged | "cars to the end" on room-tagged`)
  out.terminal.sailings = {}
  const months = [...new Set([...bySailing.keys()].map(month))].sort()
  const sailingDecision = {}
  for (const [key, fr] of bySailing) {
    const tag = tagBySailing.get(key); if (!tag || fr.length < 2) continue
    sailingDecision[key] = { month: month(key), room: tag.capacity !== 'Full', nf: {}, carsEnd: {} }
    for (const k of keys) {
      sailingDecision[key].nf[k] = terminalEmptyFrameTs(fr.map((f) => ({ ts: f.ts, carsPresent: f.dec[k] === 1 }))) != null
      const tail = fr.slice(-FULL_TAIL_FRAMES)
      sailingDecision[key].carsEnd[k] = tail.length === FULL_TAIL_FRAMES && tail.every((f) => f.p[k] >= FULL_CONFIDENT_P)
    }
  }
  for (const mo of [...months, 'ALL']) {
    const sl = Object.values(sailingDecision).filter((s) => mo === 'ALL' || s.month === mo)
    const room = sl.filter((s) => s.room), full = sl.filter((s) => !s.room)
    if (!sl.length) continue
    out.terminal.sailings[mo] = { room: room.length, full: full.length }
    const cells = keys.map((k) => { const flagged = room.filter((s) => s.nf[k]).length, wrong = full.filter((s) => s.nf[k]).length, ce = room.filter((s) => s.carsEnd[k]).length; out.terminal.sailings[mo][k] = { flagged, wrong, carsEnd: ce }; return padL(`${pct(flagged, room.length)}|${wrong}|${pct(ce, room.length)}`, 14) })
    console.log(pad(mo, 8) + padL(`${room.length}r/${full.length}f`, 10) + cells.join(''))
  }
  // sailing-level agreement: same not-full decision
  const sKeys = Object.keys(sailingDecision)
  const sAgree = {}
  for (const a of keys) { sAgree[a] = {}; for (const b of keys) { let ag = 0; for (const k of sKeys) if (sailingDecision[k].nf[a] === sailingDecision[k].nf[b]) ag++; sAgree[a][b] = r3(ag, sKeys.length) } }
  out.terminal.frameAgreement = agreementMatrix(frames, keys)
  out.terminal.sailingAgreement = sAgree
  printMatrix(`Pairwise FRAME decision agreement over all ${frames.length} frames`, out.terminal.frameAgreement, keys)
  printMatrix(`Pairwise SAILING not-full agreement over ${sKeys.length} tagged sailings`, sAgree, keys)
}

// ============================ LINEUP (crosswalk) ============================
{
  const idx = JSON.parse(readFileSync(join(CACHE, 'features-index.json'), 'utf8'))
  const bin = readFileSync(join(CACHE, 'features.bin'))
  const pos = new Map(idx.map((p, i) => [p, i]))
  const rows = readFileSync(join(DATA, 'manifest.csv'), 'utf8').trim().split('\n').slice(1).map((l) => { const [path, sailingKey, ts, label, crosswalkAt] = l.split(','); return { path, sailingKey, ts: Number(ts), y: label === '0' ? 0 : label === '1' ? 1 : null, crosswalkAt: crosswalkAt ? Number(crosswalkAt) : null } })
  const frames = rows.filter((r) => pos.has(r.path))
  const missing = rows.length - frames.length
  const versions = models('lineup-classifier-v').filter((m) => m.weights.length === FEATURE_LENGTH)
  const keys = versions.map((m) => `v${m.version}`)
  console.log(`\n\n######## CROSSWALK (lineup): ${frames.length} cached frames (${missing} manifest rows not in cache), versions ${keys.join(' ')}`)
  for (const f of frames) {
    const i = pos.get(f.path)
    const x = Float32Array.from(bin.subarray(i * FEATURE_LENGTH, (i + 1) * FEATURE_LENGTH), (v) => v / 255)
    f.dark = isDarkAt(f.ts); f.week = isoWeek(f.ts); f.dec = {}; f.p = {}
    for (const m of versions) { const p = scoreWithMembers(m, x, f.ts); f.p[`v${m.version}`] = p; f.dec[`v${m.version}`] = p >= (m.threshold ?? 0.7) ? 1 : 0 }
  }
  const lit = frames.filter((f) => !f.dark)
  const labeled = lit.filter((f) => f.y != null)
  const weeks = [...new Set(labeled.map((f) => f.week))].sort()
  console.log(`\nFrame accuracy on labelled DAYLIGHT frames per ISO week, by version; labels: ${labeled.length}`)
  console.log(pad('week', 9) + padL('n', 5) + keys.map((k) => padL(k, 7)).join(''))
  out.lineup.weeks = {}
  for (const w of weeks) {
    const set = labeled.filter((f) => f.week === w); if (!set.length) continue
    out.lineup.weeks[w] = { n: set.length }
    for (const k of keys) out.lineup.weeks[w][k] = frameMetrics(set, k)
    console.log(pad(w, 9) + padL(set.length, 5) + keys.map((k) => padL(out.lineup.weeks[w][k].acc?.toFixed(3), 7)).join(''))
  }
  // sequence severity per month
  const refuted = new Set()
  { const byKey = new Map(); for (const r of JSON.parse(readFileSync(join(DATA, 'lineup-reports.json'), 'utf8'))) { if (r.deleted) continue; if (!byKey.has(r.sailingKey)) byKey.set(r.sailingKey, []); byKey.get(r.sailingKey).push(r) }
    for (const [k, l] of byKey) if (effectiveCrosswalk(l)?.notYet) refuted.add(k) }
  const groups = new Map()
  for (const f of frames) { if (!groups.has(f.sailingKey)) groups.set(f.sailingKey, []); groups.get(f.sailingKey).push(f) }
  for (const g of groups.values()) g.sort((a, b) => a.ts - b.ts)
  const SEQ_COSTS = { phantom: 10, early30: 6, early10: 2, late10: 1, late30: 2, missed: 2 }
  const detection = {}
  for (const [key, fr] of groups) {
    const l = fr.filter((f) => !f.dark); if (l.length < 2) continue
    detection[key] = { month: key.slice(0, 7), human: fr[0].crosswalkAt, refuted: refuted.has(key), det: {} }
    for (const k of keys) detection[key].det[k] = firstSustainedPositiveTs(l.map((f) => ({ ts: f.ts, positive: f.dec[k] === 1 })))
  }
  function severity(sailings, k) {
    const c = { phantom: 0, early30: 0, early10: 0, agree: 0, late10: 0, late30: 0, missed: 0, unknown: 0 }
    for (const s of sailings) {
      const det = s.det[k], human = s.human
      if (det == null) { if (human != null) c.missed++; continue }
      if (human == null) { if (s.refuted) c.phantom++; else c.unknown++; continue }
      const d = (det - human) / 60000
      if (d <= -30) c.early30++; else if (d <= -10) c.early10++; else if (d < 10) c.agree++; else if (d < 30) c.late10++; else c.late30++
    }
    c.cost = Object.entries(SEQ_COSTS).reduce((a, [kk, w]) => a + w * c[kk], 0)
    return c
  }
  const months = [...new Set(Object.values(detection).map((s) => s.month))].sort()
  console.log(`\nSequence severity per month and version: cost (agree/missed/phantom)`)
  out.lineup.severity = {}
  for (const mo of [...months, 'ALL']) {
    const sl = Object.values(detection).filter((s) => mo === 'ALL' || s.month === mo); if (!sl.length) continue
    out.lineup.severity[mo] = { sailings: sl.length, marked: sl.filter((s) => s.human != null).length, refuted: sl.filter((s) => s.refuted).length }
    const cells = keys.map((k) => { const c = severity(sl, k); out.lineup.severity[mo][k] = c; return padL(`${c.cost} (${c.agree}/${c.missed}/${c.phantom})`, 16) })
    console.log(pad(mo, 8) + padL(`${sl.length}s`, 6) + cells.join(''))
  }
  // detection agreement between versions: both detect within 10 min, or both don't
  const dKeys = Object.keys(detection)
  const dAgree = {}
  for (const a of keys) { dAgree[a] = {}; for (const b of keys) { let ag = 0; for (const k of dKeys) { const x = detection[k].det[a], y = detection[k].det[b]; if ((x == null && y == null) || (x != null && y != null && Math.abs(x - y) < 10 * 60000)) ag++ } dAgree[a][b] = r3(ag, dKeys.length) } }
  out.lineup.frameAgreement = agreementMatrix(lit, keys)
  out.lineup.detectionAgreement = dAgree
  printMatrix(`Pairwise FRAME decision agreement over ${lit.length} daylight frames`, out.lineup.frameAgreement, keys)
  printMatrix(`Pairwise DETECTION agreement (same sailing detected within 10 min, or neither) over ${dKeys.length} sailings`, dAgree, keys)
}
writeFileSync(join(DATA, 'experiments/model-history-report.json'), JSON.stringify(out, null, 1))
console.log('\nwritten training-data/experiments/model-history-report.json')
