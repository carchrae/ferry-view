#!/bin/bash
# Generate VAPID keys
# Usage: ./scripts/generate-vapid-keys.sh <staging|production>

TARGET="${1:-staging}"

if [ "$TARGET" = "production" ]; then
  KEY_FILE="vapid-keys-production"
else
  KEY_FILE="vapid-keys-staging"
fi

KEYS=$(npx web-push generate-vapid-keys 2>/dev/null)
PUBLIC_KEY=$(echo "$KEYS" | grep -A1 'Public Key:' | tail -1 | xargs)
PRIVATE_KEY=$(echo "$KEYS" | grep -A1 'Private Key:' | tail -1 | xargs)

echo "VAPID_PUBLIC_KEY=$PUBLIC_KEY" > "$KEY_FILE"
echo "VAPID_PRIVATE_KEY=$PRIVATE_KEY" >> "$KEY_FILE"

echo "✅ Keys written to $KEY_FILE"