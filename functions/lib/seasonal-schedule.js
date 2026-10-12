import { load } from 'cheerio'
import { logger } from 'firebase-functions/logger'
import { dayjs, normalizeTime } from './time.js'

// BC Ferries' seasonal schedule is the source of truth for which sailings run
// on a given date. It lists the sailings per weekday, with date exceptions
// printed under them in red — e.g. the Monday 5:15 am from Bowen carries
// "Except Aug 3, Sep 7, Oct 12, Feb 15, Mar 29" (holiday Mondays) — which
// bowenferry.ca's schedule feed ignores. A daily scrape materialises the next
// LOOKAHEAD_DAYS dates into snapshots/seasonalSchedule; the 1-minute poll
// replaces bowenferry.ca's schedule with the day's entry
// (applySeasonalSchedule). One page carries both directions: "Onward"
// (Horseshoe Bay → Bowen) and "Return" (Bowen → Horseshoe Bay).
export const SEASONAL_SCHEDULE_URL = 'https://www.bcferries.com/routes-fares/schedules/seasonal/HSB-BOW'
export const SEASONAL_SCHEDULE_DOC = 'seasonalSchedule'

// How many days ahead (including today) the stored doc covers, so failed
// scrapes (e.g. the waiting room actually queuing) still leave today covered.
const LOOKAHEAD_DAYS = 14

// Same reason as bcferries-departures.js: non-200 without a browser UA.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// Origin terminal per section heading, in the `location` vocabulary the rest
// of the pipeline uses (bowenSchedule departs 'Bowen', hsbSchedule 'Horseshoe Bay').
const SECTIONS = [
  { id: 'OnwardSchedule', location: 'Horseshoe Bay' },
  { id: 'ReturnSchedule', location: 'Bowen' },
]

const WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']

const RANGE_RE = /([A-Z][a-z]{2} \d{1,2}, \d{4}) - ([A-Z][a-z]{2} \d{1,2}, \d{4})/

// "No passengers permitted - DG Sailing only. Dangerous goods only"
const DANGEROUS_GOODS_RE = /dangerous goods|DG sailing/i

/**
 * Parse the seasonal schedule page. Pure, so it can be tested against a fixture.
 * @returns {{range: {start: string, end: string}|null,
 *   sailings: {[location: string]: {[weekday: string]: Array<{time: string, notes: string[]}>}}}|null}
 *   null when either direction's table is missing (layout change, queue page),
 *   so a broken scrape can't publish an empty schedule.
 */
export function parseSeasonalSchedule(html) {
  const $ = load(html)
  const forms = $('#seasonalSchedulesForm')
  // Headings and forms alternate in document order: heading, its form, ...
  const ordered = $('#OnwardSchedule, #ReturnSchedule, #seasonalSchedulesForm').toArray()
  const sailings = {}
  let range = null
  for (const { id, location } of SECTIONS) {
    const at = ordered.findIndex((el) => el.attribs?.id === id)
    const form = at >= 0 ? ordered.slice(at + 1).find((el) => forms.is(el)) : null
    if (!form) return null
    const table = $(form)
      .find('table.table-seasonal-schedule')
      .filter((i, t) => $(t).find('[data-schedule-day]').length > 0)
      .first()
    if (!table.length) return null
    if (!range) {
      const m = $(form).text().replace(/\s+/g, ' ').match(RANGE_RE)
      if (m) range = { start: parseLongDate(m[1]), end: parseLongDate(m[2]) }
    }
    const byDay = {}
    let day = null
    table.children().each((i, section) => {
      if (section.tagName === 'thead') {
        day = $(section).find('[data-schedule-day]').attr('data-schedule-day') || null
        return
      }
      if (!day) return
      $(section)
        .find('tr.schedule-table-row')
        .each((j, row) => {
          const cell = $(row).find('td').eq(1)
          const raw = cell.text().match(/\d{1,2}:\d{2}\s*[ap]m/i)
          if (!raw) return
          const notes = [
            ...new Set(
              cell
                .find('p')
                .map((k, p) => $(p).text().replace(/\s+/g, ' ').trim())
                .get()
                .filter(Boolean),
            ),
          ]
          ;(byDay[day] ||= []).push({ time: normalizeTime(raw[0]), notes })
        })
    })
    if (WEEKDAYS.some((d) => !byDay[d]?.length)) return null
    sailings[location] = byDay
  }
  return { range, sailings }
}

function parseLongDate(str) {
  const d = dayjs(str, ['MMM D, YYYY', 'MMM DD, YYYY'], true)
  return d.isValid() ? d.format('YYYY-MM-DD') : null
}

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

/**
 * Per-date schedules for `days` dates starting at `startIso`; dates outside
 * the page's seasonal range are left out.
 */
export function scheduleByDate(parsed, startIso, days = LOOKAHEAD_DAYS) {
  const out = {}
  for (let i = 0; i < days; i++) {
    const iso = dayjs(startIso).add(i, 'day').format('YYYY-MM-DD')
    const day = scheduleOn(parsed, iso)
    if (day) out[iso] = day
  }
  return out
}

/**
 * Fetch the seasonal schedule page. The schedules section sits behind a
 * queue-it waiting room; outside peak demand it runs in "safetynet" mode and
 * hands back a token straight away after a JS redirect, which we follow by
 * hand (redirects, the JS hop's decoded URL, and cookies along the way). If
 * a real queue is up there is no token and this throws — the lookahead from
 * an earlier run covers it.
 * @param {typeof fetch} [fetchImpl] injectable for testing.
 */
export async function fetchSeasonalScheduleHtml(fetchImpl = fetch) {
  const cookies = new Map()
  let url = SEASONAL_SCHEDULE_URL
  for (let hop = 0; hop < 8; hop++) {
    const headers = { 'User-Agent': USER_AGENT }
    if (cookies.size) headers.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ')
    const res = await fetchImpl(url, { headers, redirect: 'manual' })
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(';')
      const eq = pair.indexOf('=')
      if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) throw new Error(`Seasonal schedule: HTTP ${res.status} without Location`)
      url = new URL(location, url).toString()
      continue
    }
    if (!res.ok) throw new Error(`Seasonal schedule fetch failed: HTTP ${res.status} (${url})`)
    const html = await res.text()
    if (new URL(url).hostname.endsWith('queue-it.net')) {
      const next = html.match(/decodeURIComponent\('([^']+)'\)/)
      if (!next) throw new Error('Seasonal schedule: queue-it waiting room is queuing (no pass-through)')
      url = new URL(decodeURIComponent(next[1]), url).toString()
      continue
    }
    return html
  }
  throw new Error('Seasonal schedule: too many redirects')
}

// Once a day. No clients listen to the doc (they get the day's schedule via
// ferryStatus/current), so it's written unconditionally.
export async function refreshSeasonalSchedule(db, todayIso, fetchImpl = fetch) {
  const parsed = parseSeasonalSchedule(await fetchSeasonalScheduleHtml(fetchImpl))
  if (!parsed) throw new Error('Seasonal schedule page had no schedule tables — layout changed?')
  const days = scheduleByDate(parsed, todayIso)
  if (!days[todayIso]) throw new Error(`Seasonal schedule range ${JSON.stringify(parsed.range)} doesn't cover ${todayIso}`)
  await db.collection('snapshots').doc(SEASONAL_SCHEDULE_DOC).set({
    days,
    fromDate: todayIso,
    range: parsed.range,
    sourceUrl: SEASONAL_SCHEDULE_URL,
    fetchedAt: Date.now(),
  })
  const skipped = Object.entries(days)
    .filter(([, d]) => d.cancelled.length)
    .map(([iso, d]) => `${iso}: ${d.cancelled.map((c) => `${c.location} ${c.time}`).join(', ')}`)
  logger.log(
    `Seasonal schedule stored for ${Object.keys(days).length} days from ${todayIso}; skipped: ${skipped.join(' | ') || 'none'}`,
  )
  return { days }
}

/**
 * Replace bowenferry.ca's schedule with BC Ferries' for `data.dateIso`, and
 * list today's and tomorrow's skipped sailings on `data.scheduleCancellations`
 * (each tagged with its dateIso) so the client can announce them a day ahead.
 * Keeps bowenferry.ca's per-sailing deck space, and its repositioning runs
 * (non-public boat moves BC Ferries doesn't list). When the stored doc has no
 * entry for today (scrape failing past the lookahead, or before the first
 * run) the bowenferry.ca schedule stays. Mutates `data`.
 * @returns {boolean} whether BC Ferries' schedule was applied.
 */
export function applySeasonalSchedule(data, days) {
  const today = days?.[data.dateIso]
  const tomorrowIso = dayjs(data.dateIso).add(1, 'day').format('YYYY-MM-DD')
  data.scheduleCancellations = [
    ...(today?.cancelled || []).map((c) => ({ ...c, dateIso: data.dateIso })),
    ...(days?.[tomorrowIso]?.cancelled || []).map((c) => ({ ...c, dateIso: tomorrowIso })),
  ]
  data.scheduleSource = today ? 'bcferries' : 'bowenferry'
  if (!today) return false

  const feedHsb = data.hsbSchedule || []
  const deckSpaceAt = new Map(feedHsb.map((s) => [s.time, s.deckSpace ?? null]))
  const listed = new Set(today.hsbSchedule.map((s) => s.time))
  data.hsbSchedule = [
    ...today.hsbSchedule.map((s) => ({
      ...s,
      repositioning: false,
      deckSpace: deckSpaceAt.get(s.time) ?? null,
    })),
    ...feedHsb.filter((s) => s.repositioning && !listed.has(s.time)),
  ].sort((a, b) => a.time.localeCompare(b.time))
  data.bowenSchedule = today.bowenSchedule.map((s) => ({ ...s }))
  return true
}

// Instances don't share memory and any of them may run a poll, so each one
// reads the stored doc once — on its first poll, and again when the date
// rolls over. The doc covers two weeks ahead, so an instance that read it
// just before the nightly scrape still holds a correct entry for today. Only
// when the doc it read has NO entry for today (first deploy before the first
// scrape, or scrapes failing for two weeks) does it look again, hourly, so a
// manual run is picked up without a read every minute.
const MISSING_RETRY_MS = 60 * 60 * 1000
let cache = null

export async function loadSeasonalSchedule(db, dateIso, nowMs = Date.now()) {
  if (cache?.dateIso === dateIso && (cache.days[dateIso] || nowMs - cache.at < MISSING_RETRY_MS))
    return cache.days
  const snap = await db.collection('snapshots').doc(SEASONAL_SCHEDULE_DOC).get()
  cache = { dateIso, at: nowMs, days: snap.exists ? snap.data().days || {} : {} }
  return cache.days
}
