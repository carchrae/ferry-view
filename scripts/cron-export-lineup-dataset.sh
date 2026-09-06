#!/usr/bin/env bash
# Cron wrapper for the lineup-classifier dataset exporter.
#
# What the exported dataset contains (and its known caveats):
# docs/training-data.md
#
# Timelapse frames are DELETED from Storage after 42 days (cleanupOldWebcams),
# so this must run at least every six weeks to archive labeled frames before
# they vanish. Weekly is comfortable:
#
#   crontab -e
#   30 3 * * 1 /path/to/ferry-mirror/scripts/cron-export-lineup-dataset.sh
#
# Cron-safe: absolute paths, explicit PATH (cron's environment has no
# nvm/homebrew), a lock against overlapping runs, dated logs under
# training-data/logs/ (pruned after 60 days). Exits non-zero on failure so a
# `MAILTO=` line in the crontab reports errors.
#
# Optional env overrides:
#   FERRY_PROJECT   Firebase project id (default: bowen-ferry)
#   FERRY_DAYS      how many days of sailings to scan (default: 45)

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$REPO_DIR/training-data/logs"
# Shared with cron-nightly-train.sh and train-all.sh: the nightly job runs
# this same exporter, and two exporters (or an exporter under a trainer)
# rewriting manifest/archives concurrently would corrupt them.
LOCK_DIR="$REPO_DIR/training-data/.pipeline.lock"
LOG_FILE="$LOG_DIR/export-$(date +%Y-%m-%d).log"

# Cron strips the login PATH; include the usual node locations — macOS
# (homebrew arm64/intel), Ubuntu (apt/nodesource in /usr/bin, snap) — plus
# whatever the invoking user has.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/snap/bin:$PATH"

# nvm installs node outside the system PATH; fall back to the newest
# nvm-managed version if nothing else provided one.
if ! command -v node >/dev/null 2>&1 && [ -d "$HOME/.nvm/versions/node" ]; then
  NVM_NODE_BIN="$(ls -d "$HOME/.nvm/versions/node"/*/bin 2>/dev/null | sort -V | tail -1)"
  [ -n "$NVM_NODE_BIN" ] && export PATH="$NVM_NODE_BIN:$PATH"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node not found on PATH — install node or extend PATH in this script" >&2
  exit 1
fi

mkdir -p "$LOG_DIR"

# mkdir is atomic, and works on macOS where flock isn't available. Break
# locks older than 12h — a crash/reboot mid-run never runs the trap, and a
# stale lock would silently stop exports until frames age out of Storage.
if [ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin +720 2>/dev/null)" ]; then
  echo "$(date '+%F %T') breaking stale lock ($LOCK_DIR older than 12h)" >>"$LOG_FILE"
  rmdir "$LOCK_DIR" 2>/dev/null || rm -rf "$LOCK_DIR"
fi
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "$(date '+%F %T') another pipeline run is already in progress (rm -rf $LOCK_DIR if stale)" >>"$LOG_FILE"
  exit 0
fi
trap 'rmdir "$LOCK_DIR"' EXIT

status=0
{
  echo "=== $(date '+%F %T') export starting (project=${FERRY_PROJECT:-bowen-ferry}, days=${FERRY_DAYS:-45}) ==="
  node "$REPO_DIR/scripts/export-lineup-dataset.mjs" \
    --project "${FERRY_PROJECT:-bowen-ferry}" \
    --days "${FERRY_DAYS:-45}" || status=1
  echo "=== $(date '+%F %T') export finished (status=$status) ==="
} >>"$LOG_FILE" 2>&1

# Prune logs older than 60 days.
find "$LOG_DIR" -name 'export-*.log' -mtime +60 -delete 2>/dev/null || true

# Cron only mails when a job produces OUTPUT — surface failures outside the
# log redirect so MAILTO= actually fires.
if [ $status -ne 0 ]; then
  {
    echo "lineup export FAILED — full log: $LOG_FILE"
    tail -20 "$LOG_FILE"
  } >&2
fi
exit $status
