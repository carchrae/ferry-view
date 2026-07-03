import { dayjs, TZ } from './time.js'

// BC statutory holidays and the "long weekend" days around them. Ferry traffic
// on these days is atypical (usually much busier), so they should be excluded
// from historical "typical" baselines and flagged separately on the home page.
//
// Everything here is calendar-date math in the Vancouver timezone; dates are
// returned as ISO "YYYY-MM-DD" strings.

function isoDate(y, m, d) {
  return dayjs.tz(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, TZ)
    .format('YYYY-MM-DD')
}

// n-th occurrence of a weekday (0=Sun..6=Sat) within a month.
function nthWeekday(year, month, weekday, n) {
  let d = dayjs.tz(`${year}-${String(month).padStart(2, '0')}-01`, TZ)
  let count = 0
  while (d.month() + 1 === month) {
    if (d.day() === weekday) {
      count++
      if (count === n) return d.format('YYYY-MM-DD')
    }
    d = d.add(1, 'day')
  }
  return null
}

// Easter Sunday via the Anonymous Gregorian algorithm (Meeus/Jones/Butcher).
function easterSunday(year) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const mm = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * mm + 114) / 31)
  const day = ((h + l - 7 * mm + 114) % 31) + 1
  return dayjs.tz(isoDate(year, month, day), TZ)
}

// Victoria Day: the Monday preceding May 25.
function victoriaDay(year) {
  let d = dayjs.tz(`${year}-05-24`, TZ)
  while (d.day() !== 1) d = d.subtract(1, 'day')
  return d.format('YYYY-MM-DD')
}

// Returns a Map of ISO date -> holiday name for the given year.
export function getBcHolidays(year) {
  const easter = easterSunday(year)
  const goodFriday = easter.subtract(2, 'day').format('YYYY-MM-DD')
  const easterMonday = easter.add(1, 'day').format('YYYY-MM-DD')
  const map = new Map()
  const add = (iso, name) => { if (iso) map.set(iso, name) }

  add(isoDate(year, 1, 1), "New Year's Day")
  add(nthWeekday(year, 2, 1, 3), 'Family Day') // 3rd Monday of February
  add(goodFriday, 'Good Friday')
  add(easterMonday, 'Easter Monday')
  add(victoriaDay(year), 'Victoria Day')
  add(isoDate(year, 7, 1), 'Canada Day')
  add(nthWeekday(year, 8, 1, 1), 'BC Day') // 1st Monday of August
  add(nthWeekday(year, 9, 1, 1), 'Labour Day') // 1st Monday of September
  add(nthWeekday(year, 10, 1, 2), 'Thanksgiving') // 2nd Monday of October
  add(isoDate(year, 11, 11), 'Remembrance Day')
  add(isoDate(year, 12, 25), 'Christmas Day')
  add(isoDate(year, 12, 26), 'Boxing Day')
  return map
}

// Holiday name for a date, or null. Cheap enough to call per-render.
export function holidayName(dateIso) {
  if (!dateIso) return null
  const year = Number(dateIso.slice(0, 4))
  if (!year) return null
  return getBcHolidays(year).get(dateIso) || null
}

// Dates whose ferry traffic is skewed by a nearby holiday: the holiday itself
// plus a window of days before/after (long-weekend spillover). Returns a Set of
// ISO dates that fall within [startIso, endIso].
export function getImpactedDates(startIso, endIso, daysBefore = 1, daysAfter = 1) {
  const set = new Set()
  if (!startIso || !endIso) return set
  const startYear = Number(startIso.slice(0, 4))
  const endYear = Number(endIso.slice(0, 4))
  for (let y = startYear; y <= endYear; y++) {
    for (const iso of getBcHolidays(y).keys()) {
      const h = dayjs.tz(iso, TZ)
      for (let offset = -daysBefore; offset <= daysAfter; offset++) {
        const d = h.add(offset, 'day').format('YYYY-MM-DD')
        if (d >= startIso && d <= endIso) set.add(d)
      }
    }
  }
  return set
}

// Whether a date is a holiday or sits in a holiday's spillover window, plus the
// name of the driving holiday. Used for the home-page "expect heavier traffic"
// caveat.
export function getHolidayContext(dateIso, daysBefore = 1, daysAfter = 1) {
  if (!dateIso) return { impacted: false, name: null, onHoliday: false }
  const direct = holidayName(dateIso)
  if (direct) return { impacted: true, name: direct, onHoliday: true }
  const d = dayjs.tz(dateIso, TZ)
  for (let offset = -daysBefore; offset <= daysAfter; offset++) {
    if (offset === 0) continue
    const other = d.add(offset, 'day').format('YYYY-MM-DD')
    const name = holidayName(other)
    if (name) return { impacted: true, name, onHoliday: false }
  }
  return { impacted: false, name: null, onHoliday: false }
}
