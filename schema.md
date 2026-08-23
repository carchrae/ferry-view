# Schema

## Time and Date Format

All times use **24-hour `"HH:MM"`** format (e.g., `"10:35"`, `"15:00"`). Seconds are stripped at the API boundary.

All timestamps use **epoch ms** (`Date.now()`). The only exception is `filledAt` which may be the string `"user_reported"` to indicate a user-submitted report with no known exact time. Firestore `Timestamp` objects are used only where the server sets them (rides, push subscriptions) — these are not ISO strings.

All dates use **ISO `"YYYY-MM-DD"`** format (e.g., `"2026-05-20"`). The API's natural-language date (`"Wednesday May 20th"`) is converted at the boundary. Day-of-week is never stored — derived from the ISO date when rendering.

---

## `ferryStatus/current`

The current ferry state, overwritten on every data change.

| Field | Type | Description |
|-------|------|-------------|
| `dateIso` | string | `"2026-05-20"` — the operating day |
| `vesselName` | string | Current vessel (e.g. `"QUEEN OF CAPILANO"`) |
| `speed` | string | `"0.00"` — knots from AIS |
| `heading` | string | Compass heading |
| `position` | object? | `{ lat, lon }` — vessel WGS84 coordinates from the AIS feed (excluded from the change diff) |
| `aisLocation` | string | `"Bowen"` / `"Horseshoe Bay"` / `"transit"` — terminal the vessel is docked at (stopped within dock radius), else in transit. Drives the position-based arrival/departure fallback |
| `aisLocationSince` | number | Epoch ms when the current `aisLocation` state began (carried forward while unchanged). Lets the frontend show a reliable "Docked for N min" when the atberth log is stale |
| `statusSource` | string | Which mechanism produced the arrival/departure status: `"atberth"` (live log, primary), `"ais-position"` (lat/long + speed fallback), or `"bcferries-scrape"` (BC Ferries website fallback) |
| `currentLateness` | number | Minutes late (negative = early) |
| `latenessDirection` | string | `"to Bowen"` or `"to HSB"` |
| `lastUpdate` | string | `"15:04"` — latest API position time |
| `fetchedAt` | number | `Date.now()` epoch ms |
| `bowenSchedule` | array[] | Schedule entries (see below) |
| `hsbSchedule` | array[] | Schedule entries (see below) |
| `recentActivity` | array[] | Recent departures/arrivals (see below) |
| `deckSpace` | array[] | Deck capacity data (see below) |
| `deckSpaceLastUpdated` | string | `"15:03"` — when deck space was last updated |

### Schedule entry (`bowenSchedule` / `hsbSchedule`)

| Field | Type | Description |
|-------|------|-------------|
| `time` | string | `"10:35"` — scheduled departure time |
| `dangerousCargo` | boolean | Sailing carries dangerous cargo — no cars or passengers (source flag, both schedules) |
| `repositioning` | boolean | Vessel repositioning sailing — no cars or passengers (source flag, `hsbSchedule` only) |
| `deckSpace` | string? | `"Full"` or percentage like `"71%"` (from schedule API directly) |
| `matchedDepartureTime` | string? | `"10:35"` — actual departure time (from recentActivity match) |
| `latenessMinutes` | number? | Minutes late/early (negative = early) |
| `lastCapacity` | string? | `"Full"` or `"100%"` — most recent known capacity |
| `filledAt` | number? | Epoch ms when `lastCapacity` became `"Full"`, or `"user_reported"` |

### Recent activity entry (`recentActivity[]`)

| Field | Type | Description |
|-------|------|-------------|
| `action` | string | `"Departed"` or `"Arrived"` |
| `location` | string | `"Bowen"` or `"Horseshoe Bay"` |
| `time` | string | `"10:35"` — when the event occurred |

### Deck space entry (`deckSpace[]`)

| Field | Type | Description |
|-------|------|-------------|
| `time` | string | `"15:55"` — the sailing time this capacity applies to |
| `direction` | string | `"To Bowen"` or `"To HSB"` |
| `available` | string | `"Full"` or percentage like `"71%"` |

---

## `ferryStatusHistory/`

Historical snapshots of `ferryStatus`, written on every data change. Same schema as `ferryStatus`, plus:

| Field | Type | Description |
|-------|------|-------------|
| `recordedAt` | number | Epoch ms when this record was written |

Auto-generated document IDs.

---

## `sailingStatus/{sailingKey}`

Per-sailing tracking document. Created by `recordDepartureTimes` and `recordCapacityChanges`.

**Document ID**: `{dateIso}_{time}_{direction}` — e.g. `"2026-05-20_10:35_To HSB"`

| Field | Type | Description |
|-------|------|-------------|
| `sailingKey` | string | Same as document ID |
| `sailingTime` | string | `"10:35"` — scheduled time |
| `direction` | string | `"To Bowen"` or `"To HSB"` |
| `dateIso` | string | `"2026-05-20"` |
| `actualDepartureTime` | string? | `"10:35"` — when the ferry actually departed |
| `filledAt` | number? | Epoch ms when full, or `"user_reported"` (user tag with no known fill time) |
| `lastCapacity` | string? | `"Full"`, `"Not Full"` (user-reported: had room, amount unknown), or percent available like `"100%"` |
| `capacitySource` | string? | `"automated"` (scraped), `"user"`, or `"robot"` (terminal classifier's confirmed "Not Full" verdict) — written whenever `lastCapacity` is written. Precedence: automated > user > robot (see `updateSailingStatus`) — automated is authoritative, humans always overwrite robot values. Legacy docs with `lastCapacity` but no `capacitySource` are treated as automated. |
| `webcamSnapshotPath` | string? | Firebase Storage path to departure webcam photo |
| `communitySnapshotPath` | string? | Firebase Storage path to the arrival/lineup photo (community camera), keyed to the departure this lineup predicts |
| `communityArrivalTime` | string? | `"15:00"` — actual arrival time of the ferry in the lineup photo |
| `lineupTimelapsePaths` | string[]? | Storage paths of the lineup timelapse frames (community camera, one per 5 min while the lineup builds — see [docs/webcams.md](docs/webcams.md)) |
| `departureTimelapsePaths` | string[]? | Storage paths of the loading timelapse frames (terminal camera, one per minute from arrival/T−10 until departure) |
| `crosswalkFullAt` | number? | Epoch ms the lineup was full to the crosswalk. Rider marks (latest tag wins, via `onLineupReport`) always overwrite; when no rider has marked, the lineup classifier's confirmed verdict is recorded here as a robot report (`crosswalkSource: "robot"`) |
| `crosswalkSource` | string? | `"user"` or `"robot"` — who produced `crosswalkFullAt`. Absent on legacy docs = user |
| `crosswalkNotYetAt` | number? | Epoch ms of the currently-effective "not yet passed" refute (`recordedAt` of the notYet report). Present only while a refute is the sailing's latest human word: `crosswalkFullAt` is cleared and the classifier may only re-record its verdict when its detection frame is NEWER than this ts (`robotMayFillCrosswalk`). Cleared when a positive mark supersedes the refute |
| `crosswalkFullAtAuto` | number? | Epoch ms of the first timelapse frame the lineup classifier scored positive. Permanent: kept separate from the human tag and never deleted, so human-vs-robot agreement stays measurable even after a rider overwrites the report |
| `crosswalkAutoProb` | number? | Classifier probability behind `crosswalkFullAtAuto` |
| `crosswalkAutoModel` | number? | Version of the lineup classifier model that produced `crosswalkFullAtAuto` (see `classifierModels`) |
| `ferryNotFullAuto` | boolean? | Terminal classifier confirmed the waiting area emptied at departure — tail rule (2026-08-16): two consecutive empty frames after the last SOLID cars frame. NOT one-way anymore: solid cars returning clear the verdict (and these three fields) — the empty window was mid-sailing. Confirmation is also recorded as a robot capacity report (`lastCapacity: "Not Full"`, `capacitySource: "robot"`) unless a user/automated value exists, and withdrawn with the verdict when the robot was the source |
| `terminalEmptyFrameTs` / `terminalEmptyProb` | number? | Confirming empty frame's epoch ms / probability |
| `terminalAutoModel` | number? | Version of the terminal-cars classifier model behind `ferryNotFullAuto` |
| `ferryFullAuto` | boolean? | Terminal classifier confirmed cars were still waiting at departure: the last 4 frames all confidently cars (p ≥ 0.7) AND the lineup reached the crosswalk (`crosswalkFullAtAuto` or `crosswalkFullAt` — never crossing vetoes full). Cleared (with `terminalFullProb`) when a later sub-0.7 frame breaks the run. Also filed/withdrawn as a robot 'Full' capacity report, and mirrored as aggregate key `fl` |
| `terminalFullProb` | number? | The stamping frame's cars probability behind `ferryFullAuto` |
| `terminalCarsSeen` / `terminalEmptySeen` / `terminalEmptyPending` / `terminalCarsPending` / `terminalFullRun` | mixed? | Streaming state for the tail + full rules (webcam.js): solid-cars-seen flag, cumulative observed-empty count, the lone empty/cars frame awaiting its confirming neighbour (`{ ts }`), and the running count of consecutive confidently-cars frames |
| `terminalLastFrameTs` | number? | Capture time of the most recent departure-timelapse frame. Every terminal rule means *consecutive* frames, but the counters above can't tell a real run from one stitched across a capture gap (stalled camera, poll outage) — so a frame more than 3 minutes after this one resets `terminalEmptyPending` / `terminalCarsPending` / `terminalFullRun` rather than confirming them |

---

## `capacityHistory/{autoId}`

Records of capacity changes (both API-reported and user-submitted).

| Field | Type | Description |
|-------|------|-------------|
| `sailingKey` | string | `"2026-05-20_10:35_To HSB"` — links to sailingStatus |
| `capacity` | string | `"Full"`, `"Not Full"` (user-reported: had room, amount unknown), or percent available like `"71%"` |
| `recordedAt` | number | Epoch ms |
| `filledAt` | number? | Epoch ms when full, `"user_reported"` (user tag with no known fill time), or `null` |
| `userUid` | string? | Firebase UID — present only for user-submitted ratings. Creation of a user-submitted record triggers the `onCapacityReport` function, which applies it to `sailingStatus` and refreshes `ferryStatus/current` for today's sailings. |
| `userReport` | boolean? | `true` on user-submitted records only — the leaderboard queries on this flag so automated records never enter the scan |
| `userName` | string? | Reporter display name (null when `anonymous`) |
| `userPhoto` | string? | Resolved avatar URL (null when `anonymous`) |
| `anonymous` | boolean? | Reporter opted to appear as a cat on the leaderboard |

---

## `lineupReports/{autoId}`

Rider-submitted "car lineup reached the crosswalk" marks, plus notYet
REFUTES ("the lineup has NOT passed the crosswalk") — see
[docs/lineup-classifier.md](docs/lineup-classifier.md). Never deleted — they
are the classifier's training labels. The `onLineupReport` trigger stamps the
latest tag onto the sailing's `crosswalkFullAt` (`crosswalkSource: "user"`);
a notYet refute instead clears the sailing's claim (whoever made it) and arms
`crosswalkNotYetAt`, which blocks the robot from re-recording an older
detection. When a rider deletes a report, the latest remaining report wins (a
remaining refute keeps the claim cleared — no robot fallback); with none
left, the sailing falls back to the robot's `crosswalkFullAtAuto` (as
`crosswalkSource: "robot"`) if the classifier had a confirmed verdict.

| Field | Type | Description |
|-------|------|-------------|
| `sailingKey` | string | `"2026-05-20_10:35_To HSB"` |
| `crosswalkAt` | number? | Epoch ms of the timelapse frame the rider tagged (the frame's capture time, not the tap time). `null` on notYet refutes |
| `notYet` | boolean? | `true` = refute: the lineup had NOT passed the crosswalk as of `recordedAt` |
| `refutedAuto` | boolean? | The refute contradicted a robot claim (negative training label). Sibling of `agreedWithAuto`/`disagreedWithAuto` on positive marks |
| `autoAt` / `autoSource` / `autoProb` | | Robot context on agree/disagree/refute reports: the robot's detection ts, `"server"` or `"browser"` classifier, and its probability |
| `recordedAt` | number | Epoch ms the tag was submitted |
| `userUid` | string | Firebase UID |
| `userName` / `userPhoto` / `anonymous` | | As in `capacityHistory` |

---

## `frameLabels/{autoId}`

Rider answers to a **per-frame** question — "were cars waiting in this photo?"
— for Bowen terminal timelapse frames, captured in the robot's frame-check
dialog. These are the terminal-cars classifier's training labels.

Why a separate collection from `capacityHistory`: the classifier predicts a
property of **one frame**, while a capacity tag describes a **whole sailing**.
A sequence-level tag can't say which frame was misread, so it can score a
verdict but can never supervise the model. See
[docs/lineup-classifier.md](docs/lineup-classifier.md) §7.

Read by the training exporter only — no Cloud Function trigger, nothing
derived onto `sailingStatus`. Resolution is `effectiveFrameLabel()` in
`functions/lib/lineup-labels.js`: each rider's latest word counts once, then
majority; a tie leaves the frame unlabeled. Local hand labels in
`training-data/terminal-labels.json` take precedence over rider labels.

| Field | Type | Description |
|-------|------|-------------|
| `framePath` | string | Storage path of the frame, e.g. `"webcams/bowen/2026-08-16/timelapse/11:15_To HSB_1786212623431.jpg"`. **The identity** — the same key the training label files use |
| `sailingKey` | string | `"2026-08-16_11:15_To HSB"`. Query/grouping key only; derivable from `framePath` |
| `carsWaiting` | boolean | `true` = cars were waiting to board in this frame |
| `autoP` / `autoModel` | number? | What the classifier said about this frame when the rider answered: its probability and the model `version`. Records whether the human was correcting the robot, and at what confidence |
| `recordedAt` | number | Epoch ms |
| `userUid` | string | Firebase UID |
| `userName` / `userPhoto` / `anonymous` / `userReport` | | As in `capacityHistory` |

---

## `snapshots/latestBowenDeparture`

Latest departure webcam photo from the Bowen terminal. Single document, overwritten on each capture.

| Field | Type | Description |
|-------|------|-------------|
| `imageUrl` | string | Public HTTPS URL to the photo in Firebase Storage |
| `sailingKey` | string | `"2026-05-20_10:35_To HSB"` |
| `sailingTime` | string | `"10:35"` — scheduled departure time |
| `dateIso` | string | `"2026-05-20"` |
| `recordedAt` | number | Epoch ms |

## `snapshots/latestBowenArrival`

Latest arrival webcam photo (community camera). Single document, overwritten on each capture (also the per-arrival dedup guard).

| Field | Type | Description |
|-------|------|-------------|
| `imageUrl` | string | Public HTTPS URL to the photo in Firebase Storage |
| `sailingKey` | string | `"2026-05-20_15:15_To HSB"` — the next scheduled Bowen departure after the arrival (the sailing whose lineup the photo shows) |
| `arrivalTime` | string | `"15:00"` — actual arrival time |
| `dateIso` | string | `"2026-05-20"` |
| `recordedAt` | number | Epoch ms |

---

## `snapshots/webcamHealth`

Per-camera stalled-camera status (`functions/lib/webcam-health.js`). A frozen
webcam keeps serving its last good JPEG, so the fetch succeeds and the picture
looks fine — this doc is the only signal that it isn't current. Written **only**
on a break/recover transition or a 15-minute heartbeat while broken, so it
costs effectively nothing in steady state. One sub-object per camera, keyed by
the Storage path segment (`bowen` = BC Ferries terminal cam, `community` =
Bowen Community Centre cam).

| Field | Type | Description |
|-------|------|-------------|
| `{camera}.stale` | boolean | The camera is serving a frozen frame: 3 byte-identical captures in a row, or 2 more than 2.5 min apart (the cameras refresh ~once a minute, so captures that straddle a refresh must differ). While true, that camera's captures and classifier predictions are suspended |
| `{camera}.lastChangeAt` | number | Epoch ms of the last frame whose bytes actually differed — i.e. when the picture last moved |
| `{camera}.staleSince` | number? | Epoch ms when the camera was declared stalled; null while healthy |
| `{camera}.lastCheckedAt` | number | Epoch ms of the write. Clients ignore a `stale: true` older than ~40 min: that's a doc abandoned by a dead poll, not a live outage |
| `{camera}.label` | string | Human-readable camera name for logs and the UI banner |
| `updatedAt` | number | Epoch ms of the most recent write to this doc |

---

## `aggregates/{docId}`

Server-maintained rollups so clients read one doc instead of range-scanning
collections (public read, no client writes). Records use short keys; the
composables expand them.

| Doc | Built by | Contents |
|-----|----------|----------|
| `historicalStats` | `refreshHistoryAggregate` nightly 03:10 (manual seed: `rebuildHistoryAggregate`) | `{ start, end, weeks, updatedAt, sailings[] }` — last 8 weeks of `sailingStatus`, ending yesterday. Record keys: `d`ateIso, `t`ime, `dir`ection, `dep`arture, `cap`acity, `src`, `fa` (filledAt), `cw` (crosswalkFullAt), `cws` (crosswalkSource, only when `"robot"`) |
| `leaderboard` | `recomputeLeaderboard` on capacity/ride triggers + nightly 03:00 (manual: `rebuildLeaderboard`) | `{ reporters[], riders[], updatedAt }` — 30-day ranked boards (max 100 entries each) |
| `bowenSailings` | Incremental upserts from every webcam capture / user report, reconciled by `refreshBowenSailingsAggregate` nightly 03:20 (manual seed: `rebuildBowenSailings`) | `{ start, end, updatedAt, sailings[] }` — last 13 days of To HSB sailings that have media. Record keys: `d`, `t`, `cap`, `src`, `wp`/`cp` (photo paths), `ca` (arrival time), `cw`, `cws` (crosswalkSource, only when `"robot"`), and `lt`/`dt` — timelapse frame **epoch suffixes only** (full Storage paths are deterministic and reconstructed client-side) |

---

## `classifierModels/{name}-v{version}`

Immutable registry of every classifier model version that has shipped — e.g.
`lineup-v1`, `terminal-cars-v2`. Upserted by the Cloud Functions on cold start
(`ensureClassifierModelDocs`, see `functions/lib/classifier-models.js`) from
the bundled model JSONs, so the registry always describes the models actually
deployed. Robot verdicts on `sailingStatus` reference these via
`crosswalkAutoModel` / `terminalAutoModel`, keeping every prediction
attributable to the exact model + training set that produced it.

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | `"lineup"` or `"terminal-cars"` |
| `version` | number | Monotonic, bumped by the training script on each successful run |
| `trainedAt` | string | ISO timestamp of the training run |
| `type` / `threshold` / `regions` / `weights` / `bias` | | The full model, as shipped in `functions/models/*.json` |
| `metrics` | map | `{ train, test, trainFrames, testFrames }` — accuracy/precision/recall on the by-sailing split |
| `dataset` | map? | Training-set snapshot: `{ from, to }` date range, `frames`, `labeledFrames`, `sailings`. Absent on v1 (predates the field) |
| `syncedAt` | number | Epoch ms the doc was written |

---

## `rides/{autoId}`

User-posted ride offers and requests.

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `"offer"` or `"request"` |
| `direction` | string | `"on-bowen"` or `"on-mainland"` |
| `recurring` | boolean | Whether this is a recurring ride |
| `schedule` | string? | Description for recurring schedule |
| `date` | string | `"2026-05-20"` — ride date |
| `sailing` | string | `"17:20"` — sailing time (24h) |
| `authorName` | string | Display name |
| `authorUid` | string | Firebase UID |
| `description` | string | Ride details |
| `contactMethod` | string | `"email"`, `"sms"`, or `"other"` |
| `contactInfo` | string | Contact value |
| `createdAt` | Timestamp | Firestore server timestamp |
| `expiresAt` | Timestamp | Computed expiry |

---

## `pushSubscriptions/{endpointHash}`

Web push notification subscriptions.

| Field | Type | Description |
|-------|------|-------------|
| `endpoint` | string | Push endpoint URL |
| `keys` | object | `{ p256dh, auth }` — VAPID keys |
| `latenessThreshold` | number | Min lateness minutes to notify (default 5) |
| `lastNotifiedAt` | number? | Lateness value at last notification |
| `createdAt` | Timestamp | server timestamp |
| `lastSeenAt` | Timestamp | server timestamp |

---

## Firebase Storage

```
webcams/bowen/{dateIso}/{sailingKey}_{epoch-ms}.jpg                  departure photo
webcams/bowen/{dateIso}/timelapse/{time}_To HSB_{epoch-ms}.jpg       loading timelapse frame
webcams/community/{dateIso}/{time}_To HSB_{epoch-ms}.jpg             arrival/lineup photo
webcams/community/{dateIso}/timelapse/{time}_To HSB_{epoch-ms}.jpg   lineup timelapse frame
```

The `_{epoch-ms}.jpg` suffix is the capture time; clients parse it for frame
time labels. Capture timing, expected daily counts, and volume live in
[docs/webcams.md](docs/webcams.md).

**Retention**: daily cleanup via `cleanupWebcams` (00:00 Vancouver) deletes files with `timeCreated` older than **42 days** (matches the six-week departures-page window). Firestore pointers/tags are kept forever; only the pixels expire — hence the lineup-dataset export cron ([docs/lineup-classifier.md §6](docs/lineup-classifier.md)).
