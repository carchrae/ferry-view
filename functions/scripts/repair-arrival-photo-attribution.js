/**
 * One-off repair: re-attribute TODAY's misattributed arrival (community-cam)
 * photos to the sailing each arrival actually served.
 *
 * Root cause (fixed in captureWebcams / arrivalLineupTarget, 2026-07-23): the
 * arrival photo used to be stamped on the first schedule entry *scheduled*
 * after the arrival time. With the single boat running late all day, every
 * arrival happens after the scheduled time of the sailing it serves, so every
 * photo landed one sailing forward (e.g. the 11:37 arrival that served the
 * 11:15 sailing was stamped on 12:35).
 *
 * What it does, per To-HSB sailingStatus doc for the target date that carries
 * communitySnapshotPath/communityArrivalTime:
 *   1. recomputes the correct sailing with arrivalLineupTarget (the same
 *      logic the live capture now uses), against the actual matched
 *      departures in ferryStatus/current;
 *   2. moves cp/ca to the correct doc (newest arrival wins on collision,
 *      matching the live capture's re-capture-overwrites rule), clearing them
 *      from docs left photo-less;
 *   3. fixes the sailingKey on the snapshots/latestBowenArrival singleton if
 *      it points at a moved photo;
 *   4. rebuilds aggregates/bowenSailings from the corrected docs
 *      (recomputeBowenSailings — same code as the nightly rebuild).
 *
 * Storage blobs are NOT renamed: the wrong sailing time baked into a moved
 * blob's filename is cosmetic (clients read the full stored path and parse
 * only the epoch suffix for labels).
 *
 * Must run on the same Vancouver day as the data (timeToDate binds HH:mm to
 * today); it refuses to run otherwise.
 *
 * Usage:
 *   node functions/scripts/repair-arrival-photo-attribution.js [--project bowen-ferry-staging] [--dry-run]
 *
 * Auth: application-default credentials (same as restore-db.js).
 */

import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { arrivalLineupTarget } from '../lib/webcam-decision.js'
import { recomputeBowenSailings } from '../lib/bowen-sailings-aggregate.js'
import { timeToDate, nowInVancouver } from '../lib/time.js'

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const flagIdx = args.indexOf('--project')
const PROJECT = flagIdx >= 0 ? args[flagIdx + 1] : 'bowen-ferry-staging'

if (!getApps().length) {
  initializeApp({ projectId: PROJECT, credential: applicationDefault() })
}
const db = getFirestore()

async function main() {
  console.log(`Project: ${PROJECT}  Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`)

  const currentSnap = await db.collection('ferryStatus').doc('current').get()
  if (!currentSnap.exists) throw new Error('ferryStatus/current not found')
  const data = currentSnap.data()
  const todayIso = nowInVancouver().format('YYYY-MM-DD')
  if (data.dateIso !== todayIso) {
    throw new Error(
      `ferryStatus/current is for ${data.dateIso}, not today (${todayIso}) — ` +
        'this script can only repair the current day (timeToDate binds to today).',
    )
  }

  const statusSnap = await db
    .collection('sailingStatus')
    .where('direction', '==', 'To HSB')
    .where('dateIso', '==', todayIso)
    .get()

  const byTime = new Map()
  statusSnap.forEach((doc) => byTime.set(doc.data().sailingTime, doc.data()))

  // Where should each captured arrival photo live? Newest arrival wins when
  // two map to the same sailing (mirrors the live re-capture-overwrites rule).
  const now = nowInVancouver()
  const desired = new Map() // sailingTime -> { cp, ca, from }
  for (const [time, s] of byTime) {
    if (!s.communitySnapshotPath || !s.communityArrivalTime) continue
    const arrivalTime = timeToDate(s.communityArrivalTime)
    const target = arrivalTime ? arrivalLineupTarget(data, arrivalTime, now) : null
    if (!target) {
      console.warn(`  SKIP ${time}: no target for arrival ${s.communityArrivalTime}`)
      continue
    }
    const prev = desired.get(target.time)
    if (prev && prev.ca >= s.communityArrivalTime) {
      console.log(`  DROP older arrival ${s.communityArrivalTime} for ${target.time} (kept ${prev.ca})`)
      continue
    }
    desired.set(target.time, {
      cp: s.communitySnapshotPath,
      ca: s.communityArrivalTime,
      from: time,
    })
  }

  const times = new Set([...byTime.keys(), ...desired.keys()])
  let moves = 0
  const batch = db.batch()
  for (const time of [...times].sort()) {
    const cur = byTime.get(time)
    const want = desired.get(time)
    if ((cur?.communitySnapshotPath || null) === (want?.cp || null)) continue

    const key = `${todayIso}_${time}_To HSB`
    const ref = db.collection('sailingStatus').doc(key)
    if (want) {
      console.log(`  MOVE  arrival ${want.ca} photo: ${want.from} -> ${time}`)
      batch.set(
        ref,
        {
          sailingKey: key,
          sailingTime: time,
          direction: 'To HSB',
          dateIso: todayIso,
          communitySnapshotPath: want.cp,
          communityArrivalTime: want.ca,
        },
        { merge: true },
      )
    } else {
      console.log(`  CLEAR ${time}: its photo (arrival ${cur.communityArrivalTime}) belongs elsewhere`)
      batch.update(ref, {
        communitySnapshotPath: FieldValue.delete(),
        communityArrivalTime: FieldValue.delete(),
      })
    }
    moves++
  }

  // The singleton's sailingKey may point at the sailing the newest photo was
  // wrongly stamped on; repoint it at that arrival's corrected sailing.
  const latestRef = db.collection('snapshots').doc('latestBowenArrival')
  const latestSnap = await latestRef.get()
  if (latestSnap.exists) {
    const latest = latestSnap.data()
    const entry = [...desired.entries()].find(([, w]) => w.ca === latest.arrivalTime)
    if (entry) {
      const correctKey = `${todayIso}_${entry[0]}_To HSB`
      if (latest.sailingKey !== correctKey) {
        console.log(`  FIX latestBowenArrival sailingKey: ${latest.sailingKey} -> ${correctKey}`)
        if (!DRY_RUN) await latestRef.set({ ...latest, sailingKey: correctKey })
      }
    }
  }

  if (DRY_RUN) {
    console.log(`Dry run: ${moves} doc change(s) planned, nothing written.`)
    return
  }
  if (moves) await batch.commit()
  console.log(`sailingStatus: ${moves} doc(s) updated.`)

  const { count } = await recomputeBowenSailings(db)
  console.log(`aggregates/bowenSailings rebuilt (${count} sailings).`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
