import { describe, it, expect } from 'vitest'
import {
  recomputeBowenSailings,
  upsertBowenSailing,
  sailingToRecord,
  BOWEN_SAILINGS_DAYS,
} from '../lib/bowen-sailings-aggregate.js'
import { nowInVancouver } from '../lib/time.js'

const today = nowInVancouver().format('YYYY-MM-DD')
const yesterday = nowInVancouver().subtract(1, 'day').format('YYYY-MM-DD')
const tooOld = nowInVancouver()
  .subtract(BOWEN_SAILINGS_DAYS + 1, 'day')
  .format('YYYY-MM-DD')

// Fake supporting the surfaces used: a filtered range query on sailingStatus,
// a doc set on aggregates, and a get/set transaction on the aggregate doc.
function makeDb({ statusDocs = [], aggregate } = {}) {
  const writes = []
  let aggDoc = aggregate
  const db = {
    writes,
    aggDoc: () => aggDoc,
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
                if (op === '==') return v === value
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
            _key: `${name}/${id}`,
            async set(payload) {
              writes.push({ key: `${name}/${id}`, payload })
              aggDoc = payload
            },
          }
        },
      }
    },
    async runTransaction(fn) {
      await fn({
        get: async () => ({ exists: aggDoc != null, data: () => aggDoc }),
        set: (ref, payload) => {
          writes.push({ key: ref._key, payload })
          aggDoc = payload
        },
      })
    },
  }
  return db
}

const lineupPath = (d, t, ts) => `webcams/community/${d}/timelapse/${t}_To HSB_${ts}.jpg`
const departurePath = (d, t, ts) => `webcams/bowen/${d}/timelapse/${t}_To HSB_${ts}.jpg`

describe('sailingToRecord', () => {
  it('maps paths to sorted frame epochs and flattens Timestamp-like crosswalkFullAt', () => {
    const rec = sailingToRecord({
      dateIso: yesterday,
      sailingTime: '10:00',
      lastCapacity: '30%',
      capacitySource: 'automated',
      webcamSnapshotPath: 'webcams/bowen/x.jpg_1752300000000.jpg',
      crosswalkFullAt: { toMillis: () => 1752310000000 },
      lineupTimelapsePaths: [
        lineupPath(yesterday, '10:00', 1752300200000),
        lineupPath(yesterday, '10:00', 1752300100000),
        'malformed-path.jpg',
      ],
      departureTimelapsePaths: [departurePath(yesterday, '10:00', 1752300300000)],
    })
    expect(rec).toEqual({
      d: yesterday,
      t: '10:00',
      cap: '30%',
      src: 'automated',
      wp: 'webcams/bowen/x.jpg_1752300000000.jpg',
      cw: 1752310000000,
      lt: [1752300100000, 1752300200000],
      dt: [1752300300000],
    })
  })

  it('returns null for media-less or malformed sailings', () => {
    expect(sailingToRecord({ dateIso: yesterday, sailingTime: '10:00', lastCapacity: 'Full' })).toBeNull()
    expect(sailingToRecord({ sailingTime: '10:00', webcamSnapshotPath: 'x.jpg' })).toBeNull()
  })
})

describe('recomputeBowenSailings', () => {
  it('rebuilds from To HSB docs in the window, dropping media-less and aged-out docs', async () => {
    const db = makeDb({
      statusDocs: [
        {
          dateIso: yesterday,
          sailingTime: '10:00',
          direction: 'To HSB',
          communitySnapshotPath: 'webcams/community/a_1752300000000.jpg',
          communityArrivalTime: '09:45',
        },
        // Wrong direction — excluded by the query
        { dateIso: yesterday, sailingTime: '10:30', direction: 'To Bowen', webcamSnapshotPath: 'x.jpg' },
        // Media-less — excluded by the mapper
        { dateIso: yesterday, sailingTime: '11:15', direction: 'To HSB', lastCapacity: 'Full' },
        // Aged out — excluded by the range
        { dateIso: tooOld, sailingTime: '10:00', direction: 'To HSB', webcamSnapshotPath: 'x.jpg' },
      ],
    })

    const result = await recomputeBowenSailings(db)
    expect(result.count).toBe(1)
    expect(result.end).toBe(today)

    const { key, payload } = db.writes[0]
    expect(key).toBe('aggregates/bowenSailings')
    expect(payload.sailings).toEqual([
      { d: yesterday, t: '10:00', cp: 'webcams/community/a_1752300000000.jpg', ca: '09:45' },
    ])
  })
})

describe('upsertBowenSailing', () => {
  const seeded = () => ({
    start: nowInVancouver().subtract(BOWEN_SAILINGS_DAYS, 'day').format('YYYY-MM-DD'),
    end: yesterday,
    updatedAt: 1,
    sailings: [{ d: yesterday, t: '10:00', lt: [1752300100000] }],
  })

  it('merges scalars into an existing record', async () => {
    const db = makeDb({ aggregate: seeded() })
    await upsertBowenSailing(db, { dateIso: yesterday, sailingTime: '10:00', cap: 'Full', src: 'user' })
    const rec = db.aggDoc().sailings[0]
    expect(rec).toEqual({ d: yesterday, t: '10:00', lt: [1752300100000], cap: 'Full', src: 'user' })
  })

  it('appends a new record and extends end past the rebuild date', async () => {
    const db = makeDb({ aggregate: seeded() })
    await upsertBowenSailing(db, { dateIso: today, sailingTime: '06:00', addDepartureTs: 1752400000000 })
    expect(db.aggDoc().end).toBe(today)
    expect(db.aggDoc().sailings).toContainEqual({ d: today, t: '06:00', dt: [1752400000000] })
  })

  it('dedupes and sorts timelapse frame epochs', async () => {
    const db = makeDb({ aggregate: seeded() })
    await upsertBowenSailing(db, { dateIso: yesterday, sailingTime: '10:00', addLineupTs: 1752300100000 })
    await upsertBowenSailing(db, { dateIso: yesterday, sailingTime: '10:00', addLineupTs: 1752300000000 })
    expect(db.aggDoc().sailings[0].lt).toEqual([1752300000000, 1752300100000])
  })

  it('no-ops when the aggregate is not seeded or the date pre-dates the window', async () => {
    const unseeded = makeDb({})
    await upsertBowenSailing(unseeded, { dateIso: yesterday, sailingTime: '10:00', cap: 'Full' })
    expect(unseeded.writes).toHaveLength(0)

    const db = makeDb({ aggregate: seeded() })
    await upsertBowenSailing(db, { dateIso: tooOld, sailingTime: '10:00', cap: 'Full' })
    expect(db.writes).toHaveLength(0)
  })

  it('never throws when the transaction fails', async () => {
    const db = {
      collection: () => ({ doc: () => ({}) }),
      runTransaction: async () => {
        throw new Error('contention')
      },
    }
    await expect(
      upsertBowenSailing(db, { dateIso: yesterday, sailingTime: '10:00', cap: 'Full' }),
    ).resolves.toBeUndefined()
  })
})
