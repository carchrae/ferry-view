# Robot Verify — "The frames are no longer available to view"

**Status:** FIXED 2026-09-06 — `loadSailingFrames()` in `useBowenSailings.js`
reads frames off the raw cached records, and HomePage's `openRobotVerify`
uses it with the retry-once-on-empty described below (frames no longer come
from the doctored cards). The analysis is kept for the record. Reported
2026-08-24.

The frame-check dialog on the home page intermittently claims a sailing's
photos are gone when they are sitting in the aggregate the whole time. The
cause is a presentation-only transform being read as a data source; the fix is
small but it is easy to fix it the wrong way, so the rejected options are
recorded here too.

## The report

> when loading the photos for a sailing (to confirm robot prediction) it would
> sometimes say no photos available

> the error message was "The frames are no longer available to view" — and when
> i reloaded the stale page, the photos were available, so it was clearly wrong.

And, on the first fix that was attempted and reverted:

> also, force loading every time is wrong when most of the time it works fine
> with the cache. that will cost extra server fees.

## Where the message comes from

`RobotVerifyDialog.vue` renders that line whenever it has no frame to show:

```js
const frame = computed(() => props.frames[index.value] || null)
```

```html
<p v-else class="text-caption text-italic">
  The frames are no longer available to view — trust your memory, not the robot's.
</p>
```

The wording assumes one cause (the frames aged out of Storage). It is reached
by any empty `frames` array — including one that is empty by accident.

## Root cause

`finalize()` in `src/composables/useBowenSailings.js:348` swaps the newest
sailing's departure card for a live-camera stub:

```js
const newest = built[0]
if (newest && newest.dateIso === todayIso && newest.arrival && !newest.departure?.imageUrl) {
  newest.departure = {
    imageUrl: `${BOWEN_TERMINAL_CAM_URL}?t=${Date.now()}`,
    sailingKey: newest.sailingKey,
    live: true,
  }
}
```

The stub has no `timelapse` property, and the guard is `!newest.departure?.imageUrl`
— not `!newest.departure`. So it also fires when `buildCards` has *already*
built a real departure card out of timelapse frames (`:99-107` sets
`imageUrl: null` when there is no `webcamSnapshotPath` but frames exist). The
assignment replaces that card and drops the frames.

`HomePage.vue:1401` reads exactly the field that was just discarded:

```js
frames: (kind === 'crosswalk' ? s.arrival?.timelapse : s.departure?.timelapse) || [],
```

`undefined || []` → empty array → no frame → "no longer available". The frames
were never missing; the only copy the dialog could reach was overwritten.

## Why it is intermittent

The stub applies to `built[0]` only — the newest sailing that has a photo —
and only while that sailing has an arrival photo but no departure **photo**.
That is precisely the window in which departure frames accumulate:

| | Written by | When |
|---|---|---|
| `departureTimelapsePaths` | `captureDepartureTimelapse` | T−10 min → T+30 min (`DEPARTURE_PRE_MIN` / `DEPARTURE_CAP_MIN`, `webcam-decision.js:181`) |
| `webcamSnapshotPath` | `captureBowenWebcam` | at departure, gated on `isRecent(…, 10 min)` (`webcam.js:144`) |

So for roughly 10–25 minutes per sailing — longer whenever a departure capture
is skipped for a stale camera — the newest sailing has frames, no departure
photo, and therefore a stub in place of its card. Tapping **Front of lineup**
on the sailing you just rode inside that window fails every time.

This also explains the reload: by the time the page was reloaded the departure
photo had landed, so `finalize` no longer stubbed the card. The reload itself
changed nothing — a reload *inside* the window fails identically, which is the
cheapest way to confirm this diagnosis before changing code.

## Who is affected

- **Home page, "Front of lineup" (`kind: 'fullness'`)** — the reported path.
  `openRobotVerify` is the only caller that reads `departure.timelapse` off a
  card that may be stubbed.
- **Not the departures page.** `BowenDeparturesPage.vue:209,250` reads the same
  field, but `SailingTagCards.vue:150` guards with
  `v-if="departure.timelapse && departure.timelapse.length"` — the components
  that render the card already treat the stub as a known frames-less shape.
- **Home page, "At crosswalk" (`kind: 'crosswalk'`)** has a narrower version of
  the same hole: `s.arrival?.timelapse` is null when a sailing has a departure
  photo but no lineup frames at all. Same message, rarer, different cause.

## Proposed fix

The dialog wants *raw frames for a sailing*. It is currently reading them out
of a display card that has been deliberately doctored for the card's own
rendering rules. Give it a data-level accessor instead.

In `src/composables/useBowenSailings.js`, export a helper over the same cached
raw records that already back `loadBowenSailings` — no extra reads:

```js
// Raw timelapse frames for one sailing, straight off the aggregate record.
// Deliberately NOT read from the built cards: finalize() replaces the newest
// sailing's departure card with the live-camera stub, which has no timelapse
// (that substitution is a rendering choice — a live view beats minutes-old
// frames — and must not decide what the verify dialog can reach).
export async function loadSailingFrames(dateIso, sailingTime, force = false) {
  const t = normalizeTime(sailingTime)
  const r = (await fetchRawSailings(force)).find(
    (x) => x.dateIso === dateIso && normalizeTime(x.sailingTime) === t,
  )
  if (!r) return null
  return {
    lineup: buildTimelapse(r.lineupTimelapsePaths),
    departure: buildTimelapse(r.departureTimelapsePaths),
  }
}
```

`HomePage.vue`'s `openRobotVerify` keeps its card lookup for the scalar fields
(capacity, crosswalk, labels) and takes only the frames from the new helper:

```js
const raw = await loadSailingFrames(todayIso, t)
// …
frames: (kind === 'crosswalk' ? raw?.lineup : raw?.departure) || [],
```

`HomePage.vue` already imports `normalizeTime` (`:847`); `useBowenSailings.js`
does not — add it to the existing `functions/lib/time.js` import on line 3.

### Optional second step, if empties still show up

Once the frames come from the raw record, an empty array genuinely means "the
cached snapshot has no frames for this sailing" — which can still happen for up
to `CACHE_TTL_MS` (5 min) on a sailing whose first frames just landed, because
the home page holds no live subscription to `aggregates/bowenSailings` (only
`BowenDeparturesPage.vue:1276` does).

Retry once, only when the answer looks wrong:

```js
let raw = await loadSailingFrames(todayIso, t)
const wanted = kind === 'crosswalk' ? 'lineup' : 'departure'
// One extra doc read in the failing case only — never on the happy path.
if (!raw?.[wanted]?.length) raw = await loadSailingFrames(todayIso, t, true)
```

**Do not** pass `force` unconditionally. It bills an aggregate doc read on
every dialog open to repair a case that is usually already correct — the wrong
trade for this app (see `docs/firestore-optimization.md`).

### Rejected alternatives

| Option | Why not |
|---|---|
| Spread the old card into the stub (`{...newest.departure, live: true, imageUrl: liveUrl}`) | `SailingTagCards.vue:150` renders `LineupTimelapse` **in preference to** `imageUrl`, so the card would show minutes-old frames instead of the live view — exactly what the stub exists to prevent (`useBowenSailings.js:340-347`). |
| Move the live-view choice into the template (keep `timelapse`, add `liveImageUrl`, let the card prefer it when `departure.live`) | The correct long-term shape — the model stops being lossy — but it changes the card's `v-if` order and touches both pages that render it. Worth doing on its own, not as a bug fix. |
| Force-refresh on every open | Rejected on read cost, above. |

## Also worth fixing, separately

**The message asserts a cause it cannot know.** Frames genuinely disappear only
via `cleanupOldWebcams` (42-day retention, `webcam.js:677`). Anything newer
with no frames never had them. The dialog has `sailingKey`, which encodes the
date (`${d}_${t}_To HSB`), so it can tell the two apart:

- older than `BOWEN_SAILINGS_DAYS` → "these photos have aged out — they're only
  kept for six weeks"
- otherwise → "no frames from this camera for this sailing"

**`expandAggregateRecord` drops fields the dialog reads.** `:128-152` omits
`terminalEmptyFrameTs` and `terminalFullProb`, but `openRobotVerify` reads
`s.terminalEmptyFrameTs` for `robotAt` and for the `claim`. Only the degraded
direct-scan path (`:205`) supplies them, so on the normal aggregate path the
fullness dialog always opens on the *last* frame rather than the robot's own
frame. May be deliberate — worth a decision either way.

## Verifying the fix

1. During a sailing's loading window (arrival photo present, no departure photo
   — the card shows the **Live** badge on the departures page), open the home
   page's typical dialog for that sailing and tap **Front of lineup**. Before
   the fix: "no longer available". After: the terminal frames step normally.
2. Reload inside the same window and repeat — the failure must reproduce
   before the fix, confirming the cache is not the cause.
3. Check the read count is unchanged on the happy path: opening the dialog
   should still serve `fetchRawSailings` from its module cache.
