/* Site pack: Islandora / Drupal digital repositories. Matches the Drupal
   generator meta and standard Drupal pager/breadcrumb/facet markup. */
(function () {
  var R = window.mDLAUG && window.mDLAUG.remediator; if (!R || !R.registerPack) return;
  R.registerPack({
    id: "islandora", title: "Islandora / Drupal", source: "bundled",
    match: { generator: /Drupal/i, selectors: ["nav.pager", ".pager__items", "body.path-node"] },
    rules: [
      { code: "NAV2", level: "AA", describe: "Drupal pager is a labelled nav landmark", select: "nav.pager, .pager", when: { notRole: "navigation" }, set: { role: "navigation", "aria-label": "Pagination" } },
      { code: "NAV2", level: "AA", describe: "Current pager item marked", select: ".pager__item.is-active a, .pager-current", set: { "aria-current": "page" } },
      { code: "EXE3", level: "AA", describe: "Breadcrumb is a labelled nav landmark", select: "nav.breadcrumb, .breadcrumb", when: { notRole: "navigation" }, set: { role: "navigation", "aria-label": "Breadcrumb" } },
      { code: "COM2/NAV1", level: "AAA", describe: "Facets block is a labelled region", select: ".facets-widget, .block-facets, #block-facets", when: { notRole: "region" }, set: { role: "region", "aria-label": "Facets" } }
    ]
  });
})();
