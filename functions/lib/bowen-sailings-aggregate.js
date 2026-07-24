import { logger } from 'firebase-functions/logger'
import { nowInVancouver } from './time.js'

// How many days of Bowen departures the aggregate carries — matches the
// six-week window the departures page shows (and must stay <= the webcam
// cleanup cutoff in webcam.js, or photos vanish before the aggregate does).
export const BOWEN_SAILINGS_DAYS = 42

// aggregates/bowenSailings: a compact copy of the last 42 days of To HSB
// sailingStatus docs that have at least one photo or timelapse frame — the
// exact set the client's fetchRawSailings used to range-scan (~200 doc reads
// per HomePage mount; now one doc read). Short keys mirror historicalStats
// (see history-aggregate.js); the client expands them back:
//   d = dateIso, t = sailingTime, cap = lastCapacity, src = capacitySource,
//   wp = webcamSnapshotPath, cp = communitySnapshotPath,
//   ca = communityArrivalTime, cw = crosswalkFullAt (epoch ms),
//   cwa / cwp = crosswalkFullAtAuto (epoch ms) / crosswalkAutoProb — the
//   classifier's prediction, feeding the "Robot says…" agree-tag,
//   dep = actualDepartureTime (drives the "on time"/"late" title on the
//   departures page), lt / dt = lineup / departure timelapse frame epochs.
// Timelapse Storage paths are deterministic —
// webcams/{community|bowen}/{d}/timelapse/{t}_To HSB_{epoch}.jpg — so only
// the epoch suffix is stored (13 chars vs ~65 per frame, keeping the doc far
// under the 1 MB limit) and the client reconstructs the full path; the
// sailingKey reconstructs as `${d}_${t}_To HSB`.

function frameEpoch(path) {
  const m = /_(\d{10,})\.jpg$/.exec(path || '')
  return m ? Number(m[1]) : null
}

function flattenMs(v) {
  return typeof v?.toMillis === 'function' ? v.toMillis() : v
}

// Map one sailingStatus doc to its aggregate record, or null when it has no
// media (media-less sailings never earn a card — same filter the client
// applied to its range scan).
export function sailingToRecord(s) {
  if (!s?.dateIso || !s?.sailingTime) return null
  const lt = (s.lineupTimelapsePaths || []).map(frameEpoch).filter((n) => n != null)
  const dt = (s.departureTimelapsePaths || []).map(frameEpoch).filter((n) => n != null)
  if (!s.webcamSnapshotPath && !s.communitySnapshotPath && !lt.length && !dt.length) return null
  const rec = { d: s.dateIso, t: s.sailingTime }
  if (s.lastCapacity != null) rec.cap = s.lastCapacity
  if (s.capacitySource != null) rec.src = s.capacitySource
  if (s.webcamSnapshotPath != null) rec.wp = s.webcamSnapshotPath
  if (s.communitySnapshotPath != null) rec.cp = s.communitySnapshotPath
  if (s.communityArrivalTime != null) rec.ca = s.communityArrivalTime
  if (s.actualDepartureTime != null) rec.dep = s.actualDepartureTime
  if (s.crosswalkFullAt != null) rec.cw = flattenMs(s.crosswalkFullAt)
  if (s.crosswalkFullAtAuto != null) rec.cwa = flattenMs(s.crosswalkFullAtAuto)
  if (s.crosswalkAutoProb != null) rec.cwp = s.crosswalkAutoProb
  if (lt.length) rec.lt = lt.sort((a, b) => a - b)
  if (dt.length) rec.dt = dt.sort((a, b) => a - b)
  return rec
}

// Full rebuild (nightly + manual seed): range-scan once on the server so no
// client ever has to. Also the reconciliation path — prunes aged-out days and
// picks up fields the incremental path doesn't carry (automated capacity).
export async function recomputeBowenSailings(db) {
  const now = nowInVancouver()
  const start = now.subtract(BOWEN_SAILINGS_DAYS, 'day').format('YYYY-MM-DD')
  const end = now.format('YYYY-MM-DD')

  const snap = await db
    .collection('sailingStatus')
    .where('direction', '==', 'To HSB')
    .where('dateIso', '>=', start)
    .where('dateIso', '<=', end)
    .get()

  const sailings = []
  snap.forEach((doc) => {
    const rec = sailingToRecord(doc.data())
    if (rec) sailings.push(rec)
  })

  await db.collection('aggregates').doc('bowenSailings').set({
    start,
    end,
    updatedAt: Date.now(),
    sailings,
  })

  logger.log(`bowenSailings aggregate rebuilt: ${sailings.length} sailings ${start}..${end}`)
  return { start, end, count: sailings.length }
}

// Incremental update, called right after a capture/report already wrote the
// underlying sailingStatus doc (so today's timelapse stays live between
// nightly rebuilds). Scalar deltas use the short keys above; frame epochs go
// through addLineupTs / addDepartureTs (deduped, kept sorted). Transactional
// read-modify-write of the one aggregate doc; never throws — the aggregate
// is a cache, and a failed update must not break the capture that triggered
// it (the nightly rebuild reconciles any misses). No-op until the doc is
// seeded; a dateIso older than the window is dropped, a newer one (first
// capture after midnight, before the 03:20 rebuild) extends `end`.
export async function upsertBowenSailing(
  db,
  { dateIso, sailingTime, addLineupTs, addDepartureTs, clearKeys, ...scalars },
) {
  if (!dateIso || !sailingTime) return
  try {
    const ref = db.collection('aggregates').doc('bowenSailings')
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists) return
      const agg = snap.data()
      if (dateIso < agg.start) return
      const sailings = agg.sailings || []
      let rec = sailings.find((r) => r.d === dateIso && r.t === sailingTime)
      if (!rec) {
        rec = { d: dateIso, t: sailingTime }
        sailings.push(rec)
      }
      for (const [k, v] of Object.entries(scalars)) {
        if (v != null) rec[k] = flattenMs(v)
      }
      // Null scalars are skipped above, so deleting a value (e.g. the last
      // user report's capacity) needs an explicit key list.
      for (const k of clearKeys || []) delete rec[k]
      if (addLineupTs != null && !(rec.lt || []).includes(addLineupTs)) {
        rec.lt = [...(rec.lt || []), addLineupTs].sort((a, b) => a - b)
      }
      if (addDepartureTs != null && !(rec.dt || []).includes(addDepartureTs)) {
        rec.dt = [...(rec.dt || []), addDepartureTs].sort((a, b) => a - b)
      }
      tx.set(ref, {
        ...agg,
        end: dateIso > agg.end ? dateIso : agg.end,
        updatedAt: Date.now(),
        sailings,
      })
    })
  } catch (e) {
    logger.error('bowenSailings aggregate upsert failed:', e)
  }
}
