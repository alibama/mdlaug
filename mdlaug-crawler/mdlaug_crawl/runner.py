"""Crawl orchestration.

Per site (mobile emulation by default):
  1. home page   — dialogs/Escape, names (USE1), structure (COM1), images (ACC2), engine, axe
  2. search flow — find search (incl. behind an icon toggle), keyboard reach, autocomplete,
                   clear control, submit → results page probes (RED1, NAV5, NAV3, NAV2,
                   COM2/NAV1, RED2, EVA1) + engine
  3. first result → item page (engine; images)
  4. help page   → FIL3/HEP1 (LLM-judged)
  5. browse page → engine
Every step logs an event with timing; every determination is a finding with method,
confidence and needs_review.
"""
import asyncio
import json
import os
import time
import urllib.robotparser
from pathlib import Path
from urllib.parse import urlparse, urljoin

import requests

from . import classify, scoring, annotate
from .config import Config, CRAWLER

PROBES_JS = (Path(__file__).parent / "probes.js").read_text(encoding="utf-8")
ENGINE_BUNDLE = Path(__file__).parent / "engine.bundle.js"
ENGINE_FILES = ["engine/remediator.js", "packs/blacklight.js", "packs/dspace.js", "packs/islandora.js",
                "packs/omeka.js", "packs/iiif.js", "engine/assessment.js"]
AXE_PATH = CRAWLER / "vendor" / "axe.min.js"


def _engine_js():
    """The mDLAUG engine to inject. Uses the bundled copy shipped with the crawler;
    set MDLAUG_ENGINE_DIR to an extension folder to test unreleased engine changes."""
    override = os.environ.get("MDLAUG_ENGINE_DIR")
    if override:
        d = Path(override)
        return "\n;\n".join((d / f).read_text(encoding="utf-8") for f in ENGINE_FILES)
    if not ENGINE_BUNDLE.exists():
        raise FileNotFoundError(f"engine bundle missing: {ENGINE_BUNDLE} — run scripts/sync_engine.py "
                                "from a full checkout of the repo")
    return ENGINE_BUNDLE.read_text(encoding="utf-8")


class SiteCrawler:
    def __init__(self, cfg: Config, store, llm, run_id, browser, playwright):
        self.cfg, self.store, self.llm, self.run_id = cfg, store, llm, run_id
        self.browser, self.pw = browser, playwright
        self.site_id = None
        self._first_result = None
        self.engine_js = _engine_js()
        self.axe_js = AXE_PATH.read_text(encoding="utf-8") if (cfg.run_axe and AXE_PATH.exists()) else None

    # ---------- logging / findings ----------
    def log(self, stage, msg, level="info", page_id=None, data=None, t0=None):
        self.store.log(self.run_id, stage, msg, level=level, site_id=self.site_id, page_id=page_id, data=data,
                       duration_ms=int((time.time() - t0) * 1000) if t0 else None)

    def find(self, page_id, code, check_id, method, outcome, score=None, confidence=0.8, needs_review=False,
             message="", evidence=None):
        if score is None and outcome in scoring.OUTCOME_SCORE:
            score = scoring.OUTCOME_SCORE[outcome]
        needs = needs_review or confidence < self.cfg.review_confidence or code in scoring.ALWAYS_REVIEW
        self.store.add_finding(self.run_id, self.site_id, page_id, code, check_id, method, outcome, score,
                               round(confidence, 2), needs, message, evidence)

    # ---------- robots ----------
    async def robots_ok(self, url):
        if not self.cfg.respect_robots:
            return True
        p = urlparse(url)
        rurl = f"{p.scheme}://{p.netloc}/robots.txt"
        try:
            r = await asyncio.to_thread(requests.get, rurl, timeout=10,
                                        headers={"User-Agent": self.cfg.user_agent_suffix})
            if r.status_code >= 400:
                return True
            rp = urllib.robotparser.RobotFileParser()
            rp.parse(r.text.splitlines())
            return rp.can_fetch("mDLAUG", url) and rp.can_fetch("*", url)
        except Exception:
            return True

    # ---------- page helpers ----------
    async def inject(self, page):
        await page.add_script_tag(content=PROBES_JS)
        await page.add_script_tag(content=self.engine_js)
        if self.axe_js:
            await page.add_script_tag(content=self.axe_js)

    async def probe(self, page, fn, *args):
        try:
            return await page.evaluate(f"(a) => window.__mdlaugProbe.{fn}.apply(null, a || [])", list(args))
        except Exception as e:  # noqa: BLE001
            return {"_error": str(e)[:300]}

    async def visit(self, page, url, hint, start_url=None, navigate=True):
        t0 = time.time()
        status, http, err = "ok", None, ""
        if navigate:
            await asyncio.sleep(self.cfg.polite_delay_s)
            for attempt in (1, 2):           # one patient retry: slow sites are common
                try:
                    resp = await page.goto(url, wait_until="domcontentloaded" if attempt == 1 else "commit",
                                           timeout=self.cfg.nav_timeout_ms if attempt == 1 else int(self.cfg.nav_timeout_ms * 1.5))
                    http = resp.status if resp else None
                    status, err = ("http_error" if http and http >= 400 else "ok"), ""
                    if attempt == 2:
                        await asyncio.sleep(3)   # 'commit' returns early; give the page a moment
                    break
                except Exception as e:  # noqa: BLE001
                    status, err = "error", f"{type(e).__name__}: {str(e)[:300]}"
                    if attempt == 1:
                        self.log("visit", f"{hint}: load failed, retrying once ({type(e).__name__})", "info", data={"url": url})
        if status == "ok":
            try:
                await page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass
        load_ms = int((time.time() - t0) * 1000)
        pid = self.store.add_page(self.run_id, self.site_id, url=url, final_url=page.url, status=status,
                                  http_status=http, device=self.cfg.device or "desktop", load_ms=load_ms, error=err)
        if status != "ok":
            self.log("visit", f"{hint}: failed to load {url}", "warn", pid, {"status": status, "http": http, "error": err}, t0)
            return None, None
        try:
            await self.inject(page)
        except Exception as e:  # noqa: BLE001
            self.log("inject", f"script injection failed: {e}", "warn", pid)
        summ = await self.probe(page, "summary")
        if "_error" in summ:
            self.log("summary", "probe summary failed", "warn", pid, summ)
            summ = {"url": page.url, "title": await page.title()}
        cls = classify.classify(summ, llm=self.llm if self.cfg.llm_enabled else None, start_url=start_url,
                                hint=hint, threshold=self.cfg.review_confidence,
                                run_id=self.run_id, site_id=self.site_id, page_id=pid)
        shot = ""
        if self.cfg.screenshots:
            shot = str(Path(self.cfg.artifacts_dir) / f"r{self.run_id}_s{self.site_id}_p{pid}.png")
            try:
                await page.screenshot(path=shot, full_page=False)
            except Exception:
                shot = ""
        self.store.update_page(pid, page_type=cls["page_type"], type_method=cls["method"],
                               type_confidence=cls["confidence"], title=summ.get("title", "")[:300], screenshot=shot)
        self.log("visit", f"{hint} → classified {cls['page_type']} ({cls['method']}, {cls['confidence']:.2f})", page_id=pid,
                 data={"url": page.url, "classification": cls, "headings": summ.get("headings", [])[:10]}, t0=t0)
        if hint and cls["page_type"] != hint and hint not in ("home",):
            self.log("classify", f"expected {hint}, classified {cls['page_type']}", "warn", pid, cls)
        return pid, summ

    # ---------- annotated screenshot ----------
    async def capture_annotated(self, page, pid, max_css_height=6000):
        """Record where findings are on the page (engine marks + probe/LLM annotations +
        good techniques), take one clean full-page screenshot, and render the markup."""
        if not self.cfg.screenshots:
            return
        t0 = time.time()
        try:
            # Mobile Chrome "text autosizing" re-inflates fonts when the full-page capture
            # resizes the viewport, which would shift boxes away from their elements.
            # Pin text size for the measure+capture pass so positions are identical.
            await page.add_style_tag(content="html,body{-webkit-text-size-adjust:100%!important;"
                                             "text-size-adjust:100%!important}")
            await asyncio.sleep(0.2)
            await page.evaluate("() => window.__mdlaugProbe.engineMarks()")
            await page.evaluate("() => window.__mdlaugProbe.annotateGood()")
            data = await page.evaluate("() => window.__mdlaugProbe.collect()")
            await page.evaluate("() => window.scrollTo(0, 0)")
            base = Path(self.cfg.artifacts_dir) / f"r{self.run_id}_s{self.site_id}_p{pid}"
            full = str(base) + "_full.png"
            h = int(data["meta"].get("scrollH") or 0)
            kw = {"path": full, "full_page": True, "scale": "css"}
            if h > max_css_height:
                kw["clip"] = {"x": 0, "y": 0, "width": int(data["meta"].get("vw") or 400), "height": max_css_height}
            await page.screenshot(**kw)
            data["meta"]["scrollW"] = data["meta"].get("vw") if kw.get("clip") else data["meta"].get("scrollW")
            ann_path = str(base) + "_annotated.png"
            await asyncio.to_thread(lambda: annotate.draw(full, data).save(ann_path))
            self.store.update_page(pid, annotations=json.dumps(data), fullshot=full, annotated=ann_path)
            by = {}
            for it in data["items"]:
                by[it["status"]] = by.get(it["status"], 0) + 1
            self.log("annotate", f"{len(data['items'])} annotation(s) {by}", page_id=pid, t0=t0)
        except Exception as e:  # noqa: BLE001
            self.log("annotate", f"annotated screenshot failed: {type(e).__name__}: {e}", "warn", pid, t0=t0)
        await self.capture_remediation(page, pid, max_css_height)

    async def capture_remediation(self, page, pid, max_css_height=6000):
        """Best-effort repair preview: apply the engine, record every changed/added element
        with before/after markup and a CSS selector, photograph the repaired page (engine-added
        screen-reader text made visible), then undo."""
        t0 = time.time()
        try:
            diff = await page.evaluate("() => window.__mdlaugProbe.remediationDiff()")
            if not diff.get("ok"):
                self.log("remediate", f"repair preview unavailable: {diff.get('error')}", "warn", pid, t0=t0)
                return
            await asyncio.sleep(0.3)
            base = Path(self.cfg.artifacts_dir) / f"r{self.run_id}_s{self.site_id}_p{pid}"
            after = str(base) + "_after.png"
            h = int(diff["meta"].get("scrollH") or 0)
            kw = {"path": after, "full_page": True, "scale": "css"}
            if h > max_css_height:
                kw["clip"] = {"x": 0, "y": 0, "width": int(diff["meta"].get("vw") or 400), "height": max_css_height}
                diff["meta"]["scrollW"] = diff["meta"].get("vw")
            await page.screenshot(**kw)
            await page.evaluate("() => window.__mdlaugProbe.undoRemediation()")
            items = []
            for c in diff["changed"]:
                items.append(dict(c["box"], code=(c["codes"] or ["FIX"])[0], status="fixed", source="engine",
                                  label=", ".join(f"{d['attr']}" for d in c["diff"])[:50]))
            for a in diff["inserted"]:
                items.append(dict(a["box"], code=(a["codes"] or ["ADD"])[0], status="added", source="engine",
                                  label=a["kind"] + (f": {a['text'][:30]}" if a["text"] else "")))
            ann = {"meta": diff["meta"], "items": items}
            after_ann = str(base) + "_after_annotated.png"
            await asyncio.to_thread(lambda: annotate.draw(after, ann, title="Repairs on this page").save(after_ann))
            diff["annotations"] = ann
            self.store.update_page(pid, remediation=json.dumps(diff), aftershot=after, after_annotated=after_ann)
            self.log("remediate", f"repair preview: {len(diff['changed'])} changed, {len(diff['inserted'])} added",
                     page_id=pid, t0=t0)
        except Exception as e:  # noqa: BLE001
            try:
                await page.evaluate("() => window.__mdlaugProbe.undoRemediation()")
            except Exception:
                pass
            self.log("remediate", f"repair preview failed: {type(e).__name__}: {e}", "warn", pid, t0=t0)

    # ---------- analyses ----------
    async def engine_and_axe(self, page, pid):
        t0 = time.time()
        try:
            card = await page.evaluate("() => window.mDLAUG.assessment.buildScorecard()")
        except Exception as e:  # noqa: BLE001
            self.log("engine", f"engine scorecard failed: {e}", "warn", pid)
            card = []
        n = 0
        for row in card or []:
            if row.get("autoScore") is None:
                continue
            flags = [v for v in row.get("violations", []) if v.get("kind") == "flag"]
            self.find(pid, row["code"], "engine.scorecard", "engine", scoring.outcome_from_score(row["autoScore"]),
                      score=row["autoScore"], confidence=0.85 if not flags else 0.6, needs_review=bool(flags),
                      message=(row.get("violationsNote") or row.get("goodNote") or "")[:500],
                      evidence={"violations": row.get("violations", [])[:8], "good": row.get("goodTechniques", [])[:8]})
            n += 1
        self.log("engine", f"engine scored {n} situations", page_id=pid, t0=t0)
        if self.axe_js:
            t1 = time.time()
            try:
                res = await page.evaluate("""async () => { const r = await axe.run(document, {runOnly:{type:'tag',
                    values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}, resultTypes:['violations']});
                    return r.violations.map(v => ({id:v.id, impact:v.impact, nodes:v.nodes.length, help:v.help, tags:v.tags})); }""")
                self.find(pid, "WCAG", "axe.wcag22aa", "axe", "fail" if res else "pass", score=None, confidence=0.9,
                          message=f"{len(res)} WCAG rule(s) violated", evidence={"violations": res[:40]})
                self.log("axe", f"axe: {len(res)} violated rules", page_id=pid, t0=t1)
            except Exception as e:  # noqa: BLE001
                self.log("axe", f"axe failed: {e}", "warn", pid)

    async def names_and_targets(self, page, pid):
        ns = await self.probe(page, "nameStats")
        if "_error" not in ns and ns.get("interactive"):
            ratio = 1 - ns["unnamed"] / max(1, ns["interactive"])
            score = max(1, min(7, round(1 + 6 * ratio) - (1 if ns["label_in_name_mismatch"] else 0)))
            self.find(pid, "USE1", "probe.accessible_names", "probe", scoring.outcome_from_score(score), score=score,
                      confidence=0.6, needs_review=True,
                      message=f"{ns['unnamed']}/{ns['interactive']} interactive elements unnamed; "
                              f"{ns['label_in_name_mismatch']} label-in-name mismatches (voice control)", evidence=ns)
        rf = await page.evaluate("""() => ({viewport_meta: (document.querySelector('meta[name=viewport]')||{}).content || '',
            scrollW: document.documentElement.scrollWidth, vw: window.innerWidth})""")
        reflows = rf["scrollW"] <= rf["vw"] * 1.05 and bool(rf["viewport_meta"])
        self.find(pid, "WCAG-1.4.10", "probe.mobile_reflow", "probe", "pass" if reflows else "fail", score=None,
                  confidence=0.85, message=("page fits the phone screen" if reflows else
                                            "no viewport tag or page wider than the screen — mobile users must "
                                            "zoom/scroll sideways") + f" (layout {rf['scrollW']}px on a {rf['vw']}px viewport)",
                  evidence=rf)
        ts = await self.probe(page, "targetSizes")
        if "_error" not in ts:
            self.find(pid, "WCAG-2.5.8", "probe.target_size", "probe", "fail" if ts["small_targets"] else "pass",
                      score=None, confidence=0.7, message=f"{ts['small_targets']} targets under 24×24 CSS px", evidence=ts)

    async def dialogs(self, page, pid):
        d = await self.probe(page, "dialogs")
        if "_error" in d or not d.get("open"):
            return
        before = d["open"]
        await page.keyboard.press("Escape")
        await asyncio.sleep(0.6)
        after = (await self.probe(page, "dialogs")).get("open", before)
        closes = after < before
        modal = any(x.get("aria_modal") == "true" for x in d["sample"])
        outcome = "pass" if closes and modal else ("partial" if closes or modal else "fail")
        for code in ("EXE2", "INT1"):
            self.find(pid, code, "probe.dialog_escape", "probe", outcome, confidence=0.75,
                      message=f"{before} dialog(s) open on load; Escape closes: {closes}; aria-modal: {modal}",
                      evidence={"before": d, "open_after_escape": after})

    async def images_llm(self, page, pid):
        imgs = await self.probe(page, "images")
        if not imgs or "_error" in imgs or not self._llm_on():
            return
        r = self.llm.ask("judge_alt_text", {"page_title": await page.title(), "images": imgs},
                         run_id=self.run_id, site_id=self.site_id, page_id=pid)
        if r.get("_ok") and isinstance(r.get("items"), list):
            try:
                await page.evaluate("(v) => window.__mdlaugProbe.annotateImages(v)",
                                    [i for i in r["items"] if isinstance(i, dict) and isinstance(i.get("index"), int)])
            except Exception:
                pass
        if r.get("_ok") and r.get("overall_score_1_7") is not None:
            self.find(pid, "ACC2/COM3", "llm.alt_quality", "llm", scoring.outcome_from_score(int(r["overall_score_1_7"])),
                      score=int(r["overall_score_1_7"]), confidence=r["_confidence"],
                      message=str(r.get("rationale", ""))[:400],
                      evidence={"images": imgs, "llm": r.get("items"), "prompt_version": r.get("_pv"), "llm_call": r.get("_call_id")})

    async def restricted(self, page, pid):
        hits = await self.probe(page, "restricted")
        if not hits or "_error" in hits:
            return False
        if self._llm_on():
            r = self.llm.ask("judge_restricted", {"snippets": hits}, run_id=self.run_id, site_id=self.site_id, page_id=pid)
            if r.get("_ok") and r.get("score_1_7") is not None:
                self.find(pid, "RED4", "llm.restricted_explained", "llm", scoring.outcome_from_score(int(r["score_1_7"])),
                          score=int(r["score_1_7"]), confidence=r["_confidence"], message=str(r.get("rationale", ""))[:400],
                          evidence={"snippets": hits, "llm": {k: r.get(k) for k in ("explains_why", "explains_how_to_get_access")}, "prompt_version": r.get("_pv"), "llm_call": r.get("_call_id")})
                return True
        self.find(pid, "RED4", "probe.restricted_present", "probe", "unknown", score=None, confidence=0.4, needs_review=True,
                  message=f"{len(hits)} restricted-looking control(s) found; explanation needs review", evidence={"snippets": hits})
        return True

    def _llm_on(self):
        return self.cfg.llm_enabled and self.llm is not None and self.llm.check()

    # ---------- search flow ----------
    async def search_flow(self, page, home_pid):
        t0 = time.time()
        s = await self.probe(page, "findSearch")
        via_toggle = False
        if not s.get("found"):
            tog = await self.probe(page, "findSearchToggle")
            if tog.get("found"):
                via_toggle = True
                self.find(home_pid, "FIL1", "probe.search_toggle", "probe", "pass" if tog["named"] else "fail",
                          confidence=0.75, message=f"search hidden behind a toggle ('{tog['el']['name'] or 'unnamed'}'); "
                                                   f"icon-only: {tog['icon_only']}", evidence=tog)
                try:
                    await page.click('[data-mdlaug-probe="search-toggle"]', timeout=5000)
                    await asyncio.sleep(0.8)
                    s = await self.probe(page, "findSearch")
                except Exception as e:  # noqa: BLE001
                    self.log("search", f"could not open search toggle: {e}", "warn", home_pid)
        if not s.get("found"):
            self.find(home_pid, "FIL2/RED3", "probe.search_present", "probe", "fail", confidence=0.5, needs_review=True,
                      message="no search input found on the start page (may be a selector miss)", evidence=s)
            self.log("search", "no search input found", "warn", home_pid, s, t0)
            self.log("search_outcome", "no search box found", "warn", home_pid, data={"outcome": "no_search"})
            return None
        # FIL2/RED3: findable & distinguishable
        named = bool(s.get("input_name"))
        outcome = "pass" if named and s.get("in_search_landmark") else ("partial" if named or s.get("placeholder_only") else "fail")
        if via_toggle and outcome == "pass":
            outcome = "partial"
        tabs = await self.tab_count(page)
        self.find(home_pid, "FIL2/RED3", "probe.search_present", "probe", outcome, confidence=0.75,
                  message=f"search input name: '{s.get('input_name') or '—'}'; search landmark: {s.get('in_search_landmark')}; "
                          f"placeholder-only: {s.get('placeholder_only')}; Tab presses to reach: {tabs if tabs is not None else '>60'}",
                  evidence=dict(s, tab_presses=tabs, via_toggle=via_toggle))
        if s.get("submit_icon_only") is not None and s.get("submit_icon_only"):
            self.find(home_pid, "FIL1", "probe.icon_submit", "probe", "pass" if s.get("submit_named") else "fail",
                      confidence=0.8, message=f"icon-only search button, named: {s.get('submit_named')}", evidence=s.get("submit"))
        # type → autocomplete (ACC6) and clear control (EXE1)
        sel = '[data-mdlaug-probe="search"]'
        method = "keyboard"
        try:
            # 1) something covering the search box? (cookie/consent/pop-up modals were the #1 cause of failures)
            blk = await self.probe(page, "blocker")
            if blk.get("found"):
                await page.keyboard.press("Escape")
                await asyncio.sleep(0.6)
                esc_ok = not (await self.probe(page, "blocker")).get("found")
                how = {"via": "escape"} if esc_ok else await self.probe(page, "dismissBlocker")
                await asyncio.sleep(0.8)
                still = (await self.probe(page, "blocker")).get("found")
                self.find(home_pid, "INT1", "probe.blocking_overlay", "probe",
                          "partial" if esc_ok else "fail", confidence=0.6, needs_review=True,
                          message=("an overlay covered the search box on load; " +
                                   ("Escape closed it" if esc_ok else
                                    f"Escape did not close it; dismissed via its '{how.get('label')}' button" if how.get("via") == "button"
                                    else "Escape did not close it and no close button was found (hidden to continue)")),
                          evidence={"blocker": blk, "dismissal": how, "still_blocked": still})
                self.log("search", f"overlay over search: {blk.get('el', {}).get('id') or blk.get('el', {}).get('cls', '')[:40]} "
                                   f"→ {how.get('via')} {how.get('label', '')}", "warn" if still else "info", home_pid, data=how)
            # 2) keyboard first: focus + type (what a screen-reader user does; no pointer hit-testing)
            await page.focus(sel, timeout=5000)
            if not await page.evaluate("() => window.__mdlaugProbe.searchFocused()"):
                raise RuntimeError("search box would not take focus")
            await page.keyboard.type(self.cfg.search_query[:3], delay=120)
            await asyncio.sleep(1.5)
            sg = await self.probe(page, "suggestions")
            if sg.get("visible_lists"):
                sem = sg.get("combobox") or sg.get("aria_expanded") is not None or bool(sg.get("aria_autocomplete"))
                self.find(home_pid, "ACC6", "probe.autocomplete", "probe",
                          "pass" if sem and sg.get("listbox_role") else ("partial" if sem or sg.get("listbox_role") else "fail"),
                          confidence=0.75, message=f"suggestions appeared; combobox semantics: {sem}; listbox role: {sg.get('listbox_role')}",
                          evidence=sg)
            await page.fill(sel, self.cfg.search_query, timeout=5000)
            cc = await self.probe(page, "clearControl")
            if cc.get("found"):
                self.find(home_pid, "EXE1", "probe.clear_control", "probe", "pass" if cc["named"] else "partial",
                          confidence=0.7, message=f"clear control present, named: {cc['named']}", evidence=cc)
            else:
                self.find(home_pid, "EXE1", "probe.clear_control", "probe", "partial" if cc.get("native_search_type") else "fail",
                          confidence=0.55, needs_review=True,
                          message="no explicit clear control" + (" (native type=search may offer one)" if cc.get("native_search_type") else ""),
                          evidence=cc)
            before_url = page.url
            try:
                async with page.expect_navigation(timeout=15000):
                    await page.keyboard.press("Enter")
            except Exception:
                await asyncio.sleep(2.0)   # SPA / in-page results
            if page.url == before_url and not (await self.probe(page, "resultsInfo")).get("items"):
                method = "programmatic"     # Enter did nothing visible: try submitting the form
                try:
                    async with page.expect_navigation(timeout=15000):
                        await page.evaluate("(q) => window.__mdlaugProbe.programmaticSubmit(q)", self.cfg.search_query)
                except Exception:
                    await asyncio.sleep(2.0)
        except Exception as e:  # noqa: BLE001
            # 3) last resort: set the value and submit the form in script, and say so
            try:
                method = "programmatic"
                async with page.expect_navigation(timeout=15000):
                    ok = await page.evaluate("(q) => window.__mdlaugProbe.programmaticSubmit(q)", self.cfg.search_query)
                if not ok:
                    raise RuntimeError("no search box")
                self.log("search", f"keyboard search failed ({type(e).__name__}: {str(e)[:160]}); submitted in script",
                         "warn", home_pid)
                self.find(home_pid, "FIL2/RED3", "probe.search_keyboard", "probe", "fail", confidence=0.55, needs_review=True,
                          message="the search box could not be used with the keyboard; the crawler had to submit it in "
                                  f"script ({type(e).__name__})", evidence={"error": str(e)[:400]})
            except Exception as e2:  # noqa: BLE001
                self.log("search", f"search interaction failed: {e}", "warn", home_pid, t0=t0)
                self.log("search_outcome", "interaction failed", "warn", home_pid,
                         data={"outcome": "interaction_failed", "error": str(e)[:300], "fallback_error": str(e2)[:200]})
                return None
        self.log("search", f"search submitted ({method})", page_id=home_pid, t0=t0,
                 data={"query": self.cfg.search_query, "method": method})
        rpid, rsum = await self.visit(page, page.url, hint="results", navigate=False)
        if rpid is None:
            self.log("search_outcome", "results page failed to load", "warn", home_pid, data={"outcome": "results_failed", "method": method})
            return None
        await self.results_probes(page, rpid)
        got = await self.probe(page, "resultsInfo")
        self.log("search_outcome", "results found" if (got.get("items") or got.get("count_text")) else "submitted, no results detected",
                 page_id=rpid, data={"outcome": "ok" if (got.get("items") or got.get("count_text")) else "no_results",
                                     "method": method, "items": got.get("items"), "count": got.get("count_text")})
        return rpid

    async def tab_count(self, page, max_tabs=60):
        try:
            await page.evaluate("() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0,0); }")
            for i in range(1, max_tabs + 1):
                await page.keyboard.press("Tab")
                hit = await page.evaluate("() => !!(document.activeElement && document.activeElement.getAttribute('data-mdlaug-probe')==='search')")
                if hit:
                    return i
        except Exception:
            return None
        return None

    async def results_probes(self, page, pid):
        r = await self.probe(page, "resultsInfo")
        if "_error" in r:
            self.log("results", "resultsInfo failed", "warn", pid, r)
            return
        if not r["items"] and not r["count_text"]:
            self.find(pid, "RED1", "probe.results_status", "probe", "unknown", score=None, confidence=0.3, needs_review=True,
                      message="search submitted but no results were detected (search may have failed, or a selector miss)", evidence=r)
            return
        # RED1 — availability of results announced
        if r["live_with_count"]:
            o, c, m = "pass", 0.8, "result count is in a live/status region"
        elif r["count_text"]:
            o, c, m = "partial", 0.7, f"count shown ('{r['count_text']}') but not in a live/status region"
        else:
            o, c, m = "fail", 0.6, "no result count shown"
        self.find(pid, "RED1", "probe.results_status", "probe", o, confidence=c, message=m, evidence=r)
        # NAV5 — getting to the results section
        moved = (not r["focus_on_body"]) and r.get("focused") and (
            r["focused"]["tag"] in ("h1", "h2", "h3", "main", "section") or "result" in (r["focused"]["name"] or "").lower())
        o = "pass" if moved or r["skip_to_results"] else ("partial" if r["results_heading"] else "fail")
        self.find(pid, "NAV5", "probe.reach_results", "probe", o, confidence=0.7,
                  message=f"focus moved to results: {bool(moved)}; skip-to-results: {r['skip_to_results']}; results heading: {r['results_heading'][:1]}",
                  evidence={k: r[k] for k in ("focused", "focus_on_body", "skip_to_results", "results_heading")})
        # NAV3 — moving through results
        if r["items"]:
            o = "pass" if r["items_semantic_list"] or r["item_headings"] >= 3 else "fail"
            self.find(pid, "NAV3", "probe.results_structure", "probe", o, confidence=0.7,
                      message=f"{r['items']} result items; list semantics: {r['items_semantic_list']}; items with headings: {r['item_headings']}",
                      evidence={k: r[k] for k in ("items", "items_semantic_list", "item_headings")})
        # NAV2 — pagination
        if r["pagination"]:
            o = "pass" if r["pagination_landmark"] and r["aria_current"] else ("partial" if r["pagination_landmark"] or r["aria_current"] else "fail")
            self.find(pid, "NAV2", "probe.pagination", "probe", o, confidence=0.75,
                      message=f"pagination as nav landmark: {bool(r['pagination_landmark'])}; aria-current: {r['aria_current']}",
                      evidence={k: r[k] for k in ("pagination", "pagination_landmark", "aria_current")})
        # COM2/NAV1 — filters
        if r["facets"]:
            self.find(pid, "COM2/NAV1", "probe.facets", "probe", "pass" if r["facets_labeled"] else "fail", confidence=0.6,
                      needs_review=not r["facets_labeled"],
                      message=f"{r['facets']} filter block(s); labeled/grouped: {r['facets_labeled']}",
                      evidence={k: r[k] for k in ("facets", "facets_labeled")})
        # RED2 — thumbnails vs titles
        if r["thumbs"]:
            ratio = r["dup_thumbs"] / r["thumbs"]
            o = "pass" if ratio == 0 else ("partial" if ratio <= 0.5 else "fail")
            self.find(pid, "RED2", "probe.thumb_duplication", "probe", o, confidence=0.65,
                      message=f"{r['dup_thumbs']}/{r['thumbs']} thumbnails duplicate the title or its link",
                      evidence={k: r[k] for k in ("thumbs", "dup_thumbs")})
        # EVA1 — relevance from snippets
        if r["sample_items"]:
            if self._llm_on():
                j = self.llm.ask("judge_snippets", {"query": self.cfg.search_query, "results": r["sample_items"]},
                                 run_id=self.run_id, site_id=self.site_id, page_id=pid)
                if j.get("_ok") and j.get("score_1_7") is not None:
                    self.find(pid, "EVA1", "llm.snippet_relevance", "llm", scoring.outcome_from_score(int(j["score_1_7"])),
                              score=int(j["score_1_7"]), confidence=j["_confidence"], message=str(j.get("rationale", ""))[:400],
                              evidence={"sample": r["sample_items"], "llm": {k: j.get(k) for k in ("has_titles", "has_descriptions", "has_dates_or_types")}, "prompt_version": j.get("_pv"), "llm_call": j.get("_call_id")})
            else:
                avg = sum(len(x) for x in r["sample_items"]) / len(r["sample_items"])
                o = "pass" if avg >= 120 else ("partial" if avg >= 50 else "fail")
                self.find(pid, "EVA1", "probe.snippet_length", "probe", o, confidence=0.4, needs_review=True,
                          message=f"avg result text length {avg:.0f} chars (heuristic; LLM off)", evidence={"sample": r["sample_items"]})
        self._first_result = r.get("first_result")

    # ---------- whole site ----------
    async def crawl(self, site):
        self.site_id = self.store.upsert_site(site)
        self._first_result = None
        url = site["collection_url"]
        t0 = time.time()
        if not await self.robots_ok(url):
            self.store.add_page(self.run_id, self.site_id, url=url, status="robots_disallowed", device=self.cfg.device or "desktop")
            self.log("robots", f"robots.txt disallows {url}; skipped", "warn")
            return
        ctx_args = {"bypass_csp": True, "ignore_https_errors": True}
        if self.cfg.device:
            ctx_args.update(self.pw.devices.get(self.cfg.device, {}))
        ua = ctx_args.get("user_agent") or "Mozilla/5.0"
        ctx_args["user_agent"] = f"{ua} {self.cfg.user_agent_suffix}"
        context = await self.browser.new_context(**ctx_args)
        context.set_default_timeout(self.cfg.nav_timeout_ms)
        page = await context.new_page()
        pages = 0
        try:
            hpid, hsum = await self.visit(page, url, hint="home", start_url=url)
            if hpid is None:
                return
            pages += 1
            await self.dialogs(page, hpid)
            await self.names_and_targets(page, hpid)
            if self._llm_on():
                j = self.llm.ask("judge_structure", {"title": hsum.get("title"), "headings": hsum.get("headings"),
                                                     "landmarks": hsum.get("landmarks")},
                                 run_id=self.run_id, site_id=self.site_id, page_id=hpid)
                if j.get("_ok") and j.get("score_1_7") is not None:
                    self.find(hpid, "COM1", "llm.structure", "llm", scoring.outcome_from_score(int(j["score_1_7"])),
                              score=int(j["score_1_7"]), confidence=j["_confidence"], message=str(j.get("rationale", ""))[:400],
                              evidence={"headings": hsum.get("headings"), "landmarks": hsum.get("landmarks"), "prompt_version": j.get("_pv"), "llm_call": j.get("_call_id")})
            await self.images_llm(page, hpid)
            restricted_done = await self.restricted(page, hpid)
            help_links = await self.probe(page, "helpLinks") or []
            browse_links = await self.probe(page, "browseLinks") or []
            await self.engine_and_axe(page, hpid)
            pre = await self.probe(page, "findSearch")            # annotate search box for the screenshot
            if not pre.get("found"):
                await self.probe(page, "findSearchToggle")
            await self.capture_annotated(page, hpid)

            rpid = await self.search_flow(page, hpid)
            if rpid:
                pages += 1
                await self.engine_and_axe(page, rpid)
                if not restricted_done:
                    restricted_done = await self.restricted(page, rpid)
                await self.capture_annotated(page, rpid)
            if self._first_result and pages < self.cfg.max_pages_per_site:
                ipid, _ = await self.visit(page, self._first_result, hint="item", start_url=url)
                if ipid:
                    pages += 1
                    await self.images_llm(page, ipid)
                    await self.names_and_targets(page, ipid)
                    await self.engine_and_axe(page, ipid)
                    if not restricted_done:
                        await self.restricted(page, ipid)
                    await self.capture_annotated(page, ipid)
            # help
            if isinstance(help_links, list) and help_links and pages < self.cfg.max_pages_per_site:
                hl = help_links[0]
                hppid, hpsum = await self.visit(page, hl["href"], hint="help", start_url=url)
                if hppid:
                    pages += 1
                    if self._llm_on():
                        j = self.llm.ask("judge_help", {"title": hpsum.get("title"), "headings": hpsum.get("headings"),
                                                        "text": hpsum.get("text_excerpt")},
                                         run_id=self.run_id, site_id=self.site_id, page_id=hppid)
                        if j.get("_ok") and j.get("score_1_7") is not None:
                            self.find(hppid, "FIL3/HEP1", "llm.help_quality", "llm", scoring.outcome_from_score(int(j["score_1_7"])),
                                      score=int(j["score_1_7"]), confidence=j["_confidence"], message=str(j.get("rationale", ""))[:400],
                                      evidence={"link": hl, "llm": {k: j.get(k) for k in ("explains_use", "mentions_search_tips", "mobile_or_at_specific")}, "prompt_version": j.get("_pv"), "llm_call": j.get("_call_id")})
                    else:
                        self.find(hppid, "FIL3/HEP1", "probe.help_present", "probe", "partial", confidence=0.4, needs_review=True,
                                  message=f"help link found ('{hl['text']}'); content quality not assessed (LLM off)", evidence={"link": hl})
                    await self.capture_annotated(page, hppid)
            elif not help_links:
                self.find(hpid, "FIL3/HEP1", "probe.help_present", "probe", "fail", confidence=0.5, needs_review=True,
                          message="no help/FAQ/accessibility link found on the start page", evidence={})
            # browse
            if isinstance(browse_links, list) and browse_links and pages < self.cfg.max_pages_per_site:
                bpid, _ = await self.visit(page, browse_links[0]["href"], hint="browse", start_url=url)
                if bpid:
                    pages += 1
                    await self.engine_and_axe(page, bpid)
                    await self.capture_annotated(page, bpid)
            self.log("site", f"done: {pages} page(s)", data={"pages": pages}, t0=t0)
        except Exception as e:  # noqa: BLE001
            self.log("site", f"site crawl aborted: {type(e).__name__}: {e}", "error", t0=t0)
        finally:
            await context.close()


async def run_crawl(cfg: Config, store, llm, sites, note="", progress=None):
    from playwright.async_api import async_playwright
    cfg.ensure_dirs()
    run_id = store.start_run({k: v for k, v in cfg.__dict__.items() if k != "extra"}, note)
    store.log(run_id, "run", f"starting run over {len(sites)} site(s)",
              data={"llm": cfg.llm_enabled, "llm_available": bool(llm and llm.check()) if cfg.llm_enabled else False,
                    "model": cfg.ollama_model, "device": cfg.device})
    sem = asyncio.Semaphore(cfg.concurrency)
    done = {"n": 0}
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)

        async def one(site):
            async with sem:
                c = SiteCrawler(cfg, store, llm, run_id, browser, pw)
                await c.crawl(site)
                done["n"] += 1
                if progress:
                    progress(done["n"], len(sites), site["collection_url"])
        await asyncio.gather(*(one(s) for s in sites))
        await browser.close()
    store.finish_run(run_id)
    store.log(run_id, "run", "run finished")
    return run_id
