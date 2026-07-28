/* Site pack: IIIF viewers (Mirador, Universal Viewer, OpenSeadragon). These are
   canvas-heavy; this only ensures the viewer container is a labelled region so a
   screen-reader user knows where they are. Full viewer a11y needs viewer-native work. */
(function () {
  var R = window.mDLAUG && window.mDLAUG.remediator; if (!R || !R.registerPack) return;
  R.registerPack({
    id: "iiif", title: "IIIF viewers (Mirador / UV)", source: "bundled",
    match: { selectors: [".mirador-viewer", "#mirador", ".uv", "#uv", ".openseadragon-container"] },
    rules: [
      { code: "USE1", level: "AAA", describe: "Image/manuscript viewer container is a labelled region", select: ".mirador-viewer, #mirador, .uv, #uv", when: { notRole: "region" }, set: { role: "region", "aria-label": "Image viewer" } }
    ]
  });
})();
