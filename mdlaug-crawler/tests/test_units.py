from pathlib import Path
import json
import pandas as pd
from mdlaug_crawl import sites as S, scoring, classify
from mdlaug_crawl.llm import parse_json, LLM
from mdlaug_crawl.config import Config
from mdlaug_crawl.store import Store
from mdlaug_crawl import analysis
import fake_llm

SHEET = Path(__file__).resolve().parents[1] / "sample" / "DLs_for_mDLAUG_Assessment.xlsx"


def test_sheet_load_and_dedupe():
    rows = S.load_sheet(SHEET)
    assert len(rows) == 173   # 4 public-library rows carry their URL only in the "URL" column
    assert set(rows["platform"]) == {"DSpace", "Omeka", "Digital commons", "CONTENTdm", "Samvera", "Islandora"}
    assert "Large-scale library / consortium" in set(rows["library_type"])
    assert not any("libraryConsortium" in t for t in rows["library_type"])
    sites = S.dedupe_sites(rows)
    assert len(sites) == 141
    smithsonian = [s for s in sites if s["collection_url"] == "https://repository.si.edu/"][0]
    assert len(smithsonian["listings"]) >= 5


def test_parse_json_tolerant():
    assert parse_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert parse_json('<think>hmm</think> Here: {"b": 2} thanks') == {"b": 2}


def test_llm_logs_and_caches(tmp_path):
    cfg = Config(db_path=str(tmp_path / "t.db"))
    st = Store(cfg.db_path)
    llm = LLM(cfg, st, transport=fake_llm.transport)
    r1 = llm.ask("judge_structure", {"headings": ["h1: x"]}, run_id=1)
    r2 = llm.ask("judge_structure", {"headings": ["h1: x"]}, run_id=1)
    assert r1["_ok"] and r1["score_1_7"] == 3 and r2.get("_cached")
    calls = st.query("SELECT ok, cached FROM llm_calls")
    assert [c["cached"] for c in calls] == [0, 1]
    bad = LLM(cfg, st, transport=lambda m, s, p: "no json here").ask("judge_help", {"text": "zzz"})
    assert bad["_ok"] is False
    assert st.query("SELECT COUNT(*) n FROM llm_calls WHERE ok=0")[0]["n"] == 1


def test_classify_heuristics():
    t, c, _ = classify.heuristic({"url": "https://x.org/search?q=a", "result_count_text": "12 results"})
    assert t == "results" and c >= 0.85
    t, c, _ = classify.heuristic({"url": "https://x.org/handle/123/45", "has_viewer": True})
    assert t == "item"
    t, c, _ = classify.heuristic({"url": "https://x.org/help", "title": "Help"})
    assert t == "help"


def test_aggregate_flags_review():
    fs = [{"code": "RED1", "score": 7, "confidence": 0.9, "needs_review": 0, "method": "probe"},
          {"code": "RED1", "score": 4, "confidence": 0.9, "needs_review": 0, "method": "engine"},
          {"code": "USE1", "score": 6, "confidence": 0.9, "needs_review": 0, "method": "probe"}]
    a = scoring.aggregate(fs)
    assert a["RED1"]["suggested_score"] in (5, 6) and not a["RED1"]["needs_review"] and a["RED1"]["automated"]
    assert a["USE1"]["needs_review"]          # always reviewed by design
    assert a["ACC1"]["suggested_score"] is None and a["ACC1"]["needs_review"]


def test_review_override_flows_into_scores(tmp_path):
    st = Store(str(tmp_path / "r.db"))
    rid = st.start_run({})
    sid = st.upsert_site({"collection_url": "https://a/", "platform": "DSpace", "library_type": "Academic library",
                          "institution": "A", "library_page": "", "listings": []})
    fid = st.add_finding(rid, sid, None, "NAV2", "probe.pagination", "probe", "fail", 2, 0.75)
    t = analysis.site_situation_table(st, rid)
    assert int(t[t.code == "NAV2"]["suggested_score"].iloc[0]) == 2
    st.add_review(fid, "tester", "override", score=6, issue_tag="false positive")
    t = analysis.site_situation_table(st, rid)
    assert int(t[t.code == "NAV2"]["suggested_score"].iloc[0]) == 6
    raw, by = analysis.agreement(st, rid)
    assert len(raw) == 1 and by.iloc[0]["agreement"] == 0
    st.set_site_score(rid, sid, "NAV2", "tester", 5)
    t = analysis.site_situation_table(st, rid)
    row = t[t.code == "NAV2"].iloc[0]
    assert row["final_score"] == 5 and row["status"] == "reviewed"
