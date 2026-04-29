#!/bin/bash
# Generate new VAPID keys and write to .env-vapid-keys

KEYS=$(npx web-push generate-vapid-keys 2>/dev/null)
PUBLIC_KEY=$(echo "$KEYS" | grep -A1 'Public Key:' | tail -1 | xargs)
PRIVATE_KEY=$(echo "$KEYS" | grep -A1 'Private Key:' | tail -1 | xargs)

echo "PUBLIC_KEY=$PUBLIC_KEY"
echo "PRIVATE_KEY=$PRIVATE_KEY"

# Write to .env.vapid-keys file
echo "VAPID_PRIVATE_KEY_STAGING=$PRIVATE_KEY" > .env.vapid-keys
echo "VAPID_PRIVATE_KEY_PROD=$PRIVATE_KEY" >> .env.vapid-keys
echo "Written keys to .env.vapid-keys"