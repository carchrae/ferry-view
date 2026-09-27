// Shared auth for local admin scripts (backup/restore, backfills, repairs…).
// Every script that talks to Firestore/Storage with admin rights connects via
// connectAdmin() here — never initializeApp()/applicationDefault() directly.
//
//   GOOGLE_APPLICATION_CREDENTIALS set  → firebase-admin with that JSON key
//                                         (service account or ADC file)
//   otherwise                           → the account signed in via
//                                         `firebase login` (no key needed)
//
// firebase-admin only accepts a service account or ADC, so the CLI path builds
// the underlying @google-cloud/firestore and @google-cloud/storage clients
// directly (the same classes firebase-admin returns) with an OAuth2 client
// whose token comes from firebase-tools' own refreshing auth.

import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'

const require = createRequire(import.meta.url)

// Project from --project, else the credentials file's project_id, else the
// usual env vars. Returns null if none is found (callers decide the fallback).
export function detectProjectId(argv = process.argv) {
  const flag = argv.indexOf('--project')
  if (flag !== -1) return argv[flag + 1]
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (credPath && existsSync(credPath)) {
    const creds = JSON.parse(readFileSync(credPath, 'utf-8'))
    if (creds.project_id) return creds.project_id
    if (creds.quota_project_id) return creds.quota_project_id
  }
  return process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || null
}

// Connect with admin rights. Returns { db, bucket, via }: `bucket` is the
// project's default Storage bucket (or `storageBucket` if given) and is only
// created when asked for via { storage: true }; `via` describes the identity.
export async function connectAdmin(projectId, { storage = false, storageBucket } = {}) {
  if (!projectId) throw new Error('No project ID — pass --project <id>.')
  const bucketName = storageBucket || `${projectId}.firebasestorage.app`

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const { initializeApp, getApps, applicationDefault } = await import('firebase-admin/app')
    const { getFirestore } = await import('firebase-admin/firestore')
    if (!getApps().length) {
      initializeApp({ projectId, storageBucket: bucketName, credential: applicationDefault() })
    }
    let bucket = null
    if (storage) bucket = (await import('firebase-admin/storage')).getStorage().bucket()
    return { db: getFirestore(), bucket, via: process.env.GOOGLE_APPLICATION_CREDENTIALS }
  }

  const { authClient, email } = await firebaseCliAuthClient()
  const { Firestore } = await import('@google-cloud/firestore')
  let bucket = null
  if (storage) {
    const { Storage } = await import('@google-cloud/storage')
    bucket = new Storage({ projectId, authClient }).bucket(bucketName)
  }
  return { db: new Firestore({ projectId, authClient }), bucket, via: `firebase login (${email})` }
}

// OAuth2 client backed by the `firebase login` account. firebase-tools is a
// root devDependency with CommonJS internals; loaded lazily so the key-file
// path works without it.
async function firebaseCliAuthClient() {
  const auth = require('firebase-tools/lib/auth')
  const { requireAuth } = require('firebase-tools/lib/requireAuth')
  const apiv2 = require('firebase-tools/lib/apiv2')
  // Same google-auth-library as the Firestore/Storage transports (v9 here);
  // v10's header shape isn't compatible with them.
  const { OAuth2Client } = createRequire(require.resolve('google-gax'))('google-auth-library')

  const account = auth.getGlobalDefaultAccount()
  if (!account) {
    throw new Error(
      'Not signed in — run `npx firebase login`, or set GOOGLE_APPLICATION_CREDENTIALS to a key file.',
    )
  }
  const email = await requireAuth({ user: account.user, tokens: account.tokens })

  const authClient = new OAuth2Client()
  // Called whenever a (fresh) token is needed; firebase-tools caches and
  // refreshes it. The expiry is only a hint for when to ask again.
  authClient.refreshHandler = async () => ({
    access_token: await apiv2.getAccessToken(),
    expiry_date: Date.now() + 50 * 60 * 1000,
  })
  return { authClient, email }
}
