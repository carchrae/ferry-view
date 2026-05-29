import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync, existsSync } from 'node:fs'

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

const COLLECTIONS = ['ferryStatus', 'ferryStatusHistory', 'sailingStatus', 'capacityHistory', 'snapshots', 'rides', 'pushSubscriptions']

async function deleteAllDocs(collectionId) {
  const snap = await db.collection(collectionId).listDocuments()
  if (!snap.length) return 0
  await Promise.all(snap.map(doc => doc.delete()))
  return snap.length
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  console.log(`${dryRun ? 'DRY RUN: would delete' : 'Deleting'} all collections in project: ${projectId}`)
  let total = 0
  for (const name of COLLECTIONS) {
    const snap = await db.collection(name).listDocuments()
    if (!snap.length) continue
    console.log(`  ${name}: ${snap.length} doc(s)${dryRun ? ' (skipped)' : ''}`)
    if (!dryRun) await Promise.all(snap.map(doc => doc.delete()))
    total += snap.length
  }
  console.log(`Done. ${total} total document(s)${dryRun ? ' would be deleted.' : ' deleted.'}`)
}

main().catch(e => { console.error(e); process.exit(1) })