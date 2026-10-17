#!/usr/bin/env bash
# Install Playwright + headless Chromium for driving the dev server in
# verification (see .claude/skills/verify). Everything lands OUTSIDE the
# app's dependency tree:
#   scratchpad/node_modules/playwright     the library (scratchpad/ is gitignored)
#   ~/.cache/ms-playwright (Linux)         the Chromium build
#   ~/Library/Caches/ms-playwright (macOS)
# Idempotent: re-running upgrades the library and skips a browser that is
# already present. Chromium is ~170 MB on first install.
#
#   npm run playwright:install
#   PLAYWRIGHT_WITH_DEPS=1 npm run playwright:install   # also apt-installs the
#                                  # shared libs Chromium needs on a bare Linux
#                                  # box (needs sudo; not needed on a desktop)
#
# Use it from a script with an explicit import path, e.g.
#   import { chromium } from '/path/to/repo/scratchpad/node_modules/playwright/index.mjs'
# or run `node` from inside scratchpad/ so a bare `import 'playwright'` resolves.
set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$REPO_DIR/scratchpad"
mkdir -p "$DIR"
cd "$DIR"
# A private package.json so npm installs here instead of walking up into the
# app's package.json.
if [ ! -f package.json ]; then
  printf '{\n  "name": "ferry-view-scratchpad",\n  "private": true,\n  "type": "module"\n}\n' > package.json
fi
echo "Installing playwright into $DIR …"
npm install --no-audit --no-fund --save playwright
if [ "${PLAYWRIGHT_WITH_DEPS:-}" = "1" ]; then
  npx playwright install --with-deps chromium
else
  npx playwright install chromium
fi
echo
echo "Playwright $(node -e 'console.log(require("./node_modules/playwright/package.json").version)') ready."
echo "Import it as: $DIR/node_modules/playwright/index.mjs"
