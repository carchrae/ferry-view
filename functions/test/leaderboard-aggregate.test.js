import { describe, it, expect, vi } from 'vitest'

vi.mock('firebase-functions/logger', () => ({ logger: { log: () => {} } }))

const { recomputeLeaderboard } = await import('../lib/leaderboard-aggregate.js')

const DAY_MS = 24 * 60 * 60 * 1000
const now = Date.now()
const old = now - 60 * DAY_MS // outside the 30-day window

// Fake supporting the surfaces used: unfiltered-ish collection gets (the
// capacityHistory userReport filter is honored) and a set on aggregates.
function makeDb(collections) {
  const writes = []
  const snap = (docs) => ({ docs, forEach: (fn) => docs.forEach((d) => fn({ data: () => d })) })
  return {
    writes,
    collection(name) {
      const docs = collections[name] || []
      return {
        where: (field, op, value) => ({
          get: async () => snap(docs.filter((d) => d[field] === value)),
        }),
        get: async () => snap(docs),
        doc: (id) => ({ set: async (data) => writes.push({ name, id, data }) }),
      }
    },
  }
}

const cap = (userUid, sailingKey, recordedAt) => ({
  userReport: true,
  userUid,
  userName: userUid,
  sailingKey,
  capacity: 'Full',
  recordedAt,
})
const ride = (authorUid, at, type = 'offer') => ({
  authorUid,
  authorName: authorUid,
  type,
  createdAt: { toMillis: () => at },
})

describe('recomputeLeaderboard', () => {
  it('ranks by 30 days, annotates all-time credits, and stores all-time GOATs', async () => {
    const db = makeDb({
      capacityHistory: [
        // Veteran: 3 old sailings, 0 recent. Newbie: 1 recent sailing.
        cap('vet', 'old1', old),
        cap('vet', 'old2', old),
        cap('vet', 'old3', old),
        cap('newbie', 'new1', now - DAY_MS),
        { userUid: null, sailingKey: 'x', capacity: 'Full', recordedAt: now }, // automated
      ],
      lineupReports: [{ userUid: 'newbie', sailingKey: 'new2', crosswalkAt: now, recordedAt: now }],
      rides: [ride('driver', old), ride('driver', old), ride('asker', now, 'request')],
    })

    const { reporters, riders } = await recomputeLeaderboard(db)

    expect(reporters.map((e) => [e.userUid, e.credits, e.allTimeCredits])).toEqual([
      ['newbie', 2, 2],
    ])
    expect(riders.map((e) => [e.userUid, e.credits, e.allTimeCredits])).toEqual([['asker', 5, 5]])

    const { data } = db.writes.find((w) => w.id === 'leaderboard')
    expect(data.goats.reporters.map((e) => [e.userUid, e.credits])).toEqual([
      ['vet', 3],
      ['newbie', 2],
    ])
    expect(data.goats.riders.map((e) => [e.userUid, e.credits])).toEqual([
      ['driver', 20],
      ['asker', 5],
    ])
    expect(data.goats.overall.map((e) => [e.userUid, e.credits])).toEqual([
      ['driver', 20],
      ['asker', 5],
      ['vet', 3],
    ])
  })
})
