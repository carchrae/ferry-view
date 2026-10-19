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
- Classifier models may be **daylight-banded**: `members[]` sub-models per solar-elevation band (`functions/lib/model-members.js`), picked per frame by capture time; top-level weights are the all-band fallback. Brightness-era terminal v8 used them; on the texture features they bought nothing (2026-10-18), so both trainers default to a single model (`--bands` opts in) while both runtimes and the browser mirrors keep honouring members.
- Classifier models are **published to Firestore, not deployed**: `classifierModels/live` names the version each robot runs (server `refreshLiveModels` per poll; the poll copies the active versions to `ferryStatus/current.classifierModels`, which the browser mirrors read via `useClassifierModels.js` — no extra client read); `npm run models:publish[:production]` after training. Bundled `functions/models/*.json` are only the fallback. A live model whose crop geometry differs from the deployed feature code is refused (`functions/lib/model-geometry.js`), as is one from another **feature set** (the model file's `featureSet`; both classifiers are `localStd-v1` local-texture since 2026-10-18 — terminal `functions/lib/terminal-feature-math.js`, crosswalk `functions/lib/lineup-feature-set.js` — because brightness features were seasonal on both cameras, `docs/experiments/2026-10-18-season-generalisation.md`) — so a feature-set change is the one case that still ships code and model together (functions + webapp deploy). Training runs on saturn (Tom's desktop), which has the full training data and the cron; the laptop does not train. The three **hand label files are tracked** (`training-data/terminal-labels.json`, `lineup-crosswalk-hand.json`, `lineup-dark-labels.json`; the rest of `training-data/` stays local) — commit them when a labelling pass changes them, so both machines train on the same ground truth.
- **Re-run the rules on the archive before shipping a sailing-rule or model change** (Tom, 2026-10-19): `npm run terminal:replay` (`scripts/replay-terminal-rules.mjs`) replays the current not-full/full rules with the bundled terminal model over every tagged To-HSB sailing on disk, prints coverage and wrong flags per month, and diffs against a saved run with `--baseline`. The not-full rule is **one-way** since 2026-10-19: the first empty pair after loading stands, later cars are late arrivals (the 2026-08-16 tail rule cleared it and withdrew correct verdicts). Never call the lineup road "the lot".
- `formatDeckBadge` replaces two separate template functions.
- Ride request contact info is public (no sign-in), uses `sms:` protocol for SMS method.
- SailingKey format normalization discussed twice but deferred both times.
- Webcam images served via Firebase Storage download URL. Storage paths include a `_${Date.now()}` capture-time suffix (clients parse it for frame time labels).
- Snapshot image uses plain `<img>` with CSS `aspect-ratio: 16/9` instead of Quasar `q-img` due to zero-height sizing bug.
- Netlify proxy redirect for webcam images disabled while debugging frontend display.
- Daily cleanup function `cleanupWebcams` deletes `webcams/` files older than **14 days** (checks `timeCreated` metadata). Capture timing/volume/retention: `docs/webcams.md`.
- Staging cost switch: on `bowen-ferry-staging`, all scheduled functions + Firestore triggers are dormant unless Firestore `control/staging`.activeUntil is in the future — wake with `npm run staging:run-until -- 4h` (see `functions/lib/control.js`). Production is never gated. Trigger gating also stops restore-storms when restoring a prod backup into staging. `npm run staging:refresh [-- 4h]` = force dormant → backup prod → restore into staging → seed missing forecast docs → wake. Incremental: only dated docs since the last copy (cursor in gitignored `functions/backup/staging-copied-at`, 2-day overlap; first run takes 30 days, `--days N`/`--full` override); keeps the newest 5 local backups.

## Agent Environment
- **Scratchpad**: use `/scratchpad/` (gitignored) for all temporary files — throwaway
  scripts, screenshots, logs, intermediate data. Don't use `/tmp` or the session temp dir.
  `npm run playwright:install` puts a local `playwright` there (Chromium in
  `~/.cache/ms-playwright` on Linux, `~/Library/Caches/ms-playwright` on macOS) for
  driving the dev server headless — see `.claude/skills/verify`. Tom runs that install.
- **Admin scripts**: any local script that connects to Firestore/Storage with admin
  rights must use `connectAdmin(projectId, { storage })` + `detectProjectId()` from
  `functions/script-auth.js` — never call `initializeApp`/`applicationDefault()` directly.
  It uses the `firebase login` account by default (no key file needed) and falls back to
  firebase-admin with the JSON key when `GOOGLE_APPLICATION_CREDENTIALS` is set.
- **Sandbox**: Claude runs sandboxed here, so installing npm packages and running local
  tooling is fine without asking. Deploys are still off-limits (Tom runs those).
- **Experiments are always saved** (Tom, 2026-10-18): every experiment gets its script in
  `scripts/experiments/` (tracked; caches under gitignored `training-data/experiments/`),
  a write-up in `docs/experiments/YYYY-MM-DD-<slug>.md` (Question · Setup · Results ·
  Conclusion · What changed · Files), images in `docs/experiments/img/`, and a row in
  `docs/experiments/README.md` the same day. Never leave results only in chat.

## Relevant Files
- `functions/lib/constants.js`: shared lateness helpers and notification defaults.
- `functions/lib/matching.js`: `buildPast`, `buildUpcoming`, `parseDeckSpace`.
- `functions/lib/enrich.js`: `enrichDeckCapacity`, `augmentFromFilledStatus`, `augmentFromCapacityHistory`.
- `functions/lib/helpers.js`: `updateSailingStatus` — does not clear `filledAt` when `null` is passed.
- `functions/lib/record.js`: `recordCapacityChanges`, `recordDepartureTimes` — both generate sailingKeys with inconsistent format.
- `functions/lib/webcam.js`: single photos (`captureBowenWebcam`, `captureBowenCommunityWebcam`) + timelapses (`captureLineupTimelapse`, `captureDepartureTimelapse`) — multi-sample capture, Storage upload, sailingStatus/aggregate/snapshot doc updates, and `logAttribution` (per-capture "attributed to X, Nm late" logging). See `docs/webcams.md`.
- `functions/lib/webcam-health.js`: stalled-camera detection — cross-capture frame hashing, `snapshots/webcamHealth` publishing. A frozen camera serves valid-looking bytes forever, so capture AND classifier inference are suspended per-camera while it repeats. See `docs/webcams.md` §Stalled cameras; client side is `src/composables/useWebcamHealth.js`.
- `functions/lib/webcam-decision.js`: pure capture-attribution logic (`timelapseDecision`, `departureTimelapseDecision`, `scheduleWindowEnd`-based windowing, `scheduleAttributionDebug`) — no Storage/logger/sharp deps, so it's imported directly by both `webcam.js` and the client's staging debug-info capture (`src/pages/HomePage.vue`) to verify sailing/photo attribution live.
- `functions/lib/lateness.js`: notification logic.
- `functions/lib/seasonal-schedule.js`: BC Ferries seasonal schedule (HSB-BOW page, both directions, behind a queue-it waiting room) is the source of truth for which sailings run. Scraped nightly (`refreshSeasonalScheduleDaily`, 00:05) into `snapshots/seasonalSchedule` as the weekly timetable with its "Except …" holiday notes (~10 KB); `functions/lib/seasonal-rules.js` (pure, shared with the client) works out any date in the published range. The poll swaps it in for bowenferry.ca's schedule (keeps feed deck space + repositioning runs; falls back to the feed when today is missing) and puts today's + tomorrow's skipped sailings on `ferryStatus/current.scheduleCancellations` for the home-page ticker; the Today dialog's day picker reads the doc once, on demand. Seed it (and `aggregates/holidayStats`) right after a functions deploy with `npm run production:seed-forecasts` / `npm run staging:seed-forecasts` (`functions/seed-forecasts.js`).
- `src/lib/holiday-forecast.js`: holiday / long-weekend forecast rules (holiday kinds, fullness from same-kind holidays, lateness from ordinary days) over `aggregates/holidayStats`. Provisional — evidence, open questions and revisit checkpoints in `docs/holiday-forecasts.md`; backtest with `node scripts/holiday-backtest.mjs`.
- `functions/lib/holidays.js`: BC statutory holiday computation (`getBcHolidays`, `holidayName`, `getImpactedDates`, `getHolidayContext`) — long-weekend awareness; holiday-impacted dates excluded from historical baselines.
- `src/composables/useHistoricalStats.js`: shared history aggregation. `aggregateSailings` groups sailingStatus by direction/day-of-week/time, detects lateness **exceptions** (median+MAD outliers, excluded from averages but retained/flagged), and exposes `getTypical`/`typicalHints` for the home page. Used by both HistoryPage and HomePage.
- `src/components/goats/`: the leaderboard's Bowen GOATs dialog — scene simulation (`goat-scene.js`), wildlife, sky, buses, party music/fireworks (`goat-party.js`); tests in `tests/goats/`.
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
