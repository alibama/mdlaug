"""Local LLM judgments via Ollama (default model: Qwen).

Used only where rules/regex are brittle: classifying a page's role, and judging the
*quality* of things a script can detect but not evaluate (is this alt text meaningful?
does this help page explain how to use the DL?). Every call is logged (prompt hash,
latency, raw output, parse success) and cached by prompt hash. Every result carries a
confidence; anything below the review threshold is routed to human review.
"""
import hashlib
import json
import re
import time

import requests

from . import checks

SYSTEM = ("You are an accessibility evaluator for digital libraries, applying the mobile "
          "Digital Library Accessibility and Usability Guidelines (mDLAUG) for blind and "
          "visually impaired users. Answer ONLY with one JSON object matching the requested "
          "schema. Be conservative: if the evidence is insufficient, say so and give low confidence.")

TASKS = {
    "classify_page": {
        "schema": '{"page_type": "home|search|results|item|browse|help|about|other", '
                  '"confidence": 0.0-1.0, "rationale": "short"}',
        "instruction": ("Classify the role of this digital-library page. Definitions: results = lists items matching a "
                        "query (even if it also shows a search box); search = a dedicated search/advanced-search form with "
                        "no results listed; item = one object or record (viewer and/or metadata); browse = lists "
                        "collections, categories or items without a query; home = the library's front page; help = "
                        "instructions/FAQ/accessibility; about = information about the institution. If 'arrived_via' is "
                        "'results' and the page lists entries, it is results."),
    },
    "judge_alt_text": {
        "schema": '{"items": [{"index": int, "verdict": "meaningful|generic|filename|missing|decorative_ok", '
                  '"note": "short"}], "overall_score_1_7": int, "confidence": 0.0-1.0, "rationale": "short"}',
        "instruction": ("Judge whether each image's text alternative would let a blind user understand "
                        "the image in this context (mDLAUG ACC2/COM3). 7 = all meaningful, 1 = none."),
    },
    "judge_help": {
        "schema": '{"explains_use": bool, "mentions_search_tips": bool, "mobile_or_at_specific": bool, '
                  '"score_1_7": int, "confidence": 0.0-1.0, "rationale": "short"}',
        "instruction": ("Judge this help page against mDLAUG FIL3/HEP1: does it explain how to use the "
                        "digital library, and does it include mobile or assistive-technology guidance?"),
    },
    "judge_snippets": {
        "schema": '{"score_1_7": int, "has_titles": bool, "has_descriptions": bool, '
                  '"has_dates_or_types": bool, "confidence": 0.0-1.0, "rationale": "short"}',
        "instruction": ("These are search-result entries as a screen reader would read them. Judge mDLAUG "
                        "EVA1: is there enough information to assess each item's relevance before opening it?"),
    },
    "judge_restricted": {
        "schema": '{"explains_why": bool, "explains_how_to_get_access": bool, "score_1_7": int, '
                  '"confidence": 0.0-1.0, "rationale": "short"}',
        "instruction": ("Text near controls that appear restricted or require sign-in. Judge mDLAUG RED4: "
                        "does it explain why the feature is unavailable and how to gain access?"),
    },
    "judge_structure": {
        "schema": '{"score_1_7": int, "clear_purpose": bool, "logical_headings": bool, '
                  '"confidence": 0.0-1.0, "rationale": "short"}',
        "instruction": ("This is the heading outline and landmark list of a digital-library home page. Judge "
                        "mDLAUG COM1: could a screen-reader user understand the library's structure from it?"),
    },
}


def parse_json(text):
    """Extract the first JSON object from model output (tolerates code fences / chatter)."""
    if text is None:
        raise ValueError("empty")
    t = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()   # qwen3 thinking blocks
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t.strip(), flags=re.M)
    try:
        return json.loads(t)
    except Exception:
        m = re.search(r"\{.*\}", t, re.S)
        if not m:
            raise ValueError("no JSON object in output")
        return json.loads(m.group(0))


def clamp_conf(v, default=0.5):
    try:
        return max(0.0, min(1.0, float(v)))
    except Exception:
        return default


class LLM:
    """Ollama client. `store` (optional) records every call; `transport` can be swapped in tests."""

    def __init__(self, cfg, store=None, transport=None):
        self.cfg = cfg
        self.store = store
        self.transport = transport or self._ollama
        self.available = None
        self._catalog = None

    # -- prompt assembly (editable on the app's Checks page) ----------------
    def instruction(self, task):
        if self.store is not None:
            o = self.store.get_setting("prompt:" + task)
            if o:
                return o
        return TASKS[task]["instruction"]

    def build_prompt(self, task, payload):
        """Instruction + situation rubric + reviewer exemplars + input. Returns (prompt, version)."""
        spec = TASKS[task]
        instr = self.instruction(task)
        code = checks.DEFAULT_TASK_SITUATION.get(task)
        rubric, ex_txt, ex_ids = "", "", []
        if code:
            if self._catalog is None:
                self._catalog = checks.merged(self.store)
            rubric = self._catalog.get(code, {}).get("rubric", "")
            fewshot = (self.store.get_setting("fewshot:enabled", "1") if self.store is not None else "0") == "1"
            if fewshot and self.store is not None:
                ex = self.store.exemplars(code, limit=4)
                lines = []
                for e in ex:
                    ev = (e.get("message") or "")[:300]
                    sc = e.get("review_score") or e.get("auto_score")
                    lines.append(f"- {e['exemplar'].upper()} example (reviewer score {sc}): {ev}"
                                 + (f" | reviewer note: {e['note'][:200]}" if e.get("note") else ""))
                    ex_ids.append(f"{e['exemplar']}{sc}{checks.prompt_version(ev)}")
                if lines:
                    ex_txt = "\n\nReviewed examples from other libraries (for calibration):\n" + "\n".join(lines)
        rub_txt = f"\n\nScoring guide ({code}):\n{rubric}" if rubric else ""
        version = checks.prompt_version(instr, spec["schema"], rubric, ",".join(ex_ids))
        body = json.dumps(payload, ensure_ascii=False, default=str)[:12000]
        prompt = f"{instr}{rub_txt}{ex_txt}\n\nRespond with JSON: {spec['schema']}\n\nINPUT:\n{body}"
        return prompt, version

    _no_think = set()     # models that reject the "think" flag

    def _ollama(self, model, system, prompt):
        body = {"model": model, "stream": False, "format": "json", "options": {"temperature": 0},
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]}
        if model not in self._no_think:
            body["think"] = False        # keep Qwen3-style reasoning out of the JSON
        r = requests.post(self.cfg.ollama_url.rstrip("/") + "/api/chat", timeout=self.cfg.llm_timeout, json=body)
        if r.status_code == 400 and "think" in r.text.lower() and "think" in body:
            self._no_think.add(model)    # e.g. a model without thinking support
            body.pop("think")
            r = requests.post(self.cfg.ollama_url.rstrip("/") + "/api/chat", timeout=self.cfg.llm_timeout, json=body)
        r.raise_for_status()
        return (r.json().get("message") or {}).get("content", "")

    def check(self):
        """Is Ollama reachable and the model pulled? (Cheap; cached.)"""
        if self.available is not None:
            return self.available
        if self.transport is not self._ollama:
            self.available = True
            return True
        try:
            tags = requests.get(self.cfg.ollama_url.rstrip("/") + "/api/tags", timeout=5).json()
            names = {m.get("name") for m in tags.get("models", [])}
            self.available = self.cfg.ollama_model in names or any(
                n and n.split(":")[0] == self.cfg.ollama_model.split(":")[0] for n in names)
        except Exception:
            self.available = False
        return self.available

    def ask(self, task, payload, run_id=None, site_id=None, page_id=None):
        """Run a task. Returns dict with the task's fields plus `_ok`, `_confidence`."""
        prompt, pv = self.build_prompt(task, payload)
        model = self.cfg.ollama_model
        h = hashlib.sha256((model + "|" + task + "|" + prompt).encode()).hexdigest()[:24]
        if self.store:
            hit = self.store.cached_llm(h, model)
            if hit is not None:
                cid = self.store.log_llm(run_id=run_id, site_id=site_id, page_id=page_id, task=task, model=model,
                                         prompt_hash=h, input_chars=len(prompt), latency_ms=0, ok=1, raw="",
                                         parsed=json.dumps(hit), error="", cached=1, prompt_version=pv,
                                         prompt=prompt, role="primary")
                self._shadow(task, prompt, pv, cid, run_id, site_id, page_id)
                return dict(hit, _ok=True, _confidence=clamp_conf(hit.get("confidence")), _cached=True, _pv=pv, _call_id=cid)
        parsed, cid = self.run_prompt(model, task, prompt, pv, "primary", None, run_id, site_id, page_id, h)
        self._shadow(task, prompt, pv, cid, run_id, site_id, page_id)
        if parsed is None:
            return {"_ok": False, "_error": self._last_error, "_confidence": 0.0, "_pv": pv, "_call_id": cid}
        return dict(parsed, _ok=True, _confidence=clamp_conf(parsed.get("confidence")), _pv=pv, _call_id=cid)

    _last_error = ""

    def run_prompt(self, model, task, prompt, pv="", role="primary", replay_of=None, run_id=None, site_id=None,
                   page_id=None, h=None):
        """Send an already-built prompt to `model`; log it. Returns (parsed or None, call id)."""
        h = h or hashlib.sha256((model + "|" + task + "|" + prompt).encode()).hexdigest()[:24]
        t0 = time.time()
        raw, parsed, err = "", None, ""
        try:
            raw = self.transport(model, SYSTEM, prompt)
            parsed = parse_json(raw)
        except Exception as e:  # noqa: BLE001
            err = f"{type(e).__name__}: {e}"
        self._last_error = err
        ms = int((time.time() - t0) * 1000)
        cid = None
        if self.store:
            cid = self.store.log_llm(run_id=run_id, site_id=site_id, page_id=page_id, task=task, model=model,
                                     prompt_hash=h, input_chars=len(prompt), latency_ms=ms,
                                     ok=1 if parsed is not None else 0, raw=(raw or "")[:8000],
                                     parsed=json.dumps(parsed) if parsed is not None else "", error=err, cached=0,
                                     prompt_version=pv, prompt=prompt, role=role, replay_of=replay_of)
        return parsed, cid

    def _shadow(self, task, prompt, pv, primary_id, run_id, site_id, page_id):
        m = self.cfg.shadow_model
        if m and m != self.cfg.ollama_model:
            self.run_prompt(m, task, prompt, pv, "shadow", primary_id, run_id, site_id, page_id)
