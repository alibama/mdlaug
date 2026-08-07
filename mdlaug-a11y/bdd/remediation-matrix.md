# Remediation matrix — algorithmic vs. manual

How each additional guideline (from the evaluation forum) can be satisfied.

- **algorithmic** — the extension can satisfy it by rewriting the DOM alone.
- **hybrid** — the structure is automatable; the *content* (alt text, a description, a transcript, a real label, a data table) needs a human or a configured model/service.
- **manual** — needs authored content, backend/app data, design policy, or cross-AT testing.

**Summary (63 guidelines):** 15 algorithmic · 26 hybrid · 22 manual.
By status: 15 app-layer · 10 implemented · 8 manual · 21 proposed · 9 service.

| Situation | Additional guideline | Class | Status | Engine rule |
|---|---|---|---|---|
| ACC1 | Provide a preview of file contents before download. | algorithmic | implemented | file-links |
| ACC1 | Offer accessible alternative formats (HTML, EPUB, tagged PDF) whenever possible. | hybrid | service | file-links |
| ACC1 | Preserve users' navigation context after viewing or downloading a file. | algorithmic | implemented | file-links |
| ACC2/COM3 | Allow users to choose between brief and detailed image descriptions. | hybrid | service | images-alt images-nontag |
| ACC2/COM3 | Provide image descriptions at different levels (overview, detailed, scholarly context). | manual | manual | images-alt images-nontag |
| ACC2/COM3 | Allow users to request AI-generated supplemental descriptions, clearly identified as AI-generated. | hybrid | service | images-alt images-nontag |
| ACC3/COM4 | Provide downloadable data tables corresponding to every graph. | hybrid | app-layer | graphs-longdesc |
| ACC3/COM4 | Present textual summaries highlighting trends, comparisons, and outliers. | manual | service | graphs-longdesc |
| ACC3/COM4 | Allow users to ask natural-language questions about graph content. | manual | app-layer | graphs-longdesc |
| ACC4 | Present breadcrumb navigation showing collection hierarchy. | hybrid | implemented | collection-items |
| ACC4 | Provide collection statistics (number of items, formats, dates, subjects). | manual | app-layer | collection-items |
| ACC4 | Allow direct navigation to popular or recently added items. | manual | app-layer | collection-items |
| ACC5 | Automatically announce expanded/collapsed status changes. | algorithmic | proposed | disclosure |
| ACC5 | Remember users' expansion preferences during the browsing session. | hybrid | proposed | disclosure |
| ACC5 | Provide "Expand all" and "Collapse all" options. | algorithmic | proposed | disclosure |
| ACC6 | Rank suggestions according to search history and collection popularity. | manual | app-layer | autocomplete |
| ACC6 | Provide semantic query suggestions (broader, narrower, related terms). | manual | app-layer | autocomplete |
| ACC6 | Allow users to disable or customize auto-suggestions. | hybrid | proposed | autocomplete |
| COM1 | Provide a site overview or orientation page for first-time users. | manual | app-layer | landmarks |
| COM1 | Offer an accessible sitemap. | hybrid | proposed | landmarks |
| COM1 | Maintain consistent page layouts across collections. | manual | manual | landmarks |
| COM2/NAV1 | Display currently applied filters in an easily reviewable summary. | hybrid | proposed | filter-groups |
| COM2/NAV1 | Explain how each filter affects search results. | manual | manual | filter-groups |
| COM2/NAV1 | Provide one-click removal of individual filters and "Clear all filters." | hybrid | proposed | filter-groups |
| EVA1 | Explain why an item appears in search results. | manual | app-layer | result-relevance |
| EVA1 | Highlight matching query terms within snippets. | algorithmic | proposed | result-relevance |
| EVA1 | Provide AI-generated summaries that explain an item's relevance. | hybrid | service | result-relevance |
| EXE1 | Confirm successful clearing of search terms through accessible feedback. | algorithmic | proposed | clear-search |
| EXE1 | Offer recent searches after clearing the query. | manual | app-layer | clear-search |
| EXE1 | Provide an undo option after accidental clearing. | hybrid | proposed | clear-search |
| EXE2 | Restore the user's previous reading position automatically. | hybrid | proposed | dialog-escape |
| EXE2 | Provide multiple exit methods (Back, Close, Escape gesture, voice command). | algorithmic | implemented | dialog-escape |
| EXE2 | Warn users before leaving when annotations or edits may be lost. | manual | app-layer | dialog-escape |
| FIL2/RED3 | Clearly announce the scope of every search (site, collection, results). | hybrid | proposed | search-regions |
| FIL2/RED3 | Allow users to switch search scope without losing entered queries. | manual | app-layer | search-regions |
| FIL2/RED3 | Maintain consistent terminology across all search interfaces. | manual | manual | search-regions |
| FIL3/HEP1 | Provide contextual help that adapts to the current task. | manual | app-layer | help-affordance |
| FIL3/HEP1 | Include short accessible video or audio tutorials. | hybrid | service | help-affordance |
| FIL3/HEP1 | Offer searchable help documentation. | manual | app-layer | help-affordance |
| NAV2 | Allow users to choose between pagination and continuous scrolling. | manual | app-layer | pagination |
| NAV2 | Preserve reading position when returning from an item. | hybrid | proposed | pagination |
| NAV2 | Announce page transitions and total pages. | algorithmic | proposed | pagination |
| NAV4 | Allow users to bookmark sections within documents. | hybrid | proposed | within-item-nav |
| NAV4 | Provide automatically generated tables of contents for OCR documents. | hybrid | service | within-item-nav |
| NAV4 | Support heading navigation even in converted documents. | algorithmic | implemented | within-item-nav |
| NAV5 | Automatically move focus to search results after search completion (optional). | algorithmic | proposed | results-status |
| NAV5 | Announce the location and number of search results. | algorithmic | implemented | results-status |
| NAV5 | Provide a "Skip to search results" shortcut. | algorithmic | implemented | results-status |
| RED1 | Provide progressive feedback during long-running searches. | hybrid | proposed | results-status |
| RED1 | Clearly distinguish "no results" from loading or network errors. | hybrid | app-layer | results-status |
| RED1 | Announce when search results have been updated dynamically. | algorithmic | implemented | results-status |
| RED2 | Allow users to suppress decorative images entirely. | algorithmic | implemented | images-alt |
| RED2 | Present titles before thumbnail descriptions consistently. | hybrid | proposed | images-alt |
| RED2 | Separate title and image description with semantic grouping. | hybrid | proposed | images-alt |
| RED4 | Explain why a feature is unavailable. | hybrid | proposed | authorized-features |
| RED4 | Indicate what actions are needed to gain access. | manual | manual | authorized-features |
| RED4 | Avoid presenting inaccessible controls as fully interactive. | algorithmic | implemented | authorized-features |
| USE1 | Test compatibility across major assistive technologies (VoiceOver, TalkBack, Narrator, JAWS, NVDA). | manual | manual | icon-buttons |
| FORM1 | Identify and describe form errors in text, associated with their field. | hybrid | proposed | form-fields |
| FORM1 | Provide a human-written label when none exists anywhere. | manual | manual | form-fields |
| MED1 | Provide captions/subtitles for video. | hybrid | service | media-captions |
| MED1 | Provide a transcript for audio and video. | hybrid | service | media-captions |
| MED1 | Provide audio description for video. | manual | manual | media-captions |
