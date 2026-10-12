import { dayjs } from './time.js'

// Pure date logic for BC Ferries' seasonal schedule — which listed sailings
// run on a given date. No cheerio / firebase deps, so both the server
// (seasonal-schedule.js) and the client (the Today dialog's day picker) use
// it on the same stored weekly timetable: {range, sailings: {[location]:
// {[weekday]: [{time, notes}]}}}, as parseSeasonalSchedule produces.

export const WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']

// "No passengers permitted - DG Sailing only. Dangerous goods only"
const DANGEROUS_GOODS_RE = /dangerous goods|DG sailing/i

// "Mar 29" carries no year: take the one that puts it nearest the date being
// checked, so a Jan 1 exception read in December lands in the coming January.
function resolveMonthDay(str, nearIso) {
  const near = dayjs(nearIso)
  let best = null
  for (const year of [near.year() - 1, near.year(), near.year() + 1]) {
    const d = dayjs(`${str.trim()} ${year}`, ['MMM D YYYY', 'MMMM D YYYY'], true)
    if (!d.isValid()) continue
    if (!best || Math.abs(d.diff(near, 'day')) < Math.abs(best.diff(near, 'day'))) best = d
  }
  return best?.format('YYYY-MM-DD') ?? null
}

/**
 * Read a red note as a date rule: "Except Aug 3, Sep 7, Oct 12", "Except on
 * Dec 25 & Jan 1", "Only on Dec 24". Dates resolve to the year nearest `nearIso`.
 * @returns {{kind: 'except'|'only', dates: string[]}|null} null for notes that
 *   aren't date rules (e.g. "No passengers permitted - DG Sailing only").
 */
export function parseDateRule(note, nearIso) {
  const m = note?.match(/^\s*(Except|Only)\s+(?:on\s+)?(.+)$/i)
  if (!m) return null
  const parts = m[2].split(/,|&|\band\b/i).map((s) => s.trim()).filter(Boolean)
  const dates = parts.map((p) => resolveMonthDay(p, nearIso))
  // Every piece must be a date — anything else isn't a rule we understand.
  if (!dates.length || dates.some((d) => !d)) return null
  return { kind: m[1].toLowerCase(), dates }
}

function runsOn(notes, dateIso) {
  for (const note of notes) {
    const rule = parseDateRule(note, dateIso)
    if (!rule) continue
    const listed = rule.dates.includes(dateIso)
    if ((rule.kind === 'except' && listed) || (rule.kind === 'only' && !listed)) return { runs: false, note }
  }
  return { runs: true }
}

/**
 * The schedule for one date: the sailings that run, in the poll's entry shape,
 * plus the listed sailings a date rule skips that day.
 * @returns {{bowenSchedule: Array<{time, dangerousCargo}>, hsbSchedule: Array<{time, dangerousCargo}>,
 *   cancelled: Array<{location, time, note}>}|null} null outside the page's seasonal range.
 */
export function scheduleOn(parsed, dateIso) {
  if (!parsed) return null
  const { range } = parsed
  if (range?.start && dateIso < range.start) return null
  if (range?.end && dateIso > range.end) return null
  const weekday = WEEKDAYS[dayjs(dateIso).day()]
  const out = { bowenSchedule: [], hsbSchedule: [], cancelled: [] }
  for (const [location, byDay] of Object.entries(parsed.sailings)) {
    const key = location === 'Bowen' ? 'bowenSchedule' : 'hsbSchedule'
    for (const { time, notes } of byDay[weekday] || []) {
      const { runs, note } = runsOn(notes, dateIso)
      if (!runs) {
        out.cancelled.push({ location, time, note })
        continue
      }
      out[key].push({ time, dangerousCargo: notes.some((n) => DANGEROUS_GOODS_RE.test(n)) })
    }
  }
  return out
}
