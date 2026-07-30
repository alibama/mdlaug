"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { makeDom, loadEngines } = require("./helpers");

const MOCK = `<!doctype html><html lang=en><body>
<button id="searchIcon"><span aria-hidden="true">🔍</span></button>
<a href="report.docx" target="_blank">Curator report (Word, 2 MB)</a>
<div class="results"><div class="result"><img src="x1.jpg"></div>
  <figure><img src="harbor.jpg" alt="A harbor at dawn with fishing boats"></figure></div>
<div class="pagination"><a class="active" href="#">1</a><a href="#">2</a></div>
</body></html>`;

test("builds a survey-shaped scorecard for all 24 situations", () => {
  const win = makeDom(MOCK);
  loadEngines(win, ["remediator.js", "assessment.js"]);
  const A = win.mDLAUG.assessment;
  const card = A.buildScorecard({ remediator: win.mDLAUG.remediator, document: win.document });
  assert.equal(card.length, 24, "24 situations");
  assert.ok(card.every((s) => s.autoScore === null || (s.autoScore >= 1 && s.autoScore <= 7)), "scores in range");
  const byCode = {}; card.forEach((s) => (byCode[s.code] = s));
  assert.ok(byCode["ACC1"].goodTechniques.some((g) => /file link/i.test(g.msg)), "ACC1 detects the DOCX good technique");
  assert.ok(byCode["ACC2/COM3"].violations.length >= 1, "ACC2 has violations");
  assert.ok(byCode["ACC2/COM3"].goodTechniques.length >= 1, "ACC2 sees the good alt");
  assert.ok(typeof byCode["ACC1"].violationsNote === "string", "prefilled editable note");
});

test("toAssessment shapes the scorecard for storage", () => {
  const win = makeDom(MOCK);
  loadEngines(win, ["remediator.js", "assessment.js"]);
  const A = win.mDLAUG.assessment;
  const card = A.buildScorecard({ remediator: win.mDLAUG.remediator, document: win.document });
  const a = A.toAssessment(card, { dlName: "DL", dlUrl: "https://dl", assessor: "Anson" });
  assert.equal(a.situations.length, 24);
  assert.ok(a.autoSummary && a.autoSummary.violations > 0);
  assert.equal(typeof a.situations[0].autoFindings, "object");
});
