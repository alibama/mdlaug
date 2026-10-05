"""Page-role classification: cheap heuristics first, LLM only when unsure.
Both the method and confidence are recorded so we can see where heuristics fail."""
import re
from urllib.parse import urlparse, parse_qs

ITEM_PATH = re.compile(r"/(items?|handle|object|node|record|records|show|concern|catalog|digital/collection/[^/]+/id|"
                       r"islandora/object|ark:|work|works|id)/", re.I)
SEARCH_PARAMS = {"q", "query", "search", "searchterm", "keyword", "keywords", "s", "terms", "search_api_fulltext",
                 "all_fields", "text", "f", "searchtext"}


def heuristic(summary, start_url=None, hint=None):
    """Return (page_type, confidence, reasons)."""
    url = summary.get("url", "")
    p = urlparse(url)
    path = p.path.lower()
    qs = {k.lower() for k in parse_qs(p.query)}
    title = (summary.get("title", "") + " " + " ".join(summary.get("h1", []))).lower()
    reasons = []
    if hint == "home" or (start_url and url.rstrip("/") == start_url.rstrip("/")):
        return "home", 0.95, ["start URL"]
    if re.search(r"\b(help|faq|search tips|user guide|accessibility)\b", path + " " + title):
        return "help", 0.85, ["help keyword in path/title"]
    if qs & SEARCH_PARAMS or "/search" in path or "/discover" in path:
        reasons.append("search params/path")
        if summary.get("result_count_text") or summary.get("pagination"):
            return "results", 0.9, reasons + ["result count/pagination"]
        return ("results" if hint == "results" else "search"), 0.65, reasons
    if hint == "results" and summary.get("result_count_text"):
        return "results", 0.85, ["after search submit, count text"]
    if ITEM_PATH.search(path) and (summary.get("has_viewer") or summary.get("metadata_blocks", 0) >= 1):
        return "item", 0.85, ["item-like path + viewer/metadata"]
    if summary.get("has_viewer"):
        return "item", 0.6, ["viewer present"]
    if re.search(r"/(browse|collections?|communities|exhibits)\b", path) or re.search(r"\b(browse|collections)\b", title):
        return "browse", 0.7, ["browse/collections path/title"]
    if hint:
        return hint, 0.5, ["navigation hint only"]
    return "other", 0.3, ["no strong signal"]


def classify(summary, llm=None, start_url=None, hint=None, threshold=0.7, **ctx):
    t, conf, why = heuristic(summary, start_url, hint)
    if conf >= threshold or llm is None or not llm.check():
        return {"page_type": t, "confidence": conf, "method": "heuristic", "rationale": "; ".join(why)}
    payload = {k: summary.get(k) for k in ("url", "title", "h1", "headings", "landmarks", "result_count_text",
                                           "has_viewer", "pagination", "facets", "forms")}
    payload["text_excerpt"] = (summary.get("text_excerpt") or "")[:800]
    payload["arrived_via"] = hint or ""
    r = llm.ask("classify_page", payload, **ctx)
    if not r.get("_ok"):
        return {"page_type": t, "confidence": conf, "method": "heuristic (llm failed)", "rationale": "; ".join(why)}
    pt = str(r.get("page_type", t)).lower()
    if pt not in {"home", "search", "results", "item", "browse", "help", "about", "other"}:
        pt = t
    return {"page_type": pt, "confidence": r["_confidence"], "method": "llm",
            "rationale": str(r.get("rationale", ""))[:300], "heuristic_guess": t}
