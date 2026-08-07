import json

import pandas as pd
import mdlaug_db as db


def test_normalize_url():
    assert db.normalize_url("libsql://x.turso.io/") == "https://x.turso.io"
    assert db.normalize_url("x.turso.io") == "https://x.turso.io"
    assert db.normalize_url("https://x.turso.io") == "https://x.turso.io"


def test_encode_types():
    assert db._enc(None) == {"type": "null"}
    assert db._enc(5) == {"type": "integer", "value": "5"}
    assert db._enc(True) == {"type": "integer", "value": "1"}
    assert db._enc("hi") == {"type": "text", "value": "hi"}
    assert db._enc(3.14)["type"] == "float"


def test_decode_result():
    result = {
        "cols": [{"name": "code"}, {"name": "score"}, {"name": "note"}],
        "rows": [
            [{"type": "text", "value": "ACC1"}, {"type": "integer", "value": "4"}, {"type": "null"}],
        ],
    }
    cols, rows = db.decode_result(result)
    assert cols == ["code", "score", "note"]
    assert rows == [["ACC1", 4, None]]


def test_execute_parses_pipeline(monkeypatch):
    captured = {}

    class FakeResp:
        status_code = 200
        def raise_for_status(self): pass
        def json(self):
            return {"results": [
                {"type": "ok", "response": {"type": "execute", "result": {
                    "cols": [{"name": "n"}], "rows": [[{"type": "integer", "value": "3"}]]}}},
                {"type": "ok", "response": {"type": "close"}},
            ]}

    def fake_post(url, headers=None, data=None, timeout=None):
        captured["url"] = url
        captured["auth"] = headers["Authorization"]
        captured["body"] = json.loads(data)
        return FakeResp()

    monkeypatch.setattr(db.requests, "post", fake_post)
    t = db.Turso("libsql://db.turso.io", "secret")
    cols, rows = t.execute("select count(*) as n from assessment")
    assert captured["url"] == "https://db.turso.io/v2/pipeline"
    assert captured["auth"] == "Bearer secret"
    assert captured["body"]["requests"][-1]["type"] == "close"
    assert rows == [[3]]


def test_execute_raises_on_sql_error(monkeypatch):
    class FakeResp:
        def raise_for_status(self): pass
        def json(self):
            return {"results": [{"type": "error", "error": {"message": "no such table"}}]}
    monkeypatch.setattr(db.requests, "post", lambda *a, **k: FakeResp())
    t = db.Turso("https://db.turso.io", "t")
    try:
        t.execute("select 1")
        assert False, "should have raised"
    except RuntimeError as e:
        assert "no such table" in str(e)


def _sample():
    # two audits of lib A over time (improving), one of lib B
    return pd.DataFrame([
        dict(assessment_id="a1", dl_name="Heritage", dl_url="https://h", created_at="2026-05-01T00:00:00Z", code="ACC1", level="A", compliance_score=3, auto_score=3),
        dict(assessment_id="a1", dl_name="Heritage", dl_url="https://h", created_at="2026-05-01T00:00:00Z", code="NAV2", level="AA", compliance_score=4, auto_score=4),
        dict(assessment_id="a1", dl_name="Heritage", dl_url="https://h", created_at="2026-05-01T00:00:00Z", code="RED4", level="AAA", compliance_score=2, auto_score=2),
        dict(assessment_id="a2", dl_name="Heritage", dl_url="https://h", created_at="2026-06-01T00:00:00Z", code="ACC1", level="A", compliance_score=5, auto_score=5),
        dict(assessment_id="a2", dl_name="Heritage", dl_url="https://h", created_at="2026-06-01T00:00:00Z", code="NAV2", level="AA", compliance_score=6, auto_score=6),
        dict(assessment_id="a2", dl_name="Heritage", dl_url="https://h", created_at="2026-06-01T00:00:00Z", code="RED4", level="AAA", compliance_score=4, auto_score=4),
        dict(assessment_id="b1", dl_name="Other", dl_url="https://o", created_at="2026-05-15T00:00:00Z", code="ACC1", level="A", compliance_score=7, auto_score=7),
    ])


def test_compliance_by_situation():
    g = db.compliance_by_situation(_sample(), "https://h")
    by = {r["code"]: r for _, r in g.iterrows()}
    assert by["ACC1"]["avg_score"] == 4 and by["ACC1"]["n"] == 2
    assert by["NAV2"]["avg_score"] == 5
    assert by["RED4"]["avg_score"] == 3 and by["RED4"]["level"] == "AAA"


def test_level_rollup():
    r = db.level_rollup(_sample(), "https://h")
    by = {row["level"]: row["avg_score"] for _, row in r.iterrows()}
    assert by["A"] == 4 and by["AA"] == 5 and by["AAA"] == 3
    assert list(r["level"]) == ["A", "AA", "AAA"]  # ordered


def test_trend_over_time():
    tr = db.trend_over_time(_sample(), "https://h")
    assert list(tr["avg_score"]) == [3, 5]  # (3+4+2)/3, (5+6+4)/3, oldest first


def test_all_libraries_view():
    g = db.compliance_by_situation(_sample(), "All")
    acc1 = g[g["code"] == "ACC1"].iloc[0]
    assert acc1["n"] == 3 and abs(acc1["avg_score"] - 5.0) < 1e-9  # (3+5+7)/3
