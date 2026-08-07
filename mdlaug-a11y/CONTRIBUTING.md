# Contributing

Thanks for wanting to help make digital libraries usable with a screen reader.

## Ground rules

- **Accessibility first.** Changes to the repair engine must not regress the
  accessibility tree. If you add a rule, add a test that proves the before/after.
- **No fabricated content.** The tool never invents alt text, descriptions, or
  facts. Machine-generated text is always surfaced as *unverified*.
- **Framework-free, on-device.** The engine has no runtime framework and makes no
  network calls except to endpoints the user explicitly configures.
- **Every change is auditable.** Repairs stamp `data-mdlaug` / `data-mdlaug-orig`
  and appear in the per-code report; keep it that way.

## Dev setup

```bash
git clone <your-fork>
cd mdlaug-a11y
npm install
npm test
```

Load the extension: `chrome://extensions` → Developer mode → Load unpacked →
`extension/`. Reload after changes.

## Running / writing tests

Tests run in Node with jsdom + fake-indexeddb (no browser). Add or update a suite
in `tests/` for any engine change. A change to a repair rule should assert the
resulting ARIA/roles, and that `undo()` restores the original.

> Node tests can't catch browser-only constraints (notably Manifest V3's ban on
> inline scripts in extension pages). Always smoke-test in a loaded extension too.

## Good first issues

- **Build or validate a site pack for a widely used platform.** Good priority
  targets are large public digital libraries — e.g. the **Digital Public Library
  of America** (dp.la), **HathiTrust** (hathitrust.org), and the **Library of
  Congress** (loc.gov). Load one, run **Audit this page**, and turn the findings
  into a pack.
- Tune widget heuristics for a specific platform, or add/improve a **site pack**
  (DSpace-Angular, Islandora, Samvera/Blacklight, Omeka S, IIIF viewers) —
  see `docs/SITE-PACKS.md`.
- Add positive checks to `assessment.js` `detectGood()` so more situations get a
  real "good techniques" signal.
- Write a description-provider adapter (`compute.js`) for a specific local model.
- Improve heading reconstruction in `converter.js` using pdf.js `getStructTree()`.

## Conventions

- Vanilla ES5-compatible JS in `engine/` (broad compatibility, no build step).
- No inline `<script>` or inline event handlers in extension pages — MV3 CSP
  blocks them. Put page logic in an external `*.js`.
- Conformance levels must match mDLAUG Appendix IV.

## Submitting

1. Branch, commit with a clear message, `npm test`.
2. Open a PR describing the mDLAUG situation(s) affected and including
   before/after evidence (the highlight overlay is good for this).

By contributing you agree your contributions are licensed under Apache-2.0.
