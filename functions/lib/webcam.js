import { logger } from 'firebase-functions/logger'
import { createHash } from 'node:crypto'
import { getStorage } from 'firebase-admin/storage'
import { FieldValue } from 'firebase-admin/firestore'
import sharp from 'sharp'
import { isRecent, nowInVancouver, timeToDate, dayjs } from './time.js'
import { classifyLineup } from './lineup-classifier.js'

// Photo filenames are timestamped and never rewritten, so browsers can cache
// them forever — without this, GCS's default 1-hour max-age makes every
// return visit re-download ~hundreds of KB per photo.
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'

const WEBCAM_URL = 'https://ccimg.bcferries.com/cc/support/terminals/cam1_bow.jpg'
const COMMUNITY_WEBCAM_URL = 'https://ferrycamera.bowencommunitycentre.com/snapshot.jpg'
const SAMPLE_COUNT = 3
const SAMPLE_DELAY_MS = 1000

async function captureSamples(url) {
  const samples = []
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, SAMPLE_DELAY_MS))
    try {
      const res = await fetch(url)
      const buf = Buffer.from(await res.arrayBuffer())
      samples.push(buf)
    } catch (e) {
      logger.warn(`Webcam sample ${i} failed:`, e.message)
    }
  }
  return samples
}

// The community camera serves 1280×720 JPEGs at ~400 KB — far more than the
// card-sized display needs, and the departures page shows hundreds of them.
// Halve the dimensions and re-encode (~40–60 KB). Compression failure must
// never lose a capture: fall back to the original bytes.
export async function compressSnapshot(buf) {
  try {
    const { width } = await sharp(buf).metadata()
    if (!width) return buf
    return await sharp(buf)
      .resize({ width: Math.round(width / 2) })
      .jpeg({ quality: 80 })
      .toBuffer()
  } catch (e) {
    logger.warn('Snapshot compression failed, storing original:', e.message)
    return buf
  }
}

function pickBestFrame(samples) {
  const byHash = {}
  for (const buf of samples) {
    const h = createHash('md5').update(buf).digest('hex')
    if (!byHash[h]) byHash[h] = []
    byHash[h].push(buf)
  }
  const dupes = Object.values(byHash).find(g => g.length >= SAMPLE_COUNT - 1)
  return dupes ? dupes[0] : samples.sort((a, b) => b.length - a.length)[0]
}

export async function captureBowenWebcam(db, sailingKey, sailingTime, dateIso, recentTime) {
  if (!isRecent(recentTime || sailingTime, 10 * 60 * 1000)) return
  const statusRef = db.collection('sailingStatus').doc(sailingKey)
  const snap = await statusRef.get()
  if (!snap.exists) return
  if (snap.data().webcamSnapshotPath) return

  const samples = await captureSamples(WEBCAM_URL)
  if (samples.length === 0) {
    logger.error('All webcam samples failed for', sailingKey)
    return
  }

  const best = pickBestFrame(samples)
  const timestamp = Date.now()
  const blobPath = `webcams/bowen/${dateIso}/${sailingKey}_${timestamp}.jpg`
  const bucket = getStorage().bucket()
  const file = bucket.file(blobPath)
  await file.save(best, {
    contentType: 'image/jpeg',
    metadata: { cacheControl: IMMUTABLE_CACHE },
  })
  await file.makePublic()

  const imageUrl = `https://storage.googleapis.com/${bucket.name}/${blobPath}`
  const snapshotKey = `${dateIso}_${sailingTime}_To HSB`
  await db.collection('snapshots').doc('latestBowenDeparture').set({
    imageUrl,
    sailingKey: snapshotKey,
    sailingTime,
    dateIso,
    recordedAt: Date.now(),
  })

  await statusRef.set({ webcamSnapshotPath: blobPath }, { merge: true })
  logger.log(`Saved webcam snapshot: ${blobPath} (${best.length}B, ${samples.length} samples)`)
}

export async function captureBowenCommunityWebcam(db, sailingTime, dateIso, arrivalTime) {
  if (!isRecent(sailingTime, 10 * 60 * 1000)) return
  const arrivalRef = db.collection('snapshots').doc('latestBowenArrival')
  const snap = await arrivalRef.get()
  if (snap.exists && snap.data().arrivalTime === arrivalTime) return

  const samples = await captureSamples(COMMUNITY_WEBCAM_URL)
  if (samples.length === 0) {
    logger.error('All community webcam samples failed')
    return
  }

  const best = await compressSnapshot(pickBestFrame(samples))
  const timestamp = Date.now()
  const blobPath = `webcams/community/${dateIso}/${sailingTime}_To HSB_${timestamp}.jpg`
  const bucket = getStorage().bucket()
  const file = bucket.file(blobPath)
  await file.save(best, {
    contentType: 'image/jpeg',
    metadata: { cacheControl: IMMUTABLE_CACHE },
  })
  await file.makePublic()

  const imageUrl = `https://storage.googleapis.com/${bucket.name}/${blobPath}`
  const snapshotKey = `${dateIso}_${sailingTime}_To HSB`
  await arrivalRef.set({
    imageUrl,
    arrivalTime,
    sailingKey: snapshotKey,
    dateIso,
    recordedAt: Date.now(),
  })

  // Stamp the sailing the lineup photo predicts (the next Bowen departure), so
  // past sailings keep a pointer to their arrival photo after the singleton
  // doc moves on. Re-captures overwrite: the newest lineup photo wins.
  await db.collection('sailingStatus').doc(snapshotKey).set(
    {
      sailingKey: snapshotKey,
      sailingTime,
      direction: 'To HSB',
      dateIso,
      communitySnapshotPath: blobPath,
      communityArrivalTime: arrivalTime,
    },
    { merge: true },
  )

  logger.log(`Saved community webcam snapshot: ${blobPath} (${best.length}B, ${samples.length} samples)`)
}

// Lineup timelapse: between sailings, the community camera shows the car
// lineup building for the NEXT Bowen departure. Decide (statelessly — the
// poll runs every minute, so `minute % 5` gives a 5-minute cadence with no
// stored state and no Firestore reads) whether this poll should capture a
// frame:
//   - only from 30 min after the previous Bowen departure (before that the
//     lot is mostly empty),
//   - never for departures scheduled at/after 9 pm,
//   - attributed to the next upcoming Bowen departure.
export function timelapseDecision(data, now) {
  if (now.minute() % 5 !== 0) return { capture: false }

  // Last Bowen departure today: the atberth/AIS log is newest-first. When it
  // has no Bowen departure (stale log, early morning), fall back to the most
  // recent *scheduled* time already in the past — close enough for a 30-min
  // buffer. No departure today at all (overnight) → no capture.
  const depEntry = (data.recentActivity || []).find(
    (e) => e.action === 'Departed' && e.location === 'Bowen',
  )
  let lastDep = depEntry ? timeToDate(depEntry.time) : null
  if (!lastDep) {
    for (const s of data.bowenSchedule || []) {
      const t = timeToDate(s.time)
      if (t && t < now && (!lastDep || t > lastDep)) lastDep = t
    }
  }
  if (!lastDep) return { capture: false }

  const nextDep = (data.bowenSchedule || []).find((s) => {
    const t = timeToDate(s.time)
    return t && t > now
  })
  if (!nextDep) return { capture: false }
  if (parseInt(nextDep.time.split(':')[0], 10) >= 21) return { capture: false }

  if (now.diff(lastDep, 'minute') < 30) return { capture: false }

  return { capture: true, sailingTime: nextDep.time }
}

export async function captureLineupTimelapse(db, data) {
  const decision = timelapseDecision(data, nowInVancouver())
  if (!decision.capture) return

  const samples = await captureSamples(COMMUNITY_WEBCAM_URL)
  if (samples.length === 0) {
    logger.error('All lineup timelapse samples failed')
    return
  }

  const best = await compressSnapshot(pickBestFrame(samples))
  const timestamp = Date.now()
  // Under webcams/ so cleanupOldWebcams ages frames out; the _{epoch}.jpg
  // suffix keeps the client's captureTimeLabel() parsing working.
  const blobPath = `webcams/community/${data.dateIso}/timelapse/${decision.sailingTime}_To HSB_${timestamp}.jpg`
  const bucket = getStorage().bucket()
  const file = bucket.file(blobPath)
  await file.save(best, {
    contentType: 'image/jpeg',
    metadata: { cacheControl: IMMUTABLE_CACHE },
  })
  await file.makePublic()

  const snapshotKey = `${data.dateIso}_${decision.sailingTime}_To HSB`

  // Automated crosswalk detection (no-op until a trained model is committed —
  // see lib/lineup-classifier.js). Kept separate from the human-tagged
  // crosswalkFullAt so agreement can be measured before the auto value is
  // trusted anywhere. First positive frame wins, mirroring onLineupReport.
  const autoFields = {}
  const verdict = await classifyLineup(best)
  if (verdict?.fullToCrosswalk) {
    const snap = await db.collection('sailingStatus').doc(snapshotKey).get()
    if (!snap.exists || !snap.data().crosswalkFullAtAuto) {
      autoFields.crosswalkFullAtAuto = timestamp
      autoFields.crosswalkAutoProb = Math.round(verdict.probability * 1000) / 1000
    }
  }

  await db.collection('sailingStatus').doc(snapshotKey).set(
    {
      sailingKey: snapshotKey,
      sailingTime: decision.sailingTime,
      direction: 'To HSB',
      dateIso: data.dateIso,
      lineupTimelapsePaths: FieldValue.arrayUnion(blobPath),
      ...autoFields,
    },
    { merge: true },
  )

  logger.log(`Saved lineup timelapse frame: ${blobPath} (${best.length}B)`)
}

// Departure timelapse: the Bowen TERMINAL camera as the ferry loads. Unlike
// the lineup (community) timelapse, capture EVERY minute (no 5-min gate),
// starting 10 minutes before a departure and continuing until the ferry
// actually leaves. Departure is detected via matchedDepartureTime, which the
// poll's final matchDepartures sets on the schedule entry once the sailing
// has left — so once it departs, the target no longer matches and capture
// stops on its own. The -20 min lower bound is a safety cap for a sailing
// whose departure is never detected (stale log) so it can't capture forever.
export function departureTimelapseDecision(data, now) {
  const target = (data.bowenSchedule || []).find((s) => {
    if (s.matchedDepartureTime) return false // already departed
    const t = timeToDate(s.time)
    if (!t) return false
    const minsUntil = t.diff(now, 'minute') // >0 future, <0 past (running late)
    return minsUntil <= 10 && minsUntil >= -20
  })
  if (!target) return { capture: false }
  return { capture: true, sailingTime: target.time }
}

export async function captureDepartureTimelapse(db, data) {
  const decision = departureTimelapseDecision(data, nowInVancouver())
  if (!decision.capture) return

  const samples = await captureSamples(WEBCAM_URL)
  if (samples.length === 0) {
    logger.error('All departure timelapse samples failed')
    return
  }

  // Terminal cam is already low-resolution (~14 KB); keep it uncompressed to
  // preserve detail (potential future departure-fullness ML), like the single
  // departure photo (captureBowenWebcam).
  const best = pickBestFrame(samples)
  const timestamp = Date.now()
  const blobPath = `webcams/bowen/${data.dateIso}/timelapse/${decision.sailingTime}_To HSB_${timestamp}.jpg`
  const bucket = getStorage().bucket()
  const file = bucket.file(blobPath)
  await file.save(best, {
    contentType: 'image/jpeg',
    metadata: { cacheControl: IMMUTABLE_CACHE },
  })
  await file.makePublic()

  const snapshotKey = `${data.dateIso}_${decision.sailingTime}_To HSB`
  await db.collection('sailingStatus').doc(snapshotKey).set(
    {
      sailingKey: snapshotKey,
      sailingTime: decision.sailingTime,
      direction: 'To HSB',
      dateIso: data.dateIso,
      departureTimelapsePaths: FieldValue.arrayUnion(blobPath),
    },
    { merge: true },
  )

  logger.log(`Saved departure timelapse frame: ${blobPath} (${best.length}B)`)
}

export async function cleanupOldWebcams() {
  const bucket = getStorage().bucket()
  const cutoff = nowInVancouver().subtract(14, 'day')
  let deleted = 0
  let failed = 0

  const [files] = await bucket.getFiles({ prefix: 'webcams/' })
  for (const file of files) {
    // getFiles() already returns metadata — a per-file getMetadata() call
    // here would cost one Class B op per stored photo, every night.
    const meta = file.metadata || {}
    if (meta.timeCreated && dayjs(meta.timeCreated) < cutoff) {
      try {
        await file.delete()
        deleted++
      } catch (e) {
        logger.error(`Failed to delete ${file.name}:`, e.message)
        failed++
      }
    }
  }

  logger.log(`Webcam cleanup: deleted ${deleted}, failed ${failed}, remaining ${files.length - deleted}`)
}
