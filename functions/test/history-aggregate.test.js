import { describe, it, expect, vi, afterEach } from 'vitest'
import { recomputeHistoricalStats, recomputeHolidayStats, HISTORY_WEEKS } from '../lib/history-aggregate.js'
import { nowInVancouver } from '../lib/time.js'

// Fake supporting the two surfaces used: a range query on sailingStatus and a
// doc set on aggregates.
function makeDb(statusDocs = []) {
  const writes = []
  return {
    writes,
    collection(name) {
      if (name === 'sailingStatus') {
        const filters = []
        const q = {
          where(field, op, value) {
            filters.push({ field, op, value })
            return q
          },
          async get() {
            const matches = statusDocs.filter((d) =>
              filters.every(({ field, op, value }) => {
                const v = d[field]
                if (op === '>=') return v >= value
                if (op === '<=') return v <= value
                throw new Error(`unsupported op ${op}`)
              }),
            )
            return { forEach: (fn) => matches.forEach((d) => fn({ data: () => d })) }
          },
        }
        return q
      }
      return {
        doc(id) {
          return {
            async set(payload) {
              writes.push({ key: `${name}/${id}`, payload })
            },
          }
        },
      }
    },
  }
}

describe('recomputeHistoricalStats', () => {
  const yesterday = nowInVancouver().subtract(1, 'day').format('YYYY-MM-DD')
  const today = nowInVancouver().format('YYYY-MM-DD')
  const tooOld = nowInVancouver().subtract(HISTORY_WEEKS, 'week').subtract(1, 'day').format('YYYY-MM-DD')

  it('writes a compact aggregate covering the window, excluding today and pre-window docs', async () => {
    const db = makeDb([
      {
        dateIso: yesterday,
        sailingTime: '10:00',
        direction: 'To Bowen',
        actualDepartureTime: '10:04',
        lastCapacity: 'Full',
        capacitySource: 'automated',
        filledAt: 1752300000000,
        extraneousField: 'dropped',
      },
      {
        dateIso: yesterday,
        sailingTime: '10:35',
        direction: 'To HSB',
        crosswalkFullAt: 1752310000000,
      },
      { dateIso: today, sailingTime: '10:00', direction: 'To Bowen' },
      { dateIso: tooOld, sailingTime: '10:00', direction: 'To Bowen' },
      // Malformed doc — skipped
      { dateIso: yesterday, direction: 'To Bowen' },
    ])

    const result = await recomputeHistoricalStats(db)
    expect(result.count).toBe(2)
    expect(result.end).toBe(yesterday)

    expect(db.writes).toHaveLength(1)
    const { key, payload } = db.writes[0]
    expect(key).toBe('aggregates/historicalStats')
    expect(payload.weeks).toBe(HISTORY_WEEKS)
    expect(payload.sailings).toEqual([
      {
        d: yesterday,
        t: '10:00',
        dir: 'To Bowen',
        dep: '10:04',
        cap: 'Full',
        src: 'automated',
        fa: 1752300000000,
      },
      { d: yesterday, t: '10:35', dir: 'To HSB', cw: 1752310000000 },
    ])
  })

  it('flattens Timestamp-like filledAt to epoch ms', async () => {
    const db = makeDb([
      {
        dateIso: yesterday,
        sailingTime: '10:00',
        direction: 'To Bowen',
        lastCapacity: 'Full',
        filledAt: { toMillis: () => 1752300000000 },
      },
    ])
    await recomputeHistoricalStats(db)
    expect(db.writes[0].payload.sailings[0].fa).toBe(1752300000000)
  })
})

describe('recomputeHolidayStats', () => {
  // Pinned to the day after Thanksgiving 2026, so "yesterday" is a holiday.
  const at = (iso) => vi.setSystemTime(new Date(`${iso}T19:00:00Z`))
  const sailing = (dateIso, t = '10:35') => ({ dateIso, sailingTime: t, direction: 'To Bowen', lastCapacity: '40%' })
  const docs = [
    sailing('2026-09-05'), sailing('2026-09-06'), sailing('2026-09-07'), // Labour Day weekend
    sailing('2026-09-08'), // Tuesday after: ordinary
    sailing('2026-09-30'), // Truth and Reconciliation Day
    sailing('2026-10-11'), sailing('2026-10-12'), // Thanksgiving Sun + Mon
    sailing('2026-10-13'), // today: not yet
  ]
  afterEach(() => vi.useRealTimers())

  it('collects only holiday and long-weekend sailings, one query per long weekend', async () => {
    vi.useFakeTimers()
    at('2026-10-13')
    const db = makeDb(docs)
    const r = await recomputeHolidayStats(db)
    const { payload } = db.writes.find((w) => w.key === 'aggregates/holidayStats')
    expect(payload.sailings.map((s) => s.d).sort()).toEqual([
      '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-30', '2026-10-11', '2026-10-12',
    ])
    expect(payload.dates.find((d) => d.d === '2026-10-12')).toEqual({ d: '2026-10-12', type: 'holiday', name: 'Thanksgiving' })
    expect(payload.dates.find((d) => d.d === '2026-10-11').type).toBe('long-weekend')
    expect(r.count).toBe(6)
  })

  it('skips an ordinary night when the doc already exists', async () => {
    vi.useFakeTimers()
    at('2026-10-15') // yesterday was an ordinary Wednesday
    const db = makeDb(docs)
    const orig = db.collection.bind(db)
    db.collection = (name) => {
      const c = orig(name)
      if (name !== 'aggregates') return c
      return { doc: (id) => ({ ...c.doc(id), get: async () => ({ exists: true }) }) }
    }
    expect(await recomputeHolidayStats(db)).toEqual({ skipped: true })
    expect(db.writes).toHaveLength(0)
  })
})
