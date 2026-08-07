#!/usr/bin/env bash
# Confirms the extension is fully self-contained (nothing to fetch).
set -euo pipefail
cd "$(dirname "$0")/.."
ok=1
for f in vendor/pdf.min.mjs vendor/pdf.worker.min.mjs vendor/mammoth.browser.min.js \
         config.js engine/remediator.js engine/converter.js engine/compute.js engine/reader.js \
         engine/assessment.js engine/turso.js engine/store.js \
         packs/blacklight.js packs/dspace.js packs/islandora.js packs/omeka.js packs/iiif.js \
         ui/assessment-page.js ui/studio-page.js ui/dashboard-page.js \
         src/content.js src/background.js ui/popup.html ui/studio.html ui/assessment.html manifest.json; do
  if [ -s "$f" ]; then printf "  ok   %s\n" "$f"; else printf "  MISS %s\n" "$f"; ok=0; fi
done
[ "$ok" = 1 ] && echo "All present — load unpacked, no fetch needed." || { echo "Missing files above."; exit 1; }
