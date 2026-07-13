import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { compressSnapshot } from '../lib/webcam.js'

// Roughly what the community camera serves: 1280×720, high-quality JPEG.
async function makeTestJpeg(width = 1280, height = 720) {
  const raw = Buffer.alloc(width * height * 3)
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256)
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer()
}

describe('compressSnapshot', () => {
  it('halves dimensions and shrinks the file, still a valid JPEG', async () => {
    const original = await makeTestJpeg(1280, 720)
    const compressed = await compressSnapshot(original)

    const meta = await sharp(compressed).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.width).toBe(640)
    expect(meta.height).toBe(360)
    expect(compressed.length).toBeLessThan(original.length)
  })

  it('returns the original buffer unchanged for non-image input', async () => {
    const garbage = Buffer.from('not an image at all')
    const out = await compressSnapshot(garbage)
    expect(out).toBe(garbage)
  })
})
