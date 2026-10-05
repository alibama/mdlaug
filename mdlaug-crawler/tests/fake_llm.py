"""Deterministic stand-in for Ollama, keyed off the task instruction in the prompt."""
import json

def transport(model, system, prompt):
    if "Classify the role" in prompt:
        return json.dumps({"page_type": "results" if "result" in prompt.lower() else "other", "confidence": 0.8, "rationale": "fake"})
    if "text alternative" in prompt:
        return "```json\n" + json.dumps({"items": [{"index": 0, "verdict": "filename", "note": "filename"}],
                                         "overall_score_1_7": 3, "confidence": 0.8, "rationale": "one filename alt"}) + "\n```"
    if "help page" in prompt:
        return json.dumps({"explains_use": True, "mentions_search_tips": True, "mobile_or_at_specific": False,
                           "score_1_7": 4, "confidence": 0.75, "rationale": "basic help, no AT guidance"})
    if "search-result entries" in prompt:
        return json.dumps({"score_1_7": 5, "has_titles": True, "has_descriptions": True, "has_dates_or_types": True,
                           "confidence": 0.8, "rationale": "titles + short descriptions"})
    if "restricted" in prompt:
        return json.dumps({"explains_why": False, "explains_how_to_get_access": True, "score_1_7": 3,
                           "confidence": 0.6, "rationale": "says log in, not why"})
    if "heading outline" in prompt:
        return "Sure! " + json.dumps({"score_1_7": 3, "clear_purpose": True, "logical_headings": False,
                                      "confidence": 0.7, "rationale": "h1 then h3"})
    return "not json"
