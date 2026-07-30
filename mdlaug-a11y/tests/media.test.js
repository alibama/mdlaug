"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { makeDom, loadEngines } = require("./helpers");

const PAGE = `<!doctype html><body>
  <video id="a" src="a.mp4"></video>
  <video id="b" src="b.mp4"><track kind="captions" src="c.vtt"></video>
  <audio id="d" src="d.mp3"></audio>
  <iframe id="yt" src="https://www.youtube.com/embed/xyz"></iframe>
</body>`;

test("flags uncaptioned media when no transcription service is configured", () => {
  const win = makeDom(PAGE);
  loadEngines(win, ["remediator.js"]);
  const R = win.mDLAUG.remediator;
  R.remediate({ inlineViewers: false }); // no transcribe hook
  const d = win.document;
  assert.equal(d.getElementById("a").getAttribute("aria-label"), "Video player", "video named");
  assert.ok(d.getElementById("a").nextElementSibling.classList.contains("mdlaug-mediabar"), "uncaptioned video gets a bar");
  assert.ok(d.querySelector("#a + .mdlaug-mediabar .mdlaug-medianote"), "shows a no-service note");
  assert.ok(!(d.getElementById("b").nextElementSibling && d.getElementById("b").nextElementSibling.classList.contains("mdlaug-mediabar")), "captioned video left alone");
  assert.ok(d.getElementById("d").nextElementSibling.classList.contains("mdlaug-mediabar"), "audio flagged");
  assert.ok(d.querySelector("#yt + .mdlaug-mediabar"), "youtube embed advised");
  assert.equal(d.getElementById("yt").getAttribute("title"), "Embedded video", "embed titled");

  R.undo();
  assert.ok(!d.querySelector(".mdlaug-mediabar"), "undo removes media bars");
  assert.equal(d.getElementById("a").getAttribute("aria-label"), null, "undo restores video (no aria-label)");
});

test("with a transcription service, adds a caption track and a transcript, then undo restores", async () => {
  const win = makeDom(PAGE);
  win.URL.createObjectURL = function () { return "blob:mock"; };
  loadEngines(win, ["remediator.js"]);
  const R = win.mDLAUG.remediator;
  const transcribe = function () { return Promise.resolve({ text: "hello world", segments: [{ start: 0, end: 1, text: "hello" }, { start: 1, end: 2, text: "world" }] }); };
  R.remediate({ inlineViewers: false, transcribe: transcribe });
  const d = win.document;
  const btn = d.querySelector("#a + .mdlaug-mediabar .mdlaug-viewbtn");
  assert.ok(btn, "a transcribe button is offered");
  btn.click();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(d.querySelector('#a track[kind="captions"].mdlaug-track'), "WebVTT caption track added to the video");
  var det = d.querySelector("#a + details.mdlaug-transcript") || d.querySelector("details.mdlaug-transcript");
  assert.ok(det && /hello world/.test(det.textContent), "visible transcript added");
  assert.ok(/unverified/i.test(det.querySelector("summary").textContent), "transcript labelled unverified");

  R.undo();
  assert.ok(!d.querySelector(".mdlaug-track"), "undo removes the caption track");
  assert.ok(!d.querySelector(".mdlaug-transcript"), "undo removes the transcript");
});
