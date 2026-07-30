# mDLAUG Repair

A Manifest V3 browser extension that repairs, on the fly, the 24 screen-reader
"help-seeking situations" catalogued in the **Mobile Digital Library Accessibility
and Usability Guidelines** (https://sites.uwm.edu/mdlaug/), and converts inaccessible
PDF/Word files into accessible formats — all client-side, no server, no uploads.

<tldr>
to install in chrome and test
go to the mdlaug-a11y direectory and download the extension directory - go to chrome and add the unpacked extension.  it's preconfigured to write to a cloud database for everyone's convenience.  if that ceases to be a convenience... idk... do things

</tldr>



<p></p>
<img width="400" height="400" alt="plugin dashboard" src="https://github.com/user-attachments/assets/82af9eb5-0993-492c-98c6-f2871886446a" /><br>
<img width="400" height="400" alt="the plugin attempts to find issues automatically when possible" src="https://github.com/user-attachments/assets/9f8d7332-3749-49e6-978f-c368e5779b12" /><br>
<img width="400" height="400" alt="there is a survey instrument under the hood" src="https://github.com/user-attachments/assets/b2097060-6b19-47b5-b42d-cec04fcabbb8" /><br>
<img width="400" height="400" alt="the surveys can be aggregated for convenience" src="https://github.com/user-attachments/assets/eef95030-c489-40e0-8ab6-14ea8917ea69" /><br>




## Why this exists

The mDLAUG documents concrete barriers blind/visually-impaired users hit in digital
libraries. The large majority are *authoring* defects a browser can detect and repair
in the live DOM (missing labels, roles, landmarks, focus traps, live regions). A
smaller core — direct file access (ACC1) and images/graphs (ACC2/ACC3) — needs real
compute, which is what the bundled converter provides. The goal is to make standards
compliance the default rather than a per-site project.

## Install (developer mode)

pdf.js and mammoth are **bundled** in `vendor/` — there is nothing to build or fetch.

1. Chrome/Edge → `chrome://extensions` → enable **Developer mode** → **Load unpacked**
   → select this `extension/` folder.
2. Click the toolbar icon → **Repair this page** (or enable auto-repair). The page's
   accessibility tree is repaired in place; **Highlight changes** (on by default) draws
   a labelled box on every element that was touched, tagged with its mDLAUG code, so you
   can *see* what changed even though ARIA repairs are visually invisible.
3. Open the **Conversion studio** (options page) to turn a PDF/DOCX/CSV/TXT into
   accessible HTML or a properly-styled `.docx`.

`scripts/fetch-vendor.sh` can re-fetch/upgrade the vendored libraries, but is not
required — the extension never phones home at runtime.

## Seeing the repairs (for reviewers / PR evidence)

Because every fix is an ARIA/semantic attribute, the page looks identical to a sighted
user. Two affordances make the work legible:

- **Highlight overlay** — `mDLAUG.highlight(true)` (the panel's *Highlight changes*
  toggle) boxes each repaired element and prints its mDLAUG code(s); teal = a repair was
  applied, amber = content a human/AI still needs to supply (e.g. an image description).
- **Per-code report** — the popup and in-page panel list every change grouped by mDLAUG
  situation. Every mutation is also recorded in `data-mdlaug` / `data-mdlaug-orig` on the
  element itself, so the diff is inspectable in DevTools and fully reversible.

## Architecture

```
engine/remediator.js   in-place DOM repair engine (idempotent, reversible) + highlight overlay
engine/converter.js    PDF/DOCX/CSV/TXT -> accessible HTML + DOCX writer + viewers
engine/compute.js      budgeted job queue for heavy work (image/graph description, OCR, PDF reflow)
engine/reader.js       the standardized BVI Reading Room (extractor + shadow-DOM renderer)
engine/assessment.js   turns the audit into the mDLAUG survey scorecard (24 situations)
engine/turso.js        libSQL/Turso HTTP client + assessment schema + data-access layer
src/content.js         injects engines, runs repairs, builds the compute manager, in-page panel
src/background.js       badge + cross-origin file-size (HEAD) helper
ui/popup.*             toolbar popup: run/undo, Reading Room, report
ui/studio.html         conversion studio + Reading Room/compute settings (options page)
ui/panel.css           in-page panel styling
vendor/                pdf.js 4.10.38 + mammoth 1.9.0 (bundled, never phones home)
```

Both engines are framework-free and attach to `window.mDLAUG`. The same two files
power the extension *and* the standalone repair-bench demo, so there is one source of
truth. Every DOM mutation is recorded in `data-mdlaug-orig` and fully reversible via
`mDLAUG.undo()`.

## The Reading Room — a standardized BVI viewpoint

Repairing a site in place still leaves a BVI user to relearn each digital
library's idiosyncratic layout. **Open Reading Room** (in-page panel or popup)
re-presents whatever page you're on in one consistent, screen-reader-first view,
rendered in an open shadow root so the host site's CSS can't distort it:

- skip link → title / source → **Contents** (auto jump-links from the heading
  outline — mDLAUG NAV4.3, "overview of a lengthy item with links to sections") →
  content in true reading order;
- every image, graph, table and attached file handled explicitly (real `<table>`
  with `<th scope>`, files with a **Reflow inline** action);
- user controls for text size, line spacing, and light/dark/sepia themes.

### Compute manager (heavy work, on a budget)

Describing images/graphs, OCR-ing image-of-text, and reflowing large files are
too expensive to run eagerly, so they go through `engine/compute.js`: one queue,
a concurrency cap, per-capability **budget policy** (automatic / on-tap / off),
content-hash **caching** (never describe the same image twice), progress, and
cancel. A **Background tasks** drawer in the Reading Room shows every job's state.

Providers are pluggable, so the heavy models stay *your* choice:

- **PDF/DOCX reflow** — always on (the converter is bundled).
- **Image / graph description** — point it at your own endpoint in the options
  page (`{ image, prompt } → { description }`, or an OpenAI-style response). Off
  by default; when unset, missing descriptions are simply flagged. Ideal for a
  self-hosted vision model so nothing leaves your machine.
- **OCR** — Tesseract WASM, lazy-loaded only if you drop it in `vendor/tesseract/`
  and tick the box; absent, OCR degrades to a flag rather than an error.

Machine output is always shown labelled **"AI · unverified"** — surfaced for the
author to confirm, never passed off as authored.

## Assessment mode → Turso

The mDLAUG compliance survey scores each situation 1–7, lists violations, lists
good techniques, and attaches screenshots. **Assess this page** (popup) drafts
that survey automatically: the audit's repairs/flags become the violations, a set
of positive checks becomes the good techniques, and a heuristic seeds a suggested
1–7 score — for all 24 situations, each linked to its guideline. The assessor
confirms scores, edits notes, drags in screenshots, and saves.

Assessments persist with **no setup by default** — to a local in-browser database
(IndexedDB) that uses the *same schema* as Turso. Storage is a one-line choice in
the options page:

- **This browser (local)** — default, zero setup, private to the device.
- **Turso local dev** — a `turso dev` server (`http://127.0.0.1:8080`, no token);
  the schema is created automatically on first save.
- **Turso cloud** — a hosted libSQL database (URL + token).

Every backend implements one interface (`saveAssessment`, `listAssessments`,
`getAssessment`, `complianceByCode`), so switching backends changes nothing else,
and a local database can be replayed into Turso later with no translation. The
schema (shared by both) mirrors the survey:

```
assessment(id, dl_name, dl_url, assessor, created_at, user_agent,
           tool_version, overall_note, auto_summary)
   └─< situation_result(id, assessment_id, code, level, title,
                        compliance_score,   -- 1-7, the human's answer to 1.1
                        auto_score,          -- the tool's suggestion
                        auto_findings,       -- JSON: violations + good techniques
                        violations_note, good_note)   -- 1.2 / 1.3
          └─< evidence(id, situation_result_id, kind, filename, note, image_base64)
```

A whole assessment (parent + 24 situations + their evidence) is written as one
atomic `BEGIN...COMMIT` pipeline using client-generated UUID keys. The store also
offers `listAssessments`, `getAssessment`, and `complianceByCode` (average score
per situation, per library) so you can track a library's compliance over time.

**Credentials & privacy.** The Turso URL + token live in `chrome.storage.local`
(device-only, never synced) and are sent directly to your database endpoint,
which is why `host_permissions` includes `https://*.turso.io/*`. For a shared or
production deployment, front Turso with a thin relay that holds the token
server-side and point the Database URL at the relay — the request shape is
identical, so nothing else changes.

## Conformance levels

Every rule's A / AA / AAA level is set to match **mDLAUG Appendix IV** (Levels of
Conformance Recommendation, Tables 1–3) exactly — e.g. EVA1 and FIL3/HEP1 are
Level A; NAV2 is AA; ACC6, COM2/NAV1 and RED4 are AAA. `mDLAUG.remediator.rules()`
reports the level per rule so a report can be filtered by conformance target.

## Coverage — all 24 mDLAUG situations

| mDLAUG | Situation | What the engine does | Kind |
|---|---|---|---|
| ACC1 | Directly accessing files | Name links with format+size, new-window warning, **inline accessible viewer** | fix |
| ACC2/COM3 | Accessing/comprehending images | Flag missing/filename alt; hide decorative thumbnails | fix+flag |
| ACC3/COM4 | Accessing/comprehending graphs | role=img + long-description scaffold | fix+flag |
| ACC4 | Accessing collection items | Expose card grids as named lists | fix |
| ACC5 | Expandable/collapsed content | Button semantics + synced aria-expanded + keys | fix |
| ACC6 | Query suggestion | ARIA combobox + announced suggestion count | fix |
| COM1 | Understanding DL structure | Skip link, main landmark, labelled nav | fix |
| COM2/NAV1 | Search filtering structure | Labelled filter groups + apply announcements | fix |
| EVA1 | Assessing relevance | Descriptive result names (title+format+snippet) | fix |
| EXE1 | Clearing a search box | Real labelled Clear button + focus return | fix |
| EXE2/INT1 | Exiting an open item / layered windows | Dialog semantics, focus trap, Escape, inert bg | fix |
| EXE3 | Returning to a previous page | Breadcrumb landmark + aria-current | fix |
| FIL1/USE1 | Icon search feature / SR & voice | Names for icon-only controls | fix |
| FIL2/RED3 | Distinguishing search features | Distinct labels per search region | fix |
| FIL3/HEP1 | Mobile help info | Labelled, discoverable help links | fix |
| NAV2 | Paginated sections | nav landmark, aria-current, announced page change | fix |
| NAV3/NAV5 | Navigating/into results | Live count, per-result position, skip-to-results | fix |
| NAV4 | Navigating within an item | Labelled page controls in viewers | fix |
| RED1 | Recognizing results availability | aria-live "N results found / none" | fix |
| RED2 | Titles vs thumbnails | Decorative thumbnails hidden from SR | fix |
| RED4 | Recognizing authorized features | aria-disabled + reason ("sign in to use") | fix |

"fix" = safe automatic repair. "flag" = surfaced for human/AI content (we never
fabricate an image description and present it as authored). A captioning hook
(`onNeedAltText`) lets you wire in a describe-image model for ACC2/ACC3.

## Honest limitations

- PDF extraction is layout-heuristic. Well-structured text PDFs reflow cleanly;
  scanned/image-only PDFs need OCR (hook: `converter.configure({ ocr })`).
- DOCX→PDF is intentionally left to the browser's own print-to-PDF rather than a
  re-implemented layout engine, to avoid silent fidelity loss.
- Heuristics for site-specific widgets (autocomplete, modals) are best-effort; the
  panel report shows exactly what changed so nothing is silent.

## License

MIT for this code. Vendored pdf.js (Apache-2.0) and mammoth (BSD-2-Clause) keep
their own licenses.
