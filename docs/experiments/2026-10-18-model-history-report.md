# Every model version over the whole archive: converging, or seasonal? (2026-10-18)

## Question

Tom: "each time we create a new model which may be more accurate, we don't
go back and check the previous classifications the models made. it would be
interesting to run a report on the whole history given the updated models to
see if we are converging on better models, or if they are seasonal. it would
also be interesting to see if the models agree."

## Setup

`scripts/experiments/model-history-report.mjs` scores every archived
version of both classifiers over every frame on disk (the 45-day archive
plus the labelled July frames kept for training), from the experiment
feature caches:

- **Terminal-cars** v5–v8 (brightness; from the cached cell brightness,
  frame-mean-centred, masked cells zero, i.e. the pre-2026-10-18 extractor)
  and v9–v11 (texture `localStd-v1`, from the cached per-cell std, which
  matches the shipped extractor to 0.003 in score). v1 and v3 have other
  geometry or masks and are skipped. 21,180 frames, 1,910 labelled, 747
  rider-tagged sailings.
- **Crosswalk** v1–v6 (one geometry throughout). 11,676 cached frames,
  4,232 labelled daylight frames, 1,079 sailings with a crosswalk mark or a
  refute.

Per ISO week: frame accuracy per version. Per month: the deployed
sailing-level rules per version (terminal: not-full coverage on room-tagged
sailings, wrong flags on Full-tagged; crosswalk: sequence severity cost).
Pairwise agreement between versions at the frame and at the sailing level.

One caveat governs the reading: the **newest versions were trained on these
very weeks** (terminal v9–v11 on data to 2026-10-18, crosswalk v5–v6 the
same), so their rows are in-sample. The older versions' later weeks are the
honest out-of-sample view. To separate "better" from "seasonal" the terminal
experiment was also run **time-forward**
(`terminal-features-experiment.mjs --train-before DATE --train-rider`): one
model trained on all labels before the date, scored on everything after it,
for the brightness recipe and the texture recipe.

## Results

### Terminal-cars: frame accuracy per week (hand + rider labels)

| week | n | v5 | v6 | v7 | v8 | v9 | v10 | v11 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| W29 | 234 | 0.962 | 0.932 | 0.919 | 0.940 | 0.987 | 0.987 | 0.987 |
| W30 | 210 | 0.886 | 0.819 | 0.824 | 0.886 | 0.952 | 0.952 | 0.952 |
| W33 | 87 | 0.874 | 0.943 | 0.989 | 0.977 | 0.977 | 0.977 | 0.977 |
| W34 | 464 | 0.858 | 0.888 | 0.912 | 0.940 | 0.987 | 0.987 | 0.987 |
| W35 | 135 | 0.911 | 0.889 | 0.874 | 0.956 | 0.970 | 0.970 | 0.970 |
| W36 | 116 | 0.879 | 0.871 | 0.871 | 0.922 | 0.931 | 0.940 | 0.940 |
| W37 | 181 | 0.724 | 0.718 | 0.950 | 0.956 | 0.983 | 0.983 | 0.983 |
| W38 | 62 | 0.758 | 0.774 | 0.952 | 0.984 | 0.952 | 0.935 | 0.935 |
| W39 | 147 | 0.850 | 0.850 | 0.918 | 0.980 | 0.973 | 0.973 | 0.973 |
| W40 | 36 | 0.583 | 0.500 | 0.556 | 0.861 | 0.861 | 0.944 | 0.944 |
| W41 | 124 | 0.710 | 0.718 | 0.855 | 0.879 | 0.919 | 0.919 | 0.919 |
| W42 | 75 | 0.320 | 0.293 | 0.307 | 0.573 | 0.960 | 0.960 | 0.960 |

(W31 and W32 have under 25 labels and are left out; full table in the JSON.)

Precision / recall per period: v5 falls from 0.95/0.95 in July to
**0.58/0.84 in October**; v8 (banded brightness) 0.95/0.92 → 0.77/0.87;
v9–v11 1.00/0.96 → 0.98–1.00/0.88.

Sailing-level rules per month (room sailings flagged not-full | wrong flags):

| month | room/full | v5 | v6 | v7 | v8 | v9 | v10 | v11 |
|---|---|---|---|---|---|---|---|---|
| Jul | 197/56 | 63% \| 0 | 59% \| 0 | 63% \| 0 | 70% \| 0 | 70% \| 0 | 70% \| 0 | 70% \| 0 |
| Aug | 189/73 | 62% \| 0 | 58% \| 0 | 63% \| 0 | 71% \| 1 | 73% \| 0 | 73% \| 0 | 72% \| 0 |
| Sep | 134/37 | 57% \| 1 | 58% \| 1 | 69% \| 3 | 69% \| 3 | 68% \| 0 | 69% \| 0 | 68% \| 0 |
| Oct | 48/13 | 44% \| 0 | 38% \| 0 | 56% \| 1 | 65% \| 1 | 73% \| 0 | 75% \| 0 | 75% \| 0 |
| all | 568/179 | 60% \| 1 | 57% \| 1 | 64% \| 4 | 70% \| 5 | 71% \| 0 | 71% \| 0 | 71% \| 0 |

v7 and v8 bought coverage in September at the price of three wrong flags
there; the texture versions have the coverage with none.

**Time-forward** (the honest test; hand + rider training, same recipes as
the trainer):

| trained on | scored on | recipe | rider-label P / R | room flagged | wrong | false cars-to-end |
|---|---|---|---|---|---|---|
| July–Aug | Sep–Oct | brightness | 0.66 / 0.94 | 48% | 1 | 14% |
| July–Aug | Sep–Oct | **texture** | **0.99 / 0.92** | **69%** | **0** | **6%** |
| July–Sep | Oct | brightness | 0.58 / 0.91 | 40% | 0 | 19% |
| July–Sep | Oct | **texture** | **0.98 / 0.91** | **73%** | **0** | **4%** |

A brightness model trained on summer frames is close to useless by October
(precision 0.58 on rider labels, false cars-to-end 19%). A texture model
trained on the same summer frames keeps precision 0.98 and the full
coverage into October **without having seen autumn light**.

Agreement: v9, v10 and v11 agree with each other on 99–100% of frames and
99–100% of sailing verdicts; the brightness versions agree with them on
88–92% of frames and 81–89% of verdicts. Within the brightness line, v5/v6
and v7/v8 form two clusters (0.94–0.95 inside, 0.91 across).

### Crosswalk: frame accuracy per week (labelled daylight frames)

| week | n | v1 | v2 | v3 | v4 | v5 | v6 |
|---|---:|---:|---:|---:|---:|---:|---:|
| W29 | 362 | 0.873 | 0.867 | 0.876 | 0.870 | 0.873 | 0.873 |
| W30 | 391 | 0.941 | 0.957 | 0.962 | 0.954 | 0.951 | 0.951 |
| W31 | 377 | 0.912 | 0.944 | 0.942 | 0.950 | 0.950 | 0.950 |
| W32 | 415 | 0.945 | 0.964 | 0.957 | 0.940 | 0.949 | 0.949 |
| W33 | 538 | 0.937 | 0.868 | 0.950 | 0.937 | 0.929 | 0.929 |
| W34 | 349 | 0.874 | 0.862 | 0.883 | 0.940 | 0.957 | 0.960 |
| W35 | 265 | 0.913 | 0.838 | 0.932 | 0.955 | 0.955 | 0.955 |
| W36 | 323 | 0.892 | 0.870 | 0.885 | 0.923 | 0.969 | 0.969 |
| W37 | 268 | 0.896 | 0.881 | 0.892 | 0.899 | 0.955 | 0.955 |
| W38 | 181 | 0.818 | 0.801 | 0.834 | 0.834 | 0.945 | 0.945 |
| W39 | 136 | 0.824 | 0.912 | 0.904 | 0.904 | 0.963 | 0.963 |
| W40 | 339 | 0.864 | 0.823 | 0.844 | 0.885 | 0.959 | 0.959 |
| W41 | 195 | 0.826 | 0.810 | 0.821 | 0.826 | 0.949 | 0.949 |
| W42 | 93 | 0.581 | 0.591 | 0.591 | 0.581 | 0.946 | 0.946 |

Sequence severity cost per month (lower is better; agree / missed / phantom):

| month | sailings | v1 | v2 | v3 | v4 | v5 | v6 |
|---|---:|---|---|---|---|---|---|
| Jul | 224 | 70 (94/10/2) | 52 (91/20/0) | 46 (93/15/0) | 42 (96/14/0) | 45 (94/14/0) | 45 (94/14/0) |
| Aug | 361 | 150 (136/7/9) | 134 (119/32/5) | 117 (133/19/6) | 106 (131/18/5) | 56 (137/18/1) | 56 (137/18/1) |
| Sep | 332 | 116 (70/14/4) | 74 (59/32/0) | 97 (59/31/2) | 100 (65/25/3) | 32 (77/14/0) | 32 (77/14/0) |
| Oct | 162 | 90 (26/14/3) | 64 (18/28/0) | 88 (21/24/3) | 81 (24/20/3) | 27 (36/12/0) | 27 (36/12/0) |
| all | 1,079 | 426 (326/45/18) | 324 (287/112/5) | 348 (306/89/11) | 329 (316/77/11) | **160 (344/58/1)** | **160 (344/58/1)** |

Here the pattern is the seasonal one: every version up to v4 holds about
0.90–0.95 in its own season and slides to 0.58 by the week of 2026-10-12;
v4 never saw autumn, and its October cost (81) is twice its July cost. v5
and v6 are trained through October (in-sample), so their October row is not
evidence of generalisation; the time-forward crosswalk test is the
recency-weighting CV in
[2026-10-17-lineup-seasonal-drift.md](2026-10-17-lineup-seasonal-drift.md),
which found that the model has to follow the season.

Agreement: v5 and v6 agree on 100% of frames and detections; v1–v4 agree
with them on 91–95% of frames and 85–91% of detections.

## Conclusion

- **Terminal-cars is converging, not seasonal.** The feature change did it:
  a texture model trained only on summer frames generalises to October
  light that a brightness model collapses on. Successive texture versions
  differ by well under 1% of decisions. The brightness line (v5–v8) was
  seasonal in exactly the way the crosswalk line is.
- **The crosswalk model is seasonal.** Each version holds in its own light
  and slides as the sun moves; retraining with recency weights is the right
  mechanism and the nightly job now does it, but no crosswalk version so far
  carries forward across a season change. Whether a texture-style feature
  would do for that camera what it did for the terminal is the obvious next
  experiment.
- **Agreement is high among versions that share a feature set** (99–100%)
  and modest across sets (81–92% of verdicts), which is the size of the
  change a re-evaluation of history would make.

## What changed because of it

- Nothing in production. `model-history-report.mjs` is a tracked experiment;
  the terminal experiment gained `--train-before`.
- Re-evaluating history with newer models (Tom's third question) is noted
  as design, not done: the robot's verdicts live on `sailingStatus`
  (`ferryNotFullAuto`, `terminalAutoModel`, `crosswalkFullAtAuto`,
  `crosswalkAutoModel`; the model version IS recorded there), and the
  robot's capacity report is a `lastCapacity`/`capacitySource: 'robot'`
  field, not a `capacityHistory` record. Tom's direction: a re-evaluation
  should **append** a record, as a rider correction does, never overwrite,
  and must carry the model version.

## Files

- `scripts/experiments/model-history-report.mjs`
- `docs/experiments/2026-10-18-model-history-report-results.json`
- `docs/experiments/2026-10-18-terminal-time-forward-results.json`
