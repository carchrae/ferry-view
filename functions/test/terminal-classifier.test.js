import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { extractTerminalFeatures, TERMINAL_FEATURE_LENGTH } from '../lib/terminal-features.js'
import { classifyTerminal, scoreTerminalFeatures } from '../lib/terminal-classifier.js'
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
    expect(typeof verdict.carsPresent).toBe('boolean')
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

describe('terminalEmptyFrameTs', () => {
  const f = (ts, carsPresent) => ({ ts, carsPresent })

  it('returns the last ts of a confirmed (two consecutive) empty pair', () => {
    expect(terminalEmptyFrameTs([f(1, true), f(2, false), f(3, false), f(4, true)])).toBe(3)
    expect(terminalEmptyFrameTs([f(1, true), f(2, false), f(3, false), f(4, false)])).toBe(4)
  })

  it('a lone empty frame is noise, not a confirmation', () => {
    expect(terminalEmptyFrameTs([f(1, false), f(2, true)])).toBe(null)
    expect(terminalEmptyFrameTs([f(1, true), f(2, false), f(3, true), f(4, false)])).toBe(null)
  })

  it('cars in the final frames never negate an earlier confirmed pair', () => {
    expect(terminalEmptyFrameTs([f(1, true), f(2, false), f(3, false), f(4, true), f(5, true)])).toBe(3)
  })

  it('requires a cars-present frame BEFORE the pair — empty-from-the-start proves nothing', () => {
    expect(terminalEmptyFrameTs([f(1, false), f(2, false), f(3, false)])).toBe(null)
    expect(terminalEmptyFrameTs([f(1, false), f(2, false), f(3, true), f(4, true)])).toBe(null)
    // cars appearing AFTER an early empty pair do not retroactively confirm it
    expect(terminalEmptyFrameTs([f(1, false), f(2, false), f(3, true), f(4, false), f(5, false)])).toBe(5)
  })

  it('a LONG all-empty window (>= MIN_ALL_EMPTY_FRAMES observed) is a quiet sailing and confirms', () => {
    const empties = (n) => Array.from({ length: n }, (_, i) => f(i + 1, false))
    expect(terminalEmptyFrameTs(empties(MIN_ALL_EMPTY_FRAMES))).toBe(MIN_ALL_EMPTY_FRAMES)
    expect(terminalEmptyFrameTs(empties(MIN_ALL_EMPTY_FRAMES - 1))).toBe(null)
    // any cars frame anywhere disables the all-empty path (cars-first applies)
    expect(terminalEmptyFrameTs([...empties(MIN_ALL_EMPTY_FRAMES), f(99, true)])).toBe(null)
  })

  it('carsPresent null (dark frame) is unknown: breaks pairs, never counts', () => {
    expect(terminalEmptyFrameTs([f(1, true), f(2, false), f(3, null), f(4, false)])).toBe(null)
    expect(terminalEmptyFrameTs([f(1, true), f(2, null), f(3, false), f(4, false)])).toBe(4)
    // dark frames don't count toward the all-empty minimum
    const mixed = Array.from({ length: MIN_ALL_EMPTY_FRAMES }, (_, i) =>
      f(i + 1, i % 2 ? null : false),
    )
    expect(terminalEmptyFrameTs(mixed)).toBe(null)
  })

  it('returns null when never confirmed (inconclusive, not "full")', () => {
    expect(terminalEmptyFrameTs([f(1, true), f(2, true)])).toBe(null)
    expect(terminalEmptyFrameTs([])).toBe(null)
    expect(terminalEmptyFrameTs(undefined)).toBe(null)
  })
})
