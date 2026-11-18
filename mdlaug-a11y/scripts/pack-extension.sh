#!/usr/bin/env bash
# Build a versioned zip of the extension into dist/.
# This zip is what gets uploaded to the Chrome Web Store / Edge Add-ons (see
# RELEASING.md); it can also be unzipped and loaded with "Load unpacked".
set -euo pipefail
cd "$(dirname "$0")/.."
V=$(node -e "console.log(require('./extension/manifest.json').version)")
mkdir -p dist
OUT="dist/mdlaug-repair-extension-v${V}.zip"
rm -f "$OUT"
# Leave out the optional OCR engine (fetched separately), developer scripts and OS junk.
( cd extension && zip -rq "../$OUT" . -x 'vendor/tesseract/*' 'scripts/*' '*.DS_Store' )
echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
