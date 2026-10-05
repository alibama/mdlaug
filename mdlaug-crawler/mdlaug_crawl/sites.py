"""Load the DL list spreadsheet into a de-duplicated list of sites.

The sheet has merged-style blank cells (Platform / library type only on the first row
of each block), non-breaking spaces in headers, and the same collection URL listed
under several institutions/categories. We forward-fill, normalise, and de-duplicate
on the collection URL, keeping every (institution, platform, type) it was listed as.
"""
import re
import pandas as pd

TYPE_NORMAL = {
    "large scale library/consortium": "Large-scale library / consortium",
    "large scale libraryconsortium": "Large-scale library / consortium",
    "large scale library": "Large-scale library / consortium",
    "academic library": "Academic library",
    "public library": "Public library",
    "organizational library": "Organizational library",
    "museums": "Museum",
}


def _clean(s):
    if s is None or (isinstance(s, float) and pd.isna(s)):
        return ""
    return re.sub(r"\s+", " ", str(s).replace("\xa0", " ")).strip()


def normalize_url(u):
    u = _clean(u)
    if not u:
        return ""
    if not re.match(r"^https?://", u, re.I):
        u = "https://" + u
    return u.rstrip("/") + "/" if re.match(r"^https?://[^/]+$", u, re.I) else u


def load_sheet(path):
    df = pd.read_excel(path)
    df.columns = [_clean(c) for c in df.columns]
    col = {c.lower(): c for c in df.columns}
    plat = col.get("platform")
    ltype = col.get("digital library repository name")
    df[plat] = df[plat].ffill()
    df[ltype] = df[ltype].ffill()
    rows = []
    for _, r in df.iterrows():
        coll = normalize_url(r.get(col.get("digital collection page")))
        if not coll:
            coll = normalize_url(r.get(col.get("url")))
        if not coll:
            continue
        t = _clean(r[ltype])
        rows.append({
            "platform": _clean(r[plat]).replace(" (scaling via Drupal)", ""),
            "library_type": TYPE_NORMAL.get(t.lower(), t),
            "institution": _clean(r.get(col.get("institution name"))),
            "library_page": normalize_url(r.get(col.get("digital library page"))),
            "collection_url": coll,
        })
    return pd.DataFrame(rows)


def dedupe_sites(rows):
    """One record per collection URL; keep all listings it appeared under."""
    out = {}
    for r in rows.to_dict("records"):
        s = out.setdefault(r["collection_url"], {
            "collection_url": r["collection_url"], "platform": r["platform"],
            "library_type": r["library_type"], "library_page": r["library_page"],
            "institution": r["institution"], "listings": []})
        s["listings"].append({k: r[k] for k in ("institution", "platform", "library_type")})
    return list(out.values())


def parse_bulk(text, default_platform="", default_type=""):
    """One site per line: URL[, institution[, platform[, library type]]] (comma or tab separated)."""
    out, bad = [], []
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in re.split(r"\t|,", line)]
        url = normalize_url(parts[0])
        if not re.match(r"^https?://[^/\s]+\.[^/\s]+", url):
            bad.append(raw); continue
        host = re.sub(r"^https?://(www\.)?", "", url).split("/")[0]
        out.append({"collection_url": url, "institution": parts[1] if len(parts) > 1 and parts[1] else host,
                    "platform": parts[2] if len(parts) > 2 and parts[2] else default_platform,
                    "library_type": parts[3] if len(parts) > 3 and parts[3] else default_type,
                    "library_page": "", "listings": []})
    return out, bad


def select(rows, platforms=None, types=None, urls=None, ids=None, limit=0, active_only=True):
    """The single definition of 'which sites will be crawled' — used by the CLI and the app preview."""
    r = [x for x in rows if not active_only or (x.get("active") is None or int(x.get("active") or 0) == 1)]
    if platforms:
        r = [x for x in r if x["platform"] in platforms]
    if types:
        r = [x for x in r if x["library_type"] in types]
    if urls:
        r = [x for x in r if x["collection_url"] in urls]
    if ids:
        r = [x for x in r if x["id"] in set(ids)]
    r = sorted(r, key=lambda x: (x.get("platform") or "", x.get("institution") or "", x["collection_url"]))
    return r[:limit] if limit else r
