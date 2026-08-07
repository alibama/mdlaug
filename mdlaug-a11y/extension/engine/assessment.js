/*
 * mDLAUG Assessment builder
 *
 * Turns the remediator's audit into the same artifact the mDLAUG compliance
 * survey collects, one row per help-seeking situation:
 *   1.1  a 1–7 compliance score      -> auto-suggested here, human confirms
 *   1.2  violations (with evidence)  -> the elements the engine had to repair/flag
 *   1.3  good techniques (evidence)  -> pre-existing compliant patterns we detected
 *
 * We only *suggest*; the human assessor edits the score and notes and attaches
 * screenshots before the assessment is saved to Turso.
 */
(function (root) {
  "use strict";

  // The 24 situations, titles + Appendix-IV conformance levels (grouped as the
  // spec groups them). Engine findings carry compound codes (e.g. "EXE2/INT1");
  // we distribute each finding to every member situation by token.
  var SITUATIONS = [
    ["ACC1", "Difficulty directly accessing files", "A"],
    ["ACC2/COM3", "Difficulty accessing/comprehending images", "A"],
    ["ACC3/COM4", "Difficulty accessing/comprehending graphs", "AA"],
    ["ACC4", "Difficulty accessing collection items", "AA"],
    ["ACC5", "Difficulty accessing expandable/collapsed content", "A"],
    ["ACC6", "Difficulty accessing a query suggestion", "AAA"],
    ["COM1", "Difficulty understanding a digital library structure", "A"],
    ["COM2/NAV1", "Difficulty understanding/navigating the search filtering structure", "AAA"],
    ["EVA1", "Difficulty assessing relevance of a collection or an item", "A"],
    ["EXE1", "Difficulty clearing a search box", "A"],
    ["EXE2", "Difficulty exiting an open item", "A"],
    ["EXE3", "Difficulty returning to a previous page", "AA"],
    ["FIL1", "Difficulty finding/locating an icon-based search feature", "A"],
    ["FIL2/RED3", "Difficulty finding/locating/distinguishing search features at different levels", "AA"],
    ["FIL3/HEP1", "Difficulty finding/locating/using mobile-specific help information", "A"],
    ["INT1", "Difficulty interacting with multi-layered windows", "A"],
    ["NAV2", "Difficulty navigating paginated sections", "AA"],
    ["NAV3", "Difficulty navigating through search results", "AA"],
    ["NAV4", "Difficulty navigating within an item", "AA"],
    ["NAV5", "Difficulty navigating to a search result section", "A"],
    ["RED1", "Difficulty recognizing the availability of search results", "A"],
    ["RED2", "Difficulty distinguishing collection titles from thumbnails", "AA"],
    ["RED4", "Difficulty recognizing authorized features", "AAA"],
    ["USE1", "Difficulty using screen readers and voice activated commands", "AAA"]
  ];

  function tokens(code) { return String(code || "").split("/"); }
  function $all(sel, ctx) { try { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); } catch (e) { return []; } }
  function txt(el) { return (el.textContent || "").replace(/\s+/g, " ").trim(); }

  // Pre-existing compliant patterns → "good techniques" (mDLAUG 1.3).
  // Conservative: only counts things that are clearly already done right.
  function detectGood(doc) {
    doc = doc || root.document;
    var g = {};
    function add(tok, msg, count) { if (!count) return; (g[tok] = g[tok] || []).push({ msg: msg, count: count }); }

    // ACC1 — file links that already announce their type (and ideally size)
    var fileLinks = $all("a[href]", doc).filter(function (a) { return /\.(pdf|docx?|pptx?|xlsx?|csv|txt|epub)(\?|#|$)/i.test(a.getAttribute("href") || ""); });
    var goodFiles = fileLinks.filter(function (a) {
      var name = (a.getAttribute("aria-label") || a.getAttribute("title") || txt(a) || "");
      return /(pdf|word|excel|powerpoint|document|file|\bKB\b|\bMB\b)/i.test(name);
    });
    add("ACC1", goodFiles.length + " file link(s) already state the file type/size", goodFiles.length);

    // ACC2/COM3 — images that already carry meaningful (non-filename) alt
    var imgs = $all("img", doc);
    var goodAlt = imgs.filter(function (im) {
      var alt = im.getAttribute("alt");
      return alt != null && alt.trim() && !/\.(jpe?g|png|gif|webp|svg|tif)$/i.test(alt.trim()) && alt.trim().length > 3;
    });
    add("ACC2", goodAlt.length + " image(s) already have meaningful alt text", goodAlt.length);
    add("COM3", goodAlt.length + " image(s) already have meaningful alt text", goodAlt.length);

    // ACC5 — disclosures already exposing state
    add("ACC5", "controls already expose aria-expanded", $all("[aria-expanded]", doc).length);

    // COM1 — landmark & heading scaffolding
    var com1 = [];
    if ($all("main,[role='main']", doc).length) com1.push("a main landmark");
    if ($all("h1", doc).length === 1) com1.push("exactly one h1");
    if ($all("a[href^='#']", doc).filter(function (a) { return /skip|main|content/i.test(txt(a)); }).length) com1.push("a skip link");
    if (com1.length) add("COM1", "structure present: " + com1.join(", "), com1.length);

    // EXE2/INT1 — dialogs already modal
    add("INT1", "dialog(s) already use aria-modal", $all("[aria-modal='true'],[role='dialog'][aria-modal]", doc).length);
    add("EXE2", "dialog(s) already use aria-modal", $all("[aria-modal='true']", doc).length);

    // NAV2 — pagers already landmarked with current page
    var pagers = $all("[class*='pag' i][role='navigation'], nav[aria-label*='pag' i]", doc);
    var withCurrent = $all("[aria-current='page']", doc).length;
    if (pagers.length && withCurrent) add("NAV2", "pager already a nav landmark with aria-current", Math.min(pagers.length, withCurrent));

    // RED1/NAV3 — a live region for result status
    add("RED1", "a live region announces status", $all("[aria-live]", doc).length);

    // ACC6 — combobox for suggestions
    add("ACC6", "search already exposes a combobox", $all("[role='combobox']", doc).length);

    return g;
  }

  function scoreFrom(good, viol) {
    if (good + viol === 0) return null;            // nothing detected → human decides
    var ratio = good / (good + viol);
    return Math.max(1, Math.min(7, Math.round(1 + ratio * 6)));
  }

  // Build the full scorecard from the engine audit (no lasting DOM changes).
  function buildScorecard(services) {
    services = services || {};
    var R = services.remediator || (root.mDLAUG && root.mDLAUG.remediator);
    var doc = services.document || root.document;
    var report = (services.report) || (R && R.audit ? R.audit() : []);

    var byTok = {};
    (report || []).forEach(function (e) {
      tokens(e.code).forEach(function (t) { (byTok[t] = byTok[t] || []).push(e); });
    });
    var good = detectGood(doc);

    return SITUATIONS.map(function (row) {
      var code = row[0], title = row[1], level = row[2];
      var toks = tokens(code);
      var entries = [];
      toks.forEach(function (t) { (byTok[t] || []).forEach(function (e) { if (entries.indexOf(e) === -1) entries.push(e); }); });
      // de-dup identical messages
      var seen = {}, violations = [];
      entries.filter(function (e) { return e.kind === "fix" || e.kind === "flag"; }).forEach(function (e) {
        var msg = e.msg || (e.kind === "flag" ? "Content needs to be supplied" : "Non-compliant markup repaired");
        var key = msg;
        if (seen[key]) { seen[key].count = Math.max(seen[key].count, e.count || 1); return; }
        seen[key] = { msg: msg, count: e.count || 1, kind: e.kind };
        violations.push(seen[key]);
      });
      var goods = [], gseen = {};
      toks.forEach(function (t) {
        (good[t] || []).forEach(function (x) { if (!gseen[x.msg]) { gseen[x.msg] = 1; goods.push(x); } });
      });

      var vCount = violations.reduce(function (a, v) { return a + (v.count || 1); }, 0);
      var gCount = goods.reduce(function (a, x) { return a + (x.count || 1); }, 0);
      var autoScore = scoreFrom(gCount, vCount);

      return {
        code: code, level: level, title: title,
        autoScore: autoScore,
        complianceScore: autoScore,        // seed the human field with the suggestion
        violations: violations,
        goodTechniques: goods,
        violationsNote: violations.map(function (v) { return "• " + v.msg + (v.count > 1 ? " (\u00d7" + v.count + ")" : ""); }).join("\n"),
        goodNote: goods.map(function (x) { return "• " + x.msg; }).join("\n")
      };
    });
  }

  // Shape a scorecard + metadata into the Turso Store.saveAssessment input.
  function toAssessment(scorecard, meta) {
    meta = meta || {};
    var totals = scorecard.reduce(function (a, s) {
      a.violations += s.violations.reduce(function (n, v) { return n + (v.count || 1); }, 0);
      a.good += s.goodTechniques.reduce(function (n, x) { return n + (x.count || 1); }, 0);
      return a;
    }, { violations: 0, good: 0 });
    return {
      dlName: meta.dlName || "", dlUrl: meta.dlUrl || (root.location && root.location.href) || "",
      assessor: meta.assessor || "", overallNote: meta.overallNote || "",
      toolVersion: meta.toolVersion || (root.mDLAUG && root.mDLAUG.remediator && root.mDLAUG.remediator.version) || "",
      createdAt: new Date().toISOString(),
      userAgent: (root.navigator && root.navigator.userAgent) || "",
      autoSummary: totals,
      situations: scorecard.map(function (s) {
        return {
          code: s.code, level: s.level, title: s.title,
          complianceScore: s.complianceScore == null ? null : s.complianceScore,
          autoScore: s.autoScore == null ? null : s.autoScore,
          autoFindings: { violations: s.violations, goodTechniques: s.goodTechniques },
          violationsNote: s.violationsNote || "", goodNote: s.goodNote || "",
          evidence: s.evidence || []
        };
      })
    };
  }

  var api = { SITUATIONS: SITUATIONS, buildScorecard: buildScorecard, detectGood: detectGood, toAssessment: toAssessment, scoreFrom: scoreFrom, version: "0.9.0" };
  root.mDLAUG = root.mDLAUG || {};
  root.mDLAUG.assessment = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

})(typeof window !== "undefined" ? window : this);
