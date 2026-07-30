# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versioning is pre-1.0 and may shift.

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
