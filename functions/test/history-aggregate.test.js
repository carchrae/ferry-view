import { describe, it, expect } from 'vitest'
import { recomputeHistoricalStats, HISTORY_WEEKS } from '../lib/history-aggregate.js'
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
