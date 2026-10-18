# Terminal-cars model: where it fails by daylight, and a sunrise-split pair (2026-10-17)

Camera: the **Bowen terminal** camera (`webcams/bowen`, front of the
lineup), the model that says whether cars are waiting in the lane.

Feature set: these runs used the **brightness** features of models v1–v8
(per-cell brightness minus the frame mean). The texture feature set
`localStd-v1` replaced them on 2026-10-18
([2026-10-18-terminal-features-daybreak.md](2026-10-18-terminal-features-daybreak.md));
whether bands still help on texture is answered there.

## Question

Tom (2026-10-17): the terminal model "works well in some lighting"; the
main concern is "times around sunrise or just after". Where exactly does v5
fail, and would separate models per daylight regime fix it?

## Setup

- `scripts/experiments/terminal-daylight-bands.mjs` — scores the shipped v5
  (and archived v6) on all labelled terminal frames, by solar-elevation band
  and by label source (hand vs rider). Features cached in
  `training-data/experiments/cache/terminal-features.json`.
- `scripts/experiments/terminal-gated-cv.mjs` — 5-fold CV by sailing with
  the trainer's hyperparameters: one model on all labels vs an
  elevation-gated pair, metrics per band.
- `scripts/experiments/terminal-gate-sweep.mjs` — the same CV sweeping the
  gate (0°, 4°, 8°, 12°), the training overlap across the gate, and a third
  band.

Dataset: 1,769 labelled frames (399 hand, 1,370 rider) from the 45-day
export of 2026-10-17.

## Results

**Where v5 fails.** Its errors were overwhelmingly *false cars* between
civil twilight and 8° (06:00–08:59 Vancouver): precision 0.59–0.65 there
against 0.90–0.95 for the rest of the day and 0.95 at night, where the
street lighting is steady. Night itself is fine on this camera.

**A pair split at sunrise** (5-fold CV, single model vs two members):

| | held-out F1 | false cars | false empties | below-horizon precision |
|---|---:|---:|---:|---:|
| one model | 0.906 | 98 | 130 | 0.82 |
| pair split at 0°, ±6° training overlap | **0.928** | **57** | 117 | **0.98** |

Gates at 4°, 8° and 12° and a third band each did slightly worse than the
0° pair; the overlap matters (a member should see the light just across its
edge).

**Shipped as v8.** Trained by the trainer with members on, champion
selection over v7 (the first version trained on hand + rider labels, F1
0.82): held-out F1 0.858, precision 0.74 → 0.83, twilight precision
0.48 → 1.00, dark precision 0.78 → 1.00. The held-out numbers read lower
than CV because the rider frames in the split are the model's unsure band
by construction.

## Conclusion

Sunrise false cars were the failure, and a member trained on the
below-horizon frames removes most of them. One model per lighting regime is
the right shape for this camera (and the wrong one for the crosswalk camera,
[2026-10-17-lineup-seasonal-drift.md](2026-10-17-lineup-seasonal-drift.md)).

On 2026-10-18 the laptop session found the same sunrise failure had a
second cause, the brightness features themselves plus a +1.79 bias, and
replaced the feature set with per-cell texture. The two fixes attack the
same frames, so bands on texture were retested; see the daybreak write-up.

## What changed because of it

- `functions/lib/model-members.js`: a model JSON may carry `members`, one
  logistic sub-model per solar-elevation band, chosen per frame by capture
  time; top-level weights stay the all-band fallback; thresholds, regions
  and masks stay shared. Both runtimes, the browser mirrors and both
  trainers' history re-scoring honour members.
- `scripts/train-terminal-classifier.mjs` trains members by default
  (`--bands "-90:0,0:90" --band-overlap 6`; `--bands none` for a single
  model) and prints held-out metrics per band against the single weights.
- **Terminal-cars v8** (brightness, banded) in `functions/models/history/`.

## Files

- `scripts/experiments/terminal-daylight-bands.mjs`,
  `scripts/experiments/terminal-gated-cv.mjs`,
  `scripts/experiments/terminal-gate-sweep.mjs`
- Cache: `training-data/experiments/cache/terminal-features.json`
  (brightness features; a fresh extraction now yields texture)
- Narrative: `docs/lineup-classifier.md` §7, "Sunrise is where it fails"
