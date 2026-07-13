import { logger } from 'firebase-functions/logger'
import { nowInVancouver } from './time.js'

// How much history the aggregate carries. The HomePage "typical days" view
// reads 8 weeks; HistoryPage defaults to 4. Anything beyond this window falls
// back to a direct sailingStatus range query on the client.
export const HISTORY_WEEKS = 8

// Rebuild aggregates/historicalStats: a compact copy of the last 8 weeks of
// sailingStatus (ending yesterday, so a nightly rebuild is always fresh) in a
// single doc. Clients previously ran this exact range query themselves —
// ~1,700 doc reads per HomePage mount; now they read one doc.
//
// Records use short keys to stay well under the 1 MB doc limit; the client
// expands them back to sailingStatus field names (see useHistoricalStats.js):
//   d = dateIso, t = sailingTime, dir = direction, dep = actualDepartureTime,
//   cap = lastCapacity, src = capacitySource, fa = filledAt
export async function recomputeHistoricalStats(db) {
  const now = nowInVancouver()
  const start = now.subtract(HISTORY_WEEKS, 'week').format('YYYY-MM-DD')
  const end = now.subtract(1, 'day').format('YYYY-MM-DD')

  const snap = await db
    .collection('sailingStatus')
    .where('dateIso', '>=', start)
    .where('dateIso', '<=', end)
    .get()

  const sailings = []
  snap.forEach((doc) => {
    const s = doc.data()
    if (!s.dateIso || !s.sailingTime || !s.direction) return
    const rec = { d: s.dateIso, t: s.sailingTime, dir: s.direction }
    if (s.actualDepartureTime != null) rec.dep = s.actualDepartureTime
    if (s.lastCapacity != null) rec.cap = s.lastCapacity
    if (s.capacitySource != null) rec.src = s.capacitySource
    if (s.filledAt != null) {
      // Admin-SDK Timestamps don't survive the trip through an array cleanly
      // for the client's filledAt parser — flatten to epoch ms. Numbers and
      // 'user_reported' pass through unchanged.
      rec.fa = typeof s.filledAt?.toMillis === 'function' ? s.filledAt.toMillis() : s.filledAt
    }
    sailings.push(rec)
  })

  await db.collection('aggregates').doc('historicalStats').set({
    start,
    end,
    weeks: HISTORY_WEEKS,
    updatedAt: Date.now(),
    sailings,
  })

  logger.log(`historicalStats aggregate rebuilt: ${sailings.length} sailings ${start}..${end}`)
  return { start, end, count: sailings.length }
}
