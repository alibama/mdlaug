"""Crowd pipeline against a local fake Turso: publish → review/consensus → fixes/votes → pull → app."""
import asyncio, base64, json
from pathlib import Path
import pytest
from mdlaug_crawl.config import Config
from mdlaug_crawl.store import Store
from mdlaug_crawl.llm import LLM
from mdlaug_crawl.turso import Turso, TursoError
from mdlaug_crawl import runner, crowd, analysis
import fake_llm, server, fake_turso


@pytest.fixture(scope="module")
def crawled(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("crowd")
    srv, base = server.serve()
    try:
        cfg = Config(db_path=str(tmp / "c.db"), artifacts_dir=str(tmp / "art"), logs_dir=str(tmp / "logs"))
        cfg.polite_delay_s = 0
        st = Store(cfg.db_path, cfg.logs_dir)
        rid = asyncio.run(runner.run_crawl(cfg, st, LLM(cfg, st, transport=fake_llm.transport), [
            {"collection_url": base, "platform": "DSpace", "library_type": "Academic library", "institution": "Fixture DL",
             "library_page": base, "listings": []}], note="crowd"))
    finally:
        srv.shutdown()
    tsrv, turl, tok, con, calls = fake_turso.serve()
    yield {"store": st, "run": rid, "db": Turso(turl, tok), "con": con, "calls": calls, "tmp": tmp, "turl": turl, "tok": tok}
    tsrv.shutdown()


def test_bad_token_rejected(crawled):
    with pytest.raises(TursoError):
        Turso(crawled["turl"], "wrong").execute("SELECT 1")


def test_publish_and_republish(crawled):
    db, st = crawled["db"], crawled["store"]
    r1 = crowd.publish(st, db, crawled["run"], source="testbox")
    assert r1["sites"] == 1 and r1["pages"] >= 5 and r1["images"] >= 8 and r1["findings"] > 20
    img = db.query("SELECT data, mime, width FROM crowd_images LIMIT 1")[0]
    raw = base64.b64decode(img["data"])
    assert raw[:4] == b"RIFF" and raw[8:12] == b"WEBP" and img["width"] <= 1000
    n = lambda t: db.query(f"SELECT COUNT(*) AS n FROM {t}")[0]["n"]  # noqa: E731
    counts = (n("crowd_pages"), n("crowd_findings"), n("crowd_images"))
    crowd.publish(st, db, crawled["run"], source="testbox")              # idempotent
    assert (n("crowd_pages"), n("crowd_findings"), n("crowd_images")) == counts


def test_users_and_allowlist(crawled):
    db = crawled["db"]
    crowd.add_user(db, "Admin@Example.org", "admin", "Ann")
    crowd.add_user(db, "rev1@example.org"); crowd.add_user(db, "rev2@example.org"); crowd.add_user(db, "gone@example.org")
    crowd.deactivate_user(db, "gone@example.org")
    assert crowd.user(db, "admin@example.org")["role"] == "admin"
    assert crowd.user(db, "gone@example.org") is None and crowd.user(db, "stranger@x.org") is None


def test_queue_reviews_consensus_and_pull(crawled):
    db, st = crawled["db"], crawled["store"]
    q1 = crowd.queue(db, "rev1@example.org", limit=50)
    assert q1 and all(f["needs_review"] == 1 for f in q1)
    a, b = q1[0], q1[1]
    crowd.add_review(db, a["id"], "rev1@example.org", "override", 6)
    assert a["id"] not in {f["id"] for f in crowd.queue(db, "rev1@example.org", limit=50)}   # not shown twice
    assert a["id"] in {f["id"] for f in crowd.queue(db, "rev2@example.org", limit=50)}       # still needs a 2nd
    crowd.add_review(db, a["id"], "rev2@example.org", "override", 5)
    assert a["id"] not in {f["id"] for f in crowd.queue(db, "admin@example.org", limit=50)}  # reached target
    crowd.add_review(db, b["id"], "rev1@example.org", "override", 2)
    crowd.add_review(db, b["id"], "rev2@example.org", "override", 6)
    c = crowd.finding_consensus(db)
    assert c[a["id"]]["state"] == "agreed" and c[a["id"]]["score"] in (5, 6)
    assert c[b["id"]]["state"] == "disputed"
    assert crowd.consensus([{"decision": "confirm", "score": None}] * 2, 4) == {"state": "agreed", "n": 2, "decision": "confirm", "score": 4}
    assert crowd.pull(st, db, source="testbox") == 1            # only the agreed one
    assert crowd.pull(st, db, source="testbox") == 0            # no duplicates on re-pull
    local_id = int(a["id"].rsplit(":", 1)[1])
    rv = st.query("SELECT reviewer, decision, score FROM reviews WHERE finding_id=?", (local_id,))
    assert rv and rv[-1]["reviewer"].startswith("crowd") and rv[-1]["decision"] == "override"


def test_fix_targets_votes_and_improved_pack(crawled):
    db = crawled["db"]
    home = db.query("SELECT * FROM crowd_pages WHERE page_type='home'")[0]
    targets = crowd.fix_targets(home)
    alt = [t for t in targets if t["attr"] == "alt"]
    named = [t for t in targets if t["attr"] == "aria-label"]
    assert alt and named and all(t["selector"] for t in targets)
    t = alt[0]
    f1 = crowd.propose_fix(db, home["id"], home["site_id"], t, "Harbor at dawn, 1902", "rev1@example.org")
    f2 = crowd.propose_fix(db, home["id"], home["site_id"], t, "photo", "rev2@example.org")
    assert crowd.vote(db, f1, "rev2@example.org", +1) == 2                 # author's own vote + one more = accepted
    st_ = {x["id"]: x["status"] for x in crowd.fixes(db, page_id=home["id"])}
    assert st_[f1] == "accepted" and st_[f2] == "superseded"
    pack = crowd.improved_pack(db, home["site_id"])
    rule = [r for r in pack["rules"] if r["select"] == t["selector"]][0]
    assert rule["set"]["alt"] == "Harbor at dawn, 1902" and "crowd-reviewed" in rule["describe"]
    assert db.query("SELECT COUNT(*) AS n FROM crowd_audit WHERE action LIKE 'fix.%'")[0]["n"] >= 3


def _app(crawled, monkeypatch, user):
    st_ = pytest.importorskip("streamlit")
    from streamlit.testing.v1 import AppTest
    monkeypatch.setenv("TURSO_URL", crawled["turl"]); monkeypatch.setenv("TURSO_TOKEN", crawled["tok"])
    monkeypatch.setenv("MDLAUG_CROWD_DEV_USER", user)
    return AppTest.from_file(str(Path(__file__).resolve().parents[1] / "crowd_app.py"), default_timeout=120).run()


def test_app_admin_and_reviewer(crawled, monkeypatch):
    at = _app(crawled, monkeypatch, "admin@example.org")
    assert not at.exception, [str(e.value) for e in at.exception]
    assert len(at.tabs) == 5                                                   # includes Admin
    at = _app(crawled, monkeypatch, "rev1@example.org")
    assert not at.exception and len(at.tabs) == 4                              # no Admin tab


def test_app_blocks_unlisted_user(crawled, monkeypatch):
    at = _app(crawled, monkeypatch, "stranger@example.org")
    assert not at.exception and len(at.tabs) == 0
    assert any("Not yet authorized" in t.value for t in at.title)


def test_app_fails_closed_without_auth_config(crawled, monkeypatch):
    pytest.importorskip("streamlit")
    from streamlit.testing.v1 import AppTest
    monkeypatch.setenv("TURSO_URL", crawled["turl"]); monkeypatch.setenv("TURSO_TOKEN", crawled["tok"])
    monkeypatch.delenv("MDLAUG_CROWD_DEV_USER", raising=False)
    at = AppTest.from_file(str(Path(__file__).resolve().parents[1] / "crowd_app.py"), default_timeout=60).run()
    assert not at.exception and len(at.tabs) == 0
    assert any("isn't configured" in e.value for e in at.error)


def test_app_signed_out_sees_only_sign_in(crawled, monkeypatch, tmp_path):
    pytest.importorskip("streamlit")
    from streamlit.testing.v1 import AppTest
    (tmp_path / ".streamlit").mkdir()
    (tmp_path / ".streamlit" / "secrets.toml").write_text(
        '[auth]\nredirect_uri = "http://localhost:8501/oauth2callback"\ncookie_secret = "' + "x" * 40 + '"\n'
        'client_id = "abc.apps.googleusercontent.com"\nclient_secret = "s"\n'
        'server_metadata_url = "https://accounts.google.com/.well-known/openid-configuration"\n')
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("TURSO_URL", crawled["turl"]); monkeypatch.setenv("TURSO_TOKEN", crawled["tok"])
    monkeypatch.delenv("MDLAUG_CROWD_DEV_USER", raising=False)
    at = AppTest.from_file(str(Path(__file__).resolve().parents[1] / "crowd_app.py"), default_timeout=60).run()
    assert not at.exception and len(at.tabs) == 0
    assert [b.label for b in at.button] == ["Sign in with Google"]
