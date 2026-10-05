"""Open (self-identified) reviewer: gated on a name, stored separately, never mixed into verified results."""
import base64, io, json
from pathlib import Path
import pytest
from PIL import Image
from mdlaug_crawl import crowd
from mdlaug_crawl.store import Store
from mdlaug_crawl.turso import Turso
import fake_turso

APP_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture
def db():
    srv, url, tok, con, calls = fake_turso.serve()
    d = Turso(url, tok); crowd.init(d)
    buf = io.BytesIO(); Image.new("RGB", (390, 600), "white").save(buf, "WEBP")
    d.execute("INSERT INTO crowd_sites VALUES('s1','https://a.edu/','A Library','DSpace','Academic library')")
    ann = {"meta": {"scrollW": 390, "vw": 390}, "items": [{"code": "RED1", "status": "issue", "label": "count not announced",
           "source": "probe", "x": 10, "y": 20, "w": 200, "h": 20, "selector": "p", "tag": "p", "current": ""}]}
    d.execute("INSERT INTO crowd_pages VALUES('box:1:1','box:1','s1','https://a.edu/search','results','R',?,?)",
              [json.dumps(ann), json.dumps({"changed": [], "inserted": [], "annotations": ann})])
    d.execute("INSERT INTO crowd_images VALUES('box:1:1','full','image/webp',390,600,?)", [base64.b64encode(buf.getvalue()).decode()])
    for i in (1, 2):
        d.execute("INSERT INTO crowd_findings VALUES(?, 'box:1','s1','box:1:1','RED1','A','probe.results_status','probe',"
                  "'partial',4,0.6,1,'count shown but not in a live region','{}')", [f"box:1:{i}"])
    yield d, url, tok
    srv.shutdown()


def _app(url, tok, monkeypatch, name="", path="review_app.py"):
    pytest.importorskip("streamlit")
    from streamlit.testing.v1 import AppTest
    monkeypatch.setenv("TURSO_URL", url); monkeypatch.setenv("TURSO_TOKEN", tok)
    at = AppTest.from_file(str(APP_DIR / path), default_timeout=120).run()
    if name:
        [t for t in at.sidebar.text_input if t.label == "Your name *"][0].input(name)
        at.run()
    return at


def test_name_required_before_submitting(db, monkeypatch):
    d, url, tok = db
    at = _app(url, tok, monkeypatch)
    assert not at.exception, [str(e.value) for e in at.exception]
    assert any("Add your name" in w.value for w in at.sidebar.warning)
    [b for b in at.button if b.label == "Submit"][0].click().run()
    assert any("add your name" in e.value.lower() for e in at.error)
    assert d.query("SELECT COUNT(*) AS n FROM crowd_reviews")[0]["n"] == 0


def test_open_review_stored_separately(db, monkeypatch):
    d, url, tok = db
    at = _app(url, tok, monkeypatch, name="Pat Reviewer")
    [t for t in at.sidebar.text_area if t.label == "Notes about you"][0].input("VoiceOver user on iPhone")
    at.run()
    radio = [r for r in at.radio if r.label == "Is the tool right?"][0]
    radio.set_value("No — it should be scored differently")
    [t for t in at.text_input if t.label.startswith("Suggest a fix")][0].input("Put the count in a role=status region")
    [b for b in at.button if b.label == "Submit"][0].click().run()
    assert not at.exception
    r = d.query("SELECT reviewer, channel, decision, identity FROM crowd_reviews")
    assert len(r) == 1 and r[0]["channel"] == "open" and r[0]["reviewer"] == "open:pat reviewer"
    idn = json.loads(r[0]["identity"])
    assert idn["name"] == "Pat Reviewer" and idn["about"] == "VoiceOver user on iPhone" and idn["self_reported"]
    fb = d.query("SELECT text, finding_id, channel FROM crowd_feedback")
    assert fb and fb[0]["text"].startswith("Suggested fix:") and fb[0]["finding_id"] and fb[0]["channel"] == "open"
    # verified side is untouched: finding still needs both verified reviews; verified consensus ignores it
    vq = crowd.queue(d, "someone@uva.edu", limit=10)
    assert {f["id"] for f in vq} == {"box:1:1", "box:1:2"} and all(f["n_reviews"] == 0 for f in vq)
    assert crowd.finding_consensus(d) == {}
    reviewed = [fid for fid, c in crowd.finding_consensus(d, channels=crowd.OPEN).items()]
    assert len(reviewed) == 1 and crowd.finding_consensus(d, channels=crowd.OPEN)[reviewed[0]]["state"] == "single"


def test_notes_and_session_cap(db, monkeypatch):
    d, url, tok = db
    at = _app(url, tok, monkeypatch, name="Sam")
    [t for t in at.text_area if t.label == "Your note"][0].input("The Avalon player needs captions")
    [b for b in at.button if b.label == "Send note"][0].click().run()
    assert not at.exception
    fb = d.query("SELECT author, text, channel FROM crowd_feedback")
    assert fb == [{"author": "open:sam", "text": "The Avalon player needs captions", "channel": "open"}]
    at.session_state["n_submits"] = 300                       # at the per-session cap
    at.run()
    [t for t in at.text_area if t.label == "Your note"][0].input("one more")
    [b for b in at.button if b.label == "Send note"][0].click().run()
    assert any("limit for one session" in e.value for e in at.error)
    assert len(d.query("SELECT id FROM crowd_feedback")) == 1


def test_pull_ignores_open_unless_asked(db, tmp_path):
    d, _, _ = db
    st = Store(str(tmp_path / "l.db"))
    rid = st.start_run({})
    sid = st.upsert_site({"collection_url": "https://a.edu/", "platform": "DSpace", "library_type": "Academic library",
                          "institution": "A", "library_page": "", "listings": []})
    for _ in range(2):
        st.add_finding(rid, sid, None, "RED1", "probe.results_status", "probe", "partial", 4, 0.6, True, "x")
    d.execute("UPDATE crowd_findings SET id=? WHERE id='box:1:1'", [f"box:{rid}:1"])
    for who in ("open:a", "open:b"):
        crowd.add_review(d, f"box:{rid}:1", who, "confirm", channel="open", identity={"name": who})
    assert crowd.pull(st, d, source="box") == 0
    assert crowd.pull(st, d, source="box", include_open=True) == 1


def test_old_crowd_db_gets_channel_columns():
    srv, url, tok, con, calls = fake_turso.serve()
    try:
        d = Turso(url, tok)
        d.execute("CREATE TABLE crowd_reviews(id TEXT PRIMARY KEY, finding_id TEXT, reviewer TEXT, decision TEXT, "
                  "score INTEGER, issue_tag TEXT, note TEXT, exemplar TEXT, ts REAL)")
        d.execute("INSERT INTO crowd_reviews VALUES('r1','f1','x@y','confirm',NULL,'','','',1)")
        crowd.init(d)
        cols = {r["name"] for r in d.query("PRAGMA table_info(crowd_reviews)")}
        assert {"channel", "identity"} <= cols
        assert d.query("SELECT channel FROM crowd_reviews")[0]["channel"] == "verified"   # existing rows stay verified
    finally:
        srv.shutdown()


def test_admin_sees_open_reviews(db, monkeypatch):
    d, url, tok = db
    crowd.add_user(d, "admin@uva.edu", "admin")
    crowd.add_review(d, "box:1:1", "open:pat", "unsure", channel="open", identity={"name": "Pat", "affiliation": "UVA"})
    crowd.add_feedback(d, "Please add the Fralin museum", "open:pat", {"name": "Pat"})
    monkeypatch.setenv("MDLAUG_CROWD_DEV_USER", "admin@uva.edu")
    at = _app(url, tok, monkeypatch, path="crowd_app.py")
    assert not at.exception, [str(e.value) for e in at.exception]
    assert any("Open reviews & notes" in s.value for s in at.subheader)
