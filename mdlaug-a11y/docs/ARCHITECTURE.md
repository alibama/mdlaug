# Architecture

One framework-free engine, several deployment surfaces. Nothing runs off-device
except calls to endpoints the user explicitly configures.

## Modules (`extension/engine/`)

| Module | Global | Responsibility |
|---|---|---|
| `remediator.js` | `mDLAUG.remediator` | Detect + repair mDLAUG situations in the live DOM. Idempotent, reversible (`data-mdlaug-orig`), `highlight()` overlay, `audit()` (repair→report→undo), `rules()` metadata with Appendix-IV levels. |
| `converter.js` | `mDLAUG.converter` | PDF/DOCX/CSV/TXT → normalized model → accessible HTML; dependency-free DOCX writer; inline viewers. Uses bundled pdf.js + mammoth. |
| `reader.js` | `mDLAUG.reader` | Extract a page into a reading model; render the standardized Reading Room into a shadow root; route heavy work to the compute manager. |
| `compute.js` | `mDLAUG.compute` | Budgeted job queue (concurrency, per-capability policy, cache, progress, cancel) with pluggable providers: `describeImage`, `describeGraph`, `ocr`, `reflowPdf`, `transcribe`. |
| `assessment.js` | `mDLAUG.assessment` | Turn an audit into the mDLAUG survey scorecard for all 24 situations (1–7 suggestion, violations, good techniques); `toAssessment()` shapes it for storage. |
| `turso.js` | `mDLAUG.turso` | libSQL/Turso HTTP pipeline client, schema, and DAO (atomic `BEGIN…COMMIT`, UUID keys). |
| `store.js` | `mDLAUG.store` | `resolve(cfg)` → a store implementing one interface. Default = local IndexedDB; opt-in Turso local-dev or cloud. Same schema everywhere. |

## Site packs (`extension/packs/`)

Platform-specific fixes layered on the generic rules via `remediator.registerPack()`.
A pack declares when it applies (`match`: hosts / generator meta / selector
signatures) and a list of rules. Declarative rules are attribute-only JSON
(selector + attributes to set/remove, with `when` guards) and are safe to import
at runtime; imperative rules are JS `fix(ctx)` functions for bundled packs. Packs
run after the core rules and use the same undo-tracked helpers, so their changes
appear in the report, honor the highlight overlay, and reverse on undo. See
`docs/SITE-PACKS.md`.

## Surfaces (`extension/ui/`, `extension/src/`)

- `src/content.js` — injects the engines, runs repairs, builds the in-page panel and the compute manager, opens the Reading Room, builds assessment scorecards.
- `src/background.js` — action badge, cross-origin HEAD for file sizes, screenshot capture, opening pages.
- `ui/popup.*` — Repair / Reading Room / Dashboard / Audit / Conversion studio.
- `ui/studio.html` + `studio-page.js` — conversion studio and settings (compute providers, storage backend).
- `ui/assessment.html` + `assessment-page.js` — the audit editor (per-situation 1–7, notes, evidence) → save.
- `ui/dashboard.html` + `dashboard-page.js` — SVG charts + CSV/JSON export over the active store.

> Extension pages contain **no inline scripts or inline event handlers** — Manifest
> V3's CSP (`script-src 'self'`) blocks them. All page logic is in external `*.js`.

## Multimedia (MED1)

`remediator.js` includes a media rule that finds `<video>`/`<audio>` without a
captions/subtitles `<track>` (and YouTube/Vimeo embeds). It names the player and,
when `remediate()` is passed a `transcribe` hook (wired by the content script to
the compute manager's `transcribe` provider), a click builds a WebVTT track from
the returned timed segments and injects a visible transcript. All machine output
is labelled *unverified*; everything is reversible via the standard undo. This
extends beyond the 24 mDLAUG situations (WCAG 1.2 captions/transcripts).

## Central deployment (`extension/config.js`, `relay/`)

`config.js` sets `window.MDLAUG_CONFIG`. If `centralUrl` is set, `store.defaultConfig()`
returns a Turso-cloud config pointed at that URL, so every install defaults to the
central database; otherwise the default is local IndexedDB. `relay/` is a Cloudflare
Worker that forwards `/v2/pipeline` to Turso with the token held server-side, so no
credential ships in the browser.

## Storage schema (shared by local IndexedDB and Turso)

```
assessment(id, dl_name, dl_url, assessor, created_at, user_agent,
           tool_version, overall_note, auto_summary)
  └─< situation_result(id, assessment_id, code, level, title,
                       compliance_score,   -- 1-7 (human, survey Q1.1)
                       auto_score,          -- tool suggestion
                       auto_findings,       -- violations + good techniques
                       violations_note, good_note)   -- Q1.2 / Q1.3
        └─< evidence(id, situation_result_id, kind, filename, note, image_base64)
```

`SCHEMA_VERSION` (in `store.js`) gates changes. Keep changes **additive** (new
nullable columns / new object stores) so local and cloud stay interchangeable and a
local database can be replayed into Turso with no translation.

## Sharing (recommended)

For a team, use one shared Turso cloud database behind a **thin relay** (e.g. a
Cloudflare Worker) that holds the write token server-side and authenticates users
(OIDC/Keycloak fits here). The extension points its Database URL at the relay; the
request shape is identical. Writes are append-only (fresh UUID per audit), so there
are no edit conflicts. At team scale, move screenshot evidence to object storage and
store a URL instead of inline base64 (an additive schema change).
