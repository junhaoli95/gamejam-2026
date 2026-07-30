#!/usr/bin/env bash
# Build and zip the game for itch.io manual upload.
# Usage: npm run pack
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Building..."
npm run build

ZIP_NAME="gamejam-2026-$(date +%Y%m%d-%H%M).zip"

echo "==> Zipping dist/ -> $ZIP_NAME"
cd dist
rm -f "../$ZIP_NAME"
zip -rq "../$ZIP_NAME" .
cd ..

echo "==> Done: $ZIP_NAME"
echo "    Upload this file at your itch.io project page (Kind of project: HTML)."
