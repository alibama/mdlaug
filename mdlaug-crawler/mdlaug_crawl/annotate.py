"""Draw annotations onto a clean full-page screenshot.

Annotations are stored as page-coordinate boxes (CSS px) so they can be redrawn
filtered — e.g. only the boxes for the situation under review. Rendering uses
numbered markers on the page and a key panel beside it, so labels never cover
the content being judged.
"""
import textwrap

from PIL import Image, ImageDraw, ImageFont

COLORS = {"good": (26, 127, 55), "issue": (198, 40, 40), "review": (214, 120, 0), "info": (21, 101, 192),
          "fixed": (13, 110, 120), "added": (124, 58, 237)}
LABELS = {"good": "done well", "issue": "issue found", "review": "needs review",
          "fixed": "changed by repair", "added": "added by repair", "info": "info"}
LEGEND = [("good", "done well"), ("issue", "issue found"), ("review", "needs review")]
SEVERITY = {"issue": 3, "review": 2, "added": 2, "fixed": 1, "info": 1, "good": 0}
SOURCE = {"engine": "engine", "probe": "probe", "llm": "LLM"}
PANEL_W = 380


def _font(size, bold=False):
    names = (["DejaVuSans-Bold.ttf", "arialbd.ttf", "Arial Bold.ttf"] if bold else []) + \
            ["DejaVuSans.ttf", "arial.ttf", "Arial.ttf"]
    for name in names:
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def is_situation(code):
    return code[:3] in {"ACC", "COM", "EVA", "EXE", "FIL", "INT", "NAV", "RED", "USE", "HEP", "FOR", "MED"}


def matches(item_code, codes):
    """Does an annotation code ('FIL2', 'ACC2') belong to a requested situation code
    ('FIL2/RED3')? Tokens are compared, so 'COM2' matches 'COM2/NAV1'."""
    if not codes:
        return True
    toks = set()
    for c in codes:
        toks.update(c.split("/"))
    return item_code in toks or any(item_code.startswith(t) for t in toks)


def group(items):
    """Merge marks on the same box; a group takes its most severe status."""
    groups = {}
    for a in items:
        key = (a["x"] // 4, a["y"] // 4, a["w"] // 4, a["h"] // 4)
        g = groups.setdefault(key, {"x": a["x"], "y": a["y"], "w": a["w"], "h": a["h"], "notes": []})
        note = (a["code"], a["status"], a["label"], a.get("source", "probe"))
        if note not in g["notes"]:
            g["notes"].append(note)
    out = list(groups.values())
    for g in out:
        g["status"] = max((n[1] for n in g["notes"]), key=lambda s: SEVERITY.get(s, 0))
    return sorted(out, key=lambda g: (g["y"], g["x"]))


def draw(image_path, annotations, codes=None, statuses=None, include_wcag=False, max_height=5000, title=None):
    """Return a PIL image: screenshot with numbered boxes + a key panel."""
    shot = Image.open(image_path).convert("RGB")
    meta = (annotations or {}).get("meta", {})
    items = [a for a in (annotations or {}).get("items", [])
             if (include_wcag or is_situation(a["code"]) or a["status"] in ("fixed", "added")) and matches(a["code"], codes)
             and (not statuses or a["status"] in statuses)]
    scale = shot.width / float(meta.get("scrollW") or meta.get("vw") or shot.width)
    if max_height and shot.height > max_height:
        shot = shot.crop((0, 0, shot.width, max_height))
    groups = [g for g in group(items) if g["y"] * scale < shot.height]

    d = ImageDraw.Draw(shot)
    badge_f = _font(14, bold=True)
    r = 11
    placed = []
    for i, g in enumerate(groups, 1):
        col = COLORS.get(g["status"], COLORS["info"])
        x0, y0 = g["x"] * scale, g["y"] * scale
        x1, y1 = (g["x"] + g["w"]) * scale, (g["y"] + g["h"]) * scale
        d.rectangle([x0, y0, x1, y1], outline=col, width=3)
        cx = min(max(x0, r + 1), shot.width - r - 1)
        cy = min(max(y0, r + 1), shot.height - r - 1)
        while any(abs(cx - px_) < 2 * r + 2 and abs(cy - py_) < 2 * r + 2 for px_, py_ in placed):
            cx += 2 * r + 3                      # don't let badges hide each other
        placed.append((cx, cy))
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col, outline=(255, 255, 255), width=2)
        t = str(i)
        d.text((cx - d.textlength(t, font=badge_f) / 2, cy - 9), t, fill=(255, 255, 255), font=badge_f)

    body_f, head_f, num_f = _font(13), _font(14, bold=True), _font(11, bold=True)
    lines = []
    for i, g in enumerate(groups, 1):
        first = True
        for code, status, label, src in g["notes"]:
            txt = f"{code}: {label} ({SOURCE.get(src, src)})"
            for j, w in enumerate(textwrap.wrap(txt, 40) or [""]):
                # numbered line takes the group's (merged) colour so it matches the box
                lines.append((i if first and j == 0 else None, g["status"] if first and j == 0 else status, w))
            first = False
    line_h = 20
    H = max(shot.height, 70 + line_h * max(1, len(lines)))
    out = Image.new("RGB", (shot.width + PANEL_W, H), (255, 255, 255))
    out.paste(shot, (0, 0))
    pd_ = ImageDraw.Draw(out)
    px = shot.width + 14
    pd_.rectangle([shot.width, 0, shot.width + PANEL_W, H], fill=(246, 248, 247))
    pd_.line([shot.width, 0, shot.width, H], fill=(200, 210, 205), width=2)
    present = [k for k in LABELS if any(g["status"] == k for g in groups)]
    legend = [(k, LABELS[k]) for k in present] or LEGEND
    counts = {k: sum(1 for g in groups if g["status"] == k) for k, _ in legend}
    x, y = px, 10
    for k, label in legend:
        pd_.rectangle([x, y + 2, x + 13, y + 15], fill=COLORS[k])
        t = f"{label} {counts[k]}"
        pd_.text((x + 18, y), t, fill=(30, 30, 30), font=body_f)
        x += 26 + int(pd_.textlength(t, font=body_f))
    y = 38
    pd_.text((px, y), (title or "Marks on this page") + (f" — {', '.join(codes)}" if codes else ""), fill=(20, 40, 35), font=head_f)
    y += 24
    if not lines:
        pd_.text((px, y), "No marks for this selection.", fill=(90, 90, 90), font=body_f)
    for num, status, text in lines:
        col = COLORS.get(status, COLORS["info"])
        if num is not None:
            pd_.ellipse([px, y, px + 18, y + 18], fill=col)
            pd_.text((px + 9 - pd_.textlength(str(num), font=num_f) / 2, y + 3), str(num), fill=(255, 255, 255), font=num_f)
        else:
            pd_.rectangle([px + 7, y + 4, px + 11, y + 14], fill=col)
        pd_.text((px + 26, y + 1), text, fill=(30, 30, 30), font=body_f)
        y += line_h
    return out
