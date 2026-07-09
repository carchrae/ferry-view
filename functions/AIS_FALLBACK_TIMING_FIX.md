# AIS fallback timing fix (deferred)

Status: **not applied** — written up for possible later implementation.

## Symptom

The AIS-position fallback works, but it engages too late. A sailing whose departure
happened just before the fallback turned on gets frozen as unknown (`'?'`).

Observed: the 11:15 sailing was marked unknown even though correct AIS coordinates were
being received and the vessel was correctly classified at the terminal.

## Root cause

Two independent clocks race, and detection loses:

- `augmentFromAisPosition` (in `functions/lib/ais-position.js`) is **stateful**. It emits a
  `Departed`/`Arrived` event only at the single poll where it first observes the
  terminal↔transit transition (e.g. Bowen→transit, ~1–2 min after the ferry sails), **and
  only when `usingFallback` is already true**.

- `isDepartureLogStale` (in `functions/lib/bcferries-departures.js:78`) has a **15-minute
  grace**: a scheduled sailing isn't counted as past-due (and so doesn't flip
  `usingFallback` on) until 15 min after its scheduled time.

So for the 11:15 sailing: the ferry leaves Bowen ~11:16 and the Bowen→transit transition
poll happens then — but `usingFallback` doesn't flip true until ~11:30. Once the fallback
finally engages, the AIS state is steady again (`prev === current`), so
`augmentFromAisPosition` emits nothing. The `Departed Bowen` event is never recorded, so
matching (`functions/lib/matching.js:19-20`, which consumes only `Departed` events) finds
no departure and the sailing freezes as `'?'`.

The existing code comment already flags the fragility: the AIS source is "STATEFUL (fires
once per terminal↔transit transition), so a missed poll loses that event permanently."

## Fix

Decouple AIS transition **detection** from the fallback **gate**:

1. Detect transitions and append them to a small **persisted rolling buffer** (`aisEvents`)
   **every poll**, regardless of `usingFallback`.
2. **Inject** that buffer into `recentActivity` only when `usingFallback` is true (with the
   existing HSB-departure suppression when the BC Ferries scrape is healthy).

That way a transition observed before the grace elapsed is still available once the
fallback engages, and injection is stateless/idempotent (re-injected each fallback poll,
self-healing) — matching the BC Ferries scrape's pattern.

### Why this is safe

- `aisEvents` lives in the persisted `ferryStatus/current` doc and is included in the
  change diff (`sanitizeForCompare` in `functions/lib/api.js` does NOT exclude it), so a
  new transition forces a persist and the buffer survives across polls.
- `Arrived` events stay in the buffer too — they're still used for the Bowen community
  webcam capture (`functions/index.js:195`).
- Residual risk: if the atberth log logged a departure just before freezing AND the AIS
  buffer recorded one for the same sailing at a slightly different minute, both land in
  `recentActivity`. `matchDepartures` windowing + `usedDisplays` means one matches and the
  other becomes a logged orphan (`matching.js:88-92`) — bounded, same class of risk the
  single-injection code already had.

## Suggested code changes

### 1. `functions/lib/ais-position.js` — replace `augmentFromAisPosition` with two functions

```js
/**
 * Record Arrived/Departed events derived from a change in the AIS-position
 * classification since the previous poll into a persisted rolling buffer.
 *
 * Runs EVERY poll, independent of whether the departure-log fallback is engaged. That
 * decoupling is the point: isDepartureLogStale only flips the fallback on ~15 min after a
 * sailing's scheduled time (its grace period), but the vessel leaves a terminal — and the
 * terminal->transit transition that marks its departure — within a minute or two of
 * sailing. Buffering transitions as they happen keeps the event available once the
 * fallback finally engages (see injectAisEvents).
 *
 * @param {string} prevLocation previous poll's aisLocation token (may be undefined).
 * @param {string} currentLocation this poll's aisLocation token.
 * @param {Array} priorEvents the buffer carried forward from the previous poll.
 * @param {object} now dayjs-like (only `.format('HH:mm')` is used).
 * @param {string} dateIso today's date; stamped on new events and used to prune stale ones.
 * @returns {Array} the updated buffer (old-day events pruned, new transition appended).
 */
export function recordAisTransitions(prevLocation, currentLocation, priorEvents, now, dateIso) {
  // Prune to today only, so the buffer can't grow without bound across days.
  const events = (Array.isArray(priorEvents) ? priorEvents : []).filter((e) => e.dateIso === dateIso)

  // No usable prior state, or no change -> nothing to record.
  if (!currentLocation || !prevLocation || prevLocation === currentLocation) return events

  const time = now.format('HH:mm')
  const push = (action, location) => {
    if (events.some((e) => e.action === action && e.location === location && e.time === time)) return
    events.push({ action, location, time, dateIso })
  }

  if (prevLocation !== 'transit') push('Departed', prevLocation)
  if (currentLocation !== 'transit') push('Arrived', currentLocation)

  logger.log(`AIS-DIAG transition ${prevLocation} -> ${currentLocation} @ ${time}`)
  return events
}

/**
 * Inject buffered AIS-position events (see recordAisTransitions) into data.recentActivity,
 * mirroring the atberth log's {action, location, time} shape so matching can recover
 * departures the frozen log never logged. Called only while the departure-log fallback is
 * engaged. Stateless and idempotent: re-injects the whole deduped buffer every fallback
 * poll, so a transient miss self-heals — like the BC Ferries scrape.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.emitHsbDepartures=true] inject Departed/Horseshoe Bay events. Set
 *   false when the BC Ferries scrape (authoritative, self-healing HSB source) is working.
 * @returns {number} count of events added to recentActivity.
 */
export function injectAisEvents(data, aisEvents, { emitHsbDepartures = true } = {}) {
  const seen = new Set((data.recentActivity || []).map((e) => `${e.action}_${e.location}_${e.time}`))
  let added = 0
  for (const ev of aisEvents || []) {
    if (ev.action === 'Departed' && ev.location === 'Horseshoe Bay' && !emitHsbDepartures) continue
    const key = `${ev.action}_${ev.location}_${ev.time}`
    if (seen.has(key)) continue
    data.recentActivity.push({ action: ev.action, location: ev.location, time: ev.time })
    seen.add(key)
    added++
  }
  return added
}
```

### 2. `functions/index.js` — call detection every poll, injection only in fallback

Update the import (was `augmentFromAisPosition`):

```js
import { recordAisTransitions, injectAisEvents, classificationDebug } from './lib/ais-position.js'
```

Record transitions every poll, right after `aisLocationSince` is computed (~line 58),
using the previous poll's `aisLocation` from `existingData`:

```js
// Record AIS transitions EVERY poll (independent of the fallback grace) so a departure
// observed before the fallback engages is still available once it does.
data.aisEvents = recordAisTransitions(
  existingData?.aisLocation,
  data.aisLocation,
  existingData?.aisEvents,
  now,
  data.dateIso,
)
```

Then in the `if (usingFallback)` block, replace the `augmentFromAisPosition(...)` call
(~line 123-131) with injection from the buffer:

```js
if (aisUsable) {
  const added = injectAisEvents(data, data.aisEvents, { emitHsbDepartures: !scraperOk })
  if (added > 0) {
    dataChanged = true
    logger.log(`AIS position fallback: recovered ${added} event(s)`)
  }
}
```

### 3. Tests — `functions/test/ais-position.test.js`

Replace the `augmentFromAisPosition` describe block. Cover:

- `recordAisTransitions`: appends `Departed` on terminal→transit; appends `Arrived` on
  transit→terminal; appends both on a terminal↔terminal flip; records nothing when
  unchanged or on first run (no prev); prunes events whose `dateIso` != today; dedups an
  identical event already in the buffer.
- `injectAisEvents`: injects buffered events into `recentActivity`; suppresses
  `Departed`/`Horseshoe Bay` when `emitHsbDepartures: false` (but keeps `Arrived`/HSB and
  the Bowen side); dedups against events already in `recentActivity`.
- Integration-style: record a Bowen→transit transition at 11:16 with `usingFallback`
  false (no injection), then on a later poll with `usingFallback` true confirm
  `injectAisEvents` still surfaces `Departed Bowen @ 11:16` — the regression this fixes.

### 4. Consider

- `isDepartureLogStale` grace (`graceMins = 15`) is unchanged — this fix makes the grace
  no longer cause lost departures, so it can stay as-is for the scrape/display side.
- Optionally exclude `aisEvents` from the change diff and instead force a persist only when
  a transition is actually recorded, if the extra persists become noticeable. Not needed
  for correctness.
