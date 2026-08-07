"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { makeDom, loadEngines, loadPacks } = require("./helpers");

test("declarative pack: matches, applies attributes, reports, and undoes", () => {
  const win = makeDom('<!doctype html><body><div class="rr-block"></div><div class="rr-block done" role="navigation"></div></body>');
  loadEngines(win, ["remediator.js"]);
  const R = win.mDLAUG.remediator;
  R.registerPack({
    id: "demo", title: "Demo Pack",
    match: { selectors: [".rr-block"] },
    rules: [{ code: "NAV2", level: "AA", describe: "Block is a nav landmark", select: ".rr-block", when: { notRole: "navigation" }, set: { role: "navigation", "aria-label": "Pagination" } }]
  });

  assert.ok(R.matchedPacks().some((p) => p.id === "demo"), "pack matches this page");
  const res = R.remediate({ inlineViewers: false });
  const d = win.document;
  const first = d.querySelector(".rr-block:not(.done)");
  assert.equal(first.getAttribute("role"), "navigation", "attribute applied");
  assert.equal(first.getAttribute("data-mdlaug-pack"), "demo", "stamped with pack id");
  assert.equal(d.querySelector(".rr-block.done").getAttribute("aria-label"), null, "notRole guard skips already-navigation element");
  assert.ok(res.report.some((e) => e.pack === "demo" && e.code === "NAV2"), "pack fix appears in report");
  assert.ok(res.packs.some((p) => p.id === "demo"), "matched packs returned from remediate");

  R.undo();
  assert.equal(first.getAttribute("role"), null, "undo restores (role removed)");
  assert.equal(first.getAttribute("data-mdlaug-pack"), null, "undo removes pack stamp");
});

test("pack matching honors hosts and generator signals", () => {
  const win = makeDom('<!doctype html><head><meta name="generator" content="Drupal 10 (https://drupal.org)"></head><body><nav class="pager"></nav></body>');
  loadEngines(win, ["remediator.js"]);
  const R = win.mDLAUG.remediator;
  R.registerPack({ id: "gen", title: "Gen", match: { generator: /Drupal/i }, rules: [{ code: "X", select: "nav", set: { "data-x": "1" } }] });
  R.registerPack({ id: "nomatch", title: "No", match: { generator: /WordPress/i }, rules: [] });
  const matched = R.matchedPacks().map((p) => p.id);
  assert.ok(matched.includes("gen"), "generator regex matched");
  assert.ok(!matched.includes("nomatch"), "non-matching generator excluded");
});

test("imperative pack rule runs with the safe ctx", () => {
  const win = makeDom('<!doctype html><body><button id="s"><span aria-hidden="true">🔍</span></button></body>');
  loadEngines(win, ["remediator.js"]);
  const R = win.mDLAUG.remediator;
  R.registerPack({
    id: "imp", title: "Imperative", match: { selectors: ["#s"] },
    rules: [{ code: "FIL1", level: "A", describe: "name the search button", fix: function (ctx) {
      var n = 0; ctx.$all("#s").forEach(function (b) { ctx.setAttr(b, "aria-label", "Search"); ctx.mark(b, "FIL1"); n++; }); return n;
    } }]
  });
  R.remediate({ inlineViewers: false });
  assert.equal(win.document.getElementById("s").getAttribute("aria-label"), "Search", "pack (running after core) sets the authoritative name");
});

test("bundled Blacklight pack labels pagination and facets on a matching page", () => {
  const win = makeDom(`<!doctype html><body class="blacklight-catalog">
    <div id="facets"></div>
    <nav class="pagination"><span class="page-item active"><a>1</a></span></nav>
    <div id="documents"><article class="document"></article><article class="document"></article></div>
    </body>`);
  loadEngines(win, ["remediator.js"]);
  loadPacks(win, ["blacklight"]);
  const R = win.mDLAUG.remediator;
  assert.ok(R.matchedPacks().some((p) => p.id === "blacklight"), "blacklight pack matches");
  R.remediate({ inlineViewers: false });
  const d = win.document;
  assert.equal(d.querySelector("nav.pagination").getAttribute("role"), "navigation");
  assert.equal(d.querySelector("#facets").getAttribute("role"), "region");
  assert.equal(d.querySelector("#documents").getAttribute("role"), "list");
  assert.equal(d.querySelector("#documents .document").getAttribute("role"), "listitem");
});
