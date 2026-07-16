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
- there **is** a later not-yet-departed Bowen sailing today, and it departs
  **before 9 pm** (the 21:30 / 22:30 / 23:30 boats get no timelapse).

Each frame is captured from the community cam, compressed (~40–80 KB,
half-resolution JPEG), stored at

```
webcams/community/<dateIso>/timelapse/<sailingTime>_To HSB_<epoch-ms>.jpg
```

and appended to the sailing's `sailingStatus` doc as `lineupTimelapsePaths`
(via `arrayUnion`). The capture decision uses only in-memory poll data —
zero extra Firestore reads. Frames are public, served with immutable cache
headers, and **deleted after 14 days** by the nightly `cleanupOldWebcams`.

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
their marked time. The raw reports are never deleted: they are the training
labels. ⚠️ Note the exporter (§5) labels frames from the **earliest**
`crosswalkAt` of a sailing, so a correction to a *later* time doesn't yet
supersede the original label in the training data.

## 4. The classifier

A frame either shows cars past the crosswalk line or it doesn't — a fixed
camera, a fixed crop, a binary question. That needs only:

- **Features** (`functions/lib/lineup-features.js`): crop a fixed region of
  interest (ROI), downscale to 48×27 grayscale, normalize to [0,1]. The
  *same module* runs at training and inference, so preprocessing can never
  drift. ⚠️ The ROI is currently a placeholder (lower half of frame) —
  before the first real training run, tune it to frame just the lane up to
  the crosswalk, then retrain (an ROI change invalidates weights).
- **Model** (`functions/models/lineup-classifier.json`): logistic-regression
  weights as JSON, a few KB. Ships **disabled** (`enabled: false`) until a
  trained model is committed.
- **Runtime** (`functions/lib/lineup-classifier.js`): loaded once per
  function instance (the 1-minute poll keeps it warm). ~4–5 ms per frame on
  CPU, ~100 frames/day → effectively free.

Inference is hooked into `captureLineupTimelapse`: every captured frame is
classified, and the first positive frame stamps `crosswalkFullAtAuto` +
`crosswalkAutoProb` on the sailing doc. This is kept **separate** from the
human `crosswalkFullAt` so agreement can be measured before the automatic
value is surfaced anywhere. Human tags labeling frames the model got wrong
are exactly the examples the next training run needs.

## 5. Training workflow

```bash
# 1. Export/refresh the dataset (see §6 — run this on a schedule!)
node scripts/export-lineup-dataset.mjs            # defaults: --project bowen-ferry --days 15

# 2. Train once enough labels exist (~200+ tagged sailings across weather/light)
node scripts/train-lineup-classifier.mjs          # writes functions/models/lineup-classifier.json

# 3. Deploy — the model activates
npm run deploy:functions
```

The **exporter** joins `lineupReports` tags with frame timestamps (frames at
or after the earliest `crosswalkAt` of a sailing are positive) and downloads
frames into `training-data/` (gitignored):

```
training-data/frames/<storage path>    the JPEGs
training-data/manifest.csv             path,sailingKey,ts,label,crosswalkAt
```

It is incremental — existing files are skipped, manifest rows are merged —
and needs no credentials (everything it reads is public).

The **trainer** is plain-JS gradient descent (seconds on a laptop, no
Python). It splits train/test **by sailing** — frames within one sailing are
near-duplicates, so a frame-level split would leak and inflate metrics — and
refuses to write a model with test precision or recall below 0.8 (override
with `--force`). The written model carries its metrics and training date.

## 6. Operations: the export cron

**Frames are deleted from Storage after 14 days.** Labels live forever in
Firestore, but the pixels don't — if the exporter doesn't run at least every
two weeks, tagged frames are lost to training. Set it up on any workstation:

```bash
crontab -e
# weekly, Mondays 03:30 — well inside the 14-day retention window
30 3 * * 1 /path/to/ferry-mirror/scripts/cron-export-lineup-dataset.sh
```

`scripts/cron-export-lineup-dataset.sh` wraps the exporter with a cron-safe
PATH, a lock against overlapping runs, and dated logs under
`training-data/logs/` (pruned after 60 days). Check
`training-data/logs/export-<date>.log` if the dataset stops growing.

## 7. Rollout checklist

1. Deploy (`npm run deploy:all` — rules for `lineupReports` ship with it).
2. Confirm frames appear under `webcams/community/<date>/timelapse/` on
   5-minute marks ≥ 15 min after a departure, and none for post-9 pm boats.
3. Set up the export cron (§6).
4. Collect tags for a few weeks; eyeball `training-data/manifest.csv` label
   counts.
5. Tune `ROI` in `lineup-features.js`; train; review printed metrics; deploy.
6. Compare `crosswalkFullAtAuto` vs human `crosswalkFullAt` for a few weeks
   before showing the auto value in the UI.
