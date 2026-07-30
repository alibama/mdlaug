"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { makeDom, loadEngines } = require("./helpers");

const PAGE = `<!doctype html><html lang="en"><head><title>Coastal Charts</title></head><body>
<header><nav>site nav junk</nav></header>
<main>
  <h1>1802 Coastal Survey</h1><p>An introduction to the collection.</p>
  <h2>Provenance</h2><p>Assembled from three archives.</p>
  <img src="survey.jpg" alt="survey.jpg">
  <figure><img src="harbor.jpg"><figcaption>Harbor at dawn, 1911.</figcaption></figure>
  <div class="chart" role="img"></div>
  <h2>Holdings</h2>
  <table><caption>Counts</caption><thead><tr><th>Type</th><th>Count</th></tr></thead>
    <tbody><tr><td>Maps</td><td>40</td></tr></tbody></table>
  <p>Attached: <a href="/files/guide.pdf">Reading room guide</a></p>
</main><footer>footer junk</footer></body></html>`;

test("extracts a clean reading model", () => {
  const win = makeDom(PAGE);
  loadEngines(win, ["reader.js"]);
  const m = win.mDLAUG.reader.extract(null, { source: "https://dl/item/1" });
  const kinds = m.blocks.map((b) => b.type);
  assert.ok(!JSON.stringify(m.blocks).includes("junk"), "nav/footer stripped");
  assert.equal(m.outline.length, 3, "three headings in outline");
  assert.ok(m.blocks.some((b) => b.type === "image" && /survey/.test(b.src) && b.needsDesc), "filename alt flagged");
  assert.ok(m.blocks.some((b) => b.type === "image" && b.alt === "Harbor at dawn, 1911." && !b.needsDesc), "figcaption used as alt");
  assert.ok(m.blocks.some((b) => b.type === "graph" && b.needsDesc), "chart captured");
  assert.ok(m.blocks.some((b) => b.type === "table" && b.headers.length === 2), "table extracted");
  assert.ok(kinds.includes("filelink"), "file link captured from inside paragraph");
});

test("renders the standardized view with TOC, table scopes and file control", () => {
  const win = makeDom(PAGE);
  loadEngines(win, ["reader.js"]);
  const m = win.mDLAUG.reader.extract(null, {});
  const built = win.mDLAUG.reader.render(m, { compute: { status: () => ({ jobs: [] }), on() {}, hasProvider: () => false, policy: {} }, converter: {} });
  assert.equal(built.node.querySelectorAll("nav.rr-toc").length, 1, "TOC rendered");
  assert.ok(built.node.querySelectorAll("table.rr-table th[scope]").length >= 2, "table headers scoped");
  assert.ok(built.node.querySelectorAll(".rr-file").length >= 1, "file reflow control rendered");
});

test("with a description provider, missing descriptions fill in labelled unverified", async () => {
  const win = makeDom(PAGE);
  loadEngines(win, ["compute.js", "reader.js"]);
  const cm = new win.mDLAUG.compute.ComputeManager();
  cm.registerProvider("describeImage", { name: "t", available: () => true, run: async (i) => ({ description: "a map (" + i.src + ")" }) });
  cm.setPolicy("describeImage", "auto");
  const built = win.mDLAUG.reader.render(win.mDLAUG.reader.extract(null, {}), { compute: cm, converter: null });
  await new Promise((r) => setTimeout(r, 30));
  const filled = Array.prototype.filter.call(built.node.querySelectorAll(".rr-desc"), (d) => !d.hidden && /map/i.test(d.textContent));
  assert.ok(filled.length >= 1, "at least one description filled");
  assert.ok(filled.every((d) => /unverified/i.test(d.textContent)), "descriptions labelled unverified");
});
