# Bowen Lift — Project Summary

## Goal
Real-time Bowen Island ferry status with departure tracking, lateness display, push notifications, terminal webcam archival, and ride-sharing board.

## Constraints & Preferences
- Thresholds for on-time/early/late: up to 4 mins early is still ✓; ≥2 mins late is late; ≥6 mins late is red.
- Users may set per-subscriber `latenessThreshold` in `pushSubscriptions` (default `5`).
- Ride request detail page shows contact info to all users (no sign-in gate). SMS contact uses `sms:` protocol.
- Direction labels: "Bowen"/"Mainland" (not "On Bowen"/"On Mainland").
- SailingKey format change (`dateIso` + consistent `normalizeTime` + drop direction) discussed but deferred.

## Key Decisions
- Lateness computation lives in `functions/lib/constants.js`; Vue app imports only notification constants.
- Webcam capture is fire-and-forget (`.catch()` only) so poll latency is not impacted.
- `formatDeckBadge` replaces two separate template functions.
- Ride request contact info is public (no sign-in), uses `sms:` protocol for SMS method.
- SailingKey format normalization discussed twice but deferred both times.
- Webcam images served via Firebase Storage download URL. Storage paths include `_${Date.now()}` timestamp for 1-day TTL cleanup.
- Snapshot image uses plain `<img>` with CSS `aspect-ratio: 16/9` instead of Quasar `q-img` due to zero-height sizing bug.
- Netlify proxy redirect for webcam images disabled while debugging frontend display.
- Daily cleanup function `cleanupWebcams` deletes `webcams/` files older than 1 day (checks `timeCreated` metadata).

## Relevant Files
- `functions/lib/constants.js`: shared lateness helpers and notification defaults.
- `functions/lib/matching.js`: `buildPast`, `buildUpcoming`, `parseDeckSpace`.
- `functions/lib/enrich.js`: `enrichDeckCapacity`, `augmentFromFilledStatus`, `augmentFromCapacityHistory`.
- `functions/lib/helpers.js`: `updateSailingStatus` — does not clear `filledAt` when `null` is passed.
- `functions/lib/record.js`: `recordCapacityChanges`, `recordDepartureTimes` — both generate sailingKeys with inconsistent format.
- `functions/lib/webcam.js`: `captureBowenWebcam`, `captureBowenCommunityWebcam` — multi-sample capture, Firebase Storage upload, snapshot doc update.
- `functions/lib/lateness.js`: notification logic.
- `functions/lib/holidays.js`: BC statutory holiday computation (`getBcHolidays`, `holidayName`, `getImpactedDates`, `getHolidayContext`) — long-weekend awareness; holiday-impacted dates excluded from historical baselines.
- `src/composables/useHistoricalStats.js`: shared history aggregation. `aggregateSailings` groups sailingStatus by direction/day-of-week/time, detects lateness **exceptions** (median+MAD outliers, excluded from averages but retained/flagged), and exposes `getTypical`/`typicalHints` for the home page. Used by both HistoryPage and HomePage.
- `src/pages/HomePage.vue`: `formatDeckBadge`, snapshot dialog with "BI Powered" button (shows departure + arrival snapshots), ride sorting, webcam grid.
- `src/pages/RideDetailPage.vue`: contact info display (no sign-in, supports email/SMS/other).
- `src/pages/PostRidePage.vue`: sailing time normalization on save.
- `src/components/RideCard.vue`: 3-line card with badges, description, author name/Yours.
- `src/components/NotificationSettings.vue`: threshold selector using `LATE_NOTIFY_OPTIONS`.
- `src/composables/usePushSubscription.js`: subscription default threshold.
- `src-pwa/register-service-worker.js`: dev SW unregistration; production auto-reload.
- `src-pwa/custom-service-worker.js`: `SKIP_WAITING` handler.
- `scripts/fix-permissions.sh`: macOS ownership/permissions reset helper.
- `netlify.toml`: context-specific webcam proxy redirects (disabled).
- `firestore.rules`: `snapshots` read rule added.

## Open Issues
1. **Stale `filledAt` bug**: 10:35 AM HSB sailing shows "15% full@9:21" but no corresponding "Full" capacityHistory record. `filledAt` gets set on sailingStatus doc without a "Full" record.
2. **Phantom sailingStatus docs**: e.g. `10:35 am_To HSB` exists for a non-existent sailing. sailingKey format uses inconsistent casing (raw vs `normalizeTime`) creating duplicate docs.
