"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { makeDom, loadEngines } = require("./helpers");

function mgr() {
  const win = makeDom("<!doctype html><body></body>");
  loadEngines(win, ["compute.js"]);
  return new win.mDLAUG.compute.ComputeManager();
}

test("no provider → job is skipped, not errored", async () => {
  const j = mgr().enqueue("describeImage", { src: "a.jpg" });
  const r = await j.promise;
  assert.equal(r.skipped, true);
});

test("ask policy holds until run(); provenance is unverified", async () => {
  const cm = mgr();
  cm.registerProvider("describeImage", { name: "x", available: () => true, run: async (i) => ({ description: "cat " + i.src }) });
  cm.setPolicy("describeImage", "ask");
  const j = cm.enqueue("describeImage", { src: "b.jpg" });
  assert.equal(cm.status().jobs.find((x) => x.id === j.id).state, "held");
  cm.run(j.id);
  const r = await j.promise;
  assert.ok(r.description.includes("b.jpg"));
  assert.equal(r.generated, true);
  assert.equal(r.verified, false);
});

test("cache serves repeat keys without re-running", async () => {
  const cm = mgr();
  let calls = 0;
  cm.registerProvider("describeImage", { name: "x", available: () => true, run: async () => { calls++; return { description: "d" }; } });
  cm.setPolicy("describeImage", "auto");
  await cm.enqueue("describeImage", { src: "same.jpg" }).promise;
  await cm.enqueue("describeImage", { src: "same.jpg" }).promise;
  assert.equal(calls, 1);
});

test("auto policy respects the concurrency cap", async () => {
  const cm = mgr();
  cm.registerProvider("describeImage", { name: "x", available: () => true, run: async () => ({ description: "d" }) });
  cm.setPolicy("describeImage", "auto");
  const ps = [];
  for (let i = 0; i < 5; i++) ps.push(cm.enqueue("describeImage", { src: "n" + i }).promise);
  assert.ok(cm.status().running <= 2, "no more than concurrency running at once");
  await Promise.all(ps);
});

test("cancel rejects a held job", async () => {
  const cm = mgr();
  cm.registerProvider("describeImage", { name: "x", available: () => true, run: async () => ({}) });
  cm.setPolicy("describeImage", "ask");
  const j = cm.enqueue("describeImage", { src: "c.jpg" });
  cm.cancel(j.id);
  await assert.rejects(j.promise, /cancelled/);
});
