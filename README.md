# Bowen LIFT (`bowen-lift-ferry`)

A community-built companion app for the **Bowen Island ↔ Horseshoe Bay ferry**
(the Queen of Capilano). Bowen LIFT shows live sailing status and lateness,
terminal webcams and lineup timelapses, and lets riders tag what they see —
how full the ferry left, and the moment the car lineup backed up past the
crosswalk. Those tags feed a leaderboard, and they double as training data for
two tiny on-device ML classifiers ("the robot") that learn to make the same
calls automatically. There's also ride sharing (offer/request a lift — it's in
the name) and push alerts.

Live app: <https://app.bowenlift.com>

## Overview

- **Live departures & history** — sailing-by-sailing status from the ferry
  API, enriched with AIS position, actual departure/arrival detection, and
  lateness tracking across the day.
- **Webcams & timelapses** — four capture paths (arrival/departure photos,
  lineup/loading timelapses) captured server-side each minute and stored
  publicly; see [docs/webcams.md](docs/webcams.md).
- **Rider tagging** — capacity reports ("Full", "Not Full", …) and crosswalk
  marks (the timelapse player doubles as the tagging tool). Reports earn
  leaderboard credit; disagreements resolve by plurality.
- **The robot** — two logistic-regression classifiers over webcam pixels:
  - *Crosswalk*: has the car lineup backed up past the crosswalk, and when?
  - *Terminal-cars*: did the terminal empty before departure (ferry left
    **not full**)?

  Both run server-side at capture time **and** in the browser (no backfill
  needed), and surface as "Robot says…" suggestions riders verify, agree
  with, or correct — every answer becomes more training data. See
  [docs/lineup-classifier.md](docs/lineup-classifier.md) and the in-app
  results pages at `/classifier-results`.

## Architecture

```
BC Ferries / bowenferry.ca API / AIS ──┐
Bowen webcams (municipality + BCF) ────┤
                                       ▼
                     Firebase Cloud Functions (functions/)
                     · pollFerryStatus — 1-minute poll: status, webcam
                       captures, timelapses, classifiers, aggregates
                     · Firestore triggers — reports, leaderboard, cleanup
                                       │
                 ┌─────────────────────┼──────────────────────┐
                 ▼                     ▼                      ▼
          Firestore (docs,      Cloud Storage           JSON models
          aggregates, rules)    (webcam photos,         (ship with the
                 │              42-day retention)       functions deploy)
                 ▼
     Vue 3 + Quasar PWA (src/) — deployed on Netlify
     · reads aggregates (1 doc read per page), Storage images via
       same-origin /webcam/* proxy (netlify.toml + generated _redirects)
     · browser-side classifiers mirror the server models exactly
```

Two Firebase projects: `bowen-ferry` (production) and `bowen-ferry-staging`;
the client picks its config from the `PRODUCTION` env var at build time.
Data schema: [schema.md](schema.md).

## Core modules

**Cloud Functions (`functions/`)** — `index.js` wires the triggers; logic
lives in `lib/`:

- `api.js`, `ais-position.js`, `bcferries-departures.js` — ferry status
  sources and change detection.
- `webcam.js`, `webcam-decision.js` — the four capture paths and their
  timing rules; runs both classifiers at capture time.
- `lineup-features.js` / `lineup-classifier.js` and `terminal-features.js` /
  `terminal-classifier.js` — feature extraction (fixed fractional crops →
  small grayscale grids) and logistic-regression runtimes. The same feature
  code runs at training and inference, so there is no train/serve drift.
- `lineup-labels.js` — the shared, dependency-free tag semantics: latest
  mark wins, first-of-two-consecutive-positives (crosswalk), two-consecutive
  empties one-way rule (not-full). Used by triggers, trainers, exporter, and
  the browser.
- `leaderboard-score.js`, `leaderboard-aggregate.js`,
  `bowen-sailings-aggregate.js`, `history-aggregate.js` — scoring and the
  compact aggregate docs the client actually reads.
- `models/*.json` — the trained classifier weights, committed and shipped
  with the deploy.

**Web app (`src/`)** — Quasar pages (`pages/`), reusable components
(`components/` — e.g. `LineupTimelapse.vue` the tagging player,
`RobotSays.vue` the robot suggestions/verdicts UI, `ReportChips.vue`), and
composables (`composables/` — e.g. `useBowenSailings.js` aggregate reader,
`useLineupClassifier.js` / `useTerminalClassifier.js` browser-side models,
`useLineupReport.js` / `useCapacityRating.js` tagging writers). Client code
imports shared logic straight from `functions/lib/` (time, scoring, labels).

**Training pipeline (`scripts/`)**:

- `export-lineup-dataset.mjs` (+ `cron-export-lineup-dataset.sh`) — archives
  frames and raw tags into `training-data/` before the 42-day Storage
  deletion; must run at least every six weeks (weekly cron recommended).
- `train-lineup-classifier.mjs` / `train-terminal-classifier.mjs` — plain-JS
  gradient descent, by-sailing train/test split, a 0.8 precision/recall
  shipping floor, and regeneration of the classifier-results pages
  (`scripts/lib/classifier-report.mjs`) on every run.
- `generate-netlify-redirects.mjs` — writes the per-environment `/webcam/*`
  proxy into `dist/pwa/_redirects` at build time.

## Build & deploy

```bash
npm install                     # root (webapp) deps
(cd functions && npm install)   # functions deps (sharp, firebase-admin, …)

npm run dev                     # quasar dev server (staging config)
npm run lint                    # eslint over src*/
(cd functions && npx vitest run)  # functions test suite

npm run build                   # production PWA → dist/pwa (+ _redirects)
```

Deployment targets:

```bash
npm run deploy:webapp            # git push origin main → Netlify build
npm run deploy:webapp:production # push main → production branch
npm run deploy:functions         # firebase deploy, staging project
npm run deploy:functions:production
npm run deploy:rules[:production]  # Firestore rules
npm run deploy:all[:production]    # functions + rules + indexes
```

ML workflow (details in [docs/lineup-classifier.md](docs/lineup-classifier.md)):

```bash
npm run lineup:export    # archive frames + tags (run on a cron!)
npm run lineup:train     # crosswalk model + classifier-results pages
npm run terminal:train   # terminal model (labeling page on first run)
npm run lineup:docs      # read the pipeline docs in a pager
```

## Docs

- [Webcam capture — timing, volume & retention](docs/webcams.md) — when each
  of the four capture paths fires, expected frame counts, and the 42-day
  Storage retention.
- [Lineup timelapse & classifiers](docs/lineup-classifier.md) — captures,
  tagging, both ML pipelines, and the export cron.
- [Training data](docs/training-data.md) — exactly what the exporter saves
  and the label semantics.
- [Data schema](schema.md) — Firestore collections and Storage layout.

## Credits

As shown in the app's attributions dialog:

- **[Carlos](https://bowenferry.ca)** — AIS tracking and the ferry status API.
- **[Bowen Island Municipality](https://bowenislandmunicipality.ca/)** —
  community centre webcam.
- **[BC Ferries](https://www.bcferries.com/)** — terminal webcams and, of
  course, the ferry service itself.
- **[Ron Woodall](https://bowenbook.ca/ron-woodall-art/)** — cartoonist; the
  Lift logo.
- **Tom Carchrae** — "just a guy who mashed this up".
- Mashing tools included **Big Pickle** and **Claude**, both of whom were
  challenged by the illogical nature of the ferry.
