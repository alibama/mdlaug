#!/usr/bin/env bash
# OPTIONAL — you do NOT need to run this.
# pdf.js and mammoth are already bundled in vendor/. The extension makes no
# network calls at runtime and works offline as shipped.
#
# Run this ONLY to upgrade the bundled libraries to newer versions.
set -euo pipefail
cd "$(dirname "$0")/../vendor"
PDFJS=4.10.38
MAMMOTH=1.9.0
echo "Refreshing pdf.js $PDFJS + mammoth $MAMMOTH into vendor/ …"
curl -fsSL "https://cdn.jsdelivr.net/npm/pdfjs-dist@$PDFJS/build/pdf.min.mjs"        -o pdf.min.mjs
curl -fsSL "https://cdn.jsdelivr.net/npm/pdfjs-dist@$PDFJS/build/pdf.worker.min.mjs" -o pdf.worker.min.mjs
curl -fsSL "https://cdn.jsdelivr.net/npm/mammoth@$MAMMOTH/mammoth.browser.min.js"    -o mammoth.browser.min.js
echo "Done."
