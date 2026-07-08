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
| `cancelled` | boolean | Whether this sailing is cancelled |
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
| `capacitySource` | string? | `"automated"` (scraped) or `"user"` — written whenever `lastCapacity` is written. Automated is authoritative; user tags only fill gaps (see `updateSailingStatus`). Legacy docs with `lastCapacity` but no `capacitySource` are treated as automated. |
| `webcamSnapshotPath` | string? | Firebase Storage path to departure webcam photo |
| `communitySnapshotPath` | string? | Firebase Storage path to the arrival/lineup photo (community camera), keyed to the departure this lineup predicts |
| `communityArrivalTime` | string? | `"15:00"` — actual arrival time of the ferry in the lineup photo |

---

## `capacityHistory/{autoId}`

Records of capacity changes (both API-reported and user-submitted).

| Field | Type | Description |
|-------|------|-------------|
| `sailingKey` | string | `"2026-05-20_10:35_To HSB"` — links to sailingStatus |
| `capacity` | string | `"Full"`, `"Not Full"` (user-reported: had room, amount unknown), or percent available like `"71%"` |
| `recordedAt` | number | Epoch ms |
| `filledAt` | number? | Epoch ms when full, or `null` |
| `userUid` | string? | Firebase UID — present only for user-submitted ratings. Creation of a user-submitted record triggers the `onCapacityReport` function, which applies it to `sailingStatus` and refreshes `ferryStatus/current` for today's sailings. |

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

Latest arrival webcam photo (community camera). Single document, overwritten on each capture.

| Field | Type | Description |
|-------|------|-------------|
| `imageUrl` | string | Public HTTPS URL to the photo in Firebase Storage |
| `sailingKey` | string | `"2026-05-20_15:00_Arrival"` |
| `arrivalTime` | string | `"15:00"` — actual arrival time |
| `dateIso` | string | `"2026-05-20"` |
| `recordedAt` | number | Epoch ms |

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
webcams/bowen/{dateIso}/{sailingKey}_{timestamp}.jpg
webcams/community/{dateIso}/{arrivalTime}_Arrival_{timestamp}.jpg
```

Daily cleanup via `cleanupWebcams` deletes files with `timeCreated` older than 14 days (window matches the `/tag` page's two-week tagging range).
