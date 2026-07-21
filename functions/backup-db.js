import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
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

const OUT_DIR = process.argv.includes('--path')
  ? process.argv[process.argv.indexOf('--path') + 1]
  : null

if (!OUT_DIR) {
  console.error('Usage: node backup-db.js --path <backup-directory>')
  console.error('  e.g. node backup-db.js --path backup/bowen-ferry')
  process.exit(1)
}

function serializeData(data) {
  if (data === null || data === undefined || typeof data !== 'object') return data
  if (data instanceof Date) return { __type: 'Date', value: data.toISOString() }
  if (data.constructor?.name === 'Timestamp' && typeof data.seconds === 'number') {
    return { __type: 'Timestamp', seconds: data.seconds, nanoseconds: data.nanoseconds }
  }
  if (Array.isArray(data)) return data.map(serializeData)
  const obj = {}
  for (const [k, v] of Object.entries(data)) {
    obj[k] = serializeData(v)
  }
  return obj
}

async function backupCollection(name) {
  const snap = await db.collection(name).get()
  if (snap.empty) return []
  return snap.docs.map(doc => ({ id: doc.id, data: serializeData(doc.data()) }))
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  console.log(`Backing up project: ${projectId} → ${OUT_DIR}/`)
  let total = 0
  for (const name of BACKUP_COLLECTIONS) {
    const docs = await backupCollection(name)
    if (!docs.length) {
      console.log(`  ${name}: empty`)
      continue
    }
    const filePath = join(OUT_DIR, `${name}.json`)
    writeFileSync(filePath, JSON.stringify(docs, null, 2))
    console.log(`  ${name}: ${docs.length} doc(s) → ${name}.json`)
    total += docs.length
  }
  console.log(`Done. ${total} document(s) backed up.`)
}

main().catch(e => { console.error(e); process.exit(1) })