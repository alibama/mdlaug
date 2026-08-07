"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
global.window = global;

test("PDF → model → accessible HTML + valid DOCX", async () => {
  const conv = require("../extension/engine/converter.js");
  let pdfjs;
  try { pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"); }
  catch (e) { console.log("  (pdfjs not installed; skipping converter test)"); return; }
  conv.configure({ pdfjsLib: pdfjs });

  const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures", "sample.pdf")));
  const model = await conv.pdfToModel(bytes);
  assert.ok(model.nodes.some((n) => n.type === "h" && /Accessible Reading Room/i.test(n.text)), "H1 detected from font size");
  assert.ok(model.nodes.some((n) => n.type === "h" && /direct file access/i.test(n.text)), "H2 detected");

  const html = conv.modelToHtml(model);
  assert.match(html, /<h1>/, "renders an h1");
  assert.ok((html.match(/<p>/g) || []).length >= 1, "renders paragraphs");

  const blob = conv.modelToDocx(model);
  const buf = Buffer.from(await blob.arrayBuffer());
  assert.equal(buf.slice(0, 2).toString(), "PK", "DOCX is a valid ZIP (PK header)");
});
