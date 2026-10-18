# Texture features on stable-pixel composites (2026-10-18)

## Question

Tom, before deploying the texture crosswalk model: "i want to see some
more testing on the composite … texture+composite to be clear." Every
composite experiment so far (2026-10-07 night, 2026-10-17 day and
terminal) had used brightness features. Does compositing a trailing window
still help, hurt, or not matter once the features are texture, by day and
in the dark?

## Setup

`scripts/experiments/texture-composite-cv.mjs`, crosswalk camera, five
pipelines: brightness raw (the pre-2026-10-18 features), brightness
composite, texture raw (`localStd-v1`), texture composite (the production
path: `compositeWindow` → `compositeStable` → JPEG q80 → native crops →
per-cell std), and texture raw and composite side by side. Composite
windows are ≤3 archive frames ≤7 min apart, same exposure mode and level,
as `COMPOSITE` defines; archive spacing is 5 minutes.

- **Day**: 4,232 labelled daylight frames (125 twilight), 5-fold CV by
  sailing, the trainer's recipe with recency weights; frame P/R, twilight
  P/R, sequence severity over 1,079 sailings, phantoms listed.
- **Dark** (sun below −7°): the 979 hand labels from the night review (32
  frames with the line past the crosswalk, on 12 sailings), 5-fold by
  sailing, classes balanced; frame P/R and how many of the 11 positive and
  118 negative dark sailings get a sustained detection.

## Results

**Day**

| pipeline | P | R | twilight P / R | severity cost | agree / missed / phantom |
|---|---:|---:|---|---:|---|
| brightness raw | 0.938 | 0.888 | 0.67 / 0.50 | 165 | 336 / 63 / 0 |
| brightness composite | 0.946 | 0.898 | 0.77 / 0.53 | 183 | 339 / 60 / 2 |
| **texture raw** | **0.973** | **0.949** | **1.00 / 0.94** | **124** | **362 / 52 / 0** |
| texture composite | 0.960 | 0.920 | 0.97 / 0.91 | 154 | 342 / 61 / 0 |
| texture raw + composite | 0.973 | 0.940 | 0.97 / 0.91 | 129 | 358 / 54 / 0 |

**Dark**

| pipeline | frame P | frame R | positive sailings detected (of 11) | false detections (of 118) |
|---|---:|---:|---|---|
| brightness raw | 0.80 | 0.50 | 3 | 0 |
| brightness composite | 0.43 | 0.19 | 2 | 0 |
| **texture raw** | **0.83** | **0.59** | **4** | **0** |
| texture composite | 0.68 | 0.47 | 3 | 0 |
| texture raw + composite | 0.85 | 0.53 | 3 | 0 |

## Conclusion

- **By day, compositing does not help texture; it costs.** Texture on raw
  frames is the best pipeline on every measure (cost 124, zero phantoms,
  twilight recall 0.94); the composite loses three points of recall and 30
  of cost, because at 5-minute spacing the minimum rule erases part of a
  moving queue. Adding the composite as extra features recovers nothing.
  The two phantoms that compositing produced with brightness are gone with
  texture either way.
- **In the dark the same ordering holds, on far too little data to settle
  anything** (32 positive frames, 11 positive sailings). Texture on raw
  frames is the best of the five and, notably, produces **no false
  detection on 118 dark sailings with no queue**, where the brightness day
  model of September got all 26 of its dark detections wrong. Recall is
  still 0.59 per frame and 4 of 11 sailings, so the −7° dark gate stays.
- The headlight-bloom problem the composite was designed for is partly a
  brightness problem: a bloom is a bright smooth region, which texture
  reads as little. The composite is not needed to make texture safe at
  night; what is missing is positive night labels.

## What changed because of it

- Nothing in the production path: the crosswalk model classifies raw
  frames by day, never in the dark, as before. The composite helpers and
  the night trainer stay for the night model, which now has texture
  features as well (`extractCompositeFeatures` follows `extractFeatures`).
- Decision: the texture crosswalk model (lineup v7) ships without
  composites. Revisit the night model when the dusk sailings of November
  add positive dark sailings; test texture raw against texture composite
  on 1-minute production probes then, not on 5-minute archive frames.

## Files

- `scripts/experiments/texture-composite-cv.mjs` (caches
  `training-data/experiments/cache/lineup-std-composite.u8`)
- `docs/experiments/2026-10-18-texture-composite-results.json`
