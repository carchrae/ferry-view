import { logger } from 'firebase-functions/logger'
import { createHash } from 'node:crypto'
import { getStorage } from 'firebase-admin/storage'
import { FieldValue } from 'firebase-admin/firestore'
import sharp from 'sharp'
import { isRecent, nowInVancouver, timeToDate, dayjs, TZ } from './time.js'
import { classifyLineup } from './lineup-classifier.js'
import { upsertBowenSailing } from './bowen-sailings-aggregate.js'
import { scheduleWindowEnd } from './matching.js'

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
  await upsertBowenSailing(db, { dateIso, sailingTime, wp: blobPath })
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
  await upsertBowenSailing(db, { dateIso, sailingTime, cp: blobPath, ca: arrivalTime })

  logger.log(`Saved community webcam snapshot: ${blobPath} (${best.length}B, ${samples.length} samples)`)
}

// Last Bowen departure today: the atberth/AIS log is newest-first. When it
// has no Bowen departure (stale log, early morning), fall back to the most
// recent *scheduled* time already in the past — close enough for a 30-min
// buffer. Returns a dayjs, or null when nothing has departed today
// (overnight / before the first sailing).
export function lastBowenDeparture(data, now) {
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
  return lastDep
}

// When did the ferry arrive back at Bowen for the CURRENT loading cycle?
// Returns a dayjs, or null when it hasn't (or the arrival can't be seen).
// The AIS level classification is primary and reflects the present: docked
// at Bowen right now IS arrived — even when the schedule says this sailing
// should already have left, a late-boarding ferry is still at the dock (so
// no comparison against the last departure, whose schedule-time fallback
// would wrongly declare a late boarder "gone" the minute its scheduled time
// passes). Any other classification means it isn't there.
// Without AIS, fall back to the newest Arrived/Bowen log event, gated to be
// at/after the last (possibly schedule-inferred) departure — a stale log
// that recorded an arrival but missed the departure after it must not read
// as "still docked" forever.
export function bowenArrivalForCurrentCycle(data, now) {
  if (data.aisLocation != null) {
    if (data.aisLocation !== 'Bowen') return null
    return data.aisLocationSince ? dayjs(data.aisLocationSince).tz(TZ) : now
  }
  const arr = (data.recentActivity || []).find(
    (e) => e.action === 'Arrived' && e.location === 'Bowen',
  )
  if (arr) {
    const t = timeToDate(arr.time)
    const lastDep = lastBowenDeparture(data, now)
    if (t && (!lastDep || t >= lastDep)) return t
  }
  return null
}

// Can we see arrivals at all? False when AIS classification is absent AND the
// activity log has never mentioned Bowen — then "no arrival" means "blind",
// not "ferry still out", and the terminal camera falls back to its legacy
// schedule-only window.
export function arrivalSignalAvailable(data) {
  if (data.aisLocation != null) return true
  return (data.recentActivity || []).some((e) => e.location === 'Bowen')
}

// Lineup timelapse: between sailings, the community camera shows the car
// lineup building for the NEXT Bowen departure. Decide (statelessly — the
// poll runs every minute, so `minute % 5` gives a 5-minute cadence with no
// stored state and no Firestore reads) whether this poll should capture a
// frame:
//   - only from 15 min after the previous Bowen departure (before that the
//     lot is mostly empty — and sailings that fill up do so early, so the
//     window opens well before the lineup peaks),
//   - until the ferry arrives back at Bowen (loading from there on is the
//     terminal camera's job — see departureTimelapseDecision),
//   - never for departures scheduled at/after 9 pm,
//   - attributed to the next upcoming Bowen departure.
const LINEUP_WAIT_AFTER_DEP_MIN = 15

export function timelapseDecision(data, now) {
  if (now.minute() % 5 !== 0) return { capture: false }

  const lastDep = lastBowenDeparture(data, now)
  if (!lastDep) return { capture: false }

  // The lineup is building for the earliest sailing that hasn't departed yet —
  // NOT `first scheduled time > now`. When a sailing is boarding past its
  // scheduled time, "time > now" skips it and credits its lineup to the NEXT
  // sailing, so that next sailing's timelapse wrongly opens with the current
  // sailing's crowd. matchedDepartureTime (set by the poll once a sailing
  // leaves) marks departed sailings; scheduleWindowEnd (bounded by the next
  // entry's own time, or +90min for the day's last sailing) excludes ancient
  // sailings that were never matched (log gaps) so they can't become a
  // permanent target — while still crediting a sailing that's simply running
  // very late, however late, right up until the next one supersedes it.
  const schedule = data.bowenSchedule || []
  const nextDep = schedule.find((s, i) => {
    if (s.matchedDepartureTime) return false
    const t = timeToDate(s.time)
    return t && now.isBefore(scheduleWindowEnd(schedule, i))
  })
  if (!nextDep) return { capture: false }
  if (parseInt(nextDep.time.split(':')[0], 10) >= 21) return { capture: false }

  if (now.diff(lastDep, 'minute') < LINEUP_WAIT_AFTER_DEP_MIN) return { capture: false }

  // Ferry is back at the dock: the lineup has stopped building (it's
  // draining onto the boat) and the terminal camera has taken over.
  if (bowenArrivalForCurrentCycle(data, now)) return { capture: false }

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
  await upsertBowenSailing(db, {
    dateIso: data.dateIso,
    sailingTime: decision.sailingTime,
    addLineupTs: timestamp,
  })

  logger.log(`Saved lineup timelapse frame: ${blobPath} (${best.length}B)`)
}

// Departure timelapse: the Bowen TERMINAL camera as the ferry loads. Unlike
// the lineup (community) timelapse, capture EVERY minute (no 5-min gate),
// from max(ferry arrival at Bowen, 10 min before the scheduled time) —
// loading can't start before the boat is back, so a late ferry shouldn't
// burn frames on an empty berth — and continuing until the ferry actually
// leaves. Departure is detected via matchedDepartureTime, which the poll's
// final matchDepartures sets on the schedule entry once the sailing has
// left — so once it departs, the target no longer matches and capture stops
// on its own. Safety bounds for when detection fails: at most CAP_MIN past
// the effective start (missed departure), never a sailing whose
// scheduleWindowEnd has passed (a never-matched ghost entry would otherwise
// adopt the next cycle's arrival and capture again — see scheduleWindowEnd
// in matching.js; bounded by the NEXT entry's own time, not a flat minute
// count, so a sailing that's simply running very late keeps its frames no
// matter how late, right up until the next one supersedes it). When arrival
// can't be seen at all (AIS out, empty log) fall back to the legacy
// schedule-only window so an outage degrades precision, not coverage.
const DEPARTURE_PRE_MIN = 10 // window opens T−10
const DEPARTURE_CAP_MIN = 30 // stop 30 min after effective start
const DEPARTURE_LEGACY_LATE_MIN = 20 // degraded mode: legacy T−10..T+20

export function departureTimelapseDecision(data, now) {
  const degraded = !arrivalSignalAvailable(data)
  const arrivedAt = degraded ? null : bowenArrivalForCurrentCycle(data, now)
  const schedule = data.bowenSchedule || []
  const target = schedule.find((s, i) => {
    if (s.matchedDepartureTime) return false // already departed
    const t = timeToDate(s.time)
    if (!t) return false
    if (!now.isBefore(scheduleWindowEnd(schedule, i))) return false // ghost target
    const windowStart = t.subtract(DEPARTURE_PRE_MIN, 'minute')
    if (now.isBefore(windowStart)) return false
    if (degraded) return now.diff(t, 'minute') <= DEPARTURE_LEGACY_LATE_MIN
    if (!arrivedAt) return false // detection healthy, ferry not back yet
    const effStart = arrivedAt.isAfter(windowStart) ? arrivedAt : windowStart
    return now.diff(effStart, 'minute') <= DEPARTURE_CAP_MIN
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
  await upsertBowenSailing(db, {
    dateIso: data.dateIso,
    sailingTime: decision.sailingTime,
    addDepartureTs: timestamp,
  })

  logger.log(`Saved departure timelapse frame: ${blobPath} (${best.length}B)`)
}

export async function cleanupOldWebcams() {
  const bucket = getStorage().bucket()
  const cutoff = nowInVancouver().subtract(42, 'day')
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
