#!/usr/bin/env node
// Export the lineup-classifier training dataset.
//
// Joins human crosswalk tags (lineupReports) against timelapse frames
// (sailingStatus.lineupTimelapsePaths; capture time is the epoch-ms suffix
// in each filename) and downloads the frames locally. Everything read here
// is world-readable, so no credentials are needed.
//
// This script defines NO tag semantics of its own: raw reports are archived
// verbatim (lineup-reports.json), and labels come from the same shared rule
// the app's triggers use — effectiveCrosswalkAt() in
// functions/lib/lineup-labels.js (latest valid mark wins). Labels for ALL
// manifest rows are recomputed on every run, so corrections and deletions
// made in the app propagate into old rows too.
//
// IMPORTANT: Storage frames are deleted after 42 days (cleanupOldWebcams).
// Run this at least every 6 weeks so labeled frames are archived before they
// vanish. Downloads are incremental (existing files are skipped) and the
// manifest is merged, so old rows survive even after their Storage objects
// are gone. sailingStatus docs are never deleted, so labels can always be
// rebuilt — only the pixels expire.
//
// Usage:
//   node scripts/export-lineup-dataset.mjs [--project bowen-ferry] [--days 45]
//
// Output (gitignored):
//   training-data/frames/<storage path>   downloaded JPEGs (community + bowen)
//   training-data/manifest.csv            path,sailingKey,ts,label,crosswalkAt
//   training-data/terminal-manifest.csv   path,sailingKey,ts,label,source —
//     Bowen terminal (departure) frames for the terminal-cars classifier.
//     Labels come from hand-written training-data/terminal-labels.json
//     ({ "<storage path>": 0|1 }, 1 = cars present), with rider labels from
//     the frameLabels collection filling the gaps (source = hand | rider)
//   training-data/lineup-reports.json     raw lineupReports archive (by doc id)
//   training-data/frame-labels.json       raw frameLabels archive (by doc id)
//   training-data/capacity-tags.json      rider capacity tags (scoring only)
//   training-data/rider-label-disagreements.json  rider vs hand conflicts
//
// Full description of what is (and is not) exported: docs/training-data.md

import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  labelForTimestamp,
  effectiveCrosswalkAt,
  effectiveFrameLabel,
} from '../functions/lib/lineup-labels.js'

const args = process.argv.slice(2)
function flag(name, dflt) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : dflt
}
const PROJECT = flag('project', 'bowen-ferry')
const DAYS = Number(flag('days', '45'))
const BUCKET = `${PROJECT}.firebasestorage.app`
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'training-data')
const FRAMES_DIR = join(ROOT, 'frames')
const MANIFEST = join(ROOT, 'manifest.csv')
const TERMINAL_MANIFEST = join(ROOT, 'terminal-manifest.csv')
const TERMINAL_LABELS = join(ROOT, 'terminal-labels.json')
const REPORTS_JSON = join(ROOT, 'lineup-reports.json')

const FIRESTORE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`

async function runQuery(structuredQuery) {
  const res = await fetch(`${FIRESTORE}:runQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
  })
  if (!res.ok) throw new Error(`runQuery failed: ${res.status} ${await res.text()}`)
  const rows = await res.json()
  return rows.filter((r) => r.document).map((r) => r.document)
}

const val = (f) =>
  f == null
    ? null
    : (f.stringValue ??
      (f.integerValue != null ? Number(f.integerValue) : null) ??
      f.doubleValue ??
      f.booleanValue ??
      (f.arrayValue ? (f.arrayValue.values || []).map(val) : null))

function fields(doc) {
  const out = {}
  for (const [k, f] of Object.entries(doc.fields || {})) out[k] = val(f)
  return out
}

const frameTs = (path) => {
  const m = /_(\d{10,})\.jpg$/.exec(path || '')
  return m ? Number(m[1]) : null
}

// --- 1. Human crosswalk tags -------------------------------------------------
// Archive the raw reports verbatim (keyed by Firestore doc id; a report that
// vanishes from Firestore — the user deleted their mark — stays archived with
// deleted: true), then reduce the CURRENT reports per sailing with the same
// effectiveCrosswalkAt() rule the app's triggers apply. No tag semantics are
// defined here.
const reportDocs = await runQuery({ from: [{ collectionId: 'lineupReports' }] })
const reports = reportDocs.map((doc) => ({
  id: doc.name.split('/').pop(),
  ...fields(doc),
}))

const archive = existsSync(REPORTS_JSON)
  ? new Map(JSON.parse(readFileSync(REPORTS_JSON, 'utf8')).map((r) => [r.id, r]))
  : new Map()
const liveIds = new Set(reports.map((r) => r.id))
for (const old of archive.values()) if (!liveIds.has(old.id)) old.deleted = true
for (const r of reports) archive.set(r.id, r)
mkdirSync(ROOT, { recursive: true })
writeFileSync(
  REPORTS_JSON,
  JSON.stringify([...archive.values()].sort((a, b) => (a.recordedAt || 0) - (b.recordedAt || 0)), null, 1) + '\n',
)

const reportsBySailing = new Map()
for (const r of reports) {
  if (!r.sailingKey) continue
  if (!reportsBySailing.has(r.sailingKey)) reportsBySailing.set(r.sailingKey, [])
  reportsBySailing.get(r.sailingKey).push(r)
}

// --- 1b. Human capacity tags -------------------------------------------------
// Rider-reported fullness (capacityHistory, user records only — automated
// records never cover To HSB). Snapshot, not an archive: the report pages use
// these to show robot-verdict vs human-tag agreement; no labels derive from
// them. `capacity` is percent AVAILABLE ("Full" = 0% available).
const CAPACITY_TAGS = join(ROOT, 'capacity-tags.json')
const capacityDocs = await runQuery({ from: [{ collectionId: 'capacityHistory' }], limit: 20000 })
const capacityTags = capacityDocs
  .map((doc) => ({ id: doc.name.split('/').pop(), ...fields(doc) }))
  .filter((c) => c.userUid && c.sailingKey && c.capacity)
  .map(({ id, sailingKey, capacity, recordedAt }) => ({ id, sailingKey, capacity, recordedAt }))
  .sort((a, b) => (a.recordedAt || 0) - (b.recordedAt || 0))
writeFileSync(CAPACITY_TAGS, JSON.stringify(capacityTags, null, 1) + '\n')
console.log(`capacityHistory: ${capacityTags.length} user tags on ${new Set(capacityTags.map((c) => c.sailingKey)).size} sailings`)
// --- 1c. Rider per-frame terminal labels -------------------------------------
// "Were cars waiting in THIS photo?" — the frame question the terminal
// classifier actually predicts, and the only rider input that can supervise
// it (a capacity tag describes a whole sailing and can't say which frame was
// misread). Archived like lineupReports so a deleted label stops counting,
// and resolved by the shared effectiveFrameLabel() — this file defines no tag
// semantics of its own.
const FRAME_LABELS = join(ROOT, 'frame-labels.json')
const FRAME_LABEL_LIMIT = 20000
// Tolerate the collection being unreadable — before the frameLabels rules are
// deployed the read is denied, and a training export must not die for a label
// source that is merely absent. Same for a transient failure.
let frameLabelDocs = []
try {
  frameLabelDocs = await runQuery({
    from: [{ collectionId: 'frameLabels' }],
    orderBy: [{ field: { fieldPath: 'recordedAt' }, direction: 'DESCENDING' }],
    limit: FRAME_LABEL_LIMIT,
  })
} catch (e) {
  console.warn(`frameLabels unreadable (${String(e.message).split('\n')[0]}) — continuing with hand labels only.`)
}
if (frameLabelDocs.length === FRAME_LABEL_LIMIT) {
  console.warn(`WARNING: frameLabels hit the ${FRAME_LABEL_LIMIT}-doc read limit — older labels were not read this run.`)
}
const frameLabels = frameLabelDocs.map((doc) => ({ id: doc.name.split('/').pop(), ...fields(doc) }))
const frameArchive = existsSync(FRAME_LABELS)
  ? new Map(JSON.parse(readFileSync(FRAME_LABELS, 'utf8')).map((r) => [r.id, r]))
  : new Map()
const liveFrameIds = new Set(frameLabels.map((r) => r.id))
for (const old of frameArchive.values()) if (!liveFrameIds.has(old.id)) old.deleted = true
for (const r of frameLabels) frameArchive.set(r.id, r)
writeFileSync(
  FRAME_LABELS,
  JSON.stringify([...frameArchive.values()].sort((a, b) => (a.recordedAt || 0) - (b.recordedAt || 0)), null, 1) + '\n',
)
// Resolve from LIVE docs only — a deleted label must stop voting.
const frameLabelsByPath = new Map()
for (const r of frameLabels) {
  if (!r.framePath) continue
  if (!frameLabelsByPath.has(r.framePath)) frameLabelsByPath.set(r.framePath, [])
  frameLabelsByPath.get(r.framePath).push(r)
}
const riderLabelByPath = new Map()
for (const [path, list] of frameLabelsByPath) {
  const label = effectiveFrameLabel(list)
  if (label != null) riderLabelByPath.set(path, label)
}
console.log(
  `frameLabels: ${frameLabels.length} live labels from ${new Set(frameLabels.map((r) => r.userUid)).size} riders on ${frameLabelsByPath.size} frames → ${riderLabelByPath.size} resolved (${frameLabelsByPath.size - riderLabelByPath.size} tied)`,
)

const crosswalkBySailing = new Map()
for (const [key, list] of reportsBySailing) {
  const at = effectiveCrosswalkAt(list)
  if (at != null) crosswalkBySailing.set(key, at)
}
console.log(
  `lineupReports: ${reports.length} live tags on ${crosswalkBySailing.size} sailings (${archive.size} archived)`,
)

// --- 2. Sailings with timelapse frames (bounded to the retention window) ----
const since = new Date(Date.now() - DAYS * 86400e3).toISOString().slice(0, 10)
const sailings = (
  await runQuery({
    from: [{ collectionId: 'sailingStatus' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'dateIso' },
        op: 'GREATER_THAN_OR_EQUAL',
        value: { stringValue: since },
      },
    },
  })
)
  .map(fields)
  .filter(
    (s) =>
      (Array.isArray(s.lineupTimelapsePaths) && s.lineupTimelapsePaths.length) ||
      (Array.isArray(s.departureTimelapsePaths) && s.departureTimelapsePaths.length),
  )
console.log(`sailingStatus: ${sailings.length} sailings with timelapse frames since ${since}`)

// --- 3. Merge into the manifest ---------------------------------------------
mkdirSync(FRAMES_DIR, { recursive: true })
const rows = new Map() // storage path → row
if (existsSync(MANIFEST)) {
  for (const line of readFileSync(MANIFEST, 'utf8').trim().split('\n').slice(1)) {
    const [path, sailingKey, ts] = line.split(',')
    if (path) rows.set(path, { path, sailingKey, ts })
  }
}
for (const s of sailings) {
  for (const path of s.lineupTimelapsePaths || []) {
    const ts = frameTs(path)
    if (!ts) continue
    rows.set(path, { path, sailingKey: s.sailingKey, ts: String(ts) })
  }
}
// Relabel EVERY row from the current effective tags — lineupReports is the
// source of truth, so corrections and deletions rewrite history here too.
for (const row of rows.values()) {
  const crosswalkAt = crosswalkBySailing.get(row.sailingKey) ?? null
  const label = crosswalkAt != null ? labelForTimestamp(Number(row.ts), crosswalkAt) : ''
  row.label = String(label ?? '')
  row.crosswalkAt = crosswalkAt != null ? String(crosswalkAt) : ''
}

// --- 3b. Terminal (departure) frames for the terminal-cars classifier -------
// Same merge shape as the lineup manifest; labels come from the hand-written
// training-data/terminal-labels.json ({ "<storage path>": 0|1 }, 1 = cars
// present) and are re-joined on every run, so relabeling rewrites history.
const terminalRows = new Map()
if (existsSync(TERMINAL_MANIFEST)) {
  for (const line of readFileSync(TERMINAL_MANIFEST, 'utf8').trim().split('\n').slice(1)) {
    const [path, sailingKey, ts] = line.split(',')
    if (path) terminalRows.set(path, { path, sailingKey, ts })
  }
}
for (const s of sailings) {
  for (const path of s.departureTimelapsePaths || []) {
    const ts = frameTs(path)
    if (!ts) continue
    terminalRows.set(path, { path, sailingKey: s.sailingKey, ts: String(ts) })
  }
}
const terminalLabels = existsSync(TERMINAL_LABELS)
  ? JSON.parse(readFileSync(TERMINAL_LABELS, 'utf8'))
  : {}
// Precedence: a local hand label always wins; rider labels only fill gaps.
// A rider contradicting a hand label is NOT applied but IS recorded — that
// disagreement is the most valuable signal here (it says a hand label may be
// wrong) and must not be silently dropped.
const DISAGREEMENTS = join(ROOT, 'rider-label-disagreements.json')
const disagreements = {}
let riderFilled = 0
let riderAgreed = 0
let riderNoRow = 0
for (const row of terminalRows.values()) {
  const hand = terminalLabels[row.path]
  const rider = riderLabelByPath.get(row.path)
  if (hand === 0 || hand === 1) {
    row.label = String(hand)
    row.source = 'hand'
    if (rider != null) {
      if (rider === hand) riderAgreed++
      else {
        disagreements[row.path] = {
          hand,
          rider,
          users: (frameLabelsByPath.get(row.path) || []).map((r) => r.userUid),
        }
      }
    }
  } else if (rider != null) {
    row.label = String(rider)
    row.source = 'rider'
    riderFilled++
  } else {
    row.label = ''
    row.source = ''
  }
}
let riderNoFrame = 0
for (const path of riderLabelByPath.keys()) {
  if (!terminalRows.has(path)) riderNoRow++
  // The trainer silently drops rows whose JPEG never made it to disk (aged
  // out of Storage before an export ran) — surface that loss here.
  else if (!existsSync(join(FRAMES_DIR, path))) riderNoFrame++
}
writeFileSync(DISAGREEMENTS, JSON.stringify(disagreements, null, 1) + '\n')
console.log(
  `rider labels: ${riderLabelByPath.size} resolved — ${riderFilled} filled gaps, ${riderAgreed} agreed with a hand label, ${Object.keys(disagreements).length} disagreed (kept in rider-label-disagreements.json, hand label wins), ${riderNoRow} with no manifest row, ${riderNoFrame} with no frame on disk`,
)

// --- 4. Download frames we don't have yet ------------------------------------
let downloaded = 0
let gone = 0
for (const row of [...rows.values(), ...terminalRows.values()]) {
  const dest = join(FRAMES_DIR, row.path)
  if (existsSync(dest)) continue
  const url = `https://storage.googleapis.com/${BUCKET}/${encodeURIComponent(row.path).replace(/%2F/g, '/')}`
  const res = await fetch(url)
  if (!res.ok) {
    gone++ // aged out of Storage; label row kept for the record
    continue
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (!buf.length) {
    gone++ // zero-byte object (failed capture upload) — nothing to train on
    continue
  }
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, buf)
  downloaded++
}

const header = 'path,sailingKey,ts,label,crosswalkAt'
const sorted = [...rows.values()].sort((a, b) => a.path.localeCompare(b.path))
writeFileSync(
  MANIFEST,
  [header, ...sorted.map((r) => [r.path, r.sailingKey, r.ts, r.label, r.crosswalkAt].join(','))].join(
    '\n',
  ) + '\n',
)

const labeled = sorted.filter((r) => r.label !== '').length
console.log(
  `manifest: ${sorted.length} frames (${labeled} labeled) — downloaded ${downloaded} new, ${gone} already aged out of Storage`,
)

const tSorted = [...terminalRows.values()].sort((a, b) => a.path.localeCompare(b.path))
writeFileSync(
  TERMINAL_MANIFEST,
  [
    'path,sailingKey,ts,label,source',
    ...tSorted.map((r) => [r.path, r.sailingKey, r.ts, r.label, r.source || ''].join(',')),
  ].join('\n') + '\n',
)
const tHand = tSorted.filter((r) => r.source === 'hand').length
const tRider = tSorted.filter((r) => r.source === 'rider').length
console.log(
  `terminal-manifest: ${tSorted.length} frames (${tHand + tRider} labeled — ${tHand} hand, ${tRider} rider)`,
)
