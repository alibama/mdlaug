# Automating more of the review

What the crawler now does on its own, what still needs a person, and the tools worth
adding next, ranked by what each would let us assert. Written after the October 2026
re-crawl; see `scripts/significance.py` for the statistics and the published report for
the current findings.

## What changed in the October 2026 pass

| Problem in earlier runs | What the crawler does now |
|---|---|
| Cookie/consent banners and pop-ups made screenshots look broken and blocked search. The dismisser searched the whole page and, on Digital Commons, clicked "Skip to main content". | **Overlay pass on every page, before anything is measured.** Recognises 18 consent managers (OneTrust, Cookiebot, Klaro, CookieYes, Osano, Didomi, TrustArc, Drupal EU Cookie Compliance, …) plus any modal, promo or app banner floating over the page. Each overlay is first *measured as users meet it* (exposed as a dialog? named? closed by Escape? reachable by Tab? named reject/close control?) and recorded as an INT1/EXE2 finding, then dismissed using **only its own controls**: reject first, then close, then the consent manager's own API (e.g. `OneTrust.RejectAll()`), and accept only as a last resort. Dismissal repeats in layers (Digital Commons hides a "Switch to desktop view" box under its banner). Timed pop-ups are cleared again before axe/engine and before each screenshot. |
| Many "no results" were bot-protection pages (Cloudflare "Just a moment…", "Verify you are human"). | **Bot checks are detected and labelled** (`bot_challenge`), never solved. The page isn't measured and the site's status says "search behind bot check". |
| CONTENTdm and other script-rendered results were read while still showing "Loading…". Omeka's table of results and its "6 total" count went unrecognised. | The crawler **waits up to 15 s for results to render** and recognises results tables and "N total" counts. |
| A site whose search box couldn't be used contributed nothing about its results page. | **The platform's own search URL** (e.g. `/digital/search/searchterm/…` on CONTENTdm, `/catalog?q=` on Samvera) is opened instead and recorded as method `url`. The failure of the search box itself stays on record. |
| The vendor column in the spreadsheet is sometimes wrong (sites listed as Islandora that run CONTENTdm or Digital Commons; Preservica, Primo and Archive-It listed under the six). | **Platform fingerprint** from each site's own markup (generator tag, asset paths, URL patterns, footer). The analysis counts a site under the vendor it actually runs and leaves non-repository software out of vendor comparisons. |
| Nothing checked that the screenshots were clean. | **Vision QA** (optional, local): `gemma3:4b` looks at the first-view and post-dismissal screenshots of each home page. Its verdicts are advisory: it catches overlays the DOM rules miss, but also reports floating share bars as cookie banners. |

## What the October re-crawl showed about the crawler itself

Run 4 (all 169 sites, iPhone 13), patched by runs 5–6 after the fixes below:

* **Search reached results on 75 sites**, up from 57 in the desktop run, with results waited for
  and the platform-URL fallback. 33 searches ended at a bot check: 25 of the 26 Digital
  Commons sites, all at Cloudflare.
* **Vision QA earned its place.** It found three bot-check pages the text rules missed
  (DukeSpace's Anubis check, NJ State Library's "Security Check", UCLA's "Making sure you're
  not a bot!") and a content notice drawn inside a *closed* shadow root (`<notice-dialog>` at
  GSU), which the DOM probe couldn't see. All four now have regression tests, and the
  affected 20 sites were re-crawled (runs 5–6). Its remaining flags after dismissal (28) are
  mostly share bars, chat buttons and sticky headers it calls "cookie banners".
* **Two more detector fixes came from preparing the training material:** CookieConsent wraps
  its modal in a zero-size fixed container, which hid it, and an in-page search form marked
  `role="dialog"` was counted as an overlay. Both are fixed with regression tests. Neither
  site is in the vendor comparisons.
* **The spreadsheet's platform column needs the fingerprint.** Only 90 of 132 crawled sites
  could be verified as running the listed platform. Of the 16 listed as Islandora, 2 carry
  Islandora markers; the rest are custom Drupal or museum systems, Primo or Preservica.
  Vendor statistics use the verified sites only.

## Ranked next steps

### 1. Get the results pages that bot protection hides, with permission

Digital Commons search (and some Samvera/Islandora sites) sits behind Cloudflare. We
won't solve challenges or disguise the crawler. Legitimate routes, in order of effort:

* Ask the vendor (bepress/Elsevier for Digital Commons) or the institution to **allowlist
  the research user agent** (`mDLAUG-accessibility-research (+https://github.com/alibama/mdlaug)`)
  or a fixed IP for a crawl window. This is a reasonable ask of a vendor we intend to report to.
* Run the crawl from a **university network**, which some sites already trust.
* For the remainder, **a person runs the search on a phone** and records the results-page
  checks in the review app. It's about 10 minutes per site and only needed for blocked sites.

### 2. Turn the LLM checks into claims with a small calibration set

LLM judgments (alt-text quality, page structure, help-page quality, snippet usefulness,
restricted-access explanations) cover 50–130 sites each, but none can be asserted because
no reviewer has checked them yet. The review app already records agreement per check:

* Two reviewers each confirm or override **~30 findings per LLM check** (stratified by
  platform). That's roughly 2 hours per person per check.
* A check whose LLM–reviewer agreement is ≥ 80% graduates to automated evidence and can
  be tested by vendor like the probes. One below that gets its prompt fixed (the Checks
  page keeps prompt versions, so the improvement is measurable) or stays manual.

### 3. Use stronger local models (no new infrastructure)

The M2 Max with 32 GB comfortably runs mid-size models. Compare them on the stored prompts
with `python -m mdlaug_crawl bench --model <name>`; that replays every past judgment and,
once reviews exist, scores each model against the reviewers.

* **Text judgments:** a 12–14B model (e.g. `gemma3:12b`, `qwen3:14b`) in place of
  `qwen3.5:4b`. Expect better structured output and fewer low-confidence answers; it's slower
  per call but the crawl is not latency-bound.
* **Vision QA:** `gemma3:12b` or `qwen2.5vl:7b` should cut the false positives seen with
  `gemma3:4b`. Set `MDLAUG_VISION_MODEL`.

### 4. Optional hosted judge: Claude via the Anthropic API

Where local models disagree with reviewers, a frontier model is the next lever, and these
pages are public, so sending them out raises no confidentiality issue.

* **Model:** Claude Opus 5.5 (`claude-opus-5-5`) for the judgments that need it (help
  pages, alt text in context, restricted-access explanations, screenshot QA). It takes
  images directly, so the screenshot check and the alt-text check could both see the
  picture, not just its file name. Whether a smaller tier (Claude Sonnet 5.5 or Claude
  Haiku 5.5) holds up is a measurement for the bench above, not something to assume.
* **Batch API:** crawl judgments aren't latency-sensitive, so queue them as a
  message batch after the crawl at reduced cost.
* **Prompt caching:** keep the instruction, rubric and reviewer exemplars as a stable
  prefix and the page evidence last, so repeated judgments reuse the cached prefix.
* It would slot in as another `transport` in `mdlaug_crawl/llm.py`, logged and
  cached like the Ollama calls, so agreement stays comparable across models.

### 5. Screen-reader-level evidence

The situations that always need a person (USE1, RED1 announcements, NAV5) are about what a
screen reader *says*. Two tools get closer automatically:

* **Playwright's accessibility snapshot** (`locator.aria_snapshot()`) gives the
  accessibility tree as text. That's better LLM input for COM1/USE1 than a heading list.
* **Guidepup** (`@guidepup/virtual-screen-reader`) produces the announcement transcript of
  a page or interaction in a headless browser: after a search, is the result count
  spoken? Real VoiceOver/NVDA automation via Guidepup is possible on macOS for a small
  sample, to calibrate the virtual one.

### 6. An LLM agent only where heuristics fail

About one site in ten still has no search box the selectors can find. An agent that reads
the accessibility tree and picks the control (a Playwright MCP-style loop) could rescue
those. Record it as method `agent`, like `url`, so the analysis can treat it separately.
It's a small gain now that the platform URL fallback covers most of these sites.

### 7. Sample design beats sample size for the institution question

Institution type shows little signal. Detecting the observed effect sizes would take
about 40–60 sites per type. Pairs answer it more cheaply: the same platform across
institution types, or one institution's collections on two platforms.

## Packaging

No Docker needed for how the group works today. Two light changes keep the minimalist feel:

* The analysis scripts need `scipy` (`requirements-analysis.txt`). Anaconda's scipy on
  this Mac fails to load, so run the scripts in a clean environment:
  `uv run --with-requirements requirements-analysis.txt python scripts/significance.py`.
* If the crawl moves to a server or a monthly schedule, Microsoft's Playwright Python image
  (`mcr.microsoft.com/playwright/python`) plus `requirements.txt` is enough. Ollama can
  stay on the host.
