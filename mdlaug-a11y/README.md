# mDLAUG Repair

**Make digital libraries usable with a screen reader — repair the page live, read it in a standardized view, and audit it against the mDLAUG guidelines.**

A framework-free, privacy-first browser extension (Manifest V3) that targets the 24 "help-seeking situations" described by the publicly published Mobile Digital Library Accessibility & Usability Guidelines (mDLAUG). Everything runs on-device; nothing is uploaded.

> Status: **v0.9.1**, pre-1.0. Working and tested; APIs may still shift. Issues and PRs welcome.

---

## Why

mDLAUG catalogs 24 concrete ways a blind or low-vision user loses the thread in a mobile digital library — an unlabeled magnifier icon, a PDF that silently downloads, a modal with no way out, a chart with no description. Most are markup defects a script can repair in the live DOM; a few (inaccessible files, images and graphs with no text alternative) need real conversion or a description model. This project does both, and adds two things a fixer alone can't: a **standardized reading view** so a screen-reader user gets the same predictable layout on every library, and an **assessment mode** that drafts the mDLAUG compliance survey automatically and stores the results.

## What it does

- **Repair** — one click rewrites the page's accessibility tree in place: file links get type/size and new-window warnings, icon buttons get names, disclosures get `aria-expanded`, dialogs get focus semantics, pagers become nav landmarks, unlabelled form fields get names, and so on. The report maps each finding to the relevant WCAG success criterion. Idempotent and fully reversible. A **highlight overlay** boxes every changed element and tags it with its mDLAUG code, because ARIA repairs are invisible by design.
- **Reading Room** — re-presents any page as one consistent, screen-reader-first view (rendered in a shadow root so site CSS can't distort it): skip link → title → auto-generated Contents (jump links from the heading outline) → linear content, with every image, graph, table and attached file handled explicitly. Text-size, spacing, and light/dark/sepia controls included.
- **Conversion studio** — turns a PDF/DOCX/CSV/TXT into accessible, semantic HTML or a properly-styled Word document, entirely in the browser.
- **Multimedia** — detects `<video>`/`<audio>` (and YouTube/Vimeo embeds) that ship no captions, names the player, and — with a transcription service configured — adds a real WebVTT caption track and a visible transcript (labelled unverified). Third-party embeds are flagged with guidance since their captions live in the player.
- **Compute manager** — heavy jobs (image/graph description, OCR, large-file reflow) run through one budgeted queue with per-capability policy (automatic / on-tap / off), caching, progress and cancel. Providers are pluggable, so a self-hosted vision model can supply descriptions without anything leaving your machine. Machine output is always labelled *unverified*.
- **Assessment → storage** — drafts the mDLAUG survey for all 24 situations (a 1–7 compliance suggestion, auto-detected violations, pre-existing good techniques), lets a human confirm and attach evidence, and saves. Storage **defaults to a local in-browser database with zero setup** and can be pointed at a [Turso](https://turso.tech/) (libSQL) database — local dev or cloud — using the same schema.
- **Dashboard** — compliance by situation, a conformance-level rollup, and a trend over time, with CSV/JSON export. Reads through the same store interface, so it works on local or Turso.
- **Site packs** — platform-specific fixes layered on the generic rules, applied only on matching sites. Bundled starters for Blacklight/Samvera, DSpace 7, Islandora/Drupal, Omeka S, and IIIF viewers; anyone can add their own as declarative JSON at runtime, or contribute a bundled pack. See [`docs/SITE-PACKS.md`](docs/SITE-PACKS.md).

## Install (developer mode)

pdf.js and mammoth are **bundled** — there is nothing to fetch or build.

1. Download or clone this repo.
2. Chrome or Edge → `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the `extension/` folder.
3. On any page: toolbar icon → **Repair this page**, **Open Reading Room**, **Audit this page**, or **Dashboard**.

`extension/scripts/check-install.sh` confirms the folder is complete; `fetch-vendor.sh` is an optional upgrader, not an install step.

## Try it without installing

Open `demo/demo.html` in any browser. It runs the same engine against a mock digital library built wrong on purpose: repair it, watch the "reader's eye" before/after of what a screen reader announces, toggle the highlight overlay, open the Reading Room, and convert a sample PDF.

## Architecture

One framework-free engine, several surfaces. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the module map and the assessment schema.

```
extension/engine/
  remediator.js   in-place DOM repair (idempotent, reversible) + highlight overlay
  converter.js    PDF/DOCX/CSV/TXT -> accessible HTML + dependency-free DOCX writer
  reader.js       the standardized Reading Room (extractor + shadow-DOM renderer)
  compute.js      budgeted job queue for heavy work (description, OCR, reflow)
  assessment.js   audit -> mDLAUG survey scorecard (all 24 situations)
  turso.js        libSQL/Turso HTTP client + schema + data-access layer
  store.js        storage resolver: local IndexedDB (default) or Turso, one interface
  (remediator also carries the multimedia caption/transcript rule; compute.js the transcribe job)
extension/ui/     popup, options (studio + settings), assessment editor, dashboard
extension/src/    content script + service worker
extension/config.js  central-deployment config (empty = local default)
extension/packs/  bundled site packs (Blacklight, DSpace, Islandora, Omeka, IIIF)
extension/vendor/ pdf.js (Apache-2.0) + mammoth (BSD-2-Clause), bundled
relay/            Cloudflare Worker relay fronting Turso (for shared/central storage)
analytics/        Streamlit read-only dashboard over the audit database
bdd/              BDD data store: situations as Given/When/Then + algorithmic-vs-manual matrix
demo/             standalone, no-install demo
tests/            node-based test suites (see below)
```

## Conformance levels

Every rule's A / AA / AAA level matches **mDLAUG Appendix IV** exactly, and `mDLAUG.remediator.rules()` reports the level per rule so reports can be filtered by conformance target.

## Honest scope

- Repairs cover the highest-severity, universally-fixable situations; site-specific widgets (autocomplete, custom modals) are pattern-matched and may need tuning per platform. Bundled site packs use conservative, well-known selectors and are meant to be tuned against live installs. Every change is recorded on the element (`data-mdlaug` / `data-mdlaug-orig`) and in a per-code report, so nothing is silent.
- Text PDFs reflow cleanly; **scanned/image-only PDFs need OCR**, which isn't bundled (the language data is ~10 MB) — it's an installable provider that degrades to a flag when absent.
- **Image/graph descriptions and video transcription require a model/service.** The tool never fabricates them; without a configured endpoint it flags what's missing, and any generated caption, transcript, or description is shown as *unverified*.
- Beyond the 24 mDLAUG situations, the engine also remediates two gaps the guidelines' own reviewers flagged: uncaptioned video/audio (MED1) and unlabelled form fields (FORM1). These are WCAG-aligned add-ons, marked as such.
- Heuristic heading detection can misjudge a borderline sub-head; DOCX→PDF is deliberately left to the browser's print-to-PDF rather than a re-implemented layout engine.

## Central deployment (Cloudflare + Turso)

By default the extension saves audits to a private local database — zero setup.
To make a whole team write to **one shared database by default**, deploy the
included Cloudflare Worker relay (`relay/`) in front of a Turso database and set
`extension/config.js`:

```js
window.MDLAUG_CONFIG = { centralUrl: "https://mdlaug-relay.<you>.workers.dev", centralToken: "<optional key>" };
```

The relay holds the Turso token server-side, so no credential ships in the
browser. Full walkthrough in [`relay/README.md`](relay/README.md). Individual
users can still switch to a private local database in Options.

## BDD data store

`bdd/` encodes the remediation knowledge as behaviour-driven scenarios — every
situation as a User Story with Given/When/Then acceptance criteria — and classifies
every forum-proposed guideline as **algorithmic**, **hybrid**, or **manual**. It's
generated and validated against the engine (`npm run bdd`); see
[`bdd/remediation-matrix.md`](bdd/remediation-matrix.md) and
[`bdd/README.md`](bdd/README.md).

## Analytics dashboard

`analytics/` is a small Streamlit app that reads the audit database (Turso, or the
relay) and renders compliance by situation, a conformance-level rollup, and a trend
over time — filterable by library.

```bash
cd analytics && pip install -r requirements.txt
cp .streamlit/secrets.toml.example .streamlit/secrets.toml   # set TURSO_URL + token
streamlit run app.py
```

A read-only Turso token is recommended for this. See [`analytics/README.md`](analytics/README.md).

## Installing / packaging

`npm run pack` builds a versioned zip into `dist/` to hand around; see
[`INSTALL.md`](INSTALL.md) for the load-unpacked, zip, `.crx`, and Web Store paths
(and why a `.crx` isn't a one-click installer on modern Chrome).

## Offline OCR (optional, no service)

OCR can run **entirely on-device** with no service call: `scripts/fetch-tesseract.sh`
downloads the WebAssembly Tesseract build into `extension/vendor/tesseract/`, then
tick *"OCR engine installed"* in Options. The engine is loaded into the extension's
isolated world (so a page's CSP can't block it) and recognises text locally. It's a
larger install (~15 MB of language data) but adds no dependency and keeps images on
the device. For cross-origin images, pair it with the background byte-fetch so the
pixels aren't blocked by canvas tainting (see the note in `docs/ARCHITECTURE.md`).

## Testing

```bash
npm install
npm test
```

Suites run in Node with jsdom and fake-indexeddb (no browser needed) and cover the repair engine, converter, compute queue, Reading Room extraction, the Turso client (against a mocked pipeline API), the assessment scorecard, the local store, and the dashboard aggregates. See [`tests/`](tests/).

> Tests validate logic in Node; a few browser-only concerns (e.g. Manifest V3's ban on inline scripts) can't be caught there and are checked by loading the unpacked extension.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Good first areas: tuning the widget heuristics against a specific platform (DSpace, Islandora, Samvera/Blacklight, Omeka S), adding positive checks to the assessment's "good techniques" detection, and a description-provider adapter for a local model.

## Acknowledgements

With sincere thanks to **Dr. Iris Xie** (University of Wisconsin–Milwaukee) and
colleagues, whose **Mobile Digital Library Accessibility & Usability Guidelines
(mDLAUG)** this project implements and audits against. The guidelines are published
at <https://sites.uwm.edu/mdlaug/>. This is an independent implementation inspired
by that work.

Bundled libraries: **pdf.js** (Mozilla, Apache-2.0) and **mammoth.js** (Michael
Williamson, BSD-2-Clause) in `extension/vendor/`.

## License

[Apache-2.0](LICENSE). Bundled third-party libraries retain their own licenses; see [`NOTICE`](NOTICE).

This project is independent and is not affiliated with, authorized, approved, or endorsed by the authors of the mDLAUG guidelines or their institution.
