"""Open reviewer — anyone with the link can look at the findings and say what they think.

No sign-in: reviewers identify themselves in the sidebar. Their reviews are stored as
self-reported ("open" channel) and kept separate from invited reviewers' results — they
never count toward consensus, aren't pulled into the local database unless asked
(`crowd pull --include-open`), and can't accept fixes.

    streamlit run review_app.py          (needs TURSO_URL and TURSO_TOKEN in secrets/env)
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
from mdlaug_crawl import annotate, checks, crowd, scoring  # noqa: E402
from mdlaug_crawl.turso import Turso  # noqa: E402

st.set_page_config(page_title="mDLAUG open review", page_icon="🔍", layout="wide")
CODES = [c for c, _ in scoring.SITUATIONS]
SESSION_CAP = 300          # submissions per browser session
MAX_TEXT = 2000
DECISIONS = {"Yes — the tool got this right": "confirm", "No — it should be scored differently": "override",
             "Doesn't apply to this page": "na", "Not sure": "unsure"}


def secret(k, default=""):
    try:
        if k in st.secrets:
            return st.secrets[k]
    except Exception:
        pass
    return os.environ.get(k, default)


def clip(t, n=MAX_TEXT):
    return (t or "").strip()[:n]


@st.cache_resource
def get_db(url, token):
    db = Turso(url, token)
    crowd.init(db)
    return db


url, token = secret("TURSO_URL"), secret("TURSO_TOKEN") or secret("TURSO_AUTH_TOKEN")
if not url or not token:
    st.error("This reviewer isn't connected to a database yet (TURSO_URL / TURSO_TOKEN).")
    st.stop()
db = get_db(url, token)


@st.cache_data(ttl=3600, show_spinner=False)
def image_bytes(page_id, kind):
    r = db.query("SELECT data FROM crowd_images WHERE page_id=? AND kind=?", [page_id, kind])
    return base64.b64decode(r[0]["data"]) if r and r[0]["data"] else None


@st.cache_data(ttl=600, show_spinner=False)
def page_row(page_id):
    r = db.query("SELECT * FROM crowd_pages WHERE id=?", [page_id])
    return r[0] if r else None


def marked(page_id, kind="full", codes=None, title=None):
    raw = image_bytes(page_id, kind)
    if not raw:
        return None
    p = page_row(page_id) or {}
    try:
        ann = json.loads(p.get("annotations") or "{}") if kind == "full" else \
            (json.loads(p.get("remediation") or "{}").get("annotations") or {})
        img = annotate.draw(io.BytesIO(raw), ann, codes=codes, title=title)
        buf = io.BytesIO(); img.save(buf, "PNG")
        return buf.getvalue()
    except Exception:
        return raw


# ---------------- who are you (self-reported) ----------------
st.sidebar.header("About you")
st.sidebar.caption("There's no sign-in. Tell us who you are so the team can follow up — this is shown to the "
                   "project team with your reviews. Please don't include anything private.")
name = st.sidebar.text_input("Your name *", key="me_name", max_chars=80)
affil = st.sidebar.text_input("Organization / role", key="me_affil", max_chars=120,
                              placeholder="e.g. library web developer, UVA")
email = st.sidebar.text_input("Email (optional)", key="me_email", max_chars=120)
about = st.sidebar.text_area("Notes about you", key="me_about", max_chars=600, height=110,
                             placeholder="e.g. I use VoiceOver daily on iPhone; I reviewed on a laptop with NVDA.")
identity = {"name": clip(name, 80), "affiliation": clip(affil, 120), "email": clip(email, 120),
            "about": clip(about, 600), "self_reported": True}
reviewer_key = "open:" + identity["name"].lower() if identity["name"] else ""
st.session_state.setdefault("n_submits", 0)
if reviewer_key:
    st.sidebar.success(f"Reviewing as **{identity['name']}** · {st.session_state['n_submits']} submitted this session")
else:
    st.sidebar.warning("Add your name to submit reviews.")


def can_submit():
    if not reviewer_key:
        st.error("Please add your name in the sidebar first.")
        return False
    if st.session_state["n_submits"] >= SESSION_CAP:
        st.error("Thanks — that's the limit for one session. Reload the page to continue.")
        return False
    return True


T = st.tabs(["ℹ️ How it works", "🔍 Review findings", "🏛 Browse libraries", "📝 Notes for the team"])

with T[0]:
    st.title("Help check an accessibility tool")
    st.markdown(
        "An automated tool visited digital library websites the way a phone user would and checked them against "
        "the **mDLAUG** guidelines for blind and visually impaired users "
        f"([about the guidelines]({checks.GUIDELINES_URL})). Some of its calls are uncertain, and that's where "
        "people help.\n\n"
        "**Review findings** shows one finding at a time: what the tool decided, why, and a screenshot with the "
        "relevant parts marked — green for done well, red for an issue, amber for needs review. Tell us whether "
        "it got it right. **Browse libraries** shows each page before and after the tool's automatic repairs. "
        "**Notes for the team** is for anything else.\n\n"
        "Your reviews are recorded as self-reported and kept separate from the project team's own review; "
        "they help us see where the tool goes wrong.")
    n_f = db.query("SELECT COUNT(*) AS n FROM crowd_findings WHERE needs_review=1")[0]["n"]
    n_s = db.query("SELECT COUNT(*) AS n FROM crowd_sites")[0]["n"]
    n_o = db.query("SELECT COUNT(*) AS n FROM crowd_reviews WHERE channel='open'")[0]["n"]
    c = st.columns(3)
    c[0].metric("Libraries", n_s); c[1].metric("Findings needing a person", n_f); c[2].metric("Open reviews so far", n_o)

with T[1]:
    sites = db.query("SELECT id, institution FROM crowd_sites ORDER BY institution")
    smap = {s["id"]: s["institution"] for s in sites}
    f1, f2 = st.columns(2)
    code = f1.selectbox("Situation", [""] + CODES,
                        format_func=lambda c: f"{c} — {checks.CATALOG[c]['title']}" if c else "Any")
    site = f2.selectbox("Library", [""] + list(smap), format_func=lambda s: smap.get(s, "Any"))
    q = crowd.queue(db, reviewer_key or "open:anonymous", limit=5, code=code or None, site=site or None,
                    target=3, channels=crowd.OPEN)
    if not q:
        st.success("Nothing left to review with these filters — thank you!")
    for f in q:
        cat = checks.CATALOG.get(f["code"], {})
        with st.container(border=True):
            a, b = st.columns([3, 2])
            with a:
                st.subheader(f"{f['code']} — {cat.get('title', '')}")
                st.markdown(f"**The question:** {cat.get('question', '')}  \n"
                            f"**Library:** {f['institution']} — [{f.get('page_type') or 'page'}]"
                            f"({f.get('page_url') or f['collection_url']})")
                st.markdown(f"**The tool's call:** {f['outcome']}" +
                            (f" ({f['score']} out of 7)" if f.get("score") is not None else "") +
                            f" — {f.get('message') or ''}")
                with st.expander("How a person would check this"):
                    st.write(cat.get("review", ""))
                    st.caption("Scoring guide: " + cat.get("rubric", "").replace("\n", " · "))
            with b:
                if f.get("page_id"):
                    img = marked(f["page_id"], codes=[f["code"]])
                    if img:
                        st.image(img, caption=f"Marks for {f['code']} on this page")
            with st.form(f"o_{f['id']}"):
                choice = st.radio("Is the tool right?", list(DECISIONS), key=f"c_{f['id']}")
                score = st.slider("If not, what score would you give? (1 = blocks users, 7 = fully works)",
                                  1, 7, int(f["score"]) if f.get("score") is not None else 4, key=f"s_{f['id']}")
                comment = st.text_area("Why? (optional)", key=f"m_{f['id']}", max_chars=MAX_TEXT, height=80)
                fix = st.text_input("Suggest a fix (optional) — e.g. better alt text or a button name",
                                    key=f"x_{f['id']}", max_chars=300)
                if st.form_submit_button("Submit", type="primary") and can_submit():
                    dec = DECISIONS[choice]
                    crowd.add_review(db, f["id"], reviewer_key, dec, score if dec == "override" else None, "",
                                     clip(comment), "", channel="open", identity=identity)
                    if clip(fix):
                        crowd.add_feedback(db, "Suggested fix: " + clip(fix, 300), reviewer_key, identity, "open",
                                           f["site_id"], f.get("page_id"), f["id"])
                    st.session_state["n_submits"] += 1
                    st.rerun()

with T[2]:
    rows = db.query("SELECT s.id, s.institution, s.platform, s.library_type, "
                    "(SELECT COUNT(*) FROM crowd_findings f WHERE f.site_id=s.id AND f.needs_review=1) AS needs_a_person "
                    "FROM crowd_sites s ORDER BY s.institution")
    if not rows:
        st.info("No libraries published yet.")
    else:
        st.dataframe(pd.DataFrame(rows).drop(columns=["id"]), hide_index=True)
        sid = st.selectbox("Open a library", [r["id"] for r in rows], format_func=lambda i: smap.get(i, i))
        for p in db.query("SELECT id, page_type, url FROM crowd_pages WHERE site_id=? ORDER BY id", [sid]):
            with st.expander(f"{p['page_type']} — {p['url']}"):
                l, r = st.columns(2)
                im = marked(p["id"], "full")
                if im:
                    l.image(im, caption="Before — what the tool found")
                im = marked(p["id"], "after", title="Repairs on this page")
                if im:
                    r.image(im, caption="After — the tool's automatic repairs")

with T[3]:
    st.header("Notes for the team")
    st.caption("Anything else: something the tool missed, a library we should include, how it felt to use. "
               "Your name and notes from the sidebar are included.")
    with st.form("feedback", clear_on_submit=True):
        lib = st.selectbox("About a particular library? (optional)", [""] + list(smap),
                           format_func=lambda s: smap.get(s, "— general —"))
        text = st.text_area("Your note", max_chars=MAX_TEXT, height=160)
        if st.form_submit_button("Send note") and can_submit():
            if not clip(text):
                st.error("Write a note first.")
            else:
                crowd.add_feedback(db, clip(text), reviewer_key, identity, "open", lib or None)
                st.session_state["n_submits"] += 1
                st.success("Thank you — the team will see it.")
