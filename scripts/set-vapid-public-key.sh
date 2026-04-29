#!/bin/bash
# Replace the VAPID public key in netlify.toml
# Usage: pnpm run set-vapid-public-key [staging|production]
#
# Run generate-vapid-keys first, then call this with the new public key

NEW_KEY="$1"

if [ -z "$NEW_KEY" ]; then
  echo "Usage: pnpm run set-vapid-public-key <public-key>"
  echo ""
  echo "First run: pnpm run generate-vapid-keys"
  echo "Then: pnpm run set-vapid-public-key <the-new-public-key>"
  exit 1
fi

# For now, just update the default (staging) key
# Production key is in [context.production]
sed -i 's/^  VAPID_PUBLIC_KEY = ".*"/  VAPID_PUBLIC_KEY = "'"$NEW_KEY"'"/' netlify.toml
echo "Updated netlify.toml public key"