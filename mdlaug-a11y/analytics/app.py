"""
mDLAUG analytics — a small Streamlit dashboard over the audit database.

Run:
    pip install -r requirements.txt
    streamlit run app.py

Config (either .streamlit/secrets.toml or environment variables):
    TURSO_URL         your Turso database URL (or the relay URL)
    TURSO_AUTH_TOKEN  a Turso token (read-only recommended) or the relay AUTH_KEY
"""
import os

import altair as alt
import streamlit as st

import mdlaug_db as db

st.set_page_config(page_title="mDLAUG analytics", page_icon="📊", layout="wide")


def cfg(key, default=""):
    try:
        if key in st.secrets:
            return st.secrets[key]
    except Exception:
        pass
    return os.environ.get(key, default)


st.title("mDLAUG accessibility analytics")
st.caption("Read-only view of digital-library accessibility audits. Independent project.")

url, token = cfg("TURSO_URL"), cfg("TURSO_AUTH_TOKEN")
if not url or not token:
    st.warning(
        "Set **TURSO_URL** and **TURSO_AUTH_TOKEN** in `.streamlit/secrets.toml` or the "
        "environment. Point them at your Turso database (a read-only token is recommended) "
        "or at your relay URL with its AUTH_KEY. See `analytics/README.md`."
    )
    st.stop()


@st.cache_data(ttl=120, show_spinner="Reading the audit database…")
def load(u, tok):
    return db.fetch_situations(db.Turso(u, tok))


try:
    df = load(url, token)
except Exception as e:  # noqa: BLE001
    st.error(f"Could not read the database: {e}")
    st.stop()

if df.empty:
    st.info("No audits saved yet. Run an audit in the extension and click **Save audit**.")
    st.stop()

names = db.library_names(df)
options = ["All"] + sorted(names)
lib = st.selectbox(
    "Library",
    options,
    format_func=lambda u: "All libraries" if u == "All" else (names.get(u) or u),
)
sub = df if lib == "All" else df[df["dl_url"] == lib]

# headline metrics
c1, c2, c3 = st.columns(3)
c1.metric("Audits", int(sub["assessment_id"].nunique()))
c2.metric("Libraries", int(df["dl_url"].nunique()))
latest = str(sub["created_at"].max() or "")[:10] or "—"
c3.metric("Latest audit", latest)

# compliance by situation
st.subheader("Compliance by situation")
st.caption("Average 1–7 score per help-seeking situation. Bar colour = conformance level.")
g = db.compliance_by_situation(df, lib)
if g.empty:
    st.caption("No scored situations for this selection.")
else:
    bar = (
        alt.Chart(g)
        .mark_bar()
        .encode(
            x=alt.X("avg_score:Q", scale=alt.Scale(domain=[0, 7]), title="average score"),
            y=alt.Y("code:N", sort=list(g["code"]), title=None),
            color=alt.Color(
                "level:N",
                scale=alt.Scale(domain=list(db.LEVEL_COLORS), range=list(db.LEVEL_COLORS.values())),
                title="Level",
            ),
            tooltip=["code", "level", alt.Tooltip("avg_score:Q", format=".2f"), "n"],
        )
        .properties(height=max(200, 24 * len(g)))
    )
    st.altair_chart(bar, use_container_width=True)

# conformance-level rollup
st.subheader("By conformance level")
r = db.level_rollup(df, lib)
lvls = st.columns(3)
for i, lv in enumerate(["A", "AA", "AAA"]):
    row = r[r["level"] == lv]
    lvls[i].metric(f"Level {lv}", f"{row['avg_score'].iloc[0]:.1f}" if not row.empty else "—")

# trend over time
st.subheader("Trend over time")
tr = db.trend_over_time(df, lib)
if len(tr) >= 2:
    line = (
        alt.Chart(tr)
        .mark_line(point=True)
        .encode(
            x=alt.X("created_at:T", title=None),
            y=alt.Y("avg_score:Q", scale=alt.Scale(domain=[1, 7]), title="overall avg"),
            tooltip=[alt.Tooltip("date:N", title="date"), alt.Tooltip("avg_score:Q", format=".2f")],
        )
    )
    st.altair_chart(line, use_container_width=True)
else:
    st.caption("Need at least two audits for this selection to show a trend.")

# weakest situations
if not g.empty:
    st.subheader("Weakest situations (lowest average)")
    weak = g.sort_values("avg_score").head(8)[["code", "level", "avg_score", "n"]]
    st.dataframe(weak, hide_index=True, use_container_width=True)

st.caption("Cached for 2 minutes. Machine-suggested scores are shown as saved; confirmed human scores drive these charts.")
