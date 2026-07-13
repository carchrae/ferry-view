import { describe, it, expect } from 'vitest'
import { augmentFromCapacityHistory } from '../lib/enrich.js'

// In-memory Firestore fake: range-filterable capacityHistory queries plus the
// doc get/set surface updateSailingStatus needs. Counts capacityHistory
// queries so tests can assert the backfill stays a single read op.
function makeDb({ capacityDocs = [], statusDocs = {} } = {}) {
  const docs = { ...statusDocs }
  const writes = []
  const state = { capacityQueries: 0 }
  return {
    docs,
    writes,
    state,
    collection(name) {
      if (name === 'capacityHistory') {
        const filters = []
        const q = {
          where(field, op, value) {
            filters.push({ field, op, value })
            return q
          },
          async get() {
            state.capacityQueries++
            const matches = capacityDocs.filter((d) =>
              filters.every(({ field, op, value }) => {
                const v = d[field]
                if (op === '>=') return v >= value
                if (op === '<') return v < value
                if (op === '==') return v === value
                throw new Error(`unsupported op ${op}`)
              }),
            )
            return {
              empty: matches.length === 0,
              forEach: (fn) => matches.forEach((d) => fn({ data: () => d })),
            }
          },
        }
        return q
      }
      return {
        doc(id) {
          const key = `${name}/${id}`
          return {
            async get() {
              const data = docs[key]
              return { exists: data !== undefined, data: () => data }
            },
            async set(payload, opts) {
              writes.push({ key, payload, opts })
              docs[key] = opts?.merge ? { ...(docs[key] || {}), ...payload } : { ...payload }
            },
          }
        },
      }
    },
  }
}

const DATE = '2026-07-13'

function makeData({ hsb = [], bowen = [] } = {}) {
  return {
    dateIso: DATE,
    hsbSchedule: hsb,
    bowenSchedule: bowen,
  }
}

describe('augmentFromCapacityHistory', () => {
  it('issues a single capacityHistory query regardless of schedule size', async () => {
    const db = makeDb()
    const data = makeData({
      hsb: [{ time: '10:00' }, { time: '11:05' }, { time: '12:10' }],
      bowen: [{ time: '10:35' }, { time: '11:40' }, { time: '12:45' }],
    })
    await augmentFromCapacityHistory(db, data)
    expect(db.state.capacityQueries).toBe(1)
  })

  it('enriches entries from the latest record per sailingKey and persists to sailingStatus', async () => {
    const key = `${DATE}_10:00_To Bowen`
    const db = makeDb({
      capacityDocs: [
        { sailingKey: key, capacity: '30%', recordedAt: 1000 },
        { sailingKey: key, capacity: 'Full', recordedAt: 2000, filledAt: 1999 },
        // Different day — outside the range query, must be ignored
        { sailingKey: `2026-07-12_10:00_To Bowen`, capacity: '90%', recordedAt: 3000 },
      ],
    })
    const data = makeData({ hsb: [{ time: '10:00' }] })
    await augmentFromCapacityHistory(db, data)

    const entry = data.hsbSchedule[0]
    expect(entry.lastCapacity).toBe('Full')
    expect(entry.capacitySource).toBe('automated')
    expect(entry.filledAt).toBe(1999)
    expect(db.docs[`sailingStatus/${key}`]).toMatchObject({
      sailingKey: key,
      lastCapacity: 'Full',
      capacitySource: 'automated',
      filledAt: 1999,
    })
  })

  it('marks user reports as user-sourced and never numeric-fills from recordedAt', async () => {
    const key = `${DATE}_10:35_To HSB`
    const db = makeDb({
      capacityDocs: [
        { sailingKey: key, capacity: 'Full', recordedAt: 5000, userUid: 'u1' },
      ],
    })
    const data = makeData({ bowen: [{ time: '10:35' }] })
    await augmentFromCapacityHistory(db, data)

    const entry = data.bowenSchedule[0]
    expect(entry.lastCapacity).toBe('Full')
    expect(entry.capacitySource).toBe('user')
    expect(entry.filledAt).toBe('user_reported')
    expect(db.docs[`sailingStatus/${key}`].filledAt).toBe('user_reported')
  })

  it('leaves entries that already have capacity untouched', async () => {
    const key = `${DATE}_10:00_To Bowen`
    const db = makeDb({
      capacityDocs: [{ sailingKey: key, capacity: 'Full', recordedAt: 1000 }],
    })
    const data = makeData({ hsb: [{ time: '10:00', lastCapacity: '50%' }] })
    await augmentFromCapacityHistory(db, data)

    expect(data.hsbSchedule[0].lastCapacity).toBe('50%')
    expect(db.writes).toHaveLength(0)
  })

  it('does nothing when no history exists for today', async () => {
    const db = makeDb({
      capacityDocs: [{ sailingKey: '2026-07-01_10:00_To Bowen', capacity: 'Full', recordedAt: 1 }],
    })
    const data = makeData({ hsb: [{ time: '10:00' }], bowen: [{ time: '10:35' }] })
    await augmentFromCapacityHistory(db, data)

    expect(data.hsbSchedule[0].lastCapacity).toBeUndefined()
    expect(db.writes).toHaveLength(0)
  })
})
