#!/bin/bash
./scripts/generate-vapid-keys.sh $1
./scripts/set-firebase-secrets.sh $1
./scripts/set-vapid-public-key.sh $1
# rm "vapid-keys-$1"