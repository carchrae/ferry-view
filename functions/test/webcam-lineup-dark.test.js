import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Dark-frame gate on the crosswalk classifier (2026-09-05): the community
// cam goes black below civil twilight and the model misreads headlights as a
// queue (26/26 dark detections in the archive were uncorroborated — see
// training-data/experiments/dark-frame-analysis.mjs). captureLineupTimelapse
// must never classify a dark frame: unconditional captures still save the
// frame (taggable, and future night-model training data), classify-first
// probes discard it, and a pending detection can't be confirmed in the dark.

vi.mock('firebase-functions/logger', () => ({
  logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const saved = []
vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      name: 'test-bucket',
      file: (path) => ({
        save: async (buf) => saved.push({ path, size: buf.length }),
        makePublic: async () => {},
      }),
    }),
  }),
}))

const DELETED = '<<delete>>'
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { delete: () => DELETED, arrayUnion: (v) => ({ arrayUnion: v }) },
}))

vi.mock('sharp', () => ({ default: () => ({ metadata: async () => ({ width: 1280 }) }) }))

const classifyLineup = vi.fn()
vi.mock('../lib/lineup-classifier.js', () => ({
  classifyLineup: (...a) => classifyLineup(...a),
  lineupModelVersion: () => 3,
  modelUsable: () => true,
  liveLineupModel: async () => ({ version: 3 }),
}))

// The gate itself is clock-based; the suite controls the clock's answer
// directly so tests don't depend on the real solar calendar at whatever
// date the suite happens to run.
const isDarkAt = vi.fn()
vi.mock('../lib/daylight.js', () => ({
  isDarkAt: (...a) => isDarkAt(...a),
}))

vi.mock('../lib/bowen-sailings-aggregate.js', () => ({
  upsertBowenSailing: vi.fn(async () => {}),
}))

const { captureLineupTimelapse, _resetLineupCheck } = await import('../lib/webcam.js')
const { _resetHealthCache } = await import('../lib/webcam-health.js')
const { timeToDate } = await import('../lib/time.js')

function fakeDb() {
  const docs = { sailingStatus: {}, snapshots: {} }
  return {
    docs,
    seed(key, value) {
      docs.sailingStatus[key] = value
      return this
    },
    collection: (name) => ({
      doc: (id) => ({
        get: async () => ({ exists: docs[name]?.[id] != null, data: () => docs[name]?.[id] }),
        set: async (value) => {
          docs[name] = docs[name] || {}
          docs[name][id] = { ...(docs[name][id] || {}), ...value }
        },
      }),
    }),
  }
}

// Ferry away, last departure 08:40. A 5-min-mark poll at 09:05+ captures
// unconditionally; at 08:50 (inside the 15-min wait gate) it's a
// classify-first probe.
const lineupData = () => ({
  dateIso: '2026-07-13',
  bowenSchedule: [{ time: '10:00' }, { time: '11:15' }],
  recentActivity: [{ action: 'Departed', location: 'Bowen', time: '08:40' }],
  aisLocation: 'transit',
})

const KEY = '2026-07-13_10:00_To HSB'

let frameCounter = 0
function queueLiveFrames() {
  // Every capture sees a fresh picture, so the stale-camera guard never trips.
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => Buffer.from(`frame-${frameCounter++}-${Date.now()}`),
  }))
}

async function lineupAt(db, hhmm) {
  vi.setSystemTime(timeToDate(hhmm).valueOf())
  const p = captureLineupTimelapse(db, lineupData())
  await vi.advanceTimersByTimeAsync(5000)
  return p
}

beforeEach(() => {
  saved.length = 0
  frameCounter = 0
  _resetHealthCache()
  _resetLineupCheck()
  classifyLineup.mockReset()
  isDarkAt.mockReset()
  queueLiveFrames()
  vi.useFakeTimers()
})

afterEach(() => vi.useRealTimers())

describe('dark frames and the crosswalk classifier', () => {
  it('saves an unconditional frame in the dark without classifying it', async () => {
    const db = fakeDb()
    isDarkAt.mockReturnValue(true)

    await lineupAt(db, '09:05')

    expect(saved).toHaveLength(1)
    expect(classifyLineup).not.toHaveBeenCalled()
    const cur = db.docs.sailingStatus[KEY]
    expect(cur.crosswalkAutoPending).toBeUndefined()
    expect(cur.crosswalkFullAtAuto).toBeUndefined()
  })

  it('classifies as usual in daylight (control)', async () => {
    const db = fakeDb()
    isDarkAt.mockReturnValue(false)
    classifyLineup.mockResolvedValue({ probability: 0.9, fullToCrosswalk: true })

    await lineupAt(db, '09:05')

    expect(saved).toHaveLength(1)
    expect(classifyLineup).toHaveBeenCalledTimes(1)
    expect(db.docs.sailingStatus[KEY].crosswalkRobot).toMatchObject({ state: 'checking' })
  })

  it('discards a dark classify-first probe entirely', async () => {
    const db = fakeDb()
    isDarkAt.mockReturnValue(true)

    await lineupAt(db, '08:50')

    expect(saved).toHaveLength(0)
    expect(classifyLineup).not.toHaveBeenCalled()
    expect(db.docs.sailingStatus[KEY]).toBeUndefined()
  })

  it('keeps saving dark probe frames once a detection is sticky', async () => {
    // A sailing confirmed full in daylight keeps its frames through dusk —
    // the sticky save documents the lineup, no verdict needed.
    const db = fakeDb().seed(KEY, { crosswalkFullAtAuto: timeToDate('08:00').valueOf() })
    isDarkAt.mockReturnValue(true)

    await lineupAt(db, '08:50')

    expect(saved).toHaveLength(1)
    expect(classifyLineup).not.toHaveBeenCalled()
  })

  it('never lets a daylight pending confirm off a dark frame', async () => {
    // Dusk falls between the pending frame and the next poll: the dark frame
    // yields no verdict, so the pending is left to go stale rather than
    // confirming a permanent crosswalkFullAtAuto.
    const pendingTs = timeToDate('09:00').valueOf()
    const db = fakeDb().seed(KEY, { crosswalkAutoPending: { ts: pendingTs, prob: 0.9 } })
    isDarkAt.mockReturnValue(true)

    await lineupAt(db, '09:05')

    const cur = db.docs.sailingStatus[KEY]
    expect(cur.crosswalkFullAtAuto).toBeUndefined()
    expect(cur.crosswalkAutoPending).toEqual({ ts: pendingTs, prob: 0.9 })
  })
})

// The robot's 1-minute check photos (crosswalk-robot.js): between the 5-min
// frames, a capture only happens while a call is open, and it is saved.
describe('crosswalk robot check photos', () => {
  const positive = { probability: 0.9, fullToCrosswalk: true }
  const negative = { probability: 0.1, fullToCrosswalk: false }

  it('takes no off-cadence photo without an open call', async () => {
    const db = fakeDb()
    isDarkAt.mockReturnValue(false)
    await lineupAt(db, '09:06')
    expect(saved).toHaveLength(0)
  })

  it('confirms on the next minute instead of the next 5-min frame', async () => {
    const db = fakeDb()
    isDarkAt.mockReturnValue(false)
    classifyLineup.mockResolvedValue(positive)

    const first = await lineupAt(db, '09:05')
    expect(first.robotReported).toBe(true)
    expect(db.docs.sailingStatus[KEY]).toMatchObject({
      crosswalkSource: 'robot',
      crosswalkChecking: true,
    })

    const check = await lineupAt(db, '09:06')
    expect(saved).toHaveLength(2)
    expect(check.robotReported).toBe(true)
    const cur = db.docs.sailingStatus[KEY]
    expect(cur.crosswalkFullAtAuto).toBe(cur.crosswalkFullAt)
    expect(cur.crosswalkChecking).toBe(DELETED)

    // Settled: the next off-cadence minute takes no photo.
    await lineupAt(db, '09:07')
    expect(saved).toHaveLength(2)
  })

  it('takes a second check photo after a miss, then withdraws', async () => {
    const db = fakeDb()
    isDarkAt.mockReturnValue(false)
    classifyLineup.mockResolvedValueOnce(positive)
    await lineupAt(db, '09:05')
    classifyLineup.mockResolvedValue(negative)
    await lineupAt(db, '09:06')
    const last = await lineupAt(db, '09:07')
    expect(saved).toHaveLength(3)
    expect(last.robotReported).toBe(true)
    expect(db.docs.sailingStatus[KEY]).toMatchObject({
      crosswalkFullAt: DELETED,
      crosswalkSource: DELETED,
      crosswalkRobot: DELETED,
    })
    await lineupAt(db, '09:08')
    expect(saved).toHaveLength(3)
  })

  it('saves negative probe frames while a call is open', async () => {
    // 08:50 is inside the classify-first wait gate: a negative probe is
    // normally discarded, but it is evidence against an open call.
    const db = fakeDb().seed(KEY, {
      crosswalkRobot: { state: 'checking', ts: timeToDate('08:49').valueOf(), misses: 0 },
    })
    isDarkAt.mockReturnValue(false)
    classifyLineup.mockResolvedValue(negative)
    await lineupAt(db, '08:50')
    expect(saved).toHaveLength(1)
    expect(db.docs.sailingStatus[KEY].crosswalkRobot).toMatchObject({ misses: 1 })
  })
})
