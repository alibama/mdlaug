/* mDLAUG Repair — content script orchestrator + in-page control panel */
(function () {
  "use strict";
  if (window.__mdlaugContentLoaded) return;
  window.__mdlaugContentLoaded = true;

  var R = window.mDLAUG && window.mDLAUG.remediator;
  var C = window.mDLAUG && window.mDLAUG.converter;
  if (!R) return;

  // Point the converter at the extension's vendored pdf.js / mammoth so it works
  // offline and without tripping page CSP.
  try {
    var base = chrome.runtime.getURL("vendor/");
    C && C.configure({
      pdfjsUrl: base + "pdf.min.mjs",
      pdfWorkerUrl: base + "pdf.worker.min.mjs",
      mammothUrl: base + "mammoth.browser.min.js"
    });
  } catch (e) {}

  // Compute manager: routes heavy jobs (image/graph description, OCR, PDF
  // reflow) through one budgeted queue. Providers are wired from user config.
  var CM = window.mDLAUG && window.mDLAUG.compute;
  var manager = CM ? new CM.ComputeManager() : null;
  if (manager) {
    // PDF/DOCX reflow always available — the converter is bundled.
    manager.registerProvider("reflowPdf", {
      name: "converter", available: function () { return true; },
      run: function (input, ctx) {
        ctx.progress(0.15, "reading file");
        var p = input.run ? input.run()
          : C.pdfToModel(input.source).then(function (m) { return C.modelToHtml(m); });
        return Promise.resolve(p).then(function (html) { ctx.progress(1); return { html: html }; });
      }
    });
    try {
      chrome.storage && chrome.storage.sync.get(
        { describeUrl: "", describeHeaders: "", transcribeUrl: "", transcribeHeaders: "", ocrEnabled: false, autoDescribe: false, concurrency: 2,
          budget: { describeImage: "ask", describeGraph: "ask", ocr: "ask", reflowPdf: "auto", transcribe: "ask" } },
        function (cfg) {
          autoDescribe = !!cfg.autoDescribe;
          if (cfg.describeUrl) {
            var hdrs = {}; try { hdrs = cfg.describeHeaders ? JSON.parse(cfg.describeHeaders) : {}; } catch (e) {}
            var describer = CM.endpointDescriber({ name: "description service", url: cfg.describeUrl, headers: hdrs });
            manager.registerProvider("describeImage", describer);
            manager.registerProvider("describeGraph", describer);
          }
          if (cfg.transcribeUrl) {
            var thdrs = {}; try { thdrs = cfg.transcribeHeaders ? JSON.parse(cfg.transcribeHeaders) : {}; } catch (e) {}
            manager.registerProvider("transcribe", CM.endpointTranscriber({ name: "transcription service", url: cfg.transcribeUrl, headers: thdrs }));
          }
          if (cfg.ocrEnabled) {
            var v = chrome.runtime.getURL("vendor/tesseract/");
            manager.registerProvider("ocr", CM.tesseractOcr({
              scriptUrl: v + "tesseract.min.js", workerPath: v + "worker.min.js",
              corePath: v + "tesseract-core.wasm.js", langPath: v,
              injectFiles: ["vendor/tesseract/tesseract.min.js"]
            }));
          }
          if (cfg.concurrency) manager.configure({ concurrency: cfg.concurrency });
          if (cfg.budget) Object.keys(cfg.budget).forEach(function (k) { manager.setPolicy(k, cfg.budget[k]); });
        });
    } catch (e) {}
  }

  // Register user-authored site packs (declarative JSON) saved in settings.
  try {
    chrome.storage && chrome.storage.local.get({ mdlaug_user_packs: [] }, function (s) {
      (s.mdlaug_user_packs || []).forEach(function (p) { try { p.source = "user"; R.registerPack(p); } catch (e) {} });
    });
  } catch (e) {}

  var state = { on: false, result: null };
  var autoDescribe = false;
  var autoAlted = [];

  // Automatically fill alt text on images that lack it — no per-image tap needed
  // (important on mobile). Requires a description service (recommended) or local
  // OCR. A description endpoint fetches the image URL server-side, so it also
  // works for cross-origin images where local OCR would be blocked by canvas taint.
  function autoDescribeImages() {
    if (!autoDescribe || !manager || !manager.hasProvider) return;
    var cap = manager.hasProvider("describeImage") ? "describeImage" : (manager.hasProvider("ocr") ? "ocr" : null);
    if (!cap) return;
    try { manager.setPolicy(cap, "auto"); } catch (e) {}
    var imgs = document.querySelectorAll("img[data-mdlaug-needs-alt]");
    Array.prototype.slice.call(imgs).forEach(function (img) {
      var src = img.currentSrc || img.getAttribute("src") || "";
      if (!src) return;
      manager.enqueue(cap, { src: src, hashSource: src, imageEl: img, prompt: "Transcribe any text in this image, or briefly describe it for a blind reader." },
        { label: "Describe image" }).promise
        .then(function (res) {
          var t = String((res && (res.description || res.text || res.alt)) || "").trim();
          if (!t) return;
          img.setAttribute("alt", t);
          img.setAttribute("data-mdlaug-auto-alt", "1");
          img.removeAttribute("data-mdlaug-needs-alt");
          autoAlted.push(img);
        }).catch(function () {});
    });
  }

  function run() {
    var transcribe = (manager && manager.hasProvider && manager.hasProvider("transcribe"))
      ? function (input) { return manager.enqueue("transcribe", { mediaUrl: input.mediaUrl, hashSource: input.mediaUrl, language: "en" }, { label: "Transcribe media" }).promise; }
      : null;
    state.result = R.remediate({ inlineViewers: true, transcribe: transcribe });
    state.on = true;
    autoDescribeImages();
    updatePanel();
    var hl = panel && panel.querySelector("#mdlaug-hl");
    R.highlight(hl ? hl.checked : true);
    R.announce("Accessibility repairs applied: " + state.result.fixesApplied + " fixes.");
    try { chrome.runtime.sendMessage({ type: "mdlaug-count", count: state.result.fixesApplied }); } catch (e) {}
  }
  function stop() {
    R.undo();
    autoAlted.forEach(function (img) { img.removeAttribute("alt"); img.removeAttribute("data-mdlaug-auto-alt"); });
    autoAlted = [];
    state.on = false;
    updatePanel();
    R.announce("Accessibility repairs removed.");
  }

  // ---- floating launcher + panel ----------------------------------------
  var panel;
  var launcherHidden = false;
  function buildPanel() {
    if (panel) return;
    panel = document.createElement("div");
    panel.id = "mdlaug-panel";
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", "mDLAUG accessibility repair");
    panel.innerHTML =
      '<button id="mdlaug-close" class="mdlaug-close" title="Hide this on-page button" aria-label="Hide this on-page button — reopen it from the extension icon">\u00d7</button>' +
      '<button id="mdlaug-toggle" class="mdlaug-btn" aria-pressed="false">Repair this page</button>' +
      '<button id="mdlaug-reader" class="mdlaug-btn mdlaug-secondary">Open Reading Room</button>' +
      '<div id="mdlaug-hlrow" hidden>' +
        '<label class="mdlaug-hl-label"><input type="checkbox" id="mdlaug-hl" checked> Highlight changes</label>' +
        '<span class="mdlaug-legend"><i class="ok"></i>repaired <i class="flag"></i>needs content</span>' +
      '</div>' +
      '<button id="mdlaug-open" class="mdlaug-btn mdlaug-secondary" hidden>Show report</button>' +
      '<div id="mdlaug-report" hidden></div>';
    document.body.appendChild(panel);
    panel.querySelector("#mdlaug-close").addEventListener("click", hideLauncher);
    panel.querySelector("#mdlaug-toggle").addEventListener("click", function () {
      state.on ? stop() : run();
    });
    panel.querySelector("#mdlaug-reader").addEventListener("click", function () {
      try { window.mDLAUG.reader.open({ compute: manager, converter: C }); }
      catch (e) { R.announce("Could not open Reading Room: " + e.message); }
    });
    panel.querySelector("#mdlaug-hl").addEventListener("change", function () {
      R.highlight(this.checked);
    });
    panel.querySelector("#mdlaug-open").addEventListener("click", function () {
      var r = panel.querySelector("#mdlaug-report");
      r.hidden = !r.hidden;
    });
  }
  function hideLauncher() {
    launcherHidden = true;
    if (panel) { panel.remove(); panel = null; }
    try { chrome.storage && chrome.storage.sync.set({ hideLauncher: true }); } catch (e) {}
    R.announce("On-page button hidden. Reopen it from the extension icon.");
  }
  function showLauncher() {
    launcherHidden = false;
    try { chrome.storage && chrome.storage.sync.set({ hideLauncher: false }); } catch (e) {}
    buildPanel(); updatePanel();
  }
  function updatePanel() {
    if (launcherHidden) return;
    if (!panel) buildPanel();
    var t = panel.querySelector("#mdlaug-toggle");
    t.textContent = state.on ? "Undo repairs" : "Repair this page";
    t.setAttribute("aria-pressed", String(state.on));
    var open = panel.querySelector("#mdlaug-open");
    open.hidden = !state.on;
    var hlrow = panel.querySelector("#mdlaug-hlrow");
    if (hlrow) hlrow.hidden = !state.on;
    var r = panel.querySelector("#mdlaug-report");
    if (state.on && state.result) {
      var byCode = {};
      state.result.report.forEach(function (e) {
        (byCode[e.code] = byCode[e.code] || []).push(e);
      });
      var wmap = {}; (state.result.rules || []).forEach(function (r) { if (r.wcag) wmap[r.code] = r.wcag; });
      var html = ['<h2>mDLAUG repairs (' + state.result.fixesApplied + ')</h2><ul>'];
      if (state.result.packs && state.result.packs.length) {
        html.push('<li><span class="mdlaug-code">packs</span> active: ' +
          state.result.packs.map(function (p) { return p.title; }).join(", ") + "</li>");
      }
      Object.keys(byCode).forEach(function (code) {
        var msgs = byCode[code].map(function (m) { return m.msg; }).join(" ");
        var flag = byCode[code].some(function (m) { return m.kind === "flag"; });
        html.push('<li><span class="mdlaug-code">' + code + "</span> " +
          (wmap[code] ? '<span class="mdlaug-wcag">WCAG ' + wmap[code] + "</span> " : "") +
          (flag ? '<span class="mdlaug-flag">needs content</span> ' : "") + msgs + "</li>");
      });
      html.push("</ul>");
      r.innerHTML = html.join("");
    } else { r.innerHTML = ""; r.hidden = true; }
  }

  // messages from popup
  try {
    chrome.runtime.onMessage.addListener(function (msg, _s, reply) {
      if (msg.type === "mdlaug-run") { run(); reply && reply({ ok: true, count: state.result.fixesApplied, report: state.result.report }); }
      else if (msg.type === "mdlaug-undo") { stop(); reply && reply({ ok: true }); }
      else if (msg.type === "mdlaug-reader") { try { window.mDLAUG.reader.open({ compute: manager, converter: C }); reply && reply({ ok: true }); } catch (e) { reply && reply({ ok: false, error: e.message }); } }
      else if (msg.type === "mdlaug-assess") {
        try {
          var A = window.mDLAUG.assessment;
          var card = A.buildScorecard({ remediator: R, document: document });
          reply && reply({ ok: true, scorecard: card, dlTitle: document.title, dlUrl: location.href });
        } catch (e) { reply && reply({ ok: false, error: e.message }); }
      }
      else if (msg.type === "mdlaug-status") { reply && reply({ on: state.on, count: state.result ? state.result.fixesApplied : 0, launcherHidden: launcherHidden }); }
      else if (msg.type === "mdlaug-show-launcher") { showLauncher(); reply && reply({ ok: true }); }
      return true;
    });
  } catch (e) {}

  // auto-run if user opted in; honor the hidden-launcher preference
  try {
    chrome.storage && chrome.storage.sync.get({ autoRun: false, hideLauncher: false }, function (cfg) {
      launcherHidden = !!cfg.hideLauncher;
      if (cfg.autoRun) run();
      else if (!launcherHidden) buildPanel();
    });
  } catch (e) { buildPanel(); }
})();
