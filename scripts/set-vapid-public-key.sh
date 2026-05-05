#!/bin/bash
# Update .env file with public key from vapid-keys file
# Usage: ./scripts/set-vapid-public-key.sh <staging|production>

TARGET="${1}"

if [ -z "$TARGET" ]; then
  echo "Usage: ./scripts/set-vapid-public-key.sh <staging|production>"
  exit 1
fi

if [ "$TARGET" = "production" ]; then
  KEY_FILE="vapid-keys-production"
  ENV_FILE=".env.production"
else
  KEY_FILE="vapid-keys-staging"
  ENV_FILE=".env.staging"
fi

if [ ! -f "$KEY_FILE" ]; then
  echo "Error: $KEY_FILE not found"
  echo "Run ./scripts/generate-vapid-keys.sh first"
  exit 1
fi

PUBLIC_KEY=$(grep "^VAPID_PUBLIC_KEY=" "$KEY_FILE" | cut -d= -f2- | tr -d '\r')

if [ -z "$PUBLIC_KEY" ]; then
  echo "Error: VAPID_PUBLIC_KEY not found in $KEY_FILE"
  exit 1
fi

echo "VAPID_PUBLIC_KEY=$PUBLIC_KEY" > "$ENV_FILE"

echo "✅ Updated $ENV_FILE"