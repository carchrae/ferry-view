import { describe, it, expect } from 'vitest'
import { augmentRecentActivity } from '../lib/enrich.js'

// Fake db: equality-filterable sailingStatus query (the only surface
// augmentRecentActivity touches).
function makeDb(statusDocs) {
  return {
    collection() {
      const filters = []
      const q = {
        where(field, op, value) {
          filters.push({ field, op, value })
          return q
        },
        async get() {
          const matches = statusDocs.filter((d) =>
            filters.every(({ field, op, value }) => op === '==' && d[field] === value),
          )
          return { forEach: (fn) => matches.forEach((d) => fn({ data: () => d })) }
        },
      }
      return q
    },
  }
}

const DATE = '2026-07-13'

function makeData() {
  return {
    dateIso: DATE,
    recentActivity: [],
    bowenSchedule: [{ time: '10:00' }, { time: '11:15' }],
    hsbSchedule: [{ time: '10:35' }],
  }
}

describe('augmentRecentActivity — crosswalkFullAt enrichment', () => {
  it('copies crosswalkFullAt from a To HSB sailingStatus doc onto the schedule entry', async () => {
    const db = makeDb([
      { dateIso: DATE, sailingTime: '10:00', direction: 'To HSB', crosswalkFullAt: 1752420000000 },
    ])
    const data = makeData()
    await augmentRecentActivity(db, data)
    expect(data.bowenSchedule[0].crosswalkFullAt).toBe(1752420000000)
    expect(data.bowenSchedule[1].crosswalkFullAt).toBeUndefined()
    expect(data.hsbSchedule[0].crosswalkFullAt).toBeUndefined()
  })

  it('ignores To Bowen docs and non-numeric values', async () => {
    const db = makeDb([
      { dateIso: DATE, sailingTime: '10:35', direction: 'To Bowen', crosswalkFullAt: 123 },
      { dateIso: DATE, sailingTime: '11:15', direction: 'To HSB', crosswalkFullAt: 'garbage' },
    ])
    const data = makeData()
    await augmentRecentActivity(db, data)
    expect(data.hsbSchedule[0].crosswalkFullAt).toBeUndefined()
    expect(data.bowenSchedule[1].crosswalkFullAt).toBeUndefined()
  })

  it('carries crosswalkSource alongside the mark (defaulting to user)', async () => {
    const db = makeDb([
      {
        dateIso: DATE,
        sailingTime: '10:00',
        direction: 'To HSB',
        crosswalkFullAt: 1752420000000,
        crosswalkSource: 'robot',
      },
      { dateIso: DATE, sailingTime: '11:15', direction: 'To HSB', crosswalkFullAt: 1752421000000 },
    ])
    const data = makeData()
    await augmentRecentActivity(db, data)
    expect(data.bowenSchedule[0].crosswalkSource).toBe('robot')
    expect(data.bowenSchedule[1].crosswalkSource).toBe('user')
  })
})

describe('augmentRecentActivity — robot capacity enrichment', () => {
  it("copies a robot 'Not Full' onto the schedule entry when it has no capacity", async () => {
    const db = makeDb([
      {
        dateIso: DATE,
        sailingTime: '10:00',
        direction: 'To HSB',
        lastCapacity: 'Not Full',
        capacitySource: 'robot',
      },
    ])
    const data = makeData()
    await augmentRecentActivity(db, data)
    expect(data.bowenSchedule[0].lastCapacity).toBe('Not Full')
    expect(data.bowenSchedule[0].capacitySource).toBe('robot')
  })

  it('never displaces a capacity already on the entry', async () => {
    const db = makeDb([
      {
        dateIso: DATE,
        sailingTime: '10:00',
        direction: 'To HSB',
        lastCapacity: 'Not Full',
        capacitySource: 'robot',
      },
    ])
    const data = makeData()
    data.bowenSchedule[0].lastCapacity = 'Full'
    data.bowenSchedule[0].capacitySource = 'user'
    await augmentRecentActivity(db, data)
    expect(data.bowenSchedule[0].lastCapacity).toBe('Full')
    expect(data.bowenSchedule[0].capacitySource).toBe('user')
  })

  it('ignores user/automated-sourced docs (those flow via other augments)', async () => {
    const db = makeDb([
      {
        dateIso: DATE,
        sailingTime: '10:00',
        direction: 'To HSB',
        lastCapacity: 'Full',
        capacitySource: 'user',
      },
    ])
    const data = makeData()
    await augmentRecentActivity(db, data)
    expect(data.bowenSchedule[0].lastCapacity).toBeUndefined()
  })
})
