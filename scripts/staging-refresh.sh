#!/usr/bin/env bash
# Refresh staging from production and wake its cloud functions:
#   1. force staging dormant (so the restore can't fire trigger storms)
#   2. backup prod Firestore into a dated local directory
#   3. restore that backup into staging (diff-aware: unchanged docs skipped)
#   4. set staging's run-until flag so its functions work for a while
#
# Usage: npm run staging:refresh            # active for the default 4h
#        npm run staging:refresh -- 90m     # or any duration staging-run-until.js accepts
#
# Auth: application-default credentials with access to BOTH projects
# (GOOGLE_APPLICATION_CREDENTIALS or `gcloud auth application-default login`).
set -euo pipefail
cd "$(dirname "$0")/.."

DURATION="${1:-4h}"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
BACKUP_DIR="functions/backup/prod-$STAMP"

echo "== 1/4 staging dormant during restore"
node functions/staging-run-until.js off

echo "== 2/4 backing up production → $BACKUP_DIR"
node functions/backup-db.js --project bowen-ferry --path "$BACKUP_DIR"

echo "== 3/4 restoring into staging"
node functions/restore-db.js --project bowen-ferry-staging --path "$BACKUP_DIR"

echo "== 4/4 waking staging for $DURATION"
node functions/staging-run-until.js "$DURATION"
