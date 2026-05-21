import { logger } from 'firebase-functions/logger'
import { createHash } from 'node:crypto'
import { getStorage } from 'firebase-admin/storage'
import { isRecent, nowInVancouver, dayjs } from './time.js'

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
  await file.save(best, { contentType: 'image/jpeg' })
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

export async function captureBowenCommunityWebcam(db, arrivalTime, dateIso) {
  if (!isRecent(arrivalTime, 10 * 60 * 1000)) return
  const arrivalRef = db.collection('snapshots').doc('latestBowenArrival')
  const snap = await arrivalRef.get()
  if (snap.exists && snap.data().arrivalTime === arrivalTime) return

  const samples = await captureSamples(COMMUNITY_WEBCAM_URL)
  if (samples.length === 0) {
    logger.error('All community webcam samples failed')
    return
  }

  const best = pickBestFrame(samples)
  const timestamp = Date.now()
  const blobPath = `webcams/community/${dateIso}/${arrivalTime}_Arrival_${timestamp}.jpg`
  const bucket = getStorage().bucket()
  const file = bucket.file(blobPath)
  await file.save(best, { contentType: 'image/jpeg' })
  await file.makePublic()

  const imageUrl = `https://storage.googleapis.com/${bucket.name}/${blobPath}`
  const snapshotKey = `${dateIso}_${arrivalTime}_Arrival`
  await arrivalRef.set({
    imageUrl,
    arrivalTime,
    sailingKey: snapshotKey,
    dateIso,
    recordedAt: Date.now(),
  })

  logger.log(`Saved community webcam snapshot: ${blobPath} (${best.length}B, ${samples.length} samples)`)
}

export async function cleanupOldWebcams() {
  const bucket = getStorage().bucket()
  const cutoff = nowInVancouver().subtract(1, 'day')
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
