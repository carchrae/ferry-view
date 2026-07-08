// One-time backfill: stamp existing webcam photos onto sailingStatus docs.
//
// Going forward, captureBowenWebcam / captureBowenCommunityWebcam (lib/webcam.js)
// record each photo's Storage path on the sailing it belongs to
// (webcamSnapshotPath / communitySnapshotPath), which the /tag page reads. But
// photos captured before that change only exist as Storage files — the
// community (arrival/lineup) ones were never pointed at by any per-sailing doc.
// This script lists webcams/ in Storage, derives each file's sailingKey from
// its path, and fills the missing path fields (newest photo per sailing wins;
// fields already set are left alone).
//
// Storage layouts (see lib/webcam.js):
//   webcams/bowen/{dateIso}/{sailingKey}_{timestamp}.jpg
//   webcams/community/{dateIso}/{sailingTime}_To HSB_{timestamp}.jpg
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./credentials.json node backfill-webcam-paths.js [--dry-run] [--project <id>]
//   node backfill-webcam-paths.js --project bowen-ferry-staging --dry-run

import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { readFileSync, existsSync } from 'node:fs'

const DRY_RUN = process.argv.includes('--dry-run')

function detectProjectId() {
  const flag = process.argv.indexOf('--project')
  if (flag !== -1) return process.argv[flag + 1]
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (credPath && existsSync(credPath)) {
    const creds = JSON.parse(readFileSync(credPath, 'utf-8'))
    if (creds.project_id) return creds.project_id
  }
  const adc = process.env.HOME + '/.config/gcloud/application_default_credentials.json'
  if (existsSync(adc)) {
    const creds = JSON.parse(readFileSync(adc, 'utf-8'))
    if (creds.project_id) return creds.project_id
    if (creds.quota_project_id) return creds.quota_project_id
  }
  return process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT
}

const projectId = detectProjectId()
if (!projectId) {
  console.error('Could not detect project ID. Set GOOGLE_APPLICATION_CREDENTIALS or pass --project.')
  process.exit(1)
}

if (!getApps().length) {
  initializeApp({
    projectId,
    storageBucket: `${projectId}.firebasestorage.app`,
    credential: applicationDefault(),
  })
}
const db = getFirestore()

const COMMUNITY_RE = /^webcams\/community\/(\d{4}-\d{2}-\d{2})\/(\d{2}:\d{2})_To HSB_(\d+)\.jpg$/
const BOWEN_RE = /^webcams\/bowen\/(\d{4}-\d{2}-\d{2})\/\1_(\d{2}:\d{2})_To HSB_(\d+)\.jpg$/

// Returns { sailingKey, dateIso, sailingTime, field, timestamp } or null for
// files that don't map to a sailing (e.g. legacy "..._Arrival_..." community
// files, which were keyed by arrival time rather than a departure).
function parseBlobPath(name) {
  let m = COMMUNITY_RE.exec(name)
  if (m) {
    const [, dateIso, sailingTime, ts] = m
    return {
      sailingKey: `${dateIso}_${sailingTime}_To HSB`,
      dateIso,
      sailingTime,
      field: 'communitySnapshotPath',
      timestamp: Number(ts),
    }
  }
  m = BOWEN_RE.exec(name)
  if (m) {
    const [, dateIso, sailingTime, ts] = m
    return {
      sailingKey: `${dateIso}_${sailingTime}_To HSB`,
      dateIso,
      sailingTime,
      field: 'webcamSnapshotPath',
      timestamp: Number(ts),
    }
  }
  return null
}

const MAX_BATCH_SIZE = 400

async function main() {
  console.log('Backfilling sailingStatus webcam paths from Storage')
  console.log(`  project: ${projectId}${DRY_RUN ? '  (DRY RUN — no writes)' : ''}`)

  const bucket = getStorage().bucket()
  const [files] = await bucket.getFiles({ prefix: 'webcams/' })
  console.log(`  storage files: ${files.length}`)

  // Newest photo per sailing+field.
  const latest = new Map()
  let unparsed = 0
  for (const file of files) {
    const parsed = parseBlobPath(file.name)
    if (!parsed) {
      unparsed++
      continue
    }
    const key = `${parsed.sailingKey}|${parsed.field}`
    const prev = latest.get(key)
    if (!prev || parsed.timestamp > prev.timestamp) {
      latest.set(key, { ...parsed, blobPath: file.name })
    }
  }
  if (unparsed) console.log(`  skipped ${unparsed} file(s) not matching a sailing`)

  // Group per sailing doc.
  const bySailing = new Map()
  for (const t of latest.values()) {
    const cur = bySailing.get(t.sailingKey) || {
      sailingKey: t.sailingKey,
      dateIso: t.dateIso,
      sailingTime: t.sailingTime,
    }
    cur[t.field] = t.blobPath
    bySailing.set(t.sailingKey, cur)
  }
  const targets = [...bySailing.values()]
  console.log(`  distinct sailings with photos: ${targets.length}`)

  let written = 0
  let unchanged = 0
  for (let i = 0; i < targets.length; i += MAX_BATCH_SIZE) {
    const chunk = targets.slice(i, i + MAX_BATCH_SIZE)
    const refs = chunk.map((t) => db.collection('sailingStatus').doc(t.sailingKey))
    const existing = await db.getAll(...refs)

    const batch = db.batch()
    let writes = 0
    chunk.forEach((t, idx) => {
      const cur = existing[idx].exists ? existing[idx].data() : null
      const updates = {
        sailingKey: t.sailingKey,
        sailingTime: t.sailingTime,
        direction: 'To HSB',
        dateIso: t.dateIso,
      }
      // Fill-only: never clobber a path the capture code already recorded.
      for (const field of ['webcamSnapshotPath', 'communitySnapshotPath']) {
        if (t[field] && !cur?.[field]) updates[field] = t[field]
      }
      if (!updates.webcamSnapshotPath && !updates.communitySnapshotPath) {
        unchanged++
        return
      }
      batch.set(existing[idx].ref, updates, { merge: true })
      writes++
    })
    if (writes && !DRY_RUN) await batch.commit()
    written += writes
    console.log(
      `  ${Math.min(i + MAX_BATCH_SIZE, targets.length)}/${targets.length}  (${written} ${DRY_RUN ? 'would write' : 'written'}, ${unchanged} unchanged)`,
    )
  }

  console.log(
    `Done. ${written} sailingStatus doc(s) ${DRY_RUN ? 'would be updated' : 'updated'}, ${unchanged} already current.`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
