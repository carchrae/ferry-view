import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import {
  extractTerminalFeatures,
  TERMINAL_FEATURE_LENGTH,
  TERMINAL_FEATURE_MASK,
  TERMINAL_FEATURE_SET,
} from '../lib/terminal-features.js'
import {
  classifyTerminal,
  scoreTerminalFeatures,
  terminalState,
  terminalModelUsable,
} from '../lib/terminal-classifier.js'
import {
  terminalEmptyFrameTs,
  terminalFullAtDeparture,
  MIN_ALL_EMPTY_FRAMES,
  FULL_TAIL_FRAMES,
  FULL_CONFIDENT_P,
} from '../lib/lineup-labels.js'

async function solidJpeg(shade, width = 320, height = 240) {
  return sharp({
    create: { width, height, channels: 3, background: { r: shade, g: shade, b: shade } },
  })
    .jpeg()
    .toBuffer()
}

// 4-px checkerboard of two shades over the whole frame — texture everywhere.
async function checkerJpeg(a, b, width = 320, height = 240) {
  const raw = Buffer.alloc(width * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) raw[y * width + x] = ((x >> 2) + (y >> 2)) % 2 ? a : b
  return sharp(raw, { raw: { width, height, channels: 1 } }).jpeg({ quality: 100 }).toBuffer()
}

describe('extractTerminalFeatures (localStd-v1)', () => {
  it('returns TERMINAL_FEATURE_LENGTH finite values, all zero for a flat frame', async () => {
    const f = await extractTerminalFeatures(await solidJpeg(128))
    expect(f.length).toBe(TERMINAL_FEATURE_LENGTH)
    // No texture anywhere → every cell's std is 0 → standardised to 0.
    expect([...f].every((v) => Number.isFinite(v) && Math.abs(v) < 1e-6)).toBe(true)
  })

  it('reads texture, not brightness: a checkerboard and its inverse give the same features', async () => {
    const a = await extractTerminalFeatures(await checkerJpeg(0, 255))
    const b = await extractTerminalFeatures(await checkerJpeg(255, 0))
    expect([...a].some((v) => v > 0)).toBe(true)
    for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i], 2)
  })

  it('forces masked cells to exactly 0', async () => {
    const f = await extractTerminalFeatures(await checkerJpeg(0, 255))
    for (let i = 0; i < f.length; i++) if (!TERMINAL_FEATURE_MASK[i]) expect(f[i]).toBe(0)
  })
})

describe('classifyTerminal', () => {
  it('returns a well-formed verdict with the shipped (trained, enabled) model', async () => {
    const verdict = await classifyTerminal(await solidJpeg(255))
    expect(verdict).not.toBe(null)
    expect(verdict.probability).toBeGreaterThanOrEqual(0)
    expect(verdict.probability).toBeLessThanOrEqual(1)
    // Two-state since the tail rule (2026-08-16): the unsure band is UI-only.
    expect([true, false]).toContain(verdict.carsPresent)
  })

  it('terminalState is two-state at the single threshold', () => {
    const m = { threshold: 0.5 }
    expect(terminalState(0.9, m)).toBe(true)
    expect(terminalState(0.5, m)).toBe(true)
    expect(terminalState(0.49, m)).toBe(false)
    expect(terminalState(0.0, m)).toBe(false)
  })

  it('terminalState defaults to 0.5 when a model omits the threshold', () => {
    expect(terminalState(0.6, {})).toBe(true)
    expect(terminalState(0.4, {})).toBe(false)
  })

  it('returns null when the model is disabled', async () => {
    expect(await classifyTerminal(await solidJpeg(255), { enabled: false })).toBe(null)
  })

  it('classifies with a hand-built matched-filter model', async () => {
    // Texture features: a textured frame has positive cells where a flat
    // frame has none. Weights = the textured frame's own features (matched
    // filter), bias slightly negative: textured → cars, flat → empty.
    const textured = await checkerJpeg(0, 255)
    const pattern = await extractTerminalFeatures(textured)
    const model = {
      enabled: true,
      featureSet: TERMINAL_FEATURE_SET,
      weights: [...pattern].map((v) => v * 0.5),
      bias: -0.5,
      threshold: 0.5,
    }
    const match = await classifyTerminal(textured, model)
    const flat = await classifyTerminal(await solidJpeg(128), model)
    expect(match.carsPresent).toBe(true)
    expect(flat.carsPresent).toBe(false)
  })

  it('refuses a model trained on another feature set', async () => {
    const weights = new Array(TERMINAL_FEATURE_LENGTH).fill(0)
    expect(terminalModelUsable({ enabled: true, weights, featureSet: TERMINAL_FEATURE_SET })).toBe(true)
    expect(terminalModelUsable({ enabled: true, weights })).toBe(false)
    expect(terminalModelUsable({ enabled: true, weights, featureSet: 'brightness-v0' })).toBe(false)
    expect(await classifyTerminal(await solidJpeg(128), { enabled: true, weights })).toBe(null)
  })

  it('scoreTerminalFeatures is a plain logistic', () => {
    const m = { weights: [1, 1], bias: 0 }
    expect(scoreTerminalFeatures([0, 0], m)).toBeCloseTo(0.5)
    expect(scoreTerminalFeatures([1, 1], m)).toBeGreaterThan(0.85)
  })
})

describe('terminalEmptyFrameTs (one-way empty-gap rule)', () => {
  const f = (ts, carsPresent) => ({ ts, carsPresent })
  const T = true
  const F = false
  const seq = (...states) => states.map((s, i) => f(i + 1, s))

  it('confirms on the first two consecutive empties after solid cars', () => {
    expect(terminalEmptyFrameTs(seq(T, T, F, F))).toBe(4)
    // longer run: the ts is the run's confirming (second) frame, not its last
    expect(terminalEmptyFrameTs(seq(T, T, F, F, F))).toBe(4)
  })

  it('a lone empty frame is noise, not a confirmation', () => {
    expect(terminalEmptyFrameTs(seq(T, T, F))).toBe(null)
    expect(terminalEmptyFrameTs(seq(T, T, F, T, T))).toBe(null)
  })

  it('is ONE-WAY: cars after the confirming pair are late arrivals and never undo it', () => {
    // the 05:15 on 2026-10-19: loading, two empties, a late car on the departure frame
    expect(terminalEmptyFrameTs(seq(T, T, T, F, F, T, F, F, F, T, T))).toBe(5)
    expect(terminalEmptyFrameTs(seq(T, T, F, F, T, T))).toBe(4)
    // a second empty pair later doesn't move the ts: the FIRST gap is when everyone was aboard
    expect(terminalEmptyFrameTs(seq(T, T, F, F, T, T, F, F))).toBe(4)
    // cars right through to the end after the gap still prove nothing
    expect(terminalEmptyFrameTs(seq(T, T, F, F, T, T, T, T, T))).toBe(4)
  })

  it('an ISOLATED cars frame is a model blip: breaks a run, never counts as loading', () => {
    // blip after a confirmed window — the verdict stands
    expect(terminalEmptyFrameTs(seq(T, T, F, F, T, F, F))).toBe(4)
    expect(terminalEmptyFrameTs(seq(T, T, F, F, T))).toBe(4)
    // blip between empties before confirmation — run restarts after it
    expect(terminalEmptyFrameTs(seq(T, T, F, T, F, F))).toBe(6)
  })

  it('cars-first now means SOLID cars: a single cars frame proves nothing', () => {
    expect(terminalEmptyFrameTs(seq(F, F, F))).toBe(null)
    expect(terminalEmptyFrameTs(seq(T, F, F))).toBe(null)
    // empty pair BEFORE the solid cars does not confirm
    expect(terminalEmptyFrameTs(seq(F, F, T, T))).toBe(null)
  })

  it('a LONG all-empty window (>= MIN_ALL_EMPTY_FRAMES observed) is a quiet sailing and confirms', () => {
    const empties = (n) => Array.from({ length: n }, (_, i) => f(i + 1, false))
    expect(terminalEmptyFrameTs(empties(MIN_ALL_EMPTY_FRAMES))).toBe(MIN_ALL_EMPTY_FRAMES)
    expect(terminalEmptyFrameTs(empties(MIN_ALL_EMPTY_FRAMES - 1))).toBe(null)
    // an isolated blip doesn't disable the quiet path (no SOLID cars seen),
    // but its frame doesn't count as observed empty either
    const withBlip = [...empties(5), f(6, true), ...Array.from({ length: 5 }, (_, i) => f(7 + i, false))]
    expect(terminalEmptyFrameTs(withBlip)).toBe(11)
    // solid cars AFTER a long quiet window are late arrivals (one-way)…
    expect(terminalEmptyFrameTs([...empties(MIN_ALL_EMPTY_FRAMES), f(98, true), f(99, true)])).toBe(MIN_ALL_EMPTY_FRAMES)
    // …but solid cars BEFORE the empties mean cars-first applies and the pair confirms on its own
    expect(terminalEmptyFrameTs([f(0, true), f(1, true), ...empties(2).map((x) => f(x.ts + 1, false))])).toBe(3)
  })

  it('carsPresent null (unknown) breaks runs and cars solidity, never counts', () => {
    expect(terminalEmptyFrameTs(seq(T, T, F, null, F))).toBe(null)
    expect(terminalEmptyFrameTs(seq(T, T, null, F, F))).toBe(5)
    // null between two cars frames: neither is solid, so no tail ever starts
    expect(terminalEmptyFrameTs(seq(T, null, T, F, F))).toBe(null)
    // unknown frames don't count toward the all-empty minimum
    const mixed = Array.from({ length: MIN_ALL_EMPTY_FRAMES }, (_, i) =>
      f(i + 1, i % 2 ? null : false),
    )
    expect(terminalEmptyFrameTs(mixed)).toBe(null)
  })

  it('returns null when never confirmed (inconclusive, not "full")', () => {
    expect(terminalEmptyFrameTs(seq(T, T))).toBe(null)
    expect(terminalEmptyFrameTs([])).toBe(null)
    expect(terminalEmptyFrameTs(undefined)).toBe(null)
  })
})

describe('terminalFullAtDeparture', () => {
  const p = (...ps) => ps.map((v, i) => ({ ts: i + 1, p: v }))

  it('confirms when the last FULL_TAIL_FRAMES frames are all confidently cars', () => {
    expect(terminalFullAtDeparture(p(0.2, 0.9, 0.8, 0.75, 0.7))).toBe(5)
    // exactly the minimum length works too
    expect(terminalFullAtDeparture(p(0.9, 0.9, 0.9, 0.9))).toBe(FULL_TAIL_FRAMES)
  })

  it('needs at least FULL_TAIL_FRAMES frames', () => {
    expect(terminalFullAtDeparture(p(0.9, 0.9, 0.9))).toBe(null)
    expect(terminalFullAtDeparture([])).toBe(null)
    expect(terminalFullAtDeparture(undefined)).toBe(null)
  })

  it('one weak frame in the tail breaks it — plain 0.5 cars is not enough', () => {
    expect(terminalFullAtDeparture(p(0.9, 0.9, FULL_CONFIDENT_P - 0.01, 0.9, 0.9))).toBe(null)
    expect(terminalFullAtDeparture(p(0.9, 0.6, 0.9, 0.9, 0.9))).toBe(null)
    // ...but earlier weak frames outside the tail do not matter
    expect(terminalFullAtDeparture(p(0.1, 0.9, 0.9, 0.9, 0.9))).toBe(5)
  })

  it('cars to the end never fire the not-full rule, and an emptied lane never fires full', () => {
    const frames = p(0.9, 0.9, 0.9, 0.9, 0.9, 0.9)
    const withState = frames.map((f) => ({ ...f, carsPresent: f.p >= 0.5 }))
    expect(terminalFullAtDeparture(frames)).toBe(6)
    expect(terminalEmptyFrameTs(withState)).toBe(null)
    const emptied = p(0.9, 0.9, 0.2, 0.1, 0.1, 0.1)
    const emptiedState = emptied.map((f) => ({ ...f, carsPresent: f.p >= 0.5 }))
    expect(terminalFullAtDeparture(emptied)).toBe(null)
    expect(terminalEmptyFrameTs(emptiedState)).toBe(4)
  })

  it('both rules can fire on one sailing (late arrivals fill the last four frames): not full wins', () => {
    // callers consult the full rule only when the empty-gap rule returns null
    const late = p(0.9, 0.9, 0.1, 0.1, 0.9, 0.9, 0.9, 0.9)
    const state = late.map((f) => ({ ...f, carsPresent: f.p >= 0.5 }))
    expect(terminalFullAtDeparture(late)).toBe(8)
    expect(terminalEmptyFrameTs(state)).toBe(4)
  })
})
