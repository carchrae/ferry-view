import { load } from 'cheerio'
import { logger } from 'firebase-functions/logger'
import { normalizeTime, timeToDate } from './time.js'

// Fallback data source for when bowenferry.ca's arrival/departure log (atberth)
// freezes while its live AIS feed keeps updating. BC Ferries' own current-conditions
// page is fully server-rendered, so we can scrape the actual HSB -> Bowen departure
// times and inject them back into the pipeline as `recentActivity` Departed events.
export const BC_FERRIES_HSB_URL =
  'https://www.bcferries.com/current-conditions/departures?terminalCode=HSB'

// The HSB page lists sailings to several destinations, one <table> per route. We only
// want the Bowen Island (Snug Cove) route.
const BOWEN_ROUTE_MARKER = 'Snug Cove'

// A browser-like User-Agent is required — the page returns non-200 without one.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// HSB -> Bowen departures leave Horseshoe Bay; that is the `location` value the rest of
// the pipeline uses for the HSB schedule (see api.js recentActivity + enrich.js:19).
const HSB_LOCATION = 'Horseshoe Bay'

/**
 * Parse the BC Ferries HSB departures HTML into the Bowen route's sailings.
 * Pure (takes the HTML string) so it can be unit-tested against a fixture.
 * @returns {Array<{scheduled: string|null, actual: string|null, eta: string|null}>}
 *   times normalized to "HH:mm"; actual/eta are null until a sailing has departed.
 */
export function parseBowenDepartures(html) {
  const $ = load(html)

  const bowenTable = $('table.departures-tbl')
    .filter((i, t) =>
      $(t).find('td[colspan] .text-dark-blue b').first().text().includes(BOWEN_ROUTE_MARKER),
    )
    .first()
  if (!bowenTable.length) return []

  const departures = []
  bowenTable.find('tr.padding-departures-td').each((i, row) => {
    const times = { scheduled: null, actual: null, eta: null }
    $(row)
      .find('ul.departures-time-ul')
      .each((j, ul) => {
        const label = $(ul).find('b').first().text().replace(/[^A-Za-z]/g, '').toUpperCase()
        const raw = $(ul).find('span.text-lowercase').first().text().trim()
        if (!raw) return
        const time = normalizeTime(raw)
        if (label === 'SCHEDULED') times.scheduled = time
        else if (label === 'ACTUAL') times.actual = time
        else if (label === 'ETA') times.eta = time
      })
    if (times.scheduled || times.actual) departures.push(times)
  })
  return departures
}

/**
 * Fetch and parse the live BC Ferries HSB -> Bowen departures.
 * @param {typeof fetch} [fetchImpl] injectable for testing.
 */
export async function fetchBowenDepartures(fetchImpl = fetch) {
  const res = await fetchImpl(BC_FERRIES_HSB_URL, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`BC Ferries departures fetch failed: HTTP ${res.status}`)
  const html = await res.text()
  return parseBowenDepartures(html)
}

/**
 * Has bowenferry.ca's departure log stopped keeping up with the schedule?
 * True only when a scheduled sailing that should already have departed is newer than
 * the newest logged arrival/departure event — i.e. an event is genuinely missing.
 * False overnight (nothing past-due) and during normal operation (log keeps up), so
 * the scraper never fires needlessly.
 */
export function isDepartureLogStale(data, now, graceMins = 15) {
  const graceMs = graceMins * 60000
  const nowMs = now.valueOf()

  const eventTimes = (data.recentActivity || [])
    .map((e) => timeToDate(e.time))
    .filter(Boolean)
    .map((t) => t.valueOf())
  const newest = eventTimes.length ? Math.max(...eventTimes) : 0

  const expectedTimes = [...(data.hsbSchedule || []), ...(data.bowenSchedule || [])]
    .filter((s) => !s.cancelled)
    .map((s) => timeToDate(s.time))
    .filter(Boolean)
    .map((t) => t.valueOf())
    .filter((t) => t <= nowMs - graceMs)
  if (!expectedTimes.length) return false

  const latestExpected = Math.max(...expectedTimes)
  return latestExpected > newest + graceMs
}

/**
 * Inject scraped actual departures into `data.recentActivity` as Departed events,
 * mirroring augmentRecentActivity's shape and dedup convention (`${time}_${location}`).
 * Only actuals that have already occurred (<= now) are added. Returns the count added.
 */
export function augmentFromBCFerries(data, departures, now) {
  const nowMs = now.valueOf()
  const seen = new Set((data.recentActivity || []).map((e) => `${e.time}_${e.location}`))
  let added = 0
  for (const d of departures) {
    if (!d.actual) continue
    const t = timeToDate(d.actual)
    if (!t || t.valueOf() > nowMs) continue
    const key = `${d.actual}_${HSB_LOCATION}`
    if (seen.has(key)) continue
    data.recentActivity.push({ action: 'Departed', location: HSB_LOCATION, time: d.actual })
    seen.add(key)
    added++
  }
  if (added) logger.log(`BC Ferries fallback: injected ${added} HSB departure(s)`)
  return added
}
