"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
require("fake-indexeddb/auto");
global.window = global;
require("../extension/engine/turso.js");
const S = require("../extension/engine/store.js");

function audit(dl, when, scores) {
  return {
    dlName: dl, dlUrl: "https://" + dl, assessor: "A", createdAt: when,
    situations: Object.keys(scores).map((code) => ({ code, level: "A", title: code, complianceScore: scores[code], autoScore: scores[code], autoFindings: {}, evidence: [] }))
  };
}

test("resolve() defaults to a local IndexedDB store with the full interface", async () => {
  const st = S.resolve({});
  assert.equal(st.constructor.name, "LocalStore");
  ["initSchema", "ping", "saveAssessment", "listAssessments", "getAssessment", "complianceByCode"].forEach((m) => assert.equal(typeof st[m], "function", m));
  await st.initSchema();
  assert.equal(await st.ping(), true);
});

test("save/list/get round-trip with evidence and JSON findings", async () => {
  const st = S.resolve({ storage: "local" });
  await st.initSchema();
  const r = await st.saveAssessment({
    dlName: "Heritage", dlUrl: "https://h", assessor: "A", autoSummary: { violations: 5 },
    situations: [{ code: "ACC1", level: "A", complianceScore: 4, autoScore: 3, autoFindings: { violations: [{ msg: "x", count: 5 }] }, evidence: [{ kind: "violation", filename: "e.png", imageBase64: "data:image/png;base64,AAAA" }] }]
  });
  assert.ok(r.id);
  const full = await st.getAssessment(r.id);
  assert.equal(full.assessment.dl_name, "Heritage");
  assert.equal(full.situations[0].evidence[0].image_base64.slice(0, 10), "data:image");
  assert.ok(Array.isArray(full.situations[0].auto_findings.violations));
});

test("complianceByCode averages across audits of a library", async () => {
  const st = S.resolve({});
  await st.initSchema();
  await st.saveAssessment(audit("lib.a", "2026-05-01T00:00:00Z", { ACC1: 4 }));
  await st.saveAssessment(audit("lib.a", "2026-06-01T00:00:00Z", { ACC1: 6 }));
  const codes = await st.complianceByCode("https://lib.a");
  const acc1 = codes.find((c) => c.code === "ACC1");
  assert.equal(acc1.avg_score, 5);
  assert.equal(acc1.n, 2);
});

test("resolve('turso-local') yields a same-interface store pointed at 127.0.0.1", () => {
  const t = S.resolve({ storage: "turso-local" });
  assert.equal(typeof t.saveAssessment, "function");
  assert.match(t.label, /127\.0\.0\.1:8080/);
});
