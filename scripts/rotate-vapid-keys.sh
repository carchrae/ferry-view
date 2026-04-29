#!/bin/bash
# Rotate VAPID keys for staging or production
# Usage: ./scripts/rotate-vapid-keys.sh [staging|production]
#
# This script will:
# 1. Generate new VAPID keypair
# 2. Update .env.staging or .env.production with private key
# 3. Update netlify.toml with new public key
# 4. Print instructions for Firebase secret update

set -e

TARGET="${1:-staging}"

if [ "$TARGET" = "production" ]; then
  ENV_FILE=".env.production"
  echo "=== Rotating VAPID keys for PRODUCTION ==="
else
  ENV_FILE=".env.staging"
  echo "=== Rotating VAPID keys for STAGING ==="
fi

echo "Generating new VAPID keypair..."
KEY_OUTPUT=$(npx web-push generate-vapid-keys 2>/dev/null)

PUBLIC_KEY=$(echo "$KEY_OUTPUT" | grep -A1 "Public Key:" | tail -1 | xargs)
PRIVATE_KEY=$(echo "$KEY_OUTPUT" | grep -A1 "Private Key:" | tail -1 | xargs)

if [ -z "$PUBLIC_KEY" ] || [ -z "$PRIVATE_KEY" ]; then
  echo "Error: Failed to generate keys"
  exit 1
fi

echo "Public Key: $PUBLIC_KEY"
echo "Private Key: ${PRIVATE_KEY:0:20}..."

# Write private key to .env file (overwrites any existing)
echo "VAPID_PRIVATE_KEY=$PRIVATE_KEY" > "$ENV_FILE"
echo "Updated $ENV_FILE with new private key"

# Update netlify.toml with new public key
if [ "$TARGET" = "production" ]; then
  # Update production context key
  sed -i 's/^    VAPID_PUBLIC_KEY = ".*"/    VAPID_PUBLIC_KEY = "'"$PUBLIC_KEY"'"/' netlify.toml
else
  # Update default (build.environment) key
  sed -i 's/^  VAPID_PUBLIC_KEY = ".*"/  VAPID_PUBLIC_KEY = "'"$PUBLIC_KEY"'"/' netlify.toml
fi

echo "Updated netlify.toml with new public key"

echo ""
echo "=== NEXT STEPS ==="
echo ""
echo "1. To deploy to Firebase, run:"
echo "   pnpm run set-functions-secrets $TARGET"
echo ""
echo "2. Commit and push the netlify.toml change:"
echo "   git add netlify.toml $ENV_FILE"
echo "   git commit -m \"Rotate VAPID keys for $TARGET\""
echo "   git push origin $TARGET"