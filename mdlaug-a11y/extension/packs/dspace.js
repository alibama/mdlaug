/* Site pack: DSpace 7+ Angular UI (ds-* components). Starter rules. */
(function () {
  var R = window.mDLAUG && window.mDLAUG.remediator; if (!R || !R.registerPack) return;
  R.registerPack({
    id: "dspace", title: "DSpace 7 (Angular)", source: "bundled",
    match: { selectors: ["ds-root", "ds-app", "ds-search-page", "ds-pagination"] },
    rules: [
      { code: "NAV2", level: "AA", describe: "Pagination is a labelled nav landmark", select: "ds-pagination nav, ds-pagination .pagination", when: { notRole: "navigation" }, set: { role: "navigation", "aria-label": "Pagination" } },
      { code: "NAV2", level: "AA", describe: "Current page marked", select: "ds-pagination .page-item.active a, ds-pagination li.active a", set: { "aria-current": "page" } },
      { code: "COM2/NAV1", level: "AAA", describe: "Search filters region labelled", select: "ds-search-filters, ds-search-sidebar", when: { notRole: "region" }, set: { role: "region", "aria-label": "Search filters" } },
      { code: "FIL1", level: "A", describe: "Search button named", select: "button.search-button, ds-search-form button[type=submit]", when: { missingName: true }, set: { "aria-label": "Search" } }
    ]
  });
})();
