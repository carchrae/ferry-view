// Wake the STAGING project's cloud functions for a while, then let them go
// dormant again. Sets `control/staging`.activeUntil (epoch ms) in Firestore,
// which every scheduled function and Firestore trigger checks via
// lib/control.js — production is never gated, and this script refuses to
// target it.
//
// Typical flow: backup prod → restore into staging → run this → test.
//
//   node staging-run-until.js 4h                # active for 4 hours
//   node staging-run-until.js 90m               # …90 minutes ("2d" works too)
//   node staging-run-until.js --until "2026-07-15 18:00"   # local time
//   node staging-run-until.js off               # dormant right now
//   node staging-run-until.js status            # show the current flag
//
// Auth: application-default credentials, like backup-db.js
// (GOOGLE_APPLICATION_CREDENTIALS or `gcloud auth application-default login`).

import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { STAGING_PROJECT_ID, CONTROL_COLLECTION, CONTROL_DOC } from './lib/control.js'

const PROD_PROJECT_ID = 'bowen-ferry'

function argValue(flag) {
  const i = process.argv.indexOf(flag)
  return i !== -1 ? process.argv[i + 1] : null
}

const projectId = argValue('--project') || STAGING_PROJECT_ID
if (projectId === PROD_PROJECT_ID) {
  console.error('Refusing to target production — the gate only applies to staging anyway.')
  process.exit(1)
}

// First non-flag argument: a duration ("4h", "90m", "2d"), "off", or "status".
const positional = process.argv
  .slice(2)
  .filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--project' && all[i - 1] !== '--until')

function parseTarget() {
  const until = argValue('--until')
  if (until) {
    const t = new Date(until).getTime()
    if (isNaN(t)) fail(`Could not parse --until "${until}" (try "YYYY-MM-DD HH:mm", local time)`)
    return t
  }
  const arg = positional[0]
  if (!arg) fail('Usage: node staging-run-until.js <4h|90m|2d|off|status> [--until "YYYY-MM-DD HH:mm"]')
  if (arg === 'status') return 'status'
  if (arg === 'off' || arg === '0') return 0
  const m = /^(\d+(?:\.\d+)?)([mhd])$/.exec(arg)
  if (!m) fail(`Could not parse duration "${arg}" (use e.g. 90m, 4h, 2d, off, status)`)
  const ms = { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]] * Number(m[1])
  return Date.now() + ms
}

function fail(msg) {
  console.error(msg)
  process.exit(1)
}

const target = parseTarget()

if (!getApps().length) {
  initializeApp({ projectId, credential: applicationDefault() })
}
const ref = getFirestore().collection(CONTROL_COLLECTION).doc(CONTROL_DOC)

const fmt = (ms) => new Date(ms).toLocaleString()

// The admin SDK retries credential failures indefinitely — fail fast instead
// so a missing ADC login is obvious.
function withTimeout(promise, ms = 10_000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s (missing/invalid credentials?)`)), ms),
    ),
  ])
}

try {
  if (target === 'status') {
    const snap = await withTimeout(ref.get())
    const val = snap.exists ? snap.data().activeUntil : null
    if (typeof val !== 'number') {
      console.log(`${projectId}: dormant (no activeUntil flag set)`)
    } else if (Date.now() < val) {
      console.log(`${projectId}: ACTIVE until ${fmt(val)} (${Math.round((val - Date.now()) / 60000)} min left)`)
    } else {
      console.log(`${projectId}: dormant (activeUntil passed at ${fmt(val)})`)
    }
  } else {
    await withTimeout(ref.set({ activeUntil: target, updatedAt: Date.now() }))
    if (target === 0) {
      console.log(`${projectId}: functions dormant as of now`)
    } else {
      console.log(`${projectId}: functions ACTIVE until ${fmt(target)}`)
    }
  }
  process.exit(0)
} catch (e) {
  console.error(`Failed talking to Firestore in ${projectId}:`, e.message || e)
  console.error(
    'Credentials: set GOOGLE_APPLICATION_CREDENTIALS or run `gcloud auth application-default login`.',
  )
  process.exit(1)
}
