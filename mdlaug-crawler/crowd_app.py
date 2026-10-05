"""mDLAUG crowd review & remediation — Google login + allowlist, data on Turso.

    pip install -r requirements-crowd.txt
    streamlit run crowd_app.py

Secrets (.streamlit/secrets.toml) — see CROWD.md:
    TURSO_URL, TURSO_TOKEN, and an [auth] block for Google sign-in.
"""
import base64
import io
import json
import os
import sys
from pathlib import Path

import pandas as pd
import streamlit as st

sys.path.insert(0, str(Path(__file__).parent))
from mdlaug_crawl import annotate, crowd, scoring  # noqa: E402
from mdlaug_crawl.store import ISSUE_TAGS  # noqa: E402
from mdlaug_crawl.turso import Turso  # noqa: E402

st.set_page_config(page_title="mDLAUG crowd review", page_icon="🤝", layout="wide")
CODES = [c for c, _ in scoring.SITUATIONS]


def secret(k, default=""):
    try:
        if k in st.secrets:
            return st.secrets[k]
    except Exception:
        pass
    return os.environ.get(k, default)


def _stretch(fn, *a, **kw):
    try:
        return fn(*a, width="stretch", **kw)
    except TypeError:
        return fn(*a, use_container_width=True, **kw)


def show_df(df, **kw):
    return _stretch(st.dataframe, df, **kw)


@st.cache_resource
def get_db(url, token):
    db = Turso(url, token)
    crowd.init(db)
    return db


url, token = secret("TURSO_URL"), secret("TURSO_TOKEN") or secret("TURSO_AUTH_TOKEN")
if not url or not token:
    st.error("Set TURSO_URL and TURSO_TOKEN in .streamlit/secrets.toml (see CROWD.md).")
    st.stop()
db = get_db(url, token)

# ---------------- authentication + allowlist ----------------
dev_user = os.environ.get("MDLAUG_CROWD_DEV_USER")          # local testing only — never set in deployment
if dev_user:
    email = dev_user.lower()
    st.warning(f"Development mode: signed in as {email} without Google. Never enable this on a public server.")
else:
    u = getattr(st, "user", None) or getattr(st, "experimental_user", None)
    if u is None or not hasattr(st, "login"):
        st.error("This Streamlit version has no built-in login. Install streamlit[auth] >= 1.42.")
        st.stop()
    try:
        logged_in = bool(u.is_logged_in)
    except (AttributeError, KeyError):
        logged_in = None                      # no [auth] configured → fail closed, explicitly
    if logged_in is None:
        st.title("mDLAUG crowd review")
        st.error("Google sign-in isn't configured on this server: add an [auth] section to "
                 ".streamlit/secrets.toml (see CROWD.md). Nobody can access the app until it is.")
        st.stop()
    if not logged_in:
        st.title("mDLAUG crowd review")
        st.write("Help review automated accessibility findings for digital libraries and propose fixes. "
                 "Access is by invitation.")
        st.button("Sign in with Google", on_click=st.login, type="primary")
        st.stop()
    email = (u.get("email") if hasattr(u, "get") else getattr(u, "email", "")) or ""
    email = email.lower()
me = crowd.user(db, email)
if not me:
    st.title("Not yet authorized")
    st.write(f"You're signed in as **{email}**, but this address isn't on the reviewer list. "
             "Ask the project administrator to add you.")
    if not dev_user:
        st.button("Sign out", on_click=st.logout)
    st.stop()
is_admin = me["role"] == "admin"

st.sidebar.markdown(f"**{me.get('name') or email}**  \n{me['role']}")
if not dev_user:
    st.sidebar.button("Sign out", on_click=st.logout)
st.sidebar.caption("Findings come from automated crawls of public digital-library pages. Your reviews and fixes "
                   "are recorded with your email.")


# ---------------- helpers ----------------
@st.cache_data(ttl=3600, show_spinner=False)
def image_bytes(page_id, kind):
    r = db.query("SELECT data FROM crowd_images WHERE page_id=? AND kind=?", [page_id, kind])
    return base64.b64decode(r[0]["data"]) if r and r[0]["data"] else None


@st.cache_data(ttl=600, show_spinner=False)
def page_row(page_id):
    r = db.query("SELECT * FROM crowd_pages WHERE id=?", [page_id])
    return r[0] if r else None


def marked(page_id, kind="full", codes=None, items=None, title=None):
    raw = image_bytes(page_id, kind)
    if not raw:
        return None
    p = page_row(page_id) or {}
    try:
        if kind == "full":
            ann = json.loads(p.get("annotations") or "{}")
        else:
            ann = json.loads(p.get("remediation") or "{}").get("annotations") or {}
    except Exception:
        ann = {}
    if items is not None:
        ann = {"meta": ann.get("meta", {}), "items": items}
    try:
        img = annotate.draw(io.BytesIO(raw), ann, codes=codes, title=title)
        buf = io.BytesIO(); img.save(buf, "PNG")
        return buf.getvalue()
    except Exception:
        return raw


def display_name(e):
    return e.split("@")[0]


tabs = ["👁 Review queue", "✍️ Propose fixes", "🏛 Sites", "👥 Contributors"] + (["🔑 Admin"] if is_admin else [])
T = st.tabs(tabs)

# ---------------- review queue ----------------
with T[0]:
    st.header("Review flagged findings")
    st.caption(f"Each flagged finding gets {crowd.TARGET_REVIEWS} independent reviews. Judge it from the page "
               "markup (and the live page if needed): confirm the tool's call, override the score, or mark N/A.")
    c1, c2 = st.columns(2)
    code = c1.selectbox("Situation", [""] + CODES, format_func=lambda c: c or "Any")
    sites = db.query("SELECT id, institution FROM crowd_sites ORDER BY institution")
    smap = {s["id"]: s["institution"] for s in sites}
    site = c2.selectbox("Library", [""] + list(smap), format_func=lambda s: smap.get(s, "Any"))
    q = crowd.queue(db, email, limit=10, code=code or None, site=site or None)
    if not q:
        st.success("Nothing waiting for you here — thank you!")
    for f in q:
        with st.container(border=True):
            a, b = st.columns([3, 2])
            with a:
                st.markdown(f"**{f['code']}** ({f.get('level') or '—'}) · {f['institution']} · "
                            f"[{f.get('page_type') or 'page'}]({f.get('page_url') or f['collection_url']})  \n"
                            f"Tool's call: **{f['outcome']}**" + (f", {f['score']}/7" if f.get('score') is not None else "")
                            + f" · confidence {f.get('confidence')} · {f['n_reviews']} review(s) so far")
                st.write(f.get("message") or "")
                with st.expander("Evidence"):
                    try:
                        st.json(json.loads(f.get("evidence") or "{}"), expanded=False)
                    except Exception:
                        st.code(f.get("evidence") or "")
            with b:
                if f.get("page_id"):
                    img = marked(f["page_id"], codes=[f["code"]])
                    if img:
                        st.image(img, caption=f"marks for {f['code']}")
            with st.form(f"rv_{f['id']}"):
                x1, x2, x3 = st.columns(3)
                dec = x1.radio("Decision", ["confirm", "override", "na"], horizontal=True, key=f"d{f['id']}")
                sc = x2.number_input("Score (if override)", 1, 7, int(f["score"]) if f.get("score") is not None else 4,
                                     key=f"s{f['id']}")
                tag = x3.selectbox("What went wrong (if anything)", ISSUE_TAGS, key=f"t{f['id']}")
                y1, y2 = st.columns([3, 1])
                note = y1.text_input("Note", key=f"n{f['id']}")
                ex = y2.selectbox("Example?", ["", "good", "bad"], key=f"x{f['id']}")
                if st.form_submit_button("Submit review", type="primary"):
                    crowd.add_review(db, f["id"], email, dec, int(sc) if dec == "override" else None, tag, note, ex)
                    st.rerun()

# ---------------- propose fixes ----------------
with T[1]:
    st.header("Propose fixes automation can't write")
    st.caption("Alt text, control names, and labels need a person. Pick a page, choose a marked element, and "
               f"propose wording — {crowd.ACCEPT_VOTES} net votes accept it into the library's improved site pack.")
    sites = db.query("SELECT id, institution FROM crowd_sites ORDER BY institution")
    if not sites:
        st.info("No published crawls yet.")
    else:
        sid = st.selectbox("Library", [s["id"] for s in sites], format_func=lambda i: smap.get(i, i), key="fx_site")
        pgs = db.query("SELECT id, page_type, url FROM crowd_pages WHERE site_id=? ORDER BY id", [sid])
        pid = st.selectbox("Page", [p["id"] for p in pgs], key="fx_page",
                           format_func=lambda i: next(f"{p['page_type']} — {p['url']}" for p in pgs if p["id"] == i))
        prow = page_row(pid)
        targets = crowd.fix_targets(prow) if prow else []
        if not targets:
            st.caption("No elements on this page need written content.")
        else:
            items = [dict(t["box"] or {"x": 0, "y": 0, "w": 0, "h": 0}, code=t["code"], status="review",
                          label=f"{t['attr']}: {t['label']}", source="crowd") for t in targets if t.get("box")]
            img = marked(pid, items=items, title="Elements needing content")
            if img:
                st.image(img, caption="Numbered elements match the list below (top to bottom).")
            existing = crowd.fixes(db, page_id=pid)
            for i, t in enumerate(sorted(targets, key=lambda t: ((t["box"] or {}).get("y", 0), (t["box"] or {}).get("x", 0))), 1):
                mine = [x for x in existing if x["selector"] == t["selector"] and x["attr"] == t["attr"]]
                with st.container(border=True):
                    st.markdown(f"**{i}. {t['code']}** · `<{t['tag']}>` · set **{t['attr']}** — {t['label']}  \n"
                                f"Current: `{t['current'] or '(empty)'}`")
                    for x in mine:
                        cols = st.columns([5, 1, 1, 2])
                        cols[0].markdown(f"“{x['proposed'] or '(decorative — empty alt)'}” — {display_name(x['author'])}"
                                         + (f"  \n_{x['note']}_" if x.get("note") else ""))
                        cols[3].markdown(f"**{x['status']}** · net {x['net']}")
                        if x["status"] == "proposed":
                            if cols[1].button("👍", key=f"up_{x['id']}", help="Vote to accept"):
                                crowd.vote(db, x["id"], email, +1); st.rerun()
                            if cols[2].button("👎", key=f"dn_{x['id']}", help="Vote to reject"):
                                crowd.vote(db, x["id"], email, -1); st.rerun()
                    with st.form(f"fx_{pid}_{i}"):
                        hint = ("Describe what the image conveys here (not 'image of…'). Tick decorative if it adds nothing."
                                if t["attr"] == "alt" else "Short name that matches the visible label and says what it does.")
                        val = st.text_input("Proposed value", help=hint, key=f"v_{pid}_{i}")
                        deco = st.checkbox("Decorative (empty alt)", key=f"dec_{pid}_{i}") if t["attr"] == "alt" else False
                        nt = st.text_input("Why (optional)", key=f"why_{pid}_{i}")
                        if st.form_submit_button("Propose"):
                            if not val.strip() and not deco:
                                st.error("Enter a value (or tick decorative).")
                            else:
                                crowd.propose_fix(db, pid, sid, t, "" if deco else val, email, nt)
                                st.rerun()

# ---------------- sites ----------------
with T[2]:
    st.header("Libraries")
    rows = db.query(
        "SELECT s.id, s.institution, s.platform, s.library_type, "
        "(SELECT COUNT(*) FROM crowd_findings f WHERE f.site_id=s.id AND f.needs_review=1) AS flagged, "
        "(SELECT COUNT(DISTINCT r.finding_id) FROM crowd_reviews r JOIN crowd_findings f2 ON f2.id=r.finding_id "
        " WHERE f2.site_id=s.id) AS reviewed, "
        "(SELECT COUNT(*) FROM crowd_fixes x WHERE x.site_id=s.id AND x.status='accepted') AS fixes_accepted "
        "FROM crowd_sites s ORDER BY s.institution")
    if rows:
        show_df(pd.DataFrame(rows).drop(columns=["id"]), hide_index=True)
        sid = st.selectbox("Open library", [r["id"] for r in rows], format_func=lambda i: smap.get(i, i), key="site_open")
        fs = db.query("SELECT id, code, score, needs_review, confidence FROM crowd_findings WHERE site_id=? AND score IS NOT NULL",
                      [sid])
        cons = crowd.finding_consensus(db, {f["id"] for f in fs})
        recs = []
        for f in fs:
            c = cons.get(f["id"])
            s_ = c["score"] if c and c["state"] == "agreed" and c["decision"] != "na" else f["score"]
            if c and c["state"] == "agreed" and c["decision"] == "na":
                continue
            recs.append({"code": f["code"], "score": s_, "crowd": c["state"] if c else ("—" if not f["needs_review"] else "pending")})
        if recs:
            df = pd.DataFrame(recs).groupby("code").agg(score=("score", "mean"), evidence=("score", "size"),
                                                        crowd=("crowd", lambda x: ", ".join(sorted(set(x))))).reset_index()
            df["score"] = df["score"].round(1)
            show_df(df, hide_index=True)
        pack = crowd.improved_pack(db, sid)
        st.download_button(f"Improved site pack ({len(pack['rules'])} rules)", json.dumps(pack, indent=2).encode(),
                           file_name=f"{pack['id']}.json",
                           help="Engine repairs plus crowd-accepted wording. Paste into the extension: Options → Site packs.")
        for p in db.query("SELECT id, page_type, url FROM crowd_pages WHERE site_id=? ORDER BY id", [sid]):
            with st.expander(f"{p['page_type']} — {p['url']}"):
                a, b = st.columns(2)
                with a:
                    im = marked(p["id"], "full")
                    if im:
                        st.image(im, caption="Before — findings")
                with b:
                    im = marked(p["id"], "after", title="Repairs on this page")
                    if im:
                        st.image(im, caption="After — best-effort repair")

# ---------------- contributors ----------------
with T[3]:
    st.header("Contributors")
    rv = db.query("SELECT reviewer AS who, COUNT(*) AS reviews FROM crowd_reviews GROUP BY reviewer")
    fx = db.query("SELECT author AS who, COUNT(*) AS proposals, SUM(CASE WHEN status='accepted' THEN 1 ELSE 0 END) "
                  "AS accepted FROM crowd_fixes GROUP BY author")
    df = pd.merge(pd.DataFrame(rv or [{"who": None, "reviews": 0}]), pd.DataFrame(fx or [{"who": None, "proposals": 0, "accepted": 0}]),
                  on="who", how="outer").dropna(subset=["who"]).fillna(0)
    if df.empty:
        st.caption("No contributions yet.")
    else:
        df["who"] = df["who"].map(display_name)
        show_df(df.sort_values("reviews", ascending=False), hide_index=True)

# ---------------- admin ----------------
if is_admin:
    with T[4]:
        st.header("Administration")
        with st.form("adduser"):
            st.markdown("**Add or update a reviewer**")
            a1, a2, a3 = st.columns([3, 2, 1])
            ne = a1.text_input("Google account email")
            nn = a2.text_input("Name (optional)")
            nr = a3.selectbox("Role", ["reviewer", "admin"])
            if st.form_submit_button("Save user") and ne.strip():
                crowd.add_user(db, ne, nr, nn, actor=email); st.success(f"Added {ne}"); st.rerun()
        users = db.query("SELECT email, name, role, active, added_by FROM crowd_users ORDER BY email")
        show_df(pd.DataFrame(users), hide_index=True)
        rm = st.selectbox("Deactivate", [""] + [u["email"] for u in users if u["active"] and u["email"] != email])
        if rm and st.button(f"Deactivate {rm}"):
            crowd.deactivate_user(db, rm, actor=email); st.rerun()
        st.subheader("Disputed findings")
        cons = crowd.finding_consensus(db)
        disputed = [fid for fid, c in cons.items() if c["state"] == "disputed"]
        if disputed:
            show_df(pd.DataFrame(db.query(
                "SELECT f.id, f.code, s.institution, f.message FROM crowd_findings f JOIN crowd_sites s ON s.id=f.site_id "
                f"WHERE f.id IN ({','.join('?' * len(disputed))})", disputed)), hide_index=True)
        else:
            st.caption("No disagreements right now.")
        st.subheader("Pending fix proposals")
        pend = [x for x in crowd.fixes(db) if x["status"] == "proposed"]
        for x in pend[:30]:
            c = st.columns([5, 1, 1])
            c[0].markdown(f"**{x['code']}** {x['attr']} → “{x['proposed']}” · net {x['net']} · {display_name(x['author'])}")
            if c[1].button("Accept", key=f"acc_{x['id']}"):
                crowd.decide(db, x["id"], "accepted", email); st.rerun()
            if c[2].button("Reject", key=f"rej_{x['id']}"):
                crowd.decide(db, x["id"], "rejected", email); st.rerun()
        st.subheader("Audit log")
        show_df(pd.DataFrame(db.query("SELECT datetime(ts,'unixepoch') AS time, actor, action, target FROM crowd_audit "
                                      "ORDER BY id DESC LIMIT 200")), hide_index=True)
