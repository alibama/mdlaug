import json, time
from pathlib import Path
import pytest
from mdlaug_crawl import sites as S, analysis
from mdlaug_crawl.store import Store
from mdlaug_crawl.config import Config
from mdlaug_crawl.llm import LLM
from mdlaug_crawl import bench
from mdlaug_crawl.__main__ import main


def test_parse_bulk():
    new, bad = S.parse_bulk("https://a.edu/dl, A Univ, DSpace, Academic library\n"
                            "b.org/collections\n# comment\nnot a url\nhttps://c.org/x\tC Museum\tOmeka", "Unknown")
    assert [n["collection_url"] for n in new] == ["https://a.edu/dl", "https://b.org/collections", "https://c.org/x"]
    assert new[0]["platform"] == "DSpace" and new[1]["institution"] == "b.org" and new[1]["platform"] == "Unknown"
    assert new[2]["institution"] == "C Museum" and new[2]["platform"] == "Omeka"
    assert bad == ["not a url"]


def _sites(st):
    for u, plat, act in [("https://a.edu/", "DSpace", 1), ("https://b.edu/", "DSpace", 1), ("https://c.org/", "Omeka", 1),
                         ("https://d.org/", "Omeka", 1), ("https://e.org/", "Omeka", 1), ("https://off.org/", "DSpace", 0)]:
        sid = st.upsert_site({"collection_url": u, "platform": plat, "library_type": "Academic library",
                              "institution": u[8:9].upper(), "library_page": "", "listings": []})
        st.set_site_active(sid, act)
    return {r["collection_url"]: r["id"] for r in st.query("SELECT id, collection_url FROM sites")}


def test_select_respects_switches_filters_limit(tmp_path):
    st = Store(str(tmp_path / "s.db")); _sites(st)
    rows = st.query("SELECT * FROM sites")
    assert len(S.select(rows)) == 5                                   # switched-off site excluded
    assert len(S.select(rows, active_only=False)) == 6
    assert {x["platform"] for x in S.select(rows, platforms=["Omeka"])} == {"Omeka"}
    assert len(S.select(rows, limit=2)) == 2


def _run_with_outcomes(st, ids):
    rid = st.start_run({})
    def page(sid, ptype, status="ok"):
        return st.add_page(rid, sid, url="u", status=status, page_type=ptype)
    page(ids["https://a.edu/"], "home"); p = page(ids["https://a.edu/"], "results")
    st.log(rid, "search_outcome", "ok", site_id=ids["https://a.edu/"], data={"outcome": "ok", "method": "keyboard"})
    page(ids["https://b.edu/"], "home")
    st.log(rid, "search_outcome", "x", site_id=ids["https://b.edu/"], data={"outcome": "interaction_failed", "error": "focus timeout"})
    page(ids["https://c.org/"], "home", status="error")
    st.log(rid, "visit", "home: failed to load", "warn", site_id=ids["https://c.org/"])
    page(ids["https://d.org/"], "home")                                 # an old-style run: no outcome events
    st.log(rid, "search", "search interaction failed: Page.click: Timeout", "warn", site_id=ids["https://d.org/"])
    return rid


def test_coverage_statuses(tmp_path):
    st = Store(str(tmp_path / "c.db")); ids = _sites(st)
    rid = _run_with_outcomes(st, ids)
    cov = analysis.coverage(st, rid).set_index("collection_url")
    assert cov.loc["https://a.edu/", "status"] == "complete" and cov.loc["https://a.edu/", "detail"] == "keyboard"
    assert cov.loc["https://b.edu/", "status"] == "search failed" and "focus" in cov.loc["https://b.edu/", "detail"]
    assert cov.loc["https://c.org/", "status"] == "failed to load"
    assert cov.loc["https://d.org/", "status"] == "search failed"         # derived from an old run's messages
    assert cov.loc["https://e.org/", "status"] == "not crawled"
    assert cov.loc["https://off.org/", "active"] == 0


def test_cli_retry_failed_and_sites(tmp_path, monkeypatch, capsys):
    db = tmp_path / "r.db"
    monkeypatch.setenv("MDLAUG_DB", str(db)); monkeypatch.setenv("MDLAUG_LOGS", str(tmp_path / "logs"))
    monkeypatch.setenv("MDLAUG_ARTIFACTS", str(tmp_path / "art"))
    st = Store(str(db)); ids = _sites(st); rid = _run_with_outcomes(st, ids)
    import mdlaug_crawl.runner as R
    seen = {}
    async def fake_crawl(cfg, store, llm, rows, note="", progress=None):
        seen["urls"] = sorted(r["collection_url"] for r in rows); return 99
    monkeypatch.setattr(R, "run_crawl", fake_crawl)
    assert main(["run", "--retry-failed", str(rid), "--no-llm"]) == 0
    assert seen["urls"] == ["https://b.edu/", "https://c.org/", "https://d.org/"]   # not the complete or uncrawled ones
    assert main(["sites", "add", "https://new.example.edu/dl", "--institution", "New U", "--platform", "Islandora"]) == 0
    assert main(["sites", "disable", "https://new.example.edu/dl"]) == 0
    out = capsys.readouterr().out
    assert "added https://new.example.edu/dl" in out
    assert st.query("SELECT active FROM sites WHERE collection_url='https://new.example.edu/dl'")[0]["active"] == 0


def test_app_site_list_and_comparison_charts(tmp_path, monkeypatch):
    pytest.importorskip("streamlit")
    from streamlit.testing.v1 import AppTest
    db = tmp_path / "a.db"
    st = Store(str(db)); ids = _sites(st); rid = _run_with_outcomes(st, ids)
    cfg = Config(db_path=str(db), ollama_model="qwen3.5:4b")
    scores = {"qwen3.5:4b": [7, 6, 5, 7], "gemma3:4b": [4, 6, 2, 3]}
    def transport(model, system, prompt):
        if "Classify" in prompt:
            return json.dumps({"page_type": "search" if model.startswith("qwen") else "results", "confidence": .8})
        i = int(prompt.rsplit("page ", 1)[1][0]) if "page " in prompt else 0
        return json.dumps({"score_1_7": scores[model][i % 4], "confidence": .8})
    llm = LLM(cfg, st, transport=transport)
    for i in range(4):
        llm.ask("judge_help", {"text": f"page {i}"}, run_id=rid)
    llm.ask("classify_page", {"url": "x"}, run_id=rid)
    assert bench.replay(st, cfg, "gemma3:4b", run_id=rid, transport=transport) == 5
    monkeypatch.setenv("MDLAUG_DB", str(db)); monkeypatch.setenv("MDLAUG_LOGS", str(tmp_path / "logs"))
    monkeypatch.setenv("OLLAMA_URL", "http://127.0.0.1:9")
    at = AppTest.from_file(str(Path(__file__).resolve().parents[1] / "app.py"), default_timeout=120).run()
    assert not at.exception, [str(e.value) for e in at.exception]
    m = {x.label: x.value for x in at.metric}
    assert m["Sites in list"] == "6" and m["Switched on"] == "5" and m["Complete"] == "1" and m["Search failed"] == "2"
    assert any("This crawl will evaluate 5 site(s)" in x.value and "1 switched-off" in x.value for x in at.markdown)
    assert any(x.label.startswith("Re-crawl the 3 site(s)") for x in at.button)
    assert any("Who scores higher?" in x.value for x in at.markdown)       # comparison charts rendered
    # add sites in bulk through the form
    ta = [t for t in at.text_area if t.label == "Sites"][0]
    ta.input("https://x1.edu/\nhttps://x2.edu/, X2 Library, CONTENTdm\nnope")
    [b for b in at.button if b.label == "Add all"][0].click().run()
    assert not at.exception
    assert {r["collection_url"] for r in st.query("SELECT collection_url FROM sites")} >= {"https://x1.edu/", "https://x2.edu/"}
