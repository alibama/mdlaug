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
    assert any(x["check_id"] == "probe.dialog_escape" for x in by["EXE2"])      # cookie dialog closed by Escape
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
    ov = st.query("SELECT outcome, message, evidence FROM findings WHERE run_id=? AND check_id='probe.blocking_overlay'", (rid,))
    assert ov and ov[0]["outcome"] == "fail"
    assert json.loads(ov[0]["evidence"])["dismissal"]["label"] == "Reject all"      # privacy-preferring choice
    assert any(p["page_type"] == "results" for p in st.query("SELECT page_type FROM pages WHERE run_id=?", (rid,)))
