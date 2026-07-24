import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { extractTerminalFeatures, TERMINAL_FEATURE_LENGTH } from '../lib/terminal-features.js'
import { classifyTerminal, scoreTerminalFeatures } from '../lib/terminal-classifier.js'
import { terminalEmptyFrameTs } from '../lib/lineup-labels.js'

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
  it('returns null with the shipped placeholder model (disabled)', async () => {
    expect(await classifyTerminal(await solidJpeg(255))).toBe(null)
  })

  it('classifies with a hand-built model', async () => {
    const model = {
      enabled: true,
      weights: new Array(TERMINAL_FEATURE_LENGTH).fill(0.02),
      bias: -6,
      threshold: 0.5,
    }
    const bright = await classifyTerminal(await solidJpeg(250), model)
    const dark = await classifyTerminal(await solidJpeg(5), model)
    expect(bright.carsPresent).toBe(true)
    expect(dark.carsPresent).toBe(false)
  })

  it('scoreTerminalFeatures is a plain logistic', () => {
    const m = { weights: [1, 1], bias: 0 }
    expect(scoreTerminalFeatures([0, 0], m)).toBeCloseTo(0.5)
    expect(scoreTerminalFeatures([1, 1], m)).toBeGreaterThan(0.85)
  })
})

describe('terminalEmptyFrameTs', () => {
  const f = (ts, carsPresent) => ({ ts, carsPresent })

  it('returns the last empty frame ts', () => {
    expect(terminalEmptyFrameTs([f(1, true), f(2, false), f(3, false), f(4, true)])).toBe(3)
  })

  it('cars in the final frame never negate an earlier empty frame', () => {
    expect(terminalEmptyFrameTs([f(1, false), f(2, true)])).toBe(1)
  })

  it('returns null when no frame was empty (inconclusive, not "full")', () => {
    expect(terminalEmptyFrameTs([f(1, true), f(2, true)])).toBe(null)
    expect(terminalEmptyFrameTs([])).toBe(null)
    expect(terminalEmptyFrameTs(undefined)).toBe(null)
  })
})
