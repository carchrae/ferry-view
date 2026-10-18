// Pure arithmetic of the TERMINAL-CARS features ("are there cars waiting in
// the Bowen terminal frame?"), shared by the server extractor
// (terminal-features.js, sharp), the browser mirror
// (src/composables/useTerminalClassifier.js, canvas) and the trainer — so
// the three can never drift. No image library here.
//
// FEATURE SET localStd-v1 (2026-10-18). The model used to read per-cell
// BRIGHTNESS minus the frame mean. That fails at daybreak and low sun: a grey
// car on grey asphalt has the asphalt's brightness, while the sun gradient
// across the hill is far bigger than any car — v5 read the sun-lit far-queue
// box as "cars" and the empty 08:45 road scored 0.85
// (docs/experiments/2026-10-18-terminal-features-daybreak.md). Cars differ
// from road in TEXTURE, not shade: windscreen, wheel arches, the shadow line
// underneath. So each cell is now the local standard deviation of the native
// pixels it covers (~5.6 px square on the 320x240 frame), standardised per
// region (its own mean and spread) so one box can't bias the other and the
// day/night exposure range drops out. In the 5-fold CV by sailing this took
// frame F1 0.924 → 0.971, rider-tagged room sailings flagged not-full
// 58% → 71% with 0 wrong flags, and the low-sun "cars to the end" false rate
// 13% → 4%. The set name ships inside the model file: a model trained on
// other features is refused, not misread (terminalModelUsable).
export const TERMINAL_FEATURE_SET = 'localStd-v1'

// Standardised values are divided by this so their range (~±0.6) matches the
// old brightness features — the trainer's learning rate and L2 carry over.
export const TERMINAL_Z_SCALE = 5

// Canvas RGBA bytes (getImageData().data, 4 per pixel) → luma in 0..1, the
// browser mirror's greyscale. Rec. 601 weights; the server's libvips
// greyscale weights differ slightly, which the per-region standardisation
// absorbs (functions/test/terminal-feature-parity.test.js pins the tolerance).
export function grayFromRgba(data, out = new Float32Array(data.length >> 2)) {
  for (let i = 0; i < out.length; i++) {
    const o = i * 4
    out[i] = (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) / 255
  }
  return out
}

// Per-cell standard deviation of a greyscale region. `gray` holds W×H values
// (any scale — bytes 0..255 or units 0..1; the result is in the same units),
// cells are a gw×gh grid over it with floor-based boundaries (every native
// pixel belongs to exactly one cell). Writes gw*gh values into `out` from
// `offset`, in row-major cell order.
export function cellStdGrid(gray, W, H, gw, gh, out, offset = 0) {
  for (let cy = 0; cy < gh; cy++) {
    const y0 = Math.floor((cy / gh) * H)
    const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) / gh) * H))
    for (let cx = 0; cx < gw; cx++) {
      const x0 = Math.floor((cx / gw) * W)
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) / gw) * W))
      let n = 0
      let s1 = 0
      let s2 = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const v = gray[y * W + x]
          n++
          s1 += v
          s2 += v * v
        }
      }
      const mean = s1 / n
      out[offset + cy * gw + cx] = Math.sqrt(Math.max(0, s2 / n - mean * mean))
    }
  }
  return out
}

// Standardise in place, one region at a time: subtract the region's mean and
// divide by its standard deviation (over UNMASKED cells only), then scale by
// 1/TERMINAL_Z_SCALE. Masked cells are forced to exactly 0 — they can neither
// shift the statistics nor earn a weight. `regions` are the model's grids
// ([{ width, height }], in feature order) and `keep` the per-feature mask
// (1 = use, 0 = masked).
export function standardizeRegions(features, regions, keep) {
  let offset = 0
  for (const { width, height } of regions) {
    const end = offset + width * height
    let mean = 0
    let kept = 0
    for (let i = offset; i < end; i++) {
      if (keep[i]) {
        mean += features[i]
        kept++
      }
    }
    mean /= kept || 1
    let varSum = 0
    for (let i = offset; i < end; i++) if (keep[i]) varSum += (features[i] - mean) ** 2
    const sd = Math.sqrt(varSum / (kept || 1)) || 1
    for (let i = offset; i < end; i++) {
      features[i] = keep[i] ? (features[i] - mean) / (sd * TERMINAL_Z_SCALE) : 0
    }
    offset = end
  }
  return features
}

// Per-feature keep flags from the regions and masks: a cell is masked when
// its centre (in frame coordinates) falls inside any mask box.
export function featureMask(regions, masks) {
  const length = regions.reduce((a, r) => a + r.width * r.height, 0)
  const keep = new Uint8Array(length)
  const inMask = (fx, fy) =>
    (masks || []).some(
      ({ roi }) =>
        fx >= roi.left && fx < roi.left + roi.width && fy >= roi.top && fy < roi.top + roi.height,
    )
  let offset = 0
  for (const { roi, width, height } of regions) {
    for (let gy = 0; gy < height; gy++) {
      for (let gx = 0; gx < width; gx++) {
        const fx = roi.left + ((gx + 0.5) / width) * roi.width
        const fy = roi.top + ((gy + 0.5) / height) * roi.height
        keep[offset + gy * width + gx] = inMask(fx, fy) ? 0 : 1
      }
    }
    offset += width * height
  }
  return keep
}

// The native-pixel crop rectangle of a region in a frame of the given size,
// identical on the server (sharp extract) and in the browser (drawImage).
export function regionRect(roi, frameWidth, frameHeight) {
  const left = Math.round(roi.left * frameWidth)
  const top = Math.round(roi.top * frameHeight)
  return {
    left,
    top,
    width: Math.max(1, Math.min(Math.round(roi.width * frameWidth), frameWidth - left)),
    height: Math.max(1, Math.min(Math.round(roi.height * frameHeight), frameHeight - top)),
  }
}
