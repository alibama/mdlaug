/*
 * mDLAUG BDD data store — source of truth + generator.
 *
 * Models the remediation knowledge on the ontology from Silva et al.'s
 * "BDD ontology" (User Story -> Narrative + Scenarios; a Scenario is a set of
 * Given/When/Then Steps; Steps describe Behaviors on Interaction Elements over
 * Data). Here:
 *   - each mDLAUG situation is a User Story (role = a screen-reader / VI user),
 *   - the remediation acceptance criteria are Scenarios (Given/When/Then),
 *   - "Interaction Elements" are the DOM element types involved,
 *   - each additional guideline (from the evaluation forum, P26) is tagged with
 *     how it can be satisfied: algorithmic | hybrid | manual, plus a status.
 *
 * Classification key (the "algorithmic vs manual" question):
 *   algorithmic  the extension can satisfy it by rewriting the DOM alone
 *                (roles, names, states, landmarks, focus, live regions).
 *   hybrid       the structural half is automatable, but the *content* half
 *                (alt text, a description, a transcript, a real label, a data
 *                table) must come from a human or a configured model/service.
 *   manual       needs authored content, backend/app data, design policy, or a
 *                QA process across assistive technologies — not DOM-remediable.
 *
 * Status:
 *   implemented  a rule for it already ships in the engine.
 *   proposed     algorithmically feasible; a candidate rule, not yet built.
 *   service      needs a configured model/endpoint (description/transcription/summary).
 *   app-layer    requires the digital library's backend/app to change.
 *   manual       requires human-authored content or a testing process.
 *
 * Run:  node bdd/build.js   -> writes mdlaug-bdd.json, features/*.feature,
 *                             remediation-matrix.md; validates against the engine.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const engine = require("../extension/engine/remediator.js");

const S = (role, feature, benefit) => ({ role, feature, benefit });
const sc = (name, given, when, then) => ({ name, given, when, then });
// guideline: g(text, classification, status, rationale, scenario?)
const g = (text, classification, status, rationale, scenario) => ({ text, classification, status, rationale, scenario: scenario || null });

const VI = "a screen-reader or low-vision user";

const DATA = [
  {
    code: "ACC1", title: "Difficulty directly accessing files", level: "A", wcag: "2.4.4, 3.2.2, 4.1.2",
    elements: ["Link", "Button"], engineRules: ["file-links"],
    userStory: S(VI, "linked files to announce their type, size, and new-window behaviour, and to be previewable inline", "I know what a link will do before I activate it, and can read it without losing my place"),
    core: [sc("A file link lacking format information is repaired",
      ["a link to \"guide.pdf\" with the text \"Reading room guide\""],
      ["the page is remediated"],
      ["the link's accessible name announces it is a \"PDF file\"", "a link opening in a new window announces \"opens in new window\"", "an inline-view control is offered"])],
    guidelines: [
      g("Provide a preview of file contents before download.", "algorithmic", "implemented",
        "The ACC1 rule already injects an inline viewer for supported formats (PDF/DOCX) via the converter; no server change needed.",
        sc("A supported file can be previewed inline",
          ["a link to a PDF or DOCX file"], ["the user activates \"View inline\""],
          ["the file is rendered as accessible HTML in place, without a download"])),
      g("Offer accessible alternative formats (HTML, EPUB, tagged PDF) whenever possible.", "hybrid", "service",
        "Client-side conversion to accessible HTML/DOCX is algorithmic (the converter does it); EPUB and tagged-PDF generation, or serving them as canonical assets, is an app-layer/authoring task."),
      g("Preserve users' navigation context after viewing or downloading a file.", "algorithmic", "implemented",
        "Rendering inline (rather than navigating away) preserves context; focus is returned on close.")
    ]
  },
  {
    code: "ACC2/COM3", title: "Difficulty accessing/comprehending images", level: "A", wcag: "1.1.1",
    elements: ["Image", "SVG", "Canvas", "CSS background"], engineRules: ["images-alt", "images-nontag"],
    userStory: S(VI, "every meaningful image to have a text alternative, at a level of detail I can choose", "I can understand what an image conveys"),
    core: [sc("A content image without a usable alt is flagged, and non-<img> images are found",
      ["an <img> with no alt, a filename-like alt, an empty alt on a large image, or an SVG/canvas/CSS-background image"],
      ["the page is remediated"],
      ["the element is exposed as an image needing a text alternative (data-mdlaug-needs-alt)", "the tool never invents the alt text"])],
    guidelines: [
      g("Allow users to choose between brief and detailed image descriptions.", "hybrid", "service",
        "A brief/detailed toggle is algorithmic UI; the two description texts must come from authored alt/longdesc or from a description service prompted at two levels."),
      g("Provide image descriptions at different levels (overview, detailed, scholarly context).", "manual", "manual",
        "Overview/detailed can be model-drafted, but scholarly/curatorial context is authored knowledge the tool must not fabricate."),
      g("Allow users to request AI-generated supplemental descriptions, clearly identified as AI-generated.", "hybrid", "service",
        "Implemented pattern: with a configured description endpoint the Reading Room fills a description and labels it \"unverified\". The request UI and labelling are algorithmic; the model is a service.",
        sc("An AI description is offered and labelled",
          ["an image needing a description and a configured description service"],
          ["the user requests a description"],
          ["a description is inserted and clearly labelled as auto-generated / unverified"]))
    ]
  },
  {
    code: "ACC3/COM4", title: "Difficulty accessing/comprehending graphs", level: "AA", wcag: "1.1.1",
    elements: ["SVG chart", "Canvas", "Image chart"], engineRules: ["graphs-longdesc"],
    userStory: S(VI, "a graph's data and meaning available as text and as a table", "I can understand the data without seeing the chart"),
    core: [sc("A graph is exposed as needing a data description",
      ["a chart rendered as SVG/canvas/image"], ["the page is remediated"],
      ["the graph is given role=img and flagged as needing a data description/table"])],
    guidelines: [
      g("Provide downloadable data tables corresponding to every graph.", "hybrid", "app-layer",
        "If the underlying data is present in the DOM (e.g. an SVG's data attributes or an adjacent hidden table) the tool can extract and surface it; a chart rendered as a flat image has no data to extract, so the author/app must supply the table."),
      g("Present textual summaries highlighting trends, comparisons, and outliers.", "manual", "service",
        "Requires analysis of the data; a model can draft a summary (service), otherwise authored."),
      g("Allow users to ask natural-language questions about graph content.", "manual", "app-layer",
        "A Q&A interface over the data is an application feature, not a DOM remediation.")
    ]
  },
  {
    code: "ACC4", title: "Difficulty accessing collection items", level: "AA", wcag: "1.3.1",
    elements: ["List", "List item", "Breadcrumb"], engineRules: ["collection-items"],
    userStory: S(VI, "a collection exposed as a navigable list with clear hierarchy", "I can move through items and understand where I am"),
    core: [sc("A results/collection container is exposed as a list",
      ["a container of repeated item cards"], ["the page is remediated"],
      ["the container gets role=list and each item role=listitem"])],
    guidelines: [
      g("Present breadcrumb navigation showing collection hierarchy.", "hybrid", "implemented",
        "Labelling an existing breadcrumb as a nav landmark is algorithmic (see EXE3); constructing a hierarchy where none exists is app-layer."),
      g("Provide collection statistics (number of items, formats, dates, subjects).", "manual", "app-layer",
        "Not reliably derivable from the DOM; comes from the catalogue/backend."),
      g("Allow direct navigation to popular or recently added items.", "manual", "app-layer",
        "Requires usage/recency data from the application.")
    ]
  },
  {
    code: "ACC5", title: "Difficulty accessing expandable/collapsed content", level: "A", wcag: "4.1.2, 4.1.3",
    elements: ["Disclosure/Accordion", "Button"], engineRules: ["disclosure"],
    userStory: S(VI, "disclosures to expose and announce their expanded/collapsed state", "I know whether content is open or closed"),
    core: [sc("A custom disclosure gets state semantics",
      ["a header that toggles a panel with no aria-expanded"], ["the page is remediated"],
      ["the control gets role=button, aria-expanded, and aria-controls to its panel"])],
    guidelines: [
      g("Automatically announce expanded/collapsed status changes.", "algorithmic", "proposed",
        "The tool wires aria-expanded; adding a live-region announcement on toggle is a small proposed extension.",
        sc("A toggle announces its new state",
          ["a remediated disclosure"], ["the user activates it"],
          ["the new expanded/collapsed state is announced politely"])),
      g("Remember users' expansion preferences during the browsing session.", "hybrid", "proposed",
        "The extension can persist open/closed state in session storage and reapply it — algorithmic but stateful and opt-in."),
      g("Provide \"Expand all\" and \"Collapse all\" options.", "algorithmic", "proposed",
        "When a group of disclosures is detected, inject accessible Expand-all/Collapse-all controls.",
        sc("Group controls are offered",
          ["two or more sibling disclosures"], ["the page is remediated"],
          ["accessible \"Expand all\" and \"Collapse all\" buttons are added and operate the group"]))
    ]
  },
  {
    code: "ACC6", title: "Difficulty accessing a query suggestion", level: "AAA", wcag: "4.1.2",
    elements: ["Autocomplete/Combobox", "Listbox", "Option"], engineRules: ["autocomplete"],
    userStory: S(VI, "search autocomplete exposed as a proper combobox with announced options", "I can use suggestions with a screen reader"),
    core: [sc("An autocomplete gets combobox semantics",
      ["a search box with a custom suggestions panel"], ["the page is remediated"],
      ["the input becomes role=combobox with aria-expanded and the list role=listbox / options role=option"])],
    guidelines: [
      g("Rank suggestions according to search history and collection popularity.", "manual", "app-layer",
        "Ranking is a backend/search concern."),
      g("Provide semantic query suggestions (broader, narrower, related terms).", "manual", "app-layer",
        "Requires a thesaurus/knowledge source in the application."),
      g("Allow users to disable or customize auto-suggestions.", "hybrid", "proposed",
        "The extension can add an accessible control to suppress the suggestions panel; honouring it across a session is stateful.")
    ]
  },
  {
    code: "COM1", title: "Difficulty understanding a digital library structure", level: "A", wcag: "1.3.1, 2.4.1",
    elements: ["Landmark", "Heading", "Skip link"], engineRules: ["landmarks"],
    userStory: S(VI, "clear landmarks, one main heading, and a skip link", "I can orient myself and jump to the content"),
    core: [sc("Missing structure is added",
      ["a page with no <main>, no skip link, or a broken heading start"], ["the page is remediated"],
      ["a main landmark and a skip-to-content link are ensured and the heading order is sane"])],
    guidelines: [
      g("Provide a site overview or orientation page for first-time users.", "manual", "app-layer",
        "An authored page/feature."),
      g("Offer an accessible sitemap.", "hybrid", "proposed",
        "A sitemap can be generated from the site's navigation landmarks (algorithmic first pass); a canonical sitemap is app-layer."),
      g("Maintain consistent page layouts across collections.", "manual", "manual",
        "A design/authoring policy, not a per-page remediation.")
    ]
  },
  {
    code: "COM2/NAV1", title: "Difficulty understanding/navigating the search filtering structure", level: "AAA", wcag: "1.3.1",
    elements: ["Facet region", "Checkbox group", "Filter chip"], engineRules: ["filter-groups"],
    userStory: S(VI, "the filter panel exposed as a labelled region with grouped controls", "I can understand and operate the filters"),
    core: [sc("A facet panel becomes a labelled region",
      ["a filters sidebar with no region semantics"], ["the page is remediated"],
      ["the panel gets role=region with an accessible label and grouped controls"])],
    guidelines: [
      g("Display currently applied filters in an easily reviewable summary.", "hybrid", "proposed",
        "Active filter chips present in the DOM can be collected into a labelled \"applied filters\" summary region (algorithmic); if the app doesn't render them, it's app-layer."),
      g("Explain how each filter affects search results.", "manual", "manual",
        "Explanatory content is authored."),
      g("Provide one-click removal of individual filters and \"Clear all filters.\"", "hybrid", "proposed",
        "Where removable filter chips exist, the tool can ensure each has an accessible remove control and add a \"Clear all\"; wiring removal to the app is app-layer.")
    ]
  },
  {
    code: "EVA1", title: "Difficulty assessing relevance of a collection or an item", level: "A", wcag: "2.4.4",
    elements: ["Result item", "Snippet", "Link"], engineRules: ["result-relevance"],
    userStory: S(VI, "result titles and snippets that make each item's relevance clear", "I can decide what to open"),
    core: [sc("Result items get descriptive link semantics",
      ["a list of result rows"], ["the page is remediated"],
      ["each result's primary link has a meaningful accessible name"])],
    guidelines: [
      g("Explain why an item appears in search results.", "manual", "app-layer",
        "Match rationale comes from the search engine."),
      g("Highlight matching query terms within snippets.", "algorithmic", "proposed",
        "The tool can read the query (from the URL or the search box) and wrap matches in result snippets with <mark>, exposing them to assistive tech.",
        sc("Query terms are highlighted in snippets",
          ["a results page reached with a query \"harbor\""], ["the page is remediated"],
          ["occurrences of \"harbor\" in each snippet are marked and announced as highlighted"])),
      g("Provide AI-generated summaries that explain an item's relevance.", "hybrid", "service",
        "A model can draft a relevance summary (service); the trigger/labelling is algorithmic.")
    ]
  },
  {
    code: "EXE1", title: "Difficulty clearing a search box", level: "A", wcag: "2.1.1",
    elements: ["Clear button", "Search input"], engineRules: ["clear-search"],
    userStory: S(VI, "an accessible, keyboard-operable clear control with feedback", "I can clear my query and know it worked"),
    core: [sc("A clear affordance is named and operable",
      ["a search box with an unlabelled × control"], ["the page is remediated"],
      ["the clear control gets a name and is keyboard-operable"])],
    guidelines: [
      g("Confirm successful clearing of search terms through accessible feedback.", "algorithmic", "proposed",
        "On clear, announce \"search cleared\" via a live region.",
        sc("Clearing is confirmed",
          ["a remediated clear control"], ["the user activates it"],
          ["the search box is emptied and \"search cleared\" is announced"])),
      g("Offer recent searches after clearing the query.", "manual", "app-layer",
        "Requires search history from the application."),
      g("Provide an undo option after accidental clearing.", "hybrid", "proposed",
        "The extension can stash the last query and offer an accessible \"undo\"; within-page only.")
    ]
  },
  {
    code: "EXE2", title: "Difficulty exiting an open item", level: "A", wcag: "2.1.2, 4.1.2",
    elements: ["Dialog/Modal", "Close button"], engineRules: ["dialog-escape"],
    userStory: S(VI, "a way out of any open item or modal by button and Escape, with focus managed", "I never get trapped"),
    core: [sc("A modal gets exit semantics",
      ["an open modal with no aria-modal and no keyboard close"], ["the page is remediated"],
      ["the dialog gets role=dialog/aria-modal, a labelled close control, and Escape closes it"])],
    guidelines: [
      g("Restore the user's previous reading position automatically.", "hybrid", "proposed",
        "The extension can remember scroll/focus position on open and restore it on close — within-session, algorithmic."),
      g("Provide multiple exit methods (Back, Close, Escape gesture, voice command).", "algorithmic", "implemented",
        "Escape-to-close and a labelled Close control are added; voice is provided by the assistive technology once the control is named."),
      g("Warn users before leaving when annotations or edits may be lost.", "manual", "app-layer",
        "The app must signal that unsaved state exists.")
    ]
  },
  {
    code: "EXE3", title: "Difficulty returning to a previous page", level: "AA", wcag: "2.4.8",
    elements: ["Breadcrumb", "Back control"], engineRules: ["back-affordance"],
    userStory: S(VI, "a clear, labelled way back and a breadcrumb trail", "I can retrace my steps"),
    core: [sc("A breadcrumb becomes a labelled landmark",
      ["a breadcrumb trail with no nav semantics"], ["the page is remediated"],
      ["the breadcrumb gets role=navigation with an accessible label \"Breadcrumb\""])],
    guidelines: []
  },
  {
    code: "FIL1", title: "Difficulty finding/locating an icon-based search feature", level: "A", wcag: "4.1.2",
    elements: ["Icon button", "Search control"], engineRules: ["icon-buttons"],
    userStory: S(VI, "icon-only controls (like a magnifier) to have names", "I can find and use them"),
    core: [sc("An icon-only button is named",
      ["a button whose only content is an icon glyph"], ["the page is remediated"],
      ["the button gets a sensible accessible name (e.g. \"Search\")"])],
    guidelines: []
  },
  {
    code: "FIL2/RED3", title: "Difficulty finding/locating/distinguishing search features at different levels", level: "AA", wcag: "1.3.1",
    elements: ["Search region", "Search input"], engineRules: ["search-regions"],
    userStory: S(VI, "each search feature clearly scoped and labelled", "I know what I'm searching"),
    core: [sc("Search controls are grouped into labelled regions",
      ["multiple search inputs at different scopes"], ["the page is remediated"],
      ["each search is placed in a labelled search region"])],
    guidelines: [
      g("Clearly announce the scope of every search (site, collection, results).", "hybrid", "proposed",
        "Where scope is inferable from the input's placeholder/label/container, the tool can add a scope to the accessible name; otherwise authored."),
      g("Allow users to switch search scope without losing entered queries.", "manual", "app-layer",
        "Query preservation across scope changes is application behaviour."),
      g("Maintain consistent terminology across all search interfaces.", "manual", "manual",
        "Authoring/content policy.")
    ]
  },
  {
    code: "FIL3/HEP1", title: "Difficulty finding/locating/using mobile-specific help information", level: "A", wcag: "4.1.2",
    elements: ["Help control", "Help region"], engineRules: ["help-affordance"],
    userStory: S(VI, "help to be findable and usable", "I can get assistance when stuck"),
    core: [sc("A help affordance is exposed",
      ["a help/FAQ control"], ["the page is remediated"],
      ["the help control is named and reachable"])],
    guidelines: [
      g("Provide contextual help that adapts to the current task.", "manual", "app-layer",
        "Task-aware help is an application feature."),
      g("Include short accessible video or audio tutorials.", "hybrid", "service",
        "Authoring the tutorials is manual; captioning/transcribing them is algorithmic via the media rule (MED1) with a transcription service."),
      g("Offer searchable help documentation.", "manual", "app-layer",
        "A documentation/search feature.")
    ]
  },
  {
    code: "INT1", title: "Difficulty interacting with multi-layered windows", level: "A", wcag: "2.1.2, 4.1.2",
    elements: ["Dialog/Modal", "Layered windows"], engineRules: ["dialog-escape"],
    userStory: S(VI, "stacked windows to trap focus correctly and expose the active layer", "I don't get lost between layers"),
    core: [sc("A layered modal is made modal",
      ["a modal stacked over page content"], ["the page is remediated"],
      ["the top layer gets aria-modal and focus semantics so background content is inert to AT"])],
    guidelines: []
  },
  {
    code: "NAV2", title: "Difficulty navigating paginated sections", level: "AA", wcag: "1.3.1, 2.4.1",
    elements: ["Pagination", "Page link"], engineRules: ["pagination"],
    userStory: S(VI, "pagination exposed as a labelled nav landmark with the current page marked", "I can move between pages"),
    core: [sc("A pager becomes a labelled landmark",
      ["a pagination control with no nav semantics"], ["the page is remediated"],
      ["the pager gets role=navigation with a label and the active page gets aria-current=page"])],
    guidelines: [
      g("Allow users to choose between pagination and continuous scrolling.", "manual", "app-layer",
        "A rendering mode of the application."),
      g("Preserve reading position when returning from an item.", "hybrid", "proposed",
        "Within-session scroll/position restore is algorithmic."),
      g("Announce page transitions and total pages.", "algorithmic", "proposed",
        "On page change, announce \"page N of M\" via a live region; total is read from the pager.",
        sc("A page change is announced",
          ["a remediated pager showing N of M pages"], ["the user moves to another page"],
          ["\"page N of M\" is announced politely"]))
    ]
  },
  {
    code: "NAV3", title: "Difficulty navigating through search results", level: "AA", wcag: "4.1.3",
    elements: ["Results region", "Live region"], engineRules: ["results-status"],
    userStory: S(VI, "result updates and structure announced as I move through them", "I can navigate results confidently"),
    core: [sc("The results region announces status",
      ["a results container that updates dynamically"], ["the page is remediated"],
      ["a polite live region announces result availability and updates"])],
    guidelines: []
  },
  {
    code: "NAV4", title: "Difficulty navigating within an item", level: "AA", wcag: "2.4.1, 2.4.5",
    elements: ["Heading", "In-item TOC", "Jump link"], engineRules: ["within-item-nav"],
    userStory: S(VI, "an automatic table of contents and heading navigation inside a document", "I can jump around a long item"),
    core: [sc("An in-item contents list is generated",
      ["a long item with a heading outline"], ["the page is remediated (or opened in the Reading Room)"],
      ["a Contents list of jump links to the item's headings is provided"])],
    guidelines: [
      g("Allow users to bookmark sections within documents.", "hybrid", "proposed",
        "Within-session anchors/bookmarks are algorithmic; persistent cross-session bookmarks are app-layer."),
      g("Provide automatically generated tables of contents for OCR documents.", "hybrid", "service",
        "TOC-from-headings is algorithmic (implemented); an OCR document first needs OCR (service) to recover headings."),
      g("Support heading navigation even in converted documents.", "algorithmic", "implemented",
        "The converter/Reading Room preserves real headings, so AT heading navigation works on converted content.")
    ]
  },
  {
    code: "NAV5", title: "Difficulty navigating to a search result section", level: "A", wcag: "4.1.3",
    elements: ["Skip link", "Results region"], engineRules: ["results-status"],
    userStory: S(VI, "a shortcut to the results and a focus move when results arrive", "I can get to results quickly"),
    core: [sc("A skip-to-results shortcut is added",
      ["a page with a results section below filters"], ["the page is remediated"],
      ["a \"Skip to search results\" link is provided"])],
    guidelines: [
      g("Automatically move focus to search results after search completion (optional).", "algorithmic", "proposed",
        "On search submit, move focus to the results region — offered as an opt-in to avoid surprising focus jumps.",
        sc("Focus moves to results on search",
          ["a search that reloads or updates results", "the move-focus option enabled"], ["a search completes"],
          ["focus is placed on the results region and the count is announced"])),
      g("Announce the location and number of search results.", "algorithmic", "implemented",
        "The results-status live region announces availability/count."),
      g("Provide a \"Skip to search results\" shortcut.", "algorithmic", "implemented",
        "A skip-to-results link is injected.")
    ]
  },
  {
    code: "RED1", title: "Difficulty recognizing the availability of search results", level: "A", wcag: "4.1.3",
    elements: ["Results region", "Live region", "Status"], engineRules: ["results-status"],
    userStory: S(VI, "clear, announced status for searching, results, no-results, and errors", "I know what's happening"),
    core: [sc("Result availability is announced",
      ["a results container"], ["the page is remediated"],
      ["a polite live region announces when results are available or updated"])],
    guidelines: [
      g("Provide progressive feedback during long-running searches.", "hybrid", "proposed",
        "If a loading state is detectable in the DOM, announce \"searching…\"; otherwise the app must signal progress."),
      g("Clearly distinguish \"no results\" from loading or network errors.", "hybrid", "app-layer",
        "The tool can label a detectable empty state as \"no results\", but distinguishing an error requires the app's state."),
      g("Announce when search results have been updated dynamically.", "algorithmic", "implemented",
        "The live region announces dynamic updates.")
    ]
  },
  {
    code: "RED2", title: "Difficulty distinguishing collection titles from thumbnails", level: "AA", wcag: "1.3.1",
    elements: ["Thumbnail image", "Title", "Figure group"], engineRules: ["images-alt"],
    userStory: S(VI, "titles read before decorative thumbnails, cleanly separated", "I hear the title, not image noise"),
    core: [sc("Decorative thumbnails are hidden and titles kept",
      ["result cards where a thumbnail duplicates the title link"], ["the page is remediated"],
      ["purely decorative thumbnails are hidden from AT so the title is what's announced"])],
    guidelines: [
      g("Allow users to suppress decorative images entirely.", "algorithmic", "implemented",
        "Decorative/duplicative thumbnails are hidden with aria-hidden; a global suppress toggle is a small proposed extension."),
      g("Present titles before thumbnail descriptions consistently.", "hybrid", "proposed",
        "Reading order can be corrected with aria-describedby/ordering; visual reordering is riskier and left to the app."),
      g("Separate title and image description with semantic grouping.", "hybrid", "proposed",
        "Wrapping a title+image pair in a figure/group with a caption is algorithmic where the pairing is unambiguous.")
    ]
  },
  {
    code: "RED4", title: "Difficulty recognizing authorized features", level: "AAA", wcag: "4.1.2",
    elements: ["Restricted control", "Disabled control"], engineRules: ["authorized-features"],
    userStory: S(VI, "restricted controls to announce that they're unavailable and why", "I don't waste effort on features I can't use"),
    core: [sc("A restricted control is marked",
      ["a control that is visually gated/locked"], ["the page is remediated"],
      ["the control is marked unavailable (aria-disabled) with its reason if detectable"])],
    guidelines: [
      g("Explain why a feature is unavailable.", "hybrid", "proposed",
        "If a reason (e.g. \"log in to access\") is present nearby, associate it; otherwise the reason must be authored."),
      g("Indicate what actions are needed to gain access.", "manual", "manual",
        "The required-action text is authored content."),
      g("Avoid presenting inaccessible controls as fully interactive.", "algorithmic", "implemented",
        "Gated controls are marked aria-disabled so AT doesn't present them as operable.")
    ]
  },
  {
    code: "USE1", title: "Difficulty using screen readers and voice activated commands", level: "AAA", wcag: "4.1.2",
    elements: ["All interactive elements"], engineRules: ["icon-buttons"],
    userStory: S(VI, "the whole interface to work with my assistive technology and voice control", "I can use the library the way I use everything else"),
    core: [sc("Controls carry names/roles that AT and voice control can target",
      ["interactive controls lacking names/roles"], ["the page is remediated"],
      ["controls gain the names and roles that screen readers and voice-control (\"click <name>\") rely on"])],
    guidelines: [
      g("Test compatibility across major assistive technologies (VoiceOver, TalkBack, Narrator, JAWS, NVDA).", "manual", "manual",
        "Cross-AT verification is a QA process, not a DOM remediation. The tool's automated pass is a first pass; manual screen-reader testing remains necessary.")
    ]
  },
  {
    code: "FORM1", title: "Accessible form fields (login / registration / account)", level: "A", wcag: "1.3.1, 3.3.2, 4.1.2",
    elements: ["Input", "Select", "Textarea", "Label"], engineRules: ["form-fields"],
    userStory: S(VI, "every form field to have a programmatic label and clear required/invalid state", "I can complete forms like sign-in and registration"),
    core: [sc("Fields are labelled and required state reflected",
      ["a form with an unlabelled field, a field with only a placeholder, and a required field"], ["the page is remediated"],
      ["an adjacent label is associated, or the placeholder is used as a fallback name, and required fields get aria-required", "a field with no label and no fallback is flagged for a human-written label"])],
    guidelines: [
      g("Identify and describe form errors in text, associated with their field.", "hybrid", "proposed",
        "Where an error message sits near an invalid field, the tool can wire aria-describedby + aria-invalid; the message wording is authored/app-supplied. (Candidate FORM2.)"),
      g("Provide a human-written label when none exists anywhere.", "manual", "manual",
        "If no label, placeholder, or adjacent text exists, the accessible name must be authored — the tool only flags it.")
    ]
  },
  {
    code: "MED1", title: "Multimedia captions and transcripts (beyond the 24)", level: "A", wcag: "1.2.1, 1.2.2, 1.2.3",
    elements: ["Video", "Audio", "Embedded player"], engineRules: ["media-captions"],
    userStory: S(VI, "video and audio to have captions and a transcript", "I can access multimedia content"),
    core: [sc("Uncaptioned media is detected and, with a service, captioned",
      ["a <video>/<audio> with no captions track, or a YouTube/Vimeo embed"], ["the page is remediated"],
      ["the player is named and flagged", "with a transcription service, a WebVTT caption track and a visible transcript are added and labelled unverified", "third-party embeds are flagged with guidance"])],
    guidelines: [
      g("Provide captions/subtitles for video.", "hybrid", "service",
        "Detection, player naming, and building a WebVTT track from returned segments are algorithmic; the transcription itself is a service (or authored captions)."),
      g("Provide a transcript for audio and video.", "hybrid", "service",
        "The transcript panel is injected algorithmically; its text comes from a transcription service or is authored."),
      g("Provide audio description for video.", "manual", "manual",
        "Described-video narration is authored/produced content.")
    ]
  }
];

// ---- validation against the engine ---------------------------------------
function validate() {
  const problems = [];
  const rules = engine.rules();
  const ruleCodes = new Set(rules.map(r => r.code));
  // dataset covers a token if any dataset code contains it (codes may be compound)
  const dataTokens = new Set();
  DATA.forEach(d => d.code.split("/").forEach(t => dataTokens.add(t)));
  // every engine rule code's tokens should be represented in the dataset
  ruleCodes.forEach(c => c.split("/").forEach(t => { if (!dataTokens.has(t)) problems.push("engine situation token not in dataset: " + t + " (from rule code " + c + ")"); }));
  // every engineRules id referenced by the dataset should exist
  const ruleIds = new Set(rules.map(r => r.id));
  DATA.forEach(d => (d.engineRules || []).forEach(id => { if (!ruleIds.has(id)) problems.push(d.code + " references unknown engine rule id: " + id); }));
  // level consistency where the codes match exactly
  const levelByCode = {}; rules.forEach(r => { levelByCode[r.code] = r.level; });
  DATA.forEach(d => { if (levelByCode[d.code] && levelByCode[d.code] !== d.level) problems.push(d.code + " level mismatch: dataset " + d.level + " vs engine " + levelByCode[d.code]); });
  // every guideline has a valid classification/status
  const CLS = new Set(["algorithmic", "hybrid", "manual"]);
  const ST = new Set(["implemented", "proposed", "service", "app-layer", "manual"]);
  DATA.forEach(d => (d.guidelines || []).forEach(gl => {
    if (!CLS.has(gl.classification)) problems.push(d.code + ": bad classification " + gl.classification);
    if (!ST.has(gl.status)) problems.push(d.code + ": bad status " + gl.status);
  }));
  return problems;
}

// ---- generators ----------------------------------------------------------
function gherkinScenario(s, tags) {
  var out = [];
  if (tags && tags.length) out.push("  " + tags.map(t => "@" + t).join(" "));
  out.push("  Scenario: " + s.name);
  (s.given || []).forEach((g, i) => out.push("    " + (i ? "And " : "Given ") + g));
  (s.when || []).forEach((g, i) => out.push("    " + (i ? "And " : "When ") + g));
  (s.then || []).forEach((g, i) => out.push("    " + (i ? "And " : "Then ") + g));
  return out.join("\n");
}
function toFeature(d) {
  var lines = [];
  lines.push("# mDLAUG " + d.code + "  |  Level " + d.level + "  |  WCAG " + d.wcag);
  lines.push("# Interaction elements: " + (d.elements || []).join(", "));
  lines.push("# Engine rule(s): " + (d.engineRules || []).join(", "));
  lines.push("Feature: " + d.code + " — " + d.title);
  lines.push("  As " + d.userStory.role);
  lines.push("  I want " + d.userStory.feature);
  lines.push("  So that " + d.userStory.benefit);
  lines.push("");
  (d.core || []).forEach(s => { lines.push(gherkinScenario(s, ["core", "algorithmic", "implemented"])); lines.push(""); });
  (d.guidelines || []).forEach(gl => {
    if (gl.scenario) { lines.push(gherkinScenario(gl.scenario, ["guideline", gl.classification, gl.status])); lines.push(""); }
    else {
      lines.push("  # Additional guideline [" + gl.classification + " / " + gl.status + "]: " + gl.text);
      lines.push("  #   " + gl.rationale);
      lines.push("");
    }
  });
  return lines.join("\n") + "\n";
}
function safeName(code) { return code.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase(); }

function matrix() {
  var rows = [];
  var counts = { algorithmic: 0, hybrid: 0, manual: 0 };
  var statusCounts = {};
  DATA.forEach(d => (d.guidelines || []).forEach(gl => {
    counts[gl.classification] = (counts[gl.classification] || 0) + 1;
    statusCounts[gl.status] = (statusCounts[gl.status] || 0) + 1;
    rows.push([d.code, gl.text, gl.classification, gl.status, (d.engineRules || []).join(" ")]);
  }));
  var total = rows.length;
  var out = [];
  out.push("# Remediation matrix — algorithmic vs. manual\n");
  out.push("How each additional guideline (from the evaluation forum) can be satisfied.\n");
  out.push("- **algorithmic** — the extension can satisfy it by rewriting the DOM alone.");
  out.push("- **hybrid** — the structure is automatable; the *content* (alt text, a description, a transcript, a real label, a data table) needs a human or a configured model/service.");
  out.push("- **manual** — needs authored content, backend/app data, design policy, or cross-AT testing.\n");
  out.push("**Summary (" + total + " guidelines):** "
    + counts.algorithmic + " algorithmic · " + counts.hybrid + " hybrid · " + counts.manual + " manual.");
  out.push("By status: " + Object.keys(statusCounts).sort().map(k => statusCounts[k] + " " + k).join(" · ") + ".\n");
  out.push("| Situation | Additional guideline | Class | Status | Engine rule |");
  out.push("|---|---|---|---|---|");
  rows.forEach(r => out.push("| " + r[0] + " | " + r[1].replace(/\|/g, "\\|") + " | " + r[2] + " | " + r[3] + " | " + (r[4] || "—") + " |"));
  return out.join("\n") + "\n";
}

// ---- run -----------------------------------------------------------------
function main() {
  const problems = validate();
  const outDir = __dirname;
  const featDir = path.join(outDir, "features");
  fs.mkdirSync(featDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, "mdlaug-bdd.json"), JSON.stringify({
    schema: "mdlaug-bdd/1",
    generatedAt: new Date().toISOString().slice(0, 10),
    ontology: "User Story -> Narrative + Scenarios (Given/When/Then Steps) -> Behaviors on Interaction Elements over Data",
    classification: { algorithmic: "DOM-remediable by the extension", hybrid: "structure automatable, content human/service", manual: "authored content / app-layer / QA" },
    situations: DATA
  }, null, 2));

  DATA.forEach(d => fs.writeFileSync(path.join(featDir, safeName(d.code) + ".feature"), toFeature(d)));
  fs.writeFileSync(path.join(outDir, "remediation-matrix.md"), matrix());

  // console summary
  var gl = DATA.reduce((n, d) => n + (d.guidelines || []).length, 0);
  var byClass = { algorithmic: 0, hybrid: 0, manual: 0 };
  DATA.forEach(d => (d.guidelines || []).forEach(x => byClass[x.classification]++));
  console.log("situations: " + DATA.length + " | feature files: " + DATA.length + " | additional guidelines: " + gl);
  console.log("classification -> algorithmic:" + byClass.algorithmic + " hybrid:" + byClass.hybrid + " manual:" + byClass.manual);
  if (problems.length) { console.log("VALIDATION PROBLEMS:"); problems.forEach(p => console.log("  - " + p)); process.exit(1); }
  console.log("validation: OK (dataset consistent with engine rules + levels)");
}
main();
