import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { extractTerminalFeatures, TERMINAL_FEATURE_LENGTH } from '../lib/terminal-features.js'
import { classifyTerminal, scoreTerminalFeatures, terminalState } from '../lib/terminal-classifier.js'
import { terminalEmptyFrameTs, MIN_ALL_EMPTY_FRAMES } from '../lib/lineup-labels.js'

async function solidJpeg(shade, width = 320, height = 240) {
  return sharp({
    create: { width, height, channels: 3, background: { r: shade, g: shade, b: shade } },
  })
    .jpeg()
    .toBuffer()
}

describe('extractTerminalFeatures', () => {
  it('returns TERMINAL_FEATURE_LENGTH normalized values', async () => {
    const f = await extractTerminalFeatures(await solidJpeg(128))
    expect(f.length).toBe(TERMINAL_FEATURE_LENGTH)
    expect([...f].every((v) => v >= 0 && v <= 1)).toBe(true)
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
    // Features are per-frame mean-centered, so solid frames are all zeros;
    // use a bright-top/dark-bottom pattern and its inverse instead. The
    // model's weights are the pattern's own features (matched filter):
    // strongly positive dot product for the pattern, negative for the
    // inverse.
    const topBright = await sharp({
      create: { width: 320, height: 240, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .composite([
        {
          input: { create: { width: 320, height: 120, channels: 3, background: { r: 255, g: 255, b: 255 } } },
          top: 0,
          left: 0,
        },
      ])
      .jpeg()
      .toBuffer()
    const bottomBright = await sharp({
      create: { width: 320, height: 240, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .composite([
        {
          input: { create: { width: 320, height: 120, channels: 3, background: { r: 0, g: 0, b: 0 } } },
          top: 0,
          left: 0,
        },
      ])
      .jpeg()
      .toBuffer()
    const pattern = await extractTerminalFeatures(topBright)
    const model = { enabled: true, weights: [...pattern].map((v) => v * 0.5), bias: 0, threshold: 0.5 }
    const match = await classifyTerminal(topBright, model)
    const anti = await classifyTerminal(bottomBright, model)
    expect(match.carsPresent).toBe(true)
    expect(anti.carsPresent).toBe(false)
  })

  it('scoreTerminalFeatures is a plain logistic', () => {
    const m = { weights: [1, 1], bias: 0 }
    expect(scoreTerminalFeatures([0, 0], m)).toBeCloseTo(0.5)
    expect(scoreTerminalFeatures([1, 1], m)).toBeGreaterThan(0.85)
  })
})

describe('terminalEmptyFrameTs (tail rule)', () => {
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

  it('SOLID cars returning after an empty window clears it — it was mid-sailing', () => {
    expect(terminalEmptyFrameTs(seq(T, T, F, F, T, T))).toBe(null)
    // …and a new empty pair in the new tail confirms again
    expect(terminalEmptyFrameTs(seq(T, T, F, F, T, T, F, F))).toBe(8)
  })

  it('an ISOLATED cars frame is a model blip: breaks a run, never starts a new tail', () => {
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
    // solid cars anywhere disables the all-empty path (cars-first applies)
    expect(terminalEmptyFrameTs([...empties(MIN_ALL_EMPTY_FRAMES), f(98, true), f(99, true)])).toBe(null)
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
