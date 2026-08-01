import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { BACKUP_COLLECTIONS, COLLECTION_WINDOW_FIELDS } from './lib/backup-collections.js'

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
  console.error('Usage: node backup-db.js --path <backup-directory> [--days N | --full]')
  console.error('  e.g. node backup-db.js --path backup/bowen-ferry           # last 30 days (default)')
  console.error('       node backup-db.js --path backup/bowen-ferry --days 14')
  console.error('       node backup-db.js --path backup/bowen-ferry --full    # everything')
  process.exit(1)
}

// Windowed by default: staging rarely needs more than the last few weeks, and
// a full scan of the dated collections costs thousands of reads. --full keeps
// the old read-everything behavior for a complete mirror.
const FULL = process.argv.includes('--full')
const DEFAULT_WINDOW_DAYS = 30
const daysFlag = process.argv.indexOf('--days')
const WINDOW_DAYS = daysFlag !== -1 ? Number(process.argv[daysFlag + 1]) : DEFAULT_WINDOW_DAYS
if (!FULL && (!Number.isFinite(WINDOW_DAYS) || WINDOW_DAYS <= 0)) {
  console.error(`--days must be a positive number, got: ${process.argv[daysFlag + 1]}`)
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

// The cutoff expressed for one collection's date-field type (see
// COLLECTION_WINDOW_FIELDS), or null for a full scan.
function windowCutoff(type) {
  const ms = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000
  if (type === 'dateIso') return new Date(ms).toISOString().slice(0, 10)
  if (type === 'timestamp') return Timestamp.fromMillis(ms)
  return ms // epochMs
}

async function backupCollection(name) {
  const window = FULL ? null : COLLECTION_WINDOW_FIELDS[name]
  const query = window
    ? db.collection(name).where(window.field, '>=', windowCutoff(window.type))
    : db.collection(name)
  const snap = await query.get()
  if (snap.empty) return []
  return snap.docs.map(doc => ({ id: doc.id, data: serializeData(doc.data()) }))
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const mode = FULL ? 'full' : `last ${WINDOW_DAYS} days of dated collections`
  console.log(`Backing up project: ${projectId} → ${OUT_DIR}/ (${mode})`)
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