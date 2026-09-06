# Codebase review — 2026-09-06 (overnight)

Five independent reviews ran while you slept: a diff review of tonight's two
commits plus four whole-codebase audits (server capture/classifier pipeline;
Firestore triggers + security rules; Vue client; scripts/training/ops). Every
finding below was verified against the actual code before making this list.
Both test suites pass (137 root + 301 functions) after the fixes.

Two kinds of entries:

- **FIXED tonight** — defects in code written this session (dark gate, owl,
  severity metrics, model history, nightly auto-training). I fixed those
  because they were my own fresh work; everything is in the working tree,
  uncommitted, for your review.
- **OPEN** — pre-existing issues, reported with proposed fixes but NOT
  touched (your call).

---

## Fixed tonight (in the working tree, uncommitted)

1. **Champion selection ranked on training data** — the crosswalk `--auto`
   ranking used severity cost over ALL sailings (~80% in the candidate's own
   train split), so an overfit candidate could dethrone a better champion.
   Now ranked on held-out sailings only (`testCost`); display tables keep the
   full profile. (`train-lineup-classifier.mjs`)
2. **`--auto` could ship ungated** — with no comparable archived version
   (fresh checkout, or a region change invalidating the archive) the
   candidate was the sole contender and went live with zero quality gate.
   Now falls back to the 0.8 metric floor in that case. (both trainers)
3. **Feature-length ≠ compatibility** — archived models were re-scored if
   `weights.length` matched, but an ROI moved without resizing keeps the
   length while changing what every pixel means (has happened: `fe779d2`).
   Re-scoring now requires regions (and, terminal, masks) to match — this
   correctly dropped terminal v3's re-score, which had been computed on
   masked features it never saw. (both trainers)
4. **Duplicate-detection trap** — a manual retrain reproducing an
   archived-but-not-live version printed "identical — no new version" and
   silently left the OLDER model live (the repo was in exactly this state:
   live v5, archive v6). Now: identical to the live model → no-op; identical
   to an archived twin → that version is made live. Terminal `identicalTo`
   also now compares `emptyThreshold`. (both trainers)
5. **Dark frames counted as evidence** — `notFullByCrosswalk` in
   predictions.json used the raw frame count, so an all-dark sailing read as
   "definitely left not full"; the severity profile likewise scored all-dark
   sailings as model "misses". Both now count classifiable (non-dark) frames
   only. Dark labeled frames also no longer render report cards with
   train/test badges. (`train-lineup-classifier.mjs`)
6. **Terminal trainer had no corrupt-JPEG guard** — one truncated frame in
   Storage (two already exist for lineup, 2026-08-22) would crash every
   nightly run forever. Same skip-and-warn guard as the crosswalk trainer.
7. **Cron failures were silent** — cron mails on *output*, not exit codes,
   and both cron scripts redirected everything into the log. On failure they
   now emit a summary + log tail to stderr so `MAILTO=` actually fires.
   (`cron-nightly-train.sh`, `cron-export-lineup-dataset.sh`)
8. **Stale lock disabled the pipeline forever** — a crash/reboot mid-run
   leaves the mkdir lock (trap doesn't run on SIGKILL); every later night
   exited 0 after one log line. Locks older than 12h are now broken
   automatically. (both cron scripts)
9. **No lock between manual and nightly training** — concurrent trainers
   race version numbers (`archiveModel` skip-if-exists would attribute the
   wrong weights to a version) and rewrite manifest/report files under each
   other. All three entry points now share one
   `training-data/.pipeline.lock`; `train-all.sh` fails fast when it's held.
10. **`FERRY_RESULTS_TARGET` failed open** — any typo fell through to the
    `*` branch and published to the PRODUCTION results bucket. Unknown
    values now refuse to publish and fail the job.
11. **Cleanup script under-deleted** — `cleanup-dark-crosswalk.mjs` left an
    orphan `terminalFullProb` when withdrawing a full verdict, and rebuilt
    only `aggregates/bowenSailings`, leaving `aggregates/historicalStats`
    serving the phantom robot data for up to ~a day. Both fixed.
12. **188 MB of production Firestore dumps shipped in every functions
    deploy** — `functions/backup/` (prod dumps with userUids, growing on
    every `staging:refresh`) is gitignored but `firebase deploy` doesn't
    honor `.gitignore`. Added a `functions.ignore` list to `firebase.json`
    (backup, tmp, models/history, test). Deploys get smaller and stop
    uploading prod data snapshots to the GCF source bucket.

---

## OPEN — high severity

### H1. `pushSubscriptions` has no Firestore rule — the push-subscribe UI cannot work
`firestore.rules` has rules for `subscriptions/{userId}` and
`notificationSettings/{userId}` — collections **nothing references**. The
real collection (`usePushSubscription.js` writes `pushSubscriptions/{hash}`,
`lateness.js` reads it) falls through to default deny, so every save from
NotificationSettings throws permission-denied.
**Fix:** replace the two dead blocks with a `pushSubscriptions/{endpointHash}`
rule — tight shape validation (`hasOnly([...])`, string/size caps), `allow
get` but not `list`, and consider requiring auth or moving writes behind a
callable.

### H2. Push cleanup logic is inverted — one notification deletes every valid subscriber
`notify.js` returns `true` on successful send (and non-410 errors), `false`
on 410; `lateness.js` does `if (deleted) doc.ref.delete()`. First real delay
→ every reachable subscriber is deleted after their first push; dead (410)
subscriptions are kept and retried forever. Latent only because
`NOTIFY_ENABLED` isn't set.
**Fix:** return an explicit `'ok' | 'gone'`; delete on `gone`, stamp
`lastNotifiedAt` on delivered; apply the same in the recovery branch.

### H3. Four unauthenticated HTTPS endpoints allow read-cost DoS
`getFerryStatus`, `rebuildBowenSailings`, `rebuildHistoryAggregate`,
`rebuildLeaderboard` (functions/index.js) are publicly invokable with no
auth. One `rebuildHistoryAggregate` hit ≈ 1,700 billed reads; `getFerryStatus`
forces a full refresh with writes and bypasses the staging cost gate.
**Fix:** secret header (`defineSecret`) or restricted invoker on the three
rebuild endpoints; delete or de-fang `getFerryStatus` (the app uses the
Firestore listener, not this endpoint).

### H4. AIS-outage fallbacks are dead code — an AIS feed outage silently stops all terminal frames and capacity verdicts
`api.js:98` sets `aisLocation: atTerminal || 'transit'` — never null — and
`classifyTerminal` returns null for both "in transit" and "no position at
all". So the carefully built degraded-mode branches in `webcam-decision.js`
(log fallback, legacy T−10..T+20 window) can never engage: a dead/frozen AIS
feed reads as "transit" forever, `bowenArrivalForCurrentCycle` returns null,
and the departure timelapse (and with it every robot not-full/full verdict)
stops until the feed recovers.
**Fix:** make "unknown" distinct from "transit": `aisLocation = atTerminal ||
(position != null && isFresh ? 'transit' : null)` — or have the decisions
treat `!isFresh || position == null` as AIS-absent so the fallbacks engage.
Note the degraded-mode tests only pass because they omit `aisLocation`
entirely, a shape the parser never emits — add a test with the real shape.

### H5. Robot-verify "frames no longer available" bug — **FIXED 2026-09-06**
The root cause documented in `docs/robot-verify-missing-frames.md` (the
live-cam stub replacing a departure card that had timelapse frames) is now
bypassed: `loadSailingFrames()` in `useBowenSailings.js` serves frames from
the raw cached records, and HomePage's `openRobotVerify` uses it with the
doc's retry-once-on-empty (one extra aggregate read in the failing case
only). Arrival-card fallback kept for the boarding-sailing shape.

---

## OPEN — medium severity

### M1. `capacityHistory` / `lineupReports` rules validate almost nothing
Client-supplied `recordedAt` is unvalidated → forged far-future values
permanently win every "latest wins" resolution (capacity display, crosswalk
labels, and the training pipeline's ground truth), steal the leaderboard's
first-report credit, and survive re-derives. `userName`/`userPhoto` are
arbitrary (impersonation in the world-readable leaderboard aggregate);
`filledAt` can poison fill-time averages; docs can carry unbounded extra
fields.
**Fix:** `hasOnly([...])` + type/size checks + `recordedAt` within a small
window of `request.time` (mirror the stricter `frameLabels` rule).

### M2. `rides` update rule allows reassigning `authorUid`; no field validation
An owner can rewrite `authorUid` to any uid (leaderboard credit lands on the
victim); `createdAt`/`expiresAt` are unbounded client Timestamps (pin rides
in every listener / leaderboard window forever).
**Fix:** `request.resource.data.authorUid == resource.data.authorUid` on
update; validate type/timestamps/field list.

### M3. `firestore.indexes.json` is missing the rides composite index
The live rides query needs `(expiresAt ASC, createdAt DESC)`; it exists only
console-side. A `deploy --only firestore:indexes` (the documented deploy
order) can delete it and break the rides page.
**Fix:** add the composite to the file.

### M4. Parallel multi-doc deletes race the delete-triggers
`deleteRating`/`deleteCrosswalkMark` delete all the user's docs with
`Promise.all`; each delete-trigger independently re-queries and writes
non-transactionally — orderings exist where a deleted user's value is
resurrected on the sailing.
**Fix:** batch the client deletes into one commit and make the re-derive
transactional (or a single re-derive task per sailingKey).

### M5. Delay notifications scan every subscriber every minute (when enabled)
`checkLatenessAndNotify` runs its `pushSubscriptions` query on essentially
every poll once `NOTIFY_ENABLED` is on (lateness is almost always numeric):
N subscriber reads/minute.
**Fix:** short-circuit below the minimum threshold; keep a single
`aggregates/notifyState` doc so recovery polling costs 1 read.

### M6. `recentActivity` is not newest-first after augmentation
Injected AIS/log-recovery events are `push`ed to the tail, but
`bowenArrivals[0]` / `lastBowenDeparture`'s `find` assume newest-first. In an
atberth-log outage (exactly when AIS injection matters) the community
arrival photo is skipped and the 15-min classify-first wait gate is bypassed.
**Fix:** select by max parsed time instead of array position.

### M7. `lastBowenDeparture` accepts future-parsed times → overnight probe churn, and possible junk writes into yesterday's sailing
At 00:05, yesterday's "Departed 22:00" parses as *today* 22:00 (future), so
overnight polls become classify-first probes; combined with H4-style AIS
degradation and a not-yet-rolled `dateIso`, a sticky sailing from yesterday
can accumulate dark junk frames. `isRecent` also returns true for future
times.
**Fix:** require log-entry times `<= now`; make `isRecent` require
`0 <= age`.

### M8. One-shot photo captures are fire-and-forget under Cloud Run CPU throttling
`captureWebcams` is unawaited; after the handler resolves, CPU is throttled
mid-upload → intermittently missing photos. Retry also rides on
`dataChanged`, contradicting the "next poll retries" comment.
**Fix:** `await Promise.allSettled(...)` in the handler and move the call
above the `!dataChanged` early-return (captures are idempotent).

### M9. Capture merge-writes can clobber concurrent human reports
Both capture paths read the sailing doc, spend seconds uploading, then
merge-write decisions derived from the stale read: a rider's mid-capture
notYet refute can be overwritten by a robot crosswalk report, and the
terminal *withdraw* branch can delete a user capacity tag that landed during
the capture (the stamping side was hardened; the withdrawing side wasn't).
**Fix:** re-read/recheck in a transaction before the auto-field merge.

### M10. Terminal pending can confirm across a classifier-failure gap
`terminalLastFrameTs` is stamped on every saved frame even when
classification failed (verdict null), so the gap guard can't see a 10-minute
run of unclassified frames and a stale pending confirms "everyone got on".
**Fix:** stamp only when a verdict was produced (or gap-check a separate
`terminalLastVerdictTs`).

### M11. Aggregate contract drops `terminalEmptyFrameTs` / `terminalFullProb`
The client reads both (verify dialog opens on the wrong frame; "terminal
empty at h:mm" never renders on the aggregate path) but `sailingToRecord`
never encodes them.
**Fix:** add short keys (`tets`, `tfp`) server-side + expand client-side —
or decide the degradation is acceptable and stop reading them.

### M12. Stale-data overlay is blind across midnight
`HomePage.vue` resolves `lastUpdate` ("23:50") onto *today*, so a feed that
died last evening reads as future → `isStale` false nearly all next day.
**Fix:** subtract 24h when the parsed time is ahead of now by more than a
small margin (same wrap as `latenessMins`).

### M13. Ferry listener fabricates truthy `ferryData` from null
The 60s tick does `{ ...null, updated }` → after one minute of no snapshot
(first visit offline / listen error) the page renders with a truthy-but-empty
object → TypeErrors, and the error banner disappears.
**Fix:** `if (!ferryData.value) return` in the interval.

### M14. Exporter failure mass-tombstones the frameLabels archive
On a transient frameLabels read failure (or the 20k-doc cap), every archived
label is marked `deleted: true` and rider labels vanish from that run's
manifest — the nightly then trains and selects champions on the depleted set.
**Fix:** skip tombstoning when the query failed or hit the cap; exit non-zero
on the failure so the nightly doesn't train on it.

### M15. Public thumbnails grow without bound
The crosswalk trainer thumbnails **every** archived frame (10,063 thumbs /
147 MB and counting), and the bucket rsync never deletes. The terminal
trainer's `referenced`-set approach is the model.
**Fix:** thumbnail only referenced frames; occasional bucket lifecycle/prune.

### M16. Shared sequence rule has no max-gap for stored-frame consumers
`firstSustainedPositiveTs` pairs index-adjacent positives with no time bound;
the browser mirror and trainer (which drop dark frames before sequencing) can
"confirm" from two positives 30+ min apart — a pair the server's 7-minute
pending gate would refuse. Affects browser-stamped detections and makes
trainer severity metrics diverge from production.
**Fix:** add a `maxGapMs` parameter (default one cadence step + jitter) used
by all callers. Design decision — it changes labeled-detection semantics, so
decide before the next retrain.

---

## OPEN — low severity (quick wins)

- **L1** `useRides.js` — `expiresAt > Timestamp.now()` frozen at mount;
  expired rides linger in long-lived tabs. Filter client-side in
  `sortedRides`.
- **L2** `BowenDeparturesPage.vue:363` — `todayIso` frozen at setup; use
  `useToday()` (built for exactly this).
- **L3** `RobotVerifyDialog.vue` — frame-scoring race: a stale response can
  clobber a newer sailing's scores. Token-guard the async run.
- **L4** `LeaderboardPage.vue` — openUser out-of-order fetch mismatch. Guard
  with `selectedUid`.
- **L5** `register-service-worker.js` — deploy = unconditional instant
  reload, killing in-progress tagging. Defer behind a toast/navigation.
- **L6** `useFerryApi.js` — TDZ crash at line 69 (dead module; delete it).
- **L7** `onCapacityReportDelete` re-derive misses legacy reports lacking
  `userReport` flag — query by sailingKey and filter in code.
- **L8** `updateSailingStatus` — non-transactional rank check; `filledAt`
  frozen at first value even when a better source arrives later.
- **L9** `restore-db.js` can't restore `__type:'Date'` values backup-db
  writes (`Timestamp.fromMillis(isoString)` throws). Use `Date.parse`.
- **L10** `fix-permissions.sh` chmods the cron entry scripts to 644 —
  exempt `scripts/*.sh` or re-add +x.
- **L11** Trainer `--out` override is only half-honored (history/version
  numbering still use repo paths; `--auto --out` would pollute the nightly
  log/pages). Derive paths from OUT or forbid the combination.
- **L12** `modelHistory` re-parses all git blobs on every run (4×/night);
  skip the git pass once the directory holds the live version. Also ~90
  lines of ship/selection logic are duplicated between the trainers —
  extract a shared `selectChampion()` helper before they drift.
- **L13** The `2026-08-13 13:55` sailing has a contradictory rider report
  (crosswalk mark + notYet in the same second; the mark agrees with the
  robot) — a `tag-corrections.json` candidate that currently counts as a
  phantom in the severity profile.
- **L14** `staging-refresh.sh` never prunes dated backup dirs (188 MB and
  growing) — prune old `functions/backup/prod-*` dirs.

---

## Verified clean (so you don't have to wonder)

Dark-frame gate server/client/tests all consistent; no trigger loops; no
model-output-as-label leakage anywhere in training; md5 split identical
across both trainers and history re-scoring; `enrich.js`'s
suspicious-looking range query is correct (invisible `` upper bound);
DST-end 2026-11-01 is benign (ambiguity only touches 1–2 a.m. wall times);
stale-camera guards correctly prevent frozen-frame confirms; HomePage
listener/interval cleanup is complete; localStorage caches handle corruption
and model-change invalidation.

## Suggested order of attack

1. Security/cost trio: H1 + H2 + H3 (+ M1/M2/M3 while in the rules file).
2. H4 + M6/M7 together — one coherent pass over AIS/log freshness in the
   capture decisions, with tests using the real parser shape.
3. H5 (fix is already written in the doc) + M12/M13 client one-liners.
4. M16 decision before the next model deploy.
5. The rest opportunistically; L-items are mostly one-liners.
