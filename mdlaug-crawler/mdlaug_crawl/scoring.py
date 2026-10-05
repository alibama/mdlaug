"""Scores and aggregation. Probe outcomes map onto the same 1–7 scale as the
plugin's audit rubric; per-site situation scores average the evidence."""
OUTCOME_SCORE = {"pass": 7, "partial": 4, "fail": 2, "blocking": 1}

# Situations whose real answer depends on content quality or AT behaviour: the
# pipeline may suggest a score, but a person must confirm it (honest by design).
ALWAYS_REVIEW = {"USE1", "ACC3/COM4", "FIL3/HEP1", "RED4"}

SITUATIONS = [
    ("ACC1", "A"), ("ACC2/COM3", "A"), ("ACC3/COM4", "AA"), ("ACC4", "AA"), ("ACC5", "A"), ("ACC6", "AAA"),
    ("COM1", "A"), ("COM2/NAV1", "AAA"), ("EVA1", "A"), ("EXE1", "A"), ("EXE2", "A"), ("EXE3", "AA"),
    ("FIL1", "A"), ("FIL2/RED3", "AA"), ("FIL3/HEP1", "A"), ("INT1", "A"), ("NAV2", "AA"), ("NAV3", "AA"),
    ("NAV4", "AA"), ("NAV5", "A"), ("RED1", "A"), ("RED2", "AA"), ("RED4", "AAA"), ("USE1", "AAA"),
]
LEVEL = dict(SITUATIONS)


def outcome_from_score(score):
    if score is None:
        return "na"
    return "pass" if score >= 6 else ("partial" if score >= 3 else "fail")


def aggregate(findings, review_conf=0.7):
    """findings: list of dicts for ONE site. Returns {code: {...}}."""
    out = {}
    for code, level in SITUATIONS:
        fs = [f for f in findings if f["code"] == code]
        scored = [f for f in fs if f.get("score") is not None]
        if scored:
            # weight by confidence; LLM/probe/engine all count
            w = sum(max(0.1, f.get("confidence") or 0.5) for f in scored)
            s = sum(f["score"] * max(0.1, f.get("confidence") or 0.5) for f in scored) / w
            score = int(round(s))
        else:
            score = None
        conf = min([f.get("confidence") or 0 for f in scored], default=0.0)
        needs = (score is None or code in ALWAYS_REVIEW or any(f.get("needs_review") for f in fs)
                 or conf < review_conf)
        methods = sorted({f["method"] for f in fs})
        out[code] = {"code": code, "level": level, "suggested_score": score, "confidence": round(conf, 2),
                     "needs_review": bool(needs), "evidence_count": len(fs), "methods": methods,
                     "automated": bool(scored) and not needs}
    return out
