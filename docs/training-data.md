# Training data: what the export contains

What `scripts/export-lineup-dataset.mjs` (run weekly by
`scripts/cron-export-lineup-dataset.sh`) actually writes to `training-data/`
(gitignored), and how it relates to the live crosswalk-tagging feature. See
[lineup-classifier.md](lineup-classifier.md) for the full pipeline.

## What is included

```
training-data/frames/<storage path>   downloaded JPEGs (community + bowen terminal)
training-data/manifest.csv            path,sailingKey,ts,label,crosswalkAt
training-data/terminal-manifest.csv   path,sailingKey,ts,label,source (terminal-cars)
training-data/terminal-labels.json    hand labels for terminal frames ({path: 0|1})
training-data/frame-labels.json       raw frameLabels archive (rider per-frame labels)
training-data/rider-label-disagreements.json  rider vs hand-label conflicts
training-data/terminal-labeling.html  click-to-label page (npm run terminal:label)
training-data/lineup-reports.json     raw lineupReports archive
training-data/predictions.json        per-sailing crosswalk predictions + notFullByCrosswalk
training-data/report/                 classifier-results pages (index/crosswalk/terminal)
```

- **Frames**: only the **community-camera lineup timelapse**
  (`sailingStatus.lineupTimelapsePaths`, stored under
  `webcams/community/<date>/timelapse/`) for sailings in the last `--days`
  (default 15). Each frame's capture time is the epoch-ms suffix of its
  filename. Downloads are incremental; frames already aged out of Storage
  (deleted after 42 days) are skipped but their manifest rows are kept.
- **Raw tags** (`lineup-reports.json`): every `lineupReports` doc, verbatim,
  keyed by Firestore doc id and merged across runs — a report the user later
  deletes stays archived with `deleted: true`. This is the permanent record;
  nothing about it is interpreted at export time.
- **Labels** (`manifest.csv`): the exporter defines **no tag semantics of its
  own**. Per sailing it applies `effectiveCrosswalkAt()` from
  `functions/lib/lineup-labels.js` — the exact rule the app's
  `onLineupReport` / `onLineupReportDelete` triggers use (**latest** valid
  mark by `recordedAt` wins; deletions fall back to the latest remaining
  mark) — then labels each frame with `labelForTimestamp()` from the same
  module (`1` at/after the mark, `0` before, empty when untagged). Labels
  for **all** manifest rows are recomputed on every run from the current
  reports, so corrections and deletions made in the app rewrite old rows
  too.

## What is NOT included

- **Single arrival/departure photos** — not part of the timelapse.
- The model's own predictions (`crosswalkFullAtAuto` / `crosswalkAutoProb`).
  Reporter identity fields do ship inside `lineup-reports.json` (it's the raw
  archive of a world-readable collection) but are not used for labeling.
  Human capacity tags DO ship since 2026-08-10 (`capacity-tags.json`, user
  records only, `{id, sailingKey, capacity, recordedAt}` — `capacity` is
  percent **available**); the terminal report page uses them to show
  robot-verdict vs human-tag agreement. No labels derive from them.
  Known-bad tags are listed in the hand-curated `tag-corrections.json`
  (`{sailingKey: reason}`, NOT written by the exporter) — scoring treats
  those sailings as untagged.

## Shared logic — keep it that way

`functions/lib/lineup-labels.js` is the single source of truth for tag
semantics, imported by the app's triggers (`functions/index.js`), the
exporter, and the trainer (via `lineup-features.js`). If the tagging rules
change in the app, change them there and only there — the next export
relabels the whole manifest automatically. The module is deliberately free
of native deps (no `sharp`), so the exporter runs without installing
`functions/` dependencies.

## Operations

Run at least every 42 days or tagged frames are lost (Storage retention) —
`sailingStatus`/`lineupReports` docs are never deleted server-side, so
labels can always be recomputed; only the pixels expire. Cron setup:
[lineup-classifier.md §6](lineup-classifier.md). Logs:
`training-data/logs/export-<date>.log`.

## Terminal frame labels: two sources, one file

The terminal-cars classifier answers a **frame** question ("are cars waiting in
this photo?"). A capacity tag answers a **sequence** question ("did the ferry
leave full?") and cannot say which frame was misread, so it can score a verdict
but can never supervise the model. Terminal frame labels therefore come from
two places, both keyed by the frame's Storage path:

1. **Hand labels** — `terminal-labels.json`, from the click-to-label page.
2. **Rider labels** — the `frameLabels` collection, answered in the app's
   robot frame-check dialog, resolved by `effectiveFrameLabel()` in
   `functions/lib/lineup-labels.js` (each rider's latest word counts once,
   then majority; a tie leaves the frame unlabeled).

**Hand labels win**; rider labels only fill gaps. The manifest's `source`
column records which won, and the trainer reports per-source counts and stamps
them into the shipped model's `dataset.labelSources`.

A rider contradicting a hand label is **not** applied but **is** recorded in
`rider-label-disagreements.json` — that conflict is the signal that a hand
label may be wrong, and is the input to a future review pass.

Two guards worth knowing about:

- The labelling page prefills from `terminal-labels.json` **directly**, never
  from the manifest, and renders rider-labelled frames as a dashed read-only
  state that is excluded from its copied JSON. Prefilling from the manifest
  would launder every rider label into a hand label on the next round-trip,
  silently destroying precedence, provenance and the disagreement signal.
- The exporter tolerates `frameLabels` being unreadable (e.g. before its rules
  are deployed) and continues with hand labels only.

## Claude-contributed labels

`terminal-labels-claude.json` records the terminal labels an LLM (not a
rider) added, as a subset of `terminal-labels.json`. They train the shipped
model, so they get a human pass: `npm run terminal:review-claude` builds
`training-data/report/claude-labels-review.html` (every frame, its model
score, keep/flip/drop), and `npm run terminal:apply-review -- <file.json>`
folds the downloaded assessment back in — a reviewed label leaves the Claude
file (a human now vouches for it) and stays in the training set.
