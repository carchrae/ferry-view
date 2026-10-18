# Lineup (crosswalk) model: seasonal drift, recency weighting, daylight bands (2026-10-17)

Camera: the **community crosswalk** camera (`webcams/bowen-community`), the
day model that decides when the lineup has reached the crosswalk.

## Question

Tom (2026-10-17): "the weather and lighting has changed and we likely need
to update the classifier model." v4 had been trained on 2026-09-06. Three
questions: how far had it drifted and on which frames; does weighting recent
frames more at training time fix it without losing the summer; and should
there be separate models per daylight regime (Tom suspected the dusk/dawn
light).

## Setup

Scripts (run on saturn, 2026-10-17; the gitignored caches under
`training-data/experiments/cache/` are rebuilt by the scripts):

- `scripts/experiments/lineup-drift-eval.mjs` — extracts and caches the
  deployed features for every manifest frame on disk, scores shipped v4 per
  ISO week (frame precision/recall plus mean brightness), computes the
  sequence severity cost per period, then trains fresh candidates
  (unweighted / recency-weighted / autumn-only) and compares them on the
  trainer's deterministic held-out split, by period.
- `scripts/experiments/lineup-daylight-bands.mjs` — v4's errors by
  solar-elevation band (`functions/lib/daylight.js`), night-frame luminance
  per week (when does the camera go infrared), and 5-fold CV by sailing of
  elevation-gated models (two and three bands) against one model, same
  recency weights.
- `scripts/experiments/seasonal-drift-cv.mjs` — 5-fold CV by sailing (md5 of
  the sailing key) of the trainer's recipe with four weighting schemes;
  scored by the held-out **sequence severity cost** (phantom 10, early30 6,
  early10 2, late10 1, late30 2, missed 2), split at 2026-09-06 into summer
  and autumn sailings.

Dataset: the 45-day export of 2026-10-17 (11,676 frames with a trailing
window, 4,221 labelled daylight frames in the CV).

## Results

**Drift.** v4 scored recall 0.93 on summer frames but **0.70 on the autumn
frames tagged after it shipped**, down to 0.37 in the week of 2026-10-12.
By solar elevation the autumn recall is fine below 15° (≈ 0.90) and
collapses at **25–35° (0.455)**: the 12:00–17:00 sailings, where the autumn
sun sits where the summer sun never did and the shadows on the hill lane
look nothing like July. Its autumn false positives are the opposite case,
dim 06:xx frames. So the drift is seasonal shadow geometry, not twilight.

**Recency weighting** (5-fold CV, held-out severity cost):

| training weights | summer cost | autumn cost | total | phantoms |
|---|---:|---:|---:|---:|
| unweighted retrain | 107 | 97 | 204 | 3 |
| autumn frames ×2 | 109 | 79 | 188 | 2 |
| last 28 days ×3 | 119 | 70 | 189 | 2 |
| **1 + 3·e^(−age/21 d)** | 108 | 69 | 177 | 1 |

The exponential decay (age measured from the newest frame in the dataset,
so an unchanged dataset reproduces identical weights) takes a third off the
autumn cost and leaves summer unchanged.

**Daylight bands do not pay for the crosswalk.** Gating two or three models
by solar elevation (same CV, same recency weights) moves held-out misses
from 211 to 197, within noise, and *hurts* twilight (recall 0.50 → 0.34)
because each gated model sees fewer of the rare twilight frames. Twilight
(−7°…0°) is the one band that is bad in every variant (precision 0.67,
recall 0.50 on 125 frames) and that is a labels problem, not a model one
(see the night labelling work in `docs/lineup-classifier.md`).

## Conclusion

- The lineup model drifts with the season, on the mid-day sailings, and a
  recency-weighted retrain fixes it. The nightly job retraining with that
  default means the live model follows the season instead of freezing at
  its training month.
- One model for all daylight is right for this camera; separate members
  per band belong to the terminal camera
  ([2026-10-17-terminal-daylight-bands.md](2026-10-17-terminal-daylight-bands.md)).

## What changed because of it

- `scripts/train-lineup-classifier.mjs` weights frames
  `1 + 3·e^(−age/21d)` by default (`--recent-boost 3 --recent-scale 21`;
  `--recent-boost 0` restores the old behaviour).
- **Lineup v5** (2026-10-17): on the full dataset v4 re-scores at severity
  cost 339 (12 phantoms, 77 missed) against v5's 170. **v6** (2026-10-18)
  is the same recipe on the hand-corrected labels from the night review
  (cost 160, same held-out precision/recall 0.944/0.918).
- Found the same day: `evalHistorical` compared region JSON including the
  display names, renamed in October, so every archived version had silently
  dropped out of the comparison table and nightly champion selection. Both
  trainers now compare crop geometry only (`functions/lib/model-geometry.js`).

## Files

- `scripts/experiments/lineup-drift-eval.mjs`,
  `scripts/experiments/lineup-daylight-bands.mjs`,
  `scripts/experiments/seasonal-drift-cv.mjs`
- Cache: `training-data/experiments/cache/features.bin`, `features-index.json`
- Narrative: `docs/lineup-classifier.md` §4 "Seasonal drift and recency weighting"
