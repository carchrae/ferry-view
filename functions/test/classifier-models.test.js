import { describe, it, expect, beforeEach } from 'vitest'
import {
  ensureClassifierModelDocs,
  resetClassifierModelSync,
  liveModel,
  resetLiveModelCache,
  LIVE_TTL_MS,
} from '../lib/classifier-models.js'

// The lib reads the real bundled model JSONs (functions/models/*.json), which
// are committed with version >= 1 — so the sync should target one versioned
// doc per model. Fake db mirrors the get/set surface used.
function makeDb(existingKeys = []) {
  const writes = []
  const reads = []
  return {
    writes,
    reads,
    collection(name) {
      return {
        doc(id) {
          const key = `${name}/${id}`
          return {
            async get() {
              reads.push(key)
              return { exists: existingKeys.includes(key) }
            },
            async set(payload) {
              writes.push({ key, payload })
            },
          }
        },
      }
    },
  }
}

beforeEach(() => {
  resetClassifierModelSync()
  resetLiveModelCache()
})

// A db whose docs hold data: { 'classifierModels/live': {...}, ... }.
function makeDataDb(docs) {
  const reads = []
  return {
    reads,
    collection(name) {
      return {
        doc(id) {
          const key = `${name}/${id}`
          return {
            async get() {
              reads.push(key)
              const data = docs[key]
              return { exists: data !== undefined, data: () => data }
            },
          }
        },
      }
    },
  }
}

describe('liveModel', () => {
  const bundled = { version: 5, weights: [1], featureSet: 'a' }
  const usable = (m) => m.featureSet === 'a'

  it('returns the bundled model when there is no live pointer', async () => {
    const db = makeDataDb({})
    expect(await liveModel(db, 'terminal-cars', bundled, usable)).toBe(bundled)
  })

  it('returns the pointed-to version when this build can use it', async () => {
    const v7 = { version: 7, weights: [2], featureSet: 'a' }
    const db = makeDataDb({
      'classifierModels/live': { 'terminal-cars': { version: 7 } },
      'classifierModels/terminal-cars-v7': v7,
    })
    expect(await liveModel(db, 'terminal-cars', bundled, usable)).toEqual(v7)
  })

  it('falls back to the bundled model when the live version is unusable or missing', async () => {
    const other = { version: 8, weights: [2], featureSet: 'b' }
    const db = makeDataDb({
      'classifierModels/live': { 'terminal-cars': { version: 8 }, lineup: { version: 9 } },
      'classifierModels/terminal-cars-v8': other,
    })
    expect(await liveModel(db, 'terminal-cars', bundled, usable)).toBe(bundled)
    expect(await liveModel(db, 'lineup', bundled, usable)).toBe(bundled)
  })

  it('reads the pointer at most once per TTL and each version once', async () => {
    const v7 = { version: 7, weights: [2], featureSet: 'a' }
    const db = makeDataDb({
      'classifierModels/live': { 'terminal-cars': { version: 7 } },
      'classifierModels/terminal-cars-v7': v7,
    })
    const t0 = 1_000_000
    await liveModel(db, 'terminal-cars', bundled, usable, t0)
    await liveModel(db, 'terminal-cars', bundled, usable, t0 + 1000)
    expect(db.reads).toEqual(['classifierModels/live', 'classifierModels/terminal-cars-v7'])
    await liveModel(db, 'terminal-cars', bundled, usable, t0 + LIVE_TTL_MS + 1)
    expect(db.reads).toEqual(['classifierModels/live', 'classifierModels/terminal-cars-v7', 'classifierModels/live'])
  })

  it('survives a Firestore error by using the bundled model', async () => {
    const db = { collection: () => ({ doc: () => ({ get: async () => { throw new Error('offline') } }) }) }
    expect(await liveModel(db, 'lineup', bundled, usable)).toBe(bundled)
  })
})

describe('ensureClassifierModelDocs', () => {
  it('writes one versioned doc per bundled model when missing', async () => {
    const db = makeDb()
    await ensureClassifierModelDocs(db)
    const keys = db.writes.map((w) => w.key).sort()
    expect(keys.some((k) => /^classifierModels\/lineup-v\d+$/.test(k))).toBe(true)
    expect(keys.some((k) => /^classifierModels\/terminal-cars-v\d+$/.test(k))).toBe(true)
    for (const { key, payload } of db.writes) {
      expect(key).toBe(`classifierModels/${payload.name}-v${payload.version}`)
      expect(payload.version).toBeGreaterThanOrEqual(1)
      expect(payload.trainedAt).toBeTruthy()
      expect(Array.isArray(payload.weights)).toBe(true)
      expect(payload.syncedAt).toBeTypeOf('number')
    }
  })

  it('skips models whose versioned doc already exists (immutable versions)', async () => {
    const probe = makeDb()
    await ensureClassifierModelDocs(probe)
    const existing = probe.writes.map((w) => w.key)

    const db = makeDb(existing)
    await ensureClassifierModelDocs(db)
    expect(db.writes).toHaveLength(0)
  })

  it('is memoized per cold start — a second call does no reads', async () => {
    const db = makeDb()
    await ensureClassifierModelDocs(db)
    const readsAfterFirst = db.reads.length
    await ensureClassifierModelDocs(db)
    expect(db.reads.length).toBe(readsAfterFirst)
  })
})
