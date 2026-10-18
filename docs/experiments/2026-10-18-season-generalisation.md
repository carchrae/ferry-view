# One model for every season, or a model per season? (2026-10-18)

## Question

Tom: "how well does the current model perform on the earlier dates? are we
developing a model which no longer needs to be switched to a previous
model, or are we making models that are specific to the season."

The whole-archive table in
[2026-10-18-model-history-report.md](2026-10-18-model-history-report.md)
cannot answer that: the newest versions were trained on every week in it.
This experiment trains the trainers' own recipes on one slice of time and
scores them on another, so no number is in-sample, for both cameras and
for two feature sets each.

## Setup

`scripts/experiments/season-generalisation.mjs`. Slices:

- **forward**: train on frames before 2026-09-01, score from then on
  (summer → autumn);
- **backward**: train on frames from 2026-09-01, score before it
  (autumn → summer);
- **leave-one-month-out** (LOMO) for July, August, September, October:
  train on the other three months, score the held-out one. August and
  September test interpolation; July and October test extrapolation to an
  edge;
- **5-fold CV by sailing**, all seasons mixed, pooled out-of-fold: the
  trainer's usual comparison, for scale.

Terminal-cars: brightness (the v1–v8 recipe) and `localStd-v1` texture,
from the experiment caches; hand + rider labels, classes balanced, lr 0.2,
600 epochs; scored per frame and with the deployed sailing rules against
rider capacity tags.

Crosswalk: the deployed brightness features and an **experimental texture
set** built here the same way as the terminal's (per-cell standard
deviation of the native greyscale crop on the deployed 48×27 and 24×14
grids, standardised per region), plus the two stacked; lr 0.1, 1,000
epochs, threshold 0.7, recency weights off (they measure age from the
training set's newest frame, which means nothing with a month held out);
scored per frame on daylight labels and with the sequence severity against
crosswalk marks and refutes.

Data: the export of 2026-10-18 evening. Terminal 21,191 frames, 1,910
labels, 747 tagged sailings. Crosswalk 11,676 frames, 4,232 daylight
labels, 1,079 sailings with a mark or refute.

## Results

### Terminal-cars

| slice | features | train / eval frames | acc | P | R | room flagged | wrong not-full |
|---|---|---|---:|---:|---:|---|---:|
| forward (summer→autumn) | brightness | 1,228 / 682 | 0.752 | 0.775 | 0.812 | 68% of 182 | 3 |
| forward | **texture** | 1,228 / 682 | **0.943** | 0.986 | 0.915 | 69% | **0** |
| backward (autumn→summer) | brightness | 682 / 1,228 | 0.779 | 0.990 | 0.716 | 77% of 386 | **21** |
| backward | **texture** | 682 / 1,228 | **0.963** | 0.989 | 0.961 | 65% | **0** |
| LOMO July | brightness / texture | 1,450 / 460 | 0.880 / **0.959** | | | 75% / 69% | 3 / 0 |
| LOMO Aug | brightness / texture | 1,142 / 768 | 0.813 / **0.962** | | | 74% / 71% | 5 / 0 |
| LOMO Sep | brightness / texture | 1,456 / 454 | 0.846 / **0.954** | | | 70% / 69% | 4 / 0 |
| LOMO Oct | brightness / texture | 1,682 / 228 | 0.662 / **0.930** | | | 67% / 73% | 1 / 0 |
| 5-fold CV | brightness / texture | — / 1,910 | 0.847 / **0.957** | | | 76% / 70% | 12 / 0 |

Brightness is seasonal in both directions: a summer model reads autumn at
0.75, an autumn model reads summer at 0.78 and files 21 wrong not-full
flags. Texture reads every slice at 0.93–0.96 with no wrong flag anywhere;
its lowest row is October held out, the edge with the fewest labels.

### Crosswalk

| slice | features | train / eval frames | acc | P | R | sailings | severity cost | agree / missed / phantom |
|---|---|---|---:|---:|---:|---:|---:|---|
| forward (summer→autumn) | brightness | 2,759 / 1,473 | 0.880 | 0.918 | 0.777 | 494 | 174 | 90 / 43 / 6 |
| forward | **texture** | 2,759 / 1,473 | **0.973** | 0.986 | 0.947 | 494 | **49** | 121 / 24 / **0** |
| backward (autumn→summer) | brightness | 1,473 / 2,759 | 0.912 | 0.919 | 0.885 | 585 | 127 | 221 / 35 / 2 |
| backward | **texture** | 1,473 / 2,759 | **0.953** | 0.954 | 0.942 | 585 | **89** | 233 / 31 / **0** |
| LOMO July | brightness / texture | 3,156 / 1,076 | 0.917 / **0.939** | | | 224 | 38 / 44 | 98/10/0 vs 95/15/0 |
| LOMO Aug | brightness / texture | 2,549 / 1,683 | 0.928 / **0.959** | | | 361 | 68 / **48** | 132/20/1 vs 137/18/0 |
| LOMO Sep | brightness / texture | 3,279 / 953 | 0.945 / **0.973** | | | 332 | 77 / **27** | 74/16/3 vs 81/13/0 |
| LOMO Oct | brightness / texture | 3,712 / 520 | 0.850 / **0.981** | | | 162 | 69 / **22** | 25/21/2 vs 40/11/0 |
| 5-fold CV | brightness / texture | — / 4,232 | 0.927 / **0.965** | 0.941 / 0.974 | 0.889 / 0.945 | 1,079 | 200 / **131** | 334/66/3 vs 358/56/0 |

Stacking brightness onto texture changes nothing (CV cost 132, forward 56).
By sun height in the CV, texture fixes the band that every brightness
version has been bad in: **twilight (−7°…0°) precision 0.74 → 1.00, recall
0.53 → 0.94** on 125 frames; low sun 0.94/0.96 → 0.98/0.97; mid
0.96/0.87 → 0.99/0.95; high 0.94/0.90 → 0.97/0.94.

For scale: the shipped v6 (brightness, recency-weighted, trained through
October) scores severity cost 27 on October **in-sample**; texture trained
on July–September scores 22 on October **without seeing it**.

## Conclusion

- **With brightness features both classifiers are seasonal.** Each model
  knows the light it was trained in. The crosswalk model has been living
  on nightly recency retraining; the terminal model was in the same state
  until the feature change this morning.
- **With texture features both classifiers generalise across the season.**
  Trained on summer only they read autumn; trained on autumn only they read
  summer; every held-out month lands at 0.93–0.98. On the crosswalk the
  gain is largest exactly where the old model was weakest, twilight, and
  phantoms (detections on rider-refuted sailings, the costliest error) go
  to zero in every slice.
- So the answer to the question: **yes, we can build one model that does
  not need switching**, and the ingredient is the feature set, not more
  data or more frequent retraining. The terminal has it. The crosswalk does
  not yet.

## What changed because of it

The crosswalk classifier got the `localStd-v1` feature set the same evening
(Tom: "build it"): `functions/lib/lineup-feature-set.js` names it,
`lineup-features.js` extracts it with the shared `terminal-feature-math.js`
arithmetic, `lineup-classifier.js` and the browser mirror refuse a model
from another set, the trainer and the night trainer stamp it, archived
brightness versions can no longer win champion selection. **Lineup v7** is
the first texture model: held-out P 0.964 / R 0.959 against v6's 0.944 /
0.918 on the same split, severity cost 120 against 160, zero phantoms.
Parity browser vs server: max score delta 0.0075 on 48 frames
(`functions/test/lineup-feature-parity.test.js`). Still open: the recency
weighting (kept at the trainer default for now) can likely be relaxed once
the model carries across seasons; and texture on the night composites is
measured in [2026-10-18-texture-composite.md](2026-10-18-texture-composite.md).

## Files

- `scripts/experiments/season-generalisation.mjs` (builds the crosswalk
  texture cache `training-data/experiments/cache/lineup-std.u8` on first
  run, ~3 minutes)
- `docs/experiments/2026-10-18-season-generalisation-results.json`
