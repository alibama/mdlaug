# Bundled third-party libraries

These files are vendored verbatim so the extension works offline with no build step.

- **pdf.min.mjs**, **pdf.worker.min.mjs** — pdf.js 4.10.38 — Apache License 2.0
  https://github.com/mozilla/pdf.js
- **mammoth.browser.min.js** — mammoth 1.9.0 — BSD 2-Clause
  https://github.com/mwilliamson/mammoth.js

`scripts/fetch-vendor.sh` can re-fetch/upgrade them; it is not required for use.
