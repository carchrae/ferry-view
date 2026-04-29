#!/bin/bash
# Set Firebase Cloud Functions secrets
# Usage: ./scripts/set-functions-secrets.sh [staging|production]
#
# ⚠️ WARNING: This script DELETES the .env file after successful upload!
#
# Prerequisites:
#   npm install -g firebase-tools
#   firebase login
#
# Note: This script reads the private key from .env.staging or .env.production
#       and deletes the file after successful upload to Firebase Secret Manager

set -e

TARGET="${1:-staging}"

if [ "$TARGET" = "production" ]; then
  PROJECT="bowen-ferry"
  ENV_FILE=".env.production"
  echo "=== Setting secrets for production ($PROJECT) ==="
else
  PROJECT="bowen-ferry-staging"
  ENV_FILE=".env.staging"
  echo "=== Setting secrets for staging ($PROJECT) ==="
fi

# Check if env file exists
if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found"
  echo "Create $ENV_FILE with VAPID_PRIVATE_KEY variable"
  exit 1
fi

# Read the private key
SECRET_VALUE=$(grep "^VAPID_PRIVATE_KEY=" "$ENV_FILE" | cut -d= -f2- | tr -d '\r')

if [ -z "$SECRET_VALUE" ]; then
  echo "Error: VAPID_PRIVATE_KEY not found in $ENV_FILE"
  exit 1
fi

# Use Firebase Secret Manager
echo "Setting VAPID_PRIVATE_KEY secret in $PROJECT..."

# Deploy the secret
if echo "$SECRET_VALUE" | firebase functions:secrets:set VAPID_PRIVATE_KEY --project "$PROJECT" --force; then
  echo "Secret set successfully!"
  
  # Delete the env file after successful upload
  echo "Deleting $ENV_FILE containing secret..."
  rm "$ENV_FILE"
  echo "Deleted $ENV_FILE"
  
  echo ""
  echo "✅ Secret is now stored safely in Firebase Secret Manager."
  echo "   It will be injected into Cloud Functions at runtime."
else
  echo ""
  echo "ERROR: Failed to set secret. Keeping $ENV_FILE"
  echo ""
  echo "If that failed, you may need to create the secret manually first:"
  echo "  1. Go to Firebase Console > Project Settings > Secret Manager"
  echo "  2. Create new secret 'VAPID_PRIVATE_KEY' with dummy value"
  echo "  3. Re-run this script"
  exit 1
fi

echo "Done!"