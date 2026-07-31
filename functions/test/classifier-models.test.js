import { describe, it, expect, beforeEach } from 'vitest'
import {
  ensureClassifierModelDocs,
  resetClassifierModelSync,
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

beforeEach(() => resetClassifierModelSync())

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
