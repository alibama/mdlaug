"""Crowdsourced review and remediation on Turso.

Tables (all prefixed crowd_, additive — the extension's assessment tables are untouched):
  crowd_users     allowlist: only these emails can use the crowd app (you add them)
  crowd_runs / crowd_sites / crowd_pages / crowd_images / crowd_findings
                  a published crawl (images are compressed WebP, base64 text)
  crowd_reviews   one row per reviewer per finding (several reviewers → consensus)
  crowd_fixes     proposed content fixes for specific elements (alt text, names, labels)
  crowd_votes     one vote per user per fix
  crowd_audit     who did what, when
"""
import base64
import hashlib
import io
import json
import socket
import statistics
import time
import uuid

from . import remediation, scoring

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS crowd_users(email TEXT PRIMARY KEY, name TEXT, role TEXT DEFAULT 'reviewer',
         active INTEGER DEFAULT 1, added_at REAL, added_by TEXT)""",
    """CREATE TABLE IF NOT EXISTS crowd_runs(id TEXT PRIMARY KEY, source TEXT, local_run INTEGER, started REAL,
         published REAL, note TEXT, device TEXT, model TEXT)""",
    """CREATE TABLE IF NOT EXISTS crowd_sites(id TEXT PRIMARY KEY, collection_url TEXT, institution TEXT,
         platform TEXT, library_type TEXT)""",
    """CREATE TABLE IF NOT EXISTS crowd_pages(id TEXT PRIMARY KEY, run_id TEXT, site_id TEXT, url TEXT,
         page_type TEXT, title TEXT, annotations TEXT, remediation TEXT)""",
    """CREATE TABLE IF NOT EXISTS crowd_images(page_id TEXT, kind TEXT, mime TEXT, width INTEGER, height INTEGER,
         data TEXT, PRIMARY KEY(page_id, kind))""",
    """CREATE TABLE IF NOT EXISTS crowd_findings(id TEXT PRIMARY KEY, run_id TEXT, site_id TEXT, page_id TEXT,
         code TEXT, level TEXT, check_id TEXT, method TEXT, outcome TEXT, score INTEGER, confidence REAL,
         needs_review INTEGER, message TEXT, evidence TEXT)""",
    """CREATE TABLE IF NOT EXISTS crowd_reviews(id TEXT PRIMARY KEY, finding_id TEXT, reviewer TEXT, decision TEXT,
         score INTEGER, issue_tag TEXT, note TEXT, exemplar TEXT, ts REAL)""",
    """CREATE TABLE IF NOT EXISTS crowd_fixes(id TEXT PRIMARY KEY, page_id TEXT, site_id TEXT, code TEXT,
         selector TEXT, tag TEXT, attr TEXT, current TEXT, proposed TEXT, note TEXT, author TEXT,
         status TEXT DEFAULT 'proposed', decided_by TEXT, ts REAL, decided_ts REAL)""",
    """CREATE TABLE IF NOT EXISTS crowd_votes(fix_id TEXT, voter TEXT, vote INTEGER, ts REAL,
         PRIMARY KEY(fix_id, voter))""",
    """CREATE TABLE IF NOT EXISTS crowd_audit(id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, actor TEXT,
         action TEXT, target TEXT, detail TEXT)""",
    "CREATE INDEX IF NOT EXISTS ix_cf_site ON crowd_findings(site_id, needs_review)",
    "CREATE INDEX IF NOT EXISTS ix_cr_find ON crowd_reviews(finding_id, reviewer)",
    "CREATE INDEX IF NOT EXISTS ix_cx_page ON crowd_fixes(page_id, selector)",
]

TARGET_REVIEWS = 2          # independent reviews wanted per flagged finding
ACCEPT_VOTES = 2            # net votes that accept (or reject, negated) a proposed fix
FIXABLE = {"ACC2": "alt", "USE1": "aria-label", "FIL1": "aria-label", "FIL2": "aria-label",
           "EXE1": "aria-label", "FORM1": "aria-label", "RED4": "aria-label", "COM2": "aria-label"}


def now():
    return time.time()


def source_name():
    import os
    return os.environ.get("MDLAUG_SOURCE") or socket.gethostname()


def site_key(url):
    return hashlib.sha1(url.encode()).hexdigest()[:16]


def init(db):
    db.batch([(s, None) for s in SCHEMA])


def audit(db, actor, action, target="", detail=None):
    db.execute("INSERT INTO crowd_audit(ts,actor,action,target,detail) VALUES(?,?,?,?,?)",
               [now(), actor, action, target, json.dumps(detail or {}, default=str)[:4000]])


# ---------------- users ----------------
def add_user(db, email, role="reviewer", name="", actor="cli"):
    email = email.strip().lower()
    db.execute("INSERT INTO crowd_users(email,name,role,active,added_at,added_by) VALUES(?,?,?,1,?,?) "
               "ON CONFLICT(email) DO UPDATE SET role=excluded.role, name=excluded.name, active=1",
               [email, name, role, now(), actor])
    audit(db, actor, "user.add", email, {"role": role})


def deactivate_user(db, email, actor="cli"):
    db.execute("UPDATE crowd_users SET active=0 WHERE email=?", [email.strip().lower()])
    audit(db, actor, "user.deactivate", email)


def user(db, email):
    if not email:
        return None
    r = db.query("SELECT * FROM crowd_users WHERE email=? AND active=1", [email.strip().lower()])
    return r[0] if r else None


# ---------------- publish (local SQLite → Turso) ----------------
def _webp_b64(path, max_w=1000):
    from PIL import Image
    im = Image.open(path).convert("RGB")
    if im.width > max_w:
        im = im.resize((max_w, int(im.height * max_w / im.width)))
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=72, method=4)
    return base64.b64encode(buf.getvalue()).decode(), im.width, im.height


def publish(store, db, run_id, source=None, max_w=1000, progress=None):
    """Idempotent: re-publishing a run replaces its rows. Returns counts."""
    from pathlib import Path
    source = source or source_name()
    init(db)
    run = store.query("SELECT * FROM runs WHERE id=?", (run_id,))[0]
    cfg = json.loads(run.get("config") or "{}")
    rk = f"{source}:{run_id}"
    db.execute("INSERT OR REPLACE INTO crowd_runs(id,source,local_run,started,published,note,device,model) "
               "VALUES(?,?,?,?,?,?,?,?)", [rk, source, run_id, run["started"], now(), run.get("note") or "",
                                            cfg.get("device") or "", cfg.get("ollama_model") or ""])
    site_ids = {r["site_id"] for r in store.query("SELECT DISTINCT site_id FROM pages WHERE run_id=?", (run_id,))}
    sites = [s for s in store.query("SELECT * FROM sites") if s["id"] in site_ids]
    skey = {s["id"]: site_key(s["collection_url"]) for s in sites}
    db.batch([("INSERT OR REPLACE INTO crowd_sites(id,collection_url,institution,platform,library_type) VALUES(?,?,?,?,?)",
               [skey[s["id"]], s["collection_url"], s["institution"], s["platform"], s["library_type"]]) for s in sites])
    pages = store.query("SELECT * FROM pages WHERE run_id=? AND status='ok'", (run_id,))
    pkey = lambda pid: f"{rk}:{pid}"  # noqa: E731
    db.batch([("INSERT OR REPLACE INTO crowd_pages(id,run_id,site_id,url,page_type,title,annotations,remediation) "
               "VALUES(?,?,?,?,?,?,?,?)", [pkey(p["id"]), rk, skey[p["site_id"]], p.get("final_url") or p["url"],
                                           p.get("page_type"), p.get("title"), p.get("annotations"), p.get("remediation")])
              for p in pages], chunk=10)
    n_img = 0
    for i, p in enumerate(pages, 1):
        for kind, col in (("full", "fullshot"), ("after", "aftershot")):
            path = p.get(col)
            if isinstance(path, str) and path and Path(path).exists():
                b64, w, h = _webp_b64(path, max_w)
                db.execute("INSERT OR REPLACE INTO crowd_images(page_id,kind,mime,width,height,data) VALUES(?,?,?,?,?,?)",
                           [pkey(p["id"]), kind, "image/webp", w, h, b64])
                n_img += 1
        if progress:
            progress(i, len(pages))
    fs = store.query("SELECT * FROM findings WHERE run_id=?", (run_id,))
    db.batch([("INSERT OR REPLACE INTO crowd_findings(id,run_id,site_id,page_id,code,level,check_id,method,outcome,"
               "score,confidence,needs_review,message,evidence) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
               [f"{rk}:{f['id']}", rk, skey[f["site_id"]], pkey(f["page_id"]) if f.get("page_id") else None, f["code"],
                scoring.LEVEL.get(f["code"], ""), f["check_id"], f["method"], f["outcome"], f.get("score"),
                f.get("confidence"), f.get("needs_review"), f.get("message"), (f.get("evidence") or "")[:4000]])
              for f in fs], chunk=25)
    audit(db, source, "publish", rk, {"sites": len(sites), "pages": len(pages), "images": n_img, "findings": len(fs)})
    return {"run": rk, "sites": len(sites), "pages": len(pages), "images": n_img, "findings": len(fs)}


# ---------------- review queue + consensus ----------------
def queue(db, email, limit=20, code=None, site=None, target=TARGET_REVIEWS):
    where, args = ["f.needs_review=1",
                   "NOT EXISTS (SELECT 1 FROM crowd_reviews r WHERE r.finding_id=f.id AND r.reviewer=?)",
                   "(SELECT COUNT(*) FROM crowd_reviews r2 WHERE r2.finding_id=f.id) < ?"], [email, target]
    if code:
        where.append("f.code=?"); args.append(code)
    if site:
        where.append("f.site_id=?"); args.append(site)
    args.append(limit)
    return db.query(
        "SELECT f.*, s.institution, s.collection_url, s.platform, p.url AS page_url, p.page_type, "
        "(SELECT COUNT(*) FROM crowd_reviews r3 WHERE r3.finding_id=f.id) AS n_reviews "
        "FROM crowd_findings f JOIN crowd_sites s ON s.id=f.site_id LEFT JOIN crowd_pages p ON p.id=f.page_id "
        f"WHERE {' AND '.join(where)} ORDER BY n_reviews, f.confidence LIMIT ?", args)


def add_review(db, finding_id, email, decision, score=None, issue_tag="", note="", exemplar=""):
    rid = str(uuid.uuid4())
    db.execute("INSERT INTO crowd_reviews(id,finding_id,reviewer,decision,score,issue_tag,note,exemplar,ts) "
               "VALUES(?,?,?,?,?,?,?,?,?)", [rid, finding_id, email, decision, score, issue_tag, note, exemplar, now()])
    audit(db, email, "review", finding_id, {"decision": decision, "score": score})
    return rid


def consensus(reviews, auto_score=None):
    """reviews: list of {decision, score}. → {state, decision, score, n}
    state: none | single | agreed | disputed"""
    n = len(reviews)
    if n == 0:
        return {"state": "none", "n": 0, "decision": None, "score": None}
    dec = [r["decision"] for r in reviews]
    top = max(set(dec), key=dec.count)
    scores = [r["score"] for r in reviews if r["decision"] == "override" and r.get("score") is not None]
    score = int(round(statistics.median(scores))) if (top == "override" and scores) else (auto_score if top == "confirm" else None)
    if n == 1:
        return {"state": "single", "n": 1, "decision": top, "score": score}
    agreed = dec.count(top) / n > 0.5 and (top != "override" or (max(scores) - min(scores) <= 1 if scores else False))
    return {"state": "agreed" if agreed else "disputed", "n": n, "decision": top, "score": score}


def finding_consensus(db, finding_ids=None):
    rows = db.query("SELECT r.finding_id, r.decision, r.score, f.score AS auto_score FROM crowd_reviews r "
                    "JOIN crowd_findings f ON f.id=r.finding_id")
    by = {}
    for r in rows:
        by.setdefault(r["finding_id"], {"auto": r["auto_score"], "rs": []})["rs"].append(r)
    return {fid: consensus(v["rs"], v["auto"]) for fid, v in by.items() if not finding_ids or fid in finding_ids}


def pull(store, db, source=None, include_single=False):
    """Import crowd consensus for this machine's runs into the local DB (as reviews by 'crowd')."""
    source = source or source_name()
    store._exec("CREATE TABLE IF NOT EXISTS crowd_imported(finding_id TEXT PRIMARY KEY, state TEXT, ts REAL)")
    done = {r["finding_id"] for r in store.query("SELECT finding_id FROM crowd_imported")}
    n = 0
    for fid, c in finding_consensus(db).items():
        if not fid.startswith(source + ":") or fid in done:
            continue
        if c["state"] == "agreed" or (include_single and c["state"] == "single"):
            local_id = int(fid.rsplit(":", 1)[1])
            store.add_review(local_id, f"crowd ({c['n']})", c["decision"],
                             c["score"] if c["decision"] == "override" else None, "", f"crowd consensus: {c['state']}")
            store._exec("INSERT INTO crowd_imported(finding_id,state,ts) VALUES(?,?,?)", (fid, c["state"], now()))
            n += 1
    return n


# ---------------- fix proposals ----------------
def fix_targets(page):
    """Elements on a page where a person could supply better content."""
    ann = json.loads(page.get("annotations") or "{}")
    out, seen = [], set()
    for a in ann.get("items", []):
        attr = FIXABLE.get(a.get("code"))
        if not attr or a.get("status") not in ("issue", "review") or not a.get("selector"):
            continue
        if attr == "alt" and a.get("tag") != "img":
            continue
        key = (a["selector"], attr)
        if key in seen:
            continue
        seen.add(key)
        out.append({"selector": a["selector"], "tag": a.get("tag"), "attr": attr, "code": a["code"],
                    "label": a.get("label"), "current": a.get("current") or "", "box": {k: a[k] for k in ("x", "y", "w", "h")}})
    rem = json.loads(page.get("remediation") or "{}")
    for c in rem.get("changed", []):         # generic names the engine guessed — people can improve them
        for d in c.get("diff", []):
            if d["attr"] == "aria-label" and (c["selector"], "aria-label") not in seen:
                seen.add((c["selector"], "aria-label"))
                out.append({"selector": c["selector"], "tag": c["before_tag"][1:].split(" ")[0].rstrip(">"),
                            "attr": "aria-label", "code": (c.get("codes") or ["USE1"])[0],
                            "label": f"engine guessed '{d['after']}'", "current": d["after"] or "",
                            "box": c.get("box")})
    return out


def propose_fix(db, page_id, site_id, target, proposed, email, note=""):
    fid = str(uuid.uuid4())
    db.execute("INSERT INTO crowd_fixes(id,page_id,site_id,code,selector,tag,attr,current,proposed,note,author,status,ts) "
               "VALUES(?,?,?,?,?,?,?,?,?,?,?,'proposed',?)",
               [fid, page_id, site_id, target["code"], target["selector"], target.get("tag"), target["attr"],
                target.get("current"), proposed.strip(), note, email, now()])
    vote(db, fid, email, +1)
    audit(db, email, "fix.propose", fid, {"selector": target["selector"], "attr": target["attr"]})
    return fid


def vote(db, fix_id, email, v):
    db.execute("INSERT OR REPLACE INTO crowd_votes(fix_id,voter,vote,ts) VALUES(?,?,?,?)", [fix_id, email, int(v), now()])
    net = db.query("SELECT COALESCE(SUM(vote),0) AS n FROM crowd_votes WHERE fix_id=?", [fix_id])[0]["n"]
    fx = db.query("SELECT * FROM crowd_fixes WHERE id=?", [fix_id])[0]
    if fx["status"] == "proposed" and net >= ACCEPT_VOTES:
        decide(db, fix_id, "accepted", "votes")
    elif fx["status"] == "proposed" and net <= -ACCEPT_VOTES:
        decide(db, fix_id, "rejected", "votes")
    return net


def decide(db, fix_id, status, actor):
    fx = db.query("SELECT * FROM crowd_fixes WHERE id=?", [fix_id])[0]
    db.execute("UPDATE crowd_fixes SET status=?, decided_by=?, decided_ts=? WHERE id=?", [status, actor, now(), fix_id])
    if status == "accepted":     # one accepted value per element/attribute
        db.execute("UPDATE crowd_fixes SET status='superseded', decided_by=?, decided_ts=? WHERE page_id=? AND "
                   "selector=? AND attr=? AND id<>? AND status IN ('proposed','accepted')",
                   [actor, now(), fx["page_id"], fx["selector"], fx["attr"], fix_id])
    audit(db, actor, "fix." + status, fix_id)


def fixes(db, page_id=None, site_id=None):
    q = ("SELECT x.*, COALESCE((SELECT SUM(vote) FROM crowd_votes v WHERE v.fix_id=x.id),0) AS net "
         "FROM crowd_fixes x WHERE 1=1")
    args = []
    if page_id:
        q += " AND x.page_id=?"; args.append(page_id)
    if site_id:
        q += " AND x.site_id=?"; args.append(site_id)
    return db.query(q + " ORDER BY x.ts DESC", args)


def improved_pack(db, site_id):
    """Draft pack from the published repair diffs, with crowd-accepted values layered on top."""
    site = db.query("SELECT * FROM crowd_sites WHERE id=?", [site_id])[0]
    pages = db.query("SELECT * FROM crowd_pages WHERE site_id=?", [site_id])
    pack = remediation.pack_from_pages(site, pages)
    acc = [f for f in fixes(db, site_id=site_id) if f["status"] == "accepted"]
    for f in acc:
        rule = next((r for r in pack["rules"] if r["select"] == f["selector"]), None)
        if rule:
            rule.setdefault("set", {})[f["attr"]] = f["proposed"]
            rule["describe"] += " (crowd-reviewed)"
        else:
            pack["rules"].append({"code": f["code"], "level": remediation._level_for(f["code"]),
                                  "describe": f"{f['code']}: {f['attr']} (crowd-reviewed)", "select": f["selector"],
                                  "set": {f["attr"]: f["proposed"]}})
    pack["note"] = (f"Generated from a crawl; {len(acc)} value(s) reviewed and accepted by the crowd. "
                    "Selectors are page-specific — review before use.")
    return pack
