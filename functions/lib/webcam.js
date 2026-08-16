import { logger } from 'firebase-functions/logger'
import { createHash } from 'node:crypto'
import { getStorage } from 'firebase-admin/storage'
import { FieldValue } from 'firebase-admin/firestore'
import sharp from 'sharp'
import { isRecent, nowInVancouver, timeToDate, dayjs } from './time.js'
import { classifyLineup, lineupModelVersion, modelUsable } from './lineup-classifier.js'
import { classifyTerminal, terminalModelVersion } from './terminal-classifier.js'
import { upsertBowenSailing } from './bowen-sailings-aggregate.js'
import { updateSailingStatus } from './helpers.js'
import { robotMayFillCrosswalk, MIN_ALL_EMPTY_FRAMES } from './lineup-labels.js'
import {
  lastBowenDeparture,
  bowenArrivalForCurrentCycle,
  arrivalSignalAvailable,
  timelapseDecision,
  departureTimelapseDecision,
} from './webcam-decision.js'

// Re-exported so existing imports of the decision logic from this file (and
// the test suite) keep working — the actual definitions now live in
// webcam-decision.js, which has no Storage/logger/sharp dependencies and is
// therefore safe to import from the client bundle (see HomePage.vue's
// debug-info capture).
export {
  lastBowenDeparture,
  bowenArrivalForCurrentCycle,
  arrivalSignalAvailable,
  timelapseDecision,
  departureTimelapseDecision,
}

// Photo filenames are timestamped and never rewritten, so browsers can cache
// them forever — without this, GCS's default 1-hour max-age makes every
// return visit re-download ~hundreds of KB per photo.
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'

const WEBCAM_URL = 'https://ccimg.bcferries.com/cc/support/terminals/cam1_bow.jpg'
const COMMUNITY_WEBCAM_URL = 'https://ferrycamera.bowencommunitycentre.com/snapshot.jpg'
const SAMPLE_COUNT = 3
const SAMPLE_DELAY_MS = 1000
// A crosswalkAutoPending may only be confirmed by the NEXT timelapse frame
// (one 5-min cadence step, plus jitter). Older pendings can't promote:
// intervening frames may have been negative without a trace (classify-first
// probes discard non-sticky negatives without a write; webcam fetches fail).
const PENDING_CONFIRM_MAX_MS = 7 * 60 * 1000

// Logs which sailing a capture was attributed to and how late that sailing
// is against its scheduled time — the trace needed to reconstruct why a
// frame landed where it did after the fact (see scheduleWindowEnd in
// matching.js, and the debug-info capture on HomePage.vue which surfaces
// the same lateness/window numbers live). A `warn` once lateness passes
// LATE_ATTRIBUTION_WARN_MIN makes sustained delays searchable in Cloud
// Functions logs even when nobody's watching the departures page.
const LATE_ATTRIBUTION_WARN_MIN = 45

function logAttribution(kind, decision, now) {
  const t = timeToDate(decision.sailingTime)
  const lateMin = t ? Math.round(now.diff(t, 'minute')) : null
  const msg = `${kind} attributed to ${decision.sailingTime}` +
    (lateMin != null ? ` (${lateMin}m late)` : ' (unknown lateness)')
  if (lateMin != null && lateMin >= LATE_ATTRIBUTION_WARN_MIN) {
    logger.warn(msg)
  } else {
    logger.log(msg)
  }
}

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
  // recentTime is the actual (matched) departure time — carry it into the
  // aggregate so the departures page can label lateness without waiting for
  // the nightly rebuild to pick up sailingStatus.actualDepartureTime.
  await upsertBowenSailing(db, { dateIso, sailingTime, wp: blobPath, dep: recentTime })
  logger.log(`Saved webcam snapshot: ${blobPath} (${best.length}B, ${samples.length} samples)`)
}

export async function captureBowenCommunityWebcam(db, sailingTime, dateIso, arrivalTime) {
  // Stale-poll guard on the ARRIVAL's recency, not the sailing's scheduled
  // time: a late boarder's target sailing is already minutes past its
  // scheduled time when the ferry docks (arrivalLineupTarget keeps such a
  // sailing as the target on purpose), so gating on sailingTime would skip
  // the photo for any ferry running >10 min late — the exact case the
  // late-boarder targeting exists for. An arrival event older than 10 min is
  // a replayed/stale log, not a fresh docking.
  if (!isRecent(arrivalTime, 10 * 60 * 1000)) return
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

export async function captureLineupTimelapse(db, data) {
  const now = nowInVancouver()
  const decision = timelapseDecision(data, now)
  if (!decision.capture && !decision.classifyFirst) return
  // Classify-first probe (wait gate after the previous departure, or the
  // whole cycle of a post-9pm sailing): the frame is only worth saving if
  // the classifier says the lineup is (or was — sticky) full, so without a
  // usable model there is nothing to do — skip even the fetch.
  if (decision.classifyFirst && !modelUsable()) return

  const samples = await captureSamples(COMMUNITY_WEBCAM_URL)
  if (samples.length === 0) {
    logger.error('All lineup timelapse samples failed')
    return
  }

  const best = await compressSnapshot(pickBestFrame(samples))
  const timestamp = Date.now()

  // Classified before the upload (same compressed buffer as always, so
  // training stays consistent): a classify-first probe writes nothing unless
  // the lineup is already full — or was already detected full (sticky).
  const verdict = await classifyLineup(best)

  const snapshotKey = `${data.dateIso}_${decision.sailingTime}_To HSB`
  // At most ONE sailingStatus read per invocation: shared by the sticky
  // check below and the pending/auto logic further down.
  let cur = null
  if (verdict || decision.classifyFirst) {
    const snap = await db.collection('sailingStatus').doc(snapshotKey).get()
    cur = snap.exists ? snap.data() : {}
  }

  if (decision.classifyFirst && !verdict?.fullToCrosswalk) {
    // Sticky detection: once the classifier has CONFIRMED the crosswalk full
    // for this sailing (crosswalkFullAtAuto — permanent, survives a human
    // refute; rider tags land post-sailing so they can't be a live trigger),
    // every 5-min frame keeps saving until the arrival stop, negatives
    // included. A non-sticky negative probe is discarded: 1 read, no writes.
    if (!cur.crosswalkFullAtAuto) return
  } else if (decision.classifyFirst) {
    logger.log(
      `Lineup probe positive (p=${verdict.probability.toFixed(2)}) — capturing frame for ${decision.sailingTime}`,
    )
  }

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

  // Automated crosswalk detection (no-op until a trained model is committed —
  // see lib/lineup-classifier.js). The auto fields are permanent: a later
  // human mark overwrites the report fields but never removes these, so
  // human-vs-robot agreement stays measurable per model version. Streaming
  // form of firstSustainedPositiveTs() (lineup-labels.js): a positive frame
  // only becomes crosswalkFullAtAuto once the NEXT frame is also positive —
  // a lone positive is noise, so it parks as crosswalkAutoPending and a
  // negative frame clears it. The stamped time is the FIRST frame of the
  // confirmed pair — and the pair must be CONSECUTIVE: a pending older than
  // one cadence step (plus jitter) can't confirm, because the frames between
  // may have been negative without us seeing it (a classify-first probe
  // discards non-sticky negative frames without a write, and webcam fetches
  // can fail); a stale pending is replaced by the current frame instead.
  // A confirmed verdict is also recorded as a robot REPORT
  // (crosswalkFullAt + crosswalkSource:'robot') when no human mark exists and
  // no fresher human "not yet" refute blocks it (robotMayFillCrosswalk) —
  // humans always overwrite or refute it (see user-lineup.js).
  const autoFields = {}
  let robotReported = false
  if (verdict) {
    if (!cur.crosswalkFullAtAuto) {
      if (verdict.fullToCrosswalk) {
        if (
          cur.crosswalkAutoPending &&
          timestamp - cur.crosswalkAutoPending.ts <= PENDING_CONFIRM_MAX_MS
        ) {
          autoFields.crosswalkFullAtAuto = cur.crosswalkAutoPending.ts
          autoFields.crosswalkAutoProb = cur.crosswalkAutoPending.prob
          autoFields.crosswalkAutoPending = FieldValue.delete()
          const modelVersion = lineupModelVersion()
          if (modelVersion != null) autoFields.crosswalkAutoModel = modelVersion
          if (robotMayFillCrosswalk(cur, cur.crosswalkAutoPending.ts)) {
            autoFields.crosswalkFullAt = cur.crosswalkAutoPending.ts
            autoFields.crosswalkSource = 'robot'
            robotReported = true
          }
        } else {
          autoFields.crosswalkAutoPending = {
            ts: timestamp,
            prob: Math.round(verdict.probability * 1000) / 1000,
          }
        }
      } else if (cur.crosswalkAutoPending) {
        autoFields.crosswalkAutoPending = FieldValue.delete()
      }
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
    // Confirmed auto-detection → surface it to the client aggregate so the
    // departures page can show the "Robot says…" agree-tag, plus the robot
    // report (cw/cws) when it filled the gap.
    ...(autoFields.crosswalkFullAtAuto
      ? { cwa: autoFields.crosswalkFullAtAuto, cwp: autoFields.crosswalkAutoProb }
      : {}),
    ...(robotReported ? { cw: autoFields.crosswalkFullAt, cws: 'robot' } : {}),
  })

  logAttribution('Lineup timelapse', decision, now)
  logger.log(`Saved lineup timelapse frame: ${blobPath} (${best.length}B)`)
  return { robotReported }
}

export async function captureDepartureTimelapse(db, data) {
  const now = nowInVancouver()
  const decision = departureTimelapseDecision(data, now)
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

  // Terminal-cars detection (no-op until a trained model is committed — see
  // lib/terminal-classifier.js). Streaming form of terminalEmptyFrameTs()
  // (lineup-labels.js): an empty frame only counts once the NEXT frame is
  // also empty — a lone empty is noise, so it parks as terminalEmptyPending
  // and a cars-present frame clears it. A confirmed pair stamps
  // ferryNotFullAuto, which is one-way: later car-filled frames (late
  // arrivals) never clear it. The auto fields are permanent — human reports
  // never remove them (they overwrite only lastCapacity/capacitySource).
  const snapshotKey = `${data.dateIso}_${decision.sailingTime}_To HSB`
  const terminalFields = {}
  let firstConfirm = false
  const verdict = await classifyTerminal(best)
  if (verdict) {
    const snap = await db.collection('sailingStatus').doc(snapshotKey).get()
    const cur = snap.exists ? snap.data() : {}
    // NO crosswalk veto here (tried 2026-08-10, removed 2026-08-16): a lineup
    // reaching the crosswalk does NOT contradict an empty terminal. A long
    // line that all gets aboard is exactly "everyone waiting got on" — the
    // two observations are independent, and suppressing the empty pair threw
    // away the informative busy-but-everyone-fit sailings. The crosswalk
    // signal is a veto for FULL, not for not-full: no crossing means the
    // ferry was definitely not full (notFullByCrosswalk), and since the only
    // "full" claim anywhere comes from the crosswalk classifier itself, that
    // veto is inherent rather than something to enforce here.
    //
    // NOTE on dark frames (lib/daylight.js): below civil twilight the model
    // misreads headlights (~2× the daytime error) — the one known-wrong
    // verdict on record is a night sailing. Dark frames still count (an
    // exclusion was tried 2026-08-11 and rolled back: it also silenced ~50
    // CORRECT night verdicts); the report page marks them so night verdicts
    // are easy to eyeball, and a dedicated night model is the winter plan.
    if (verdict.carsPresent === true) {
      // Cars-first guard (mirrors terminalEmptyFrameTs): an empty pair only
      // counts after loading was actually observed…
      if (!cur.terminalCarsSeen) terminalFields.terminalCarsSeen = true
      if (cur.terminalEmptyPending) terminalFields.terminalEmptyPending = FieldValue.delete()
    } else if (verdict.carsPresent === null) {
      // Between the two thresholds: the model isn't sure either way, so this
      // frame confirms nothing and counts as nothing — it only breaks a
      // pending pair, exactly like a cars frame would.
      if (cur.terminalEmptyPending) terminalFields.terminalEmptyPending = FieldValue.delete()
    } else {
      // …EXCEPT a long all-empty window (MIN_ALL_EMPTY_FRAMES observed empty
      // frames, cars never seen) — a genuinely quiet sailing.
      const emptySeen = (cur.terminalEmptySeen || 0) + 1
      terminalFields.terminalEmptySeen = emptySeen
      const confirmable = cur.terminalCarsSeen || emptySeen >= MIN_ALL_EMPTY_FRAMES
      if (cur.terminalEmptyPending && confirmable) {
        terminalFields.terminalEmptyFrameTs = timestamp
        terminalFields.ferryNotFullAuto = true
        terminalFields.terminalEmptyProb = Math.round((1 - verdict.probability) * 1000) / 1000
        const modelVersion = terminalModelVersion()
        if (modelVersion != null) terminalFields.terminalAutoModel = modelVersion
        firstConfirm = !cur.ferryNotFullAuto
      } else if (!cur.terminalEmptyPending) {
        terminalFields.terminalEmptyPending = { ts: timestamp }
      }
    }
  }

  await db.collection('sailingStatus').doc(snapshotKey).set(
    {
      sailingKey: snapshotKey,
      sailingTime: decision.sailingTime,
      direction: 'To HSB',
      dateIso: data.dateIso,
      departureTimelapsePaths: FieldValue.arrayUnion(blobPath),
      ...terminalFields,
    },
    { merge: true },
  )

  // First confirmed "left not full" → record it as a robot capacity report.
  // updateSailingStatus re-reads the doc and enforces automated > user >
  // robot, so a rider tag that landed during this capture is never clobbered.
  let robotReported = false
  if (firstConfirm) {
    const { capacityApplied } = await updateSailingStatus(
      snapshotKey,
      decision.sailingTime,
      'To HSB',
      data.dateIso,
      db,
      { lastCapacity: 'Not Full', capacitySource: 'robot' },
    )
    robotReported = capacityApplied
  }

  await upsertBowenSailing(db, {
    dateIso: data.dateIso,
    sailingTime: decision.sailingTime,
    addDepartureTs: timestamp,
    ...(terminalFields.ferryNotFullAuto ? { nf: true } : {}),
    ...(robotReported ? { cap: 'Not Full', src: 'robot' } : {}),
  })

  logAttribution('Departure timelapse', decision, now)
  logger.log(`Saved departure timelapse frame: ${blobPath} (${best.length}B)`)
  return { robotReported }
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
