"""mDLAUG crawl — analytics, review, and workflow diagnostics.

    pip install -r requirements.txt && playwright install chromium
    streamlit run app.py
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import altair as alt
import pandas as pd
import streamlit as st

sys.path.insert(0, str(Path(__file__).parent))
from mdlaug_crawl import analysis, scoring, sites as S, export, annotate, checks, remediation, bench  # noqa: E402
from mdlaug_crawl.llm import LLM, TASKS  # noqa: E402
from mdlaug_crawl.config import Config  # noqa: E402
from mdlaug_crawl.store import Store, ISSUE_TAGS  # noqa: E402

st.set_page_config(page_title="mDLAUG crawl", page_icon="🔎", layout="wide")
LEVEL_COLORS = {"A": "#1f9e8f", "AA": "#e8912a", "AAA": "#b1315e"}
STATUS_ORDER = ["automated", "reviewed", "needs review", "not observed"]
STATUS_COLORS = ["#1f9e8f", "#12332e", "#e8912a", "#bcccc6"]
CODES = [c for c, _ in scoring.SITUATIONS]


def _stretch(fn, *args, **kw):
    """Full-width rendering on both newer Streamlit (width="stretch") and older
    releases (use_container_width=True)."""
    try:
        return fn(*args, width="stretch", **kw)
    except TypeError:
        return fn(*args, use_container_width=True, **kw)


def show_df(data, **kw):
    return _stretch(st.dataframe, data, **kw)


def show_chart(chart, **kw):
    return _stretch(st.altair_chart, chart, **kw)


@st.cache_data(show_spinner=False)
def render_marks(fullshot, annotations_json, codes=(), statuses=(), include_wcag=False):
    """Annotated screenshot as PNG bytes (cached per filter)."""
    import io
    img = annotate.draw(fullshot, json.loads(annotations_json or "{}"), codes=list(codes) or None,
                        statuses=list(statuses) or None, include_wcag=include_wcag)
    buf = io.BytesIO(); img.save(buf, format="PNG")
    return buf.getvalue()


def txt(v):
    """A usable text value, or None. Database gaps can reach us as None, NaN (pandas),
    or empty strings — e.g. pages crawled before markup existed have no full-page shot."""
    return v if isinstance(v, str) and v.strip() else None


def file_ok(v):
    v = txt(v)
    return v if v and Path(v).exists() else None


def show_marked_page(page_row, codes=(), statuses=(), include_wcag=False, caption=None):
    """Show the annotated full-page shot if we have one, else the plain screenshot."""
    full, ann = file_ok(page_row.get("fullshot")), txt(page_row.get("annotations"))
    if full and ann:
        try:
            st.image(render_marks(full, ann, tuple(codes), tuple(statuses), include_wcag), caption=caption)
            return True
        except Exception as e:  # noqa: BLE001 — a bad image must never break the review screen
            st.caption(f"Couldn't draw markup for this page ({type(e).__name__}); showing the plain screenshot.")
    shot = file_ok(page_row.get("screenshot"))
    if shot:
        st.image(shot, caption=(caption or "") + " (no markup captured)")
        return True
    return False

cfg = Config()
cfg.ensure_dirs()


@st.cache_resource
def get_store(path):
    return Store(path, cfg.logs_dir)


store = get_store(cfg.db_path)

# ---------------- sidebar ----------------
st.sidebar.title("mDLAUG crawl")
runs = analysis.runs(store)
if runs.empty:
    run_id = None
    st.sidebar.info("No runs yet — start one in **Run crawl**.")
else:
    labels = {int(r.id): f"#{r.id} · {time.strftime('%Y-%m-%d %H:%M', time.localtime(r.started))} · {r.status}"
              + (f" · {r.note}" if r.note else "") for r in runs.itertuples()}
    run_id = st.sidebar.selectbox("Run", list(labels), format_func=labels.get)
reviewer = st.sidebar.text_input("Reviewer name", value=st.session_state.get("reviewer", ""), key="reviewer")


@st.cache_data(ttl=30, show_spinner=False)
def installed_models(url):
    return bench.list_models(cfg)


st.sidebar.subheader("Local LLM")
models = installed_models(cfg.ollama_url)
names = [m["name"] for m in models]
saved_a = store.get_setting("llm:model") or cfg.ollama_model
saved_b = store.get_setting("llm:shadow") or ""
if not names:
    st.sidebar.warning(f"Ollama isn't reachable at {cfg.ollama_url} — start it to choose models. "
                       f"Current setting: `{saved_a}`.")
    model_a, model_b = saved_a, saved_b
else:
    label = {m["name"]: f"{m['name']} · {m['params'] or '?'} · {m['size_gb']} GB" for m in models}
    opts_a = names if saved_a in names else [saved_a] + names
    model_a = st.sidebar.selectbox("Model", opts_a, index=opts_a.index(saved_a),
                                   format_func=lambda n: label.get(n, f"{n} (not installed!)"),
                                   help="Used for every LLM judgment in new crawls.")
    opts_b = [""] + [n for n in names if n != model_a]
    model_b = st.sidebar.selectbox("Compare with (optional)", opts_b,
                                   index=opts_b.index(saved_b) if saved_b in opts_b else 0,
                                   format_func=lambda n: label.get(n, "— none —") if n else "— none —",
                                   help="A second model to test against the first. See Workflow → Model comparison.")
    if model_a not in names:
        st.sidebar.error(f"`{model_a}` isn't installed in Ollama — pick another or `ollama pull {model_a}`.")
    if model_a != store.get_setting("llm:model"):
        store.set_setting("llm:model", model_a, reviewer or "")
    if model_b != (store.get_setting("llm:shadow") or ""):
        store.set_setting("llm:shadow", model_b, reviewer or "")
cfg.ollama_model = model_a
st.sidebar.caption(f"Using **{model_a}**" + (f", comparing with **{model_b}**" if model_b else "") +
                   f"  \nDB: `{cfg.db_path}`")

tab_over, tab_list, tab_sites, tab_review, tab_checks, tab_flow, tab_run = st.tabs(
    ["📊 Overview", "🗂 Site list", "🏛 Sites", "👁 Review queue", "⚙ Checks", "🛠 Workflow & logs", "▶ Run crawl"])


def table():
    return analysis.site_situation_table(store, run_id, cfg.review_confidence) if run_id else pd.DataFrame()


# ---------------- overview ----------------
with tab_over:
    st.header("mDLAUG conformance across digital libraries")
    t = table()
    if t.empty:
        st.info("No results for this run yet.")
    else:
        pages = pd.DataFrame(store.query("SELECT * FROM pages WHERE run_id=?", (run_id,)))
        nsites = t["site_id"].nunique()
        ok_sites = pages[pages.status == "ok"]["site_id"].nunique() if not pages.empty else 0
        st_counts = t["status"].value_counts()
        c = st.columns(5)
        c[0].metric("Sites crawled", nsites)
        c[1].metric("Pages analysed", int((pages.status == "ok").sum()) if not pages.empty else 0)
        c[2].metric("Sites loaded OK", f"{ok_sites}/{nsites}")
        scored = t["score"].notna().sum()
        c[3].metric("Situation scores", f"{scored}/{len(t)}")
        c[4].metric("Need a person", int(st_counts.get("needs review", 0) + st_counts.get("not observed", 0)))

        st.subheader("What the tool determined vs. what needs a person")
        st.caption("Per situation, across sites: **automated** = high-confidence determination; **needs review** = "
                   "suggested but flagged; **not observed** = no evidence (feature absent or not reached); "
                   "**reviewed** = a person set the final score.")
        sc = t.groupby(["code", "status"]).size().reset_index(name="sites")
        show_chart(alt.Chart(sc).mark_bar().encode(
            x=alt.X("sites:Q", stack="normalize", title="share of sites"),
            y=alt.Y("code:N", sort=CODES, title=None),
            color=alt.Color("status:N", scale=alt.Scale(domain=STATUS_ORDER, range=STATUS_COLORS)),
            tooltip=["code", "status", "sites"]).properties(height=520))

        st.subheader("Average score by situation and platform")
        hm = t.dropna(subset=["score"]).groupby(["code", "platform"]).agg(score=("score", "mean"), n=("score", "size")).reset_index()
        if not hm.empty:
            show_chart(alt.Chart(hm).mark_rect().encode(
                x=alt.X("platform:N", title=None), y=alt.Y("code:N", sort=CODES, title=None),
                color=alt.Color("score:Q", scale=alt.Scale(domain=[1, 7], scheme="redyellowgreen"), title="avg 1–7"),
                tooltip=["code", "platform", alt.Tooltip("score:Q", format=".1f"), "n"]).properties(height=520))
        col1, col2 = st.columns(2)
        with col1:
            st.subheader("By library type")
            ht = t.dropna(subset=["score"]).groupby(["code", "library_type"]).agg(score=("score", "mean"), n=("score", "size")).reset_index()
            if not ht.empty:
                show_chart(alt.Chart(ht).mark_rect().encode(
                    x=alt.X("library_type:N", title=None), y=alt.Y("code:N", sort=CODES, title=None),
                    color=alt.Color("score:Q", scale=alt.Scale(domain=[1, 7], scheme="redyellowgreen"), title="avg"),
                    tooltip=["code", "library_type", alt.Tooltip("score:Q", format=".1f"), "n"]).properties(height=480))
        with col2:
            st.subheader("Weakest situations")
            w = t.dropna(subset=["score"]).groupby(["code", "level"]).agg(avg=("score", "mean"), sites=("score", "size")).reset_index()
            show_chart(alt.Chart(w).mark_bar().encode(
                x=alt.X("avg:Q", scale=alt.Scale(domain=[0, 7]), title="average 1–7"),
                y=alt.Y("code:N", sort="x", title=None),
                color=alt.Color("level:N", scale=alt.Scale(domain=list(LEVEL_COLORS), range=list(LEVEL_COLORS.values()))),
                tooltip=["code", "level", alt.Tooltip("avg:Q", format=".2f"), "sites"]).properties(height=480))

        st.subheader("Sites ranked")
        st.caption("Average situation score per library, with how much of it is settled automatically vs. "
                   "waiting on a person. Open a site in the Sites tab for its marked-up pages and repair preview.")
        rk = (t.assign(auto=t["status"].eq("automated"), pending=t["status"].isin(["needs review", "not observed"]))
               .groupby(["site_id", "institution", "platform", "library_type"])
               .agg(avg=("score", "mean"), scored=("score", "count"), automated=("auto", "sum"), pending=("pending", "sum"))
               .reset_index().sort_values("avg"))
        rk["avg"] = rk["avg"].round(1)
        show_df(rk.drop(columns=["site_id"]), hide_index=True)

        st.subheader("Site overall scores by platform")
        so = t.dropna(subset=["score"]).groupby(["site_id", "institution", "platform"]).agg(avg=("score", "mean")).reset_index()
        if not so.empty:
            show_chart(alt.Chart(so).mark_boxplot(extent="min-max").encode(
                x=alt.X("platform:N", title=None), y=alt.Y("avg:Q", scale=alt.Scale(domain=[1, 7]), title="site average")))

        st.subheader("WCAG baseline (axe-core, WCAG 2.2 A/AA rules)")
        ax = store.query("SELECT f.site_id, f.evidence FROM findings f WHERE f.run_id=? AND f.method='axe'", (run_id,))
        rows = []
        for a in ax:
            for v in json.loads(a["evidence"] or "{}").get("violations", []):
                rows.append({"site_id": a["site_id"], "rule": v["id"], "impact": v.get("impact") or "", "help": v.get("help", "")})
        if rows:
            ad = pd.DataFrame(rows).drop_duplicates(["site_id", "rule"]).groupby(["rule", "impact", "help"]).size().reset_index(name="sites")
            show_df(ad.sort_values("sites", ascending=False).head(25), hide_index=True)

        st.subheader("Export")
        out = Path(cfg.logs_dir).parent / f"mdlaug_run_{run_id}.xlsx"
        if st.button("Build Excel export"):
            export.export_xlsx(store, run_id, str(out), cfg.review_confidence)
        if out.exists():
            st.download_button("Download Excel", out.read_bytes(), file_name=out.name)
        st.download_button("Download site × situation CSV", t.to_csv(index=False).encode(), file_name=f"mdlaug_run_{run_id}.csv")

# ---------------- site list ----------------
COV_COLORS = ["#1f9e8f", "#9cc9a0", "#e8912a", "#d6b656", "#b1315e", "#bcccc6"]
with tab_list:
    st.header("Which sites are evaluated")
    cov = analysis.coverage(store, run_id)
    if cov.empty:
        st.info("No sites yet — add some below or import the spreadsheet.")
    else:
        act = cov[cov.active == 1]
        c = st.columns(6)
        c[0].metric("Sites in list", len(cov))
        c[1].metric("Switched on", len(act))
        for i, k in enumerate(["complete", "search failed", "failed to load", "not crawled"], 2):
            c[i].metric(k.capitalize() if run_id else k, int((act.status == k).sum()))
        if run_id:
            st.caption(f"Status for run #{run_id}. **complete** = loaded and a search returned results; "
                       "**search failed** = loaded but the search couldn't be used (see detail); "
                       "**no search found** = no search box detected; **not crawled** = not part of this run.")
            show_chart(alt.Chart(act.groupby(["platform", "status"]).size().reset_index(name="sites")).mark_bar().encode(
                x=alt.X("sites:Q", stack="zero"), y=alt.Y("platform:N", title=None),
                color=alt.Color("status:N", scale=alt.Scale(domain=analysis.STATUS_ORDER, range=COV_COLORS)),
                tooltip=["platform", "status", "sites"]).properties(height=220))
        f1, f2, f3 = st.columns(3)
        fs = f1.multiselect("Status", analysis.STATUS_ORDER, key="cov_status")
        fp = f2.multiselect("Platform", sorted(cov.platform.dropna().unique()), key="cov_plat")
        fq = f3.text_input("Search name / URL", key="cov_q")
        v = cov.copy()
        if fs: v = v[v.status.isin(fs)]
        if fp: v = v[v.platform.isin(fp)]
        if fq: v = v[v.institution.str.contains(fq, case=False, na=False) | v.collection_url.str.contains(fq, case=False, na=False)]
        v = v.assign(active=v.active.astype(bool))
        edited = st.data_editor(v[["active", "institution", "platform", "library_type", "status", "pages_ok", "search",
                                   "detail", "collection_url", "site_id"]], hide_index=True, key="site_editor",
                                disabled=["institution", "platform", "library_type", "status", "pages_ok", "search",
                                          "detail", "collection_url", "site_id"],
                                column_config={"active": st.column_config.CheckboxColumn("on", help="Include in crawls"),
                                               "collection_url": st.column_config.LinkColumn("URL")})
        changed = edited[edited.active != v.active.values]
        if len(changed) and st.button(f"Save {len(changed)} on/off change(s)"):
            for r in changed.itertuples():
                store.set_site_active(int(r.site_id), bool(r.active))
            st.rerun()
        if run_id:
            failed = act[act.status.isin(["search failed", "failed to load", "no results", "no search found"])]
            if len(failed) and st.button(f"Re-crawl the {len(failed)} site(s) that didn't complete in run #{run_id}"):
                logf = Path(cfg.logs_dir) / f"console-{int(time.time())}.log"
                subprocess.Popen([sys.executable, "-m", "mdlaug_crawl", "run", "--retry-failed", str(run_id),
                                  "--note", f"retry of run {run_id}"], cwd=str(Path(__file__).parent),
                                 env=dict(os.environ, OLLAMA_MODEL=cfg.ollama_model), stdout=open(logf, "w"),
                                 stderr=subprocess.STDOUT)
                st.session_state["console"] = str(logf)
                st.success("Started — follow it on the Run crawl tab.")

    st.subheader("Add sites")
    known_plat = sorted({x for x in (cov.platform.dropna().unique() if not cov.empty else []) if x})
    known_type = sorted({x for x in (cov.library_type.dropna().unique() if not cov.empty else []) if x})
    a1, a2 = st.columns(2)
    with a1.form("add_one", clear_on_submit=True):
        st.markdown("**One site**")
        u = st.text_input("Collection URL", placeholder="https://digital.example.edu/")
        inst = st.text_input("Institution")
        pl = st.selectbox("Platform", known_plat + ["Other"]) if known_plat else st.text_input("Platform")
        if pl == "Other":
            pl = st.text_input("Platform name")
        ty = st.selectbox("Library type", known_type + ["Other"]) if known_type else st.text_input("Library type")
        if st.form_submit_button("Add site"):
            new, bad = S.parse_bulk(u, pl, ty)
            if bad or not new:
                st.error("That doesn't look like a web address.")
            else:
                if inst: new[0]["institution"] = inst
                store.upsert_site(new[0]); st.success(f"Added {new[0]['collection_url']}"); st.rerun()
    with a2.form("add_bulk", clear_on_submit=True):
        st.markdown("**Several at once** — one per line: `URL, institution, platform, library type` "
                    "(only the URL is required)")
        bulk_text = st.text_area("Sites", height=140, placeholder="https://digital.example.edu/, Example University, DSpace, Academic library")
        dp = st.text_input("Default platform (optional)")
        if st.form_submit_button("Add all"):
            new, bad = S.parse_bulk(bulk_text, dp)
            for x in new:
                store.upsert_site(x)
            st.success(f"Added/updated {len(new)} site(s)." + (f" Skipped {len(bad)} line(s) that weren't URLs." if bad else ""))
            if new: st.rerun()
    up = st.file_uploader("…or import a spreadsheet (same columns as the DL list)", type=["xlsx"], key="sheet_up")
    if up:
        sheet_path = Path(cfg.logs_dir).parent / "uploaded_sites.xlsx"
        sheet_path.write_bytes(up.getvalue())
        sites_ = S.dedupe_sites(S.load_sheet(sheet_path))
        if st.button(f"Import {len(sites_)} site(s) from the spreadsheet"):
            for x in sites_:
                store.upsert_site(x)
            st.success("Imported."); st.rerun()

# ---------------- sites ----------------
with tab_sites:
    t = table()
    if t.empty:
        st.info("No results yet.")
    else:
        opts = t.drop_duplicates("site_id").sort_values("institution")
        sid = st.selectbox("Site", opts["site_id"], format_func=lambda i: f"{opts.set_index('site_id').loc[i, 'institution']} — "
                                                                         f"{opts.set_index('site_id').loc[i, 'collection_url']}")
        sub = t[t.site_id == sid].copy()
        info = sub.iloc[0]
        st.markdown(f"**{info.institution}** · {info.platform} · {info.library_type} · [{info.collection_url}]({info.collection_url})")
        show = sub[["code", "level", "suggested_score", "final_score", "status", "confidence", "evidence_count", "methods"]]
        show_df(show, hide_index=True)
        with st.form(f"final_{sid}"):
            st.markdown("**Set final scores** (the reviewed 1–7 for each situation)")
            cols = st.columns(6)
            vals = {}
            for i, r in enumerate(sub.itertuples()):
                default = r.final_score if pd.notna(r.final_score) else (r.suggested_score if pd.notna(r.suggested_score) else 0)
                vals[r.code] = cols[i % 6].number_input(r.code, 0, 7, int(default), key=f"fs_{sid}_{r.code}",
                                                        help="0 = not applicable / leave unset")
            if st.form_submit_button("Save final scores"):
                if not reviewer:
                    st.error("Enter a reviewer name in the sidebar.")
                else:
                    for code, v in vals.items():
                        if v:
                            store.set_site_score(run_id, sid, code, reviewer, int(v))
                    st.success("Saved.")
        pg = pd.DataFrame(store.query("SELECT * FROM pages WHERE run_id=? AND site_id=?", (run_id, sid)))
        st.subheader("Pages visited")
        if not pg.empty:
            show_df(pg[["page_type", "type_method", "type_confidence", "status", "http_status", "load_ms", "final_url", "error"]],
                         hide_index=True)
            st.subheader("Marked-up pages")
            st.caption("Green = done well · red = issue found · amber = needs review. Numbers match the key beside "
                       "each page. Marks come from the engine, the probes, and the LLM (shown in brackets).")
            m1, m2, m3 = st.columns([3, 2, 1])
            fcodes = m1.multiselect("Only these situations", CODES, key=f"mk_codes_{sid}")
            fstat = m2.multiselect("Only these statuses", ["good", "issue", "review"], key=f"mk_stat_{sid}")
            fw = m3.checkbox("WCAG extras", key=f"mk_w_{sid}", help="also show target-size marks (2.5.8)")
            for p in pg.to_dict("records"):
                with st.expander(f"{txt(p.get('page_type')) or 'page'} — {txt(p.get('final_url')) or txt(p.get('url')) or ''}",
                                 expanded=(p.get("page_type") in ("home", "results"))):
                    if not show_marked_page(p, fcodes, fstat, fw):
                        st.caption("No screenshot for this page.")
        st.subheader("Repairs (best effort)")
        st.caption("What the engine changes when it repairs each page: left, the findings; right, the page with "
                   "fixes applied — teal = changed element, purple = added element (screen-reader-only additions are "
                   "made visible for review). Every change is listed with its before → after markup.")
        rp = [p for p in (pg.to_dict("records") if not pg.empty else []) if txt(p.get("remediation"))]
        if not rp:
            st.caption("No repair preview for this run yet — re-crawl the site to capture one.")
        else:
            d1, d2 = st.columns(2)
            if d1.button("Build repair report (zip)", key=f"rep_{sid}"):
                outz = Path(cfg.logs_dir).parent / f"repair_run{run_id}_site{sid}.zip"
                remediation.site_report(store, run_id, int(sid), str(outz))
                st.session_state[f"repzip_{sid}"] = str(outz)
            zp = st.session_state.get(f"repzip_{sid}")
            if zp and Path(zp).exists():
                d1.download_button("Download report", Path(zp).read_bytes(), file_name=Path(zp).name, key=f"dlrep_{sid}")
            pack = remediation.draft_pack(store, run_id, int(sid))
            d2.download_button(f"Draft site pack ({len(pack['rules'])} rules)", json.dumps(pack, indent=2).encode(),
                               file_name=f"{pack['id']}.json", key=f"pack_{sid}",
                               help="Paste into the extension: Options → Site packs. Review selectors and names first.")
            for p in rp:
                d = json.loads(p["remediation"])
                with st.expander(f"{txt(p.get('page_type')) or 'page'} — {len(d.get('changed', []))} changed, "
                                 f"{len(d.get('inserted', []))} added", expanded=p.get("page_type") == "home"):
                    a, b = st.columns(2)
                    with a:
                        st.markdown("**Before**")
                        show_marked_page(p)
                    with b:
                        st.markdown("**After repair**")
                        if file_ok(p.get("aftershot")):
                            st.image(render_marks(p["aftershot"], json.dumps(d.get("annotations", {}))))
                        else:
                            st.caption("No after-repair screenshot for this page.")
                    if d.get("changed"):
                        show_df(pd.DataFrame([{"situation": ", ".join(c.get("codes") or []), "selector": c["selector"],
                                               "change": "; ".join(f"{x['attr']}: {x['before']} → {x['after']}" for x in c["diff"]),
                                               "before": c["before_tag"], "after": c["after_tag"]} for c in d["changed"]]),
                                hide_index=True)
                    if d.get("inserted"):
                        show_df(pd.DataFrame([{"kind": x["kind"], "where": x["where"], "markup": x["html"]}
                                              for x in d["inserted"]]), hide_index=True)

        st.subheader("Findings")
        fd = pd.DataFrame(store.query("SELECT f.*, p.page_type FROM findings f LEFT JOIN pages p ON p.id=f.page_id "
                                      "WHERE f.run_id=? AND f.site_id=? ORDER BY f.code", (run_id, sid)))
        for r in fd.itertuples():
            with st.expander(f"{r.code} · {r.check_id} · {r.outcome}" + (f" · {int(r.score)}/7" if pd.notna(r.score) else "")
                             + (" · ⚑ review" if r.needs_review else "")):
                st.write(r.message)
                st.caption(f"method: {r.method} · confidence {r.confidence} · page: {r.page_type}")
                st.json(json.loads(r.evidence or "{}"), expanded=False)

# ---------------- review queue ----------------
with tab_review:
    if not run_id:
        st.info("No run selected.")
    else:
        q = pd.DataFrame(store.query(
            "SELECT f.*, s.institution, s.platform, s.collection_url, p.final_url, p.page_type, p.screenshot, "
            "p.fullshot, p.annotations "
            "FROM findings f JOIN sites s ON s.id=f.site_id LEFT JOIN pages p ON p.id=f.page_id "
            "WHERE f.run_id=? AND f.needs_review=1 AND f.id NOT IN (SELECT finding_id FROM reviews)", (run_id,)))
        total = store.query("SELECT COUNT(*) n FROM findings WHERE run_id=? AND needs_review=1", (run_id,))[0]["n"]
        done = total - len(q)
        st.progress(done / total if total else 1.0, text=f"{done} of {total} flagged findings reviewed")
        if q.empty:
            st.success("Review queue is empty for this run.")
        else:
            f1, f2, f3 = st.columns(3)
            codes = f1.multiselect("Situation", sorted(q.code.unique()))
            methods = f2.multiselect("Method", sorted(q.method.unique()))
            plats = f3.multiselect("Platform", sorted(q.platform.unique()))
            if codes: q = q[q.code.isin(codes)]
            if methods: q = q[q.method.isin(methods)]
            if plats: q = q[q.platform.isin(plats)]
            q = q.sort_values(["confidence", "code"]).head(25)
            st.caption("Lowest-confidence first. Confirm the pipeline's call, override the score, or mark N/A; tag what went "
                       "wrong so the workflow can be improved.")
            for r in q.itertuples():
                with st.container(border=True):
                    a, b = st.columns([3, 2])
                    with a:
                        st.markdown(f"**{r.code}** · `{r.check_id}` · {r.method} · conf {r.confidence}  \n"
                                    f"{r.institution} ({r.platform}) — [{r.page_type or 'page'}]({r.final_url or r.collection_url})")
                        st.write(r.message)
                        st.json(json.loads(r.evidence or "{}"), expanded=False)
                    with b:
                        allm = st.checkbox("show all marks", key=f"all_{r.id}")
                        show_marked_page({"fullshot": r.fullshot, "annotations": r.annotations, "screenshot": r.screenshot},
                                         () if allm else (r.code,), caption=None if allm else f"marks for {r.code}")
                    with st.form(f"rv_{r.id}"):
                        c1, c2, c3 = st.columns(3)
                        dec = c1.radio("Decision", ["confirm", "override", "na"], horizontal=True, key=f"d{r.id}")
                        sc_ = c2.number_input("Score (if override)", 1, 7, int(r.score) if pd.notna(r.score) else 4, key=f"s{r.id}")
                        tag = c3.selectbox("Issue tag", ISSUE_TAGS, key=f"t{r.id}")
                        e1, e2 = st.columns([3, 2])
                        note = e1.text_input("Note", key=f"n{r.id}")
                        ex = e2.selectbox("Use as an example?", ["", "good", "bad"], key=f"x{r.id}",
                                          help="Good/bad examples appear on the Checks page and calibrate the LLM "
                                               "for this situation.")
                        if st.form_submit_button("Save review"):
                            if not reviewer:
                                st.error("Enter a reviewer name in the sidebar.")
                            else:
                                store.add_review(int(r.id), reviewer, dec, int(sc_) if dec == "override" else None, tag, note, ex)
                                store.log(run_id, "review", f"{dec} {r.code} {r.check_id}", site_id=int(r.site_id),
                                          data={"finding": int(r.id), "tag": tag})
                                st.rerun()

# ---------------- checks ----------------
with tab_checks:
    st.header("What the tool does for each situation")
    st.caption(f"Starter heuristics written for this tool — not the mDLAUG team's official criteria (see "
               f"[the guidelines]({checks.GUIDELINES_URL})). Edit the rubric, review guidance, and LLM prompt; every "
               "change is versioned, and the Workflow tab compares reviewer agreement across prompt versions.")
    cat = checks.merged(store)
    fs_on = store.get_setting("fewshot:enabled", "1") == "1"
    newfs = st.toggle("Calibrate the LLM with reviewer examples (few-shot)", value=fs_on,
                      help="Adds up to 4 reviewer-marked good/bad examples for the situation to its LLM prompt.")
    if newfs != fs_on:
        store.set_setting("fewshot:enabled", "1" if newfs else "0", reviewer or "")
    code = st.selectbox("Situation", CODES, format_func=lambda c: f"{c} — {cat[c]['title']}")
    c = cat[code]
    st.markdown(f"**{code} · Level {scoring.LEVEL[code]}** — {c['title']}")
    st.info(c["question"])
    left, right = st.columns([3, 2])
    with left:
        st.markdown("**Determined automatically**")
        for a in c["auto"]:
            st.markdown(f"- {a}")
        if code in scoring.ALWAYS_REVIEW:
            st.warning("Always routed to a person — automated evidence can't settle this one.")
        with st.form(f"chk_{code}"):
            rub = st.text_area("Starter rubric (what 7 / 4 / 1 look like)", c["rubric"], height=140)
            rev = st.text_area("Review guidance (how a person checks it)", c["review"], height=110)
            instr = None
            if c.get("llm"):
                base = TASKS[c["llm"]]["instruction"]
                cur = store.get_setting("prompt:" + c["llm"]) or base
                instr = st.text_area(f"LLM instruction — task `{c['llm']}`", cur, height=110,
                                     help="The rubric above and any reviewer examples are appended automatically.")
            b1, b2 = st.columns(2)
            if b1.form_submit_button("Save", type="primary"):
                store.set_setting("check:" + code, json.dumps({"rubric": rub, "review": rev}), reviewer or "")
                if instr is not None:
                    if instr.strip() == TASKS[c["llm"]]["instruction"].strip():
                        store.delete_setting("prompt:" + c["llm"], reviewer or "")
                    else:
                        store.set_setting("prompt:" + c["llm"], instr, reviewer or "")
                st.success("Saved. New crawls use it; the prompt version changes so results can be compared.")
                st.rerun()
            if b2.form_submit_button("Reset to defaults"):
                store.delete_setting("check:" + code, reviewer or "")
                if c.get("llm"):
                    store.delete_setting("prompt:" + c["llm"], reviewer or "")
                st.rerun()
        if c.get("llm"):
            with st.expander("Preview the full prompt Qwen receives"):
                prompt, pv = LLM(cfg, store).build_prompt(c["llm"], {"example": "…page evidence goes here…"})
                st.caption(f"prompt version `{pv}`")
                st.code(prompt)
    with right:
        st.markdown("**This run**")
        t = table()
        if not t.empty:
            sub = t[t.code == code]
            st.dataframe(sub["status"].value_counts().rename_axis("status").reset_index(name="sites"), hide_index=True)
            if sub["score"].notna().any():
                st.metric("Average score", f"{sub['score'].mean():.1f} / 7")
        raw, by = analysis.agreement(store)
        if not by.empty:
            mine = raw[raw.code == code]
            if len(mine):
                st.markdown("**Reviewer agreement (all runs)**")
                show_df(mine.groupby(["check_id", "method"]).agg(reviews=("agree", "size"), agreement=("agree", "mean"))
                        .reset_index(), hide_index=True)
        pv = analysis.agreement_by_prompt(store, code)
        if not pv.empty:
            st.markdown("**By prompt version**")
            show_df(pv[["check_id", "prompt_version", "reviews", "agreement"]], hide_index=True)
    st.subheader("Reviewer examples")
    st.caption("Mark findings as good/bad examples in the Review queue. They build a reference set of what "
               "different libraries do for this situation — and calibrate the LLM when few-shot is on.")
    ex = store.exemplars(code, limit=6)
    if not ex:
        st.caption("No examples yet for this situation.")
    for e in ex:
        with st.container(border=True):
            st.markdown(f"**{e['exemplar'].upper()}** · {e['institution']} · score {e['review_score'] or e['auto_score']}"
                        f" · `{e['check_id']}`  \n{e['message'] or ''}" + (f"  \n_Reviewer:_ {e['note']}" if e.get("note") else ""))
            if e.get("page_id"):
                pr = store.query("SELECT fullshot, annotations, screenshot FROM pages WHERE id=?", (e["page_id"],))
                if pr:
                    show_marked_page(pr[0], (code,))
    hist = pd.DataFrame(store.query("SELECT key, updated_by, datetime(updated,'unixepoch') AS updated "
                                    "FROM settings_history ORDER BY id DESC LIMIT 30"))
    if not hist.empty:
        with st.expander("Settings change history"):
            show_df(hist, hide_index=True)

# ---------------- workflow & logs ----------------
with tab_flow:
    if not run_id:
        st.info("No run selected.")
    else:
        st.header("Workflow diagnostics")
        pg = pd.DataFrame(store.query("SELECT * FROM pages WHERE run_id=?", (run_id,)))
        if not pg.empty:
            c = st.columns(4)
            c[0].metric("Page loads", len(pg))
            c[1].metric("Failed/blocked", int((pg.status != "ok").sum()))
            c[2].metric("Median load (s)", f"{pg.load_ms.median() / 1000:.1f}" if pg.load_ms.notna().any() else "—")
            c[3].metric("LLM-classified pages", int((pg.type_method == "llm").sum()))
            st.subheader("Load outcomes")
            show_df(pg.groupby("status").size().reset_index(name="pages"), hide_index=True)
            bad = pg[pg.status != "ok"][["site_id", "url", "status", "http_status", "error"]]
            if not bad.empty:
                show_df(bad, hide_index=True)
            st.subheader("Page classification")
            show_df(pg.groupby(["page_type", "type_method"]).agg(pages=("id", "size"), mean_conf=("type_confidence", "mean"))
                         .reset_index(), hide_index=True)
        ll = pd.DataFrame(store.query("SELECT * FROM llm_calls WHERE run_id=?", (run_id,)))
        st.subheader("LLM calls")
        if ll.empty:
            st.caption("No LLM calls in this run (LLM disabled or unreachable — affected checks were routed to review).")
        else:
            agg = ll.groupby("task").agg(calls=("id", "size"), ok_rate=("ok", "mean"), cached=("cached", "mean"),
                                         p50_ms=("latency_ms", "median"),
                                         p95_ms=("latency_ms", lambda s: s.quantile(0.95))).reset_index()
            show_df(agg, hide_index=True)
            fails = ll[ll.ok == 0][["task", "error", "raw"]].head(20)
            if not fails.empty:
                st.markdown("**Unparseable / failed outputs** (prompt or model candidates for improvement)")
                show_df(fails, hide_index=True)
        st.subheader("Model comparison")
        st.caption("Each pair is the same prompt answered by two models. 'agrees with reviewer' only counts "
                   "findings a person has reviewed — the most meaningful column once you have some.")
        pairs, cmp_ = analysis.model_comparison(store, run_id)
        if not cmp_.empty:
            ma, mb = cmp_.model_a.iloc[0], cmp_.model_b.iloc[0]
            k1, k2 = st.columns(2)
            with k1:
                st.markdown("**Speed** — median seconds per judgment")
                sp = pd.concat([cmp_[["task", "a_median_s"]].rename(columns={"a_median_s": "s"}).assign(model=ma),
                                cmp_[["task", "b_median_s"]].rename(columns={"b_median_s": "s"}).assign(model=mb)])
                show_chart(alt.Chart(sp.dropna()).mark_bar().encode(
                    y=alt.Y("task:N", title=None), x=alt.X("s:Q", title="seconds"), yOffset="model:N",
                    color=alt.Color("model:N", legend=alt.Legend(orient="bottom")),
                    tooltip=["task", "model", "s"]).properties(height=260))
            with k2:
                st.markdown("**Agreement** — share of judgments the two models agree on")
                ag = cmp_[["task", "models_agree"]].assign(what="with each other")
                if cmp_.reviewed.sum():
                    ag = pd.concat([ag,
                                    cmp_[["task", "a_agrees_with_reviewer"]].rename(columns={"a_agrees_with_reviewer": "models_agree"}).assign(what=f"{ma} vs reviewer"),
                                    cmp_[["task", "b_agrees_with_reviewer"]].rename(columns={"b_agrees_with_reviewer": "models_agree"}).assign(what=f"{mb} vs reviewer")])
                show_chart(alt.Chart(ag.dropna()).mark_bar().encode(
                    y=alt.Y("task:N", title=None), x=alt.X("models_agree:Q", scale=alt.Scale(domain=[0, 1]), title="share"),
                    yOffset="what:N", color=alt.Color("what:N", legend=alt.Legend(orient="bottom", title=None)),
                    tooltip=["task", "what", alt.Tooltip("models_agree:Q", format=".0%")]).properties(height=260))
            num = pairs[pairs.task != "classify_page"].copy()
            num["a"] = pd.to_numeric(num.a_score, errors="coerce"); num["b"] = pd.to_numeric(num.b_score, errors="coerce")
            num = num.dropna(subset=["a", "b"])
            if len(num):
                k3, k4 = st.columns(2)
                with k3:
                    st.markdown(f"**Who scores higher?** — average {ma} − {mb} (positive = {ma} more lenient)")
                    bias = num.assign(d=num.a - num.b).groupby("task").agg(diff=("d", "mean"), n=("d", "size")).reset_index()
                    show_chart(alt.Chart(bias).mark_bar().encode(
                        y=alt.Y("task:N", title=None), x=alt.X("diff:Q", title="points on the 1–7 scale"),
                        color=alt.condition("datum.diff > 0", alt.value("#e8912a"), alt.value("#1f9e8f")),
                        tooltip=["task", alt.Tooltip("diff:Q", format=".2f"), "n"]).properties(height=220))
                with k4:
                    tk = st.selectbox("Score pairs for", sorted(num.task.unique()), key="cmp_task")
                    grid = num[num.task == tk].groupby(["a", "b"]).size().reset_index(name="n")
                    base_ = alt.Chart(grid).encode(x=alt.X("a:O", title=ma), y=alt.Y("b:O", title=mb, sort="descending"))
                    show_chart((base_.mark_rect().encode(color=alt.Color("n:Q", title="judgments", scale=alt.Scale(scheme="tealblues")),
                                                         tooltip=["a", "b", "n"]) +
                                base_.mark_text(fontSize=11).encode(text="n:Q")).properties(height=220))
                    st.caption("Cells on the diagonal = same score. Off-diagonal cells show where they differ.")
            cl = pairs[pairs.task == "classify_page"]
            if len(cl):
                st.markdown("**Page-type classification** — where the models disagree")
                cm = cl.groupby(["a_score", "b_score"]).size().reset_index(name="n")
                b2 = alt.Chart(cm).encode(x=alt.X("a_score:N", title=ma), y=alt.Y("b_score:N", title=mb))
                show_chart((b2.mark_rect().encode(color=alt.Color("n:Q", scale=alt.Scale(scheme="tealblues"), title="pages"),
                                                  tooltip=["a_score", "b_score", "n"]) +
                            b2.mark_text(fontSize=11).encode(text="n:Q")).properties(height=240))
            show_df(cmp_, hide_index=True)
            with st.expander("Disagreements between the two models"):
                dis = pairs[pairs.models_agree == False][["task", "model_a", "a_score", "model_b", "b_score", "human"]]  # noqa: E712
                show_df(dis.head(100), hide_index=True)
        n_replayable = store.query("SELECT COUNT(*) n FROM llm_calls WHERE run_id=? AND prompt IS NOT NULL "
                                   "AND COALESCE(role,'primary')='primary'", (run_id,))[0]["n"]
        if model_b:
            st.markdown(f"Replay this run's **{n_replayable}** stored prompts with **{model_b}** — one model in memory "
                        "at a time, so it's the gentlest way to compare on a laptop. Already-replayed prompts are skipped.")
            if st.button(f"Replay with {model_b}", disabled=not n_replayable):
                logf = Path(cfg.logs_dir) / f"replay-{int(time.time())}.log"
                subprocess.Popen([sys.executable, "-m", "mdlaug_crawl", "bench", "--model", model_b, "--run", str(run_id)],
                                 cwd=str(Path(__file__).parent), env=dict(os.environ), stdout=open(logf, "w"),
                                 stderr=subprocess.STDOUT)
                st.session_state["replay_log"] = str(logf)
            rl = st.session_state.get("replay_log")
            if rl and Path(rl).exists():
                st.button("Refresh progress", key="rl_refresh")
                st.code(Path(rl).read_text()[-1500:] or "(starting…)")
        else:
            st.caption("Pick a second model under **Compare with** in the sidebar to compare.")
        if not n_replayable:
            st.caption("This run has no stored prompts to replay (runs from before this update didn't keep them) — "
                       "crawl a few sites again.")

        st.subheader("Reviewer agreement by check")
        raw, by = analysis.agreement(store, run_id)
        if by.empty:
            st.caption("No reviews yet. Agreement appears here as reviewers work the queue — low-agreement checks are "
                       "the ones to improve first.")
        else:
            show_df(by, hide_index=True)
            tags = raw[raw.issue_tag.fillna("") != ""].groupby(["issue_tag", "check_id"]).size().reset_index(name="count")
            if not tags.empty:
                st.markdown("**Issue tags from reviewers**")
                show_df(tags.sort_values("count", ascending=False), hide_index=True)
        pvall = analysis.agreement_by_prompt(store)
        if not pvall.empty:
            st.subheader("LLM agreement by prompt version")
            st.caption("When a prompt or rubric is edited on the Checks page, its version changes — compare rows.")
            show_df(pvall[["code", "check_id", "prompt_version", "reviews", "agreement"]], hide_index=True)
        st.subheader("Event log")
        ev = pd.DataFrame(store.query("SELECT e.*, s.collection_url FROM events e LEFT JOIN sites s ON s.id=e.site_id "
                                      "WHERE e.run_id=? ORDER BY e.id DESC LIMIT 5000", (run_id,)))
        if not ev.empty:
            l1, l2 = st.columns(2)
            lv = l1.multiselect("Level", sorted(ev.level.unique()), default=[x for x in ("warn", "error") if x in set(ev.level)])
            sg = l2.multiselect("Stage", sorted(ev.stage.unique()))
            v = ev
            if lv: v = v[v.level.isin(lv)]
            if sg: v = v[v.stage.isin(sg)]
            v = v.assign(time=pd.to_datetime(v.ts, unit="s"))
            show_df(v[["time", "level", "stage", "collection_url", "message", "duration_ms", "data"]],
                         hide_index=True)
            jl = Path(cfg.logs_dir) / f"run-{run_id}.jsonl"
            if jl.exists():
                st.download_button("Download run log (JSONL)", jl.read_bytes(), file_name=jl.name)

# ---------------- run ----------------
with tab_run:
    st.header("Crowd review (Turso)")
    turl, ttok = os.environ.get("TURSO_URL"), os.environ.get("TURSO_TOKEN") or os.environ.get("TURSO_AUTH_TOKEN")
    if not (turl and ttok):
        st.caption("Set TURSO_URL and TURSO_TOKEN in the environment to publish runs for crowd review (see CROWD.md).")
    elif run_id:
        from mdlaug_crawl import crowd
        from mdlaug_crawl.turso import Turso
        cA, cB = st.columns(2)
        if cA.button(f"Publish run #{run_id} for crowd review"):
            bar = st.progress(0.0, text="uploading screenshots…")
            res = crowd.publish(store, Turso(turl, ttok), run_id,
                                progress=lambda i, n: bar.progress(i / max(1, n), text=f"page {i}/{n}"))
            st.success(f"Published: {res}")
        if cB.button("Pull crowd decisions into this database"):
            st.success(f"Imported {crowd.pull(store, Turso(turl, ttok))} agreed crowd decision(s).")
    st.header("Run a crawl")
    st.caption("Crawls run as a background process; this page just launches and tails them. Mobile emulation "
               "(iPhone 13) by default, since mDLAUG targets mobile use.")
    allsites = store.query("SELECT * FROM sites")
    if not allsites:
        st.info("Add sites on the **Site list** tab first.")
    else:
        known = pd.DataFrame(allsites)
        c1, c2 = st.columns(2)
        plats = c1.multiselect("Platforms", sorted(known.platform.dropna().unique()))
        types = c2.multiselect("Library types", sorted(known.library_type.dropna().unique()))
        c3, c4, c5 = st.columns(3)
        limit = c3.number_input("Max sites (0 = all)", 0, 1000, 0)
        use_llm = c4.checkbox("Use LLM (Ollama)", value=cfg.llm_enabled)
        desktop = c5.checkbox("Desktop viewport", value=False)
        chosen = S.select(allsites, plats, types, limit=int(limit))
        off = sum(1 for x in allsites if x.get("active") is not None and int(x["active"]) == 0)
        st.markdown(f"**This crawl will evaluate {len(chosen)} site(s)**" +
                    (f" — {off} switched-off site(s) excluded" if off else ""))
        with st.expander("See exactly which"):
            show_df(pd.DataFrame(chosen)[["institution", "platform", "library_type", "collection_url"]] if chosen
                    else pd.DataFrame(), hide_index=True)
        st.markdown(f"LLM: **{model_a}** (change in the sidebar)")
        shadow_live = st.checkbox(f"Also run **{model_b}** on every judgment during this crawl", value=False,
                                  disabled=not (model_b and use_llm),
                                  help="Live side-by-side: roughly doubles LLM time, and on a laptop with limited "
                                       "memory Ollama may swap models each call. Usually better: crawl with one "
                                       "model, then replay with the second (Workflow → Model comparison).")
        note = st.text_input("Run note", value="")
        if st.button("Start crawl", type="primary", disabled=not chosen):
            cmd = [sys.executable, "-m", "mdlaug_crawl", "run", "--limit", str(limit), "--note", note]
            for p in plats: cmd += ["--platform", p]
            for t_ in types: cmd += ["--type", t_]
            if not use_llm: cmd.append("--no-llm")
            if desktop: cmd.append("--desktop")
            env = dict(os.environ, OLLAMA_MODEL=model_a,
                       MDLAUG_SHADOW_MODEL=model_b if (shadow_live and model_b) else "")
            logf = Path(cfg.logs_dir) / f"console-{int(time.time())}.log"
            subprocess.Popen(cmd, cwd=str(Path(__file__).parent), env=env, stdout=open(logf, "w"), stderr=subprocess.STDOUT)
            st.session_state["console"] = str(logf)
            st.success(f"Started. Console: {logf.name}")
    if st.session_state.get("console"):
        lf = Path(st.session_state["console"])
        if st.button("Refresh console"):
            pass
        if lf.exists():
            st.code(lf.read_text()[-4000:] or "(starting…)")
