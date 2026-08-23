import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  recordFrame,
  frameHash,
  staleSkipMessage,
  _resetHealthCache,
  STALE_IDENTICAL_FRAMES,
  CONCLUSIVE_GAP_MS,
  HEARTBEAT_MS,
  CAMERA_BOWEN,
  CAMERA_COMMUNITY,
} from '../lib/webcam-health.js'

vi.mock('firebase-functions/logger', () => ({
  logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Minimal Firestore stand-in: one doc, merge-set, and a record of every write
// so the "publishes only on transitions" cost claim is actually tested.
function fakeDb(initial = null) {
  const state = { doc: initial, writes: [] }
  const ref = {
    get: async () => ({ exists: state.doc != null, data: () => state.doc }),
    set: async (value) => {
      state.writes.push(value)
      state.doc = { ...(state.doc || {}), ...value }
    },
  }
  return { state, collection: () => ({ doc: () => ref }) }
}

const frame = (s) => Buffer.from(s)
const T0 = 1_700_000_000_000
const MIN = 60_000

describe('recordFrame', () => {
  beforeEach(() => _resetHealthCache())

  it('treats a changing frame as healthy', async () => {
    const db = fakeDb()
    expect((await recordFrame(db, CAMERA_BOWEN, frame('a'), T0)).stale).toBe(false)
    expect((await recordFrame(db, CAMERA_BOWEN, frame('b'), T0 + MIN)).stale).toBe(false)
    expect(db.state.writes).toHaveLength(0)
  })

  it('tolerates one duplicate at the 1-per-minute cadence', async () => {
    // Capture and refresh both run about once a minute, so sampling can land
    // twice inside a single refresh. Twice is bad luck, not a fault.
    const db = fakeDb()
    await recordFrame(db, CAMERA_BOWEN, frame('a'), T0)
    const r = await recordFrame(db, CAMERA_BOWEN, frame('a'), T0 + MIN)
    expect(r.stale).toBe(false)
    expect(r.identicalRun).toBe(2)
  })

  it('flags the third identical frame at the 1-per-minute cadence', async () => {
    const db = fakeDb()
    await recordFrame(db, CAMERA_BOWEN, frame('a'), T0)
    await recordFrame(db, CAMERA_BOWEN, frame('a'), T0 + MIN)
    const r = await recordFrame(db, CAMERA_BOWEN, frame('a'), T0 + 2 * MIN)
    expect(STALE_IDENTICAL_FRAMES).toBe(3)
    expect(r.stale).toBe(true)
    expect(r.justBroke).toBe(true)
    // lastChangeAt is when the picture last moved, not when we noticed.
    expect(r.lastChangeAt).toBe(T0)
    expect(r.staleSince).toBe(T0 + 2 * MIN)
  })

  it('needs only two identical frames once they straddle a refresh', async () => {
    // The lineup camera is sampled every 5 minutes against a camera that
    // refreshes every minute, so a single repeat there is already conclusive
    // — waiting for a third would cost another five minutes for nothing.
    const db = fakeDb()
    await recordFrame(db, CAMERA_COMMUNITY, frame('frozen'), T0)
    const r = await recordFrame(db, CAMERA_COMMUNITY, frame('frozen'), T0 + 5 * MIN)
    expect(CONCLUSIVE_GAP_MS).toBeLessThan(5 * MIN)
    expect(r.stale).toBe(true)
    expect(r.identicalRun).toBe(2)
  })

  it('flags a repeat seen after a long idle gap', async () => {
    // Overnight, or after a poll outage: if the first frame back matches the
    // last one from hours ago, the camera has been frozen the whole time.
    const db = fakeDb()
    await recordFrame(db, CAMERA_COMMUNITY, frame('a'), T0)
    const r = await recordFrame(db, CAMERA_COMMUNITY, frame('a'), T0 + 8 * 60 * MIN)
    expect(r.stale).toBe(true)
  })

  it('clears staleness the moment a fresh frame arrives', async () => {
    const db = fakeDb()
    await recordFrame(db, CAMERA_COMMUNITY, frame('a'), T0)
    expect((await recordFrame(db, CAMERA_COMMUNITY, frame('a'), T0 + 5 * MIN)).stale).toBe(true)
    const r = await recordFrame(db, CAMERA_COMMUNITY, frame('b'), T0 + 6 * MIN)
    expect(r.stale).toBe(false)
    expect(r.identicalRun).toBe(1)
    expect(r.justRecovered).toBe(true)
  })

  it('publishes only on transitions and heartbeats, not every frame', async () => {
    const db = fakeDb()
    await recordFrame(db, CAMERA_BOWEN, frame('x'), T0)
    await recordFrame(db, CAMERA_BOWEN, frame('x'), T0 + MIN)
    await recordFrame(db, CAMERA_BOWEN, frame('x'), T0 + 2 * MIN)
    expect(db.state.writes).toHaveLength(1) // the break
    expect(db.state.writes[0][CAMERA_BOWEN].stale).toBe(true)

    // Still broken, well inside the heartbeat window → no further writes.
    await recordFrame(db, CAMERA_BOWEN, frame('x'), T0 + 3 * MIN)
    expect(db.state.writes).toHaveLength(1)

    // Heartbeat due → one more write, so the client can tell "still being
    // checked" from a doc abandoned by a dead poll.
    await recordFrame(db, CAMERA_BOWEN, frame('x'), T0 + 2 * MIN + HEARTBEAT_MS)
    expect(db.state.writes).toHaveLength(2)

    // Recovery publishes immediately.
    const rec = await recordFrame(db, CAMERA_BOWEN, frame('y'), T0 + 3 * MIN + HEARTBEAT_MS)
    expect(rec.justRecovered).toBe(true)
    expect(db.state.writes).toHaveLength(3)
    expect(db.state.writes[2][CAMERA_BOWEN].stale).toBe(false)
  })

  it('tracks the two cameras independently', async () => {
    const db = fakeDb()
    for (const t of [0, MIN, 2 * MIN]) {
      await recordFrame(db, CAMERA_COMMUNITY, frame('frozen'), T0 + t)
      await recordFrame(db, CAMERA_BOWEN, frame(`live-${t}`), T0 + t)
    }
    expect(db.state.doc[CAMERA_COMMUNITY].stale).toBe(true)
    expect(db.state.doc[CAMERA_BOWEN]).toBeUndefined() // healthy → never published
  })

  it('resumes detection from the published doc after a cold start', async () => {
    // Function instances recycle; the in-memory mirror does not survive that,
    // so the hash has to come back from Firestore or a restart would treat
    // the first frame back as a change.
    const db = fakeDb({
      [CAMERA_BOWEN]: {
        hash: frameHash(frame('frozen')),
        lastChangeAt: T0,
        lastFrameAt: T0 + MIN,
        identicalRun: 2,
        stale: false,
        staleSince: null,
      },
    })
    const r = await recordFrame(db, CAMERA_BOWEN, frame('frozen'), T0 + 2 * MIN)
    expect(r.stale).toBe(true)
    expect(r.lastChangeAt).toBe(T0)
  })

  it('publishes enough state to survive a restart mid-outage', async () => {
    // Without hash/run on the doc, the first frame after a cold start looks
    // like a change: a false "recovered" that clears the rider-facing banner
    // on a camera that never came back.
    const db = fakeDb()
    await recordFrame(db, CAMERA_BOWEN, frame('frozen'), T0)
    await recordFrame(db, CAMERA_BOWEN, frame('frozen'), T0 + MIN)
    await recordFrame(db, CAMERA_BOWEN, frame('frozen'), T0 + 2 * MIN)

    _resetHealthCache()
    const r = await recordFrame(db, CAMERA_BOWEN, frame('frozen'), T0 + 3 * MIN)
    expect(r.stale).toBe(true)
    expect(r.justRecovered).toBe(false)
    expect(r.lastChangeAt).toBe(T0)
  })

  it('survives an unreadable health doc', async () => {
    const db = {
      collection: () => ({
        doc: () => ({
          get: async () => {
            throw new Error('permission denied')
          },
          set: async () => {},
        }),
      }),
    }
    expect((await recordFrame(db, CAMERA_BOWEN, frame('a'), T0)).stale).toBe(false)
  })
})

describe('staleSkipMessage', () => {
  it('reports how long the camera has been frozen', () => {
    const msg = staleSkipMessage(
      'Lineup timelapse',
      CAMERA_COMMUNITY,
      { lastChangeAt: T0 },
      T0 + 20 * MIN,
    )
    expect(msg).toContain('Lineup timelapse skipped')
    expect(msg).toContain('Bowen Community Centre')
    expect(msg).toContain('20m')
  })
})
