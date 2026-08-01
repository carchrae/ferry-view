#!/usr/bin/env bash
# Refresh staging from production and wake its cloud functions:
#   1. force staging dormant (so the restore can't fire trigger storms)
#   2. backup prod Firestore into a dated local directory
#   3. restore that backup into staging (diff-aware: unchanged docs skipped)
#   4. set staging's run-until flag so its functions work for a while
#
# By default only the last 30 days of the dated collections (sailingStatus,
# capacityHistory, lineupReports, rides) are read — staging rarely needs more,
# and it keeps prod reads down. Pass --full for a complete mirror, or
# --days N for a different window.
#
# Usage: npm run staging:refresh                    # last 30 days, active 4h
#        npm run staging:refresh -- 90m             # any duration staging-run-until.js accepts
#        npm run staging:refresh -- --days 14       # smaller window
#        npm run staging:refresh -- 90m --full      # complete mirror
#
# Auth: application-default credentials with access to BOTH projects
# (GOOGLE_APPLICATION_CREDENTIALS or `gcloud auth application-default login`).
set -euo pipefail
cd "$(dirname "$0")/.."

DURATION="4h"
BACKUP_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --full) BACKUP_ARGS+=(--full); shift ;;
    --days) BACKUP_ARGS+=(--days "$2"); shift 2 ;;
    *) DURATION="$1"; shift ;;
  esac
done

STAMP="$(date +%Y-%m-%d_%H%M%S)"
BACKUP_DIR="functions/backup/prod-$STAMP"

echo "== 1/4 staging dormant during restore"
node functions/staging-run-until.js off

echo "== 2/4 backing up production → $BACKUP_DIR"
# ${arr[@]+...} guard: empty-array expansion trips `set -u` on macOS bash 3.2.
node functions/backup-db.js --project bowen-ferry --path "$BACKUP_DIR" ${BACKUP_ARGS[@]+"${BACKUP_ARGS[@]}"}

echo "== 3/4 restoring into staging"
node functions/restore-db.js --project bowen-ferry-staging --path "$BACKUP_DIR"

echo "== 4/4 waking staging for $DURATION"
node functions/staging-run-until.js "$DURATION"
