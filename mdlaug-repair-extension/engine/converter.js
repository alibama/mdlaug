/*
 * mDLAUG Converter — client-side, offline document conversion for ACC1/2/3.
 *
 * Capabilities (all in-browser, no server):
 *   PDF  -> structured model (headings/paragraphs, reading order) via pdf.js
 *   model-> accessible semantic HTML (h1..h4, p, lang) — best for screen readers
 *   model-> DOCX (.docx) written directly as OOXML in a store-only ZIP (no deps)
 *   DOCX -> accessible HTML via mammoth (if provided)
 *   TXT/CSV -> accessible HTML (CSV -> a real <table> with headers)
 *   mountAccessiblePdf / mountAccessibleDoc -> reflowed, navigable inline view
 *
 * pdf.js and mammoth are heavy; they are injected rather than bundled:
 *   mDLAUG.converter.configure({ pdfjsLib, mammoth })
 * If not injected, the engine tries a dynamic ESM import from a configurable
 * CDN base (see CONFIG.pdfjsUrl / CONFIG.mammothUrl).
 *
 * Honest scope note: PDF text extraction is layout-heuristic, not a full tagged-
 * PDF reader; scanned/image-only PDFs need OCR (hook: CONFIG.ocr). DOCX->PDF is
 * intentionally done through the browser's own print-to-PDF pipeline rather than
 * a re-implemented layout engine, to avoid silent fidelity loss.
 */
(function (root) {
  "use strict";

  var CONFIG = {
    pdfjsLib: (root.pdfjsLib || null),
    mammoth: (root.mammoth || null),
    pdfjsUrl: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.4.149/pdf.min.mjs",
    pdfWorkerUrl: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.4.149/pdf.worker.min.mjs",
    mammothUrl: "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.9.0/mammoth.browser.min.js",
    ocr: null // optional async fn(imageData) -> text
  };

  function configure(opts) { Object.keys(opts || {}).forEach(function (k) { CONFIG[k] = opts[k]; }); }

  async function getPdfjs() {
    if (CONFIG.pdfjsLib) return CONFIG.pdfjsLib;
    var mod = await import(/* webpackIgnore: true */ CONFIG.pdfjsUrl);
    mod.GlobalWorkerOptions.workerSrc = CONFIG.pdfWorkerUrl;
    CONFIG.pdfjsLib = mod;
    return mod;
  }

  // ---------------------------------------------------------------------
  // PDF -> structured model
  // Groups text items into lines by baseline, lines into blocks, and infers
  // heading levels from font-size relative to the document's body size.
  // ---------------------------------------------------------------------
  async function pdfToModel(source) {
    var pdfjs = await getPdfjs();
    var data = await toArrayBuffer(source);
    var doc = await pdfjs.getDocument({ data: data }).promise;
    var meta = {};
    try { var m = await doc.getMetadata(); meta = m.info || {}; } catch (e) {}
    var blocks = [];
    var sizes = [];

    for (var p = 1; p <= doc.numPages; p++) {
      var page = await doc.getPage(p);
      var content = await page.getTextContent();
      var items = content.items.filter(function (it) { return it.str && it.str.trim(); });
      // group into lines by rounded y
      var lines = {};
      items.forEach(function (it) {
        var y = Math.round(it.transform[5]);
        var size = Math.hypot(it.transform[2], it.transform[3]) || Math.abs(it.transform[3]) || 10;
        sizes.push(size);
        var key = y;
        // merge near-equal baselines
        var matched = null;
        Object.keys(lines).forEach(function (k) { if (Math.abs(k - y) <= 2) matched = k; });
        if (matched === null) lines[key] = [];
        else key = matched;
        lines[key].push({ x: it.transform[4], str: it.str, size: size });
      });
      var ys = Object.keys(lines).map(Number).sort(function (a, b) { return b - a; }); // top-first
      ys.forEach(function (y) {
        var parts = lines[y].sort(function (a, b) { return a.x - b.x; });
        var lineText = parts.map(function (p) { return p.str; }).join("").replace(/\s+/g, " ").trim();
        var lineSize = median(parts.map(function (p) { return p.size; }));
        if (lineText) blocks.push({ page: p, text: lineText, size: lineSize });
      });
      if (p < doc.numPages) blocks.push({ page: p, text: "", size: 0, br: true });
    }

    var body = median(sizes) || 10;
    var model = { title: (meta.Title || "").trim() || null, author: (meta.Author || "").trim() || null, pages: doc.numPages, nodes: [] };
    var paraBuf = [];
    function flush() {
      if (paraBuf.length) { model.nodes.push({ type: "p", text: paraBuf.join(" ") }); paraBuf = []; }
    }
    blocks.forEach(function (b) {
      if (b.br) { flush(); return; }
      var ratio = b.size / body;
      var isHeading = ratio >= 1.25 && b.text.length < 120;
      if (isHeading) {
        flush();
        var level = ratio >= 1.9 ? 1 : ratio >= 1.5 ? 2 : 3;
        model.nodes.push({ type: "h", level: level, text: b.text });
      } else {
        // join wrapped lines; start new para on sentence-terminal + short line
        paraBuf.push(b.text);
        if (/[.!?:]$/.test(b.text)) flush();
      }
    });
    flush();
    if (!model.title) {
      var firstH = model.nodes.find(function (n) { return n.type === "h"; });
      model.title = firstH ? firstH.text : "Untitled document";
    }
    return model;
  }

  // ---------------------------------------------------------------------
  // model -> accessible HTML
  // ---------------------------------------------------------------------
  function modelToHtml(model, opts) {
    opts = opts || {};
    var lang = opts.lang || "en";
    var out = [];
    out.push('<article lang="' + esc(lang) + '">');
    out.push("<h1>" + esc(model.title) + "</h1>");
    if (model.author) out.push('<p class="doc-author"><strong>Author:</strong> ' + esc(model.author) + "</p>");
    model.nodes.forEach(function (n) {
      if (n.type === "h") out.push("<h" + (n.level + 1) + ">" + esc(n.text) + "</h" + (n.level + 1) + ">");
      else out.push("<p>" + esc(n.text) + "</p>");
    });
    out.push("</article>");
    return out.join("\n");
  }

  function textToHtml(str, opts) {
    var lang = (opts && opts.lang) || "en";
    var paras = str.replace(/\r\n/g, "\n").split(/\n{2,}/);
    return '<article lang="' + esc(lang) + '"><h1>Text document</h1>' +
      paras.map(function (p) { return "<p>" + esc(p).replace(/\n/g, "<br>") + "</p>"; }).join("") + "</article>";
  }

  function csvToHtml(str, opts) {
    var rows = parseCsv(str);
    if (!rows.length) return "<p>Empty file.</p>";
    var lang = (opts && opts.lang) || "en";
    var head = rows[0];
    var body = rows.slice(1);
    var h = ['<table lang="' + esc(lang) + '"><caption>Imported spreadsheet data</caption><thead><tr>'];
    head.forEach(function (c) { h.push('<th scope="col">' + esc(c) + "</th>"); });
    h.push("</tr></thead><tbody>");
    body.forEach(function (r) {
      h.push("<tr>");
      r.forEach(function (c, i) {
        if (i === 0) h.push('<th scope="row">' + esc(c) + "</th>");
        else h.push("<td>" + esc(c) + "</td>");
      });
      h.push("</tr>");
    });
    h.push("</tbody></table>");
    return h.join("");
  }

  async function ensureMammoth() {
    if (CONFIG.mammoth || root.mammoth) return CONFIG.mammoth || root.mammoth;
    // Preferred: ask the background to inject the bundled mammoth into THIS
    // (content-script) isolated world, so root.mammoth becomes defined. Works on
    // pages with a strict CSP, unlike injecting a <script> into the page.
    if (root.chrome && root.chrome.runtime && root.chrome.runtime.sendMessage) {
      await new Promise(function (res) {
        try { root.chrome.runtime.sendMessage({ type: "mdlaug-inject", files: ["vendor/mammoth.browser.min.js"] }, function () { res(); }); }
        catch (e) { res(); }
      });
      if (root.mammoth) return root.mammoth;
    }
    // Fallback (e.g. the standalone demo, no extension APIs): load into the page.
    try { await loadScript(CONFIG.mammothUrl); } catch (e) {}
    return CONFIG.mammoth || root.mammoth;
  }
  async function docxToHtml(source) {
    var mammoth = await ensureMammoth();
    if (!mammoth) throw new Error("DOCX converter (mammoth) could not be loaded");
    var buf = await toArrayBuffer(source);
    var res = await mammoth.convertToHtml({ arrayBuffer: buf });
    return res.value; // already semantic (h1/p/table/ul)
  }

  // ---------------------------------------------------------------------
  // model / HTML -> DOCX (.docx) — hand-written OOXML in a store-only ZIP
  // ---------------------------------------------------------------------
  function modelToDocx(model) {
    var bodyXml = [];
    if (model.title) bodyXml.push(para(model.title, "Title"));
    if (model.author) bodyXml.push(para("Author: " + model.author, "Subtitle"));
    model.nodes.forEach(function (n) {
      if (n.type === "h") bodyXml.push(para(n.text, "Heading" + Math.min(n.level, 3)));
      else bodyXml.push(para(n.text, null));
    });
    return buildDocx(bodyXml.join(""));
  }

  function htmlToDocx(html, title) {
    var div = document.createElement("div");
    div.innerHTML = html;
    var bodyXml = [];
    if (title) bodyXml.push(para(title, "Title"));
    walk(div);
    function walk(node) {
      Array.prototype.forEach.call(node.childNodes, function (c) {
        if (c.nodeType === 1) {
          var tag = c.tagName.toLowerCase();
          var t = (c.textContent || "").replace(/\s+/g, " ").trim();
          if (/^h[1-6]$/.test(tag) && t) bodyXml.push(para(t, "Heading" + Math.min(+tag[1], 3)));
          else if (tag === "p" && t) bodyXml.push(para(t, null));
          else if (tag === "li" && t) bodyXml.push(para("• " + t, null));
          else walk(c);
        }
      });
    }
    if (!bodyXml.length) bodyXml.push(para((div.textContent || "").trim(), null));
    return buildDocx(bodyXml.join(""));
  }

  function para(textStr, style) {
    var pPr = style ? '<w:pPr><w:pStyle w:val="' + style + '"/></w:pPr>' : "";
    var runs = String(textStr).split("\n").map(function (line, i) {
      return (i ? '<w:r><w:br/></w:r>' : "") + '<w:r><w:t xml:space="preserve">' + xml(line) + "</w:t></w:r>";
    }).join("");
    return "<w:p>" + pPr + runs + "</w:p>";
  }

  function buildDocx(bodyXml) {
    var CT = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      "</Types>";
    var RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>";
    var DOCRELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      "</Relationships>";
    var DOC = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      "<w:body>" + bodyXml +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
      "</w:body></w:document>";
    var STYLES = buildStyles();
    var files = [
      { name: "[Content_Types].xml", data: CT },
      { name: "_rels/.rels", data: RELS },
      { name: "word/_rels/document.xml.rels", data: DOCRELS },
      { name: "word/document.xml", data: DOC },
      { name: "word/styles.xml", data: STYLES }
    ];
    return zipStore(files); // Blob (application/vnd...docx)
  }

  function buildStyles() {
    function s(id, name, size, bold, outline) {
      return '<w:style w:type="paragraph" w:styleId="' + id + '"><w:name w:val="' + name + '"/>' +
        '<w:pPr>' + (outline != null ? '<w:outlineLvl w:val="' + outline + '"/>' : "") + '<w:spacing w:before="' + (bold ? 240 : 0) + '" w:after="120"/></w:pPr>' +
        '<w:rPr>' + (bold ? "<w:b/>" : "") + '<w:sz w:val="' + size + '"/></w:rPr></w:style>';
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      s("Title", "Title", 56, true) +
      s("Subtitle", "Subtitle", 26, false) +
      s("Heading1", "heading 1", 40, true, 0) +
      s("Heading2", "heading 2", 32, true, 1) +
      s("Heading3", "heading 3", 26, true, 2) +
      "</w:styles>";
  }

  // ---------------------------------------------------------------------
  // Store-only ZIP writer (method 0) with CRC-32 — enough for valid .docx
  // ---------------------------------------------------------------------
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zipStore(files) {
    var enc = new TextEncoder();
    var chunks = [], central = [], offset = 0;
    function u16(v) { return [v & 0xFF, (v >>> 8) & 0xFF]; }
    function u32(v) { return [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]; }
    files.forEach(function (f) {
      var nameB = enc.encode(f.name);
      var dataB = typeof f.data === "string" ? enc.encode(f.data) : f.data;
      var crc = crc32(dataB);
      var local = [].concat(
        u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
        u32(crc), u32(dataB.length), u32(dataB.length), u16(nameB.length), u16(0)
      );
      chunks.push(new Uint8Array(local), nameB, dataB);
      var cen = [].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
        u32(crc), u32(dataB.length), u32(dataB.length), u16(nameB.length),
        u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset)
      );
      central.push(new Uint8Array(cen), nameB);
      offset += local.length + nameB.length + dataB.length;
    });
    var centralSize = central.reduce(function (a, c) { return a + c.length; }, 0);
    var eocd = new Uint8Array([].concat(
      u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
      u32(centralSize), u32(offset), u16(0)
    ));
    var all = chunks.concat(central, [eocd]);
    return new Blob(all, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  // ---------------------------------------------------------------------
  // Accessible inline viewers (used by remediator ACC1)
  // ---------------------------------------------------------------------
  async function mountAccessiblePdf(url, host) {
    var model = await pdfToModel(url);
    renderReflow(host, model.title, modelToHtml(model), {
      pages: model.pages,
      downloads: [
        { label: "Download as Word (.docx)", make: function () { return modelToDocx(model); }, name: safeName(model.title) + ".docx" },
        { label: "Download as HTML", make: function () { return new Blob([htmlDoc(model.title, modelToHtml(model))], { type: "text/html" }); }, name: safeName(model.title) + ".html" }
      ]
    });
    return model;
  }
  async function mountAccessibleDoc(url, ext, host) {
    var html, title = "Document";
    if (ext === "docx") { html = await docxToHtml(url); title = "Word document"; }
    else {
      var buf = await fetchBytesSmart(url);
      var txt = new TextDecoder("utf-8").decode(new Uint8Array(buf));
      html = ext === "csv" ? csvToHtml(txt) : textToHtml(txt);
      title = ext.toUpperCase() + " document";
    }
    renderReflow(host, title, html, {
      downloads: [{ label: "Download as Word (.docx)", make: function () { return htmlToDocx(html, title); }, name: safeName(title) + ".docx" }]
    });
  }

  function renderReflow(host, title, innerHtml, opts) {
    opts = opts || {};
    host.textContent = "";
    var toolbar = document.createElement("div");
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Document view controls");
    toolbar.style.cssText = "display:flex;gap:.5rem;flex-wrap:wrap;margin:.25rem 0;font-size:.9rem";
    (opts.downloads || []).forEach(function (d) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = d.label; b.className = "mdlaug-viewbtn";
      b.addEventListener("click", function () {
        var blob = d.make();
        triggerDownload(blob, d.name);
      });
      toolbar.appendChild(b);
    });
    var content = document.createElement("div");
    content.setAttribute("role", "document");
    content.setAttribute("tabindex", "0");
    content.style.cssText = "max-height:60vh;overflow:auto;padding:1rem;background:#fff;color:#111;line-height:1.6";
    content.innerHTML = innerHtml;
    if (opts.pages) {
      var note = document.createElement("p");
      note.style.cssText = "font-size:.8rem;color:#555;margin:.25rem 0";
      note.textContent = "Reflowed from " + opts.pages + " page(s) into a single continuous, screen-reader-friendly document.";
      host.appendChild(note);
    }
    host.appendChild(toolbar);
    host.appendChild(content);
  }

  // ---------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function xml(s) { return String(s == null ? "" : s).replace(/[&<>]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]; }); }
  function median(arr) { if (!arr.length) return 0; var s = arr.slice().sort(function (a, b) { return a - b; }); return s[Math.floor(s.length / 2)]; }
  function safeName(s) { return String(s || "document").replace(/[^\w.-]+/g, "_").slice(0, 60) || "document"; }
  function htmlDoc(title, body) {
    return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>" + esc(title) +
      "</title></head><body>" + body + "</body></html>";
  }
  function parseCsv(str) {
    var rows = [], row = [], cur = "", q = false;
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      if (q) {
        if (ch === '"' && str[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else {
        if (ch === '"') q = true;
        else if (ch === ",") { row.push(cur); cur = ""; }
        else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
        else if (ch === "\r") {}
        else cur += ch;
      }
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return c.trim(); }); });
  }
  async function fetchBytesSmart(url) {
    // 1) direct fetch — upgrade http->https on an https page to avoid mixed content
    var direct = url;
    if (/^http:\/\//i.test(url) && root.location && root.location.protocol === "https:") direct = url.replace(/^http:/i, "https:");
    try {
      var r = await fetch(direct);
      if (r.ok) return await r.arrayBuffer();
    } catch (e) { /* fall through to background */ }
    // 2) via the extension background: cross-origin allowed, http->https handled
    if (root.chrome && root.chrome.runtime && root.chrome.runtime.sendMessage) {
      var resp = await new Promise(function (res) {
        try { root.chrome.runtime.sendMessage({ type: "mdlaug-fetch-bytes", url: url }, function (x) { res(x || { ok: false }); }); }
        catch (e) { res({ ok: false }); }
      });
      if (resp && resp.ok && resp.b64) {
        var bin = atob(resp.b64), bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes.buffer;
      }
      throw new Error(resp && resp.error ? resp.error : "could not fetch file");
    }
    throw new Error("could not fetch this file (cross-origin or unreachable)");
  }
  async function toArrayBuffer(source) {
    if (source instanceof ArrayBuffer) return source;
    if (source && source.arrayBuffer) return await source.arrayBuffer(); // Blob/File
    if (typeof source === "string") return await fetchBytesSmart(source);
    if (source instanceof Uint8Array) return source.buffer;
    throw new Error("Unsupported source");
  }
  function loadScript(url) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = url; s.onload = res; s.onerror = function () { rej(new Error("Failed to load " + url)); };
      document.head.appendChild(s);
    });
  }
  function triggerDownload(blob, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  var api = {
    configure: configure,
    pdfToModel: pdfToModel,
    modelToHtml: modelToHtml,
    modelToDocx: modelToDocx,
    htmlToDocx: htmlToDocx,
    docxToHtml: docxToHtml,
    textToHtml: textToHtml,
    csvToHtml: csvToHtml,
    mountAccessiblePdf: mountAccessiblePdf,
    mountAccessibleDoc: mountAccessibleDoc,
    triggerDownload: triggerDownload,
    zipStore: zipStore,
    version: "0.9.0"
  };
  root.mDLAUG = root.mDLAUG || {};
  root.mDLAUG.converter = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

})(typeof window !== "undefined" ? window : this);
