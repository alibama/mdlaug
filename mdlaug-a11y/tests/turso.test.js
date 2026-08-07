"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
global.window = global;
const T = require("../extension/engine/turso.js");

function okExec(result) { return { type: "ok", response: { type: "execute", result } }; }
function okClose() { return { type: "ok", response: { type: "close" } }; }
function mkFetch(responder) {
  let lastBody = null;
  const f = async (url, init) => {
    lastBody = JSON.parse(init.body);
    return { ok: true, status: 200, statusText: "OK", json: async () => responder(url, init, lastBody), text: async () => "" };
  };
  f.body = () => lastBody;
  return f;
}

test("normalizes url and encodes argument types", async () => {
  const fetch = mkFetch((u, i, b) => ({ results: b.requests.map((r) => (r.type === "close" ? okClose() : okExec({ cols: [], rows: [], affected_row_count: 1 }))) }));
  const c = new T.TursoClient({ url: "libsql://db-org.turso.io/", token: "s", fetch });
  assert.equal(c.url, "https://db-org.turso.io");
  await c.exec("insert into t values (?,?,?,?)", [5, 3.14, null, "hi"]);
  const a = fetch.body().requests[0].stmt.args;
  assert.equal(a[0].type, "integer"); assert.equal(a[0].value, "5");
  assert.equal(a[1].type, "float"); assert.equal(a[2].type, "null"); assert.equal(a[3].type, "text");
  assert.equal(fetch.body().requests.at(-1).type, "close");
});

test("saveAssessment writes parent+situations+evidence atomically", async () => {
  const fetch = mkFetch((u, i, b) => ({ results: b.requests.map((r) => (r.type === "close" ? okClose() : okExec({ cols: [], rows: [], affected_row_count: 1 }))) }));
  const store = new T.Store(new T.TursoClient({ url: "https://x.turso.io", token: "t", fetch }));
  const res = await store.saveAssessment({
    dlName: "DL", dlUrl: "https://dl", assessor: "A",
    situations: [
      { code: "ACC1", level: "A", complianceScore: 4, autoScore: 3, autoFindings: {}, evidence: [{ kind: "violation", filename: "e.png", imageBase64: "AAAA" }] },
      { code: "ACC2/COM3", level: "A", complianceScore: 2, autoScore: 2, autoFindings: {}, evidence: [] }
    ]
  });
  const execs = fetch.body().requests.filter((r) => r.type === "execute").map((r) => r.stmt.sql);
  assert.equal(execs[0], "BEGIN"); assert.equal(execs.at(-1), "COMMIT");
  assert.equal(execs.length, 6, "BEGIN + assessment + 2 situations + 1 evidence + COMMIT");
  assert.ok(res.id);
});

test("decodes SELECT rows and surfaces SQL errors; store.ping works", async () => {
  const list = new T.TursoClient({ url: "https://x.turso.io", token: "t", fetch: mkFetch((u, i, b) => ({
    results: b.requests.map((r) => (r.type === "close" ? okClose() : okExec({ cols: [{ name: "id" }, { name: "dl_name" }], rows: [[{ type: "text", value: "a1" }, { type: "text", value: "DL" }]] }))) })) });
  const rows = await new T.Store(list).listAssessments({ limit: 5 });
  assert.equal(rows[0].dl_name, "DL");
  assert.equal(typeof new T.Store(list).ping, "function");

  const err = new T.TursoClient({ url: "https://x.turso.io", token: "t", fetch: mkFetch(() => ({ results: [{ type: "error", error: { message: "no such table" } }, okClose()] })) });
  await assert.rejects(err.exec("select 1"), /no such table/);
});
