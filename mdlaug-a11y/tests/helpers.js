"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

function engineSrc(name) {
  return fs.readFileSync(path.join(__dirname, "..", "extension", "engine", name), "utf8");
}
// Create an isolated jsdom window and evaluate the given engine modules INTO it,
// so each module attaches to exactly this window (independent of require cache).
function makeDom(html) {
  const dom = new JSDOM(html || "<!doctype html><body></body>", { pretendToBeVisual: true, runScripts: "outside-only" });
  const w = dom.window;
  if (!w.requestAnimationFrame) w.requestAnimationFrame = (f) => setTimeout(f, 0);
  return w;
}
function loadEngines(win, names) { names.forEach((n) => win.eval(engineSrc(n))); }
function loadPacks(win, ids) {
  ids.forEach((id) => win.eval(fs.readFileSync(path.join(__dirname, "..", "extension", "packs", id + ".js"), "utf8")));
}

module.exports = { engineSrc, makeDom, loadEngines, loadPacks };
