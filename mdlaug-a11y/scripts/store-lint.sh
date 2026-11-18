#!/usr/bin/env bash
# Catch things that get a Chrome Web Store / Edge Add-ons submission rejected
# or pushed into slow manual review. Run by CI and by the release workflow.
set -euo pipefail
cd "$(dirname "$0")/.."
fail=0

# 1. No remotely hosted code: extension code must not point at script CDNs.
if grep -rnE "cdnjs\.cloudflare|cdn\.jsdelivr|unpkg\.com|googleapis\.com/ajax" extension \
     --include='*.js' --include='*.mjs' --include='*.html' --exclude-dir=vendor --exclude-dir=scripts; then
  echo "::error::Remote code URL found in extension/ (store policy forbids loading code from a CDN)"; fail=1
fi

# 2. Manifest: no dev-only hosts, no permissions we don't use.
node -e '
const m = require("./extension/manifest.json");
const bad = [];
const hosts = [...(m.host_permissions||[]), ...(m.optional_host_permissions||[])];
for (const h of hosts) if (/localhost|127\.0\.0\.1/.test(h)) bad.push("dev host permission: " + h);
for (const p of ["tabs","history","cookies","webRequest","debugger","management"]) if ((m.permissions||[]).includes(p)) bad.push("unneeded permission: " + p);
if (!/^\d+\.\d+\.\d+$/.test(m.version)) bad.push("version must be x.y.z: " + m.version);
if ((m.description||"").length > 132) bad.push("description over 132 chars");
if (bad.length) { bad.forEach(b => console.log("::error::" + b)); process.exit(1); }
' || fail=1

# 3. Shipped config keeps the project database opt-in.
grep -qE "centralOptIn:\s*true" extension/config.js || { echo "::error::config.js must set centralOptIn: true for store builds"; fail=1; }

[ "$fail" = 0 ] && echo "store-lint ok"
exit $fail
