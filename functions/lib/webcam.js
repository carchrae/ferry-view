import { createHash } from 'node:crypto'
import { getStorage } from 'firebase-admin/storage'

const WEBCAM_URL = 'https://ccimg.bcferries.com/cc/support/terminals/cam1_bow.jpg'
const SAMPLE_COUNT = 3
const SAMPLE_DELAY_MS = 1000

export async function captureBowenWebcam(db, sailingKey, sailingTime, date) {
  const statusRef = db.collection('sailingStatus').doc(sailingKey)
  const snap = await statusRef.get()
  if (!snap.exists) return
  if (snap.data().webcamSnapshotPath) return

  const samples = []
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, SAMPLE_DELAY_MS))
    try {
      const res = await fetch(WEBCAM_URL)
      const buf = Buffer.from(await res.arrayBuffer())
      samples.push(buf)
    } catch (e) {
      console.warn(`Webcam sample ${i} failed:`, e.message)
    }
  }

  if (samples.length === 0) {
    console.error('All webcam samples failed for', sailingKey)
    return
  }

  // group by content hash — pick a frame seen 2+ times (stable, not mid-refresh)
  const byHash = {}
  for (const buf of samples) {
    const h = createHash('md5').update(buf).digest('hex')
    if (!byHash[h]) byHash[h] = []
    byHash[h].push(buf)
  }
  const dupes = Object.values(byHash).find(g => g.length >= SAMPLE_COUNT - 1)
  const best = dupes ? dupes[0] : samples.sort((a, b) => b.length - a.length)[0]

  const blobPath = `webcams/bowen/${date}/${sailingKey}.jpg`
  const bucket = getStorage().bucket()
  const file = bucket.file(blobPath)
  await file.save(best, { contentType: 'image/jpeg' })
  await file.makePublic()

  // const imageUrl = `/webcam/${blobPath}`
  const imageUrl = `https://storage.googleapis.com/${bucket.name}/${blobPath}`
  await db.collection('snapshots').doc('latestBowenDeparture').set({
    imageUrl,
    sailingKey,
    sailingTime,
    date,
    recordedAt: new Date().toISOString(),
  })

  await statusRef.set({ webcamSnapshotPath: blobPath }, { merge: true })
  console.log(`Saved webcam snapshot: ${blobPath} (${best.length}B, ${samples.length} samples)`)
}
