# Changelog

## Unreleased (tooling & companions)
### Added
- `bdd/` — a BDD data store: the 24 mDLAUG situations (plus the forms and
  multimedia rules) as User Stories with Given/When/Then acceptance criteria, and
  every evaluation-forum guideline classified algorithmic / hybrid / manual with a
  status (implemented / proposed / service / app-layer / manual). Generated and
  validated against the engine via `npm run bdd`; includes a remediation matrix.
- `analytics/` — a Streamlit, read-only dashboard over the audit database
  (compliance by situation, conformance-level rollup, trend over time, weakest
  situations), reading via Turso's HTTP pipeline (direct or through the relay).
  Pure transforms are unit-tested.
- `npm run pack` builds a versioned extension zip into `dist/`; `INSTALL.md`
  documents load-unpacked / zip / .crx / Web Store install paths.

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versioning is pre-1.0 and may shift.

## [0.9.10] - 2026
### Added
- The on-page button can be dismissed with an × (persists), since it can
  occasionally overlap page content; most actions live in the extension popup.
  Re-enable it with "Show the on-page button" in the popup.
- Audit page links back to the original mDLAUG guidance
  (https://sites.uwm.edu/mdlaug/) so assessors can reference the source, and the
  credits thank Dr. Iris Xie (UW–Milwaukee) and colleagues.

## [0.9.9] - 2026
### Fixed
- Bundled converter/OCR libraries now load into the extension's **isolated world**
  via the background, instead of injecting a `<script>` into the page. This was the
  real reason "View inline" downloaded a Word doc but never converted it: the page's
  CSP blocked the page-injected mammoth, and even when it loaded it landed in the
  page world where the converter (isolated world) couldn't see it. DOCX now converts
  and renders inline on CSP-locked pages.
### Added
- Fully offline OCR: `scripts/fetch-tesseract.sh` populates `vendor/tesseract/`
  with the WebAssembly Tesseract build; the engine loads into the isolated world
  (CSP-safe) and runs on-device with no service call.

## [0.9.8] - 2026
### Fixed
- Inline "View inline" for a linked file now fetches the bytes through the
  extension background (which can read cross-origin) and upgrades `http`->`https`,
  so a Word/PDF/text file on another origin — or an `http` file on an `https`
  page — actually converts to an accessible view instead of failing. A Word doc
  that still can't be fetched shows a clear message and a manual link to the
  original, instead of an `<iframe>` that silently downloads it.
### Added
- Optional **"Auto-add alt text to images without alt"** (Options): when a
  description service (or local OCR) is configured, the extension fills alt text
  automatically on repair — no per-image tap, which matters on mobile. A
  description endpoint fetches the image URL server-side, so it also covers
  cross-origin images that local OCR can't read (canvas taint). Auto-added alt is
  cleared on Undo.
- `<all_urls>` host permission so the background can fetch linked files for
  conversion (content scripts already ran on all pages).

## [0.9.7] - 2026
### Fixed
- Large images declared decorative with `alt=""` (common when an editor/CMS inserts
  an image without alt) are now flagged for review instead of silently skipped —
  the case where a screenshot or hero graphic that actually conveys content was
  missed. Small decorative images are still left alone, and the author's `alt=""`
  is never overwritten (the tool flags, it doesn't fabricate).

## [0.9.10] - 2026
### Added
- The on-page button can be dismissed with an × (persists), since it can
  occasionally overlap page content; most actions live in the extension popup.
  Re-enable it with "Show the on-page button" in the popup.
- Audit page links back to the original mDLAUG guidance
  (https://sites.uwm.edu/mdlaug/) so assessors can reference the source, and the
  credits thank Dr. Iris Xie (UW–Milwaukee) and colleagues.

## [0.9.9] - 2026
### Fixed
- Bundled converter/OCR libraries now load into the extension's **isolated world**
  via the background, instead of injecting a `<script>` into the page. This was the
  real reason "View inline" downloaded a Word doc but never converted it: the page's
  CSP blocked the page-injected mammoth, and even when it loaded it landed in the
  page world where the converter (isolated world) couldn't see it. DOCX now converts
  and renders inline on CSP-locked pages.
### Added
- Fully offline OCR: `scripts/fetch-tesseract.sh` populates `vendor/tesseract/`
  with the WebAssembly Tesseract build; the engine loads into the isolated world
  (CSP-safe) and runs on-device with no service call.

## [0.9.8] - 2026
### Fixed
- Inline "View inline" for a linked file now fetches the bytes through the
  extension background (which can read cross-origin) and upgrades `http`->`https`,
  so a Word/PDF/text file on another origin — or an `http` file on an `https`
  page — actually converts to an accessible view instead of failing. A Word doc
  that still can't be fetched shows a clear message and a manual link to the
  original, instead of an `<iframe>` that silently downloads it.
### Added
- Optional **"Auto-add alt text to images without alt"** (Options): when a
  description service (or local OCR) is configured, the extension fills alt text
  automatically on repair — no per-image tap, which matters on mobile. A
  description endpoint fetches the image URL server-side, so it also covers
  cross-origin images that local OCR can't read (canvas taint). Auto-added alt is
  cleared on Undo.
- `<all_urls>` host permission so the background can fetch linked files for
  conversion (content scripts already ran on all pages).

## [0.9.7] - 2026
### Fixed
- Large images declared decorative with `alt=""` are now flagged for review
  instead of silently skipped. Editors/CMSes (e.g. LibGuides) often insert a
  content image with an empty alt; a big screenshot/hero graphic marked
  decorative is almost always a mistake. Small decorative images are still left
  alone, and the author's `alt=""` is never overwritten.

## [0.9.6] - 2026
### Added
- Detect images that aren't `<img>`: sizeable inline **SVG** (including
  text-in-SVG), **`<canvas>`**, and **CSS `background-image`** boxes are now
  flagged for a text alternative (ACC2/COM3) and, for backgrounds, exposed as
  `role="img"`. Fixes real pages where a title/hero graphic wasn't an `<img>` and
  went undetected.
### Notes
- Extracting the *text* from a text-as-image still needs a description endpoint
  (vision model) or bundled OCR; the engine flags such images but never invents
  their content.

## [0.9.5] - 2026
### Changed
- Removed all references to the mDLAUG guideline authors, their institution, and
  named partner organizations from the interface and documentation, and removed
  outbound links to their site (including the per-situation "Read the guideline"
  links in the audit editor). This is an independent, unaffiliated project
  inspired by the publicly published guidelines; NOTICE and README now state that
  plainly. No change to the remediation engine or tests.

## [0.9.4] - 2026
Driven by reviewer feedback from the mDLAUG evaluation forum.
### Added
- FORM1: accessible form fields — associate an adjacent label, fall back to the
  placeholder, reflect `required` as `aria-required`, and flag fields that still
  need a human-written label (WCAG 1.3.1 / 3.3.2 / 4.1.2). Addresses the
  most-cited missing situation (login/registration/account forms).
- WCAG success-criterion mapping per situation, exposed in `rules()` and shown in
  the in-page report.
- A defined 1–7 scoring rubric on the audit page (reviewers found the bare scale
  hard to apply consistently).
### Changed
- ACC1 derives a descriptive name from the filename when link text is generic
  ("here", "click here", "download") — WCAG 2.4.4.
### Notes
- The reviewer-proposed multimedia gap ("ACC7": captions/transcripts) is already
  covered by MED1 (added in 0.9.3).

## [0.9.3] - 2026
### Added
- Multimedia remediation (MED1): detect uncaptioned `<video>`/`<audio>` and
  YouTube/Vimeo embeds; name the player; with a transcription service configured,
  add a WebVTT caption track and a visible transcript (labelled unverified).
- `transcribe` capability + endpoint provider in the compute manager; a
  transcription-service endpoint field in options.
- Central deployment: `relay/` Cloudflare Worker fronting Turso (token stays
  server-side) and `extension/config.js` so installs can default to one shared
  database. `store.defaultConfig()` drives the default backend.

## [0.9.2] - 2026
### Added
- Site-pack plugin system: platform-specific fixes layered on the generic rules,
  matched by host / generator meta / selector signatures. Bundled starters for
  Blacklight/Samvera, DSpace 7, Islandora/Drupal, Omeka S, and IIIF viewers.
- Declarative (JSON) packs anyone can add at runtime from the options page, plus
  an imperative pack form for bundled packs. Authoring guide in docs/SITE-PACKS.md.
- Matched packs surface in the in-page report and in `remediate()` results.

### Fixed
- `undo()` now restores *every* attribute a rule changed on an element (the
  original snapshot previously captured only the first-changed attribute).

## [0.9.1] - 2026
### Fixed
- Extension pages no longer use inline scripts (Manifest V3 CSP blocked them),
  fixing the blank/inert Audit and Settings pages.
- `Store.ping()` added to the Turso store so "Test / create schema" works for
  local-dev and cloud backends.

### Added
- Dashboard: compliance-by-situation bar chart, conformance-level rollup, trend
  over time, and CSV/JSON export (dependency-free SVG).

## [0.9.0] - 2026
### Added
- Local-first assessment storage (IndexedDB) as the zero-setup default, sharing
  one schema with Turso; storage backend selectable (local / Turso dev / cloud).
- Assessment mode: auto-drafts the mDLAUG survey for all 24 situations and saves
  to the chosen store; Turso (libSQL) HTTP client + schema.
- Reading Room: standardized, screen-reader-first view with auto Contents.
- Compute manager: budgeted queue for description/OCR/reflow with pluggable providers.
- Highlight overlay for repairs; bundled pdf.js + mammoth (offline, no fetch step).
- Conformance levels aligned to mDLAUG Appendix IV.

### Notes
- Pre-1.0. Working and tested in Node (jsdom/fake-indexeddb); browser smoke-tested.
