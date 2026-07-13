import { logger } from 'firebase-functions/logger'
import { createHash } from 'node:crypto'
import { getStorage } from 'firebase-admin/storage'
import sharp from 'sharp'
import { isRecent, nowInVancouver, dayjs } from './time.js'

// Photo filenames are timestamped and never rewritten, so browsers can cache
// them forever — without this, GCS's default 1-hour max-age makes every
// return visit re-download ~hundreds of KB per photo.
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'

const WEBCAM_URL = 'https://ccimg.bcferries.com/cc/support/terminals/cam1_bow.jpg'
const COMMUNITY_WEBCAM_URL = 'https://ferrycamera.bowencommunitycentre.com/snapshot.jpg'
const SAMPLE_COUNT = 3
const SAMPLE_DELAY_MS = 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000

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

export async function cleanupOldWebcams() {
  const bucket = getStorage().bucket()
  const cutoff = nowInVancouver().subtract(14, 'day')
  let deleted = 0
  let failed = 0

  const [files] = await bucket.getFiles({ prefix: 'webcams/' })
  for (const file of files) {
    const [meta] = await file.getMetadata()
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
