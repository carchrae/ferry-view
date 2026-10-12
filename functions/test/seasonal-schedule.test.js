import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import {
  parseSeasonalSchedule,
  parseDateRule,
  scheduleOn,
  scheduleByDate,
  fetchSeasonalScheduleHtml,
  applySeasonalSchedule,
  SEASONAL_SCHEDULE_URL,
} from '../lib/seasonal-schedule.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixture = readFileSync(join(__dirname, 'fixtures', 'hsb-bow-seasonal.html'), 'utf8')

describe('seasonal-schedule', () => {
  const parsed = parseSeasonalSchedule(fixture)

  it('parses both directions, every weekday, and the date range', () => {
    expect(parsed.range).toEqual({ start: '2026-06-03', end: '2027-03-31' })
    expect(Object.keys(parsed.sailings).sort()).toEqual(['Bowen', 'Horseshoe Bay'])
    expect(Object.keys(parsed.sailings.Bowen)).toHaveLength(7)
    expect(parsed.sailings.Bowen.Mondays[0]).toEqual({
      time: '05:15',
      notes: ['Except Aug 3, Sep 7, Oct 12, Feb 15, Mar 29'],
    })
    expect(parsed.sailings['Horseshoe Bay'].Mondays[0]).toEqual({ time: '05:45', notes: [] })
  })

  it('returns null for a page without the schedule tables', () => {
    expect(parseSeasonalSchedule('<html><body>queue</body></html>')).toBeNull()
  })

  it('reads date rules and ignores other notes', () => {
    expect(parseDateRule('Except on Dec 25 & Jan 1', '2026-12-20')).toEqual({
      kind: 'except',
      dates: ['2026-12-25', '2027-01-01'],
    })
    expect(parseDateRule('Only on Dec 24', '2026-12-20')).toEqual({ kind: 'only', dates: ['2026-12-24'] })
    expect(parseDateRule('No passengers permitted - DG Sailing only. Dangerous goods only', '2026-12-20')).toBeNull()
    expect(parseDateRule(null, '2026-12-20')).toBeNull()
  })

  it('skips the Bowen 5:15 am on Thanksgiving Monday only', () => {
    const thanksgiving = scheduleOn(parsed, '2026-10-12')
    expect(thanksgiving.cancelled).toEqual([
      { location: 'Bowen', time: '05:15', note: 'Except Aug 3, Sep 7, Oct 12, Feb 15, Mar 29' },
    ])
    expect(thanksgiving.bowenSchedule[0]).toEqual({ time: '06:15', dangerousCargo: false })
    expect(thanksgiving.bowenSchedule).toHaveLength(15)
    expect(thanksgiving.hsbSchedule).toHaveLength(15)
    const nextMonday = scheduleOn(parsed, '2026-10-19')
    expect(nextMonday.cancelled).toEqual([])
    expect(nextMonday.bowenSchedule[0].time).toBe('05:15')
    // Family Day 2027 — resolves into the next year.
    expect(scheduleOn(parsed, '2027-02-15').cancelled.map((c) => c.time)).toEqual(['05:15'])
  })

  it('flags the dangerous-goods sailings', () => {
    // Wednesdays: 9:20 am from Horseshoe Bay, 1:55 pm from Bowen.
    const wed = scheduleOn(parsed, '2026-10-14')
    expect(wed.hsbSchedule.filter((s) => s.dangerousCargo).map((s) => s.time)).toEqual(['09:20'])
    expect(wed.bowenSchedule.filter((s) => s.dangerousCargo).map((s) => s.time)).toEqual(['13:55'])
  })

  it('skips the Christmas Day early sailings in both directions', () => {
    // Dec 25 2026 is a Friday.
    const xmas = scheduleOn(parsed, '2026-12-25')
    expect(xmas.cancelled.filter((c) => c.location === 'Bowen').map((c) => c.time)).toEqual(['05:15', '06:15', '07:30'])
    expect(xmas.cancelled.filter((c) => c.location === 'Horseshoe Bay').map((c) => c.time)).toEqual(['05:45', '06:50'])
    expect(xmas.bowenSchedule[0].time).toBe('08:45')
  })

  it('knows nothing outside the seasonal range', () => {
    expect(scheduleOn(parsed, '2027-04-05')).toBeNull()
    expect(Object.keys(scheduleByDate(parsed, '2027-03-30', 4))).toEqual(['2027-03-30', '2027-03-31'])
  })

  it('follows the queue-it safetynet hop with cookies to the schedule page', async () => {
    const queueUrl = 'https://bcferries.queue-it.net/?c=bcferries&e=roomschedules&t=x'
    const tokenUrl = `${SEASONAL_SCHEDULE_URL}?queueittoken=e_roomschedules~rt_safetynet`
    const calls = []
    const res = (status, { location, body = '', cookie } = {}) => ({
      status,
      ok: status >= 200 && status < 300,
      headers: {
        get: (h) => (h === 'location' ? location : null),
        getSetCookie: () => (cookie ? [cookie] : []),
      },
      text: async () => body,
    })
    const fakeFetch = async (url, init) => {
      calls.push({ url, cookie: init.headers.Cookie })
      if (url === SEASONAL_SCHEDULE_URL) return res(302, { location: queueUrl })
      if (url === queueUrl)
        return res(200, {
          body: "document.location.href = decodeURIComponent('%2F%3Fc%3Dbcferries%26e%3Droomschedules%26tsh%3Dabc');",
          cookie: 'Queue-it=1; path=/',
        })
      if (url === 'https://bcferries.queue-it.net/?c=bcferries&e=roomschedules&tsh=abc')
        return res(302, { location: tokenUrl })
      if (url === tokenUrl) return res(200, { body: fixture })
      throw new Error('unexpected ' + url)
    }
    expect(await fetchSeasonalScheduleHtml(fakeFetch)).toBe(fixture)
    expect(calls.map((c) => c.url)).toHaveLength(4)
    expect(calls[2].cookie).toBe('Queue-it=1')
  })

  it('throws when the waiting room is actually queuing', async () => {
    const fakeFetch = async (url) => ({
      status: url.includes('queue-it') ? 200 : 302,
      ok: url.includes('queue-it'),
      headers: { get: () => 'https://bcferries.queue-it.net/wait', getSetCookie: () => [] },
      text: async () => '<html>You are now in line</html>',
    })
    await expect(fetchSeasonalScheduleHtml(fakeFetch)).rejects.toThrow(/queuing/)
  })

  const days = () => scheduleByDate(parsed, '2026-10-11', 3)

  it('replaces the feed schedule with BC Ferries\' for the day', () => {
    const data = {
      dateIso: '2026-10-12',
      bowenSchedule: [{ time: '05:15', dangerousCargo: false }, { time: '06:15', dangerousCargo: false }],
      hsbSchedule: [
        { time: '04:40', dangerousCargo: false, repositioning: true, deckSpace: null },
        { time: '05:45', dangerousCargo: false, repositioning: false, deckSpace: '97%' },
      ],
    }
    expect(applySeasonalSchedule(data, days())).toBe(true)
    expect(data.scheduleSource).toBe('bcferries')
    expect(data.bowenSchedule[0]).toEqual({ time: '06:15', dangerousCargo: false })
    expect(data.bowenSchedule).toHaveLength(15)
    // Feed's repositioning run kept; feed deck space carried onto the listed sailing.
    expect(data.hsbSchedule.slice(0, 2)).toEqual([
      { time: '04:40', dangerousCargo: false, repositioning: true, deckSpace: null },
      { time: '05:45', dangerousCargo: false, repositioning: false, deckSpace: '97%' },
    ])
    expect(data.scheduleCancellations).toEqual([
      { location: 'Bowen', time: '05:15', note: 'Except Aug 3, Sep 7, Oct 12, Feb 15, Mar 29', dateIso: '2026-10-12' },
    ])
  })

  it('announces tomorrow\'s skipped sailings the day before', () => {
    const data = { dateIso: '2026-10-11', bowenSchedule: [], hsbSchedule: [] }
    applySeasonalSchedule(data, days())
    expect(data.scheduleCancellations).toEqual([
      { location: 'Bowen', time: '05:15', note: 'Except Aug 3, Sep 7, Oct 12, Feb 15, Mar 29', dateIso: '2026-10-12' },
    ])
  })

  it('keeps the feed schedule when there is no entry for today', () => {
    const data = { dateIso: '2026-10-12', bowenSchedule: [{ time: '05:15' }], hsbSchedule: [] }
    expect(applySeasonalSchedule(data, null)).toBe(false)
    expect(data.scheduleSource).toBe('bowenferry')
    expect(data.bowenSchedule).toEqual([{ time: '05:15' }])
    expect(data.scheduleCancellations).toEqual([])
  })
})

describe('loadSeasonalSchedule', () => {
  it('reads the doc once per day, re-checking hourly only while today is missing', async () => {
    const { loadSeasonalSchedule } = await import('../lib/seasonal-schedule.js')
    let reads = 0
    let stored = {}
    const db = {
      collection: () => ({
        doc: () => ({
          get: async () => {
            reads++
            return { exists: true, data: () => ({ days: stored }) }
          },
        }),
      }),
    }
    const t0 = 1_000_000
    // Before the first scrape: nothing for today → hourly retries only.
    await loadSeasonalSchedule(db, '2026-10-12', t0)
    await loadSeasonalSchedule(db, '2026-10-12', t0 + 30 * 60000)
    expect(reads).toBe(1)
    stored = { '2026-10-12': { bowenSchedule: [], hsbSchedule: [], cancelled: [] } }
    await loadSeasonalSchedule(db, '2026-10-12', t0 + 61 * 60000)
    expect(reads).toBe(2)
    // Today present: no more reads all day.
    await loadSeasonalSchedule(db, '2026-10-12', t0 + 10 * 3600000)
    expect(reads).toBe(2)
    // Date rolls over: one read.
    await loadSeasonalSchedule(db, '2026-10-13', t0 + 11 * 3600000)
    expect(reads).toBe(3)
  })
})
