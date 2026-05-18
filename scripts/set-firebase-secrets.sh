#!/bin/bash
# Set Firebase Cloud Functions secret
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

SECRET_VALUE=$(grep "^VAPID_PRIVATE_KEY=" "$FILE" | cut -d= -f2- | tr -d '\r')

if [ -z "$SECRET_VALUE" ]; then
  echo "Error: VAPID_PRIVATE_KEY not found in $FILE"
  exit 1
fi

echo "Setting VAPID_PRIVATE_KEY in $PROJECT..."

if echo "$SECRET_VALUE" | firebase functions:secrets:set VAPID_PRIVATE_KEY --project "$PROJECT" --force 2>/dev/null; then
  echo "✅ Secret set in Firebase Secret Manager"
else
  echo "Error: Failed to set secret"
  echo "Create the secret manually in Firebase Console first"
  exit 1
fi

echo "Done!"