# Push Notifications Plan

Server-side broadcast push notifications for sailing events. Lets users subscribe to alerts (e.g. "next sailing in 10 min", "sailing delayed", "sailing cancelled") without needing the app open.

## Scope (what we're building)

- Users opt in to push notifications from inside the PWA.
- A server stores subscriptions and sends pushes when ferry events fire.
- Notifications are based on **schedule + ferry status data**, not user location.
- Works on Android/desktop Chromium, Firefox, and iOS 16.4+ (only when installed to home screen — our install banner already covers this prerequisite).

## Out of scope

- Geofencing or "you're near the terminal" alerts (browsers don't support background geolocation).
- Per-user customization beyond a small set of subscription topics.

## Architecture

```
┌─────────────┐  subscribe   ┌──────────────────┐
│ PWA client  │ ───────────► │ Subscriptions DB │
│ (browser)   │              │ (Firestore)      │
└─────┬───────┘              └────────┬─────────┘
      │ permission                    │
      │                               ▼
      │                       ┌──────────────────┐
      │                       │ Push trigger     │
      │                       │ (Cloud Function  │
      │                       │ on schedule +    │
      │                       │ ferry data poll) │
      │                       └────────┬─────────┘
      │                                │ web-push (VAPID)
      │                                ▼
      │                       ┌──────────────────┐
      │                       │ Browser push     │
      │                       │ services (FCM,   │
      │                       │ APNs, Mozilla)   │
      ▼                                │
┌─────────────┐  push event            │
│ Service     │ ◄──────────────────────┘
│ Worker      │
└─────────────┘
      │ showNotification
      ▼
   User sees notification
```

## Tech choices

- **Subscription storage**: Firestore (we already use Firebase via `src/boot/firebase.js`).
- **Push sender**: Firebase Cloud Function in Node, using the [`web-push`](https://github.com/web-push-libs/web-push) library + a generated VAPID keypair stored in Function config.
- **Service worker**: switch `quasar.config.js` `pwa.workboxMode` from `"GenerateSW"` to `"InjectManifest"` so we can author push/notificationclick handlers directly in `src-pwa/custom-service-worker.js` (the file already exists as a stub).
- **Trigger source**: same data Carlos's `bowenferry.ca` API serves us. Either poll it from a scheduled Cloud Function, or — better — have the function ingest the schedule once and fire pushes from cron at scheduled offsets, falling back to polling for delays/cancellations.

## Phases

### Phase 1 — plumbing (no user-facing notifications yet)

1. Generate VAPID keypair (`npx web-push generate-vapid-keys`). Store public key in client env, private key in Cloud Function env.
2. Switch `quasar.config.js` PWA to `InjectManifest` mode.
3. Add `push` and `notificationclick` handlers to `src-pwa/custom-service-worker.js`:
   - `push`: parse `event.data.json()`, call `self.registration.showNotification(title, { body, icon, data: { url } })`.
   - `notificationclick`: focus an existing client or open `data.url`.
4. Add a `usePushSubscription` composable in `src/composables/`:
   - Checks `Notification.permission`, `'serviceWorker' in navigator`, `'PushManager' in window`.
   - Requests permission, calls `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`.
   - POSTs the resulting subscription JSON to the server (or writes directly to Firestore via the SDK we already have).
5. Add a Firestore collection `pushSubscriptions/{endpointHash}` with shape:
   ```
   { endpoint, keys: { p256dh, auth }, topics: [...], createdAt, lastSeenAt, userAgent }
   ```
6. Cloud Function `sendTestPush` (callable, dev only) that pushes to all subs to verify the pipeline end-to-end.

### Phase 2 — UI for opting in

1. Notification preferences card on `HomePage.vue` (or a new settings page) with toggles for the topics we'll support:
   - `next-sailing-10min` (per direction: HSB→Bowen, Bowen→HSB, or both)
   - `delays`
   - `cancellations`
2. iOS gating: if `!isStandalone && isIOS`, show "Install to home screen first" message instead of the toggle (reuse `useInstall.js`).
3. Permission denied state: explain how to re-enable in browser settings.
4. Unsubscribe button that calls `subscription.unsubscribe()` and deletes the Firestore doc.

### Phase 3 — trigger logic

1. Scheduled Cloud Function (e.g. every minute) that:
   - Loads today's published schedule.
   - Fires `next-sailing-10min` topic at T-10 for each scheduled sailing, deduped by sailing ID.
   - Polls the ferry status endpoint, detects new delays/cancellations vs. last poll, and fires those topics.
2. Push fan-out: query subscriptions where `topics` array-contains the topic; send via `web-push` with retry/backoff and prune `410 Gone` / `404 Not Found` endpoints from Firestore.
3. Quiet hours: server-side check (default 10pm–6am Pacific) — skip non-cancellation topics overnight.

### Phase 4 — polish

1. Notification grouping/replacement (use `tag` so a delay update replaces the previous one).
2. Click-through deep links — e.g. delay notification opens `/status`.
3. Analytics: log delivery + open rate (Firebase Analytics events from `notificationclick`).
4. Per-user rate limit (max N pushes per day) to avoid annoyance during outages.

## Key code surfaces

- `src-pwa/custom-service-worker.js` — push + click handlers.
- `quasar.config.js` — `pwa.workboxMode: 'InjectManifest'`.
- `src/composables/usePushSubscription.js` — subscribe/unsubscribe + permission flow.
- `src/pages/HomePage.vue` (or new `SettingsPage.vue`) — UI for topic toggles.
- `functions/` (new directory) — Cloud Functions:
  - `sendPush.ts` — fan-out helper using `web-push`.
  - `triggers/scheduledSailings.ts` — cron, fires "next sailing" pushes.
  - `triggers/ferryStatusPoller.ts` — cron, detects delays/cancellations.
- Firestore: `pushSubscriptions` collection, plus a `pushDedup` collection for "already sent for sailing X" markers.

## Open questions

1. **iOS install friction.** Web push on iOS only works for installed PWAs. Are enough users likely to install? If not, this whole effort delivers value mostly to Android users — worth checking install rate from the existing button before investing.
2. **Backend hosting.** Do we want Cloud Functions, or a tiny Node service somewhere else? Functions is the lowest-friction since Firebase is already wired up, but cold-start latency could matter for time-sensitive "10 min before" pushes. Cloud Run with min-instances=1 is an alternative.
3. **Schedule source.** Where does the canonical sailing schedule come from? If only Carlos's API has it, we depend on his uptime. Worth caching a daily snapshot in Firestore.
4. **Auth.** Subscriptions tied to user accounts (we have `useAuth.js`), or anonymous? Anonymous is simpler but makes "manage subscriptions across devices" impossible.
5. **VAPID key rotation.** Need a documented procedure — rotating the public key invalidates every existing subscription.

## Estimate

- Phase 1: ~1 day (mostly Quasar config + SW + VAPID setup, well-trodden path).
- Phase 2: ~1 day (UI + Firestore writes, gated by Phase 1).
- Phase 3: ~2–3 days (the actual trigger logic, depends on schedule data shape).
- Phase 4: ongoing.

Total ~1 week of focused work for a first usable version (Phases 1–3).
