import { describe, it, expect } from 'vitest'
import { FieldValue } from 'firebase-admin/firestore'
import { applyLineupReport, rederiveCrosswalkAfterDelete } from '../lib/user-lineup.js'

// Minimal in-memory Firestore fake: doc get/set (merge + FieldValue.delete()),
// a lineupReports where('sailingKey','==',…) query for the delete-rederive
// path, and a runTransaction good enough for upsertBowenSailing.
const DELETE_SENTINEL = FieldValue.delete()
const isDelete = (v) => typeof v?.isEqual === 'function' && v.isEqual(DELETE_SENTINEL)

function makeDb({ docs: initialDocs = {}, lineupReports = [] } = {}) {
  const docs = { ...initialDocs }

  function docRef(key) {
    return {
      async get() {
        const data = docs[key]
        return { exists: data !== undefined, data: () => data }
      },
      async set(payload, opts) {
        const base = opts?.merge ? { ...(docs[key] || {}) } : {}
        for (const [k, v] of Object.entries(payload)) {
          if (isDelete(v)) delete base[k]
          else base[k] = v
        }
        docs[key] = base
      },
    }
  }

  return {
    docs,
    lineupReports,
    collection(name) {
      return {
        doc: (id) => docRef(`${name}/${id}`),
        where(field, op, value) {
          return {
            async get() {
              const matches = name === 'lineupReports' ? lineupReports.filter((r) => r[field] === value) : []
              return { docs: matches.map((r) => ({ data: () => r })) }
            },
          }
        },
      }
    },
    async runTransaction(fn) {
      await fn({
        get: async (ref) => ref.get(),
        set: (ref, payload) => {
          // Transaction sets in upsertBowenSailing are full overwrites.
          ref.set(payload)
        },
      })
    },
  }
}

const KEY = '2026-07-01_10:35_To HSB'
const DOC = `sailingStatus/${KEY}`
const AGG = 'aggregates/bowenSailings'

// A seeded aggregate covering the sailing, with a standing cw claim.
const aggWith = (rec) => ({
  start: '2026-06-01',
  end: '2026-07-02',
  sailings: [{ d: '2026-07-01', t: '10:35', ...rec }],
})

const aggRec = (db) => db.docs[AGG].sailings.find((r) => r.d === '2026-07-01' && r.t === '10:35')

describe('applyLineupReport', () => {
  it('ignores invalid reports (no author / no mark and no refute)', async () => {
    const db = makeDb()
    expect(await applyLineupReport(db, undefined)).toBe(false)
    expect(await applyLineupReport(db, { sailingKey: KEY, crosswalkAt: 111 })).toBe(false)
    expect(await applyLineupReport(db, { sailingKey: KEY, userUid: 'u1' })).toBe(false)
    expect(await applyLineupReport(db, { sailingKey: 'garbage', userUid: 'u1', crosswalkAt: 1 })).toBe(false)
    expect(Object.keys(db.docs)).toHaveLength(0)
  })

  it('stamps a positive mark as the user claim and clears the refute guard', async () => {
    const db = makeDb({
      docs: { [DOC]: { crosswalkNotYetAt: 500 }, [AGG]: aggWith({}) },
    })
    await applyLineupReport(db, { sailingKey: KEY, crosswalkAt: 1000, recordedAt: 2000, userUid: 'u1' })
    expect(db.docs[DOC]).toMatchObject({
      sailingKey: KEY,
      sailingTime: '10:35',
      direction: 'To HSB',
      dateIso: '2026-07-01',
      crosswalkFullAt: 1000,
      crosswalkSource: 'user',
    })
    expect(db.docs[DOC]).not.toHaveProperty('crosswalkNotYetAt')
    expect(aggRec(db)).toMatchObject({ cw: 1000 })
    expect(aggRec(db)).not.toHaveProperty('cws')
  })

  it('refute clears the claim, arms the guard, and keeps the robot auto verdict', async () => {
    const db = makeDb({
      docs: {
        [DOC]: { crosswalkFullAt: 1000, crosswalkSource: 'robot', crosswalkFullAtAuto: 1000 },
        [AGG]: aggWith({ cw: 1000, cws: 'robot' }),
      },
    })
    await applyLineupReport(db, {
      sailingKey: KEY,
      crosswalkAt: null,
      notYet: true,
      recordedAt: 3000,
      userUid: 'u1',
    })
    expect(db.docs[DOC]).not.toHaveProperty('crosswalkFullAt')
    expect(db.docs[DOC]).not.toHaveProperty('crosswalkSource')
    expect(db.docs[DOC]).toMatchObject({ crosswalkNotYetAt: 3000, crosswalkFullAtAuto: 1000 })
    expect(aggRec(db)).not.toHaveProperty('cw')
    expect(aggRec(db)).not.toHaveProperty('cws')
  })

  it('a positive mark after a refute restores the claim', async () => {
    const db = makeDb({ docs: { [AGG]: aggWith({}) } })
    await applyLineupReport(db, { sailingKey: KEY, crosswalkAt: null, notYet: true, recordedAt: 3000, userUid: 'u1' })
    await applyLineupReport(db, { sailingKey: KEY, crosswalkAt: 4000, recordedAt: 5000, userUid: 'u2' })
    expect(db.docs[DOC]).toMatchObject({ crosswalkFullAt: 4000, crosswalkSource: 'user' })
    expect(db.docs[DOC]).not.toHaveProperty('crosswalkNotYetAt')
  })
})

describe('rederiveCrosswalkAfterDelete', () => {
  it('latest remaining positive mark wins and clears the guard', async () => {
    const db = makeDb({
      docs: { [DOC]: { crosswalkNotYetAt: 9000 }, [AGG]: aggWith({}) },
      lineupReports: [
        { sailingKey: KEY, crosswalkAt: 1000, recordedAt: 1000, userUid: 'u1' },
        { sailingKey: KEY, crosswalkAt: 2000, recordedAt: 2000, userUid: 'u2' },
      ],
    })
    await rederiveCrosswalkAfterDelete(db, KEY)
    expect(db.docs[DOC]).toMatchObject({ crosswalkFullAt: 2000, crosswalkSource: 'user' })
    expect(db.docs[DOC]).not.toHaveProperty('crosswalkNotYetAt')
    expect(aggRec(db)).toMatchObject({ cw: 2000 })
  })

  it('a remaining refute keeps the claim cleared — NO robot fallback', async () => {
    const db = makeDb({
      docs: {
        [DOC]: { crosswalkFullAtAuto: 1000 },
        [AGG]: aggWith({ cw: 1000, cws: 'robot' }),
      },
      lineupReports: [
        { sailingKey: KEY, crosswalkAt: 500, recordedAt: 500, userUid: 'u1' },
        { sailingKey: KEY, crosswalkAt: null, notYet: true, recordedAt: 3000, userUid: 'u2' },
      ],
    })
    await rederiveCrosswalkAfterDelete(db, KEY)
    expect(db.docs[DOC]).not.toHaveProperty('crosswalkFullAt')
    expect(db.docs[DOC]).not.toHaveProperty('crosswalkSource')
    expect(db.docs[DOC]).toMatchObject({ crosswalkNotYetAt: 3000 })
    expect(aggRec(db)).not.toHaveProperty('cw')
  })

  it('with no reports left the robot auto verdict returns as the claim', async () => {
    const db = makeDb({
      docs: {
        [DOC]: { crosswalkFullAtAuto: 1000, crosswalkNotYetAt: 3000 },
        [AGG]: aggWith({}),
      },
    })
    await rederiveCrosswalkAfterDelete(db, KEY)
    expect(db.docs[DOC]).toMatchObject({ crosswalkFullAt: 1000, crosswalkSource: 'robot' })
    expect(db.docs[DOC]).not.toHaveProperty('crosswalkNotYetAt')
    expect(aggRec(db)).toMatchObject({ cw: 1000, cws: 'robot' })
  })

  it('with no reports and no auto verdict everything clears', async () => {
    const db = makeDb({
      docs: {
        [DOC]: { crosswalkFullAt: 500, crosswalkSource: 'user', crosswalkNotYetAt: 400 },
        [AGG]: aggWith({ cw: 500 }),
      },
    })
    await rederiveCrosswalkAfterDelete(db, KEY)
    expect(db.docs[DOC]).not.toHaveProperty('crosswalkFullAt')
    expect(db.docs[DOC]).not.toHaveProperty('crosswalkSource')
    expect(db.docs[DOC]).not.toHaveProperty('crosswalkNotYetAt')
    expect(aggRec(db)).not.toHaveProperty('cw')
  })
})
