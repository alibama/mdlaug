/* Site pack: Project Blacklight / Samvera (Hyrax) discovery UIs. Starter rules —
   selectors are stable across Blacklight but tune per install. */
(function () {
  var R = window.mDLAUG && window.mDLAUG.remediator; if (!R || !R.registerPack) return;
  R.registerPack({
    id: "blacklight", title: "Blacklight / Samvera", source: "bundled",
    match: { selectors: ["body.blacklight-catalog", "#facets", "#documents .document", ".blacklight-catalog"] },
    rules: [
      { code: "NAV2", level: "AA", describe: "Pagination is a labelled nav landmark", select: "nav.pagination, .pagination", when: { notRole: "navigation" }, set: { role: "navigation", "aria-label": "Search results pages" } },
      { code: "NAV2", level: "AA", describe: "Current results page marked", select: ".pagination .page-item.active a, .pagination li.active a, .page.current", set: { "aria-current": "page" } },
      { code: "COM2/NAV1", level: "AAA", describe: "Facet panel is a labelled region", select: "#facets", when: { notRole: "region" }, set: { role: "region", "aria-label": "Search filters" } },
      { code: "ACC4", level: "AA", describe: "Results list exposed as a list", select: "#documents", when: { notRole: "list" }, set: { role: "list", "aria-label": "Search results" } },
      { code: "ACC4", level: "AA", describe: "Each result exposed as a list item", select: "#documents .document", set: { role: "listitem" } },
      { code: "FIL1", level: "A", describe: "Search submit button named", select: "button.search-btn, .search-query-form button[type=submit]", when: { missingName: true }, set: { "aria-label": "Search" } }
    ]
  });
})();
