#!/usr/bin/env bash
# Train BOTH classifiers back-to-back: crosswalk (lineup) first, terminal
# second. Each trainer prints its own metrics plus the prior-model comparison
# table, and the shared report (training-data/report/index.html +
# public/classifier-results/) ends up with both sections' history complete —
# each trainer persists its computed rows for the other to reuse.
#
# A trainer whose test metrics miss the 0.8 floor exits without writing its
# model; the other still runs, and this script exits non-zero if either
# failed. Per-trainer flags (--force, --threshold, …) differ between the two,
# so run the individual scripts (lineup:train / terminal:train) when you need
# them.
#
# Usage: npm run train
set -uo pipefail
cd "$(dirname "$0")/.."

# Same lock as the cron jobs: a manual train overlapping the nightly run
# would race version numbers and rewrite manifest/report files mid-read.
LOCK_DIR="training-data/.pipeline.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Another pipeline run (nightly cron or export) is in progress — try again shortly." >&2
  echo "If you're sure nothing is running: rm -rf $LOCK_DIR" >&2
  exit 1
fi
trap 'rmdir "$LOCK_DIR"' EXIT

status=0
node scripts/train-lineup-classifier.mjs || status=1
echo
node scripts/train-terminal-classifier.mjs || status=1
exit $status
