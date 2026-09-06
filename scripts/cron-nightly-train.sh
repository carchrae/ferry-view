#!/usr/bin/env bash
# Nightly classifier retraining: export the freshest dataset, retrain BOTH
# classifiers in --auto mode, and let champion selection decide what's live.
#
# --auto per trainer (see the trainers for details):
#   - the fresh candidate is ALWAYS archived to functions/models/history/,
#     even when it loses,
#   - every archived version is re-scored on TODAY's held-out split and the
#     best one becomes functions/models/<name>.json (crosswalk: lowest
#     sequence severity cost; terminal-cars: highest frame F1),
#   - each decision is appended to training-data/nightly-runs.json and the
#     nightly.html results page is regenerated (report + webapp copy),
#   - the regenerated classifier-results pages (index/crosswalk/terminal/
#     nightly + thumbs) are published to the results bucket via
#     scripts/deploy-classifier-results.sh, so /classifier-results in the app
#     shows each night's run.
#
# The updated MODEL only reaches production on the next
# `npm run deploy:functions:production` — this job publishes report pages,
# never code or models.
#
#   crontab -e
#   0 3 * * * /path/to/ferry-mirror/scripts/cron-nightly-train.sh
#
# (Supersedes the weekly export cron — this runs the same export first.)
# Cron-safe: absolute paths, explicit PATH, a lock against overlapping runs,
# dated logs under training-data/logs/ (pruned after 60 days). Exits non-zero
# on failure so a MAILTO= line in the crontab reports errors.
#
# Optional env overrides:
#   FERRY_PROJECT          Firebase project id (default: bowen-ferry)
#   FERRY_DAYS             how many days of sailings to scan (default: 45)
#   FERRY_RESULTS_TARGET   where to publish the results pages:
#                          production (default) | staging | skip

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$REPO_DIR/training-data/logs"
# One lock for the WHOLE pipeline — shared with the export cron and
# scripts/train-all.sh, so a manual `npm run train` can never interleave with
# the nightly run (concurrent trainers would race version numbers and rewrite
# manifest/report files under each other).
LOCK_DIR="$REPO_DIR/training-data/.pipeline.lock"
LOG_FILE="$LOG_DIR/train-$(date +%Y-%m-%d).log"

# Cron strips the login PATH; include the usual node locations — macOS
# (homebrew arm64/intel), Ubuntu (apt/nodesource in /usr/bin, snap) — plus
# whatever the invoking user has.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/snap/bin:$HOME/google-cloud-sdk/bin:$PATH"

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

# mkdir is atomic, and works on macOS where flock isn't available. A lock
# left behind by a crash/reboot (trap doesn't run on SIGKILL/power loss)
# would otherwise silently disable the pipeline forever — anything older
# than 12h is treated as stale and broken.
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
  echo "=== $(date '+%F %T') nightly train starting (project=${FERRY_PROJECT:-bowen-ferry}, days=${FERRY_DAYS:-45}) ==="
  node "$REPO_DIR/scripts/export-lineup-dataset.mjs" \
    --project "${FERRY_PROJECT:-bowen-ferry}" \
    --days "${FERRY_DAYS:-45}" || status=1
  echo "--- $(date '+%F %T') crosswalk trainer ---"
  node "$REPO_DIR/scripts/train-lineup-classifier.mjs" --auto || status=1
  echo "--- $(date '+%F %T') terminal trainer ---"
  node "$REPO_DIR/scripts/train-terminal-classifier.mjs" --auto || status=1
  # Publish the regenerated results pages so /classifier-results in the app
  # reflects tonight's run. Pages regenerate even on a failed training step,
  # so this runs regardless — a failed step is exactly what's worth seeing.
  TARGET="${FERRY_RESULTS_TARGET:-production}"
  case "$TARGET" in
    skip)
      echo "--- results pages NOT published (FERRY_RESULTS_TARGET=skip) ---" ;;
    staging)
      echo "--- $(date '+%F %T') publishing results pages (staging) ---"
      bash "$REPO_DIR/scripts/deploy-classifier-results.sh" || status=1 ;;
    production)
      echo "--- $(date '+%F %T') publishing results pages (production) ---"
      bash "$REPO_DIR/scripts/deploy-classifier-results.sh" --production || status=1 ;;
    *)
      # A typo must never fail OPEN into a production publish.
      echo "Unknown FERRY_RESULTS_TARGET='$TARGET' (use production|staging|skip) — pages NOT published"
      status=1 ;;
  esac
  echo "=== $(date '+%F %T') nightly train finished (status=$status) ==="
} >>"$LOG_FILE" 2>&1

# Prune logs older than 60 days.
find "$LOG_DIR" -name 'train-*.log' -mtime +60 -delete 2>/dev/null || true

# Cron only mails when a job produces OUTPUT — an exit code alone is silent.
# Surface failures outside the log redirect so MAILTO= actually fires.
if [ $status -ne 0 ]; then
  {
    echo "nightly train FAILED — full log: $LOG_FILE"
    tail -30 "$LOG_FILE"
  } >&2
fi
exit $status
