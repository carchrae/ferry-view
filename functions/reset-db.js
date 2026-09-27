import { connectAdmin, detectProjectId } from './script-auth.js'
import { BACKUP_COLLECTIONS } from './lib/backup-collections.js'

const projectId = detectProjectId()
if (!projectId) {
  console.error('Could not detect project ID. Pass --project <id> (or set GOOGLE_APPLICATION_CREDENTIALS).')
  process.exit(1)
}

const { db } = await connectAdmin(projectId)

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
  for (const name of BACKUP_COLLECTIONS) {
    const snap = await db.collection(name).listDocuments()
    if (!snap.length) continue
    console.log(`  ${name}: ${snap.length} doc(s)${dryRun ? ' (skipped)' : ''}`)
    if (!dryRun) await Promise.all(snap.map(doc => doc.delete()))
    total += snap.length
  }
  console.log(`Done. ${total} total document(s)${dryRun ? ' would be deleted.' : ' deleted.'}`)
}

main().catch(e => { console.error(e); process.exit(1) })