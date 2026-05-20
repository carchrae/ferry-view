#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "=== Resetting file permissions ==="
echo "Project: $PROJECT_DIR"
echo "User: $(whoami), Group: $(id -gn)"
echo ""

# Fix ownership: everything to current user:staff
echo "1. Changing ownership to $(whoami):$(id -gn)..."
sudo chown -R "$(whoami):$(id -gn)" "$PROJECT_DIR"

# Directories: 755 (rwxr-xr-x)
echo "2. Setting directory permissions to 755..."
find "$PROJECT_DIR" \
  -not -path '*/.git/*' \
  -not -path '*/node_modules/*' \
  -type d -exec chmod 755 {} +

# Regular files: 644 (rw-r--r--)
echo "3. Setting file permissions to 644..."
find "$PROJECT_DIR" \
  -not -path '*/.git/*' \
  -not -path '*/node_modules/*' \
  -type f -exec chmod 644 {} +

# node_modules needs special treatment
echo "4. Fixing node_modules permissions..."
# Directories
find "$PROJECT_DIR/node_modules" -type d -exec chmod 755 {} + 2>/dev/null || true
# Regular files  
find "$PROJECT_DIR/node_modules" -type f ! -path '*/node_modules/.bin/*' -exec chmod 644 {} + 2>/dev/null || true
# Binaries
chmod +x "$PROJECT_DIR/node_modules/.bin/"* 2>/dev/null || true

# .git: fix ownership (already done by chown above), but preserve git-specific permissions
echo "5. Restoring .git hook executability..."
chmod +x "$PROJECT_DIR/.git/hooks/"* 2>/dev/null || true

# Some npm/node binaries should be executable
echo "6. Fixing common executable paths..."
chmod +x "$PROJECT_DIR/node_modules/.bin/"* 2>/dev/null || true

echo ""
echo "=== Done ==="
echo "Permissions reset to macOS defaults (dirs: 755, files: 644)"
