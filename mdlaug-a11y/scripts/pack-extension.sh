#!/usr/bin/env bash
# Build a versioned, shareable zip of the extension into dist/.
# Recipients unzip it and use chrome://extensions -> Load unpacked.
set -euo pipefail
cd "$(dirname "$0")/.."
V=$(node -e "console.log(require('./extension/manifest.json').version)")
mkdir -p dist
OUT="dist/mdlaug-repair-extension-v${V}.zip"
rm -f "$OUT"
( cd extension && zip -rq "../$OUT" . -x 'vendor/tesseract/*' )
echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
