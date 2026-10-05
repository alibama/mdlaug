"""The app must render a database that mixes pages crawled before newer features existed
(no full-page shot / markup / repair preview) with newer pages, and findings with no page."""
import json, os, time
from pathlib import Path
import pytest
from mdlaug_crawl.store import Store

streamlit = pytest.importorskip("streamlit")
from streamlit.testing.v1 import AppTest  # noqa: E402

APP = str(Path(__file__).resolve().parents[1] / "app.py")


def test_app_renders_mixed_old_and_new_rows(tmp_path, monkeypatch):
    db = tmp_path / "m.db"
    st = Store(str(db))
    rid = st.start_run({}, "mixed")
    sid = st.upsert_site({"collection_url": "https://a.example/", "platform": "DSpace", "library_type": "Academic library",
                          "institution": "A", "library_page": "", "listings": []})
    old = st.add_page(rid, sid, url="https://a.example/", status="ok", page_type="home")         # pre-markup page
    new = st.add_page(rid, sid, url="https://a.example/search", status="ok", page_type="results",
                      fullshot=str(tmp_path / "missing.png"), annotations=json.dumps({"meta": {}, "items": []}),
                      remediation=json.dumps({"changed": [], "inserted": [], "annotations": {}}),
                      aftershot=str(tmp_path / "missing_after.png"))
    for pid in (old, new, None):
        st.add_finding(rid, sid, pid, "FIL3/HEP1", "probe.help_present", "probe", "fail", 2, 0.3, True, "no help link")
    st.add_finding(rid, sid, new, "RED1", "probe.results_status", "probe", "partial", 4, 0.8, False, "count shown")
    st.finish_run(rid)
    monkeypatch.setenv("MDLAUG_DB", str(db))
    monkeypatch.setenv("MDLAUG_LOGS", str(tmp_path / "logs"))
    at = AppTest.from_file(APP, default_timeout=120).run()
    assert not at.exception, [str(e.value) for e in at.exception]
