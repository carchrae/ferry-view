import { load } from 'cheerio'
import { logger } from 'firebase-functions/logger'

// BC Ferries' per-route current-conditions page lists the route's active
// service notices (revised schedules, closures, ...). Polled server-side and
// published to snapshots/serviceNotices so every client gets one tiny doc
// instead of each scraping BC Ferries.
export const BC_FERRIES_CONDITIONS_URL = 'https://www.bcferries.com/current-conditions/BOW-HSB'
const BC_FERRIES_ORIGIN = 'https://www.bcferries.com'

export const SERVICE_NOTICES_DOC = 'serviceNotices'

// Same reason as bcferries-departures.js: non-200 without a browser UA.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/**
 * Parse the route's service notices out of the conditions page HTML. Pure, so
 * it can be tested against a fixture.
 * @returns {Array<{code: string, title: string, url: string}>|null} null when
 *   the page doesn't look like a conditions page at all (layout change, error
 *   page) — distinct from [] (page fine, no notices), so a broken scrape can't
 *   wipe the published notices.
 */
export function parseServiceNotices(html) {
  const $ = load(html)
  if (!$('#ccDetails').length) return null
  const notices = []
  $('.cc-service-notice-item a[href]').each((i, a) => {
    const href = $(a).attr('href')
    const title = $(a).text().replace(/\s+/g, ' ').trim()
    if (!title) return
    const url = new URL(href, BC_FERRIES_ORIGIN).toString()
    // The notice code is the stable identity clients remember as "seen"; fall
    // back to the URL if BC Ferries ever drops the query param.
    const code = new URL(url).searchParams.get('serviceNoticeCode') || url
    if (notices.some((n) => n.code === code)) return
    notices.push({ code, title, url })
  })
  return notices
}

/** @param {typeof fetch} [fetchImpl] injectable for testing. */
export async function fetchServiceNotices(fetchImpl = fetch) {
  const res = await fetchImpl(BC_FERRIES_CONDITIONS_URL, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`BC Ferries conditions fetch failed: HTTP ${res.status}`)
  const notices = parseServiceNotices(await res.text())
  if (!notices) throw new Error('BC Ferries conditions page had no #ccDetails — layout changed?')
  return notices
}

export function sameNotices(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  return a.every((n, i) => n.code === b[i].code && n.title === b[i].title && n.url === b[i].url)
}

// Writes only when the list changes: the doc has live listeners on every open
// home page, so an unchanged write every 5 minutes would bill a read per
// client for nothing.
export async function refreshServiceNotices(db, fetchImpl = fetch) {
  const notices = await fetchServiceNotices(fetchImpl)
  const ref = db.collection('snapshots').doc(SERVICE_NOTICES_DOC)
  const existing = await ref.get()
  if (existing.exists && sameNotices(existing.data().notices, notices)) return { changed: false }
  await ref.set({ notices, sourceUrl: BC_FERRIES_CONDITIONS_URL, changedAt: Date.now() })
  logger.log(`Service notices changed: ${notices.map((n) => n.title).join(' | ') || '(none)'}`)
  return { changed: true, notices }
}
