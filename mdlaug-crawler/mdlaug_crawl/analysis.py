"""Read-side helpers shared by the Streamlit app and the exporter."""
import json
import pandas as pd

from . import scoring


def runs(store):
    return pd.DataFrame(store.query("SELECT * FROM runs ORDER BY id DESC"))


def sites(store):
    return pd.DataFrame(store.query("SELECT * FROM sites"))


def findings(store, run_id):
    df = pd.DataFrame(store.query(
        "SELECT f.*, s.collection_url, s.platform, s.library_type, s.institution, p.url AS page_url, "
        "p.page_type, p.screenshot FROM findings f JOIN sites s ON s.id=f.site_id "
        "LEFT JOIN pages p ON p.id=f.page_id WHERE f.run_id=?", (run_id,)))
    return df


def latest_reviews(store):
    return pd.DataFrame(store.query(
        "SELECT r.* FROM reviews r JOIN (SELECT finding_id, MAX(id) mid FROM reviews GROUP BY finding_id) x "
        "ON x.mid=r.id"))


def site_situation_table(store, run_id, review_conf=0.7):
    """One row per (site, situation): suggested score, final (reviewed) score, flags."""
    f = findings(store, run_id)
    st = sites(store)
    sr = pd.DataFrame(store.query("SELECT * FROM site_reviews WHERE run_id=?", (run_id,)))
    rv = latest_reviews(store)
    if not f.empty and not rv.empty:
        # apply finding-level overrides before aggregating
        f = f.merge(rv[["finding_id", "decision", "score"]].rename(columns={"score": "rscore"}),
                    left_on="id", right_on="finding_id", how="left")
        ov = f["decision"] == "override"
        f.loc[ov, "score"] = f.loc[ov, "rscore"]
        f.loc[f["decision"].isin(["confirm", "override"]), "needs_review"] = 0
        f.loc[f["decision"].isin(["confirm", "override"]), "confidence"] = 1.0
        f = f[f["decision"] != "na"]
    rows = []
    crawled = set(f["site_id"]) if not f.empty else set()
    for _, s in st[st["id"].isin(crawled)].iterrows():
        recs = f[f["site_id"] == s["id"]].to_dict("records") if not f.empty else []
        recs = [dict(r, score=(None if pd.isna(r.get("score")) else int(r["score"]))) for r in recs]
        agg = scoring.aggregate(recs, review_conf)
        for code, a in agg.items():
            final = None
            if not sr.empty:
                m = sr[(sr["site_id"] == s["id"]) & (sr["code"] == code)]
                if len(m):
                    final = int(m.iloc[-1]["final_score"])
            rows.append({"site_id": s["id"], "collection_url": s["collection_url"], "institution": s["institution"],
                         "platform": s["platform"], "library_type": s["library_type"], **a,
                         "final_score": final,
                         "score": final if final is not None else a["suggested_score"],
                         "status": ("reviewed" if final is not None else
                                    "not observed" if a["suggested_score"] is None else
                                    "needs review" if a["needs_review"] else "automated")})
    return pd.DataFrame(rows)


def agreement(store, run_id=None):
    """Reviewer agreement with the pipeline, per check and method — the improvement signal."""
    q = ("SELECT f.code, f.check_id, f.method, f.score AS auto_score, f.confidence, r.decision, r.score AS review_score, "
         "r.issue_tag FROM reviews r JOIN findings f ON f.id=r.finding_id")
    args = ()
    if run_id:
        q += " WHERE f.run_id=?"; args = (run_id,)
    df = pd.DataFrame(store.query(q, args))
    if df.empty:
        return df, df
    df["agree"] = (df["decision"] == "confirm") | ((df["decision"] == "override") &
                                                    (df["review_score"].fillna(-9) - df["auto_score"].fillna(-99)).abs().le(1))
    by = df.groupby(["check_id", "method"]).agg(reviews=("agree", "size"), agreement=("agree", "mean"),
                                                 mean_conf=("confidence", "mean")).reset_index()
    by["abs_error"] = df.assign(err=(df["review_score"] - df["auto_score"]).abs()).groupby(
        ["check_id", "method"])["err"].mean().values
    return df, by.sort_values("agreement")


def agreement_by_prompt(store, code=None):
    """Reviewer agreement for LLM judgments, grouped by prompt version — shows whether a
    prompt/rubric edit actually helped."""
    q = ("SELECT f.code, f.check_id, f.score AS auto_score, f.evidence, r.decision, r.score AS review_score, r.ts "
         "FROM reviews r JOIN findings f ON f.id=r.finding_id WHERE f.method='llm'")
    args = ()
    if code:
        q += " AND f.code=?"; args = (code,)
    df = pd.DataFrame(store.query(q, args))
    if df.empty:
        return df
    df["prompt_version"] = df["evidence"].apply(lambda e: (json.loads(e or "{}") or {}).get("prompt_version") or "unversioned")
    df["agree"] = (df["decision"] == "confirm") | ((df["decision"] == "override") &
                                                    (df["review_score"].fillna(-9) - df["auto_score"].fillna(-99)).abs().le(1))
    return (df.groupby(["code", "check_id", "prompt_version"])
              .agg(reviews=("agree", "size"), agreement=("agree", "mean"), first_seen=("ts", "min"))
              .reset_index().sort_values(["code", "first_seen"]))


def _llm_score(parsed_json, task):
    try:
        d = json.loads(parsed_json or "{}")
    except Exception:
        return None
    if task == "classify_page":
        return d.get("page_type")
    for k in ("score_1_7", "overall_score_1_7"):
        if d.get(k) is not None:
            try:
                return int(d[k])
            except Exception:
                return None
    return None


def model_comparison(store, run_id=None):
    """Pair each original LLM call with its shadow/replay by another model.

    Returns (pairs, summary). summary per (task, model_a, model_b): calls, valid-JSON rates,
    median latency, how often the two agree (scores within 1 point; same page type), and —
    where a reviewer judged the finding — how often each model is within 1 point of the person.
    """
    q = ("SELECT a.id AS a_id, a.task, a.model AS model_a, b.model AS model_b, b.role, a.ok AS a_ok, b.ok AS b_ok, "
         "a.latency_ms AS a_ms, b.latency_ms AS b_ms, a.cached AS a_cached, a.parsed AS a_parsed, b.parsed AS b_parsed "
         "FROM llm_calls b JOIN llm_calls a ON a.id=b.replay_of")
    args = ()
    if run_id:
        q += " WHERE a.run_id=?"; args = (run_id,)
    pairs = pd.DataFrame(store.query(q, args))
    if pairs.empty:
        return pairs, pairs
    a_raw = [_llm_score(p, t) for p, t in zip(pairs.a_parsed, pairs.task)]
    b_raw = [_llm_score(p, t) for p, t in zip(pairs.b_parsed, pairs.task)]

    def agree(x, y):
        if x is None or y is None or (isinstance(x, float) and pd.isna(x)) or (isinstance(y, float) and pd.isna(y)):
            return None
        if isinstance(x, str) or isinstance(y, str):
            return x == y
        return abs(int(x) - int(y)) <= 1
    pairs["models_agree"] = [agree(x, y) for x, y in zip(a_raw, b_raw)]
    # human judgments for LLM findings, linked by the original call id
    hum = {}
    for r in store.query("SELECT f.evidence, f.score AS auto_score, rv.decision, rv.score AS review_score FROM reviews rv "
                         "JOIN findings f ON f.id=rv.finding_id WHERE f.method='llm'"):
        try:
            cid = (json.loads(r["evidence"] or "{}") or {}).get("llm_call")
        except Exception:
            cid = None
        if cid is None or r["decision"] == "na":
            continue
        hum[cid] = r["review_score"] if r["decision"] == "override" else r["auto_score"]
    pairs["human"] = pairs.a_id.map(hum)
    pairs["a_vs_human"] = [agree(x, h) if h is not None and not pd.isna(h) else None for x, h in zip(a_raw, pairs.human)]
    pairs["b_vs_human"] = [agree(x, h) if h is not None and not pd.isna(h) else None for x, h in zip(b_raw, pairs.human)]
    # scores mix numbers (1–7) and page types; store as text so tables serialize cleanly
    pairs["a_score"] = ["" if v is None else str(v) for v in a_raw]
    pairs["b_score"] = ["" if v is None else str(v) for v in b_raw]

    def rate(s):
        s = s.dropna()
        return round(float(s.astype(bool).mean()), 2) if len(s) else None
    rows = []
    for (task, ma, mb), g in pairs.groupby(["task", "model_a", "model_b"]):
        live_a = g[g.a_cached == 0]
        rows.append({"task": task, "model_a": ma, "model_b": mb, "calls": len(g),
                     "a_valid_json": rate(g.a_ok), "b_valid_json": rate(g.b_ok),
                     "a_median_s": round(live_a.a_ms.median() / 1000, 1) if len(live_a) else None,
                     "b_median_s": round(g.b_ms.median() / 1000, 1),
                     "models_agree": rate(g.models_agree),
                     "reviewed": int(g.human.notna().sum()),
                     "a_agrees_with_reviewer": rate(g.a_vs_human), "b_agrees_with_reviewer": rate(g.b_vs_human)})
    return pairs, pd.DataFrame(rows)


STATUS_ORDER = ["complete", "no results", "search failed", "no search found", "failed to load", "not crawled"]


def coverage(store, run_id):
    """Per site: did the crawl reach it, load it, and get a search through? Includes sites NOT crawled."""
    sites_ = pd.DataFrame(store.query("SELECT * FROM sites"))
    if sites_.empty:
        return sites_
    pages = pd.DataFrame(store.query("SELECT site_id, page_type, status, error FROM pages WHERE run_id=?", (run_id,))) \
        if run_id else pd.DataFrame()
    ev = pd.DataFrame(store.query("SELECT site_id, stage, level, message, data, id FROM events WHERE run_id=? AND site_id IS NOT NULL",
                                  (run_id,))) if run_id else pd.DataFrame()
    rows = []
    for s in sites_.to_dict("records"):
        sp = pages[pages.site_id == s["id"]] if not pages.empty else pages
        se = ev[ev.site_id == s["id"]].sort_values("id") if not ev.empty else ev
        pages_ok = int((sp.status == "ok").sum()) if len(sp) else 0
        search, detail = "", ""
        oc = se[se.stage == "search_outcome"] if len(se) else se
        if len(oc):
            d = json.loads(oc.iloc[-1]["data"] or "{}")
            search = {"ok": "ok", "no_results": "no results", "no_search": "no search box",
                      "interaction_failed": "failed", "results_failed": "failed"}.get(d.get("outcome"), d.get("outcome", ""))
            detail = d.get("method", "") if search == "ok" else (d.get("error") or "")[:160]
        elif len(se):                                   # runs from before outcomes were recorded
            msgs = " | ".join(se[se.stage == "search"].message.astype(str))
            if "search interaction failed" in msgs:
                search, detail = "failed", msgs[:160]
            elif "no search input found" in msgs:
                search = "no search box"
            elif len(sp) and (sp.page_type == "results").any():
                search = "ok"
        err = ""
        if len(sp) and (sp.status != "ok").any():
            err = str(sp[sp.status != "ok"].iloc[0].get("error") or sp[sp.status != "ok"].iloc[0]["status"])[:160]
        if not len(sp) and not len(se):
            status = "not crawled"
        elif pages_ok == 0:
            status = "failed to load"
        elif search == "ok":
            status = "complete"
        elif search == "no results":
            status = "no results"
        elif search == "no search box":
            status = "no search found"
        else:
            status = "search failed"
        rows.append({"site_id": s["id"], "active": int(s.get("active") if s.get("active") is not None else 1),
                     "institution": s["institution"], "platform": s["platform"], "library_type": s["library_type"],
                     "collection_url": s["collection_url"], "status": status, "pages_ok": pages_ok,
                     "search": search or "—", "detail": detail or err})
    return pd.DataFrame(rows)
