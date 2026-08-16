#!/usr/bin/env bash
# Publish the classifier-results thumbnails to Cloud Storage.
#
# The pages reference ~5k thumbnails (~67 MB). Keeping those in git bloats the
# repo for files that are regenerated on every training run, so the directory
# is gitignored and lives in the public webcam bucket instead — the same
# bucket the frames themselves come from, already world-readable.
#
#   npm run classifier:publish-thumbs            # production bucket
#   npm run classifier:publish-thumbs -- --staging
#   npm run classifier:publish-thumbs -- --dry-run
#
# The generated pages point at $CLASSIFIER_THUMB_BASE (see the trainers), which
# defaults to the production bucket path written here. Run this AFTER a
# training run and BEFORE deploying the webapp, or the new pages will
# reference thumbnails that aren't uploaded yet.
#
# Auth: application-default credentials with write access to the bucket
# (`gcloud auth application-default login`).
set -euo pipefail

BUCKET="bowen-ferry.firebasestorage.app"
DRY_RUN=""
for arg in "$@"; do
  case "$arg" in
    --staging) BUCKET="bowen-ferry-staging.firebasestorage.app" ;;
    --dry-run) DRY_RUN="-n" ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/public/classifier-results/thumbs"
DEST="gs://$BUCKET/classifier-results/thumbs"

if [ ! -d "$SRC" ]; then
  echo "No thumbnails at $SRC — run 'npm run terminal:train' / 'npm run lineup:train' first." >&2
  exit 1
fi

COUNT=$(find "$SRC" -name '*.jpg' | wc -l | tr -d ' ')
SIZE=$(du -sh "$SRC" | cut -f1)
echo "Publishing $COUNT thumbnails ($SIZE)"
echo "  from $SRC"
echo "  to   $DEST"
[ -n "$DRY_RUN" ] && echo "  (dry run — nothing will be uploaded)"

# rsync: only new/changed files move, so re-publishing after a training run
# costs little. Thumbnails are immutable (named by content hash of the frame
# path), hence the long cache header. No -d: never delete remote thumbnails
# still referenced by an older deployed page.
gsutil -m -h "Cache-Control:public, max-age=31536000, immutable" \
  rsync $DRY_RUN -r "$SRC" "$DEST"

echo "Done. Pages reference: https://storage.googleapis.com/$BUCKET/classifier-results/thumbs/"
