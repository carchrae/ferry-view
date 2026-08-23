import { createHash } from 'node:crypto'
import { logger } from 'firebase-functions/logger'

// Stalled-camera detection.
//
// Both webcams burn a clock into every frame, so two genuinely fresh captures
// can never be byte-identical. When a camera freezes, its server keeps serving
// the last good JPEG unchanged — the fetch succeeds, the bytes are valid, and
// every downstream consumer happily "works": we upload the same picture into
// the timelapse over and over and run the classifiers on a photo of the past.
// A frozen frame is worse than no frame, because the crosswalk/terminal
// verdicts it produces look exactly like real ones.
//
// So: hash the frame we picked and compare it to the previous capture from the
// same camera. Both cameras refresh about once a minute, which is what makes a
// repeat meaningful and lets detection be fast — see the two rules below.
//
// Being wrong in the "stalled" direction is cheap: recovery is immediate (the
// very next differing frame clears it), so a false positive costs one skipped
// capture. Being wrong the other way means predictions built on a photo of the
// past, which is expensive and invisible. So the rules lean aggressive.

export const CAMERA_BOWEN = 'bowen'
export const CAMERA_COMMUNITY = 'community'

// Human-readable, for logs and the UI banner.
export const CAMERA_LABELS = {
  [CAMERA_BOWEN]: 'Bowen terminal',
  [CAMERA_COMMUNITY]: 'Bowen Community Centre',
}

// Rule 1, for the departure timelapse's 1-per-minute cadence. Capture and
// refresh run at the same rate, so sampling can land twice inside one refresh
// and see the same frame twice — but not three times.
export const STALE_IDENTICAL_FRAMES = 3

// Rule 2, for everything slower: the lineup timelapse (1 per 5 min) and the
// one-shot arrival/departure photos. Two captures this far apart straddle at
// least one refresh, so identical bytes are already conclusive and waiting for
// a third would just cost minutes. At the 5-minute lineup cadence this is what
// does the detecting: 10 minutes down to 5.
export const CONCLUSIVE_GAP_MS = 150 * 1000

// While a camera stays broken the health doc is re-stamped this often, so the
// client can tell "stale, still being checked" from a doc left behind by a
// poll that itself died. Transitions always write immediately.
export const HEARTBEAT_MS = 15 * 60 * 1000

export const HEALTH_DOC_PATH = ['snapshots', 'webcamHealth']

export function frameHash(buf) {
  return createHash('md5').update(buf).digest('hex')
}

// Per-instance mirror of the health doc. The 1-minute poll keeps one instance
// warm, so in steady state this costs zero Firestore reads: the doc is read
// once per cold start and written only on a state change or heartbeat.
let cache = null

// Test seam.
export function _resetHealthCache() {
  cache = null
}

async function loadCache(db) {
  if (cache) return cache
  cache = {}
  try {
    const snap = await db.collection(HEALTH_DOC_PATH[0]).doc(HEALTH_DOC_PATH[1]).get()
    if (snap.exists) {
      const data = snap.data() || {}
      for (const camera of [CAMERA_BOWEN, CAMERA_COMMUNITY]) {
        if (data[camera]) cache[camera] = { ...data[camera] }
      }
    }
  } catch (e) {
    // A health doc we can't read just means we start from scratch: the first
    // capture re-seeds the hash and detection resumes one interval later.
    logger.warn('Webcam health doc read failed:', e.message)
  }
  return cache
}

/**
 * Record a freshly captured frame and report whether its camera has stalled.
 *
 * Call with the frame actually chosen by pickBestFrame, BEFORE compression —
 * the raw upstream bytes are what repeats, and hashing pre-compression keeps
 * the comparison independent of sharp's encoder.
 *
 * @returns {Promise<{stale: boolean, staleSince: number|null, identicalRun: number,
 *   lastChangeAt: number, justBroke: boolean, justRecovered: boolean}>}
 */
export async function recordFrame(db, camera, buf, now = Date.now()) {
  const state = await loadCache(db)
  const hash = frameHash(buf)
  const prev = state[camera]

  let entry
  if (!prev || prev.hash !== hash) {
    entry = { hash, lastChangeAt: now, identicalRun: 1, stale: false, staleSince: null }
  } else {
    // Consecutive captures that came back byte-for-byte identical, counting
    // this one and the first of the run.
    const identicalRun = (prev.identicalRun || 1) + 1
    const gapMs = now - (prev.lastFrameAt ?? now)
    const stale = identicalRun >= STALE_IDENTICAL_FRAMES || gapMs >= CONCLUSIVE_GAP_MS
    entry = {
      hash,
      lastChangeAt: prev.lastChangeAt || now,
      identicalRun,
      stale,
      staleSince: stale ? prev.staleSince || now : null,
    }
  }

  const wasStale = Boolean(prev?.stale)
  const justBroke = entry.stale && !wasStale
  const justRecovered = !entry.stale && wasStale

  entry.lastFrameAt = now
  state[camera] = entry

  const label = CAMERA_LABELS[camera] || camera
  if (justBroke) {
    logger.warn(
      `Webcam stalled: ${label} has served the same frame since ` +
        `${new Date(entry.lastChangeAt).toISOString()} ` +
        `(${Math.round((now - entry.lastChangeAt) / 60000)}m, ${entry.identicalRun} identical captures) — ` +
        'suspending capture and predictions for this camera',
    )
  } else if (justRecovered) {
    logger.log(`Webcam recovered: ${label} is serving fresh frames again`)
  }

  const heartbeatDue =
    entry.stale && (!prev?.lastCheckedAt || now - prev.lastCheckedAt >= HEARTBEAT_MS)
  if (justBroke || justRecovered || heartbeatDue) {
    entry.lastCheckedAt = now
    await publish(db, camera, entry, now).catch((e) =>
      logger.warn('Webcam health publish failed:', e.message),
    )
  } else if (prev?.lastCheckedAt) {
    entry.lastCheckedAt = prev.lastCheckedAt
  }

  return {
    stale: entry.stale,
    staleSince: entry.staleSince,
    identicalRun: entry.identicalRun,
    lastChangeAt: entry.lastChangeAt,
    justBroke,
    justRecovered,
  }
}

async function publish(db, camera, entry, now) {
  await db
    .collection(HEALTH_DOC_PATH[0])
    .doc(HEALTH_DOC_PATH[1])
    .set(
      {
        [camera]: {
          stale: entry.stale,
          staleSince: entry.staleSince,
          lastChangeAt: entry.lastChangeAt,
          lastCheckedAt: now,
          label: CAMERA_LABELS[camera] || camera,
          // Carried so a function instance recycling mid-outage picks the run
          // back up instead of treating its first frame as a change — which
          // would publish a false "recovered" and clear the rider-facing
          // banner on a camera that never came back.
          hash: entry.hash,
          identicalRun: entry.identicalRun,
          lastFrameAt: entry.lastFrameAt,
        },
        updatedAt: now,
      },
      { merge: true },
    )
}

// Logged by each capture path when it bails, so the reason a sailing has no
// frames is visible in the same place the frames would have been logged.
export function staleSkipMessage(kind, camera, health, now = Date.now()) {
  const label = CAMERA_LABELS[camera] || camera
  const mins = Math.round((now - health.lastChangeAt) / 60000)
  return `${kind} skipped: ${label} camera is stalled (frozen ${mins}m) — no capture, no prediction`
}
