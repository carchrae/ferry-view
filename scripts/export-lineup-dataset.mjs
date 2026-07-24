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
// IMPORTANT: Storage frames are deleted after 14 days (cleanupOldWebcams).
// Run this at least every 2 weeks so labeled frames are archived before they
// vanish. Downloads are incremental (existing files are skipped) and the
// manifest is merged, so old rows survive even after their Storage objects
// are gone. sailingStatus docs are never deleted, so labels can always be
// rebuilt — only the pixels expire.
//
// Usage:
//   node scripts/export-lineup-dataset.mjs [--project bowen-ferry] [--days 15]
//
// Output (gitignored):
//   training-data/frames/<storage path>   downloaded JPEGs
//   training-data/manifest.csv            path,sailingKey,ts,label,crosswalkAt
//   training-data/lineup-reports.json     raw lineupReports archive (by doc id)
//
// Full description of what is (and is not) exported: docs/training-data.md

import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { labelForTimestamp, effectiveCrosswalkAt } from '../functions/lib/lineup-labels.js'

const args = process.argv.slice(2)
function flag(name, dflt) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : dflt
}
const PROJECT = flag('project', 'bowen-ferry')
const DAYS = Number(flag('days', '15'))
const BUCKET = `${PROJECT}.firebasestorage.app`
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'training-data')
const FRAMES_DIR = join(ROOT, 'frames')
const MANIFEST = join(ROOT, 'manifest.csv')
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
  .filter((s) => Array.isArray(s.lineupTimelapsePaths) && s.lineupTimelapsePaths.length)
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
  for (const path of s.lineupTimelapsePaths) {
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

// --- 4. Download frames we don't have yet ------------------------------------
let downloaded = 0
let gone = 0
for (const row of rows.values()) {
  const dest = join(FRAMES_DIR, row.path)
  if (existsSync(dest)) continue
  const url = `https://storage.googleapis.com/${BUCKET}/${encodeURIComponent(row.path).replace(/%2F/g, '/')}`
  const res = await fetch(url)
  if (!res.ok) {
    gone++ // aged out of Storage; label row kept for the record
    continue
  }
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
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
