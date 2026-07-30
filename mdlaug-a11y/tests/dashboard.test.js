"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
require("fake-indexeddb/auto");
global.window = global;
require("../extension/engine/turso.js");
const S = require("../extension/engine/store.js");

function audit(dl, when, s) {
  return {
    dlName: dl, dlUrl: "https://" + dl, assessor: "A", createdAt: when,
    situations: [
      { code: "ACC1", level: "A", title: "files", complianceScore: s.acc1, autoScore: s.acc1, autoFindings: {} },
      { code: "NAV2", level: "AA", title: "pager", complianceScore: s.nav2, autoScore: s.nav2, autoFindings: {} },
      { code: "RED4", level: "AAA", title: "auth", complianceScore: s.red4, autoScore: s.red4, autoFindings: {} }
    ]
  };
}

test("dashboard aggregates and trend derive correctly from the store", async () => {
  const st = S.resolve({});
  await st.initSchema();
  await st.saveAssessment(audit("heritage", "2026-05-01T00:00:00Z", { acc1: 3, nav2: 4, red4: 2 }));
  await st.saveAssessment(audit("heritage", "2026-06-01T00:00:00Z", { acc1: 5, nav2: 6, red4: 4 }));
  await st.saveAssessment(audit("other", "2026-05-15T00:00:00Z", { acc1: 7, nav2: 7, red4: 7 }));

  // compliance-by-situation (bar chart source) for one library
  const codes = await st.complianceByCode("https://heritage");
  const byCode = {}; codes.forEach((c) => (byCode[c.code] = c));
  assert.equal(byCode.ACC1.avg_score, 4);
  assert.equal(byCode.NAV2.avg_score, 5);
  assert.equal(byCode.RED4.avg_score, 3);
  assert.equal(byCode.RED4.level, "AAA");

  // trend (line chart source): overall avg per audit, oldest→newest
  const rows = (await st.listAssessments({ limit: 100 })).filter((r) => r.dl_url === "https://heritage")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const pts = [];
  for (const r of rows) {
    const f = await st.getAssessment(r.id);
    const sc = f.situations.map((s) => s.compliance_score);
    pts.push(sc.reduce((a, b) => a + b, 0) / sc.length);
  }
  assert.deepEqual(pts, [3, 5]);

  // all-libraries view
  const all = await st.complianceByCode();
  assert.equal(all.find((c) => c.code === "ACC1").n, 3);
});
