/* Site pack: Omeka S (and Omeka Classic). Matches the Omeka generator meta. */
(function () {
  var R = window.mDLAUG && window.mDLAUG.remediator; if (!R || !R.registerPack) return;
  R.registerPack({
    id: "omeka", title: "Omeka S", source: "bundled",
    match: { generator: /Omeka/i, selectors: ["body.omeka", ".resource-list", "#search"] },
    rules: [
      { code: "NAV2", level: "AA", describe: "Pagination is a labelled nav landmark", select: ".pagination", when: { notRole: "navigation" }, set: { role: "navigation", "aria-label": "Pagination" } },
      { code: "ACC4", level: "AA", describe: "Resource list exposed as a list", select: ".resource-list", when: { notRole: "list" }, set: { role: "list", "aria-label": "Items" } },
      { code: "FIL1", level: "A", describe: "Search button named", select: "#search button[type=submit], .search-form button[type=submit]", when: { missingName: true }, set: { "aria-label": "Search" } }
    ]
  });
})();
