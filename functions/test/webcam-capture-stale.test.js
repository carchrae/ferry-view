import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// The capture functions are I/O-heavy (Storage, sharp, fetch, classifiers),
// which is why they had no tests. These stubs cover just enough to pin the
// stalled-camera behaviour: while a camera is frozen nothing is uploaded and
// nothing is classified, and frames either side of an outage never confirm
// each other.

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

const classifyTerminal = vi.fn()
vi.mock('../lib/terminal-classifier.js', () => ({
  classifyTerminal: (...a) => classifyTerminal(...a),
  terminalModelVersion: () => 5,
}))

const classifyLineup = vi.fn()
vi.mock('../lib/lineup-classifier.js', () => ({
  classifyLineup: (...a) => classifyLineup(...a),
  lineupModelVersion: () => 3,
  modelUsable: () => true,
}))

vi.mock('../lib/bowen-sailings-aggregate.js', () => ({
  upsertBowenSailing: vi.fn(async () => {}),
}))

vi.mock('../lib/helpers.js', () => ({
  updateSailingStatus: vi.fn(async () => ({ capacityApplied: true })),
}))

const { captureDepartureTimelapse, captureLineupTimelapse } = await import('../lib/webcam.js')
const { _resetHealthCache, STALE_IDENTICAL_FRAMES } = await import('../lib/webcam-health.js')
const { timeToDate } = await import('../lib/time.js')

// sailingStatus docs plus the webcamHealth singleton, in one fake db.
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

// A poll snapshot the departure timelapse acts on: ferry docked at Bowen, the
// 10:00 sailing not yet departed.
const pollData = () => ({
  dateIso: '2026-07-13',
  bowenSchedule: [{ time: '10:00' }, { time: '11:15' }],
  aisLocation: 'Bowen',
  aisLocationSince: timeToDate('06:00').valueOf(),
})

// A poll snapshot the lineup timelapse acts on: ferry away, last departure
// long enough ago that the wait gate has opened.
const lineupData = () => ({
  dateIso: '2026-07-13',
  bowenSchedule: [{ time: '10:00' }, { time: '11:15' }],
  recentActivity: [{ action: 'Departed', location: 'Bowen', time: '08:40' }],
  aisLocation: 'transit',
})

const KEY = '2026-07-13_10:00_To HSB'

// One queued body per CAPTURE, not per fetch: captureSamples takes 3 samples a
// second apart and a real camera holds its frame across them, which is what
// lets pickBestFrame find a 2-of-3 match. A "frozen" camera is then just a
// single body queued for every capture.
const SAMPLE_COUNT = 3

function queueFrames(...bodies) {
  const queue = [...bodies]
  let served = 0
  global.fetch = vi.fn(async () => {
    const body = queue[0]
    if (++served >= SAMPLE_COUNT && queue.length > 1) {
      queue.shift()
      served = 0
    }
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(body) }
  })
}

// captureSamples sleeps between its 3 samples; under fake timers those sleeps
// only resolve if the clock is driven while the capture is in flight.
async function runCapture(fn, db, hhmm, data) {
  vi.setSystemTime(timeToDate(hhmm).valueOf())
  const p = fn(db, data)
  await vi.advanceTimersByTimeAsync(5000)
  return p
}

const captureAt = (db, hhmm, data = pollData()) =>
  runCapture(captureDepartureTimelapse, db, hhmm, data)

const lineupAt = (db, hhmm, data = lineupData()) =>
  runCapture(captureLineupTimelapse, db, hhmm, data)

// Every minute from 09:52 to 10:05 — the departure timelapse's real cadence.
const MINUTE_MARKS = [
  ...Array.from({ length: 8 }, (_, i) => `09:${52 + i}`),
  ...Array.from({ length: 6 }, (_, i) => `10:0${i}`),
]

beforeEach(() => {
  saved.length = 0
  _resetHealthCache()
  classifyTerminal.mockReset()
  classifyLineup.mockReset()
  vi.useFakeTimers()
})

afterEach(() => vi.useRealTimers())

describe('capture with a stalled camera', () => {
  it('stops uploading and classifying once the terminal cam freezes', async () => {
    const db = fakeDb()
    queueFrames('frozen-frame')
    classifyTerminal.mockResolvedValue({ carsPresent: false, probability: 0.1 })

    for (const t of MINUTE_MARKS) await captureAt(db, t)

    // At this cadence two identical frames can be bad luck, so the first two
    // are captured normally and everything from the third on is not — 14
    // polls, 2 frames.
    expect(saved).toHaveLength(STALE_IDENTICAL_FRAMES - 1)
    // No frozen frame was ever handed to the classifier.
    expect(classifyTerminal).toHaveBeenCalledTimes(saved.length)
  })

  it('keeps capturing and classifying while the camera is healthy', async () => {
    const db = fakeDb()
    queueFrames(...MINUTE_MARKS.map((t) => `frame-${t}`))
    classifyTerminal.mockResolvedValue({ carsPresent: true, probability: 0.9 })

    for (const t of MINUTE_MARKS) await captureAt(db, t)

    expect(saved).toHaveLength(MINUTE_MARKS.length)
    expect(classifyTerminal).toHaveBeenCalledTimes(MINUTE_MARKS.length)
  })

  it('resumes as soon as the camera comes back', async () => {
    const db = fakeDb()
    queueFrames('frozen-frame')
    classifyTerminal.mockResolvedValue({ carsPresent: false, probability: 0.1 })
    for (const t of MINUTE_MARKS) await captureAt(db, t)
    const duringOutage = saved.length

    queueFrames('a-new-picture')
    await captureAt(db, '10:06')
    expect(saved.length).toBe(duringOutage + 1)
  })

  it('skips the lineup frame and its crosswalk verdict while the community cam is frozen', async () => {
    // The crosswalk verdict is the dangerous one: crosswalkFullAtAuto is
    // permanent and sticky, so a single detection off a frozen picture would
    // pin a wrong "full to crosswalk" time on the sailing for good.
    const db = fakeDb()
    queueFrames('frozen-lineup')
    classifyLineup.mockResolvedValue({ probability: 0.99, fullToCrosswalk: true })

    for (const t of ['09:05', '09:10', '09:15', '09:20', '09:25', '09:30', '09:35']) {
      await lineupAt(db, t)
    }

    // These captures are 5 minutes apart against a camera that refreshes
    // every minute, so the very first repeat is already conclusive: one frame
    // saved, one classifier call, and nothing after that.
    expect(saved).toHaveLength(1)
    expect(classifyLineup).toHaveBeenCalledTimes(1)
  })

  it('publishes the outage for the client to warn about', async () => {
    const db = fakeDb()
    queueFrames('frozen-frame')
    classifyTerminal.mockResolvedValue({ carsPresent: false, probability: 0.1 })

    for (const t of MINUTE_MARKS) await captureAt(db, t)

    const health = db.docs.snapshots.webcamHealth
    expect(health.bowen.stale).toBe(true)
    expect(health.bowen.label).toBe('Bowen terminal')
    // The last time the picture actually moved — the first frame of the run,
    // not the moment we noticed. (Offset by the inter-sample delay.)
    expect(health.bowen.lastChangeAt - timeToDate('09:52').valueOf()).toBeLessThan(60_000)
    expect(health.bowen.staleSince).toBeGreaterThan(health.bowen.lastChangeAt)
  })
})

describe('capture-gap consecutiveness', () => {
  it('does not let a pending from before an outage confirm after it', async () => {
    // An empty frame parked as terminalEmptyPending, then the camera dies for
    // 20 minutes. The first frame back is empty too — but they are not
    // consecutive observations, so they must not confirm "everyone got on".
    const db = fakeDb().seed(KEY, {
      terminalCarsSeen: true,
      terminalEmptyPending: { ts: timeToDate('09:35').valueOf() },
      terminalLastFrameTs: timeToDate('09:35').valueOf(),
    })
    queueFrames('fresh-frame')
    classifyTerminal.mockResolvedValue({ carsPresent: false, probability: 0.05 })

    await captureAt(db, '09:55')

    const cur = db.docs.sailingStatus[KEY]
    expect(cur.ferryNotFullAuto).toBeUndefined()
    expect(cur.terminalEmptyFrameTs).toBeUndefined()
    // It starts a fresh run instead of leaving the sailing with no pending.
    expect(cur.terminalEmptyPending.ts).toBeGreaterThanOrEqual(timeToDate('09:55').valueOf())
  })

  it('still confirms across a normal one-minute cadence', async () => {
    const db = fakeDb().seed(KEY, {
      terminalCarsSeen: true,
      terminalEmptyPending: { ts: timeToDate('09:54').valueOf() },
      terminalLastFrameTs: timeToDate('09:54').valueOf(),
    })
    queueFrames('fresh-frame')
    classifyTerminal.mockResolvedValue({ carsPresent: false, probability: 0.05 })

    await captureAt(db, '09:55')

    expect(db.docs.sailingStatus[KEY].ferryNotFullAuto).toBe(true)
  })

  it('resets a full run that straddles an outage', async () => {
    // Three confident-cars frames, then a gap. FULL_TAIL_FRAMES is 4, so
    // without the reset the very next frame would assert "left full".
    const db = fakeDb().seed(KEY, {
      terminalFullRun: 3,
      crosswalkFullAtAuto: timeToDate('09:20').valueOf(),
      terminalLastFrameTs: timeToDate('09:35').valueOf(),
    })
    queueFrames('fresh-frame')
    classifyTerminal.mockResolvedValue({ carsPresent: true, probability: 0.95 })

    await captureAt(db, '09:55')

    const cur = db.docs.sailingStatus[KEY]
    expect(cur.ferryFullAuto).toBeUndefined()
    expect(cur.terminalFullRun).toBe(1)
  })

  it('confirms a full run across a normal cadence', async () => {
    const db = fakeDb().seed(KEY, {
      terminalFullRun: 3,
      crosswalkFullAtAuto: timeToDate('09:20').valueOf(),
      terminalLastFrameTs: timeToDate('09:54').valueOf(),
    })
    queueFrames('fresh-frame')
    classifyTerminal.mockResolvedValue({ carsPresent: true, probability: 0.95 })

    await captureAt(db, '09:55')

    expect(db.docs.sailingStatus[KEY].ferryFullAuto).toBe(true)
  })
})
