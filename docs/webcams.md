# Webcam Capture — Timing, Volume & Retention

The canonical description of when the app captures webcam photos, how many it
takes, where they go, and how long they live. All capture logic is in
`functions/lib/webcam.js`, driven by the 1-minute `pollFerryStatus` cron in
`functions/index.js` — capture decisions use only in-memory poll data (zero
extra Firestore reads per decision).

## The two cameras

| Camera | Source | Frame size | Stored as |
|---|---|---|---|
| **Bowen terminal** | BC Ferries `cam1_bow.jpg` | ~14 KB, low-res | uncompressed (preserves detail for future ML) |
| **Community** (Bowen Community Centre) | `snapshot.jpg` | 1280×720, ~400 KB | half-resolution JPEG q80, ~40–80 KB |

Every capture takes **3 samples 1 s apart** and keeps the best frame (a frame
that appears at least twice wins — a stable image beats a mid-refresh tear —
else the largest). Files are public with immutable cache headers (the
timestamped names never change).

## Stalled cameras

Both cameras burn a clock into every frame, so two genuinely fresh captures can
never be byte-identical. When a camera freezes, though, its server keeps
serving the last good JPEG: the fetch succeeds, the bytes are a valid image,
and every consumer downstream happily "works" — we upload the same picture into
the timelapse every cycle and run the classifiers on a photo of the past. That
is worse than no frame at all, because the verdicts it produces are
indistinguishable from real ones, and `crosswalkFullAtAuto` is **permanent and
sticky**: one detection off a frozen frame pins a wrong "full to crosswalk"
time on the sailing and turns every later probe into an unconditional save.

`functions/lib/webcam-health.js` hashes the frame `pickBestFrame` chose —
before compression, so the comparison is independent of sharp's encoder — and
compares it to the previous capture from the same camera. **Both cameras
refresh about once a minute**, which is what makes a repeat meaningful, and
gives two rules:

- `STALE_IDENTICAL_FRAMES` (3) — for the departure timelapse, which captures
  once a minute against a once-a-minute refresh. Sampling can land twice inside
  a single refresh and see the same frame twice; it can't do that three times.
- `CONCLUSIVE_GAP_MS` (2.5 min) — for everything slower: the lineup timelapse
  (one per 5 min) and the one-shot arrival/departure photos. Two captures that
  far apart straddle at least one refresh, so a single repeat is already
  conclusive and waiting for a third would just cost minutes. At the lineup
  cadence this is what does the detecting.

So a frozen terminal cam is caught in ~2 minutes and a frozen community cam on
its first repeat. Getting this wrong in the "stalled" direction is cheap —
recovery is immediate, since the very next differing frame clears it, so a
false positive costs one skipped capture. Getting it wrong the other way means
predictions built on a photo of the past, which is expensive and invisible.
That asymmetry is why the rules lean aggressive.

While a camera is stalled, all four of its capture paths bail immediately after
the fetch — no Storage upload, no Firestore write, **no classifier call**. The
fetch still happens, because it's the only way to notice the camera recovering.
Each path's dedupe guard is left untouched (`webcamSnapshotPath` unset, the
arrival singleton unchanged), so the next poll retries and the photo lands as
soon as the picture moves again.

State lives in a per-instance cache mirrored to `snapshots/webcamHealth`, read
once per cold start and written only on a break/recover transition or a
15-minute heartbeat while broken — so detection costs no reads or writes in
steady state. The client reads that doc (`src/composables/useWebcamHealth.js`)
and shows a banner over the home page's camera grid plus a "Stuck" badge on the
affected tile; a `stale: true` whose `lastCheckedAt` is older than 40 minutes is
ignored, since that's a doc abandoned by a dead poll rather than a live outage.
Cloud Functions logs carry `"Webcam stalled: …"` / `"Webcam recovered: …"` on
each transition and a per-skip warning naming the path and how long the picture
has been frozen.

**Consecutiveness across an outage.** Every terminal rule ("two consecutive
empty frames", "4 confidently-cars frames") means consecutive *in time*, but
the streaming state is just counters on the sailing doc — they can't tell a
real run from one stitched across a gap. `terminalLastFrameTs` closes that:
a frame more than 3 minutes after the previous one resets `terminalEmptyPending`
/ `terminalCarsPending` / `terminalFullRun` instead of confirming them, so the
first frame back after an outage starts a fresh run rather than asserting an
agreement that never happened. Already-confirmed verdicts and cumulative facts
(`terminalCarsSeen`, `terminalEmptySeen`) are unaffected. The lineup classifier
already had this guard as `PENDING_CONFIRM_MAX_MS`.

Related hardening in `captureSamples`: a non-2xx response or a zero-length body
is discarded rather than kept as a sample. `pickBestFrame` prefers the
*largest* buffer when no two samples match, so an HTML error page could
outweigh a real 14 KB terminal JPEG and get stored as a `.jpg`.

## The four capture paths

Terminology: a Bowen loading **cycle** runs from one Bowen departure to the
next — the ferry leaves, crosses to Horseshoe Bay and back, **arrives** at
Bowen, loads, and **departs** again.

### 1. Arrival photo — community cam, one shot per arrival

`captureBowenCommunityWebcam`, event-driven: fires when a poll detects an
`Arrived`/`Bowen` event, and is attributed to the **sailing the arrival
serves** (`arrivalLineupTarget` in `functions/lib/webcam-decision.js`): the
first schedule entry that departed — or is still due to depart — after the
arrival. This mirrors the lineup timelapse's windowing, so the photo lands on
the same sailing as the frames even when the ferry docks after that sailing's
scheduled time (late boarder) — the old "next scheduled time after the
arrival" rule shifted a late ferry's photo onto the *next* sailing, splitting
it from its timelapse. Deduplicated per arrival via the
`snapshots/latestBowenArrival` singleton; skipped when the **arrival event**
is more than 10 minutes old (stale poll guard — gating on the sailing's
scheduled time instead would skip any ferry running >10 min late).

### 2. Departure photo — terminal cam, one shot per departure

`captureBowenWebcam`, event-driven: fires when a poll matches a Bowen
departure to a schedule entry. Skipped when the sailing already has a
`webcamSnapshotPath` or the departure isn't recent (10-minute guard).

### 3. Lineup timelapse — community cam, one frame / 5 minutes

`timelapseDecision` captures a frame when **all** of these hold:

- the poll lands on a 5-minute mark (`minute % 5 === 0`) — stateless cadence;
- at least **15 minutes** have passed since the previous Bowen departure
  (before that the lot is mostly empty; sailings that fill up do so early, so
  the window opens well before the lineup peaks). Falls back to the last past
  *scheduled* time when the activity log has no departure; no departure or
  past sailing yet today → no capture (kills overnight frames).
  **Classify-first probe:** during that 15-minute wait (on the same 5-minute
  cadence, all other conditions holding, model enabled) the frame is still
  fetched and run through the crosswalk classifier *without saving*; a
  positive "full to crosswalk" verdict starts the save pipeline early, so
  overload days keep their earliest frames. Detection is **sticky**: once
  `crosswalkFullAtAuto` is set for the target sailing (confirmed two-frame
  detection — permanent, so a human "not yet" refute doesn't stop the
  frames; rider tags land post-sailing and are not a live trigger), every
  probe frame saves regardless of its own verdict, until the arrival stop.
  A negative non-sticky probe costs one `sailingStatus` read (the sticky
  check) and zero writes/Storage; with the model disabled the probe does
  nothing and the old behavior is exact;
- the ferry has **not yet arrived back at Bowen** for this cycle — once it's
  at the dock the lineup is draining onto the boat and the terminal camera
  (path 4) takes over. Arrival is detected by `bowenArrivalForCurrentCycle`:
  the AIS "docked at Bowen" classification is primary (it reflects the
  present, so a late-boarding ferry still counts as arrived); without AIS the
  newest `Arrived`/`Bowen` log event counts if it's at/after the last
  departure;
- there is a later not-yet-departed Bowen sailing today. Sailings scheduled
  **at/after 9 pm** never capture unconditionally — their whole cycle runs
  classify-first instead (the 21:30 / 22:30 / 23:30 boats get frames only
  when the crosswalk classifier detects a full lineup, sticky as above, so a
  late busy evening boat still gets a record from first detection until
  arrival);
- frames attribute to the earliest sailing that hasn't departed yet — however
  late it's running, right up until its **schedule window** closes (see
  "Attribution windowing" below).

So the lineup timelapse covers **from 15 min after the previous departure —
or earlier, from the first classifier-positive probe — until the ferry
arrives back** — typically ~7–11 frames per cycle; post-9pm sailings cover
**from first detection until arrival**, or nothing on a quiet night.

### 4. Departure (loading) timelapse — terminal cam, one frame / minute

`departureTimelapseDecision` captures every poll for the first unmatched
sailing when:

- the window is open: `now >= T−10 min` (scheduled time minus 10), **and**
- the ferry **has arrived** at Bowen for this cycle — the effective start is
  `max(arrival, T−10)`, so a late ferry doesn't burn frames on an empty berth;
- capture continues **until the ferry actually departs** (the poll stamps
  `matchedDepartureTime` on the schedule entry, at which point the target no
  longer matches and capture stops on its own).

Safety bounds for when detection fails:

- at most **30 minutes after the effective start** (missed departure can't
  capture forever);
- never a sailing whose **schedule window** has closed (a never-matched ghost
  entry can't adopt the next cycle's arrival — see "Attribution windowing"
  below);
- **degraded mode**: when arrival is undetectable at all (AIS out *and* no
  Bowen events in the log), fall back to the legacy schedule-only window
  `T−10 … T+20` — an outage degrades precision, not coverage.

Typical run: arrival → departure ≈ 10–15 frames per sailing.

## Attribution windowing

Both timelapse decisions (path 3 and path 4) need to answer "which sailing is
this frame for?" using only the schedule + the arrival/departure log — there's
no ground truth to check against until much later. Early versions used a flat
wall-clock ceiling (30 min for the lineup, 60 min for the departure timelapse)
to stop an old, never-matched schedule entry from soaking up frames forever.
That backfired the first time the ferry ran **more than 30–60 minutes late**:
once a sailing crossed the ceiling, both functions gave up on it mid-boarding
and started stamping new frames onto the *next* scheduled sailing instead —
frames land on the wrong sailingKey, and the mismatch isn't visible until
someone looks at the departures page and sees the crowd/photo for the wrong
time slot.

The fix (`scheduleWindowEnd` in `functions/lib/matching.js`, used by both
decision functions in `functions/lib/webcam-decision.js`) replaces the flat
ceiling with a **schedule-relative** one: an unmatched entry stays "in play"
until 5 minutes before the *next* scheduled entry's time (or +90 min for the
day's last sailing). This mirrors the windowing `buildPast` already uses to
attribute a `Departed` event to a schedule slot (same file), just applied
prospectively. A sailing can now run arbitrarily late and keep its own frames
— it only loses them once the next sailing's own window opens, i.e. once
there's a genuinely competing candidate.

### Debugging a misattribution

If photos on the Bowen Departures page look like they belong to the wrong
sailing (crowd size or timestamp inconsistent with the labeled time):

1. **Staging debug button** (bug icon, top of the home page, staging only):
   copies a JSON payload to the clipboard containing `webcamAttribution` — a
   live rerun of `timelapseDecision`/`departureTimelapseDecision` against the
   current `ferryData` snapshot, with a per-schedule-entry breakdown
   (`windowEnd`, `windowOpen`, `matchedDepartureTime`, `lateMinutes`) — plus
   `bowenSailings`, the actual most-recently-captured sailing records
   (`sailingKey`, timelapse frame timestamps). Compare a frame's capture
   timestamp against the `windowEnd` of the sailing it's stamped on: if the
   frame's timestamp falls outside that sailing's window, or a later sailing's
   window was already open at capture time, that's the misattribution.
2. **Cloud Functions logs**: every successful capture logs
   `"Lineup/Departure timelapse attributed to {time} ({N}m late)"`
   (`logAttribution` in `functions/lib/webcam.js`), escalated to `warn` past
   45 minutes late — search/filter on this to see exactly which sailing each
   frame was credited to and how late it was at capture time, without waiting
   for a repro.
3. **Reproduce locally**: the staging debug tools also include a "delay
   departures" button (clock icon) that adds cumulative artificial delay to
   `recentActivity` in the dev session, letting you exercise the late-running
   path against `webcamAttribution` without waiting for a real delay.
4. **Regression tests**: `functions/test/timelapse-decision.test.js` and
   `functions/test/departure-timelapse.test.js` pin this behavior, including
   cases well past the old flat ceilings and the ghost-entry exclusion at the
   window boundary.

## Where the photos land

Storage paths (all under `webcams/`, so retention applies uniformly):

```
webcams/bowen/{dateIso}/{sailingKey}_{epoch-ms}.jpg              departure photo
webcams/bowen/{dateIso}/timelapse/{time}_To HSB_{epoch-ms}.jpg   departure timelapse frame
webcams/community/{dateIso}/{time}_To HSB_{epoch-ms}.jpg         arrival photo
webcams/community/{dateIso}/timelapse/{time}_To HSB_{epoch-ms}.jpg  lineup timelapse frame
```

The `_{epoch-ms}.jpg` suffix is the capture time — the client parses it for
frame time labels, and `aggregates/bowenSailings` stores only these suffixes
(paths are reconstructed).

Firestore pointers written alongside each capture:

- `sailingStatus/{key}` — `webcamSnapshotPath` / `communitySnapshotPath` +
  `communityArrivalTime` (singles), `lineupTimelapsePaths` /
  `departureTimelapsePaths` (arrayUnion per frame);
- `aggregates/bowenSailings` — incremental upsert per capture (what the
  HomePage / departures page actually read);
- `snapshots/latestBowenDeparture` / `latestBowenArrival` — singletons,
  overwritten each capture.

## Expected daily volume

~16 Bowen departures/day; the three post-9 pm boats save lineup frames only
after the crosswalk classifier flags a full lineup (usually never).

| Path | Count/day | Size/day |
|---|---|---|
| Arrival photos | ~16 | ~1 MB |
| Departure photos | ~16 | ~0.2 MB |
| Lineup timelapse | ~13 sailings × 7–11 ≈ 90–140 | ~5–10 MB |
| Departure timelapse | ~16 × 10–15 ≈ 160–240 | ~2–3.5 MB |

≈ 280–410 files, ~8–15 MB/day → steady state ~330–630 MB under the 42-day
window, inside the free Storage tier. Each timelapse frame also costs one
`sailingStatus` write + one `aggregates/bowenSailings` write, so the arrival
gating above is also the write-cost control. Classify-first probes don't
change this: a negative non-sticky probe costs one `sailingStatus` read
(the sticky check, ~30–80 reads/day total — negligible next to the poll's
enrichment reads) and no writes or Storage, while a saved probe frame costs
exactly what a normal frame does — at most ~2–3 extra frames per wait gate
on days when the lineup fills early, plus full post-9pm cycles on busy late
nights.

## Retention

- **Storage: 42 days.** `cleanupWebcams` (daily 00:00 Vancouver) deletes
  everything under `webcams/` with `timeCreated` older than 42 days. The
  window matches the departures page's two-week tagging range.
- **Firestore: forever.** The path arrays, snapshots and tags outlive the
  pixels; a photo-less sailing older than 42 days simply renders without
  images.
- **Training data**: crosswalk labels reference frames by capture time, so
  the lineup dataset exporter must run **at least every six weeks** or tagged
  frames are lost to training — see
  [lineup-classifier.md §6](lineup-classifier.md) for the cron setup.
