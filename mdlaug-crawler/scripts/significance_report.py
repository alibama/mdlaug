"""Render data/significance/results.json (from significance.py) as a shareable HTML page.

Usage:  python scripts/significance_report.py [--dir data/significance]

Finding text is generated from the data (which platforms differ, by how much); only the
"vendor ask" — what to fix — is written per measure, below. The narrative (bottom line and
next steps) lives in significance_narrative.json and should be rewritten after each new crawl.
"""
import argparse
import html
import json
import os

import pandas as pd

METRIC_DESC = {"mdlaug_ACC5": "Expand/collapse controls expose their state (mDLAUG ACC5 engine score, 1–7)"}
PLATFORMS = ["CONTENTdm", "DSpace", "Digital commons", "Islandora", "Omeka", "Samvera"]
TIER_LABEL = {"assert": "Assert now", "supporting": "Supporting"}
FAMILY_TITLE = {"overlay": "Overlays met on load", "home": "Home page", "results": "Search results page"}

# For each measure: is a higher value better, and what a vendor would fix.
HIGHER_IS_BETTER = {"search_in_landmark", "results_count_announced", "results_list_semantics", "pagination_landmark",
                    "pagination_current_page", "focus_or_skip_to_results"}
FIX = {
    "overlay_on_load": "don't open a pop-up over the page on load; if a consent notice is required, make it a non-blocking banner",
    "consent_overlay_on_load": "make the consent notice a non-blocking banner, not a layer over the page",
    "overlay_escape_fails": "close the consent dialog/banner with Escape and return focus to the page",
    "overlay_no_named_dismiss": "give the consent banner a visible, named 'Reject all' or 'Close' control next to 'Accept'",
    "overlay_not_exposed_as_dialog": "expose the overlay as role=dialog (aria-modal when it blocks the page) with a name",
    "overlay_not_reachable_by_tab": "put the overlay first in focus order, or move focus into it when it opens",
    "small_targets_2.5.8": "enlarge or space the template's small links and buttons to at least 24×24 px (WCAG 2.2 SC 2.5.8)",
    "search_in_landmark": "wrap the global search form in role=search (or <search>) so screen-reader users can jump to it",
    "search_placeholder_only": "give the search box a real label, not just placeholder text",
    "reflow_fail_1.4.10": "make the default theme fit a 320 px wide screen without sideways scrolling",
    "axe_rules_violated": "audit the default templates with axe-core",
    "axe:color-contrast": "raise the contrast of the default theme's secondary text, footer and badges to 4.5:1",
    "axe:link-name": "give icon-only and image links in the default templates an accessible name",
    "axe:target-size": "enlarge small links and buttons in the default templates (WCAG 2.5.8)",
    "axe:link-in-text-block": "keep underlines (or another non-colour cue) on links inside text",
    "axe:image-alt": "require alt text on template images",
    "axe:button-name": "name icon-only buttons in the default templates",
    "axe:label": "label every form field in the default templates",
    "axe:region": "put all page content inside landmarks",
    "axe:landmark-one-main": "give every page exactly one main landmark",
    "axe:aria-allowed-attr": "remove ARIA attributes that aren't allowed on their elements",
    "axe:aria-required-parent": "nest ARIA list/menu items inside the right parent role",
    "axe:list": "use only <li> inside <ul>/<ol>",
    "axe:listitem": "put <li> elements inside a <ul> or <ol>",
    "axe:nested-interactive": "don't nest links or buttons inside other interactive elements",
    "axe:scrollable-region-focusable": "make scrollable regions keyboard-focusable",
    "mdlaug_ACC5": "give menu, accordion and other expand/collapse controls aria-expanded (and aria-controls)",
    "results_count_announced": "put the result count in a role=status / aria-live region so it is announced after a search",
    "results_list_semantics": "mark up result entries as a list (or table) so screen-reader users can move item by item",
    "pagination_landmark": "wrap results paging in <nav aria-label='Pagination'>",
    "pagination_current_page": "mark the current page link with aria-current='page'",
    "focus_or_skip_to_results": "move focus to the results heading after a search, or add a skip-to-results link",
    "results_axe_rules_violated": "audit the results template with axe-core",
}


def esc(s):
    return html.escape(str(s))


def fmt(v, kind):
    if kind == "share of sites":
        return f"{round(v * 100)}%"
    return f"{v:g}" if float(v).is_integer() else f"{v:.1f}"


def short(m):
    return m.replace("mdlaug_", "mDLAUG ").replace("axe:", "axe ")


def better_higher(m):
    return m in HIGHER_IS_BETTER or m.startswith("mdlaug_")


def bars(r):
    groups = r["by_group"]
    ph = {x["group"]: x for x in r["posthoc"]}
    keys = [k for k in PLATFORMS if k in groups] if r["factor"] == "platform" else sorted(groups)
    kind = r["kind"]
    vmax = 1.0 if kind == "share of sites" else (7.0 if r["metric"].startswith("mdlaug_") else max(max(v["value"] for v in groups.values()), 1e-9))
    rows = []
    for k in keys:
        v = groups[k]
        flagged = k in ph and ph[k].get("q", 1) < 0.05
        w = max(0.5, 100 * v["value"] / vmax)
        rows.append(
            f'<div class="bar-row{" flag" if flagged else ""}" title="{esc(k)}: {fmt(v["value"], kind)} (n={v["n"]})">'
            f'<span class="bar-label">{esc(k)} <span class="n">n={v["n"]}</span></span>'
            f'<span class="bar-track"><span class="bar" style="width:{w:.1f}%"></span></span>'
            f'<span class="bar-val">{fmt(v["value"], kind)}</span>'
            f'<span class="chip-slot">{"<span class=chip>differs</span>" if flagged else ""}</span></div>')
    return '<div class="bars">' + "".join(rows) + "</div>"


def sentence(r):
    """Which groups stand apart, generated from the one-vs-rest tests."""
    kind = r["kind"]
    flagged = [x for x in r["posthoc"] if x.get("q", 1) < 0.05]
    unit = "" if kind == "share of sites" else "median "
    if not flagged:
        return "The groups differ overall, but no single one stands apart from the rest."
    parts = []
    for x in sorted(flagged, key=lambda x: -abs(x["group_value"] - x["rest_value"])):
        parts.append(f"{x['group']} {unit}{fmt(x['group_value'], kind)} vs {fmt(x['rest_value'], kind)} for the rest")
    return "; ".join(parts) + "."


def ask(r):
    """Vendor ask aimed at the platforms that do worse on this measure."""
    if r["factor"] != "platform":
        return ""
    fix = FIX.get(r["metric"]) or (f"fix axe rule '{r['metric'][4:]}' in the default templates" if r["metric"].startswith("axe:") else "")
    if not fix:
        return ""
    hb = better_higher(r["metric"])
    worse = [x["group"] for x in r["posthoc"] if x.get("q", 1) < 0.05 and ((x["diff"] < 0) if hb else (x["diff"] > 0))]
    if not worse:
        return ""
    return f"{', '.join(worse)}: {fix}."


def pfmt(p):
    if p is None or (isinstance(p, float) and pd.isna(p)):
        return "–"
    return "<0.001" if p < 0.001 else f"{p:.3f}"


def card(r, rep):
    r = dict(r, description=METRIC_DESC.get(r["metric"], r["description"]))
    rr = rep.get((r["metric"], r["factor"]), {})
    rho = rr.get("rank_correlation_with_primary")
    better = "higher" if better_higher(r["metric"]) else "lower"
    a = ask(r)
    scope = f' · {esc(r["scope"])}' if r.get("scope") else ""
    reason = f'<p class="unit">Not "assert" because: {esc(r["tier_reason"])}</p>' if r["tier"] == "supporting" else ""
    return f"""
<article class="finding tier-{r['tier']}">
  <header><span class="tier">{TIER_LABEL[r['tier']]}{scope}</span><h3>{esc(r['description'])}</h3>
  <p class="unit">{esc(r['kind'])} by {'platform' if r['factor'] == 'platform' else 'library type'} · {better} is better · <code>{esc(short(r['metric']))}</code></p>{reason}</header>
  {bars(r)}
  <p>{esc(sentence(r))}</p>
  {f'<p class="ask"><strong>Vendor ask.</strong> {esc(a)}</p>' if a else ''}
  <dl class="stats">
    <div><dt>FDR q</dt><dd>{pfmt(r['q'])}</dd></div>
    <div><dt>p, within {'library type' if r['factor'] == 'platform' else 'platform'}</dt><dd>{pfmt(r['p_controlling_other'])}</dd></div>
    {f"<div><dt>p, without Digital Commons</dt><dd>{pfmt(r.get('p_without_dc'))}</dd></div>" if r['factor'] == 'platform' else ''}
    <div><dt>{esc(r['effect_measure'])}</dt><dd>{r['effect']:.2f}</dd></div>
    <div><dt>Replication ρ</dt><dd>{'–' if rho is None else f'{rho:.2f}'}</dd></div>
  </dl>
</article>"""


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap.add_argument("--dir", default=os.path.join(here, "data", "significance"))
    a = ap.parse_args()
    d = json.load(open(os.path.join(a.dir, "results.json")))
    cov = d["coverage"]
    rep = {(r["metric"], r["factor"]): r for r in d["replication"]}
    prim = [r for r in d["primary"] if r.get("final_review", True)]

    # findings, grouped by family, assert first
    sections = []
    for fam in ("overlay", "home", "results"):
        rs = [r for r in prim if r["factor"] == "platform" and r.get("tier") and r["family"] == fam]
        rs.sort(key=lambda r: (r["tier"] != "assert", r["q"]))
        if rs:
            sections.append(f'<h3 class="family">{FAMILY_TITLE[fam]}</h3><div class="grid">' + "".join(card(r, rep) for r in rs) + "</div>")
    n_assert = sum(1 for r in prim if r["factor"] == "platform" and r.get("tier") == "assert")
    n_support = sum(1 for r in prim if r["factor"] == "platform" and r.get("tier") == "supporting")

    lt = sorted([r for r in prim if r["factor"] == "library_type"], key=lambda r: r["q"])
    lt_cards = "".join(card(r, rep) for r in lt if r.get("tier"))
    lt_rows = "".join(
        f"<tr><td>{esc(r['description'])}</td><td class=num>{pfmt(r['q'])}</td>"
        f"<td class=num>{r['effect']:.2f}</td><td class=num>{r['n_per_group_for_80pct_power'] or '>60'}</td></tr>"
        for r in lt)
    by = {(r["metric"], r["factor"]): r for r in prim}
    pv = [(r["effect"], by[(r["metric"], "library_type")]["effect"]) for r in prim
          if r["factor"] == "platform" and (r["metric"], "library_type") in by]
    plat_wins = sum(1 for x in pv if x[0] > x[1])

    dropped = {r["metric"]: r for r in d["primary"] if not r.get("final_review", True) and r["factor"] == "platform"}
    drop_rows = "".join(f"<tr><td><code>{esc(short(m))}</code></td><td>{esc(r['excluded_because'])}</td></tr>"
                        for m, r in dropped.items())
    man = pd.DataFrame(d["manual"])
    man_rows = ""
    if len(man):
        man_g = (man.groupby("code").agg(findings=("findings", "sum"), sites=("sites", "max"),
                                        reason=("reason", lambda s: "; ".join(sorted(set(s)))))
                 .reset_index().sort_values("sites", ascending=False))
        man_rows = "".join(f"<tr><td>{esc(r.code)}</td><td class=num>{r.sites}</td><td class=num>{r.findings}</td>"
                           f"<td>{esc(r.reason)}</td></tr>" for r in man_g.itertuples())

    sb = cov.get("search_by_platform", {})
    ok_ = cov.get("overlay_kinds_by_platform", {})
    cov_rows = "".join(
        f"<tr><td>{esc(p)}</td><td class=num>{cov['sites_listed'].get(p, 0)}</td>"
        f"<td class=num>{cov['primary_by_platform'].get(p, 0)}</td>"
        f"<td class=num>{sb.get(p, {}).get('via_search_box', 0)}</td><td class=num>{sb.get(p, {}).get('via_platform_url', 0)}</td>"
        f"<td class=num>{sb.get(p, {}).get('bot_challenge', 0)}</td>"
        f"<td>{esc(', '.join(f'{k} ({v})' for k, v in list(ok_.get(p, {}).items())[:4]) or '–')}</td></tr>" for p in PLATFORMS)
    relabel_rows = "".join(f"<tr><td>{esc(x['institution'])}</td><td>{esc(x['listed_platform'])}</td>"
                           f"<td>{esc(x['platform_check'])}</td></tr>"
                           for x in sorted(cov.get("relabels", []), key=lambda x: (x["listed_platform"], x["platform_check"])))
    vq = cov.get("vision_qa") or {}
    reach_tot = sum(v.get("reached_results", 0) for v in sb.values())
    bot_tot = sum(v.get("bot_challenge", 0) for v in sb.values())

    subs = {
        "N_PRIMARY": cov["n_primary"], "N_VERIFIED": cov.get("n_verified", cov["n_primary"]),
        "N_REPLICATE": cov["n_replicate"], "N_BOTH": cov["n_both"],
        "PATCH_NOTE": (f"After crawler fixes, {sum(x['sites'] for x in cov.get('patches', []))} sites were re-crawled "
                       f"(run{'s' if len(cov.get('patches', [])) > 1 else ''} "
                       f"{', '.join(str(x['id']) for x in cov.get('patches', []))}) and those results replace run "
                       f"{cov['run']['id']}'s for them." if cov.get("patches") else ""),
        "RUN_ID": cov["run"]["id"], "RUN_DEVICE": cov["run"]["device"], "REP_ID": cov["replicate"]["id"],
        "REP_DEVICE": cov["replicate"]["device"], "N_ASSERT": n_assert, "N_SUPPORT": n_support,
        "N_TESTS": len(d["primary"]), "N_PERM": d["n_perm"], "PLAT_WINS": plat_wins, "PV_N": len(pv),
        "SECTIONS": "".join(sections), "LT_CARDS": lt_cards or "<p>No institution-type difference passed the checks.</p>",
        "LT_ROWS": lt_rows, "DROP_ROWS": drop_rows, "MAN_ROWS": man_rows, "COV_ROWS": cov_rows,
        "RELABEL_ROWS": relabel_rows or "<tr><td colspan=3>None</td></tr>",
        "N_RELABEL": len(cov.get("relabels", [])), "REVIEWS": cov.get("reviews_in_db", 0),
        "REACH": reach_tot, "BOT": bot_tot,
        "VQ_PAGES": vq.get("pages", 0), "VQ_BOTH": vq.get("dom_and_vision_overlay", 0), "VQ_DOM": vq.get("dom_only", 0),
        "VQ_VISION": vq.get("vision_only", 0), "VQ_NEITHER": vq.get("neither", 0), "VQ_RESID": vq.get("residual_after_dismissal", 0),
    }
    # the narrative (bottom line, next steps) is written by a person after reading the results
    narr_path = os.path.join(os.path.dirname(__file__), "significance_narrative.json")
    narr = json.load(open(narr_path)) if os.path.exists(narr_path) else {}
    subs["BOTTOM_LINE"] = narr.get("bottom_line", "<p>Summary not written yet.</p>")
    subs["NEXT_STEPS"] = narr.get("next_steps", "")
    out = open(os.path.join(os.path.dirname(__file__), "significance_report_template.html")).read()
    for k, v in subs.items():
        out = out.replace("{{" + k + "}}", str(v))
    path = os.path.join(a.dir, "report.html")
    open(path, "w").write(out)
    print(path)


if __name__ == "__main__":
    main()
