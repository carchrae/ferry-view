import { logger } from 'firebase-functions/logger'
import { getFirestore } from 'firebase-admin/firestore'

// Cost switch for the STAGING project. Staging's cloud functions only do
// work while `control/staging`.activeUntil (epoch ms) is in the future — set
// it with `node staging-run-until.js 4h` (functions/staging-run-until.js),
// typically right after a prod backup → staging restore, and staging goes
// dormant again on its own when the time passes. Production is never gated
// (it returns before any read, so the check costs nothing there; on staging
// it costs one doc read per poll — the reads it prevents dwarf that).

export const STAGING_PROJECT_ID = 'bowen-ferry-staging'
export const CONTROL_COLLECTION = 'control'
export const CONTROL_DOC = 'staging'

function currentProjectId() {
  return process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || null
}

// Pure decision (unit-tested): run everywhere except staging; on staging run
// only while the flag is a future timestamp. Missing/invalid flag = dormant —
// the default state is the cheap one.
export function shouldRun(projectId, activeUntil, nowMs = Date.now()) {
  if (projectId !== STAGING_PROJECT_ID) return true
  return typeof activeUntil === 'number' && nowMs < activeUntil
}

// Gate for scheduled functions and Firestore triggers. Gating the triggers
// matters for restores: without it, restoring a prod backup into staging
// would fire onCapacityReport/onRideWrite per restored doc, each running a
// full refresh/recompute. Manual onRequest endpoints stay ungated — they
// only run when explicitly invoked.
export async function functionsActive() {
  if (currentProjectId() !== STAGING_PROJECT_ID) return true
  try {
    const snap = await getFirestore().collection(CONTROL_COLLECTION).doc(CONTROL_DOC).get()
    return shouldRun(STAGING_PROJECT_ID, snap.exists ? snap.data().activeUntil : null)
  } catch (e) {
    // Fail dormant: cost control is the whole point, and staging-run-until.js
    // fails loudly on the same problem, so this can't go unnoticed for long.
    logger.error('functionsActive check failed; staying dormant:', e.message || e)
    return false
  }
}
