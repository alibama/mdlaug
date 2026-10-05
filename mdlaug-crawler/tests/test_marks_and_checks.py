import json, sqlite3
from pathlib import Path
from PIL import Image
from mdlaug_crawl import annotate, checks, scoring
from mdlaug_crawl.store import Store
from mdlaug_crawl.llm import LLM
from mdlaug_crawl.config import Config


def test_catalog_covers_every_situation():
    codes = [c for c, _ in scoring.SITUATIONS]
    assert set(codes) == set(checks.CATALOG)
    for c in codes:
        e = checks.CATALOG[c]
        assert e["question"] and e["auto"] and e["rubric"] and e["review"]
    for task, code in checks.DEFAULT_TASK_SITUATION.items():
        assert checks.CATALOG[code]["llm"] == task


def test_matches_tokens():
    assert annotate.matches("COM2", ["COM2/NAV1"]) and annotate.matches("FIL2", ["FIL2/RED3"])
    assert not annotate.matches("NAV2", ["COM2/NAV1"]) and annotate.matches("X", None)


def test_draw_filters_and_groups(tmp_path):
    shot = tmp_path / "s.png"; Image.new("RGB", (400, 600), "white").save(shot)
    ann = {"meta": {"scrollW": 400, "vw": 400}, "items": [
        {"code": "RED1", "status": "issue", "label": "count not announced", "source": "probe", "x": 10, "y": 10, "w": 200, "h": 20},
        {"code": "RED1", "status": "good", "label": "live region", "source": "probe", "x": 10, "y": 10, "w": 200, "h": 20},
        {"code": "NAV2", "status": "good", "label": "pagination", "source": "engine", "x": 10, "y": 300, "w": 200, "h": 20},
        {"code": "2.5.8", "status": "review", "label": "small", "source": "probe", "x": 10, "y": 400, "w": 10, "h": 10}]}
    g = annotate.group([i for i in ann["items"] if annotate.is_situation(i["code"])])
    assert len(g) == 2 and g[0]["status"] == "issue"          # merged; worst status wins
    full = annotate.draw(shot, ann)
    only = annotate.draw(shot, ann, codes=["RED1"])
    assert full.width == 400 + annotate.PANEL_W and only.size[1] >= 600
    px = full.getpixel((300, 310))                             # NAV2 box edge present in unfiltered render
    assert full.getpixel((10, 300)) != (255, 255, 255)
    assert only.getpixel((10, 300)) == (255, 255, 255)         # filtered out


def test_old_database_is_migrated(tmp_path):
    db = tmp_path / "old.db"
    con = sqlite3.connect(db)
    con.executescript("CREATE TABLE pages(id INTEGER PRIMARY KEY, run_id INTEGER, url TEXT);"
                      "CREATE TABLE reviews(id INTEGER PRIMARY KEY, finding_id INTEGER, decision TEXT);"
                      "CREATE TABLE llm_calls(id INTEGER PRIMARY KEY, task TEXT);")
    con.commit(); con.close()
    st = Store(str(db))
    cols = {r["name"] for r in st.query("PRAGMA table_info(pages)")}
    assert {"annotations", "fullshot", "annotated"} <= cols
    assert "exemplar" in {r["name"] for r in st.query("PRAGMA table_info(reviews)")}


def test_prompt_edits_and_exemplars_change_prompt(tmp_path):
    st = Store(str(tmp_path / "p.db"))
    cfg = Config(db_path=str(tmp_path / "p.db"))
    p1, v1 = LLM(cfg, st).build_prompt("judge_help", {"text": "x"})
    assert "Scoring guide (FIL3/HEP1)" in p1
    st.set_setting("prompt:judge_help", "Custom help instruction.", "tester")
    st.set_setting("check:FIL3/HEP1", json.dumps({"rubric": "7 — custom rubric"}), "tester")
    p2, v2 = LLM(cfg, st).build_prompt("judge_help", {"text": "x"})
    assert p2.startswith("Custom help instruction.") and "7 — custom rubric" in p2 and v2 != v1
    rid = st.start_run({})
    sid = st.upsert_site({"collection_url": "https://a/", "platform": "Omeka", "library_type": "Museum",
                          "institution": "A", "library_page": "", "listings": []})
    fid = st.add_finding(rid, sid, None, "FIL3/HEP1", "llm.help_quality", "llm", "pass", 7, 0.9,
                         message="help explains VoiceOver gestures")
    st.add_review(fid, "tester", "confirm", note="great AT section", exemplar="good")
    p3, v3 = LLM(cfg, st).build_prompt("judge_help", {"text": "x"})
    assert "GOOD example" in p3 and "great AT section" in p3 and v3 != v2
    st.set_setting("fewshot:enabled", "0")
    p4, _ = LLM(cfg, st).build_prompt("judge_help", {"text": "x"})
    assert "GOOD example" not in p4
    assert len(st.query("SELECT * FROM settings_history")) >= 3
