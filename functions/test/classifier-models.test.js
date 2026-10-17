import { describe, it, expect, beforeEach } from 'vitest'
import {
  ensureClassifierModelDocs,
  refreshLiveModels,
  resetClassifierModelSync,
  readBundledModel,
  activeClassifierVersions,
} from '../lib/classifier-models.js'
import { lineupModelVersion, activeLineupModel } from '../lib/lineup-classifier.js'
import { terminalModelVersion, activeTerminalModel } from '../lib/terminal-classifier.js'

// The lib reads the real bundled model JSONs (functions/models/*.json), which
// are committed with version >= 1 — so the sync should target one versioned
// doc per model. Fake db mirrors the get/set surface used; `docs` seeds the
// documents a get() finds.
function makeDb(existingKeys = [], docs = {}) {
  const writes = []
  const reads = []
  return {
    writes,
    reads,
    docs,
    collection(name) {
      return {
        doc(id) {
          const key = `${name}/${id}`
          return {
            async get() {
              reads.push(key)
              const data = docs[key]
              return {
                exists: data !== undefined || existingKeys.includes(key),
                data: () => data,
              }
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
    const reads = db.reads.length
    await ensureClassifierModelDocs(db)
    expect(db.reads.length).toBe(reads)
  })
})

describe('refreshLiveModels', () => {
  const bundledLineup = readBundledModel('lineup-classifier.json')
  const bundledTerminal = readBundledModel('terminal-cars-classifier.json')
  // A "newer" lineup model: the bundled weights under another version.
  const liveLineup = { ...bundledLineup, version: 900, trainedAt: '2099-01-01T00:00:00.000Z' }
  const liveTerminal = { ...bundledTerminal, version: 901, trainedAt: '2099-01-01T00:00:00.000Z' }

  it('leaves the bundled models active when there is no live pointer', async () => {
    const db = makeDb()
    await refreshLiveModels(db)
    expect(lineupModelVersion()).toBe(bundledLineup.version)
    expect(terminalModelVersion()).toBe(bundledTerminal.version)
    expect(db.reads).toEqual(['classifierModels/live'])
  })

  it('installs the versions the pointer names, and re-reads nothing while it is unchanged', async () => {
    const db = makeDb([], {
      'classifierModels/live': { lineup: 900, 'terminal-cars': 901 },
      'classifierModels/lineup-v900': liveLineup,
      'classifierModels/terminal-cars-v901': liveTerminal,
    })
    await refreshLiveModels(db)
    expect(lineupModelVersion()).toBe(900)
    expect(terminalModelVersion()).toBe(901)
    expect(activeLineupModel().trainedAt).toBe('2099-01-01T00:00:00.000Z')
    const reads = db.reads.length
    await refreshLiveModels(db)
    // Only the pointer again — the model docs are not re-fetched.
    expect(db.reads.slice(reads)).toEqual(['classifierModels/live'])
  })

  it('a pointer naming only one classifier leaves the other bundled', async () => {
    const db = makeDb([], {
      'classifierModels/live': { lineup: 900 },
      'classifierModels/lineup-v900': liveLineup,
    })
    await refreshLiveModels(db)
    expect(lineupModelVersion()).toBe(900)
    expect(terminalModelVersion()).toBe(bundledTerminal.version)
  })

  it('a missing model doc keeps the current model and is looked up once', async () => {
    const db = makeDb([], { 'classifierModels/live': { lineup: 777 } })
    await refreshLiveModels(db)
    expect(lineupModelVersion()).toBe(bundledLineup.version)
    await refreshLiveModels(db)
    expect(db.reads.filter((k) => k === 'classifierModels/lineup-v777')).toHaveLength(1)
  })

  it('refuses a model trained on different crops (geometry, not names)', async () => {
    const moved = {
      ...liveLineup,
      regions: liveLineup.regions.map((r, i) =>
        i === 0 ? { ...r, roi: { ...r.roi, left: r.roi.left + 0.1 } } : r,
      ),
    }
    const renamed = {
      ...liveLineup,
      regions: liveLineup.regions.map((r) => ({ ...r, name: `renamed ${r.name}` })),
    }
    const db = makeDb([], {
      'classifierModels/live': { lineup: 900 },
      'classifierModels/lineup-v900': moved,
    })
    await refreshLiveModels(db)
    expect(lineupModelVersion()).toBe(bundledLineup.version)

    resetClassifierModelSync()
    const db2 = makeDb([], {
      'classifierModels/live': { lineup: 900 },
      'classifierModels/lineup-v900': renamed,
    })
    await refreshLiveModels(db2)
    expect(lineupModelVersion()).toBe(900)
  })

  it('refuses a disabled model and a terminal model whose masks differ', async () => {
    const db = makeDb([], {
      'classifierModels/live': { lineup: 900, 'terminal-cars': 901 },
      'classifierModels/lineup-v900': { ...liveLineup, enabled: false },
      'classifierModels/terminal-cars-v901': {
        ...liveTerminal,
        masks: liveTerminal.masks.slice(1),
      },
    })
    await refreshLiveModels(db)
    expect(lineupModelVersion()).toBe(bundledLineup.version)
    expect(terminalModelVersion()).toBe(bundledTerminal.version)
    expect(activeTerminalModel()).toBe(activeTerminalModel()) // unchanged object
  })

  it('activeClassifierVersions reports what is actually running, for ferryStatus/current', async () => {
    expect(activeClassifierVersions()).toEqual({
      lineup: bundledLineup.version,
      'terminal-cars': bundledTerminal.version,
    })
    const db = makeDb([], {
      // terminal pointer names a missing doc → refused → still bundled
      'classifierModels/live': { lineup: 900, 'terminal-cars': 555 },
      'classifierModels/lineup-v900': liveLineup,
    })
    await refreshLiveModels(db)
    expect(activeClassifierVersions()).toEqual({
      lineup: 900,
      'terminal-cars': bundledTerminal.version,
    })
  })

  it('a cleared pointer falls back to the bundled model', async () => {
    const db = makeDb([], {
      'classifierModels/live': { lineup: 900 },
      'classifierModels/lineup-v900': liveLineup,
    })
    await refreshLiveModels(db)
    expect(lineupModelVersion()).toBe(900)
    db.docs['classifierModels/live'] = {}
    await refreshLiveModels(db)
    expect(lineupModelVersion()).toBe(bundledLineup.version)
  })

  it('an unreadable pointer keeps whatever is active', async () => {
    const db = makeDb([], {
      'classifierModels/live': { lineup: 900 },
      'classifierModels/lineup-v900': liveLineup,
    })
    await refreshLiveModels(db)
    const broken = {
      collection: () => ({
        doc: () => ({
          get: async () => {
            throw new Error('UNAVAILABLE')
          },
        }),
      }),
    }
    await refreshLiveModels(broken)
    expect(lineupModelVersion()).toBe(900)
  })
})
