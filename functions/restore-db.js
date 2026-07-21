import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import diff from 'microdiff'
import { BACKUP_COLLECTIONS } from './lib/backup-collections.js'

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

const BACKUP_DIR = process.argv.includes('--path')
  ? process.argv[process.argv.indexOf('--path') + 1]
  : null

if (!BACKUP_DIR) {
  console.error('Usage: node restore-db.js --path <backup-directory>')
  console.error('  e.g. node restore-db.js --path tmp/backup/bowen-ferry-migrated')
  process.exit(1)
}

function deserializeData(data) {
  if (data === null || data === undefined || typeof data !== 'object') return data
  if (Array.isArray(data)) return data.map(deserializeData)
  if (data.__type === 'Date') return Timestamp.fromMillis(data.value)
  if (data.__type === 'Timestamp') return new Timestamp(data.seconds, data.nanoseconds)
  const obj = {}
  for (const [k, v] of Object.entries(data)) {
    obj[k] = deserializeData(v)
  }
  return obj
}

function serializeData(data) {
  if (data === null || data === undefined || typeof data !== 'object') return data
  if (data instanceof Timestamp) return { __type: 'Timestamp', seconds: data.seconds, nanoseconds: data.nanoseconds }
  if (data instanceof Date) return { __type: 'Date', value: data.getTime() }
  if (Array.isArray(data)) return data.map(serializeData)
  const obj = {}
  for (const [k, v] of Object.entries(data)) {
    obj[k] = serializeData(v)
  }
  return obj
}

function isEqual(a, b) {
  return diff(serializeData(a), serializeData(b)).length === 0
}

const MAX_BATCH_SIZE = 400

async function restoreCollection(name) {
  const filePath = join(BACKUP_DIR, `${name}.json`)
  if (!existsSync(filePath)) {
    console.log(`  ${name}: no backup file found, skipping`)
    return 0
  }
  const docs = JSON.parse(readFileSync(filePath, 'utf-8'))
  if (!docs.length) return 0
  let restored = 0, skipped = 0
  for (let i = 0; i < docs.length; i += MAX_BATCH_SIZE) {
    const chunk = docs.slice(i, i + MAX_BATCH_SIZE)
    const refs = chunk.map(({ id }) => db.collection(name).doc(id))
    const existing = (await db.getAll(...refs)).reduce((acc, snap) => {
      if (snap.exists) acc[snap.id] = snap.data()
      return acc
    }, {})

    const batch = db.batch()
    let writes = 0
    for (const { id, data } of chunk) {
      const desired = deserializeData(data)
      if (existing[id] && isEqual(existing[id], desired)) {
        skipped++
        continue
      }
      batch.set(db.collection(name).doc(id), desired)
      writes++
    }
    if (writes) await batch.commit()
    restored += writes
    const done = Math.min(i + MAX_BATCH_SIZE, docs.length)
    console.log(`  ${name}: ${done}/${docs.length}  (${restored} written, ${skipped} skipped)`)
  }
  return restored
}

async function main() {
  console.log(`Restoring project: ${projectId} ← ${BACKUP_DIR}/`)
  let total = 0
  for (const name of BACKUP_COLLECTIONS) {
    const count = await restoreCollection(name)
    if (count) console.log(`  ${name}: ${count} doc(s) written`)
    total += count
  }
  console.log(`Done. ${total} document(s) restored.`)
}

main().catch(e => { console.error(e); process.exit(1) })