import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

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

const COLLECTIONS = ['ferryStatus', 'ferryStatusHistory', 'sailingStatus', 'capacityHistory', 'snapshots', 'rides', 'pushSubscriptions']

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

async function restoreCollection(name) {
  const filePath = join(BACKUP_DIR, `${name}.json`)
  if (!existsSync(filePath)) {
    console.log(`  ${name}: no backup file found, skipping`)
    return 0
  }
  const docs = JSON.parse(readFileSync(filePath, 'utf-8'))
  if (!docs.length) return 0
  const batch = db.batch()
  for (const { id, data } of docs) {
    const ref = db.collection(name).doc(id)
    batch.set(ref, deserializeData(data))
  }
  await batch.commit()
  return docs.length
}

async function main() {
  console.log(`Restoring project: ${projectId} ← ${BACKUP_DIR}/`)
  let total = 0
  for (const name of COLLECTIONS) {
    const count = await restoreCollection(name)
    if (count) console.log(`  ${name}: ${count} doc(s) restored`)
    total += count
  }
  console.log(`Done. ${total} document(s) restored.`)
}

main().catch(e => { console.error(e); process.exit(1) })