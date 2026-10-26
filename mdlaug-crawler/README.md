# mDLAUG crawler

- **Just want the results?** [Read the Vendor Accessibility Signals report](https://alibama.github.io/mdlaug/signals/).
- **New here?** [Follow the training guide](TRAINING.md). It needs no programming.
- **Project website:** https://alibama.github.io/mdlaug/

Crawls a list of digital libraries and assesses them against the 24 mDLAUG
situations — automating what can be automated, using a local LLM where rules get
brittle, and routing everything uncertain to a human review queue. Results, review
decisions, and a full event log live in one SQLite file; a Streamlit app provides
analytics, review, and workflow diagnostics.

## Setup

**New here? Follow [TRAINING.md](TRAINING.md).** It's a step-by-step guide for Windows and Mac
that needs no programming. In short, from this folder:

| | Mac / Linux | Windows |
|---|---|---|
| Install everything (Python, libraries, Chromium) | `bash mdlaug.sh setup` | `.\mdlaug setup` |
| Download the October 2026 results | `bash mdlaug.sh get-data` | `.\mdlaug get-data` |
| Open the app | `bash mdlaug.sh app` | `.\mdlaug app` |
| Test crawl / full crawl | `bash mdlaug.sh trial` / `crawl` | `.\mdlaug trial` / `crawl` |
| Statistics report | `bash mdlaug.sh report` | `.\mdlaug report` |

The setup command uses [uv](https://docs.astral.sh/uv/) to install its own Python into `.venv`
here, so it doesn't touch any other Python on the machine. Everything else is in
`scripts/helper.py`; `mdlaug.sh` and `mdlaug.bat` only make sure that's installed first.

The local LLM is optional but recommended: install [Ollama](https://ollama.com), then
`ollama pull qwen3.5:4b` (text judgments) and `ollama pull gemma3:4b` (screenshot check).

Working directly with Python (inside `.venv`) also works:

```bash
python -m mdlaug_crawl import sample/DLs_for_mDLAUG_Assessment.xlsx
python -m mdlaug_crawl run --platform DSpace --limit 5 --note "DSpace pilot"
python -m mdlaug_crawl export --run 1 --out run1.xlsx
streamlit run app.py
```

## Site list

The **Site list** tab shows every site and, for the selected run, its status:
**complete** (loaded, and a search returned results), **search failed** (with the
reason), **no search found**, **failed to load**, or **not crawled**. Switch sites on
or off for future crawls, add one site or paste many (one per line:
`URL, institution, platform, library type` — only the URL is required), import a
spreadsheet, or re-crawl just the sites that didn't complete. The Run crawl tab shows
exactly which sites a crawl will evaluate before you start it. CLI: `python -m
mdlaug_crawl sites list|add|enable|disable`, `run --retry-failed <run>`.

## What happens per site

Mobile emulation (iPhone 13) by default — mDLAUG is about mobile use; `--desktop` to
switch.

| Step | What it checks | mDLAUG |
|---|---|---|
| Every page, first | **bot-protection challenge** (Cloudflare "Just a moment…", "Verify you are human") — recorded as `bot_challenge`, never solved, page not measured; **overlays** on load (18 known consent managers such as OneTrust, Cookiebot and Klaro, plus modals, promos and app banners) — each is measured as users meet it (exposed as a dialog? named? Escape closes it? reachable by Tab? named reject/close control?), then dismissed with its own controls, reject first, so later checks and screenshots see the page | INT1, EXE2 |
| Home page | platform fingerprint (which repository software the markup says it is); vision check of the screenshots (optional); accessible names & label-in-name (voice control); heading/landmark structure (LLM); image alt quality (LLM); restricted features (LLM); mDLAUG engine; axe-core | EXE2, INT1, USE1, COM1, ACC2/COM3, RED4, + engine |
| Search | close or get past pop-ups that appear later (Escape, then the overlay's own reject/close control — recorded as an INT1 finding); use it by keyboard (focus + type + Enter, as a screen-reader user would), falling back to submitting it in script (recorded); find the search box (including behind an icon toggle); its name and search landmark; Tab presses to reach it; icon-only submit; autocomplete semantics; clear control | FIL1, FIL2/RED3, ACC6, EXE1 |
| Results | waits up to 15 s for script-rendered results; if the search box couldn't be used, opens the platform's own search URL instead (method `url`); result count + whether it's announced; focus/skip to results; list structure; pagination landmark + `aria-current`; filter grouping; thumbnail/title duplication; snippet usefulness (LLM) | RED1, NAV5, NAV3, NAV2, COM2/NAV1, RED2, EVA1 |
| First result | item page through the engine; image alt quality | ACC1, ACC3, NAV4, EXE3, … |
| Help | finds help/FAQ/accessibility links; judges the page (LLM) | FIL3/HEP1 |
| Browse | collections page through the engine | ACC4, COM1 |

The **mDLAUG engine** is the same tested code as the browser extension, injected
into each page, so crawl scores and in-browser audits agree. The crawler ships it as
a generated file, `mdlaug_crawl/engine.bundle.js`, so the crawler folder runs on its
own. The extension remains the source of truth: after changing the engine, run
`python crawler/scripts/sync_engine.py` (or `npm run crawler:sync`). A test fails if
the bundle is stale. To try unreleased engine changes without rebuilding, set
`MDLAUG_ENGINE_DIR` to an extension folder. **axe-core** (MPL-2.0, `vendor/`) gives a WCAG 2.2 A/AA baseline.

## Overlays, bot checks and platform labels

Overlays were the main reason earlier screenshots looked broken and searches failed. The
crawler now handles them before measuring anything on a page:

1. **Detect** what floats over the page: known consent managers by their own markup,
   anything exposed as a modal dialog, and fixed layers that cover most of the screen or
   carry consent/promo/app-banner text. Site headers and nav bars are not overlays.
2. **Measure** each one as a keyboard or screen-reader user meets it, and record a
   `probe.overlay` finding (INT1/EXE2) with the five criteria in its evidence.
3. **Dismiss** it using only controls inside it: the consent manager's reject control,
   then any reject/close button by name, then the manager's API (`OneTrust.RejectAll()`,
   …), and *accept* only as a last resort; hide it only if nothing works. This repeats
   in layers, because one overlay can hide another. Timed pop-ups are cleared again
   before axe/engine and before each screenshot.

**Bot-protection challenges** are detected on every page. The crawler waits a few seconds
in case the check clears by itself, and otherwise records the page as `bot_challenge` and
moves on. It never interacts with a challenge.

**Platform fingerprint:** the home page's own markup (generator tag, asset paths, URL
patterns, "Powered by" text) says which repository software a site runs. It is stored on
the page (`pages.fingerprint`) and logged when it disagrees with the spreadsheet.

**Vision QA (optional):** if `MDLAUG_VISION_MODEL` (default `gemma3:4b`) is pulled in
Ollama, it looks at each home page's first-view and post-dismissal screenshots and flags
overlays the DOM rules missed. It is a check on the crawler, not a finding about the site.

## Statistical review

`scripts/significance.py` tests which differences between platforms (vendors) and
library types hold up using automated evidence only. `scripts/significance_report.py`
renders the results as a shareable page.

```bash
bash mdlaug.sh report                 # or .\mdlaug report on Windows
python scripts/significance.py --run 4 --patch 5 --patch 6 --replicate 1   # choosing runs yourself
python scripts/significance_report.py
python scripts/build_site.py          # maintainers: update the GitHub Pages copy in ../docs
```

With no options it picks the latest large run, any runs whose note starts "patch of run N"
(re-crawls of some sites with a fixed crawler, whose rows replace the primary run's), and the
largest other run on a different device for replication. The published report is at
https://alibama.github.io/mdlaug/signals/. The narrative at the top of the report lives in
`scripts/significance_narrative.json`; rewrite it after reading new results. Outputs go to
`data/significance/` (per-site metrics, every test, platform labels, manual-review candidates,
`report.html`). The October 2026 outputs are kept in `reports/2026-10/`. See [`AUTOMATION.md`](AUTOMATION.md) for what
is automated, what still needs a person, and the tools worth adding next.

## Marked-up screenshots

For every page visited, the crawler records *where* each determination applies —
engine repairs, probe results, LLM verdicts (e.g. per-image alt quality), and
things done well — as boxes tagged **good** (green), **issue** (red), or **needs
review** (amber), then takes one clean full-page screenshot. The markup is drawn
afterwards as numbered markers with a key beside the page, so labels never cover
the content. Because the boxes are stored as data, the app can redraw them filtered:
the Review queue shows only the marks for the situation being judged, and the Sites
tab filters by situation and status. Files: `data/artifacts/r<run>_s<site>_p<page>_full.png`
(clean) and `…_annotated.png` (all marks).

## Repairs (best effort, per site)

After marking up a page, the crawler applies the engine's repairs, records every
change — each changed element with its CSS selector and before → after markup, and
each element the engine *added* (skip links, screen-reader text, inline-view buttons,
media controls) — photographs the repaired page with screen-reader-only additions
made visible, then undoes everything. In the Sites tab each page shows **before**
(findings) and **after** (teal = changed, purple = added) side by side with the change
list. Per site you can download:

* a **repair report** (zip): an accessible HTML report with before/after screenshots,
  every change as markup, and what still needs a person — shareable with the
  library's developers;
* a **draft site pack** (JSON) for the extension (Options → Site packs). Selectors are
  recorded against the original page (engine-added elements are ignored when
  counting positions; a test checks every selector resolves to the original
  element), but they come from specific crawled pages and names are generic — review
  and edit before use.

Repairs are best effort: they fix structure (names, roles, states, landmarks), never
content (alt text, transcripts, descriptions), which stays in the review queue.

## Checks page

For each of the 24 situations: the plain-language question being asked, what's
determined automatically, a starter rubric (what 7 / 4 / 1 look like), review
guidance for a person with a screen reader, and — where an LLM is used — its
editable instruction and a preview of the full prompt. These are starter
heuristics, not the mDLAUG team's official criteria; edit them as understanding
improves. Every change is kept in a history, and each LLM call records a *prompt
version*, so the Workflow tab can show whether an edit raised reviewer agreement.

Reviewers can mark any finding as a **good** or **bad example**. Examples collect on
the Checks page (with the marked-up page) as a growing reference of what different
libraries do for each situation, and — with few-shot on — up to four are added to
that situation's LLM prompt to calibrate it.

## Where the LLM is used — and where it isn't

Rules handle everything a selector can decide reliably. The LLM (Ollama, Qwen by
default) is used only for judgments rules can't make: page role when heuristics are
unsure, whether alt text is *meaningful*, whether a help page *explains* anything,
whether result snippets support relevance decisions, whether restricted features are
*explained*, and whether a home page's structure is *understandable*. Each call is
logged (prompt hash, latency, raw output, parse success) and cached; each answer
carries a confidence, and anything below `MDLAUG_REVIEW_CONF` (0.7) goes to review.
With the LLM off or unreachable, those checks fall back to weak heuristics flagged
for review — nothing is silently skipped.

## Comparing models

Pick the model in the app's sidebar (the list comes from Ollama, with size and parameter
count; the choice is saved and used by every crawl started from the app or CLI). Pick a
second under **Compare with** to test two models:

* **Replay (recommended on a laptop):** every LLM prompt is stored, so after a crawl,
  Workflow → Model comparison → *Replay with <model>* re-asks the same prompts to the
  second model, one model in memory at a time. CLI: `python -m mdlaug_crawl bench
  --model gemma3:4b --run 3`.
* **Live:** tick *Also run <model>* when starting a crawl. Both models answer every
  judgment (only the first model's answer is used); slower, and on limited RAM Ollama may
  swap models each call.

The comparison shows, per task: valid-JSON rate and median time for each model, how often
they agree (within 1 point; same page type), and — for findings a reviewer has judged —
how often each model agrees with the person. That last column is the one to decide on.

## Review phase (by design)

Every finding records its method and confidence. A situation is marked
**automated** only when it has high-confidence evidence and no review flag;
otherwise it's **needs review**, or **not observed** if the crawl found no evidence
(the feature may be absent). Some situations are *always* reviewed because the
honest answer needs a person: USE1 (real AT/voice behaviour), ACC3/COM4,
FIL3/HEP1, RED4.

In the app's **Review queue**, reviewers confirm, override, or mark N/A — lowest
confidence first — and tag what went wrong (wrong page type, selector missed,
false positive/negative, LLM wrong…). In **Sites**, reviewers set the final 1–7 per
situation. Overrides flow into the aggregate scores immediately.

## Improving the workflow

The **Workflow & logs** tab shows load failures, classification method mix, LLM
latency and parse-failure rates per task (with raw outputs), and **reviewer
agreement per check** with issue-tag counts — the checks with the lowest agreement
are the ones to fix next. Every stage also writes a JSONL log
(`data/logs/run-<id>.jsonl`) for offline analysis.

## Etiquette

robots.txt is respected; requests are spaced (`MDLAUG_DELAY`, default 2 s) with
low concurrency (2 sites); the user agent identifies the project. A few pages per
site (≤ `MDLAUG_MAX_PAGES`, default 6).

## Crowdsourced review

Publish a run to Turso and invite reviewers to a separate web app (`crowd_app.py`):
Google sign-in plus an allowlist you manage, two independent reviews per flagged
finding with consensus, and proposals + votes for the content fixes automation can't
write (alt text, names, labels). Accepted fixes produce each library's improved site
pack; agreed decisions pull back into the local database. For wider, sign-in-free feedback, `review_app.py` is an open reviewer whose self-identified reviews are kept separate from verified results. Setup for both: [`CROWD.md`](CROWD.md).

## Tests

```bash
pytest -q tests
```

Includes an end-to-end crawl of a local fixture library with real Chromium and a
deterministic stand-in for the LLM.

## Configuration (env vars)

`MDLAUG_DB`, `MDLAUG_ARTIFACTS`, `MDLAUG_LOGS`, `MDLAUG_LLM` (0/1), `OLLAMA_URL`,
`OLLAMA_MODEL`, `MDLAUG_REVIEW_CONF`, `MDLAUG_DEVICE` (Playwright device name; empty
= desktop), `MDLAUG_MAX_PAGES`, `MDLAUG_CONCURRENCY`, `MDLAUG_DELAY`,
`MDLAUG_ROBOTS`, `MDLAUG_QUERY` (default search term), `MDLAUG_AXE`.
