// Replay the terminal camera's sailing-level rules over every tagged sailing
// in the frame archive, the standing check for any change to the rules or
// the model (Tom, 2026-10-19: re-run on the samples we have, the same way
// every time).
//
//   npm run terminal:replay                         # current rules, bundled model
//   npm run terminal:replay -- --baseline <json>    # …and list every sailing whose verdict moved
//   npm run terminal:replay -- --model <file.json>  # another model (e.g. functions/models/history/…)
//   npm run terminal:replay -- --out <json>         # where to write this run (default below)
//
// What it does, per To-HSB sailing with archived frames and a rider capacity
// tag (latest tag wins; training-data/tag-corrections.json removes known-bad
// tags): scores every frame through the deployed path — classifyTerminal()
// on the frame bytes, so the extractor, feature set and band members are
// exactly what the server runs — then applies terminalEmptyFrameTs (not
// full) and, when that is silent, terminalFullAtDeparture gated on the
// crosswalk (lineup-labels.js), reading the crosswalk from
// training-data/predictions.json (human mark, else the robot's detection).
// Per-frame scores are cached per model in training-data/experiments/cache/
// so a rule change replays in seconds; a new model scores the archive once.
//
// Prints per month: not-full flags on room-tagged sailings (coverage) and on
// Full-tagged ones (wrong); full flags on Full-tagged (coverage) and on
// room-tagged (wrong); then every wrong flag with its frame shape (C cars,
// . empty). Writes the run as JSON (default
// training-data/experiments/terminal-rules-replay.json, gitignored) so the
// next change can be diffed against it with --baseline. Keep the numbers
// that drive a decision in a docs/experiments write-up, not only here.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { classifyTerminal } from '../functions/lib/terminal-classifier.js'
import { terminalEmptyFrameTs, terminalFullAtDeparture } from '../functions/lib/lineup-labels.js'

const ROOT = join(import.meta.dirname, '..')
const DATA = join(ROOT, 'training-data')
const CACHE = join(DATA, 'experiments/cache')
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i === -1 ? dflt : process.argv[i + 1] }
const modelPath = arg('--model', join(ROOT, 'functions/models/terminal-cars-classifier.json'))
const outPath = arg('--out', join(DATA, 'experiments/terminal-rules-replay.json'))
const baselinePath = arg('--baseline', null)

const model = JSON.parse(readFileSync(modelPath, 'utf8'))
const modelId = `v${model.version}-${model.featureSet || 'brightness'}-${(model.trainedAt || '').slice(0, 19).replace(/[:T]/g, '')}`
let rule = 'unknown'
try { rule = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim() } catch { /* not a git checkout */ }

// --- frames and tags ---------------------------------------------------------
const bySailing = new Map()
for (const l of readFileSync(join(DATA, 'terminal-manifest.csv'), 'utf8').trim().split('\n').slice(1)) {
  const [path, sailingKey, ts] = l.split(',')
  if (!sailingKey.endsWith('_To HSB')) continue
  if (!bySailing.has(sailingKey)) bySailing.set(sailingKey, [])
  bySailing.get(sailingKey).push({ path, ts: Number(ts) })
}
const tagBySailing = new Map()
for (const t of JSON.parse(readFileSync(join(DATA, 'capacity-tags.json'), 'utf8'))) {
  if (!t.sailingKey?.endsWith('_To HSB')) continue
  const prev = tagBySailing.get(t.sailingKey)
  if (!prev || (t.recordedAt || 0) > (prev.recordedAt || 0)) tagBySailing.set(t.sailingKey, t)
}
if (existsSync(join(DATA, 'tag-corrections.json'))) {
  for (const k of Object.keys(JSON.parse(readFileSync(join(DATA, 'tag-corrections.json'), 'utf8')))) tagBySailing.delete(k)
}
const crosswalkBySailing = new Map()
if (existsSync(join(DATA, 'predictions.json'))) {
  for (const p of JSON.parse(readFileSync(join(DATA, 'predictions.json'), 'utf8')))
    crosswalkBySailing.set(p.sailingKey, p.humanCrosswalkTs ?? p.crosswalkDetectedTs ?? null)
}

// --- per-frame scores, cached per model -----------------------------------
mkdirSync(CACHE, { recursive: true })
const cachePath = join(CACHE, `terminal-replay-p-${modelId}.json`)
const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {}
let scored = 0, missing = 0
const t0 = Date.now()
for (const frames of bySailing.values()) {
  for (const f of frames) {
    if (typeof cache[f.path] === 'number') continue
    const file = join(DATA, 'frames', f.path)
    if (!existsSync(file)) { missing++; continue }
    const r = await classifyTerminal(readFileSync(file), model, { ts: f.ts })
    cache[f.path] = r ? Math.round(r.probability * 1e4) / 1e4 : null
    if (++scored % 2000 === 0) console.error(`  scored ${scored} frames…`)
  }
}
if (scored) {
  writeFileSync(cachePath, JSON.stringify(cache))
  console.error(`scored ${scored} new frames with ${modelId} in ${Math.round((Date.now() - t0) / 1000)}s (${missing} not on disk); cache ${cachePath}`)
}

// --- the rules ---------------------------------------------------------------
const threshold = model.threshold ?? 0.5
const sailings = {}
for (const [key, frames] of bySailing) {
  const tag = tagBySailing.get(key)
  if (!tag || frames.length < 2) continue
  frames.sort((a, b) => a.ts - b.ts)
  const seq = frames.map((f) => { const p = cache[f.path]; return { ts: f.ts, p, carsPresent: typeof p === 'number' ? p >= threshold : null } })
  if (seq.some((f) => f.carsPresent === null)) continue
  const emptyTs = terminalEmptyFrameTs(seq)
  const crosswalkOk = crosswalkBySailing.get(key) != null
  const fullAt = emptyTs == null && crosswalkOk ? terminalFullAtDeparture(seq) : null
  sailings[key] = {
    tag: tag.capacity,
    room: tag.capacity !== 'Full',
    verdict: emptyTs != null ? 'notFull' : fullAt != null ? 'full' : null,
    shape: seq.map((f) => (f.carsPresent ? 'C' : '.')).join(''),
    frames: seq.length,
  }
}

// --- report -----------------------------------------------------------------
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—')
const pad = (s, n) => String(s ?? '—').padEnd(n)
const padL = (s, n) => String(s ?? '—').padStart(n)
const keys = Object.keys(sailings).sort()
const months = [...new Set(keys.map((k) => k.slice(0, 7)))].sort()
console.log(`Terminal rules replay — rules at ${rule}, model ${modelId}, ${keys.length} tagged To-HSB sailings with archived frames`)
console.log(pad('month', 9) + padL('room/full', 10) + padL('nf on room', 13) + padL('nf on Full', 11) + padL('full on Full', 14) + padL('full on room', 13))
const out = { generatedAt: new Date().toISOString(), rule, model: modelId, months: {}, sailings }
for (const mo of [...months, 'ALL']) {
  const sl = keys.filter((k) => mo === 'ALL' || k.startsWith(mo)).map((k) => sailings[k])
  const room = sl.filter((s) => s.room), full = sl.filter((s) => !s.room)
  const row = {
    room: room.length, full: full.length,
    nfRoom: room.filter((s) => s.verdict === 'notFull').length, nfFull: full.filter((s) => s.verdict === 'notFull').length,
    fullFull: full.filter((s) => s.verdict === 'full').length, fullRoom: room.filter((s) => s.verdict === 'full').length,
  }
  out.months[mo] = row
  console.log(pad(mo, 9) + padL(`${row.room}/${row.full}`, 10) + padL(`${row.nfRoom} ${pct(row.nfRoom, row.room)}`, 13) + padL(row.nfFull, 11) + padL(`${row.fullFull} ${pct(row.fullFull, row.full)}`, 14) + padL(row.fullRoom, 13))
}
const wrong = keys.filter((k) => (sailings[k].verdict === 'notFull' && !sailings[k].room) || (sailings[k].verdict === 'full' && sailings[k].room))
console.log(`\nWrong flags (${wrong.length}):`)
for (const k of wrong) console.log(`  ${k}  ${pad(sailings[k].tag, 8)} ${pad(sailings[k].verdict, 7)} ${sailings[k].shape}`)

if (baselinePath) {
  const base = JSON.parse(readFileSync(baselinePath, 'utf8'))
  const moved = keys.filter((k) => base.sailings?.[k] && base.sailings[k].verdict !== sailings[k].verdict)
  console.log(`\nAgainst baseline (rules ${base.rule}, model ${base.model}): ${moved.length} sailings changed verdict`)
  for (const k of moved) {
    const s = sailings[k]
    const right = s.verdict == null ? '' : (s.verdict === 'notFull') === s.room ? '  ✓' : '  ✗ WRONG'
    console.log(`  ${k}  ${pad(s.tag, 8)} ${pad(base.sailings[k].verdict, 7)} → ${pad(s.verdict, 7)}${right}  ${s.shape}`)
  }
  out.baseline = { path: baselinePath, rule: base.rule, model: base.model, moved }
}
writeFileSync(outPath, JSON.stringify(out, null, 1))
console.log(`\nwrote ${outPath}`)
