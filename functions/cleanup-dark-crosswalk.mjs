#!/usr/bin/env node
// Remove the WRONG night-time crosswalk detections from Firestore.
//
// Tom reviewed every dark (sun < -6°) crosswalkFullAtAuto in the 45-day
// archive (training-data/dark-detections-review.html, 2026-09-05) and
// confirmed ALL of them are wrong — headlight blobs, not a queue. The
// classifier no longer runs on dark frames (webcam.js gate), but the stamps
// those old false positives left behind are still in sailingStatus and the
// client aggregate. This script clears, per listed sailing:
//   - crosswalkFullAtAuto / crosswalkAutoProb / crosswalkAutoModel /
//     crosswalkAutoPending (the detection itself),
//   - crosswalkFullAt + crosswalkSource ONLY when crosswalkSource is
//     'robot' (the report the detection filed) — human marks stay,
//   - ferryFullAuto when no human crosswalk mark remains (the full verdict's
//     "crosswalk reached" precondition was the wrong detection), plus the
//     robot's own 'Full' capacity report (human/automated capacity stays),
// then rebuilds aggregates/bowenSailings so the client sees it immediately.
//
// The junk night frames the sticky save uploaded are left in Storage — they
// age out in 42 days and are the dark archive a night model will train on.
//
// Reads the sailing list from training-data/dark-detections-verdict.json
// (only entries with correct:false are touched).
//
// Usage (from repo root; application-default credentials, like backup-db.js):
//   node functions/cleanup-dark-crosswalk.mjs --project bowen-ferry           # dry run
//   node functions/cleanup-dark-crosswalk.mjs --project bowen-ferry --apply

import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { recomputeBowenSailings } from './lib/bowen-sailings-aggregate.js'
import { recomputeHistoricalStats } from './lib/history-aggregate.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const VERDICT = join(HERE, '../training-data/dark-detections-verdict.json')

const flag = process.argv.indexOf('--project')
const projectId = flag !== -1 ? process.argv[flag + 1] : null
if (!projectId) {
  console.error('Usage: node functions/cleanup-dark-crosswalk.mjs --project <id> [--apply]')
  process.exit(1)
}
const APPLY = process.argv.includes('--apply')

if (!getApps().length) initializeApp({ projectId, credential: applicationDefault() })
const db = getFirestore()

const { sailings } = JSON.parse(readFileSync(VERDICT, 'utf8'))
const keys = Object.entries(sailings)
  .filter(([, v]) => v.correct === false)
  .map(([k]) => k)
console.log(`${keys.length} wrong dark detections listed — ${APPLY ? 'APPLYING' : 'dry run'}`)

let touched = 0
for (const key of keys) {
  const ref = db.collection('sailingStatus').doc(key)
  const snap = await ref.get()
  if (!snap.exists) {
    console.log(`  ${key}: doc missing — skipped`)
    continue
  }
  const cur = snap.data()
  const del = {}
  const why = []

  if (cur.crosswalkFullAtAuto != null) {
    del.crosswalkFullAtAuto = FieldValue.delete()
    del.crosswalkAutoProb = FieldValue.delete()
    del.crosswalkAutoModel = FieldValue.delete()
    why.push('auto detection')
  }
  if (cur.crosswalkAutoPending != null) {
    del.crosswalkAutoPending = FieldValue.delete()
    why.push('pending')
  }
  const robotReport = cur.crosswalkSource === 'robot'
  if (robotReport) {
    del.crosswalkFullAt = FieldValue.delete()
    del.crosswalkSource = FieldValue.delete()
    why.push('robot crosswalk report')
  }
  // After the cleanup no crosswalk signal remains unless a HUMAN mark exists.
  const humanMarkRemains = cur.crosswalkFullAt != null && !robotReport
  if (cur.ferryFullAuto && !humanMarkRemains) {
    del.ferryFullAuto = FieldValue.delete()
    // Mirror webcam.js's own withdrawal path: the probability goes with the
    // verdict it justified.
    del.terminalFullProb = FieldValue.delete()
    if (!cur.ferryNotFullAuto) del.terminalAutoModel = FieldValue.delete()
    why.push('full verdict (lost its crosswalk precondition)')
    if (cur.capacitySource === 'robot' && cur.lastCapacity === 'Full') {
      del.lastCapacity = FieldValue.delete()
      del.capacitySource = FieldValue.delete()
      why.push("robot 'Full' capacity")
    }
  }

  if (!Object.keys(del).length) {
    console.log(`  ${key}: nothing to clean (already clear)`)
    continue
  }
  touched++
  console.log(`  ${key}: clearing ${why.join(', ')}`)
  if (APPLY) await ref.update(del)
}

console.log(`${touched} docs ${APPLY ? 'updated' : 'would be updated'}`)
if (APPLY && touched) {
  // BOTH client aggregates mirror the cleared fields — bowenSailings feeds
  // the departures page immediately, historicalStats would otherwise serve
  // the phantom robot data until its 03:10 nightly rebuild (plus the
  // client's stale-grace window).
  console.log('Rebuilding aggregates/bowenSailings…')
  await recomputeBowenSailings(db)
  console.log('Rebuilding aggregates/historicalStats…')
  await recomputeHistoricalStats(db)
  console.log('Done.')
} else if (touched) {
  console.log('Dry run — re-run with --apply to write and rebuild the aggregates.')
}
