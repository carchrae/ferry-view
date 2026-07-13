#!/usr/bin/env node
// Export the lineup-classifier training dataset.
//
// Joins human crosswalk tags (lineupReports.crosswalkAt) against timelapse
// frames (sailingStatus.lineupTimelapsePaths; capture time is the epoch-ms
// suffix in each filename) and downloads the frames locally. Everything read
// here is world-readable, so no credentials are needed.
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

import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { labelForTimestamp } from '../functions/lib/lineup-features.js'

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

// --- 1. Human crosswalk tags: earliest per sailing --------------------------
const reports = (await runQuery({ from: [{ collectionId: 'lineupReports' }] })).map(fields)
const crosswalkBySailing = new Map()
for (const r of reports) {
  if (!r.sailingKey || typeof r.crosswalkAt !== 'number') continue
  const prev = crosswalkBySailing.get(r.sailingKey)
  if (!prev || r.crosswalkAt < prev) crosswalkBySailing.set(r.sailingKey, r.crosswalkAt)
}
console.log(`lineupReports: ${reports.length} tags on ${crosswalkBySailing.size} sailings`)

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
    const [path, sailingKey, ts, label, crosswalkAt] = line.split(',')
    if (path) rows.set(path, { path, sailingKey, ts, label, crosswalkAt })
  }
}
for (const s of sailings) {
  const crosswalkAt = crosswalkBySailing.get(s.sailingKey) ?? null
  for (const path of s.lineupTimelapsePaths) {
    const ts = frameTs(path)
    if (!ts) continue
    const label = crosswalkAt != null ? labelForTimestamp(ts, crosswalkAt) : ''
    rows.set(path, {
      path,
      sailingKey: s.sailingKey,
      ts: String(ts),
      label: String(label ?? ''),
      crosswalkAt: crosswalkAt != null ? String(crosswalkAt) : '',
    })
  }
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
