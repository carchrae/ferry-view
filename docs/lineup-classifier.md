# Lineup Timelapse & Crosswalk Classifier

How the Bowen lineup timelapse works, how riders tag "full to the crosswalk",
and how those tags train a tiny classifier that can eventually detect it
automatically. Everything runs inside the existing Cloud Functions — no ML
infrastructure, no GPUs, no external services.

## 1. Timelapse capture (server)

> Full timing rules, expected frame counts, and retention for **all** webcam
> paths live in [webcams.md](webcams.md) — this section keeps just what the
> training pipeline depends on.

Between sailings, the community camera watches the car lineup build for the
**next** Bowen departure. The existing 1-minute `pollFerryStatus` drives
capture statelessly — `timelapseDecision()` in `functions/lib/webcam.js`
says yes only when **all** of these hold:

- the poll lands on a 5-minute mark (`minute % 5 === 0`),
- at least **15 minutes** have passed since the previous Bowen departure
  (from the live activity log, falling back to the scheduled time when the
  log is stale; no departure yet today → no capture, which also kills
  overnight frames),
- the ferry has **not yet arrived back at Bowen** — once it's docked the
  lineup is loading, so frames stop at arrival and the terminal camera
  (§1b) takes over,
- there **is** a later not-yet-departed Bowen sailing today. Boats departing
  **at/after 9 pm** (21:30 / 22:30 / 23:30) get no unconditional timelapse —
  their whole cycle runs classify-first (§4), so frames appear only after
  the classifier detects a full lineup.

Each frame is captured from the community cam, compressed (~40–80 KB,
half-resolution JPEG), stored at

```
webcams/community/<dateIso>/timelapse/<sailingTime>_To HSB_<epoch-ms>.jpg
```

and appended to the sailing's `sailingStatus` doc as `lineupTimelapsePaths`
(via `arrayUnion`). The capture decision uses only in-memory poll data —
zero extra Firestore reads. Frames are public, served with immutable cache
headers, and **deleted after 42 days** by the nightly `cleanupOldWebcams`.

Volume: capture runs from 15 min after the previous departure until the
ferry arrives back, so ~7–11 frames per sailing, ~90–140 frames/day —
inside the free Storage tier.

## 1b. Departure timelapse (Bowen terminal camera)

A second timelapse watches the **Bowen terminal** camera as the ferry loads.
`departureTimelapseDecision()` captures **every minute** (no 5-min gate),
starting at **max(ferry arrival at Bowen, 10 minutes before the scheduled
time)** — a late ferry doesn't burn frames on an empty berth — and continuing
**until the ferry actually departs** — detected via `matchedDepartureTime`,
which the poll sets on the schedule entry once the sailing has left, so
capture stops on its own. Safety bounds: at most 30 min past the effective
start, never a sailing >60 min past schedule, and a legacy `T−10…T+20` window
when arrival is undetectable (AIS outage) — see
[webcams.md](webcams.md) for details. Frames go to
`webcams/bowen/<dateIso>/timelapse/…` and are appended to the sailing's
`departureTimelapsePaths`. Terminal frames are already tiny (~14 KB) so they
are stored uncompressed.

## 2. Playback (client)

`useBowenSailings.js` maps `lineupTimelapsePaths` → the **arrival** timelapse
and `departureTimelapsePaths` → the **departure** timelapse, as sorted
`[{ imageUrl, timeLabel, ts }]` arrays on each built card. It also exposes
`loadUpcomingLineup()` — the lineup currently building for the next sailing.

The "Last Bowen Sailing" dialog:

- The **arrival** and **departure** sections each show their timelapse
  (community lineup / terminal cam) when frames exist, and fall back to the
  single photo otherwise. There is no separate "Play history" toggle — the
  history *is* the arrival/departure section.
- A **"Lineup building for the ⟨time⟩ sailing"** section at the **bottom** of
  the dialog shows the boarding sailing's lineup. `loadUpcomingLineup()` gates
  this to a *genuinely upcoming* sailing (scheduled time still ahead, 20-min
  late grace), so a sailing that departed but never got its arrival photo
  can't surface its stale last frame.

`src/components/LineupTimelapse.vue` shows the **last-captured** frame by
default and never auto-plays (`autoplay` default false); the clip only moves
when the user presses play (runs from the start) or steps. Controls are a
play/pause toggle on the left, then ◀ / ▶ step buttons flanking a center
control. When `taggable` (arrival/lineup only) the center control is the
crosswalk button — "Past crosswalk at ⟨current frame time⟩?", recording
that frame's time (§3). Once a mark exists the button becomes "Change past
crosswalk to ⟨frame⟩?" and asks for confirmation (the existing mark is shown,
and changing it means you think that time is wrong) before a later rider's
frame replaces it. The arrival
timelapse opens on the frame nearest the ferry's arrival (the peak lineup).
The non-taggable terminal departure timelapse shows the current frame's time
as a plain label instead.

## 3. Crosswalk tagging (the labeling pipeline)

The timelapse player **is** the tagging tool. The rider steps (◀ / ▶) to the
frame where cars reach the crosswalk and presses the center button ("Past
crosswalk at ⟨that frame's time⟩?") — recording **that frame's capture
time**, not the moment they tapped. That makes the label exact: every frame before it
is a clean negative, every frame from it on a clean positive.

Each confirmation is appended to the **`lineupReports`** collection
(`useLineupReport.js`; rules mirror `capacityHistory` — public read,
authenticated create, `userUid` must match). The `onLineupReport` trigger
stamps `crosswalkFullAt` (epoch ms) onto the sailing's `sailingStatus` doc —
the **latest tag wins**, so anyone can correct an earlier mark (mirroring
capacity re-tagging). The departures page shows one chip per reporter with
their marked time. The raw reports are the training labels; the exporter
(§5) applies the **same** latest-wins rule via the shared
`functions/lib/lineup-labels.js`, so corrections and deletions propagate
into the training data on the next export (see
[training-data.md](training-data.md)).

## 4. The classifier

A frame either shows cars past the crosswalk line or it doesn't — a fixed
camera, a fixed crop, a binary question. That needs only:

- **Features** (`functions/lib/lineup-features.js`): crop two fixed regions
  (`REGIONS`), downscale each to a grayscale grid (left lane 48×27 +
  crosswalk 24×14), normalize to [0,1], concatenate. The *same module* runs
  at training and inference, so preprocessing can never drift. The regions
  were hand-drawn with the report's ROI picker: the left lane carries the
  strong "long line" signal, the crosswalk region confirms the crossing
  (recall 0.86 → 0.93 in the ROI experiments). A region change invalidates
  trained weights — retrain after touching it.
- **Model** (`functions/models/lineup-classifier.json`): logistic-regression
  weights as JSON, a few KB. Inference is a no-op while `enabled: false`;
  the committed model (v1, trained 2026-07-24) ships **enabled**.
- **Runtime** (`functions/lib/lineup-classifier.js`): loaded once per
  function instance (the 1-minute poll keeps it warm). ~4–5 ms per frame on
  CPU, ~100 frames/day → effectively free.

Inference is hooked into `captureLineupTimelapse`: every captured frame is
classified **in capture order** and fed to the robot's live call
(`crosswalk-robot.js`, 2026-10-13). The robot reports on the FIRST positive
frame (marked `crosswalkChecking`), then checks itself with extra photos one
minute apart instead of waiting for the next 5-minute frame: a positive
check confirms (`crosswalkFullAtAuto` + `crosswalkAutoProb`, stamped with the
first frame's time), a miss earns one more check photo, and two misses
withdraw the report. A confirmed call is still corrected until the ferry is
back at Bowen: a negative frame puts it in doubt and two misses withdraw it
(after arrival a shorter line is just loading, so negatives are ignored).
Check frames must be consecutive: an open check whose last frame is older
than `MAX_GAP_MS` (7 min) restarts or gives up. Every change is appended to
`crosswalkRobotLog`. The base cadence stays 5 minutes — check photos are
saved like any frame. This is
kept **separate** from the
human `crosswalkFullAt` so agreement can be measured before the automatic
value is surfaced anywhere. Human tags labeling frames the model got wrong
are exactly the examples the next training run needs.

Inference also runs as a **capture gatekeeper**: during the 15-minute wait
after the previous departure — and for the *entire cycle* of post-9pm
sailings — `timelapseDecision` returns `classifyFirst: true` and the frame
is fetched + classified without saving; a positive "full to crosswalk"
verdict starts the save pipeline early (see docs/webcams.md, path 3).
Detection is **sticky**: once the robot has a call on the sailing
(`crosswalkRobot`), every frame saves until the arrival stop, negative
verdicts included — they are what withdraws a wrong call — and a human "not
yet" refute doesn't stop the frames (they're cheap and useful for training). A disabled
model skips the probe entirely — no fetch, no capture, identical to the
pre-classifier behavior.

### Dark frames are never classified (2026-09-05; boundary tuned 2026-09-06)

Below `DARK_ELEVATION_DEG = −7°` (`isDarkAt()` in `functions/lib/daylight.js`
— just past civil twilight; −6° proved too pessimistic at dawn, while the
archive shows frames stay visible to about −8° but the model misreads even
visible dusk frames, so −8 waits for a twilight-capable model) the crosswalk
classifier does not run at all — server
(`captureLineupTimelapse`), browser mirror (`useLineupClassifier`, cache key
`v2`), and the trainer's train/test sets and sequence simulation all apply
the same gate. This is the **opposite** of the terminal camera's policy
(night verdicts kept, dark frames only marked), and deliberately so:

- The terminal cam auto-exposes — its night frames look like day and its
  night verdicts proved ~50-for-~50 correct. The community cam genuinely
  goes black: median frame luminance 0.16 at night vs 0.47 by day.
- The model has essentially no labeled dark frames (1 in the 2026-09-05
  export), and in the dark it misreads headlight/streetlight blobs as a
  queue. Of the 26 dark detections in the 45-day archive, **zero** were
  human-confirmed, 9 were explicitly refuted, and 14 sat on sailings riders
  tagged Not Full (a full-to-crosswalk lineup implies ≥75% full).
- The stakes are asymmetric: `crosswalkFullAtAuto` is permanent and sticky,
  so one dark false positive pins a wrong crosswalk time, files a wrong
  robot report, and floods Storage with junk night frames via the sticky
  save.

Consequences: a dark classify-first probe is discarded before any write
(post-9pm cycles go quiet at night — that's the desired behavior; the old
night "detections" were noise), unconditional captures still save their
frames unclassified (riders can tag them, and they build the dark archive a
future night model needs), and a `crosswalkAutoPending` from dusk can never
be confirmed by a dark frame. Twilight itself (−6°…0°) still classifies:
measured recall 1.0 / precision 0.83 on the (small) labeled twilight set,
and the gate analysis (`training-data/experiments/dark-frame-analysis.mjs`)
showed the −6° cut loses no human-corroborated detection. Revisit with a
night model when the winter dark archive is labeled.

### Night: stable-pixel composites (experiment, 2026-10-07)

Tom's idea for the dark months: the community cam doesn't auto-expose and
passing headlights bloom across the frame, so composite a window of frames
and keep only the pixels that are stable, then classify that. Tried offline
on the archived 5-minute frames (`training-data/experiments/stable-composite.mjs`,
review page `training-data/report/stable-composite.html`), on last night's
production frames (`fetch-prod-night.mjs` + `burst-composite.mjs`) and on a
live pre-dawn burst (`capture-burst.mjs`; the camera refreshes every 60 s, so
samples seconds apart are the same frame — a window needs minutes).

Per-pixel composites over a trailing window of 3 frames, scored with the
deployed v4 day model:

| mode | dark frames ≥ 0.7 (of 191 with a window) | day P / R (labelled frames) |
|---|---|---|
| raw | 96 of 275 | 0.932 / 0.926 |
| median | 30 | 0.984 / 0.796 |
| minimum | 16 | 0.946 / 0.911 |
| stable (range < 24 → median, else min) | 19 | 0.943 / 0.909 |

- **Sweeping headlights vanish, stationary lights stay.** Minimum/stable
  composites cut the day model's night false positives ~5× and, even at
  5-minute spacing where a boarding queue itself moves, cost ~1.5 points of
  day recall (the median costs 13 — queue creep). At 1-minute spacing the
  creep is smaller still.
- **A single stopped car survives the composite** and still reads as a
  queue to the day model (one bright spot in the crosswalk box ⇒ p 0.8).
- **The day model is blind at night in both directions.** A real pre-dawn
  queue (2026-10-06 06:10–06:35, cars lined up in the left lane) scored
  p ≤ 0.02 raw *and* composited; blooms score 1.0. Compositing is a cleaner
  input, not a verdict: night needs its own model trained on composites with
  night labels (there are **none** today — no night sailing has a crosswalk
  mark; the only night ground truth is the 26 known-wrong detections).
- **Classify-first means no neighbours at night.** 25 of the 26 known-wrong
  detections were the first saved frame of their run (probes before it were
  discarded), so the archive can't composite them and production couldn't
  either: a night path needs the off-cadence probe frames kept in a small
  in-memory buffer (~230 KB per 640×360 grey frame) and composited at the
  5-minute capture. Contrast stretching (2–98 percentile) only raised false
  positives and is not worth pursuing.

Next, if pursued: night labels (rider crosswalk marks on night sailings via
the boxed timelapse tagger, plus a hand-label page over composites), a
separate night model (`--include-dark` / `--night` in the trainer, strong L2),
then the probe buffer in `captureLineupTimelapse`, flagged off until judged.

**Update 2026-10-17 — the camera is in infrared night mode, not black.** The
"median luminance 0.16" finding above is now bimodal: since late August the
dark frames split into near-black ones (p10 ≈ 0.09, deep night / fog) and
IR-mode frames (p90 ≈ 0.30–0.39, dusk and dawn) in which the lane, the
crosswalk and the queue are clearly visible — see e.g. the 2026-10-13 20:25
sailing's 19:35 frame. So the dusk sailings Tom cares about (the 16:xx–17:xx
Bowen departures are often full and sunset is already before 18:30) are
*classifiable in principle*; what's missing is labels. The archive now holds
46 labeled dark frames (9 past the crosswalk) from rider marks — the night
trainer (`scripts/train-night-classifier.mjs`) runs but can't clear the
floor on 38 train / 8 test frames, and the hand-label page it expects
(`build-dark-label-page.mjs` → `lineup-dark-labels.json`) was never built.
Order of work when this is picked up: label page over IR composites → ~100+
positive dark frames → night model → production gate (currently nothing in
`functions/` loads `lineup-night-classifier.json`).

**Later the same day — the label page exists and the archive is labelled.**
`npm run lineup:dark-label` builds `training-data/lineup-dark-labeling.html`
from every dark community frame on disk: raw frame and its stable composite
side by side (the trainer's exact window rule), day frames of the sailing
greyed for context, labels edited per sailing ("past crosswalk from frame N" — dark or daylight
— / "never"; frames before the pick collapse behind a button) and exported
as `{ frames: {path: 0|1}, crosswalk: {sailingKey: epochMs|null} }` — only
what changed. `npm run lineup:dark-apply-review -- file.json` folds the
dark-frame labels into `lineup-dark-labels.json` and the crosswalk times
into `lineup-crosswalk-hand.json`, which the exporter applies over rider
marks when it labels the day frames (null = never, which like a rider's
refute leaves the frames unlabelled). So a dawn/dusk review feeds both
models.
Claude labelled all 1,007 dark frames (161 sailings) from contact sheets of
those pairs into `lineup-dark-labels-claude.json`, which the night trainer
takes after hand labels and before rider marks (`dataset.labelSources`
records the mix). Result: 36 positive frames on 14 sailings, 943 negative, 4
sailings left unsure; all 46 rider-marked dark frames agree. What the pass
showed: nearly every dark positive is a **pre-dawn 06:15 lineup forming
05:55–06:20**; the 20:25 boats are almost always empty in the dark (two
exceptions), the 05:15 / 21:30+ boats always; the composite reliably removes
headlight sweeps while keeping a standing queue, and the 2026-10-14 rain
frames show it also removes raindrop streaks. Tom reviewed the whole set the same evening and
corrected three of the 14 positives — all 06:15 boats where the pick sat on
the last frame or one too early (commuters arrive in the final minute and
the last frame shows loading, so the 5-minute cadence is coarse exactly
where it matters) — and moved one crossing earlier; the rest were promoted
to hand labels (979, 32 positive, 11 positive sailings) and the confirmed
crossing times went into `lineup-crosswalk-hand.json`. `lineup:train-night`
still cannot clear the floor: the split is by sailing and 11 positive
sailings leave 2 positives held out. The next step is more positive
sailings — the dusk boats once sunset reaches the 16:xx and 17:xx departures
in November, plus the 06:15 every clear morning — and two ideas from the
review: **1-minute frames in the last 15 minutes before a dark departure**
(the crosswalk robot's off-cadence check photos already exist for this; see
`timelapseDecision({ offCadence })`), and **composites for the day model
too**, so stopped cars read differently from moving ones
(`training-data/experiments/day-composite-cv.mjs`). Result, same 5-fold
CV and recency weights as the drift experiment, 4,221 daylight frames
(3,348 with a full 3-frame window at 5-minute spacing):

| day features | P | R | held-out cost | agree | missed | phantoms |
|---|---|---|---:|---:|---:|---:|
| raw frames | 0.937 | 0.886 | 177 | 334 | 64 | 1 |
| stable composite | 0.944 | 0.897 | 192 | 339 | 60 | 3 |

Frame metrics improve a little and four more sailings are caught, but two
extra phantoms (detections on rider-refuted sailings, weighted 10) make the
severity cost worse. Tom reviewed all three phantoms: the two composite-only
ones (2026-08-24 12:35, 2026-09-26 07:30) are real false positives on a
near-empty lot and an empty infrared twilight scene — the riders were right;
the one both variants share (2026-08-13 13:55) was a rider looking at one
row not being full while the line did reach the crosswalk, so it now carries
a hand mark at 13:50 in `lineup-crosswalk-hand.json` and no longer counts
against any model — at 5-minute spacing a moving queue is partly erased
and what survives can look like a standing one. Not adopted for the day
model as-is; worth re-running if the capture cadence tightens to 1 minute,
where the composite loses far less of a real lineup.

### Detection-error severity (2026-09-05)

Not all mistakes are equal: a detection one frame before the rider's mark is
a near-miss, while a detection on a sailing the rider **refuted** ("never
crossed") is a phantom — the worst failure, because `crosswalkFullAtAuto` is
permanent. The trainer therefore evaluates the sequence rule by
**time-distance from the human word**, not just frame accuracy. Each
≥2-frame sailing lands in one bucket — `phantom` (detected but refuted),
`early30`/`early10` (≥30 / 10–30 min before the mark), `agree` (within
±10 min — one 5-minute cadence step of slack either way), `late10`/`late30`,
`missed` (marked but never detected), `unknown` (detected, no human word) —
and the weighted sum (weights in `SEQ_COSTS`, phantom = 10 … late = 1) is a
single comparable cost per model version, stored in the model JSON under
`metrics.sequence` and shown on the report's predictions section. Refutes
come from `training-data/lineup-reports.json` via the same latest-wins
`effectiveCrosswalk()` rule the app uses (deleted reports skipped).
`training-data/experiments/boundary-weight-experiment.mjs` tests whether
downweighting/excluding boundary frames at training time improves this
profile: on 5-fold CV it trades +6 agreeing sailings and −2 misses for
2× the phantoms, so the trainer's `--boundary-weight` flag stays **off**
by default — re-test when the tagged dataset grows.

### Seasonal drift and recency weighting (2026-10-17)

The light changes faster than the model: v4 (trained 2026-09-06 on July–early
September frames) scored recall 0.93 on summer frames but **0.70 on the
autumn frames tagged after it shipped**, down to 0.37 in the week of
2026-10-12. The misses are not a twilight problem — scored by solar
elevation (`training-data/experiments/lineup-daylight-bands.mjs`), v4's
autumn recall is fine below 15° (≈ 0.90) and collapses at **25–35°
(0.455)**: the 12:00–17:00 sailings, where the autumn sun sits where the
summer sun never did and the shadows on the hill lane look nothing like
July. (Its autumn false positives are the opposite case — dim 06:xx frames.)

Fix: retrain, with the newest frames weighted most. 5-fold CV by sailing
(`training-data/experiments/seasonal-drift-cv.mjs`, held-out severity cost,
summer / autumn / total):

| training weights                 | summer cost | autumn cost | total | phantoms |
|----------------------------------|------------:|------------:|------:|---------:|
| unweighted retrain               | 107         | 97          | 204   | 3        |
| autumn frames ×2                 | 109         | 79          | 188   | 2        |
| last 28 days ×3                  | 119         | 70          | 189   | 2        |
| **1 + 3·e^(−age/21 d)** (default)| 108         | 69          | 177   | 1        |

The trainer now applies that decay by default (`--recent-boost 3
--recent-scale 21`; `--recent-boost 0` restores the old behaviour), with age
measured from the newest frame in the dataset so an unchanged dataset still
reproduces identical weights. v5 is the result: on today's full dataset v4
re-scores at severity cost 339 (12 phantoms, 77 missed) against v5's 170
(2 / 58) — v5's own number is train-contaminated, the CV table is the honest
comparison. Because the nightly job trains with defaults, the live model
will now follow the season instead of freezing at its training month.

**Per-daylight models were tested and don't pay for the crosswalk.** Gating
two or three models by solar elevation (`lineup-daylight-bands.mjs`, same
CV, same recency weights) moves held-out misses from 211 to 197 — within
noise — and *hurts* twilight (recall 0.50 → 0.34) because each gated model
sees fewer of the rare twilight frames. The seasonal shift is handled by
recency; the within-day lighting is not what the single model gets wrong.
Twilight (−7°…0°) is the one band that is genuinely bad in every variant
(precision 0.67, recall 0.50 on 125 frames) and that is a labels problem,
see the night note above.

Also fixed the same day: `evalHistorical` compared the full `regions` JSON
including the display **names**, which were renamed in October, so every
archived version had silently dropped out of the comparison table and out
of nightly champion selection (the "beat every prior version" gate was
vacuous). Both trainers now compare geometry only.

## 5. Training workflow

```bash
# 1. Export/refresh the dataset (see §6 — run this on a schedule!)
npm run lineup:export             # defaults: --project bowen-ferry --days 15

# 2. Train once enough labels exist (~200+ tagged sailings across weather/light)
npm run train                     # BOTH classifiers back-to-back (scripts/train-all.sh);
                                  # each prints its metrics + the prior-model comparison,
                                  # and the shared report ends with both sections complete
npm run lineup:train              # just this one — writes functions/models/lineup-classifier.json
                                  # needs functions deps: cd functions && npm install
                                  # (recency-weighted by default — see §4 "Seasonal drift")
# Notes: identical retrained weights (unchanged data/config) do NOT mint a new
# version; every shipped version is archived in functions/models/history/ and
# a trainer below the 0.8 metric floor exits without writing (reports still
# regenerate).

# 3. Publish — the model activates on the robots' next poll and in the webapp
#    on its next load; no deploy (classifierModels/live in Firestore, see
#    schema.md). --dry-run shows what would move; --lineup N / --terminal-cars N
#    pin or roll back a version from functions/models/history/.
npm run models:publish              # staging
npm run models:publish:production
```

The bundled `functions/models/*.json` remain the fallback a deploy ships
(used until a pointer exists, and whenever the pointed-at version is refused),
so commit them too — but a functions deploy no longer changes which model
is live. Both runtimes refuse a live model whose crop geometry differs from
the deployed feature code (`functions/lib/model-geometry.js`), which is what
makes an ROI change safe: the new code keeps running the old model until a
model trained on the new crops is published.

The **exporter** archives the raw `lineupReports`, joins them with frame
timestamps using the app's own latest-wins rule
(`functions/lib/lineup-labels.js` — frames at or after the sailing's
effective `crosswalkAt` are positive) and downloads frames into
`training-data/` (gitignored):

```
training-data/frames/<storage path>    the JPEGs
training-data/manifest.csv             path,sailingKey,ts,label,crosswalkAt
training-data/lineup-reports.json      raw reports archive
```

It is incremental — existing files are skipped, manifest rows are merged
(labels recomputed each run from current tags) — and needs no credentials
(everything it reads is public). Full contents:
[training-data.md](training-data.md).

The **trainer** is plain-JS gradient descent (seconds on a laptop, no
Python). It splits train/test **by sailing** — frames within one sailing are
near-duplicates, so a frame-level split would leak and inflate metrics — and
refuses to write a model with test precision or recall below 0.8 (override
with `--force`). The written model carries its metrics and training date.

Every training run (of either trainer, even when the metric floor blocks
the model) regenerates the **classifier-results pages** — shared builders in
`scripts/lib/classifier-report.mjs`:

- **`index.html`** — summary of BOTH classifiers: plain/expert method
  descriptions, metrics, learned weight maps, links to the example pages.
- **`crosswalk.html`** — every labeled lineup frame as a card (photo with
  region overlays, human answer, model probability, per-frame "explain"
  dialog), the predicted crosswalk times with before/after photos, filters
  (correct/misclassified, label, split), and the ROI picker.
- **`terminal.html`** — same card layout for terminal frames, plus the
  ferry not-full verdicts with context/confirming photos.
- **`composites.html`** (`npm run lineup:composites-page`, also run by the
  nightly cron) — how the night composites work, with real windows from the
  archive: the frames that went in, the composite, and a map of the replaced
  pixels, for hand-labelled dark crossings, the biggest headlight sweeps, and
  windows where the colour/infrared guard dropped a neighbour; plus the day
  and terminal experiment numbers.

Two copies of the set: **`training-data/report/`** (local, full-size
photos) and **`public/classifier-results/`** (ships with the webapp at
`/classifier-results`, not linked from the app UI; committed thumbnails
under `thumbs/`, since originals vanish from Storage after 42 days — commit
and deploy the webapp to publish).

## 6. Operations: the export cron

**Frames are deleted from Storage after 42 days.** Labels live forever in
Firestore, but the pixels don't — if the exporter doesn't run at least every
six weeks, tagged frames are lost to training. Set it up on any workstation:

```bash
crontab -e
# weekly, Mondays 03:30 — well inside the 42-day retention window
30 3 * * 1 /path/to/ferry-mirror/scripts/cron-export-lineup-dataset.sh
```

`scripts/cron-export-lineup-dataset.sh` wraps the exporter with a cron-safe
PATH, a lock against overlapping runs, and dated logs under
`training-data/logs/` (pruned after 60 days). Check
`training-data/logs/export-<date>.log` if the dataset stops growing.

### Nightly auto-training (champion selection)

`scripts/cron-nightly-train.sh` goes further than the weekly export — it
exports, retrains **both** classifiers with `--auto`, and lets the results
decide what's live:

- the fresh candidate is **always archived** to `functions/models/history/`,
  win or lose (a losing candidate may be vindicated by more data later),
- **all** archived versions are re-scored on today's held-out split and the
  best becomes `functions/models/<name>.json` — crosswalk by lowest sequence
  severity cost (ties by precision+recall), terminal-cars by highest frame
  F1 (ties by precision),
- every decision is appended to `training-data/nightly-runs.json` and shown
  on the **nightly.html** results page (linked from the report index),
- the metric floor doesn't apply in `--auto` — beating every prior version
  on the same data is the stronger gate,
- the regenerated classifier-results pages (index / crosswalk / terminal /
  nightly + thumbs) are **published to the results bucket**
  (`scripts/deploy-classifier-results.sh --production`; needs `gcloud auth`
  on the cron machine) so `/classifier-results` in the app shows each
  night's run — set `FERRY_RESULTS_TARGET=staging` or `skip` to override,
- the **model** is not published unless asked: set
  `FERRY_MODELS_TARGET=production` (or `staging`) and the job ends by
  running `functions/publish-classifier-models.js`, moving
  `classifierModels/live` to whatever champion selection left in
  `functions/models/` — the robots switch on their next poll, the webapp on
  its next load. Default `skip`: a human runs `npm run models:publish:production`
  after looking at nightly.html. Either way no functions or webapp deploy is
  involved any more.

```bash
crontab -e
# nightly 03:00 — replaces the weekly export line (this runs the export too)
0 3 * * * /path/to/ferry-mirror/scripts/cron-nightly-train.sh
```

Logs land in `training-data/logs/train-<date>.log`.

## 7. Ferry-fullness signals (terminal-cars classifier)

A second, fully independent classifier answers a different question from the
**Bowen terminal camera's** departure timelapse: *are there cars waiting in
the frame?* Its purpose is a one-way "the ferry left **not full**" signal:

- **Frame-level supervision** (2026-08-16): riders answer "were cars waiting in
  THIS photo?" per frame, in the robot's frame-check dialog, stored in
  `frameLabels` (see [schema.md](../schema.md)). This exists because the
  classifier predicts a property of one frame while a capacity tag describes a
  whole sailing — a sequence label can't say which frame was misread, so it can
  score a verdict but never train the model. The dialog scores the frames
  locally and steps the rider to the ones the model is **unsure** about (p
  between the two thresholds), where a human answer is worth most. The
  sequence-level capacity buttons stay: both facts are useful, they just answer
  different questions. Hand labels win over rider labels; conflicts are dumped
  to `training-data/rider-label-disagreements.json` rather than dropped (see
  [training-data.md](training-data.md)).
- **Boxes, progress, "enough"** (2026-10-07): the dialog draws the model's
  own regions and masks over the photo (`RoiOverlay.vue`, geometry straight
  from the model JSON) and dims the rest, and asks *"any vehicles inside the
  waiting or loading for the ferry inside the highlighted boxes?"* — riders had been
  tagging cars outside the ROI, which the model can't see, and the frame
  often shows cars leaving in the other lane, which are not a lineup. Frames are walked in a deterministic order
  (`src/lib/tagging-progress.js`): the undecided frames of the tail first
  (the last `FULL_TAIL_FRAMES`, where both verdict rules are decided —
  "undecided" is unsure or weak cars below `FULL_CONFIDENT_P`), then the
  robot's unsure frames, then the rest. Human answers override the robot's
  read and are run through the same `terminalEmptyFrameTs` /
  `terminalFullAtDeparture` rules, so the dialog can say "N more to decide".
  The Yes / No buttons sit between the step arrows directly under the photo
  (short labels; the rider's own answer is the filled button), with the frame
  time, progress line and question below. The robot's read of the frame on
  screen is a chip on the photo, scored frame by frame as the dialog opens
  (current frame first; a frame the proxy can't serve keeps a "no read" chip
  instead of hiding the rest).
  The dialog has no Full / Not Full buttons: the capacity is INFERRED from
  the tags and saved as the rider's capacity report the moment one of their
  answers decides it, with a one-line reason. A rider's answer on the
  departure (last) frame outranks the robot's rules — vehicles waiting there
  means full when the lineup had reached the crosswalk; without that they
  probably rolled up late after loading closed, so the dialog asks the rider
  to confirm (full, or late arrivals = it had room) instead of deciding; an
  empty last frame with an empty one before it means not full even when no
  cars were seen first. Home-page past Bowen rows
  with frames but no fullness carry a "Was it full? Help tag it" nudge into the same
  dialog, and the per-sailing dialog shows one boxed frame per camera.
- **Sunrise is where it fails; a sun-up/sun-down pair would fix most of it**
  (2026-10-17). Scored by solar elevation on the 1,370 rider-labelled frames
  (`training-data/experiments/terminal-daylight-bands.mjs`), v5's errors
  were overwhelmingly *false cars* between civil twilight and 8° — 06:00–08:59
  Vancouver, precision 0.59–0.65 against 0.90–0.95 for the rest of the day
  and 0.95 at night, where the street lighting is steady. Night itself is
  fine. Champion selection (`--auto`) then promoted **v7**, the first version
  trained on hand + rider labels (1,769 frames; held-out F1 0.82 vs v5's
  0.789 and v6's 0.786 on the same split — the rider frames are the hard
  "unsure" ones by construction, so these numbers read lower than v5's
  hand-only 0.93/0.79). Separate models by daylight were tested in 5-fold CV
  (`terminal-gated-cv.mjs`, `terminal-gate-sweep.mjs`): a pair split at
  **sunrise (0°, ±6° training overlap)** takes held-out F1 0.906 → 0.928 and
  false cars 98 → 57 (false empties 130 → 117), with the gain almost entirely
  in the below-horizon frames (precision 0.82 → 0.98); gates at 4°/8°/12° do
  slightly worse. **Built the same day as daylight-banded models**
  (`functions/lib/model-members.js`): a model JSON may carry `members`, one
  logistic sub-model per solar-elevation band (`{ name, elevation: { min,
  max }, weights, bias }`, any number of bands), chosen per frame by the
  sun's elevation at capture time; the top-level `weights`/`bias` (trained
  on all bands) stay as the fallback and as what old deploys and the report
  read, and `threshold`/`emptyThreshold`/`regions`/`masks` stay shared so a
  score means the same thing whichever member produced it. Both runtimes
  (`classifyTerminal`/`classifyLineup` take `{ ts }`, `webcam.js` passes the
  capture time; the browser mirrors pass the frame's epoch) and both trainers'
  history re-scoring are band-aware. `train-terminal-classifier.mjs` trains
  members by default (`--bands "-90:0,0:90" --band-overlap 6`; `--bands
  none` for a single model) and prints held-out metrics per band against the
  single weights. **v8** is the first banded model: held-out F1 0.858 vs
  v7's 0.82 on the same split, precision 0.74 → 0.83, with twilight
  precision 0.48 → 1.00 and dark 0.78 → 1.00; the lineup trainer stays
  single-model (bands did not pay for the crosswalk — §4).
- **Composites on the terminal cam** (2026-10-17, Tom's follow-up to the day
  experiment; `training-data/experiments/terminal-composite-cv.mjs`): the
  departure timelapse runs at ~1-minute spacing, so stable-pixel composites
  (native 320×240, the shared `compositeWindow` rule with the saturation
  infrared guard) were tried against raw frames, 5-fold CV by sailing on the
  1,769 labelled frames. As single models they lose — F1 0.906 raw, 0.896
  with a 3-frame (~2 min) window, 0.879 with 5 (~4 min). In daylight the
  movers this camera sees are a mix (cars loading, unloading from the
  arriving boat, and passing on the road), some of which the label counts
  as waiting, so the minimum rule erases evidence as often as noise (25°+:
  false cars 18 → 42); below the horizon the single composite model did
  better (twilight false cars 28 → 15), because there the movers are mostly
  headlight sweeps. **Retested inside the banded design (below): once the
  low-sun band has its own member, raw frames beat composites in every
  band** — banded raw/raw F1 0.928 (dark P 0.99 R 0.85, twilight P 0.97
  R 0.78) vs composite-below/raw-above 0.918 (dark P 0.91 R 0.72) and
  composite-everywhere 0.893. The band split captures what the composite was
  buying, without the erased-car cost. Composites are therefore not used for
  the terminal cam; the experiment stays for re-running if the cadence or
  camera changes.
- **Tail rule, single threshold** (2026-08-16, second revision of the day):
  cars at `p >= threshold` (0.5), else empty, and the confirming empty pair
  must come **after the last solid cars frame**. A stricter per-frame empty
  threshold (0.35 with an unknown band between) was tried first and turned
  out to be the wrong mechanism: it cut coverage of with-room sailings from
  74% to 43% while barely moving precision, because the sweep
  (`training-data/experiments/empty-threshold-sweep.mjs`) showed **every**
  wrong flag had the same shape — an empty window in the *middle* of the
  sailing with cars returning after (loading gap, camera hiccup), which no
  per-frame confidence can catch. Requiring the empty run to sit in the tail
  scored 62% coverage with 0 wrong among 239 tagged flags. The 0.35 band
  survives as `emptyThreshold` in the model JSON, but **UI-only**: it draws
  the grey "unsure" strips and steers the labelling dialog to the frames
  where a rider's answer is worth most.
- **Solid cars vs blips**: a cars frame only counts (for cars-first, and for
  starting a new tail) when an adjacent frame is also cars. An isolated
  single-frame "cars" between empties is likelier a model false positive
  than a real queue: it breaks an empty run but never invalidates a verdict.
- An **empty terminal at departure** means everyone waiting got on →
  `ferryNotFullAuto`. This replaced the old one-way reading: solid cars
  after an empty window now *clear* a stamped verdict (it was mid-sailing),
  server-side too — `captureDepartureTimelapse` deletes the auto fields,
  withdraws the aggregate `nf`, and retracts the robot's own capacity report
  (never a human's). An isolated trailing cars frame still proves nothing.
- **FULL verdict** (2026-08-16, later the same day): the terminal can also
  assert the opposite — the last `FULL_TAIL_FRAMES` (4) frames all reading
  confidently cars (`p >= FULL_CONFIDENT_P`, 0.7 — stricter than the 0.5
  cars call) mean cars were still waiting when the ferry left, **gated on
  the lineup having reached the crosswalk** (robot detection or human mark —
  the standing veto: never crossing means never full). Terminal-end cars
  alone is weak (54–67% precision: the last frames are during loading, so it
  also matches merely-busy sailings); with the crosswalk gate it measured
  **95.7% precision at 87% coverage** of Full-tagged sailings, and the
  misses are riders' "10%" tags — nearly full, never "Not Full". Replaces
  the crosswalk-alone full flagging (65.8% strict precision, 63
  contradictions). Streaming: `terminalFullRun` counter, stamps
  `ferryFullAuto`/`terminalFullProb` + a robot 'Full' capacity report +
  aggregate `fl`; any sub-0.7 frame resets the run and clears a stamped
  verdict (same withdrawal cascade as not-full). Mutually exclusive with
  the tail rule by construction: four confident-cars frames at the end are
  solid cars, so the tail can never hold an empty pair. Three states total:
  **not full** / **full** / **unsure** (neither — the webapp's grey "not
  sure" button, which collects per-frame labels).
- **No crosswalk veto** (tried 2026-08-10, removed 2026-08-16): suppressing
  the empty pair when the lineup had reached the crosswalk was wrong in
  principle — a long line that all boards *is* "everyone waiting got on", so
  the two observations are independent. The crosswalk signal is a veto for
  **full** (no crossing ⇒ definitely not full, `notFullByCrosswalk`), never
  for not-full. Measured cost of removing it at the 0.35 empty threshold:
  precision 98.7% → 96.6%, coverage 40.7% → 43.9%. It had been suppressing
  16 verdicts to catch 4 wrong ones — a 3:1 trade against the correct ones.
  The report still marks these busy-lineup sailings as the interesting case.
- **Cars first, quiet-window exception** (2026-08-11): the pair must come
  after a *solid* cars frame — an empty-from-the-start window may just have
  missed the loading — unless the window is long (`MIN_ALL_EMPTY_FRAMES` =
  10 observed-empty frames, solid cars never seen): those are genuinely
  quiet sailings (riders tag them Not Full / 25%, never Full). Streaming
  state: `terminalCarsSeen`, `terminalCarsPending`, `terminalEmptySeen`,
  `terminalEmptyPending` on the sailingStatus doc.
- **Dark frames are marked, not excluded** (2026-08-11, `lib/daylight.js`):
  below civil twilight the model misreads headlights (~2× daytime error).
  The pixels can't detect night — auto-exposure keeps mean luminance above
  0.35 around the clock — so darkness is solar elevation by the clock.
  Night frames still count in verdicts (a full exclusion was tried and
  rolled back: it silenced ~50 correct night verdicts to remove one wrong
  one); instead the report page marks dark frames (navy band on the score
  strips) and stamps night verdicts with a ⚠ note. The one known-wrong
  flag on record (2026-08-03 21:30) is a night sailing. In winter most
  evening sailings will be dark — a dedicated night model trained on the
  labeled dark archive is the planned fix.
- Independently, if the **crosswalk classifier** never detected the lineup
  past the crosswalk, the ferry was definitely not full — the trainer saves
  this per sailing as `notFullByCrosswalk` in
  `training-data/predictions.json`.
- **Crosswalk tagging, same shape** (2026-10-07): the crosswalk dialog asks
  *"does the lineup reach the crosswalk in this frame?"* with the same Yes /
  No row and no Agree / It-was / Hasn't-passed buttons. The mark is INFERRED
  (`crosswalkProgress` in `src/lib/tagging-progress.js`): the first frame
  answered Yes with a No on the frame before it (or the earliest frame) is the
  crossing — saved as the rider's mark, as "agree" when it is the robot's own
  frame so the training flags still say so; a No on the last frame with no Yes
  is the refute. After each answer the view goes to the one frame that pins
  it, else loops onward through the untagged frames. Answers have no per-frame
  record of their own (the exporter derives per-frame lineup labels from the
  mark, as before).
- **View first, tag on request** (2026-10-07): the sailing dialog's photo
  tiles open the same dialog in a plain view — no boxes, question or buttons,
  just the frames and the robot's chip — with a "Help tag this sailing"
  button; the robot badges and the "help tag it" nudge open it in tagging
  mode. On the home page each dialog lives at a URL query
  (`?sailing=11:15&dir=bowen`, `&robot=fullness|crosswalk[&tag=1]`,
  `&cam=N`), so Back / Close return to the dialog underneath and every state
  is a link; the stacked dialogs are `no-route-dismiss` because of it.

Pipeline (mirrors the crosswalk one, separate everywhere):
`functions/lib/terminal-features.js` (two regions — "near lane" 32×18 and
"far queue" 20×18, redrawn 2026-08-10 via the report page's ROI picker,
still clearing the ebike shop's golf-cart parking spot; features are
per-frame mean-centered because the terminal cam spans day-to-night
lighting) → `functions/models/terminal-cars-classifier.json` (v3, trained
2026-08-10 on 488 labeled frames: 5-fold CV precision 0.94 / recall 0.91;
a lone empty frame misreads ~25% of the time, hence the two-consecutive
confirmation) → `functions/lib/terminal-classifier.js` (runtime, hooked into
`captureDepartureTimelapse`; an empty pair after the last solid cars stamps
`terminalEmptyFrameTs` / `ferryNotFullAuto`, aggregate key `nf`; a lone
empty parks as `terminalEmptyPending`, a lone cars as `terminalCarsPending`,
and solid cars clear a stamped verdict — see the tail rule above). Training:

```bash
npm run lineup:export      # also downloads terminal frames + terminal-manifest.csv
npm run terminal:train     # writes training-data/terminal-labeling.html
# label frames on that page (click: cars / no cars), copy JSON →
#   training-data/terminal-labels.json
npm run lineup:export      # re-joins labels
npm run terminal:train     # trains → functions/models/terminal-cars-classifier.json
```

Planned next: a third classifier on **HSB Camera 1** to estimate how many
cars were left behind at Horseshoe Bay.

## 8. Rollout checklist

1. Deploy (`npm run deploy:all` — rules for `lineupReports` ship with it).
2. Confirm frames appear under `webcams/community/<date>/timelapse/` on
   5-minute marks ≥ 15 min after a departure; post-9 pm boats only get
   frames after a positive crosswalk detection.
3. Set up the export cron (§6).
4. Collect tags for a few weeks; eyeball `training-data/manifest.csv` label
   counts.
5. Train; review printed metrics and the report's predicted-times section;
   `npm run models:publish:production` (no deploy needed).
6. Compare `crosswalkFullAtAuto` vs human `crosswalkFullAt` for a few weeks
   before showing the auto value in the UI.
