import { load } from 'cheerio'
import { logger } from 'firebase-functions/logger'
import { dayjs, normalizeTime } from './time.js'
import { WEEKDAYS, scheduleOn } from './seasonal-rules.js'

export { parseDateRule, scheduleOn } from './seasonal-rules.js'

// BC Ferries' seasonal schedule is the source of truth for which sailings run
// on a given date. It lists the sailings per weekday, with date exceptions
// printed under them in red — e.g. the Monday 5:15 am from Bowen carries
// "Except Aug 3, Sep 7, Oct 12, Feb 15, Mar 29" (holiday Mondays) — which
// bowenferry.ca's schedule feed ignores. A daily scrape stores that weekly
// timetable, notes and all (~10 KB), in snapshots/seasonalSchedule; any date
// in the page's range is worked out from it (seasonal-rules.js) — by the
// 1-minute poll, which swaps it in for bowenferry.ca's schedule
// (applySeasonalSchedule), and by the client's day picker. One page carries
// both directions: "Onward" (Horseshoe Bay → Bowen) and "Return" (Bowen →
// Horseshoe Bay).
export const SEASONAL_SCHEDULE_URL = 'https://www.bcferries.com/routes-fares/schedules/seasonal/HSB-BOW'
export const SEASONAL_SCHEDULE_DOC = 'seasonalSchedule'

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

const RANGE_RE = /([A-Z][a-z]{2} \d{1,2}, \d{4}) - ([A-Z][a-z]{2} \d{1,2}, \d{4})/

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

/**
 * Fetch the seasonal schedule page. The schedules section sits behind a
 * queue-it waiting room; outside peak demand it runs in "safetynet" mode and
 * hands back a token straight away after a JS redirect, which we follow by
 * hand (redirects, the JS hop's decoded URL, and cookies along the way). If
 * a real queue is up there is no token and this throws — the timetable from
 * an earlier run still covers its whole range.
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

// Once a day. No clients listen to the doc (the poll hands them today's and
// tomorrow's cancellations via ferryStatus/current; the day picker reads it
// once, on demand), so it's written unconditionally.
export async function refreshSeasonalSchedule(db, todayIso, fetchImpl = fetch) {
  const parsed = parseSeasonalSchedule(await fetchSeasonalScheduleHtml(fetchImpl))
  if (!parsed) throw new Error('Seasonal schedule page had no schedule tables — layout changed?')
  if (!scheduleOn(parsed, todayIso))
    throw new Error(`Seasonal schedule range ${JSON.stringify(parsed.range)} doesn't cover ${todayIso}`)
  await db.collection('snapshots').doc(SEASONAL_SCHEDULE_DOC).set({
    range: parsed.range,
    sailings: parsed.sailings,
    sourceUrl: SEASONAL_SCHEDULE_URL,
    fetchedAt: Date.now(),
  })
  const skipped = skippedDates(parsed, todayIso)
  logger.log(
    `Seasonal schedule stored (${parsed.range?.start} – ${parsed.range?.end}); skipped from ${todayIso}: ` +
      (skipped.map((d) => `${d.dateIso}: ${d.cancelled.map((c) => `${c.location} ${c.time}`).join(', ')}`).join(' | ') ||
        'none'),
  )
  return { parsed, skipped }
}

// Every date from `fromIso` to the end of the range with a skipped sailing.
export function skippedDates(parsed, fromIso) {
  const out = []
  const end = parsed.range?.end
  if (!end) return out
  for (let d = dayjs(fromIso); d.format('YYYY-MM-DD') <= end; d = d.add(1, 'day')) {
    const iso = d.format('YYYY-MM-DD')
    const day = scheduleOn(parsed, iso)
    if (day?.cancelled.length) out.push({ dateIso: iso, cancelled: day.cancelled })
  }
  return out
}

/**
 * Replace bowenferry.ca's schedule with BC Ferries' for `data.dateIso`, and
 * list today's and tomorrow's skipped sailings on `data.scheduleCancellations`
 * (each tagged with its dateIso) so the client can announce them a day ahead.
 * Keeps bowenferry.ca's per-sailing deck space, and its repositioning runs
 * (non-public boat moves BC Ferries doesn't list). When there's no stored
 * timetable covering today (before the first scrape, or past the end of BC
 * Ferries' published range) the bowenferry.ca schedule stays. Mutates `data`.
 * @param {{range, sailings}|null} timetable the stored snapshots/seasonalSchedule.
 * @returns {boolean} whether BC Ferries' schedule was applied.
 */
export function applySeasonalSchedule(data, timetable) {
  const today = scheduleOn(timetable, data.dateIso)
  const tomorrowIso = dayjs(data.dateIso).add(1, 'day').format('YYYY-MM-DD')
  const tomorrow = scheduleOn(timetable, tomorrowIso)
  data.scheduleCancellations = [
    ...(today?.cancelled || []).map((c) => ({ ...c, dateIso: data.dateIso })),
    ...(tomorrow?.cancelled || []).map((c) => ({ ...c, dateIso: tomorrowIso })),
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
    // A repositioning run only brings the boat across for the day's first
    // Bowen departure; when the first sailing leaves HSB instead (e.g. the
    // 5:15 from Bowen skipped on a holiday) there isn't one.
    ...(firstFromBowen(today) ? feedHsb.filter((s) => s.repositioning && !listed.has(s.time)) : []),
  ].sort((a, b) => a.time.localeCompare(b.time))
  data.bowenSchedule = today.bowenSchedule
  return true
}

function firstFromBowen(day) {
  const bowen = day.bowenSchedule[0]?.time
  const hsb = day.hsbSchedule[0]?.time
  return Boolean(bowen) && (!hsb || bowen < hsb)
}

// Instances don't share memory and any of them may run a poll, so each one
// reads the stored timetable once — on its first poll, and again when the
// date rolls over (to pick up the nightly scrape). Only when what it read
// doesn't cover today (first deploy before the first scrape) does it look
// again, hourly, so a manual run is picked up without a read every minute.
const MISSING_RETRY_MS = 60 * 60 * 1000
let cache = null

export async function loadSeasonalSchedule(db, dateIso, nowMs = Date.now()) {
  const covered = cache && scheduleOn(cache.timetable, dateIso)
  if (cache?.dateIso === dateIso && (covered || nowMs - cache.at < MISSING_RETRY_MS)) return cache.timetable
  const snap = await db.collection('snapshots').doc(SEASONAL_SCHEDULE_DOC).get()
  const data = snap.exists ? snap.data() : null
  cache = { dateIso, at: nowMs, timetable: data?.sailings ? { range: data.range, sailings: data.sailings } : null }
  return cache.timetable
}
