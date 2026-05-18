#!/bin/bash
# Get Firebase config for a project
# Usage: 
#   pnpm firebase-config           # staging (default)
#   pnpm firebase-config prod       # production
#
# Prerequisites:
#   npm install -g firebase-tools
#   firebase login

set -e

PROJECT="$1"
if [ -z "$PROJECT" ]; then
  PROJECT="bowen-ferry-staging"
elif [ "$PROJECT" = "prod" ]; then
  PROJECT="bowen-ferry"
fi

echo "Getting Firebase config for $PROJECT..."
echo ""

if ! command -v firebase &> /dev/null; then
  echo "Firebase CLI not found. Install with:"
  echo "  npm install -g firebase-tools"
  echo "  firebase login"
  echo ""
  echo "Or manually get config from:"
  echo "https://console.firebase.google.com/project/$PROJECT/settings/general"
  exit 1
fi

npx firebase-tools apps:sdkconfig WEB "$PROJECT"