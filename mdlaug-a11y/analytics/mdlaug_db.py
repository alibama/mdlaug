"""
Read-side client for the mDLAUG audit database.

Talks to Turso (libSQL) over its HTTP pipeline API — the same endpoint the
browser extension writes to — so it works against a Turso cloud database
directly (with a token, read-only recommended) or against the Cloudflare relay
(URL + AUTH_KEY). No libSQL driver needed; just `requests`.

The transform functions are pure (DataFrame in, DataFrame out) so they can be
unit-tested without a network or a database.
"""
import json
import re

import pandas as pd
import requests

LEVEL_COLORS = {"A": "#1f9e8f", "AA": "#e8912a", "AAA": "#b1315e"}
LEVEL_ORDER = {"A": 0, "AA": 1, "AAA": 2}


def normalize_url(url):
    url = (url or "").strip().rstrip("/")
    url = re.sub(r"^libsql://", "https://", url, flags=re.I)
    if url and not re.match(r"^https?://", url, flags=re.I):
        url = "https://" + url
    return url


def _enc(v):
    if v is None:
        return {"type": "null"}
    if isinstance(v, bool):
        return {"type": "integer", "value": "1" if v else "0"}
    if isinstance(v, int):
        return {"type": "integer", "value": str(v)}
    if isinstance(v, float):
        return {"type": "float", "value": v}
    return {"type": "text", "value": str(v)}


def _dec(cell):
    if not cell:
        return None
    t = cell.get("type")
    if t == "null":
        return None
    if t == "integer":
        try:
            return int(cell["value"])
        except (KeyError, ValueError, TypeError):
            return None
    if t == "float":
        try:
            return float(cell["value"])
        except (KeyError, ValueError, TypeError):
            return None
    return cell.get("value")


def decode_result(result):
    """Turn a libSQL execute result into (columns, rows-of-native-values)."""
    result = result or {}
    cols = [c.get("name") for c in result.get("cols", [])]
    rows = [[_dec(c) for c in row] for row in result.get("rows", [])]
    return cols, rows


class Turso:
    def __init__(self, url, token, timeout=30):
        self.url = normalize_url(url)
        self.token = token or ""
        self.timeout = timeout

    def execute(self, sql, args=None):
        body = {
            "requests": [
                {"type": "execute", "stmt": {"sql": sql, "args": [_enc(a) for a in (args or [])]}},
                {"type": "close"},
            ]
        }
        r = requests.post(
            self.url + "/v2/pipeline",
            headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json"},
            data=json.dumps(body),
            timeout=self.timeout,
        )
        r.raise_for_status()
        results = (r.json() or {}).get("results", [])
        first = results[0] if results else {}
        if first.get("type") == "error":
            raise RuntimeError((first.get("error") or {}).get("message", "SQL error"))
        return decode_result((first.get("response") or {}).get("result", {}))

    def df(self, sql, args=None):
        cols, rows = self.execute(sql, args)
        return pd.DataFrame(rows, columns=cols)


# ---- queries -------------------------------------------------------------
def fetch_situations(t):
    """One row per situation_result, joined to its assessment."""
    return t.df(
        "SELECT a.id AS assessment_id, a.dl_name, a.dl_url, a.assessor, a.created_at, "
        "sr.code, sr.level, sr.compliance_score, sr.auto_score "
        "FROM situation_result sr JOIN assessment a ON a.id = sr.assessment_id"
    )


def fetch_assessments(t):
    return t.df(
        "SELECT id, dl_name, dl_url, assessor, created_at, tool_version "
        "FROM assessment ORDER BY created_at DESC"
    )


# ---- pure transforms -----------------------------------------------------
def _filter(df, dl_url):
    if dl_url in (None, "", "All"):
        return df
    return df[df["dl_url"] == dl_url]


def compliance_by_situation(df, dl_url=None):
    d = _filter(df, dl_url).dropna(subset=["compliance_score"])
    if d.empty:
        return pd.DataFrame(columns=["code", "level", "avg_score", "n"])
    g = d.groupby(["code", "level"], as_index=False).agg(
        avg_score=("compliance_score", "mean"), n=("compliance_score", "size")
    )
    return g.sort_values("code").reset_index(drop=True)


def level_rollup(df, dl_url=None):
    g = compliance_by_situation(df, dl_url)
    if g.empty:
        return pd.DataFrame(columns=["level", "avg_score", "n"])
    g = g.assign(_w=g["avg_score"] * g["n"])
    r = g.groupby("level", as_index=False).agg(_w=("_w", "sum"), n=("n", "sum"))
    r["avg_score"] = r["_w"] / r["n"]
    r["_o"] = r["level"].map(lambda x: LEVEL_ORDER.get(x, 9))
    r = r.sort_values("_o")
    return r[["level", "avg_score", "n"]].reset_index(drop=True)


def trend_over_time(df, dl_url=None):
    d = _filter(df, dl_url).dropna(subset=["compliance_score"])
    if d.empty:
        return pd.DataFrame(columns=["created_at", "date", "avg_score", "assessment_id"])
    g = d.groupby(["assessment_id", "created_at"], as_index=False).agg(
        avg_score=("compliance_score", "mean")
    )
    g["date"] = g["created_at"].astype(str).str.slice(0, 10)
    return g.sort_values("created_at")[["created_at", "date", "avg_score", "assessment_id"]].reset_index(drop=True)


def library_names(df):
    d = df.dropna(subset=["dl_url"])
    if d.empty:
        return {}
    return d.groupby("dl_url")["dl_name"].first().to_dict()
