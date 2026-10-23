"""Which accessibility differences between vendors (platform) and institution types
(library_type) can we assert from automated crawl data alone?

Usage:  python scripts/significance.py [--db data/mdlaug_crawl.db] [--run N] [--replicate 1]
                                       [--out data/significance]

Design choices (see the report for the reasoning):
* Unit of analysis = site. Primary sample = one run in one configuration (default: the
  latest finished run). A second run in a different configuration (default run 1, the
  desktop crawl) is the replication sample: a group difference that holds on another
  device and an older crawler version is not an artifact of either.
* Vendor comparisons use only sites whose own markup confirms the platform (the crawler's
  fingerprint); a site listed under one vendor whose pages carry another vendor's markers is
  moved there. Sites the fingerprint can't verify (custom front ends, other software such as
  Preservica or Primo) are left out of vendor tests but kept in the library-type tests.
* Only "automatable" evidence is used: deterministic methods (axe, engine, probe),
  confidence >= 0.7, not flagged for review, and not an always-review situation.
  LLM judgments and review-flagged probes are dropped from the claims and listed
  as manual-review candidates instead.
* Three families of measures: the home page (every site has one), overlays met on load
  (measured before they are dismissed), and the results page (only sites whose search
  reached results; reach itself is reported, not claimed, because bot checks decide it).
* Permutation tests (Kruskal-Wallis H for counts/scores, chi-square for yes/no), a
  stratified version (permute platform within library type and vice versa), and for
  platform a version without Digital Commons, so a vendor effect is neither an
  institution-mix effect nor carried by one vendor. Benjamini-Hochberg FDR across every test.
* Tiers are computed, not hand-assigned: "assert" needs FDR q < .05, p < .05 within the
  other factor, robustness without Digital Commons (unless the finding is about Digital
  Commons alone), and the same group ordering in the replication run (Spearman ρ ≥ .6)
  or, where the replication run has no such measure, q < .01.
"""
import argparse
import json
import os
import re
import sqlite3
from collections import defaultdict

import numpy as np
import pandas as pd
from scipy import stats

RNG = np.random.default_rng(20261022)
N_PERM = int(os.environ.get("SIG_PERM", "5000"))      # lower it for a quick look
ALWAYS_REVIEW = {"USE1", "ACC3/COM4", "FIL3/HEP1", "RED4"}
AUTO_METHODS = {"axe", "engine", "probe"}
SIX = ["CONTENTdm", "DSpace", "Digital commons", "Islandora", "Omeka", "Samvera"]
GENERIC_SOFTWARE = {"", "WordPress", "Drupal"}       # a CMS under the repository, not a different vendor
MIN_RULE_SITES = 10                                   # axe rules failing on fewer sites aren't tested
# Bot-check pages the crawler's detector missed in earlier runs (same phrasings it now recognises):
# such a "home page" is the challenge, not the site, so the site is left out of that run.
CHALLENGE_RE = re.compile(r"just a moment|performing security verification|verify(?:ing)? (?:that )?you are (?:a )?human|"
                          r"human verification|are you a robot|pardon our interruption|(?:not|aren'?t) a (?:ro)?bot|"
                          r"failed the browser check|\bsecurity check\b|making sure you'?re not a bot", re.I)


# ---------------------------------------------------------------- data

def load(db):
    con = sqlite3.connect(db)
    q = lambda s, a=(): pd.read_sql_query(s, con, params=a)
    cols = {r[1] for r in con.execute("PRAGMA table_info(pages)")}
    extra = ", ".join(c for c in ("overlays", "fingerprint") if c in cols)
    sites = q("SELECT id site_id, platform AS listed_platform, library_type, institution, collection_url FROM sites")
    pages = q("SELECT id page_id, run_id, site_id, page_type, status, final_url, title" + (", " + extra if extra else "") + " FROM pages")
    for c in ("overlays", "fingerprint"):
        if c not in pages:
            pages[c] = None
    f = q("SELECT id, run_id, site_id, page_id, code, check_id, method, outcome, score, confidence, "
          "needs_review, message, evidence FROM findings")
    ev = q("SELECT id, run_id, site_id, data FROM events WHERE stage='search_outcome'")
    runs = q("SELECT id, status, note, config FROM runs")
    vis = q("SELECT page_id, data FROM events WHERE stage='visit' AND page_id IS NOT NULL")
    heads = vis.groupby("page_id").data.first().map(lambda d: " ".join(jl(d).get("headings") or []))
    pages["headings"] = pages.page_id.map(heads).fillna("")
    return sites, pages, f, ev, runs


def automatable(f):
    return f[f.method.isin(AUTO_METHODS) & (f.confidence >= 0.7) & (f.needs_review == 0)
             & ~f.code.isin(ALWAYS_REVIEW)]


def jl(s):
    try:
        return json.loads(s or "{}") or {}
    except Exception:
        return {}


def platform_labels(run, sites, pages):
    """Vendor label per site, checked against the fingerprint of its own markup (latest run first).
    `platform` is set only when the markup confirms the vendor (or clearly shows another of the six,
    in which case the site is moved there); vendor comparisons use only these verified sites.
    `platform_listed` is the spreadsheet label with those corrections, for descriptive tables."""
    hp = pages[(pages.page_type == "home") & pages.fingerprint.notna()].sort_values("run_id", ascending=False)
    fp = hp.groupby("site_id").fingerprint.first().map(jl)
    out = []
    for s in sites.itertuples():
        d = fp.get(s.site_id, {})
        det, conf = d.get("platform", ""), d.get("confidence", "none")
        listed = s.listed_platform
        if det in SIX and det == listed:
            plat, check = det, "confirmed"
        elif det in SIX and conf == "high":
            plat, check, listed = det, f"relabeled (listed {s.listed_platform})", det
        elif det and det not in SIX and det not in GENERIC_SOFTWARE:
            plat, check = None, f"other software: {det}"
        elif not d:
            plat, check = None, "not fingerprinted"
        else:
            plat, check = None, "unverified" + (f" ({det})" if det else "")
        out.append({"site_id": s.site_id, "platform": plat, "platform_listed": listed, "platform_check": check,
                    "fingerprint": det})
    return pd.DataFrame(out)


def overlay_rows(hf, run_home_pages):
    """Per site: overlays met on the home page, from probe.overlay (new) or probe.dialog_escape (legacy)."""
    rows = defaultdict(dict)
    new = hf[(hf.check_id == "probe.overlay") & (hf.code == "INT1")]
    for _, r in new.iterrows():
        e = jl(r.evidence)
        if not e.get("home", True) or e.get("kind") == "backdrop":
            continue
        d = rows[r.site_id]
        crit = e.get("criteria", {})
        d["overlay_on_load"] = 1
        d["consent_overlay_on_load"] = max(d.get("consent_overlay_on_load", 0), int(e.get("kind") == "consent"))
        d["overlay_escape_fails"] = max(d.get("overlay_escape_fails", 0), int(not e.get("escape_closes")))
        # a criterion is None when it couldn't be observed (closed shadow root): unknown, not a failure
        d["overlay_no_named_dismiss"] = max(d.get("overlay_no_named_dismiss", 0), int(crit.get("named_dismiss_control") is False))
        d["overlay_not_exposed_as_dialog"] = max(d.get("overlay_not_exposed_as_dialog", 0), int(crit.get("exposed_as_dialog") is False))
        d["overlay_not_reachable_by_tab"] = max(d.get("overlay_not_reachable_by_tab", 0), int(crit.get("keyboard_reachable") is False))
        d.setdefault("_cmp", set()).add(e.get("cmp") or e.get("kind"))
    legacy = hf[hf.check_id == "probe.dialog_escape"]
    for _, r in legacy[legacy.code == "INT1"].iterrows():
        e = jl(r.evidence)
        d = rows[r.site_id]
        d["overlay_on_load"] = int((e.get("before") or {}).get("open", 0) > 0)
        d["overlay_escape_fails"] = int((e.get("open_after_escape") or 0) > 0)
    has_new = len(new) > 0 or len(legacy) == 0
    for sid in run_home_pages:
        d = rows[sid]
        d.setdefault("overlay_on_load", 0)
        d.setdefault("overlay_escape_fails", 0)
        if has_new:
            for k in ("consent_overlay_on_load", "overlay_no_named_dismiss", "overlay_not_exposed_as_dialog",
                      "overlay_not_reachable_by_tab"):
                d.setdefault(k, 0)
        d["overlay_kinds"] = ", ".join(sorted(d.pop("_cmp", set())))
    return rows


def site_metrics(run, sites, pages, f, ev, labels):
    """One row per site crawled in `run` with a loaded home page."""
    pr = pages[pages.run_id == run]
    fr = f[f.run_id == run].merge(pages[["page_id", "page_type"]], on="page_id", how="left")
    hp = pr[(pr.page_type == "home") & (pr.status == "ok")]
    hp = hp[~(hp.title.fillna("") + " " + hp.headings).str.contains(CHALLENGE_RE)]
    home = hp.sort_values("page_id").groupby("site_id").page_id.first()
    rows = {sid: {"site_id": sid} for sid in home.index}
    hf = fr[fr.page_id.isin(home.values)]
    auto = automatable(hf)

    # -- home page
    rules = defaultdict(set)
    for _, r in hf[hf.check_id == "axe.wcag22aa"].iterrows():
        v = jl(r.evidence).get("violations", [])
        d = rows[r.site_id]
        d["axe_rules_violated"] = len({x["id"] for x in v})
        d["axe_failing_elements"] = sum(int(x.get("nodes") or 0) for x in v)
        for x in v:
            rules[x["id"]].add(r.site_id)
    for _, r in hf[hf.check_id == "probe.target_size"].iterrows():
        rows[r.site_id]["small_targets_2.5.8"] = jl(r.evidence).get("small_targets")
    for _, r in hf[hf.check_id == "probe.mobile_reflow"].iterrows():
        e = jl(r.evidence)
        if e.get("vw") and e["vw"] < 600:      # only meaningful on a phone viewport
            rows[r.site_id]["reflow_fail_1.4.10"] = int(r.outcome != "pass")
    for _, r in hf[hf.check_id == "probe.search_present"].iterrows():
        e = jl(r.evidence)
        d = rows[r.site_id]
        d["search_in_landmark"] = int(bool(e.get("in_search_landmark")))
        d["search_placeholder_only"] = int(bool(e.get("placeholder_only")))
    for (sid, code), g in auto[auto.method == "engine"].groupby(["site_id", "code"]):
        w = g.confidence.clip(lower=0.1)
        rows[sid][f"mdlaug_{code}"] = float((g.score * w).sum() / w.sum())

    # -- overlays met on load
    for sid, d in overlay_rows(hf, home.index).items():
        if sid in rows:
            rows[sid].update(d)

    # -- search outcome (last event per site) and the results page
    evr = ev[ev.run_id == run].sort_values("id")
    for sid, g in evr.groupby("site_id"):
        if sid not in rows:
            continue
        outs = [jl(x) for x in g.data]
        last = outs[-1]
        ui = next((o for o in outs if o.get("method") != "url"), last)
        rows[sid]["search_outcome"] = last.get("outcome")
        rows[sid]["search_method"] = last.get("method")
        rows[sid]["search_ui_outcome"] = ui.get("outcome")
        rows[sid]["search_reached_results"] = int(last.get("outcome") == "ok")
        rows[sid]["search_bot_challenge"] = int(any(o.get("outcome") == "bot_challenge" for o in outs))
    res_pages = pr[(pr.page_type == "results") & (pr.status == "ok")]
    rf = fr[fr.page_id.isin(res_pages.page_id)]
    for sid, g in rf.groupby("site_id"):
        if sid not in rows or not rows[sid].get("search_reached_results"):
            continue
        d = rows[sid]
        for _, r in g.iterrows():
            e = jl(r.evidence)
            if r.check_id == "probe.results_status" and r.outcome != "unknown":
                d["results_count_announced"] = int(r.outcome == "pass")
            elif r.check_id == "probe.results_structure":
                d["results_list_semantics"] = int(bool(e.get("items_semantic_list")))
            elif r.check_id == "probe.pagination":
                d["pagination_landmark"] = int(bool(e.get("pagination_landmark")))
                d["pagination_current_page"] = int(bool(e.get("aria_current")))
            elif r.check_id == "probe.reach_results":
                d["focus_or_skip_to_results"] = int(r.outcome == "pass")
            elif r.check_id == "axe.wcag22aa":
                d["results_axe_rules_violated"] = len({x["id"] for x in e.get("violations", [])})

    # -- crawler QA: vision check of the home screenshots
    for sid, pid in home.items():
        o = jl(pr.loc[pr.page_id == pid, "overlays"].iloc[0])
        v = o.get("vision") or {}
        fv, ad = v.get("first_view") or {}, v.get("after_dismissal") or {}
        if fv.get("_ok"):
            rows[sid]["qa_vision_first_view_overlay"] = int(bool(fv.get("overlay_visible")) and (fv.get("confidence") or 0) >= 0.7)
        if ad.get("_ok"):
            rows[sid]["qa_vision_residual_overlay"] = int(bool(ad.get("overlay_visible")) and (ad.get("confidence") or 0) >= 0.7)

    df = pd.DataFrame(rows.values()).merge(sites, on="site_id").merge(labels, on="site_id", how="left")
    for rid, ss in rules.items():
        df[f"axe:{rid}"] = df.site_id.isin(ss).astype(int)
    return df


# ---------------------------------------------------------------- statistics

def _codes(g):
    return np.unique(g, return_inverse=True)[1]


def kw_h(y, g):
    """Kruskal-Wallis H with tie correction; g = integer codes."""
    r = stats.rankdata(y)
    n = len(y)
    k = g.max() + 1
    cnt = np.bincount(g, minlength=k)
    sr = np.bincount(g, weights=r, minlength=k)
    m = cnt > 0
    h = 12 / (n * (n + 1)) * (sr[m] ** 2 / cnt[m]).sum() - 3 * (n + 1)
    _, t = np.unique(y, return_counts=True)
    c = 1 - (t ** 3 - t).sum() / (n ** 3 - n)
    return h / c if c > 0 else 0.0


def chi2_stat(y, g):
    """Pearson chi-square for a binary y across groups g (integer codes)."""
    k = g.max() + 1
    n1 = np.bincount(g, weights=y, minlength=k)
    n = np.bincount(g, minlength=k).astype(float)
    m = n > 0
    p = y.mean()
    if p in (0, 1):
        return 0.0
    e1, e0 = n[m] * p, n[m] * (1 - p)
    return float(((n1[m] - e1) ** 2 / e1 + ((n[m] - n1[m]) - e0) ** 2 / e0).sum())


def perm_p(stat, y, g, strata=None, n_perm=N_PERM):
    g = _codes(g)
    obs = stat(y, g)
    if strata is not None:
        idx = [np.flatnonzero(strata == s) for s in np.unique(strata)]
    cnt = 0
    for _ in range(n_perm):
        if strata is None:
            gg = RNG.permutation(g)
        else:
            gg = g.copy()
            for ix in idx:
                gg[ix] = g[RNG.permutation(ix)]
        cnt += stat(y, gg) >= obs - 1e-9
    return obs, (cnt + 1) / (n_perm + 1)


def bh(p):
    p = np.asarray(p, float)
    n = len(p)
    o = np.argsort(p)
    q = np.empty(n)
    prev = 1.0
    for i, idx in enumerate(o[::-1]):
        rank = n - i
        prev = min(prev, p[idx] * n / rank)
        q[idx] = prev
    return q


def describe_groups(y, g, binary):
    out = {}
    for k in sorted(np.unique(g)):
        v = y[g == k]
        out[k] = {"n": int(len(v)), "value": float(v.mean() if binary else np.median(v)), "mean": float(v.mean())}
    return out


def posthoc(y, g, binary):
    """each group vs the rest"""
    res = []
    for k in sorted(np.unique(g)):
        a, b = y[g == k], y[g != k]
        if len(a) < 3:
            continue
        if binary:
            t = [[a.sum(), len(a) - a.sum()], [b.sum(), len(b) - b.sum()]]
            p = stats.fisher_exact(t).pvalue
            d = a.mean() - b.mean()
        else:
            p = stats.mannwhitneyu(a, b).pvalue
            d = float(np.median(a) - np.median(b))
        res.append({"group": k, "n": int(len(a)), "group_value": float(a.mean() if binary else np.median(a)),
                    "rest_value": float(b.mean() if binary else np.median(b)), "diff": float(d), "p": float(p)})
    return res


def power_n(y, g, binary, sizes=(10, 15, 20, 30, 40, 60), sims=400):
    """bootstrap power: resample each group (with replacement) to m sites, asymptotic test."""
    keys = [k for k in np.unique(g) if (g == k).sum() >= 3]
    if len(keys) < 2:
        return None
    pools = {k: y[g == k] for k in keys}
    for m in sizes:
        hits = 0
        for _ in range(sims):
            ys = np.concatenate([RNG.choice(pools[k], m) for k in keys])
            gs = np.repeat(keys, m)
            if binary:
                t = pd.crosstab(gs, ys).values
                if t.shape[1] < 2:
                    continue
                p = stats.chi2_contingency(t)[1]
            else:
                if len(np.unique(ys)) < 2:
                    continue
                p = stats.kruskal(*[ys[gs == k] for k in keys]).pvalue
            hits += p < 0.05
        if hits / sims >= 0.8:
            return m
    return None


# Metrics computed and tested but kept out of the final review, and why. Decided by
# inspecting the evidence behind significant results (see the report).
EXCLUDE = {
    "mdlaug_EXE2": "engine counts consent-manager dialog markup left in the page after dismissal; the overlay measures cover this directly",
    "mdlaug_INT1": "duplicate of the EXE2 engine score (same engine findings)",
    "axe:aria-hidden-focus": "appears on Digital Commons only after the crawler rejects cookies through OneTrust's API; may not match what a user's click leaves behind",
    "mdlaug_RED1": "results-status situation scored on home pages",
    "mdlaug_ACC2/COM3": "nearly every site scores 7; differences are a few outliers, not a usable claim",
    "mdlaug_FIL2/RED3": "composite that mostly re-encodes search_in_landmark",
    "mdlaug_NAV2": "results-page situation; measured directly by pagination_landmark",
    "mdlaug_NAV3": "results-page situation; measured directly by results_list_semantics",
    "mdlaug_NAV5": "results-page situation; measured directly by focus_or_skip_to_results",
    "mdlaug_FIL1": "engine FIL1 findings are almost all review-flagged",
    "axe_failing_elements": "element counts scale with page length; axe_rules_violated is the comparable measure",
}

METRIC_INFO = {
    # home page
    "axe_rules_violated": ("home", "WCAG 2.2 A/AA rules failed on the home page (axe-core)"),
    "axe_failing_elements": ("home", "Elements failing WCAG on the home page (axe-core)"),
    "small_targets_2.5.8": ("home", "Tap targets under 24×24 px on the home page (WCAG 2.5.8)"),
    "reflow_fail_1.4.10": ("home", "Home page does not fit a phone screen (WCAG 1.4.10)"),
    "search_in_landmark": ("home", "Search box is inside a search landmark"),
    "search_placeholder_only": ("home", "Search box is labelled only by placeholder text"),
    "mdlaug_ACC5": ("home", "Expand/collapse controls expose their state (mDLAUG ACC5 engine score, 1–7, higher is better)"),
    # overlays met on load
    "overlay_on_load": ("overlay", "An overlay (consent banner, modal, promo) covers the home page on load"),
    "consent_overlay_on_load": ("overlay", "A cookie/consent banner covers the home page on load"),
    "overlay_escape_fails": ("overlay", "An overlay is open on load and Escape does not close it"),
    "overlay_no_named_dismiss": ("overlay", "An overlay on load has no named reject/close control"),
    "overlay_not_exposed_as_dialog": ("overlay", "An overlay on load is not exposed as a dialog to assistive technology"),
    "overlay_not_reachable_by_tab": ("overlay", "An overlay on load can't be reached within 10 Tab presses"),
    # results page
    "results_count_announced": ("results", "Result count is in a live/status region (announced)"),
    "results_list_semantics": ("results", "Results are marked up as a list or table"),
    "pagination_landmark": ("results", "Results pagination is a navigation landmark"),
    "pagination_current_page": ("results", "Results pagination marks the current page (aria-current)"),
    "focus_or_skip_to_results": ("results", "Focus moves to results, or a skip-to-results link exists"),
    "results_axe_rules_violated": ("results", "WCAG 2.2 A/AA rules failed on the results page (axe-core)"),
}


def family(m):
    if m in METRIC_INFO:
        return METRIC_INFO[m][0]
    return "home"


def describe(m):
    if m in METRIC_INFO:
        return METRIC_INFO[m][1]
    if m.startswith("axe:"):
        return f"axe rule '{m[4:]}' fails on the home page"
    return f"mDLAUG {m[7:]} engine score on the home page (1–7, higher is better)"


def analyse(df, label, factors=("platform", "library_type")):
    metrics = [c for c in df.columns if c in METRIC_INFO or c.startswith("mdlaug_") or c.startswith("axe:")]
    rows = []
    for m in metrics:
        d0 = df[df[m].notna()]
        if m.startswith("axe:") and d0[m].sum() < MIN_RULE_SITES:
            continue
        for fac in factors:
            other = [x for x in factors if x != fac][0]
            d = d0[d0.platform.notna()] if fac == "platform" else d0
            y = d[m].to_numpy(float)
            binary = set(np.unique(y)) <= {0, 1}
            if len(np.unique(y)) < 2 or len(d) < 20:
                continue
            stat = chi2_stat if binary else kw_h
            g = d[fac].to_numpy(object)
            ok = (pd.Series(g).map(pd.Series(g).value_counts()) >= 3).values
            y2, g2, s2 = y[ok], g[ok], d[other].fillna("unverified").to_numpy(object)[ok]
            if len(np.unique(g2)) < 2:
                continue
            H, p = perm_p(stat, y2, g2)
            _, p_strat = perm_p(stat, y2, g2, strata=s2)
            p_nodc = None
            if fac == "platform":
                keep = g2 != "Digital commons"
                if len(np.unique(g2[keep])) >= 2 and len(np.unique(y2[keep])) >= 2:
                    _, p_nodc = perm_p(stat, y2[keep], g2[keep], n_perm=2000)
            k, n = len(np.unique(g2)), len(y2)
            eff = (H / (n * (min(k, 2) - 1))) ** 0.5 if binary else max(0.0, (H - k + 1) / (n - k))
            rows.append({"sample": label, "metric": m, "family": family(m), "description": describe(m),
                         "kind": "share of sites" if binary else "median", "factor": fac, "n_sites": n,
                         "groups": k, "statistic": H, "effect": eff,
                         "effect_measure": "Cramér's V" if binary else "epsilon²",
                         "p": p, "p_controlling_other": p_strat, "p_without_dc": p_nodc,
                         "by_group": describe_groups(y2, g2, binary),
                         "posthoc": posthoc(y2, g2, binary),
                         "n_per_group_for_80pct_power": power_n(y2, g2, binary)})
    out = pd.DataFrame(rows, columns=["sample", "metric", "family", "description", "kind", "factor", "n_sites", "groups",
                                      "statistic", "effect", "effect_measure", "p", "p_controlling_other", "p_without_dc",
                                      "by_group", "posthoc", "n_per_group_for_80pct_power"])
    out["final_review"], out["excluded_because"], out["q"], out["q_controlling_other"] = True, "", 1.0, 1.0
    if len(out):
        out["final_review"] = ~out.metric.isin(EXCLUDE)
        out["excluded_because"] = out.metric.map(EXCLUDE).fillna("")
        out["q"] = bh(out.p)
        out["q_controlling_other"] = bh(out.p_controlling_other)
        for r in out.itertuples():
            ph = r.posthoc
            qs = bh([x["p"] for x in ph]) if ph else []
            for x, qq in zip(ph, qs):
                x["q"] = float(qq)
    return out


def replication(rep_df, results):
    """Does the group ordering of each significant difference hold in the replication run?"""
    out = {}
    for r in results.itertuples():
        if r.q >= 0.05 or r.metric not in rep_df.columns:
            continue
        d = rep_df[rep_df[r.metric].notna() & rep_df[r.factor].notna()]
        g = d.groupby(r.factor)[r.metric]
        rep_vals = (g.mean() if r.kind == "share of sites" else g.median()).to_dict()
        prim = {k: v["value"] for k, v in r.by_group.items()}
        common = [k for k in prim if k in rep_vals and (d[r.factor] == k).sum() >= 3]
        rho = None
        if len(common) >= 3:
            a, b = [prim[k] for k in common], [rep_vals[k] for k in common]
            if len(set(a)) > 1 and len(set(b)) > 1:
                rho = float(stats.spearmanr(a, b).statistic)
        out[(r.metric, r.factor)] = {"metric": r.metric, "factor": r.factor, "groups_compared": len(common),
                                     "rank_correlation_with_primary": rho,
                                     "replication_by_group": {k: float(rep_vals[k]) for k in common},
                                     "replication_n": {k: int((d[r.factor] == k).sum()) for k in common}}
    return out


def assign_tiers(res, rep):
    tiers, why, scope = [], [], []
    for r in res.itertuples():
        if not r.final_review or r.q >= 0.05:
            tiers.append(""); why.append(""); scope.append(""); continue
        flagged = {x["group"] for x in r.posthoc if x.get("q", 1) < 0.05}
        reasons = []
        sc = ""
        if r.p_controlling_other >= 0.05:
            reasons.append(f"not significant within {'library type' if r.factor == 'platform' else 'platform'}")
        if r.factor == "platform":
            if r.p_without_dc is not None and r.p_without_dc < 0.05:
                sc = "several vendors"
            elif "Digital commons" in flagged:
                sc = "Digital Commons"          # a claim about Digital Commons itself; the rest don't differ
            else:
                reasons.append("depends on Digital Commons")
        rr = rep.get((r.metric, r.factor))
        rho = rr and rr.get("rank_correlation_with_primary")
        if rr and rr["groups_compared"] >= 3 and rho is not None:
            if rho < 0.6:
                reasons.append(f"weak replication (ρ {rho:.2f})")
        elif r.q >= 0.01:
            reasons.append("no replication available and q ≥ .01")
        tiers.append("assert" if not reasons else "supporting")
        why.append("; ".join(reasons))
        scope.append(sc)
    res["tier"] = tiers
    res["tier_reason"] = why
    res["scope"] = scope
    return res


def manual_candidates(f, run):
    g = f[f.run_id == run]
    auto = automatable(g)
    dropped = g[~g.id.isin(auto.id)]
    why = np.where(dropped.code.isin(ALWAYS_REVIEW), "always needs a person (AT / content quality)",
          np.where(dropped.method == "llm", "LLM judgment (not validated by reviewers yet)",
          np.where(dropped.needs_review == 1, "crawler flagged the result for review", "confidence below 0.7")))
    dropped = dropped.assign(reason=why)
    return (dropped.groupby(["code", "check_id", "reason"])
            .agg(findings=("id", "size"), sites=("site_id", "nunique")).reset_index()
            .sort_values(["sites"], ascending=False))


def run_info(runs, run):
    r = runs[runs.id == run].iloc[0]
    cfg = jl(r.config)
    return {"id": int(run), "status": r.status, "note": r.note, "device": cfg.get("device") or "desktop"}


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap.add_argument("--db", default=os.path.join(here, "data", "mdlaug_crawl.db"))
    ap.add_argument("--out", default=os.path.join(here, "data", "significance"))
    ap.add_argument("--run", type=int, help="primary run (default: latest finished run)")
    ap.add_argument("--replicate", type=int, default=1, help="replication run (default: 1, the desktop crawl)")
    ap.add_argument("--patch", type=int, action="append", default=[],
                    help="a later run that re-crawled some sites with a fixed crawler; its rows replace the primary's")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    sites, pages, f, ev, runs = load(a.db)
    run = a.run or int(runs[runs.status == "done"].id.max())
    labels = platform_labels(run, sites, pages)
    p = site_metrics(run, sites, pages, f, ev, labels).assign(source_run=run)
    for pr_ in a.patch:                 # re-crawled sites replace their rows from the primary run
        pp = site_metrics(pr_, sites, pages, f, ev, labels).assign(source_run=pr_)
        redo = set(pages[(pages.run_id == pr_)].site_id)
        p = pd.concat([p[~p.site_id.isin(redo)], pp], ignore_index=True)
    r = site_metrics(a.replicate, sites, pages, f, ev, labels)
    res = analyse(p, f"run {run}")
    rep = replication(r, res)
    res = assign_tiers(res, rep)
    man = manual_candidates(f, run)

    reached = p[p.platform.notna()]
    allp = p.assign(platform=p.platform_listed)
    cov = {
        "run": run_info(runs, run), "replicate": run_info(runs, a.replicate),
        "patches": [dict(run_info(runs, x), sites=int(pages[pages.run_id == x].site_id.nunique())) for x in a.patch],
        "sites_listed": sites.groupby("listed_platform").size().to_dict(),
        "sites_listed_by_type": sites.groupby("library_type").size().to_dict(),
        "primary_by_platform": reached.groupby("platform").size().to_dict(),
        "crawled_by_listed_platform": allp.groupby("platform").size().to_dict(),
        "primary_by_type": p.groupby("library_type").size().to_dict(),
        "primary_crosstab": pd.crosstab(reached.platform, reached.library_type).to_dict(),
        "replicate_by_platform": r[r.platform.notna()].groupby("platform").size().to_dict(),
        "platform_checks": labels.platform_check.value_counts().to_dict(),
        "relabels": labels[~labels.platform_check.isin(["confirmed", "not fingerprinted"])]
            .merge(sites, on="site_id")[["institution", "collection_url", "listed_platform", "platform_check"]].to_dict("records"),
        "search_by_platform": {k: {"sites": int(len(g)),
                                   "reached_results": int(g.search_reached_results.fillna(0).sum()),
                                   "via_search_box": int(((g.search_method != "url") & (g.search_reached_results == 1)).sum()),
                                   "via_platform_url": int(((g.search_method == "url") & (g.search_reached_results == 1)).sum()),
                                   "bot_challenge": int(g.search_bot_challenge.fillna(0).sum())}
                               for k, g in allp.groupby("platform")} if "search_reached_results" in allp else {},
        "overlay_kinds_by_platform": {k: g.overlay_kinds.replace("", np.nan).dropna().str.split(", ").explode()
                                      .value_counts().to_dict() for k, g in allp.groupby("platform")}
                                     if "overlay_kinds" in allp else {},
        "n_primary": int(len(p)), "n_verified": int(len(reached)), "n_replicate": int(len(r)),
        "n_both": int(len(set(p.site_id) & set(r.site_id))),
        "reviews_in_db": int(len(pd.read_sql_query("SELECT id FROM reviews", sqlite3.connect(a.db)))),
    }
    if "qa_vision_first_view_overlay" in p:
        q = p.dropna(subset=["qa_vision_first_view_overlay"])
        cov["vision_qa"] = {
            "pages": int(len(q)),
            "dom_and_vision_overlay": int(((q.overlay_on_load == 1) & (q.qa_vision_first_view_overlay == 1)).sum()),
            "dom_only": int(((q.overlay_on_load == 1) & (q.qa_vision_first_view_overlay == 0)).sum()),
            "vision_only": int(((q.overlay_on_load == 0) & (q.qa_vision_first_view_overlay == 1)).sum()),
            "neither": int(((q.overlay_on_load == 0) & (q.qa_vision_first_view_overlay == 0)).sum()),
            "residual_after_dismissal": int(p.qa_vision_residual_overlay.fillna(0).sum()),
        }

    p.to_csv(os.path.join(a.out, f"site_metrics_run{run}.csv"), index=False)
    r.to_csv(os.path.join(a.out, f"site_metrics_run{a.replicate}.csv"), index=False)
    res.drop(columns=["by_group", "posthoc"]).to_csv(os.path.join(a.out, "tests.csv"), index=False)
    man.to_csv(os.path.join(a.out, "manual_review_candidates.csv"), index=False)
    labels.merge(sites, on="site_id").to_csv(os.path.join(a.out, "platform_labels.csv"), index=False)
    with open(os.path.join(a.out, "results.json"), "w") as fh:
        json.dump({"coverage": cov, "primary": res.to_dict("records"), "replication": list(rep.values()),
                   "manual": man.to_dict("records"), "n_perm": N_PERM}, fh, indent=1,
                  default=lambda o: o.item() if hasattr(o, "item") else (sorted(o) if isinstance(o, set) else str(o)))
    sig = res[(res.q < 0.05) & res.final_review].sort_values(["tier", "q"])
    print(f"run {run}: {len(p)} sites ({len(reached)} vendor-verified); replication run {a.replicate}: {cov['n_replicate']}; "
          f"tests: {len(res)}; significant: {len(sig)}; assert: {(sig.tier == 'assert').sum()}")
    print(sig[["metric", "factor", "n_sites", "effect", "q", "p_controlling_other", "p_without_dc", "tier", "tier_reason"]]
          .to_string())


if __name__ == "__main__":
    main()
