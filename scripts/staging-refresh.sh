#!/usr/bin/env bash
# Refresh staging from production and wake its cloud functions:
#   1. force staging dormant (so the restore can't fire trigger storms)
#   2. backup prod Firestore into a dated local directory
#   3. restore that backup into staging (diff-aware: unchanged docs skipped)
#   4. seed the forecast docs (seasonal schedule, holiday stats) if staging
#      has neither a copy from prod nor its own
#   5. remember how far staging has been copied (functions/backup/staging-copied-at)
#   6. set staging's run-until flag so its functions work for a while
#
# Incremental: the dated collections (sailingStatus, capacityHistory,
# lineupReports, frameLabels, rides) are only read from the last copy onwards
# (less a 2-day overlap for docs that change after their day), so old dates
# aren't copied again. The first copy — or one after deleting
# functions/backup/staging-copied-at — takes the last 30 days.
# --days N copies a fixed window instead, --full everything; both still
# record the copy. Small collections (status, aggregates, snapshots,
# subscriptions) are copied whole every time. Keeps the newest 5 local backups.
#
# Usage: npm run staging:refresh                    # last 30 days, active 4h
#        npm run staging:refresh -- 90m             # any duration staging-run-until.js accepts
#        npm run staging:refresh -- --days 14       # smaller window
#        npm run staging:refresh -- 90m --full      # complete mirror
#
# Auth: an account with access to BOTH projects — `firebase login`, or
# GOOGLE_APPLICATION_CREDENTIALS pointing at a key file (functions/script-auth.js).
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
KEEP_BACKUPS=5
COPIED_AT_FILE="functions/backup/staging-copied-at"  # epoch ms the last copy started

echo "== 1/6 staging dormant during restore"
node functions/staging-run-until.js off

if [[ ${#BACKUP_ARGS[@]} -eq 0 ]]; then
  if [[ -s "$COPIED_AT_FILE" ]]; then BACKUP_ARGS+=(--since "$(cat "$COPIED_AT_FILE")"); fi
fi
STARTED_AT="$(node -e 'console.log(Date.now())')"

echo "== 2/6 backing up production → $BACKUP_DIR"
# ${arr[@]+...} guard: empty-array expansion trips `set -u` on macOS bash 3.2.
node functions/backup-db.js --project bowen-ferry --path "$BACKUP_DIR" ${BACKUP_ARGS[@]+"${BACKUP_ARGS[@]}"}

echo "== 3/6 restoring into staging"
node functions/restore-db.js --project bowen-ferry-staging --path "$BACKUP_DIR"

echo "== 4/6 forecast docs"
node functions/seed-forecasts.js --project bowen-ferry-staging --if-missing

echo "== 5/6 recording the copy"
echo "$STARTED_AT" > "$COPIED_AT_FILE"
# Newest $KEEP_BACKUPS dated backups stay; older ones go.
ls -1d functions/backup/prod-* 2>/dev/null | sort -r | tail -n +$((KEEP_BACKUPS + 1)) | while read -r d; do rm -rf "$d"; done

echo "== 6/6 waking staging for $DURATION"
node functions/staging-run-until.js "$DURATION"
