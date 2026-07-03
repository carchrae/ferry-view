// One-time backfill: propagate capacityHistory into sailingStatus.lastCapacity.
//
// Going forward, augmentFromCapacityHistory (lib/enrich.js) persists each
// sailing's latest capacity — including user-contributed reports — into the
// sailingStatus doc that HistoryPage reads. But contributions made before that
// change only ever landed in capacityHistory. This script walks every
// capacityHistory record, picks the most recent one per sailing, and writes its
// capacity (and fill time, for Full sailings) into the matching sailingStatus
// doc, matching updateSailingStatus() semantics.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./credentials.json node backfill-capacity.js [--dry-run] [--project <id>]
//   node backfill-capacity.js --project bowen-ferry-staging --dry-run

import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
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
  initializeApp({ projectId, credential: applicationDefault() })
}
const db = getFirestore()

const VALID_DIRECTIONS = new Set(['To Bowen', 'To HSB'])

// sailingKey is `${dateIso}_${HH:MM}_${direction}`, e.g. "2026-06-01_11:55_To Bowen".
function parseSailingKey(key) {
  const parts = String(key).split('_')
  if (parts.length < 3) return null
  const dateIso = parts[0]
  const sailingTime = parts[1]
  const direction = parts.slice(2).join('_')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return null
  if (!/^\d{2}:\d{2}$/.test(sailingTime)) return null
  if (!VALID_DIRECTIONS.has(direction)) return null
  return { dateIso, sailingTime, direction }
}

const MAX_BATCH_SIZE = 400

async function main() {
  console.log(`Backfilling sailingStatus.lastCapacity from capacityHistory`)
  console.log(`  project: ${projectId}${DRY_RUN ? '  (DRY RUN — no writes)' : ''}`)

  const snap = await db.collection('capacityHistory').get()
  console.log(`  capacityHistory records: ${snap.size}`)

  // Keep the most recent record per sailingKey.
  const latest = new Map()
  snap.forEach((doc) => {
    const r = doc.data()
    if (!r.sailingKey) return
    const rec = r.recordedAt || 0
    const prev = latest.get(r.sailingKey)
    if (!prev || rec > prev.recordedAt) {
      latest.set(r.sailingKey, { capacity: r.capacity, filledAt: r.filledAt, recordedAt: rec })
    }
  })
  console.log(`  distinct sailings: ${latest.size}`)

  // Build the desired update per sailingKey (skipping malformed keys).
  const targets = []
  let skippedKeys = 0
  for (const [sailingKey, r] of latest) {
    const parsed = parseSailingKey(sailingKey)
    if (!parsed) { skippedKeys++; continue }
    if (r.capacity === undefined || r.capacity === null) continue
    // Match enrich.js / updateSailingStatus: a real timestamp is only
    // meaningful for Full sailings; fall back to recordedAt when needed.
    const filledAt = r.capacity === 'Full' ? r.filledAt || r.recordedAt || null : null
    targets.push({ sailingKey, ...parsed, lastCapacity: r.capacity, filledAt })
  }
  if (skippedKeys) console.log(`  skipped ${skippedKeys} malformed/other-direction key(s)`)

  let written = 0, unchanged = 0
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
        direction: t.direction,
        dateIso: t.dateIso,
        lastCapacity: t.lastCapacity,
      }
      // Preserve an existing fill time; only set one when the doc lacks it.
      const hasFilledAt = typeof cur?.filledAt === 'number'
      if (t.filledAt !== null && !hasFilledAt) updates.filledAt = t.filledAt

      const capSame = cur?.lastCapacity === t.lastCapacity
      const filledSame = updates.filledAt === undefined || cur?.filledAt === updates.filledAt
      if (cur && capSame && filledSame) { unchanged++; return }

      batch.set(existing[idx].ref, updates, { merge: true })
      writes++
    })
    if (writes && !DRY_RUN) await batch.commit()
    written += writes
    console.log(`  ${Math.min(i + MAX_BATCH_SIZE, targets.length)}/${targets.length}  (${written} ${DRY_RUN ? 'would write' : 'written'}, ${unchanged} unchanged)`)
  }

  console.log(`Done. ${written} sailingStatus doc(s) ${DRY_RUN ? 'would be updated' : 'updated'}, ${unchanged} already current.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
