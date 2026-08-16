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
classified **in capture order**, and the lineup counts as past the crosswalk
at the first positive frame that the *next* frame confirms (a lone positive
is noise — the rule is `firstSustainedPositiveTs()` in `lineup-labels.js`;
the streaming version parks the candidate as `crosswalkAutoPending` and
stamps `crosswalkFullAtAuto` + `crosswalkAutoProb` with the FIRST frame's
time once confirmed, clearing the candidate on a negative frame). "Next"
means strictly consecutive: a pending older than one cadence step
(`PENDING_CONFIRM_MAX_MS`, 7 min) can't confirm — intervening frames may
have been negative without a trace — and is replaced by the current frame
as a fresh candidate. This is
kept **separate** from the
human `crosswalkFullAt` so agreement can be measured before the automatic
value is surfaced anywhere. Human tags labeling frames the model got wrong
are exactly the examples the next training run needs.

Inference also runs as a **capture gatekeeper**: during the 15-minute wait
after the previous departure — and for the *entire cycle* of post-9pm
sailings — `timelapseDecision` returns `classifyFirst: true` and the frame
is fetched + classified without saving; a positive "full to crosswalk"
verdict starts the save pipeline early (see docs/webcams.md, path 3).
Detection is **sticky**: once `crosswalkFullAtAuto` is set for the sailing,
every 5-minute frame saves until the arrival stop, negative verdicts
included — and since the auto field is permanent, a human "not yet" refute
doesn't stop the frames (they're cheap and useful for training). A disabled
model skips the probe entirely — no fetch, no capture, identical to the
pre-classifier behavior.

## 5. Training workflow

```bash
# 1. Export/refresh the dataset (see §6 — run this on a schedule!)
npm run lineup:export             # defaults: --project bowen-ferry --days 15

# 2. Train once enough labels exist (~200+ tagged sailings across weather/light)
npm run lineup:train              # writes functions/models/lineup-classifier.json
                                  # needs functions deps: cd functions && npm install

# 3. Deploy — the model activates
npm run deploy:functions
```

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
   deploy.
6. Compare `crosswalkFullAtAuto` vs human `crosswalkFullAt` for a few weeks
   before showing the auto value in the UI.
