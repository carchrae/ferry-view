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

## The four capture paths

Terminology: a Bowen loading **cycle** runs from one Bowen departure to the
next — the ferry leaves, crosses to Horseshoe Bay and back, **arrives** at
Bowen, loads, and **departs** again.

### 1. Arrival photo — community cam, one shot per arrival

`captureBowenCommunityWebcam`, event-driven: fires when a poll detects an
`Arrived`/`Bowen` event, and is attributed to the **next scheduled Bowen
departure after the arrival time** (the lineup it shows is for that sailing).
Deduplicated per arrival via the `snapshots/latestBowenArrival` singleton;
skipped when the target sailing isn't within 10 minutes of now (stale poll
guard).

### 2. Departure photo — terminal cam, one shot per departure

`captureBowenWebcam`, event-driven: fires when a poll matches a Bowen
departure to a schedule entry. Skipped when the sailing already has a
`webcamSnapshotPath` or the departure isn't recent (10-minute guard).

### 3. Lineup timelapse — community cam, one frame / 5 minutes

`timelapseDecision` captures a frame when **all** of these hold:

- the poll lands on a 5-minute mark (`minute % 5 === 0`) — stateless cadence;
- at least **30 minutes** have passed since the previous Bowen departure
  (before that the lot is mostly empty). Falls back to the last past
  *scheduled* time when the activity log has no departure; no departure or
  past sailing yet today → no capture (kills overnight frames);
- the ferry has **not yet arrived back at Bowen** for this cycle — once it's
  at the dock the lineup is draining onto the boat and the terminal camera
  (path 4) takes over. Arrival is detected by `bowenArrivalForCurrentCycle`:
  the AIS "docked at Bowen" classification is primary (it reflects the
  present, so a late-boarding ferry still counts as arrived); without AIS the
  newest `Arrived`/`Bowen` log event counts if it's at/after the last
  departure;
- there is a later not-yet-departed Bowen sailing today, scheduled **before
  9 pm** (the 21:30 / 22:30 / 23:30 boats get no timelapse);
- frames attribute to the earliest sailing that hasn't departed yet (with a
  30-minute grace so a boat boarding past its scheduled time keeps its own
  frames).

So the lineup timelapse covers **from 30 min after the previous departure
until the ferry arrives back** — typically ~4–8 frames per cycle.

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
- never a sailing more than **60 minutes past its scheduled time** (a
  never-matched ghost entry can't adopt the next cycle's arrival);
- **degraded mode**: when arrival is undetectable at all (AIS out *and* no
  Bowen events in the log), fall back to the legacy schedule-only window
  `T−10 … T+20` — an outage degrades precision, not coverage.

Typical run: arrival → departure ≈ 10–15 frames per sailing.

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

~16 Bowen departures/day; lineup timelapse skips the three post-9 pm boats.

| Path | Count/day | Size/day |
|---|---|---|
| Arrival photos | ~16 | ~1 MB |
| Departure photos | ~16 | ~0.2 MB |
| Lineup timelapse | ~13 sailings × 4–8 ≈ 50–100 | ~3–7 MB |
| Departure timelapse | ~16 × 10–15 ≈ 160–240 | ~2–3.5 MB |

≈ 250–370 files, ~6–12 MB/day → steady state ~100–170 MB under the 14-day
window, inside the free Storage tier. Each timelapse frame also costs one
`sailingStatus` write + one `aggregates/bowenSailings` write, so the arrival
gating above is also the write-cost control.

## Retention

- **Storage: 14 days.** `cleanupWebcams` (daily 00:00 Vancouver) deletes
  everything under `webcams/` with `timeCreated` older than 14 days. The
  window matches the departures page's two-week tagging range.
- **Firestore: forever.** The path arrays, snapshots and tags outlive the
  pixels; a photo-less sailing older than 14 days simply renders without
  images.
- **Training data**: crosswalk labels reference frames by capture time, so
  the lineup dataset exporter must run **at least every two weeks** or tagged
  frames are lost to training — see
  [lineup-classifier.md §6](lineup-classifier.md) for the cron setup.
