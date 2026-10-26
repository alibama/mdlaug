"""End-to-end: crawl the local fixture DL with real Chromium + fake LLM."""
import asyncio
import json
from pathlib import Path
from mdlaug_crawl.config import Config
from mdlaug_crawl.store import Store
from mdlaug_crawl.llm import LLM
from mdlaug_crawl import runner, analysis, export, remediation
import fake_llm
import server


async def _selectors_resolve(st, rid, base):
    """Every recorded selector must match exactly one element of the same tag on the UNREPAIRED page."""
    from playwright.async_api import async_playwright
    route = {"home": "", "results": "search?q=history", "item": "item/1", "help": "help", "browse": "browse"}
    ok = tot = 0
    async with async_playwright() as pw:
        b = await pw.chromium.launch(); pg = await b.new_page()
        for p in st.query("SELECT page_type, remediation FROM pages WHERE run_id=?", (rid,)):
            d = json.loads(p["remediation"] or "{}")
            if not d.get("changed") or p["page_type"] not in route:
                continue
            await pg.goto(base + route[p["page_type"]])
            for c in d["changed"]:
                tot += 1
                loc = pg.locator(c["selector"])
                if await loc.count() == 1:
                    tag = await loc.first.evaluate("e => e.tagName.toLowerCase()")
                    ok += c["before_tag"].startswith("<" + tag)
        await b.close()
    return ok, tot


def test_crawl_fixture(tmp_path):
    srv, base = server.serve()
    try:
        cfg = Config(db_path=str(tmp_path / "e.db"), artifacts_dir=str(tmp_path / "art"), logs_dir=str(tmp_path / "logs"))
        cfg.polite_delay_s = 0
        cfg.nav_timeout_ms = 15000
        st = Store(cfg.db_path, cfg.logs_dir)
        llm = LLM(cfg, st, transport=fake_llm.transport)
        site = {"collection_url": base, "platform": "DSpace", "library_type": "Academic library",
                "institution": "Fixture DL", "library_page": base, "listings": []}
        rid = asyncio.run(runner.run_crawl(cfg, st, llm, [site], note="e2e"))
        ok, tot = asyncio.run(_selectors_resolve(st, rid, base))
        assert tot >= 5 and ok == tot, f"draft-pack selectors must hit the original element: {ok}/{tot}"
    finally:
        srv.shutdown()

    pages = st.query("SELECT page_type, status, type_method FROM pages WHERE run_id=?", (rid,))
    types = [p["page_type"] for p in pages]
    assert all(p["status"] == "ok" for p in pages), pages
    for t in ("home", "results", "item", "help", "browse"):
        assert t in types, (t, types)

    f = st.query("SELECT code, check_id, method, outcome, score, needs_review FROM findings WHERE run_id=?", (rid,))
    by = {}
    for x in f:
        by.setdefault(x["code"], []).append(x)
    # probes
    assert any(x["check_id"] == "probe.search_present" and x["outcome"] == "partial" for x in by["FIL2/RED3"])  # placeholder-only
    assert any(x["check_id"] == "probe.icon_submit" and x["outcome"] == "fail" for x in by["FIL1"])            # unnamed icon button
    assert "EXE1" in by and "RED1" in by and "NAV2" in by and "NAV3" in by and "COM2/NAV1" in by and "RED2" in by
    ov = [x for x in by["EXE2"] if x["check_id"] == "probe.overlay"]             # cookie dialog closed by Escape
    assert ov and json.loads(st.query("SELECT evidence FROM findings WHERE run_id=? AND check_id='probe.overlay'",
                                      (rid,))[0]["evidence"])["escape_closes"] is True
    assert any(x["method"] == "probe" for x in by["USE1"])
    # LLM judgments routed through findings
    for code, chk in (("EVA1", "llm.snippet_relevance"), ("ACC2/COM3", "llm.alt_quality"),
                      ("FIL3/HEP1", "llm.help_quality"), ("COM1", "llm.structure"), ("RED4", "llm.restricted_explained")):
        assert any(x["check_id"] == chk for x in by[code]), code
    # engine + axe ran in-page
    assert any(x["method"] == "engine" for x in f)
    assert any(x["method"] == "axe" for x in f)
    # logging for workflow improvement
    assert st.query("SELECT COUNT(*) n FROM events WHERE run_id=?", (rid,))[0]["n"] > 10
    assert st.query("SELECT COUNT(*) n FROM llm_calls WHERE run_id=? AND ok=1", (rid,))[0]["n"] >= 5
    assert (Path(cfg.logs_dir) / f"run-{rid}.jsonl").exists()
    # annotated screenshots: engine + probe + LLM marks, all three statuses, files written
    pg = st.query("SELECT page_type, annotations, fullshot, annotated FROM pages WHERE run_id=? AND page_type IN ('home','results')", (rid,))
    for p in pg:
        a = json.loads(p["annotations"])
        assert a["items"] and Path(p["fullshot"]).exists() and Path(p["annotated"]).exists(), p["page_type"]
    allitems = [i for p in pg for i in json.loads(p["annotations"])["items"]]
    assert {"engine", "probe"} <= {i["source"] for i in allitems}
    assert {"good", "issue"} <= {i["status"] for i in allitems}
    assert any(i["code"] == "FIL2" and i["label"] == "placeholder-only label" for i in allitems)
    assert any(i["code"] == "RED1" and i["status"] == "issue" for i in allitems)
    # fixture has no viewport tag → mobile reflow failure recorded
    assert any(x["check_id"] == "probe.mobile_reflow" and x["outcome"] == "fail" for x in f)
    # best-effort repair preview: diff + after screenshot per page, draft pack, report zip
    home = st.query("SELECT * FROM pages WHERE run_id=? AND page_type='home'", (rid,))[0]
    d = json.loads(home["remediation"])
    assert d["changed"] and d["inserted"] and Path(home["aftershot"]).exists() and Path(home["after_annotated"]).exists()
    assert any(any(x["attr"] == "aria-label" for x in c["diff"]) for c in d["changed"])          # e.g. icon button named
    assert any(i["kind"] in ("skip link", "screen-reader text") for i in d["inserted"])
    assert all(c["before_tag"] != c["after_tag"] and c["selector"] for c in d["changed"])
    sid = home["site_id"]
    pack = remediation.draft_pack(st, rid, sid)
    assert pack["match"]["hosts"] == ["127.0.0.1"] and pack["rules"]
    assert all(r["select"] and (r.get("set") or r.get("remove")) for r in pack["rules"])
    assert not any("mdlaug" in json.dumps(r.get("set", {})) for r in pack["rules"])               # no generated ids
    import zipfile
    z = remediation.site_report(st, rid, sid, str(tmp_path / "rep.zip"))
    names = zipfile.ZipFile(z).namelist()
    assert {"report.html", "sitepack.json", "changes.json"} <= set(names) and any(n.startswith("images/") for n in names)
    rep = zipfile.ZipFile(z).read("report.html").decode()
    assert '<html lang="en">' in rep and rep.count("<img") == rep.count('alt="') and "<th scope=" in rep
    # aggregation + export
    t = analysis.site_situation_table(st, rid)
    assert len(t) == 24 and t["needs_review"].any() and t["suggested_score"].notna().sum() >= 12
    out = export.export_xlsx(st, rid, str(tmp_path / "x.xlsx"))
    assert Path(out).exists()



def test_search_behind_consent_overlay(tmp_path):
    """Regression: a full-screen consent overlay that ignores Escape used to make every search click time out."""
    srv, base = server.serve()
    try:
        cfg = Config(db_path=str(tmp_path / "o.db"), artifacts_dir=str(tmp_path / "art"), logs_dir=str(tmp_path / "logs"))
        cfg.polite_delay_s = 0; cfg.llm_enabled = False
        st = Store(cfg.db_path, cfg.logs_dir)
        url = base + "consent/"
        rid = asyncio.run(runner.run_crawl(cfg, st, None, [{"collection_url": url, "platform": "Omeka",
                          "library_type": "Museum", "institution": "Consent DL", "library_page": url, "listings": []}]))
    finally:
        srv.shutdown()
    outcomes = [json.loads(e["data"]) for e in st.query("SELECT data FROM events WHERE run_id=? AND stage='search_outcome'", (rid,))]
    assert outcomes and outcomes[-1]["outcome"] == "ok" and outcomes[-1]["method"] == "keyboard", outcomes
    ov = st.query("SELECT outcome, evidence FROM findings WHERE run_id=? AND check_id='probe.overlay' AND code='INT1'", (rid,))
    assert ov and ov[0]["outcome"] != "pass"
    ev = json.loads(ov[0]["evidence"])
    assert ev["escape_closes"] is False and ev["dismissal"]["label"] == "Reject all"   # privacy-preferring choice
    assert any(p["page_type"] == "results" for p in st.query("SELECT page_type FROM pages WHERE run_id=?", (rid,)))


def _crawl_one(tmp_path, url, platform="Digital commons", name="t"):
    cfg = Config(db_path=str(tmp_path / f"{name}.db"), artifacts_dir=str(tmp_path / "art"), logs_dir=str(tmp_path / "logs"))
    cfg.polite_delay_s = 0; cfg.llm_enabled = False
    st = Store(cfg.db_path, cfg.logs_dir)
    rid = asyncio.run(runner.run_crawl(cfg, st, None, [{"collection_url": url, "platform": platform,
                      "library_type": "Academic library", "institution": name, "library_page": url, "listings": []}]))
    return st, rid


def test_consent_manager_dismissed_with_its_own_reject_control(tmp_path):
    """Regression (Digital Commons / OneTrust): the dismisser used to search the whole page and click
    'Skip to main content'. It must use the consent manager's own reject control, before anything is measured,
    and the script-rendered results ('Loading...' for 3 s) must be waited for."""
    srv, base = server.serve()
    try:
        st, rid = _crawl_one(tmp_path, base + "onetrust/", name="ot")
    finally:
        srv.shutdown()
    ov = st.query("SELECT evidence FROM findings WHERE run_id=? AND check_id='probe.overlay' AND code='INT1'", (rid,))
    assert len(ov) == 1, ov                                   # banner scored once; its backdrop isn't a second overlay
    ev = json.loads(ov[0]["evidence"])
    assert ev["cmp"] == "OneTrust" and ev["kind"] == "consent" and ev["escape_closes"] is False
    assert ev["dismissal"]["via"] == "cmp-control" and ev["dismissal"]["label"] == "Reject All" and not ev["still_visible"]
    assert ev["criteria"]["exposed_as_dialog"] is False
    home = st.query("SELECT overlays, fingerprint FROM pages WHERE run_id=? AND page_type='home'", (rid,))[0]
    assert json.loads(home["fingerprint"])["platform"] == "Digital commons"
    # nothing measured on the home page saw the banner: axe/engine ran after it was gone
    assert not st.query("SELECT 1 FROM events WHERE run_id=? AND stage='overlay' AND message LIKE '%late overlay%'", (rid,))
    out = [json.loads(e["data"]) for e in st.query("SELECT data FROM events WHERE run_id=? AND stage='search_outcome'", (rid,))]
    assert out[-1]["outcome"] == "ok" and out[-1]["method"] == "keyboard", out
    assert not st.query("SELECT 1 FROM findings WHERE run_id=? AND check_id='probe.blocking_overlay'", (rid,))


def test_accept_only_banner_rejected_through_its_api(tmp_path):
    """The real Digital Commons banner offers only 'Accept all cookies': use OneTrust's own RejectAll()
    before ever clicking accept, and record that the banner has no named reject/close control."""
    srv, base = server.serve()
    try:
        st, rid = _crawl_one(tmp_path, base + "onetrust-accept-only/", name="oa")
    finally:
        srv.shutdown()
    ev = json.loads(st.query("SELECT evidence FROM findings WHERE run_id=? AND check_id='probe.overlay' AND code='INT1'",
                             (rid,))[0]["evidence"])
    assert ev["dismissal"]["via"] == "cmp-api" and "RejectAll" in ev["dismissal"]["label"], ev["dismissal"]
    assert ev["criteria"]["named_dismiss_control"] is False


def test_bot_challenge_recorded_not_measured(tmp_path):
    srv, base = server.serve()
    try:
        st, rid = _crawl_one(tmp_path, base + "guarded/", platform="Omeka", name="g")
    finally:
        srv.shutdown()
    out = [json.loads(e["data"]) for e in st.query("SELECT data FROM events WHERE run_id=? AND stage='search_outcome'", (rid,))]
    assert out[-1]["outcome"] == "bot_challenge", out
    pg = st.query("SELECT id, status FROM pages WHERE run_id=? AND status='bot_challenge'", (rid,))
    assert pg and not st.query("SELECT 1 FROM findings WHERE page_id=?", (pg[0]["id"],))
    cov = analysis.coverage(st, rid)
    assert cov.iloc[0]["status"] == "search behind bot check"


def test_shadow_dom_notice_dialog_measured_and_dismissed(tmp_path):
    """Regression (GSU / Islandora <notice-dialog>): a web component drawing its modal inside a shadow root
    was invisible to the overlay probe, so it stayed over the page and was never scored."""
    srv, base = server.serve()
    try:
        st, rid = _crawl_one(tmp_path, base + "notice/", platform="CONTENTdm", name="nd")
    finally:
        srv.shutdown()
    ov = st.query("SELECT evidence FROM findings WHERE run_id=? AND check_id='probe.overlay' AND code='INT1'", (rid,))
    assert ov, "shadow-DOM dialog not detected"
    ev = json.loads(ov[0]["evidence"])
    assert ev["shadow"] is True and ev["escape_closes"] is False and not ev["still_visible"]
    assert ev["dismissal"]["label"] == "Continue" and ev["criteria"]["exposed_as_dialog"] is False


def test_closed_shadow_root_overlay_detected_and_hidden(tmp_path):
    """GSU's <notice-dialog> uses a closed shadow root: nothing inside is readable, the host has no size.
    Hit-testing still finds it; unobservable criteria are recorded as unknown, not as failures."""
    srv, base = server.serve()
    try:
        st, rid = _crawl_one(tmp_path, base + "notice-closed/", platform="CONTENTdm", name="nc")
    finally:
        srv.shutdown()
    ov = st.query("SELECT evidence FROM findings WHERE run_id=? AND check_id='probe.overlay' AND code='INT1'", (rid,))
    assert ov, "closed-shadow dialog not detected"
    ev = json.loads(ov[0]["evidence"])
    assert ev["closed_shadow"] is True and ev["coverage"] > 0.5 and not ev["still_visible"]
    assert ev["criteria"]["exposed_as_dialog"] is None and ev["criteria"]["escape_closes"] is False


def test_zero_size_consent_wrapper_and_header_dialog(tmp_path):
    """Regression (HNOC): CookieConsent wraps its modal in a zero-size fixed container, which hid it from the
    probe, while a search form marked role=dialog in the fixed header was counted as an overlay."""
    srv, base = server.serve()
    try:
        st, rid = _crawl_one(tmp_path, base + "ccv2/", platform="CONTENTdm", name="cc")
    finally:
        srv.shutdown()
    ov = st.query("SELECT evidence FROM findings WHERE run_id=? AND check_id='probe.overlay' AND code='INT1'", (rid,))
    assert len(ov) == 1, [json.loads(o["evidence"])["el"] for o in ov]
    ev = json.loads(ov[0]["evidence"])
    assert ev["cmp"] == "CookieConsent" and ev["dismissal"]["label"] == "Accept necessary" and not ev["still_visible"]


def test_failed_browser_check_page_is_a_bot_challenge(tmp_path):
    srv, base = server.serve()
    try:
        st, rid = _crawl_one(tmp_path, base + "notbot/", platform="DSpace", name="nb")
    finally:
        srv.shutdown()
    pg = st.query("SELECT status FROM pages WHERE run_id=?", (rid,))
    assert [p["status"] for p in pg] == ["bot_challenge"], pg
    assert analysis.coverage(st, rid).iloc[0]["status"] == "blocked by bot check"
