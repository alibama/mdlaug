import json
from pathlib import Path
import pytest
from mdlaug_crawl.config import Config
from mdlaug_crawl.store import Store
from mdlaug_crawl.llm import LLM
from mdlaug_crawl import bench, analysis
import fake_ollama


@pytest.fixture
def ollama():
    srv, url, seen = fake_ollama.serve()
    yield url, seen
    srv.shutdown()


def _cfg(tmp_path, url, **kw):
    c = Config(db_path=str(tmp_path / "m.db"), ollama_url=url, ollama_model="qwen3:4b")
    for k, v in kw.items():
        setattr(c, k, v)
    return c


def test_list_models(ollama, tmp_path):
    ms = bench.list_models(_cfg(tmp_path, ollama[0]))
    assert [m["name"] for m in ms] == ["gemma3:4b", "qwen3:4b"] and ms[1]["params"] == "4.0B"
    assert bench.list_models(_cfg(tmp_path, "http://127.0.0.1:9")) == []          # Ollama down → empty, no crash


def test_think_flag_retry(ollama, tmp_path):
    url, seen = ollama
    llm = LLM(_cfg(tmp_path, url, ollama_model="gemma3:4b"))
    assert json.loads(llm._ollama("gemma3:4b", "s", "p"))["score_1_7"] == 3
    assert "think" in seen[0] and "think" not in seen[1]                         # retried without it
    llm._ollama("gemma3:4b", "s", "p")
    assert "think" not in seen[2]                                                # remembered


def test_live_shadow_and_comparison(ollama, tmp_path):
    cfg = _cfg(tmp_path, ollama[0], shadow_model="gemma3:4b")
    st = Store(cfg.db_path)
    llm = LLM(cfg, st)
    r = llm.ask("judge_help", {"text": "help page"}, run_id=1, page_id=7)
    assert r["score_1_7"] == 5                                                   # primary answer is what's used
    rows = st.query("SELECT model, role, replay_of, prompt FROM llm_calls ORDER BY id")
    assert [x["role"] for x in rows] == ["primary", "shadow"] and rows[1]["replay_of"]
    assert rows[0]["prompt"] == rows[1]["prompt"] and rows[1]["model"] == "gemma3:4b"
    pairs, summ = analysis.model_comparison(st)
    s = summ.iloc[0]
    assert s.model_a == "qwen3:4b" and s.model_b == "gemma3:4b" and s.calls == 1
    assert s.a_valid_json == 1.0 and s.b_valid_json == 1.0 and s.models_agree == 0.0   # 5 vs 3: >1 apart


def test_replay_skips_done_and_scores_against_reviewer(ollama, tmp_path):
    cfg = _cfg(tmp_path, ollama[0])
    st = Store(cfg.db_path)
    llm = LLM(cfg, st)
    rid = st.start_run({})
    sid = st.upsert_site({"collection_url": "https://a/", "platform": "Omeka", "library_type": "Museum",
                          "institution": "A", "library_page": "", "listings": []})
    for i in range(3):
        r = llm.ask("judge_help", {"text": f"page {i}"}, run_id=rid, site_id=sid)
        fid = st.add_finding(rid, sid, None, "FIL3/HEP1", "llm.help_quality", "llm", "partial", r["score_1_7"], 0.8,
                             evidence={"llm_call": r["_call_id"]})
        if i == 0:
            st.add_review(fid, "me", "override", 3)                               # reviewer sides with gemma
    assert bench.replay(st, cfg, "gemma3:4b", run_id=rid) == 3
    assert bench.replay(st, cfg, "gemma3:4b", run_id=rid) == 0                    # nothing left to replay
    pairs, summ = analysis.model_comparison(st, rid)
    s = summ.iloc[0]
    assert s.calls == 3 and s.reviewed == 1
    assert s.a_agrees_with_reviewer == 0.0 and s.b_agrees_with_reviewer == 1.0


def test_app_model_dropdowns(ollama, tmp_path, monkeypatch):
    pytest.importorskip("streamlit")
    from streamlit.testing.v1 import AppTest
    monkeypatch.setenv("OLLAMA_URL", ollama[0])
    monkeypatch.setenv("MDLAUG_DB", str(tmp_path / "a.db"))
    monkeypatch.setenv("MDLAUG_LOGS", str(tmp_path / "logs"))
    app = str(Path(__file__).resolve().parents[1] / "app.py")
    at = AppTest.from_file(app, default_timeout=120).run()
    assert not at.exception, [str(e.value) for e in at.exception]
    sel = {s.label: s for s in at.sidebar.selectbox}
    assert set(sel["Model"].options) >= {"qwen3:4b · 4.0B · 2.6 GB", "gemma3:4b · 4.3B · 3.3 GB"}
    sel["Model"].set_value("gemma3:4b").run()
    sel = {s.label: s for s in at.sidebar.selectbox}
    sel["Compare with (optional)"].set_value("qwen3:4b").run()
    assert not at.exception
    st = Store(str(tmp_path / "a.db"))
    assert st.get_setting("llm:model") == "gemma3:4b" and st.get_setting("llm:shadow") == "qwen3:4b"
    at2 = AppTest.from_file(app, default_timeout=120).run()                       # survives a restart
    assert {s.label: s for s in at2.sidebar.selectbox}["Model"].value == "gemma3:4b"
