// Archive replay: the one-way EMPTY-GAP not-full rule (2026-10-19) against
// the 2026-08-16 TAIL rule it replaces, on every tagged To-HSB sailing in
// the frame archive, scored by the live terminal model (bundled v11).
//
// Question (Tom, 2026-10-19): the 05:15 that morning had three cars frames,
// two empties, then a late car on the departure frame; the tail rule
// withdrew the Not Full it had stamped at the empties. Cars after an empty
// gap are late arrivals and must not undo the verdict — so what does making
// the rule one-way again cost (wrong flags on Full-tagged sailings) and buy
// (coverage of room-tagged sailings)?
//
//   node scripts/experiments/empty-gap-one-way.mjs
// Reads the texture feature cache from terminal-features-experiment.mjs
// (training-data/experiments/cache/terminal-stats*.{u8,json}), the frame
// manifest and capacity tags from the lineup export. Writes
// docs/experiments/2026-10-19-empty-gap-one-way-results.json.
// Write-up: docs/experiments/2026-10-19-empty-gap-one-way.md
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TERMINAL_REGIONS, TERMINAL_FEATURE_MASK, TERMINAL_FEATURE_LENGTH } from '../../functions/lib/terminal-features.js'
import { standardizeRegions } from '../../functions/lib/terminal-feature-math.js'
import { scoreWithMembers } from '../../functions/lib/model-members.js'
import {
  terminalEmptyFrameTs,
  terminalFullAtDeparture,
  MIN_ALL_EMPTY_FRAMES,
} from '../../functions/lib/lineup-labels.js'

const ROOT = join(import.meta.dirname, '../..')
const DATA = join(ROOT, 'training-data')
const CACHE = join(DATA, 'experiments/cache')
const OUT = join(ROOT, 'docs/experiments/2026-10-19-empty-gap-one-way-results.json')

// The 2026-08-16 tail rule, verbatim (lineup-labels.js before this change):
// the confirming pair must follow the LAST solid cars frame.
function tailRule(list) {
  const solid = (i) =>
    list[i]?.carsPresent === true &&
    (list[i - 1]?.carsPresent === true || list[i + 1]?.carsPresent === true)
  let lastSolid = -1
  for (let i = 0; i < list.length; i++) if (solid(i)) lastSolid = i
  const carsSeen = lastSolid >= 0
  let observedEmpty = 0
  for (let i = 0; i <= lastSolid; i++) if (list[i]?.carsPresent === false) observedEmpty++
  let run = 0
  for (let i = lastSolid + 1; i < list.length; i++) {
    if (list[i]?.carsPresent === false) {
      observedEmpty++
      run++
    } else {
      run = 0
      continue
    }
    if (run >= 2 && (carsSeen || observedEmpty >= MIN_ALL_EMPTY_FRAMES) && typeof list[i].ts === 'number') return list[i].ts
  }
  return null
}

const model = JSON.parse(readFileSync(join(ROOT, 'functions/models/terminal-cars-classifier.json'), 'utf8'))
if (model.featureSet !== 'localStd-v1') throw new Error('expected a texture model')
const N = TERMINAL_FEATURE_LENGTH, STATS = 4
const stIdx = JSON.parse(readFileSync(join(CACHE, 'terminal-stats-index.json'), 'utf8'))
const stBuf = readFileSync(join(CACHE, 'terminal-stats.u8'))
const texture = (path) => {
  const i = stIdx[path]
  const v = new Float32Array(N)
  for (let c = 0; c < N; c++) v[c] = stBuf[i * STATS * N + c] / 1020
  return standardizeRegions(v, TERMINAL_REGIONS, TERMINAL_FEATURE_MASK)
}
const rows = readFileSync(join(DATA, 'terminal-manifest.csv'), 'utf8').trim().split('\n').slice(1)
  .map((l) => { const [path, sailingKey, ts] = l.split(','); return { path, sailingKey, ts: Number(ts) } })
  .filter((r) => stIdx[r.path] >= 0)

const tagBySailing = new Map()
for (const t of JSON.parse(readFileSync(join(DATA, 'capacity-tags.json'), 'utf8'))) {
  if (!t.sailingKey?.endsWith('_To HSB')) continue
  const prev = tagBySailing.get(t.sailingKey)
  if (!prev || (t.recordedAt || 0) > (prev.recordedAt || 0)) tagBySailing.set(t.sailingKey, t)
}
try {
  for (const k of Object.keys(JSON.parse(readFileSync(join(DATA, 'tag-corrections.json'), 'utf8')))) tagBySailing.delete(k)
} catch {
  // no corrections file — every tag counts
}

const bySailing = new Map()
for (const r of rows) { if (!bySailing.has(r.sailingKey)) bySailing.set(r.sailingKey, []); bySailing.get(r.sailingKey).push(r) }

const sailings = []
for (const [key, fr] of bySailing) {
  const tag = tagBySailing.get(key)
  if (!tag || fr.length < 2) continue
  fr.sort((a, b) => a.ts - b.ts)
  const seq = fr.map((f) => { const p = scoreWithMembers(model, texture(f.path), f.ts); return { ts: f.ts, p, carsPresent: p >= (model.threshold ?? 0.5) } })
  const shape = seq.map((f) => (f.carsPresent ? 'C' : '.')).join('')
  const tail = tailRule(seq)
  const gap = terminalEmptyFrameTs(seq)
  const fullAt = terminalFullAtDeparture(seq)
  sailings.push({
    key, month: key.slice(0, 7), tag: tag.capacity, room: tag.capacity !== 'Full',
    frames: seq.length, shape, tail: tail != null, gap: gap != null, carsEnd: fullAt != null,
    trailingCars: [...seq].reverse().findIndex((f) => !f.carsPresent),
  })
}
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—')
const pad = (s, n) => String(s ?? '—').padEnd(n)
const padL = (s, n) => String(s ?? '—').padStart(n)
const months = [...new Set(sailings.map((s) => s.month))].sort()
const out = { generatedAt: new Date().toISOString(), model: model.version, months: {}, newlyWrong: [], newlyRight: [], lostNone: true }
console.log(`${sailings.length} tagged To-HSB sailings with archived frames, model v${model.version}`)
console.log(pad('month', 9) + padL('room/full', 10) + padL('tail flags', 12) + padL('gap flags', 11) + padL('tail wrong', 12) + padL('gap wrong', 11) + padL('full&gap', 10))
for (const mo of [...months, 'ALL']) {
  const sl = sailings.filter((s) => mo === 'ALL' || s.month === mo)
  const room = sl.filter((s) => s.room), full = sl.filter((s) => !s.room)
  const row = {
    room: room.length, full: full.length,
    tailFlags: room.filter((s) => s.tail).length, gapFlags: room.filter((s) => s.gap).length,
    tailWrong: full.filter((s) => s.tail).length, gapWrong: full.filter((s) => s.gap).length,
    bothFire: sl.filter((s) => s.gap && s.carsEnd).length,
  }
  out.months[mo] = row
  console.log(pad(mo, 9) + padL(`${row.room}/${row.full}`, 10) + padL(`${row.tailFlags} ${pct(row.tailFlags, row.room)}`, 12) + padL(`${row.gapFlags} ${pct(row.gapFlags, row.room)}`, 11) + padL(row.tailWrong, 12) + padL(row.gapWrong, 11) + padL(row.bothFire, 10))
}
// A flag the tail rule withheld and the gap rule asserts: on a room-tagged
// sailing that's a late-arrivals case caught; on a Full-tagged one it's the
// price. Any flag the tail rule made that the gap rule doesn't would be a bug.
for (const s of sailings) {
  if (s.gap && !s.tail) (s.room ? out.newlyRight : out.newlyWrong).push(s)
  if (s.tail && !s.gap) out.lostNone = false
}
console.log(`\nGap rule flags the tail rule withheld: ${out.newlyRight.length} on room-tagged sailings, ${out.newlyWrong.length} on Full-tagged. Tail flags lost: ${out.lostNone ? 'none' : 'SOME (bug)'}`)
console.log(`\nFull-tagged sailings the one-way rule flags not-full (the cost) — shape: C = cars frame, . = empty; trailing cars run length`)
for (const s of out.newlyWrong) console.log(`  ${s.key}  ${pad(s.tag, 5)} trailing ${padL(s.trailingCars, 2)}  ${s.shape}`)
const hist = {}
for (const s of out.newlyWrong) hist[s.trailingCars] = (hist[s.trailingCars] || 0) + 1
const histR = {}
for (const s of out.newlyRight) histR[s.trailingCars] = (histR[s.trailingCars] || 0) + 1
out.trailingRunHistogram = { full: hist, room: histR }
console.log(`\nTrailing cars run length, Full-tagged newly wrong: ${JSON.stringify(hist)}; room-tagged newly right: ${JSON.stringify(histR)}`)
writeFileSync(OUT, JSON.stringify(out, null, 1))
console.log(`\nwrote ${OUT}`)
