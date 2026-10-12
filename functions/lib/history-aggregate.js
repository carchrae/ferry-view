import { logger } from 'firebase-functions/logger'
import { dayjs, nowInVancouver } from './time.js'
import { dayType, getHolidayDates } from './holidays.js'

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
//   cap = lastCapacity, src = capacitySource, fa = filledAt,
//   cw = crosswalkFullAt (Bowen-side "full to crosswalk" time, epoch ms),
//   cws = crosswalkSource, only when 'robot' (absent = human mark)
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
    const rec = toRecord(doc.data())
    if (rec) sailings.push(rec)
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

// One sailingStatus doc as a compact aggregate record (keys above), or null.
function toRecord(s) {
  if (!s.dateIso || !s.sailingTime || !s.direction) return null
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
  if (s.crosswalkFullAt != null) {
    rec.cw =
      typeof s.crosswalkFullAt?.toMillis === 'function'
        ? s.crosswalkFullAt.toMillis()
        : s.crosswalkFullAt
  }
  if (s.crosswalkSource === 'robot') rec.cws = 'robot'
  return rec
}

// How far back holiday forecasts look: "the same holiday last year" needs a
// year, and up to three years of it are used.
export const HOLIDAY_HISTORY_YEARS = 3

// aggregates/holidayStats: every sailing on a holiday or long-weekend
// Saturday/Sunday (dayType) over the last three years, same record format as
// historicalStats plus the list of dates and their type/holiday name. Those
// days are left out of the ordinary weekday baselines and forecast from each
// other instead (src/lib/holiday-forecast.js). Clients read it only when the
// day being shown is a holiday or long-weekend day.
//
// Holiday data only changes the day after one, so the nightly run rebuilds
// only then (or when the doc is missing) — one range query per holiday
// weekend, ~30 a year, not a nightly three-year scan.
export async function recomputeHolidayStats(db, { force = false } = {}) {
  const now = nowInVancouver()
  const end = now.subtract(1, 'day').format('YYYY-MM-DD')
  const ref = db.collection('aggregates').doc('holidayStats')
  if (!force && dayType(end).type === 'ordinary') {
    const existing = await ref.get()
    if (existing.exists) return { skipped: true }
  }
  const start = now.subtract(HOLIDAY_HISTORY_YEARS, 'year').format('YYYY-MM-DD')
  const dates = getHolidayDates(start, end)

  // Consecutive dates (a long weekend) become one range query.
  const runs = []
  for (const { dateIso } of dates) {
    const last = runs[runs.length - 1]
    if (last && dayjs(last.end).add(1, 'day').format('YYYY-MM-DD') === dateIso) last.end = dateIso
    else runs.push({ start: dateIso, end: dateIso })
  }
  const sailings = []
  for (const run of runs) {
    const snap = await db
      .collection('sailingStatus')
      .where('dateIso', '>=', run.start)
      .where('dateIso', '<=', run.end)
      .get()
    snap.forEach((doc) => {
      const rec = toRecord(doc.data())
      if (rec) sailings.push(rec)
    })
  }

  await ref.set({
    start,
    end,
    dates: dates.map(({ dateIso, type, name }) => ({ d: dateIso, type, name })),
    updatedAt: Date.now(),
    sailings,
  })
  logger.log(`holidayStats aggregate rebuilt: ${sailings.length} sailings on ${dates.length} holiday/long-weekend dates ${start}..${end}`)
  return { start, end, dates: dates.length, count: sailings.length }
}
