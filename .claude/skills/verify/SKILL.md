---
name: verify
description: How to build, run, and drive the Bowen Lift ferry app to verify changes end-to-end.
---

# Verifying changes in this repo

## Client (Quasar/Vue PWA in `src/`)

- `npm run dev` — starts against the **staging** Firebase project (world-readable
  Firestore, no auth needed for reads). Picks the next free port from 9000; read the
  "App URL" line from the output.
- Router is **hash mode**: pages are `http://localhost:<port>/#/`, `/#/bowen-departures`,
  `/#/status`, `/#/rides`, `/#/map`.
- Drive with Playwright headless. Gotchas:
  - `waitUntil: 'networkidle'` never fires (persistent Firestore connection) — use
    `domcontentloaded` plus a few seconds' wait for Firestore data.
  - Quasar renders hidden mobile-drawer nav items in the DOM; scope selectors to
    `.q-page` and append `>> visible=true`.
  - History page rows are `.q-page .q-item--clickable`; the expandable per-sailing
    detail is `.date-detail-table`.
- Staging data facts (useful when a probe shows "nothing"): automated deck-space
  capacity only ever lands on `To Bowen` sailings; `To HSB` (Bowen departures) have
  no `lastCapacity` unless a user tagged them. Webcam snapshot paths live on
  `sailingStatus` docs (`webcamSnapshotPath`, `communitySnapshotPath`).
- Staging Firestore can be queried anonymously via REST `documents:runQuery` on
  `projects/bowen-ferry-staging` to check data assumptions.

## Server (Cloud Functions v2 in `functions/`)

- No emulator config. Unit tests: `cd functions && npx vitest run`.
- Real trigger/schedule behavior can only be observed after
  `npm run deploy:functions` (staging) — confirm with
  `npx firebase functions:list --project bowen-ferry-staging`.

## Static checks

- `npm run lint` (client), `npm run build` (webpack compile of the PWA).
