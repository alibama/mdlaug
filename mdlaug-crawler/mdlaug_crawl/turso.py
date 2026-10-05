"""Minimal Turso / libSQL HTTP client (Hrana-over-HTTP /v2/pipeline).

Used server-side only (crawler publish, crowd app), so it talks to Turso directly with
a token from env/secrets. Screenshots are stored as base64 TEXT rather than BLOB to
keep the wire format simple and match the existing evidence table.
"""
import json
import re

import requests


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


def _dec(c):
    t = (c or {}).get("type")
    if t in (None, "null"):
        return None
    if t == "integer":
        return int(c["value"])
    if t == "float":
        return float(c["value"])
    return c.get("value")


class TursoError(RuntimeError):
    pass


class Turso:
    def __init__(self, url, token, timeout=60, session=None):
        self.url = normalize_url(url)
        self.token = token or ""
        self.timeout = timeout
        self.http = session or requests.Session()

    def _pipeline(self, stmts):
        reqs = [{"type": "execute", "stmt": {"sql": sql, "args": [_enc(a) for a in (args or [])]}} for sql, args in stmts]
        reqs.append({"type": "close"})
        r = self.http.post(self.url + "/v2/pipeline", timeout=self.timeout, data=json.dumps({"requests": reqs}),
                           headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json"})
        if r.status_code >= 400:
            raise TursoError(f"HTTP {r.status_code}: {r.text[:300]}")
        out = []
        for res in (r.json() or {}).get("results", [])[: len(stmts)]:
            if res.get("type") == "error":
                raise TursoError((res.get("error") or {}).get("message", "SQL error"))
            out.append((res.get("response") or {}).get("result") or {})
        return out

    def execute(self, sql, args=None):
        return self._pipeline([(sql, args)])[0]

    def batch(self, stmts, chunk=40):
        """Run many statements, `chunk` per HTTP request."""
        for i in range(0, len(stmts), chunk):
            self._pipeline(stmts[i:i + chunk])

    def query(self, sql, args=None):
        res = self.execute(sql, args)
        cols = [c.get("name") for c in res.get("cols", [])]
        return [dict(zip(cols, [_dec(v) for v in row])) for row in res.get("rows", [])]
