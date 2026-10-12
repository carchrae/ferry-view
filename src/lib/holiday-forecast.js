// Forecasts for holidays and long weekends: which past days a sailing's
// "usually late / often full" hint is built from when the day isn't ordinary.
// The evidence and open questions are in docs/holiday-forecasts.md.
//
// Holidays and long-weekend Saturdays/Sundays don't look like the same weekday
// (dayType in functions/lib/holidays.js), and holidays differ by kind
// (holidayKind: family-travel long weekends, a day off without the travel,
// Christmas season), so fullness and crosswalk come from past days of the
// same kind. Per sailing, the first source with data wins:
//
//   holiday        1. the same holiday in earlier years (up to three)
//                  2. same-kind holidays on the same weekday, last six months
//                  3. same-kind holidays on any weekday, last six months
//                     (Christmas season, with no history of its own yet,
//                     borrows the family-travel holidays)
//                  4. ordinary Sundays (family travel / Christmas) or the
//                     ordinary same weekday (a day off)
//   long weekend   1. the same holiday's weekend day in earlier years
//                  2. same-kind long-weekend days of the same weekday, six months
//                  3. the ordinary same weekday
//
// (The earlier days of the same long weekend were tried and backtested
// worse for the holiday Monday — it's the travel-home day — and mixed for
// the Sunday; see the doc.)
//
// Lateness is the exception: it tracks how busy the boat is (and compounds
// through the day), not the date — summer long weekends ran 13-18 min late,
// the fall ones on time — so it always comes from the ordinary same weekday.
//
// Pure (no Firestore/Vue): HomePage feeds it the aggregates/holidayStats
// records and the ordinary byDayOfWeek stats.
import { dayjs, normalizeTime } from '../../functions/lib/time.js'
import { dayType, holidayKind } from '../../functions/lib/holidays.js'
import { aggregateByTime, getTypical, DAY_KEYS } from './historical-stats.js'

const RECENT_MONTHS = 6
const SAME_HOLIDAY_YEARS = 3

const weekdayOf = (iso) => dayjs(iso).day()
const yearsOf = (dates) => [...new Set(dates.map((d) => d.slice(0, 4)))].sort().reverse().join(', ')

// Distinct holiday names, most recent first: "Labour Day, BC Day".
function namesOf(dates, typeByDate) {
  const seen = []
  for (const d of [...dates].sort().reverse()) {
    const n = typeByDate.get(d)?.name
    if (n && !seen.includes(n)) seen.push(n)
  }
  return seen.join(', ')
}

/**
 * The forecast sources for one date, built once and looked up per sailing.
 * @param {string} dateIso the day being forecast.
 * @param {Array} records holidayStats sailings expanded to sailingStatus shape
 *   (dateIso, sailingTime, direction, actualDepartureTime, lastCapacity, …).
 * @returns {{type, name, kind, tiers: Array<{basis, dates, byTime}>, fallbackDay, latenessDay}|null}
 *   null for an ordinary day.
 */
export function holidayForecast(dateIso, records) {
  const t = dayType(dateIso)
  if (t.type === 'ordinary') return null
  const kind = holidayKind(t.name, dateIso)
  const typeByDate = new Map()
  for (const r of records || []) {
    if (typeByDate.has(r.dateIso)) continue
    const dt = dayType(r.dateIso)
    typeByDate.set(r.dateIso, { ...dt, kind: holidayKind(dt.name, r.dateIso) })
  }
  const past = [...typeByDate.keys()].filter((d) => d < dateIso)
  const recentFrom = dayjs(dateIso).subtract(RECENT_MONTHS, 'month').format('YYYY-MM-DD')
  const yearsFrom = dayjs(dateIso).subtract(SAME_HOLIDAY_YEARS, 'year').format('YYYY-MM-DD')
  const year = dayjs(dateIso).year()
  const wd = weekdayOf(dateIso)
  const dayName = DAY_KEYS[wd]

  const pick = (pred) => past.filter((d) => pred(d, typeByDate.get(d)))
  const tier = (dates, basis) => {
    if (!dates.length) return null
    const set = new Set(dates)
    return { basis, dates, byTime: aggregateByTime(records.filter((r) => set.has(r.dateIso))) }
  }
  const earlierYear = (d, dt) => dt.name === t.name && d >= yearsFrom && dayjs(d).year() < year

  let candidates
  if (t.type === 'holiday') {
    const prior = pick((d, dt) => dt.type === 'holiday' && earlierYear(d, dt))
    // Christmas season has no pattern of its own until it has history.
    const kinds = kind === 'christmas' ? ['christmas', 'family'] : [kind]
    const sameKind = (dt) => dt.type === 'holiday' && kinds.includes(dt.kind)
    const sameWd = pick((d, dt) => sameKind(dt) && d >= recentFrom && weekdayOf(d) === wd)
    const any = pick((d, dt) => sameKind(dt) && d >= recentFrom)
    candidates = [
      tier(prior, `${t.name} ${yearsOf(prior)}`),
      tier(sameWd, namesOf(sameWd, typeByDate)),
      tier(any, namesOf(any, typeByDate)),
    ]
  } else {
    const prior = pick((d, dt) => dt.type === 'long-weekend' && earlierYear(d, dt) && weekdayOf(d) === wd)
    const sameWd = pick(
      (d, dt) => dt.type === 'long-weekend' && dt.kind === kind && d >= recentFrom && weekdayOf(d) === wd,
    )
    candidates = [
      tier(prior, `${t.name} weekend ${yearsOf(prior)}`),
      tier(sameWd, `long-weekend ${dayName}s: ${namesOf(sameWd, typeByDate)}`),
    ]
  }
  return {
    type: t.type,
    name: t.name,
    kind,
    tiers: candidates.filter(Boolean),
    // Last resort for fullness, from the ordinary baselines.
    fallbackDay: t.type === 'holiday' && kind !== 'day-off' ? 'Sunday' : dayName,
    // Lateness always comes from the ordinary same weekday (see top).
    latenessDay: dayName,
  }
}

/**
 * Typical stats for one sailing on a holiday / long-weekend day: fullness and
 * crosswalk from the first tier with data for it, lateness from the ordinary
 * same weekday. Tagged with `basis` (where the fullness came from) and
 * `latenessBasis`.
 */
export function holidayTypical(forecast, byDayOfWeek, panel, time) {
  if (!forecast) return null
  time = normalizeTime(time)
  const ordinary = getTypical(byDayOfWeek, panel, forecast.latenessDay, time)
  const withOrdinaryLateness = (info) => ({
    ...info,
    avgLateness: ordinary?.avgLateness ?? null,
    latePct: ordinary?.latePct ?? null,
    latenessCount: ordinary?.latenessCount ?? 0,
    latenessBasis: `ordinary ${forecast.latenessDay}s`,
  })
  for (const t of forecast.tiers) {
    const info = t.byTime[panel]?.[time]
    if (info && info.count) return { ...withOrdinaryLateness(info), basis: t.basis, minSamples: 1 }
  }
  const info = getTypical(byDayOfWeek, panel, forecast.fallbackDay, time)
  return info ? { ...withOrdinaryLateness(info), basis: `ordinary ${forecast.fallbackDay}s` } : null
}
