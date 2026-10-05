"""What the tool does for each mDLAUG situation — and a starting point for judging it.

These are STARTER heuristics written for this tool, not the mDLAUG team's official
criteria; the guidelines themselves are at https://sites.uwm.edu/mdlaug/. Everything
here is editable from the app's Checks page (stored in the `settings` table), and
every LLM call records a prompt version so changes can be compared over time via
reviewer agreement.
"""
import hashlib
import json

GUIDELINES_URL = "https://sites.uwm.edu/mdlaug/"

# auto: what is determined without a person · llm: task used (if any)
CATALOG = {
    "ACC1": dict(
        title="Difficulty directly accessing files",
        question="When a user meets a link to a file, do they know what it is and what will happen before activating it?",
        auto=["engine: file links get type/size in their name; generic text ('here') flagged",
              "engine: links opening a new window without warning"],
        llm=None,
        rubric="7 — every file link states format (and ideally size) and warns about new windows; an accessible "
               "view exists.\n4 — some links state format; others are 'here'/'download' or open unannounced.\n"
               "1 — file links are generic, unannounced, and force downloads.",
        review="Open an item with attachments on a phone with VoiceOver/TalkBack. Swipe to each file link: does the "
               "announcement say what the file is? Activate one: does it download, open a new tab, or open inline — "
               "and were you told?"),
    "ACC2/COM3": dict(
        title="Difficulty accessing/comprehending images",
        question="Does each meaningful image have a text alternative that conveys what a sighted user gets from it?",
        auto=["engine: missing alt, filename-like alt, large images marked decorative, SVG/canvas/CSS-background images",
              "LLM: judges whether existing alt text is meaningful in context"],
        llm="judge_alt_text",
        rubric="7 — content images have specific, context-appropriate alt; decorative images are hidden.\n"
               "4 — alt exists but is generic ('image', 'photo') or repeats nearby text.\n"
               "1 — content images lack alt or use file names.",
        review="Check 2–3 flagged images: read the alt aloud without looking. Would you know why the image is "
               "there? Is a long description needed (maps, manuscripts)?"),
    "ACC3/COM4": dict(
        title="Difficulty accessing/comprehending graphs",
        question="Can a user get the data and the main message of a chart without seeing it?",
        auto=["engine: charts (SVG/canvas/image) flagged as needing a description or data table"],
        llm=None,
        rubric="7 — chart has a summary of its takeaway plus an accessible data table.\n"
               "4 — a short alt or caption only.\n1 — no text alternative.",
        review="Always reviewed. Find a chart (often in item records or reports). Is there a text summary and a "
               "table? Charts are rare in many DLs — mark N/A if none exist."),
    "ACC4": dict(
        title="Difficulty accessing collection items",
        question="Are collection items presented as a navigable set a screen reader can move through and count?",
        auto=["engine: repeated item cards exposed as a list"],
        llm=None,
        rubric="7 — items are a list (screen reader announces 'list, 20 items') with clear titles.\n"
               "4 — items are separate but not grouped.\n1 — items are an unstructured visual grid.",
        review="On a browse/collection page, swipe through items: is the count announced, can you move item to item?"),
    "ACC5": dict(
        title="Difficulty accessing expandable/collapsed content",
        question="Do expand/collapse controls say whether they are open or closed?",
        auto=["engine: custom disclosures get aria-expanded; existing aria-expanded counted as good"],
        llm=None,
        rubric="7 — every toggle announces expanded/collapsed and is a button.\n4 — some do.\n1 — none do.",
        review="Toggle a 'show more' or accordion: is the state announced, and does focus stay sensible?"),
    "ACC6": dict(
        title="Difficulty accessing a query suggestion",
        question="If search suggests queries as you type, can a screen-reader user hear and choose them?",
        auto=["probe: types into search, waits for suggestions, checks combobox/listbox semantics"],
        llm=None,
        rubric="7 — combobox with announced suggestions, arrow-key navigable.\n4 — suggestions appear but aren't "
               "announced or reachable by keyboard.\n1 — suggestions trap or confuse focus.\nN/A — no suggestions.",
        review="Type slowly in the search box with a screen reader on: are suggestion counts/options announced?"),
    "COM1": dict(
        title="Difficulty understanding a digital library structure",
        question="Can a user grasp what the site is and how it's organized from its headings and landmarks?",
        auto=["engine: main landmark, one h1, skip link", "LLM: judges the heading outline + landmark list"],
        llm="judge_structure",
        rubric="7 — clear h1 stating the library, logical heading levels, labeled landmarks.\n"
               "4 — some structure but skipped levels or unlabeled regions.\n1 — no headings/landmarks.",
        review="Use the screen reader's headings/landmarks list on the home page: does it tell you what's here?"),
    "COM2/NAV1": dict(
        title="Difficulty understanding/navigating the search filtering structure",
        question="Are search filters grouped and labeled so a user knows what each filter set does?",
        auto=["probe: finds filter/facet blocks; checks grouping and labels", "engine: facet panel region"],
        llm=None,
        rubric="7 — filters are labeled groups (headings/fieldsets), applied filters are listed.\n"
               "4 — filters present but ungrouped or unlabeled.\n1 — filters unusable without sight.",
        review="On results, jump through filters: are groups named? Can you see which filters are applied?"),
    "EVA1": dict(
        title="Difficulty assessing relevance of a collection or an item",
        question="Do search results give enough information to decide what's worth opening?",
        auto=["probe: collects result entries as read aloud", "LLM: judges whether entries support relevance decisions"],
        llm="judge_snippets",
        rubric="7 — each result has a descriptive title plus date/type/description.\n"
               "4 — titles only, or long unstructured text.\n1 — results are generic ('Item 1') or links only.",
        review="Listen to the first 5 results: could you pick the right one without opening them?"),
    "EXE1": dict(
        title="Difficulty clearing a search box",
        question="Is there a labeled, reachable way to clear the search box?",
        auto=["probe: looks for a clear/reset control near the search box and checks its name"],
        llm=None,
        rubric="7 — a labeled 'Clear search' control; clearing is confirmed.\n4 — an unlabeled ×, or only the "
               "browser's native clear.\n1 — no way except deleting characters.",
        review="Type a query, then try to clear it with the screen reader alone."),
    "EXE2": dict(
        title="Difficulty exiting an open item",
        question="Can a user close an open item, viewer, or overlay and get back?",
        auto=["probe: dialogs open on load — does Escape close them, are they aria-modal?",
              "engine: dialog semantics and close controls"],
        llm=None,
        rubric="7 — labeled close control, Escape works, focus returns.\n4 — closes but focus is lost.\n"
               "1 — user is trapped.",
        review="Open an item viewer or overlay and leave it using only the screen reader."),
    "EXE3": dict(
        title="Difficulty returning to a previous page",
        question="Is there a clear way back (breadcrumb, back to results) besides the browser button?",
        auto=["engine: breadcrumb as labeled navigation"],
        llm=None,
        rubric="7 — breadcrumb landmark and 'back to results'.\n4 — one of them.\n1 — neither.",
        review="From an item page, return to your results: is the route announced?"),
    "FIL1": dict(
        title="Difficulty finding/locating an icon-based search feature",
        question="If search is an icon (magnifier) or hidden behind one on mobile, is it named?",
        auto=["probe: detects icon-only search buttons and search toggles; checks their names"],
        llm=None,
        rubric="7 — icon controls are named ('Search').\n1 — icon announced as 'button' or unlabeled.\n"
               "N/A — search uses a visible text button.",
        review="Swipe to the magnifier icon: what does the screen reader say?"),
    "FIL2/RED3": dict(
        title="Difficulty finding/locating/distinguishing search features at different levels",
        question="Can a user find the search box, and tell different searches (site vs. collection) apart?",
        auto=["probe: finds the search box (incl. behind a toggle), its name, search landmark, Tab presses to reach"],
        llm=None,
        rubric="7 — search is in a search landmark, named, and reached early; scopes are labeled.\n"
               "4 — named but no landmark, placeholder-only, or hidden behind a toggle.\n1 — not findable.",
        review="Use the landmarks rotor to find search. If several search boxes exist, are they distinguishable?"),
    "FIL3/HEP1": dict(
        title="Difficulty finding/locating/using mobile-specific help information",
        question="Is help easy to find, and does it explain how to use the library (ideally with AT/mobile tips)?",
        auto=["probe: finds help/FAQ/accessibility links and where they sit", "LLM: judges the help page content"],
        llm="judge_help",
        rubric="7 — help linked from main navigation; explains searching/viewing; includes screen-reader or mobile "
               "guidance.\n4 — help exists but is generic or buried in the footer.\n1 — no help.",
        review="Always reviewed. Read the help page: would it actually help a screen-reader user on a phone?"),
    "INT1": dict(
        title="Difficulty interacting with multi-layered windows",
        question="When overlays/pop-ups open, is the background inert and focus contained?",
        auto=["probe: dialogs on load (cookie banners etc.) — Escape, aria-modal, focus"],
        llm=None,
        rubric="7 — overlays are aria-modal, focus moves in and returns, Escape closes.\n4 — partly.\n"
               "1 — background reachable/focus lost.",
        review="With an overlay open, swipe: can you reach content behind it?"),
    "NAV2": dict(
        title="Difficulty navigating paginated sections",
        question="Is pagination a labeled navigation with the current page indicated?",
        auto=["probe: pagination landmark + aria-current", "engine: pager semantics"],
        llm=None,
        rubric="7 — 'Pagination' nav landmark, current page announced, page changes announced.\n"
               "4 — links only.\n1 — unlabeled number links/arrows.",
        review="Move to page 2 with a screen reader: is the change and position announced?"),
    "NAV3": dict(
        title="Difficulty navigating through search results",
        question="Can a user move result to result efficiently?",
        auto=["probe: results as a list or with per-item headings", "engine: results structure"],
        llm=None,
        rubric="7 — results are a list with a heading per item.\n4 — one of those.\n1 — undifferentiated text.",
        review="Use heading navigation on results: does each result have one?"),
    "NAV4": dict(
        title="Difficulty navigating within an item",
        question="In a long item, can a user jump between parts?",
        auto=["engine: headings/contents within items"],
        llm=None,
        rubric="7 — item has headings or a contents list; viewers expose pages.\n4 — partial.\n1 — none.",
        review="Open a multi-page item: can you jump to a section or page?"),
    "NAV5": dict(
        title="Difficulty navigating to a search result section",
        question="After searching, can a user get straight to the results?",
        auto=["probe: focus after search, skip-to-results link, results heading"],
        llm=None,
        rubric="7 — focus moves to results or a skip link exists.\n4 — results heading only.\n1 — must swipe "
               "through everything.",
        review="Search, then count swipes to the first result."),
    "RED1": dict(
        title="Difficulty recognizing the availability of search results",
        question="Is the user told when results are ready, and how many?",
        auto=["probe: result count present and inside a live/status region"],
        llm=None,
        rubric="7 — count announced via a live region; 'no results' clearly stated.\n4 — count shown but not "
               "announced.\n1 — no count/status.",
        review="Run a search with the screen reader on: is anything announced?"),
    "RED2": dict(
        title="Difficulty distinguishing collection titles from thumbnails",
        question="Are thumbnails kept from repeating or obscuring titles?",
        auto=["probe: thumbnails whose alt/link duplicates the title link"],
        llm=None,
        rubric="7 — title announced once; thumbnails decorative or combined into one link.\n4 — some duplication.\n"
               "1 — every item announced twice or thumbnails announced as file names.",
        review="Swipe through a few results: is each title heard once?"),
    "RED4": dict(
        title="Difficulty recognizing authorized features",
        question="When something needs sign-in or is restricted, is that explained before the user tries it?",
        auto=["probe: restricted-looking controls and nearby text", "LLM: judges whether why/how is explained"],
        llm="judge_restricted",
        rubric="7 — restricted controls say why and how to gain access.\n4 — say restricted, not how.\n"
               "1 — look usable but fail silently.",
        review="Always reviewed. Find a restricted item/download: what does the screen reader say about it?"),
    "USE1": dict(
        title="Difficulty using screen readers and voice-activated commands",
        question="Do controls have names screen readers announce and voice control can target?",
        auto=["probe: share of interactive elements with names; aria-label vs visible text mismatches"],
        llm=None,
        rubric="7 — all controls named; names match visible labels (voice control works).\n4 — some unnamed or "
               "mismatched.\n1 — many unnamed.",
        review="Always reviewed: proxies can't replace real AT testing. Try Voice Control: 'tap Search', "
               "'tap Next' — do they work?"),
}

DEFAULT_TASK_SITUATION = {"judge_alt_text": "ACC2/COM3", "judge_structure": "COM1", "judge_snippets": "EVA1",
                          "judge_help": "FIL3/HEP1", "judge_restricted": "RED4"}


def merged(store=None):
    """CATALOG with any saved overrides (rubric/review/prompt) applied."""
    cat = {k: dict(v) for k, v in CATALOG.items()}
    if store is not None:
        for row in store.get_settings("check:"):
            code = row["key"][len("check:"):]
            if code in cat:
                try:
                    cat[code].update(json.loads(row["value"]))
                except Exception:
                    pass
    return cat


def prompt_version(*parts):
    return hashlib.sha256("|".join(p or "" for p in parts).encode()).hexdigest()[:8]
