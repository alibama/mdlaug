#!/usr/bin/env bash
# Populate extension/vendor/tesseract/ for FULLY OFFLINE OCR (no service call).
# Run locally (needs internet). Then tick "OCR engine installed" in Options.
# Tesseract.js is a WebAssembly build of Tesseract; everything runs on-device.
# Sizes: ~small JS + ~3-4 MB wasm core + ~10-15 MB English language data.
#
# Versions are pinned but may need bumping — see https://github.com/naptha/tesseract.js
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="extension/vendor/tesseract"; mkdir -p "$DEST"
TJS="${TJS:-5.1.1}"        # tesseract.js
CORE="${CORE:-6.0.0}"      # tesseract.js-core
J="https://cdn.jsdelivr.net/npm"
echo "Fetching tesseract.js@$TJS + core@$CORE into $DEST ..."
curl -fSL "$J/tesseract.js@$TJS/dist/tesseract.min.js"        -o "$DEST/tesseract.min.js"
curl -fSL "$J/tesseract.js@$TJS/dist/worker.min.js"           -o "$DEST/worker.min.js"
curl -fSL "$J/tesseract.js-core@$CORE/tesseract-core.wasm.js" -o "$DEST/tesseract-core.wasm.js"
curl -fSL "$J/tesseract.js-core@$CORE/tesseract-core.wasm"    -o "$DEST/tesseract-core.wasm"
curl -fSL "https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz" -o "$DEST/eng.traineddata.gz"
echo "Done. Files in $DEST:"; ls -lh "$DEST"
echo "Enable it: Options -> 'OCR engine installed in vendor/tesseract/'."
