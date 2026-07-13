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
})
