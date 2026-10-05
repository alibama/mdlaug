"""Compare local models on the crawler's real prompts.

* list_models(): what Ollama has installed (for the app's dropdowns).
* replay(): re-run stored prompts from earlier crawls against another model, one model
  loaded at a time — the laptop-friendly way to compare. Results are logged as
  llm_calls with role='replay' and replay_of=<original call>.
"""
import requests

from .llm import LLM


def list_models(cfg, timeout=5):
    """[{name, size_gb, params, quant}] or [] if Ollama isn't reachable."""
    try:
        tags = requests.get(cfg.ollama_url.rstrip("/") + "/api/tags", timeout=timeout).json()
    except Exception:
        return []
    out = []
    for m in tags.get("models", []):
        d = m.get("details") or {}
        out.append({"name": m.get("name") or m.get("model"), "size_gb": round((m.get("size") or 0) / 1e9, 1),
                    "params": d.get("parameter_size", ""), "quant": d.get("quantization_level", "")})
    return sorted(out, key=lambda x: x["name"] or "")


def replay(store, cfg, model, run_id=None, tasks=None, limit=None, progress=None, transport=None):
    """Re-run original (primary) prompts against `model`. Skips ones already replayed by it."""
    q = ("SELECT a.* FROM llm_calls a WHERE a.prompt IS NOT NULL AND COALESCE(a.role,'primary')='primary' "
         "AND a.model<>? AND NOT EXISTS (SELECT 1 FROM llm_calls b WHERE b.replay_of=a.id AND b.model=?)")
    args = [model, model]
    if run_id:
        q += " AND a.run_id=?"; args.append(run_id)
    if tasks:
        q += f" AND a.task IN ({','.join('?' * len(tasks))})"; args += list(tasks)
    q += " ORDER BY a.id"
    if limit:
        q += " LIMIT ?"; args.append(int(limit))
    rows = store.query(q, tuple(args))
    llm = LLM(cfg, store, transport=transport)
    for i, a in enumerate(rows, 1):
        llm.run_prompt(model, a["task"], a["prompt"], a.get("prompt_version") or "", "replay", a["id"],
                       a.get("run_id"), a.get("site_id"), a.get("page_id"))
        if progress:
            progress(i, len(rows))
    return len(rows)
