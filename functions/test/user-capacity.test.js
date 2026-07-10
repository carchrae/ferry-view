import { describe, it, expect } from 'vitest'
import { applyUserCapacityReport } from '../lib/user-capacity.js'
import { updateSailingStatus } from '../lib/helpers.js'
import { nowInVancouver } from '../lib/time.js'

// Minimal in-memory Firestore fake: enough for updateSailingStatus
// (collection().doc().get()/set()).
function makeDb(initialDocs = {}) {
  const docs = { ...initialDocs }
  const writes = []
  return {
    docs,
    writes,
    collection(name) {
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

const KEY = '2026-07-01_10:35_To HSB'
const DOC = `sailingStatus/${KEY}`

describe('applyUserCapacityReport', () => {
  it('ignores records without userUid (automated records / trigger loop guard)', async () => {
    const db = makeDb()
    const result = await applyUserCapacityReport(db, {
      sailingKey: KEY,
      capacity: 'Full',
      recordedAt: Date.now(),
    })
    expect(result).toBe(false)
    expect(db.writes).toHaveLength(0)
  })

  it('ignores missing/malformed records', async () => {
    const db = makeDb()
    expect(await applyUserCapacityReport(db, undefined)).toBe(false)
    expect(await applyUserCapacityReport(db, { userUid: 'u1', capacity: 'Full' })).toBe(false)
    expect(
      await applyUserCapacityReport(db, { userUid: 'u1', capacity: 'Full', sailingKey: 'garbage' }),
    ).toBe(false)
    expect(db.writes).toHaveLength(0)
  })

  it('fills an empty sailingStatus doc from a user Full tag', async () => {
    const db = makeDb()
    await applyUserCapacityReport(db, {
      sailingKey: KEY,
      capacity: 'Full',
      filledAt: null,
      recordedAt: Date.now(),
      userUid: 'u1',
    })
    expect(db.docs[DOC]).toMatchObject({
      sailingKey: KEY,
      sailingTime: '10:35',
      direction: 'To HSB',
      dateIso: '2026-07-01',
      lastCapacity: 'Full',
      capacitySource: 'user',
      filledAt: 'user_reported',
    })
  })

  it('never uses recordedAt as the fill time for user tags', async () => {
    const db = makeDb()
    await applyUserCapacityReport(db, {
      sailingKey: KEY,
      capacity: 'Full',
      recordedAt: 1234567890,
      userUid: 'u1',
    })
    expect(db.docs[DOC].filledAt).toBe('user_reported')
  })

  it('keeps a real numeric filledAt from the user tag', async () => {
    const db = makeDb()
    await applyUserCapacityReport(db, {
      sailingKey: KEY,
      capacity: 'Full',
      filledAt: 1234567890,
      recordedAt: Date.now(),
      userUid: 'u1',
    })
    expect(db.docs[DOC].filledAt).toBe(1234567890)
  })

  it("stores a 'Not Full' tag with no fill time", async () => {
    const db = makeDb()
    await applyUserCapacityReport(db, {
      sailingKey: KEY,
      capacity: 'Not Full',
      recordedAt: Date.now(),
      userUid: 'u1',
    })
    expect(db.docs[DOC]).toMatchObject({ lastCapacity: 'Not Full', capacitySource: 'user' })
    expect(db.docs[DOC].filledAt).toBeUndefined()
  })

  it("does not let a 'Not Full' tag override automated capacity", async () => {
    const db = makeDb({
      [DOC]: { sailingKey: KEY, lastCapacity: 'Full', capacitySource: 'automated' },
    })
    await applyUserCapacityReport(db, {
      sailingKey: KEY,
      capacity: 'Not Full',
      recordedAt: Date.now(),
      userUid: 'u1',
    })
    expect(db.docs[DOC].lastCapacity).toBe('Full')
    expect(db.writes).toHaveLength(0)
  })

  it('stores no filledAt for partial-capacity tags', async () => {
    const db = makeDb()
    await applyUserCapacityReport(db, {
      sailingKey: KEY,
      capacity: '25%',
      recordedAt: Date.now(),
      userUid: 'u1',
    })
    expect(db.docs[DOC]).toMatchObject({ lastCapacity: '25%', capacitySource: 'user' })
    expect(db.docs[DOC].filledAt).toBeUndefined()
  })

  it('does not override automated capacity (automated wins, user fills gaps)', async () => {
    const db = makeDb({
      [DOC]: {
        sailingKey: KEY,
        lastCapacity: '50%',
        capacitySource: 'automated',
      },
    })
    await applyUserCapacityReport(db, {
      sailingKey: KEY,
      capacity: 'Full',
      recordedAt: Date.now(),
      userUid: 'u1',
    })
    expect(db.docs[DOC].lastCapacity).toBe('50%')
    expect(db.docs[DOC].capacitySource).toBe('automated')
    expect(db.docs[DOC].filledAt).toBeUndefined()
    expect(db.writes).toHaveLength(0)
  })

  it('treats legacy capacity without capacitySource as automated', async () => {
    const db = makeDb({
      [DOC]: { sailingKey: KEY, lastCapacity: '50%' },
    })
    await applyUserCapacityReport(db, {
      sailingKey: KEY,
      capacity: 'Full',
      recordedAt: Date.now(),
      userUid: 'u1',
    })
    expect(db.docs[DOC].lastCapacity).toBe('50%')
    expect(db.writes).toHaveLength(0)
  })

  it('lets a repeat user tag replace a previous user tag', async () => {
    const db = makeDb({
      [DOC]: { sailingKey: KEY, lastCapacity: '25%', capacitySource: 'user' },
    })
    await applyUserCapacityReport(db, {
      sailingKey: KEY,
      capacity: 'Full',
      recordedAt: Date.now(),
      userUid: 'u1',
    })
    expect(db.docs[DOC].lastCapacity).toBe('Full')
    expect(db.docs[DOC].capacitySource).toBe('user')
  })

  it('returns true only for today (signals a status refresh)', async () => {
    const db = makeDb()
    const today = nowInVancouver().format('YYYY-MM-DD')
    const report = (dateIso) => ({
      sailingKey: `${dateIso}_10:35_To HSB`,
      capacity: 'Full',
      recordedAt: Date.now(),
      userUid: 'u1',
    })
    expect(await applyUserCapacityReport(db, report('2026-07-01'))).toBe(false)
    expect(await applyUserCapacityReport(db, report(today))).toBe(true)
  })
})

describe('updateSailingStatus capacity precedence', () => {
  it('automated capacity overwrites a user value and flips the source', async () => {
    const db = makeDb({
      [DOC]: {
        sailingKey: KEY,
        lastCapacity: 'Full',
        capacitySource: 'user',
        filledAt: 'user_reported',
      },
    })
    await updateSailingStatus(KEY, '10:35', 'To HSB', '2026-07-01', db, {
      lastCapacity: '30%',
      filledAt: null,
      capacitySource: 'automated',
    })
    expect(db.docs[DOC].lastCapacity).toBe('30%')
    expect(db.docs[DOC].capacitySource).toBe('automated')
  })

  it('defaults capacitySource to automated when omitted', async () => {
    const db = makeDb()
    await updateSailingStatus(KEY, '10:35', 'To HSB', '2026-07-01', db, {
      lastCapacity: '30%',
      filledAt: null,
    })
    expect(db.docs[DOC].capacitySource).toBe('automated')
  })

  it('does not resurrect filledAt from a blocked user tag', async () => {
    const db = makeDb({
      [DOC]: { sailingKey: KEY, lastCapacity: '50%', capacitySource: 'automated' },
    })
    await updateSailingStatus(KEY, '10:35', 'To HSB', '2026-07-01', db, {
      lastCapacity: 'Full',
      filledAt: 'user_reported',
      capacitySource: 'user',
    })
    expect(db.docs[DOC].filledAt).toBeUndefined()
    expect(db.writes).toHaveLength(0)
  })

  it('still records actualDepartureTime when a user capacity is blocked', async () => {
    const db = makeDb({
      [DOC]: { sailingKey: KEY, lastCapacity: '50%', capacitySource: 'automated' },
    })
    await updateSailingStatus(KEY, '10:35', 'To HSB', '2026-07-01', db, {
      lastCapacity: 'Full',
      capacitySource: 'user',
      actualDepartureTime: '10:40',
    })
    expect(db.docs[DOC].lastCapacity).toBe('50%')
    expect(db.docs[DOC].actualDepartureTime).toBe('10:40')
  })
})

// A sailing's recorded departure time is WRITE-ONCE, keyed by its scheduled sailingKey:
// the first actualDepartureTime persisted for a sailing wins, and every later departure
// classification for that same key is ignored (helpers.js:29). This matters for the AIS
// classifier's edge cases (see ais-position.test.js): if a spurious one-poll speed blip
// at the dock is matched to a sailing and recorded first, the real departure that follows
// CANNOT correct it — the value is cemented, not overwritten. These tests pin that so a
// future switch to last-wins/nearest-wins recording (or a debounce upstream) flips here
// visibly.
describe('updateSailingStatus actualDepartureTime is write-once', () => {
  it('records the departure time on a sailing that has none yet', async () => {
    const db = makeDb()
    await updateSailingStatus(KEY, '10:35', 'To HSB', '2026-07-01', db, {
      actualDepartureTime: '10:38',
    })
    expect(db.docs[DOC].actualDepartureTime).toBe('10:38')
  })

  it('fills an empty departure time on an existing doc', async () => {
    const db = makeDb({
      [DOC]: { sailingKey: KEY, lastCapacity: '50%', capacitySource: 'automated' },
    })
    await updateSailingStatus(KEY, '10:35', 'To HSB', '2026-07-01', db, {
      actualDepartureTime: '10:38',
    })
    expect(db.docs[DOC].actualDepartureTime).toBe('10:38')
  })

  it('does NOT overwrite an already-recorded departure time (first wins)', async () => {
    // Simulates the spurious-blip hazard: an earlier (wrong) departure is already stored,
    // then the real, later departure arrives for the same scheduled sailing. Write-once
    // keeps the first value; the correction is dropped and no write is issued.
    const db = makeDb({
      [DOC]: { sailingKey: KEY, actualDepartureTime: '10:31' },
    })
    await updateSailingStatus(KEY, '10:35', 'To HSB', '2026-07-01', db, {
      actualDepartureTime: '10:40',
    })
    expect(db.docs[DOC].actualDepartureTime).toBe('10:31')
    expect(db.writes).toHaveLength(0)
  })
})
