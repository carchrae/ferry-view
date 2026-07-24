# Training data: what the export contains

What `scripts/export-lineup-dataset.mjs` (run weekly by
`scripts/cron-export-lineup-dataset.sh`) actually writes to `training-data/`
(gitignored), and how it relates to the live crosswalk-tagging feature. See
[lineup-classifier.md](lineup-classifier.md) for the full pipeline.

## What is included

```
training-data/frames/<storage path>   downloaded JPEGs
training-data/manifest.csv            path,sailingKey,ts,label,crosswalkAt
training-data/lineup-reports.json     raw lineupReports archive
training-data/report.html             per-example review of the last training run
```

- **Frames**: only the **community-camera lineup timelapse**
  (`sailingStatus.lineupTimelapsePaths`, stored under
  `webcams/community/<date>/timelapse/`) for sailings in the last `--days`
  (default 15). Each frame's capture time is the epoch-ms suffix of its
  filename. Downloads are incremental; frames already aged out of Storage
  (deleted after 14 days) are skipped but their manifest rows are kept.
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

- **Departure (Bowen terminal) timelapse** frames — not taggable, no labels.
- **Single arrival/departure photos** — not part of the timelapse.
- **Capacity tags** (`capacityHistory`) and the model's own predictions
  (`crosswalkFullAtAuto` / `crosswalkAutoProb`). Reporter identity fields do
  ship inside `lineup-reports.json` (it's the raw archive of a
  world-readable collection) but are not used for labeling.

## Shared logic — keep it that way

`functions/lib/lineup-labels.js` is the single source of truth for tag
semantics, imported by the app's triggers (`functions/index.js`), the
exporter, and the trainer (via `lineup-features.js`). If the tagging rules
change in the app, change them there and only there — the next export
relabels the whole manifest automatically. The module is deliberately free
of native deps (no `sharp`), so the exporter runs without installing
`functions/` dependencies.

## Operations

Run at least every 14 days or tagged frames are lost (Storage retention) —
`sailingStatus`/`lineupReports` docs are never deleted server-side, so
labels can always be recomputed; only the pixels expire. Cron setup:
[lineup-classifier.md §6](lineup-classifier.md). Logs:
`training-data/logs/export-<date>.log`.
