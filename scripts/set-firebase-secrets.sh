#!/bin/bash
# Set Firebase Cloud Functions secrets
# Usage: ./scripts/set-firebase-secrets.sh <staging|production>

TARGET="${1}"

if [ -z "$TARGET" ]; then
  echo "Usage: ./scripts/set-firebase-secrets.sh <staging|production>"
  exit 1
fi

if [ "$TARGET" = "production" ]; then
  PROJECT="bowen-ferry"
  FILE="vapid-keys-production"
else
  PROJECT="bowen-ferry-staging"
  FILE="vapid-keys-staging"
fi

if [ ! -f "$FILE" ]; then
  echo "Error: $FILE not found"
  echo "Run ./scripts/generate-vapid-keys.sh $TARGET first"
  exit 1
fi

PRIVATE_KEY=$(grep "^VAPID_PRIVATE_KEY=" "$FILE" | cut -d= -f2- | tr -d '\r')
PUBLIC_KEY=$(grep "^VAPID_PUBLIC_KEY=" "$FILE" | cut -d= -f2- | tr -d '\r')

if [ -z "$PRIVATE_KEY" ]; then
  echo "Error: VAPID_PRIVATE_KEY not found in $FILE"
  exit 1
fi

if [ -z "$PUBLIC_KEY" ]; then
  echo "Error: VAPID_PUBLIC_KEY not found in $FILE"
  exit 1
fi

echo "Setting VAPID_PRIVATE_KEY in $PROJECT..."
if echo "$PRIVATE_KEY" | firebase functions:secrets:set VAPID_PRIVATE_KEY --project "$PROJECT" --force 2>/dev/null; then
  echo "✅ VAPID_PRIVATE_KEY set"
else
  echo "Error: Failed to set VAPID_PRIVATE_KEY"
  exit 1
fi

echo "Setting VAPID_PUBLIC_KEY in $PROJECT..."
if echo "$PUBLIC_KEY" | firebase functions:secrets:set VAPID_PUBLIC_KEY --project "$PROJECT" --force 2>/dev/null; then
  echo "✅ VAPID_PUBLIC_KEY set"
else
  echo "Error: Failed to set VAPID_PUBLIC_KEY"
  exit 1
fi

echo "Done!"
