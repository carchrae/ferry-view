#!/usr/bin/env bash
# Deploy the classifier-results report to Cloud Storage — pages AND their
# thumbnails, so the published copy is self-contained: the HTML references
# thumbs/ relative paths, which resolve inside the same bucket prefix.
#
#   npm run deploy:classifier-results               # staging bucket
#   npm run deploy:classifier-results:production
#   npm run deploy:classifier-results -- --dry-run
#
# Why the bucket and not git: the report is ~75 MB of regenerated artifacts
# (three HTML pages plus ~5k thumbnails), so public/classifier-results/ is
# gitignored. The app's Classifier Results page embeds this bucket copy in
# production and the local files in dev (src/pages/ClassifierResultsPage.vue).
#
# Run AFTER `npm run lineup:train` / `npm run terminal:train`.
# Auth: `gcloud auth login` (or application-default) with write access.
set -euo pipefail

BUCKET="bowen-ferry-staging.firebasestorage.app"
DRY_RUN=()
for arg in "$@"; do
  case "$arg" in
    --production) BUCKET="bowen-ferry.firebasestorage.app" ;;
    --dry-run) DRY_RUN=(--dry-run) ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/public/classifier-results"
DEST="gs://$BUCKET/classifier-results"

if [ ! -f "$SRC/index.html" ]; then
  echo "No report at $SRC — run 'npm run lineup:train' and 'npm run terminal:train' first." >&2
  exit 1
fi

COUNT=$(find "$SRC/thumbs" -name '*.jpg' 2>/dev/null | wc -l | tr -d ' ')
echo "Deploying classifier results → $DEST"
echo "  3 pages + $COUNT thumbnails ($(du -sh "$SRC" | cut -f1))"
[ ${#DRY_RUN[@]} -gt 0 ] && echo "  (dry run — nothing will be uploaded)"

# Thumbnails first, so a page is never live before the images it references.
# They are immutable (named by a hash of the frame path), hence the long
# cache. No --delete-unmatched-destination-objects: older published pages may
# still reference thumbnails this run didn't regenerate.
gcloud storage rsync "$SRC/thumbs" "$DEST/thumbs" \
  --recursive \
  --predefined-acl publicRead \
  --cache-control "public, max-age=31536000, immutable" \
  "${DRY_RUN[@]+"${DRY_RUN[@]}"}"

# Pages last, and never cached for long — they change on every training run.
gcloud storage rsync "$SRC" "$DEST" \
  --exclude '^thumbs/' \
  --predefined-acl publicRead \
  --cache-control "public, max-age=300" \
  "${DRY_RUN[@]+"${DRY_RUN[@]}"}"

echo "Done: https://storage.googleapis.com/$BUCKET/classifier-results/index.html"
