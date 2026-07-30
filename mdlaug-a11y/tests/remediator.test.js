"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { makeDom, loadEngines } = require("./helpers");

const MOCK = `<!doctype html><html lang="en"><body>
<div class="topbar"><button class="iconbtn" id="searchIcon"><span aria-hidden="true">🔍</span></button></div>
<div class="searchrow">
  <input id="q" type="search" placeholder="Search the collections">
  <span class="x" id="clear">×</span>
  <div class="suggest" id="sug"></div>
</div>
<main>
 <div class="crumb breadcrumb"><a href="#">Home</a> / <span class="active">Charts</span></div>
 <div class="filters"><div class="h">Refine</div><label><input type="checkbox"> Maps</label></div>
 <div class="chart" role="img"></div>
 <div class="files"><a href="guide.pdf" download target="_blank">Reading room guide</a>
   <a href="notes.docx" target="_blank">Curator notes</a></div>
 <div class="results">
   <div class="result"><img src="x1.jpg"><div class="title">1802 Survey</div></div>
   <div class="result"><img src="x2.jpg"><div class="title">Harbor at Dawn</div></div>
 </div>
 <div class="acc"><div class="header" id="moreHdr">More about this collection</div>
   <div class="panel" id="morePanel" style="display:none">x</div></div>
 <div class="pagination"><a href="#" class="prev">«</a><a href="#" class="active">1</a><a href="#">2</a><a href="#" class="next">»</a></div>
 <p class="locked"><button>Download TIFF</button></p>
</main>
<div class="modal" id="modal" style="display:flex"><div class="box"><span class="close">×</span><h2>Preview</h2></div></div>
</body></html>`;

test("repairs land on the accessibility tree, and undo restores", () => {
  const win = makeDom(MOCK);
  loadEngines(win, ["remediator.js"]);
  const R = win.mDLAUG.remediator;
  const d = win.document;

  const res = R.remediate({ inlineViewers: false });
  assert.ok(res.fixesApplied > 0, "some fixes applied");

  assert.match(d.querySelector('a[href="guide.pdf"]').getAttribute("aria-label") || "", /PDF file.*new window/i, "ACC1 pdf link labelled");
  assert.ok((d.getElementById("searchIcon").getAttribute("aria-label") || "").length > 0, "FIL1 icon button named");
  assert.ok(d.querySelector(".result img").hasAttribute("data-mdlaug-needs-alt"), "ACC2 image flagged");
  assert.equal(d.getElementById("moreHdr").getAttribute("aria-controls"), "morePanel", "ACC5 disclosure wired");
  assert.equal(d.querySelector(".pagination").getAttribute("role"), "navigation", "NAV2 pager landmark");
  assert.equal(d.querySelector(".pagination .active").getAttribute("aria-current"), "page", "NAV2 current page");
  assert.equal(d.getElementById("modal").getAttribute("aria-modal"), "true", "EXE2/INT1 dialog modal");
  assert.equal(d.querySelector(".results").getAttribute("role"), "list", "ACC4 results list");
  assert.ok(d.querySelector("a.mdlaug-skip"), "COM1 skip link injected");

  R.undo();
  assert.ok(!d.querySelector('a[href="guide.pdf"]').getAttribute("aria-label"), "undo restores pdf link");
  assert.ok(!d.querySelector("a.mdlaug-skip"), "undo removes skip link");
});

test("highlight overlay builds and tears down", () => {
  const win = makeDom(MOCK);
  loadEngines(win, ["remediator.js"]);
  const R = win.mDLAUG.remediator;
  R.remediate({ inlineViewers: false });
  const h = R.highlight(true);
  assert.ok(win.document.getElementById("mdlaug-overlay"), "overlay present");
  assert.ok(h.count > 0, "overlay reports repaired targets");
  R.highlight(false);
  assert.ok(!win.document.getElementById("mdlaug-overlay"), "overlay removed on toggle off");
});

test("conformance levels match mDLAUG Appendix IV", () => {
  const win = makeDom("<!doctype html><body></body>");
  loadEngines(win, ["remediator.js"]);
  const want = {
    ACC1: "A", "ACC2/COM3": "A", "ACC3/COM4": "AA", ACC4: "AA", ACC5: "A", ACC6: "AAA",
    COM1: "A", "COM2/NAV1": "AAA", EVA1: "A", EXE1: "A", "EXE2/INT1": "A", EXE3: "AA",
    "FIL1/USE1": "A", "FIL2/RED3": "AA", "FIL3/HEP1": "A", NAV2: "AA", "RED1/NAV3/NAV5": "A", NAV4: "AA", RED4: "AAA"
  };
  win.mDLAUG.remediator.rules().forEach((r) => {
    if (want[r.code]) assert.equal(r.level, want[r.code], r.code + " level");
  });
});

test("FORM1: label association, placeholder fallback, required reflection, and flags", () => {
  const win = makeDom(`<!doctype html><body><form>
    <label>Email <input id="e" type="email" required></label>
    <label for="pw">Password</label><input id="pw" type="password">
    <input id="q" type="search" placeholder="Search the catalog">
    <input id="bare" type="text">
    <input type="submit" value="Go">
  </form></body>`);
  loadEngines(win, ["remediator.js"]);
  const R = win.mDLAUG.remediator;
  R.remediate({ inlineViewers: false });
  const d = win.document;
  assert.equal(d.getElementById("e").getAttribute("aria-required"), "true", "required reflected");
  assert.equal(d.getElementById("e").getAttribute("aria-label"), null, "wrapping label already names the field");
  assert.equal(d.getElementById("pw").getAttribute("aria-label"), null, "label[for] already names the field");
  assert.equal(d.getElementById("q").getAttribute("aria-label"), "Search the catalog", "placeholder used as fallback name");
  assert.equal(d.getElementById("bare").getAttribute("data-mdlaug-needs-label"), "1", "nameless field with no fallback is flagged");
  assert.equal(d.querySelector('input[type="submit"]').getAttribute("aria-label"), null, "submit button left alone");

  R.undo();
  assert.equal(d.getElementById("e").getAttribute("aria-required"), null, "undo restores");
  assert.equal(d.getElementById("q").getAttribute("aria-label"), null, "undo restores placeholder-derived name");
  assert.equal(d.getElementById("bare").getAttribute("data-mdlaug-needs-label"), null, "undo clears the flag");
});

test("ACC1 derives a name from the filename when link text is generic (WCAG 2.4.4)", () => {
  const win = makeDom('<!doctype html><body><a href="/files/Annual_Report_2023.pdf">here</a></body>');
  loadEngines(win, ["remediator.js"]);
  win.mDLAUG.remediator.remediate({ inlineViewers: false });
  assert.match(win.document.querySelector('a[href$="Annual_Report_2023.pdf"]').getAttribute("aria-label") || "", /Annual Report 2023, PDF file/);
});

test("rules() expose WCAG success criteria per situation", () => {
  const win = makeDom("<!doctype html><body></body>");
  loadEngines(win, ["remediator.js"]);
  const byCode = {}; win.mDLAUG.remediator.rules().forEach((r) => (byCode[r.code] = r));
  assert.ok((byCode["ACC1"].wcag || "").includes("2.4.4"), "ACC1 maps to 2.4.4");
  assert.ok(byCode["FORM1"] && byCode["FORM1"].wcag.includes("3.3.2"), "FORM1 maps to 3.3.2");
  assert.ok((byCode["MED1"].wcag || "").includes("1.2.2"), "MED1 maps to captions SC");
});
