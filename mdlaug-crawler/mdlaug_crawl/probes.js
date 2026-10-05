/* In-page probes for the mDLAUG crawler. Injected by Playwright; defines
   window.__mdlaugProbe. Read-only except for data-mdlaug-probe markers used to
   hand elements back to Playwright. */
(function () {
  if (window.__mdlaugProbe) return;
  var $$ = function (s, r) { try { return Array.prototype.slice.call((r || document).querySelectorAll(s)); } catch (e) { return []; } };
  var txt = function (el) { return el ? (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim() : ""; };
  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
  }
  function accName(el) {
    if (!el) return "";
    var lb = el.getAttribute("aria-labelledby");
    if (lb) { var t = lb.split(/\s+/).map(function (id) { return txt(document.getElementById(id)); }).join(" ").trim(); if (t) return t; }
    var al = (el.getAttribute("aria-label") || "").trim(); if (al) return al;
    if (el.id) { var l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && txt(l)) return txt(l); }
    var wrap = el.closest && el.closest("label"); if (wrap && txt(wrap)) return txt(wrap);
    if (el.tagName === "IMG") return (el.getAttribute("alt") || "").trim();
    if (/^(INPUT)$/.test(el.tagName) && /^(submit|button|reset)$/i.test(el.type || "")) return (el.value || "").trim();
    if (el.tagName === "INPUT" && el.type === "image") return (el.getAttribute("alt") || "").trim();
    var t2 = txt(el); if (t2 && !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return t2;
    var im = el.querySelector && el.querySelector("img[alt]"); if (im && im.getAttribute("alt").trim()) return im.getAttribute("alt").trim();
    var svgT = el.querySelector && el.querySelector("svg title"); if (svgT && txt(svgT)) return txt(svgT);
    return (el.getAttribute("title") || "").trim();
  }
  function describe(el) {
    if (!el) return null;
    return { tag: el.tagName.toLowerCase(), id: el.id || "", cls: (el.className && el.className.baseVal === undefined ? String(el.className) : "").slice(0, 80),
      role: el.getAttribute("role") || "", name: accName(el).slice(0, 120), text: txt(el).slice(0, 120) };
  }
  var SEARCH_SEL = ['input[type="search"]', '[role="searchbox"]', 'input[name="q"]', 'input[name="query"]',
    'input[name="search"]', 'input[name="searchTerm"]', 'input[name="keyword"]', 'input[name="keywords"]',
    'input[name="s"]', 'input[name="terms"]', 'input[name="search_api_fulltext"]', 'input[name="all_fields"]',
    'input[placeholder*="earch" i]', 'input[aria-label*="earch" i]', 'input[id*="search" i]', 'input[class*="search" i]'];
  var COUNT_RE = /(\d[\d,\.]*)\s*(results?|items?|records?|hits|matches|objects?|documents?)\b|\b(results?|items?)\s*\d[\d,]*\s*(-|–|to)\s*\d[\d,]*\s*of\s*\d[\d,]*/i;

  // ---- annotation registry: element + situation + status (good|issue|review) ----
  var ANN = window.__mdlaugAnnList = window.__mdlaugAnnList || [];
  function ann(el, code, status, label, source) {
    if (!el || !el.getBoundingClientRect) return;
    for (var i = 0; i < ANN.length; i++) { if (ANN[i].el === el && ANN[i].code === code && ANN[i].label === label) return; }
    ANN.push({ el: el, code: code, status: status, label: label, source: source || "probe" });
  }
  // Elements the engine CREATED (skip links, sr-only spans, viewers, media bars) carry an
  // mdlaug- class. Ids like "mdlaug-main" are assigned to the page's OWN elements, so
  // they must not be used here (doing so hid every mark inside the content wrapper).
  function injected(el) {
    return !!(el.closest && el.closest('[class*="mdlaug-"]'));
  }
  function engineMarks() {
    var R = window.mDLAUG && window.mDLAUG.remediator; if (!R) return { ok: false };
    try { R.remediate({ inlineViewers: false }); } catch (e) { return { ok: false, error: String(e) }; }
    var refs = [];
    $$("[data-mdlaug], [data-mdlaug-needs-alt], [data-mdlaug-needs-label]").forEach(function (el) {
      if (injected(el)) return;
      var codes = (el.getAttribute("data-mdlaug") || "").split(/\s+/).filter(Boolean);
      var flag = el.hasAttribute("data-mdlaug-needs-alt") ? "needs alt text" : (el.hasAttribute("data-mdlaug-needs-label") ? "needs a label" : "");
      if (!codes.length) codes = [el.hasAttribute("data-mdlaug-needs-label") ? "FORM1" : "ACC2"];
      codes.forEach(function (c) { refs.push([el, c, flag ? "review" : "issue", flag || "markup needed repair"]); });
    });
    try { R.undo(); } catch (e) {}
    refs.forEach(function (r) { ann(r[0], r[1], r[2], r[3], "engine"); });
    return { ok: true, marked: refs.length };
  }
  function annotateGood() {
    $$("img[alt]").filter(visible).forEach(function (im) {
      var a = im.getAttribute("alt").trim();
      if (a.length > 3 && !/\.(jpe?g|png|gif|webp|svg|tif)$/i.test(a) && !/^(image|img|photo|picture|logo)$/i.test(a)) ann(im, "ACC2", "good", "has alt text", "probe");
    });
    $$("[aria-expanded]").filter(visible).slice(0, 10).forEach(function (el) { ann(el, "ACC5", "good", "exposes expanded state"); });
    $$("main,[role=main]").slice(0, 1).forEach(function (el) { ann(el, "COM1", "good", "main landmark"); });
    $$("[aria-live],[role=status]").filter(visible).slice(0, 3).forEach(function (el) { ann(el, "RED1", "good", "live/status region"); });
    $$("[role=combobox]").filter(visible).forEach(function (el) { ann(el, "ACC6", "good", "combobox semantics"); });
    $$("[aria-modal=true]").filter(visible).forEach(function (el) { ann(el, "INT1", "good", "aria-modal"); });
    $$("nav[aria-label*=bread i], [aria-label*=breadcrumb i]").filter(visible).forEach(function (el) { ann(el, "EXE3", "good", "breadcrumb landmark"); });
    $$("a[href]").filter(visible).filter(function (a) { return /\.(pdf|docx?|xlsx?|pptx?|zip|epub)(\?|$)/i.test(a.href) && /(pdf|word|excel|powerpoint|\bKB\b|\bMB\b)/i.test(accName(a)); })
      .slice(0, 6).forEach(function (a) { ann(a, "ACC1", "good", "file link states type"); });
    return true;
  }
  function collect() {
    var sx = window.scrollX || 0, sy = window.scrollY || 0, items = [];
    ANN.forEach(function (a) {
      if (!a.el.isConnected) return;
      var r = a.el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      items.push({ code: a.code, status: a.status, label: a.label, source: a.source,
        x: Math.round(r.left + sx), y: Math.round(r.top + sy), w: Math.round(r.width), h: Math.round(r.height),
        selector: cssPath(a.el), tag: a.el.tagName.toLowerCase(),
        current: a.el.tagName === "IMG" ? (a.el.getAttribute("alt") || "") : accName(a.el).slice(0, 120) });
    });
    var de = document.documentElement;
    return { meta: { scrollW: Math.max(de.scrollWidth, document.body ? document.body.scrollWidth : 0),
      scrollH: Math.max(de.scrollHeight, document.body ? document.body.scrollHeight : 0), vw: window.innerWidth,
      dpr: window.devicePixelRatio || 1, url: location.href }, items: items };
  }
  // ---- best-effort remediation diff (engine applied, then undone by the caller) ----
  // Selector for the ORIGINAL page: engine-added siblings (class mdlaug-*) are ignored
  // when counting positions, and engine-assigned ids are never used.
  function cssPath(el) {
    if (!(el instanceof Element)) return "";
    var parts = [];
    var orig = function (c) { return !/(^|\s)mdlaug-/.test(String(c.className || "")) && c.id !== "mdlaug-live"; };
    while (el && el.nodeType === 1 && parts.length < 6) {
      if (el.id && !/^mdlaug/.test(el.id) && document.querySelectorAll("#" + CSS.escape(el.id)).length === 1) {
        parts.unshift("#" + CSS.escape(el.id)); break;
      }
      var tag = el.tagName.toLowerCase();
      var sibs = el.parentElement ? Array.prototype.filter.call(el.parentElement.children, function (c) {
        return c.tagName === el.tagName && orig(c); }) : [el];
      parts.unshift(sibs.length > 1 ? tag + ":nth-of-type(" + (sibs.indexOf(el) + 1) + ")" : tag);
      el = el.parentElement;
      if (el && el.tagName === "BODY") { parts.unshift("body"); break; }
    }
    return parts.join(" > ");
  }
  var SKIP_ATTR = /^data-mdlaug/;
  function openTag(el, attrs) {
    var names = attrs || Array.prototype.map.call(el.attributes, function (a) { return a.name; });
    var s = "<" + el.tagName.toLowerCase();
    names.forEach(function (n) {
      if (SKIP_ATTR.test(n)) return;
      var v = el.getAttribute(n); if (v === null) return;
      s += " " + n + '="' + String(v).replace(/"/g, "&quot;").slice(0, 160) + '"';
    });
    return s + ">";
  }
  function remediationDiff() {
    var R = window.mDLAUG && window.mDLAUG.remediator; if (!R) return { ok: false, error: "engine not loaded" };
    var res;
    try { res = R.remediate({ inlineViewers: true }); } catch (e) { return { ok: false, error: String(e) }; }
    // make engine-added screen-reader-only text visible for the review capture
    var st = document.createElement("style"); st.id = "mdlaug-review-style";
    st.textContent = ".mdlaug-sr-only,.mdlaug-skip{position:static!important;clip:auto!important;clip-path:none!important;" +
      "width:auto!important;height:auto!important;overflow:visible!important;white-space:normal!important;" +
      "margin:2px!important;padding:2px 4px!important;background:#f3e8ff!important;color:#3b0764!important;font:12px/1.3 sans-serif!important}";
    document.head.appendChild(st);
    var sx = window.scrollX || 0, sy = window.scrollY || 0;
    function box(el) { var r = el.getBoundingClientRect(); return { x: Math.round(r.left + sx), y: Math.round(r.top + sy), w: Math.round(r.width), h: Math.round(r.height) }; }
    var changed = [];
    $$("[data-mdlaug-orig]").forEach(function (el) {
      if (injected(el)) return;
      var orig = {}; try { orig = JSON.parse(el.getAttribute("data-mdlaug-orig")) || {}; } catch (e) {}
      var keys = Object.keys(orig).filter(function (k) { return !SKIP_ATTR.test(k); });
      if (!keys.length) return;
      var before = {}, after = {}, diff = [];
      keys.forEach(function (k) {
        before[k] = orig[k]; after[k] = el.getAttribute(k);
        if (before[k] !== after[k]) diff.push({ attr: k, before: before[k], after: after[k] });
      });
      if (!diff.length) return;
      var allNames = Array.prototype.map.call(el.attributes, function (a) { return a.name; });
      var beforeTag = "<" + el.tagName.toLowerCase();
      allNames.forEach(function (n) {
        if (SKIP_ATTR.test(n)) return;
        var v = (n in orig) ? orig[n] : el.getAttribute(n); if (v === null || v === undefined) return;
        beforeTag += " " + n + '="' + String(v).replace(/"/g, "&quot;").slice(0, 160) + '"';
      });
      changed.push({ selector: cssPath(el), codes: (el.getAttribute("data-mdlaug") || "").split(/\s+/).filter(Boolean),
        diff: diff, before_tag: beforeTag + ">", after_tag: openTag(el), text: txt(el).slice(0, 80), box: box(el) });
    });
    var inserted = [];
    $$('[class*="mdlaug-"], #mdlaug-live').forEach(function (el) {
      if (el.id === "mdlaug-review-style") return;
      var p = el.parentElement; if (p && p.closest('[class*="mdlaug-"]')) return;     // only top-level additions
      var anchor = el.previousElementSibling && !injected(el.previousElementSibling) ? el.previousElementSibling : el.parentElement;
      var own = (el.getAttribute("data-mdlaug") || "").split(/\s+/).filter(function (c) { return /^[A-Z]{3}\d/.test(c); });
      if (!own.length) {   // e.g. screen-reader text: attribute it to the element it was attached to
        var host = el.closest("[data-mdlaug]:not([class*='mdlaug-'])") || (anchor && anchor.getAttribute && anchor.getAttribute("data-mdlaug") ? anchor : null);
        own = host ? (host.getAttribute("data-mdlaug") || "").split(/\s+/).filter(function (c) { return /^[A-Z]{3}\d/.test(c); }) : [];
      }
      inserted.push({ html: el.outerHTML.slice(0, 700), where: (anchor === el.parentElement ? "inside " : "after ") + cssPath(anchor),
        codes: own,
        kind: /skip/.test(el.className) ? "skip link" : /sr-only/.test(el.className) ? "screen-reader text" :
              /viewbtn/.test(el.className) ? "inline-view button" : /mediabar|transcript/.test(el.className) ? "media control" :
              el.id === "mdlaug-live" ? "status announcer" : "added element",
        text: txt(el).slice(0, 80), box: box(el) });
    });
    var de = document.documentElement;
    return { ok: true, fixes: res.fixesApplied, report: (res.report || []).slice(0, 80), changed: changed, inserted: inserted,
      meta: { scrollW: Math.max(de.scrollWidth, document.body ? document.body.scrollWidth : 0),
              scrollH: Math.max(de.scrollHeight, document.body ? document.body.scrollHeight : 0), vw: window.innerWidth } };
  }
  function undoRemediation() {
    var st = document.getElementById("mdlaug-review-style"); if (st) st.remove();
    try { window.mDLAUG.remediator.undo(); } catch (e) {}
    return true;
  }

  function annotateImages(verdicts) {
    var imgs = window.__mdlaugImgs || [];
    (verdicts || []).forEach(function (v) {
      var im = imgs[v.index]; if (!im) return;
      var st = /^(meaningful|decorative_ok)$/.test(v.verdict) ? "good" : (v.verdict === "generic" ? "review" : "issue");
      ann(im, "ACC2", st, "alt: " + v.verdict + " (LLM)", "llm");
    });
    return true;
  }

  var OVERLAY_SEL = '[role="dialog"], [role="alertdialog"], dialog[open], .modal.show, .modal.in, [aria-modal="true"], ' +
    '#onetrust-banner-sdk, #onetrust-pc-sdk, .onetrust-pc-dark-filter, #CybotCookiebotDialog, .cc-window, #cookie-law-info-bar, ' +
    '.modal_overlay, [class*="popup" i][class*="modal" i], .cookie-banner, [class*="cookie" i][class*="banner" i], ' +
    '[class*="consent" i][class*="banner" i], [id*="cookie" i][id*="banner" i]';
  // What is on top of the search box? (the thing that would swallow a tap)
  function blocker() {
    var s = document.querySelector('[data-mdlaug-probe="search"]'); if (!s) return { found: false };
    var r = s.getBoundingClientRect();
    var x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1), y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
    var top = document.elementFromPoint(x, y);
    if (!top || top === s || s.contains(top) || top.contains(s) && top.tagName === "LABEL") return { found: false };
    var root = top.closest(OVERLAY_SEL) || top;
    var p = root; while (p && p.parentElement && p.parentElement !== document.body) {
      var cs = getComputedStyle(p.parentElement); if (cs.position === "fixed" || p.parentElement.matches(OVERLAY_SEL)) p = p.parentElement; else break; }
    root = p || root;
    root.setAttribute("data-mdlaug-probe", "blocker");
    return { found: true, el: describe(root), covering: describe(top) };
  }
  var DISMISS = [/reject all|decline all|deny all|necessary only|only necessary|essential only|reject|decline/i,
                 /^(×|✕|x)$|close|dismiss|no,? thanks|not now|maybe later|skip/i,
                 /continue|^ok$|okay|got it|i understand|accept all|accept|agree|allow all|allow/i];
  function dismissBlocker() {
    var root = document.querySelector('[data-mdlaug-probe="blocker"]') ||
      $$(OVERLAY_SEL).filter(visible)[0]; if (!root) return { dismissed: false };
    var scope = root.querySelectorAll("button, a, [role=button], input[type=button], input[type=submit]").length ? root : document;
    var btns = $$("button, a, [role=button], input[type=button], input[type=submit]", scope).filter(visible);
    for (var i = 0; i < DISMISS.length; i++) {
      var b = btns.filter(function (x) { return DISMISS[i].test((accName(x) || x.value || "").trim()); })[0];
      if (b) { var label = (accName(b) || b.value || "").trim(); b.click(); return { dismissed: true, via: "button", label: label.slice(0, 60), priority: i }; }
    }
    root.style.setProperty("display", "none", "important");      // last resort so the crawl can continue
    return { dismissed: true, via: "hidden", label: "" };
  }
  function programmaticSubmit(q) {
    var s = document.querySelector('[data-mdlaug-probe="search"]'); if (!s) return false;
    var set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(s, q);
    s.dispatchEvent(new Event("input", { bubbles: true })); s.dispatchEvent(new Event("change", { bubbles: true }));
    var f = s.form; if (f) { if (f.requestSubmit) f.requestSubmit(); else f.submit(); return true; }
    s.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); return true;
  }
  function searchFocused() {
    var a = document.activeElement; return !!(a && a.getAttribute && a.getAttribute("data-mdlaug-probe") === "search");
  }

  function findSearch() {
    var cands = [];
    SEARCH_SEL.forEach(function (s) { $$(s).forEach(function (el) { if (cands.indexOf(el) < 0 && !/^(hidden|checkbox|radio|submit)$/i.test(el.type || "")) cands.push(el); }); });
    var vis = cands.filter(visible);
    var el = vis[0] || null;
    var res = { found: !!el, visible_count: vis.length, total_candidates: cands.length, hidden_only: !el && cands.length > 0 };
    if (el) {
      el.setAttribute("data-mdlaug-probe", "search");
      var form = el.closest("form");
      var btn = form ? (form.querySelector('button[type="submit"], input[type="submit"], button:not([type]), input[type="image"]')) : null;
      res.input = describe(el);
      res.input_name = accName(el);
      res.placeholder_only = !accName(el) && !!el.getAttribute("placeholder");
      res.in_search_landmark = !!el.closest('[role="search"], search');
      res.in_form = !!form;
      res.submit = btn ? describe(btn) : null;
      res.submit_named = btn ? !!accName(btn) : null;
      res.submit_icon_only = btn ? (!txt(btn) && !(btn.value || "").trim()) : null;
      if (btn) btn.setAttribute("data-mdlaug-probe", "search-submit");
      if (res.input_name && res.in_search_landmark) ann(el, "FIL2", "good", "named search in search landmark");
      else if (res.input_name) ann(el, "FIL2", "review", "named, but no search landmark");
      else ann(el, "FIL2", "issue", res.placeholder_only ? "placeholder-only label" : "search box has no name");
      if (btn && res.submit_icon_only) ann(btn, "FIL1", res.submit_named ? "good" : "issue", res.submit_named ? "icon button named" : "unnamed icon button");
    }
    return res;
  }
  function findSearchToggle() {
    var els = $$('button, a, [role="button"]').filter(visible).filter(function (b) {
      var n = (accName(b) + " " + (b.className || "") + " " + (b.id || "")).toLowerCase();
      return /search|magnif|find/.test(n) || !!b.querySelector('[class*="search" i], [class*="magnif" i]');
    });
    var b = els[0];
    if (!b) return { found: false };
    b.setAttribute("data-mdlaug-probe", "search-toggle");
    ann(b, "FIL1", accName(b) ? "good" : "issue", accName(b) ? "search toggle named" : "unnamed search toggle");
    return { found: true, el: describe(b), named: !!accName(b), icon_only: !txt(b) };
  }
  function nameStats() {
    var els = $$('a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])').filter(visible);
    var unnamed = [], mismatch = [];
    els.forEach(function (el) {
      var n = accName(el);
      if (!n && !(el.tagName === "INPUT" && el.placeholder)) { unnamed.push(describe(el)); if (unnamed.length <= 15) ann(el, "USE1", "issue", "control has no name"); }
      var vis = txt(el), al = el.getAttribute("aria-label");
      if (al && vis && vis.length > 2 && al.toLowerCase().indexOf(vis.toLowerCase()) < 0) { mismatch.push({ visible: vis.slice(0, 60), aria_label: al.slice(0, 60) }); if (mismatch.length <= 8) ann(el, "USE1", "review", "label differs from visible text"); }
    });
    return { interactive: els.length, unnamed: unnamed.length, unnamed_sample: unnamed.slice(0, 8),
      label_in_name_mismatch: mismatch.length, mismatch_sample: mismatch.slice(0, 5) };
  }
  function targetSizes() {
    var small = $$('a[href], button, input:not([type="hidden"]), select, [role="button"]').filter(visible).filter(function (el) {
      var r = el.getBoundingClientRect(); return (r.width < 24 || r.height < 24) && !(el.tagName === "A" && el.closest("p,li,td"));
    });
    small.slice(0, 8).forEach(function (el) { ann(el, "2.5.8", "review", "target under 24px"); });
    return { small_targets: small.length, sample: small.slice(0, 5).map(describe) };
  }
  function summary() {
    var main = document.querySelector("main,[role='main']") || document.body;
    var heads = $$("h1,h2,h3,h4").slice(0, 40).map(function (h) { return h.tagName.toLowerCase() + ": " + txt(h).slice(0, 90); });
    var lms = $$("header,nav,main,aside,footer,[role=banner],[role=navigation],[role=main],[role=complementary],[role=contentinfo],[role=search],search")
      .map(function (l) { return (l.getAttribute("role") || l.tagName.toLowerCase()) + (l.getAttribute("aria-label") ? " (" + l.getAttribute("aria-label") + ")" : ""); });
    var body = txt(main);
    var links = $$("a[href]").filter(visible).slice(0, 120).map(function (a) { return { text: (accName(a) || "").slice(0, 60), href: a.href }; });
    var m = body.match(COUNT_RE);
    return {
      url: location.href, title: document.title, lang: document.documentElement.lang || "",
      h1: $$("h1").map(txt).slice(0, 3), headings: heads, landmarks: lms.slice(0, 30),
      forms: $$("form").length, inputs: $$("input:not([type=hidden]),select,textarea").length,
      images: $$("img").length, links_count: $$("a[href]").length,
      result_count_text: m ? m[0] : "", has_viewer: !!document.querySelector('iframe[src*="iiif" i], .openseadragon-container, #uv, .mirador-viewer, embed[type*="pdf"], iframe[src*=".pdf"], object[type*="pdf"], [class*="viewer" i]'),
      metadata_blocks: $$("dl, table").length,
      pagination: !!document.querySelector('[class*="pagina" i], nav[aria-label*="pag" i], a[rel="next"], .pager'),
      facets: !!document.querySelector('[class*="facet" i], [id*="facet" i], [class*="filter" i], [class*="refine" i], [class*="limit" i]'),
      text_excerpt: body.slice(0, 1500), nav_links: links
    };
  }
  function resultsInfo() {
    var body = txt(document.querySelector("main,[role='main']") || document.body);
    var m = body.match(COUNT_RE);
    var live = $$('[aria-live], [role="status"], [role="alert"]');
    var liveWithCount = live.filter(function (l) { return COUNT_RE.test(txt(l)); });
    var ae = document.activeElement;
    var resHead = $$("h1,h2,h3").filter(function (h) { return /result|search|found/i.test(txt(h)); });
    var skip = $$("a[href^='#']").filter(function (a) { return /skip.*(result|content|main)|jump.*result/i.test(txt(a) + " " + (a.getAttribute("aria-label") || "")); });
    var pag = $$('[class*="pagina" i], nav[aria-label*="pag" i], .pager, ul.pagination');
    var pagNav = pag.filter(function (p) { return p.tagName === "NAV" || p.getAttribute("role") === "navigation" || p.closest("nav,[role=navigation]"); });
    var cur = $$('[aria-current="page"], [aria-current="true"]');
    var facet = $$('[class*="facet" i], [id*="facet" i], [class*="filter" i], [class*="refine" i], [class*="limit" i]').filter(visible);
    var facetLabeled = facet.filter(function (f) { var r = f.closest("[role=region],[role=complementary],aside,nav,section,fieldset"); return r && (accName(r) || r.querySelector("h2,h3,h4,legend")); });
    // result items: repeated siblings with links
    var lists = $$("ol,ul,[role=list]").filter(function (l) { return l.children.length >= 3 && $$(":scope > * a[href]", l).length >= 3 && !l.closest("nav,header,footer"); });
    var itemsContainer = lists.sort(function (a, b) { return b.children.length - a.children.length; })[0] || null;
    var divItems = [];
    if (!itemsContainer) {
      ["[class*='result' i]", "[class*='document' i]", "article", "[class*='item' i]", "[class*='record' i]"].some(function (s) {
        var c = $$(s).filter(function (e) { return e.querySelector("a[href]") && visible(e) && txt(e).length > 20 && !e.closest("nav,header,footer"); });
        if (c.length >= 3) { divItems = c; return true; } return false;
      });
    }
    var items = itemsContainer ? Array.prototype.slice.call(itemsContainer.children) : divItems;
    var sample = items.slice(0, 6).map(function (it) { return txt(it).slice(0, 300); });
    var dupThumb = 0, thumbs = 0;
    items.slice(0, 20).forEach(function (it) {
      var im = it.querySelector("img"); if (!im) return; thumbs++;
      var alt = (im.getAttribute("alt") || "").trim().toLowerCase();
      var link = it.querySelector("a[href]"); var title = link ? accName(link).toLowerCase() : "";
      var imLink = im.closest("a"); var sameHref = imLink && link && imLink !== link && imLink.href === link.href;
      if ((alt && title && (alt === title || title.indexOf(alt) >= 0)) || sameHref) dupThumb++;
    });
    // annotations
    var countEl = $$("p,span,div,h1,h2,h3,h4,strong,li,[role=status],[aria-live]").filter(function (e) {
      return visible(e) && e.children.length <= 3 && COUNT_RE.test(txt(e)); }).sort(function (a, b) { return txt(a).length - txt(b).length; })[0];
    if (countEl) {
      var inLive = !!countEl.closest('[aria-live],[role=status],[role=alert]');
      ann(countEl, "RED1", inLive ? "good" : "issue", inLive ? "result count announced" : "count shown, not announced");
    }
    skip.forEach(function (a) { ann(a, "NAV5", "good", "skip to results"); });
    resHead.slice(0, 1).forEach(function (h) { ann(h, "NAV5", "good", "results heading"); });
    pag.slice(0, 2).forEach(function (pg) {
      var lm = pg.tagName === "NAV" || pg.getAttribute("role") === "navigation" || !!pg.closest("nav,[role=navigation]");
      var cu = !!pg.querySelector('[aria-current]');
      ann(pg, "NAV2", lm && cu ? "good" : "issue", lm && cu ? "pagination landmark + current page" : (lm ? "no current-page marker" : "pagination not a nav landmark"));
    });
    facet.slice(0, 4).forEach(function (f) { ann(f, "COM2", facetLabeled.indexOf(f) >= 0 ? "good" : "issue", facetLabeled.indexOf(f) >= 0 ? "labeled filter group" : "unlabeled filters"); });
    if (itemsContainer) ann(itemsContainer, "NAV3", "good", "results are a list");
    else if (divItems.length) divItems.slice(0, 3).forEach(function (d) { ann(d, "NAV3", "issue", "result not in a list"); });
    items.slice(0, 20).forEach(function (it) {
      var im = it.querySelector("img"); if (!im) return;
      var alt = (im.getAttribute("alt") || "").trim().toLowerCase(); var link = it.querySelector("a[href]");
      var title = link ? accName(link).toLowerCase() : ""; var imLink = im.closest("a");
      if ((alt && title && (alt === title || title.indexOf(alt) >= 0)) || (imLink && link && imLink !== link && imLink.href === link.href))
        ann(im, "RED2", "issue", "thumbnail repeats title");
    });
    var first = null;
    if (items.length) { var a = items[0].querySelector("a[href]"); if (a) { a.setAttribute("data-mdlaug-probe", "first-result"); first = a.href; } }
    return {
      count_text: m ? m[0] : "", live_regions: live.length, live_with_count: liveWithCount.length,
      focused: describe(ae && ae !== document.body ? ae : null), focus_on_body: !ae || ae === document.body,
      results_heading: resHead.slice(0, 2).map(txt), skip_to_results: skip.length,
      pagination: pag.length, pagination_landmark: pagNav.length, aria_current: cur.length,
      facets: facet.length, facets_labeled: facetLabeled.length,
      items: items.length, items_semantic_list: !!itemsContainer, item_headings: items.slice(0, 10).filter(function (it) { return it.querySelector("h2,h3,h4"); }).length,
      thumbs: thumbs, dup_thumbs: dupThumb, sample_items: sample, first_result: first
    };
  }
  function images() {
    var list = $$("img").filter(visible).filter(function (im) { var r = im.getBoundingClientRect(); return r.width >= 48 && r.height >= 48; }).slice(0, 15);
    window.__mdlaugImgs = list;
    return list.map(function (im, i) {
        var fig = im.closest("figure"); var ctx = fig ? txt(fig) : txt(im.parentElement).slice(0, 160);
        return { index: i, alt: im.hasAttribute("alt") ? im.getAttribute("alt") : null, src: (im.currentSrc || im.src || "").split("/").pop().slice(0, 80),
          w: Math.round(im.getBoundingClientRect().width), h: Math.round(im.getBoundingClientRect().height), context: ctx.slice(0, 160) };
      });
  }
  function dialogs() {
    var d = $$(OVERLAY_SEL).filter(visible).filter(function (x, i, arr) {   // outermost only
      return !arr.some(function (y) { return y !== x && y.contains(x); }); });
    return { open: d.length, sample: d.slice(0, 3).map(function (x) { return Object.assign(describe(x), { aria_modal: x.getAttribute("aria-modal") || "", focus_inside: x.contains(document.activeElement) }); }) };
  }
  function helpLinks() {
    var hl = $$("a[href]").filter(function (a) { return /\b(help|faq|how to|search tips|searching tips|user guide|accessibility)\b/i.test(accName(a) + " " + a.href); }).slice(0, 8);
    hl.slice(0, 2).forEach(function (a) { var foot = !!a.closest("footer,[role=contentinfo]"); ann(a, "FIL3", foot ? "review" : "good", foot ? "help link only in footer" : "help link"); });
    return hl.map(function (a) { return { text: accName(a).slice(0, 60), href: a.href, in_nav: !!a.closest("nav,header,[role=navigation],[role=banner]"), in_footer: !!a.closest("footer,[role=contentinfo]") }; });
  }
  function restricted() {
    var hits = [];
    $$('[aria-disabled="true"], button[disabled], [class*="lock" i], [class*="restrict" i]').filter(visible).slice(0, 8).forEach(function (el) {
      hits.push({ el: describe(el), context: txt(el.parentElement).slice(0, 220) }); ann(el, "RED4", "review", "restricted control");
    });
    $$("a,button,p,span,div").filter(function (e) { return e.children.length < 3 && /(log ?in|sign ?in) to (view|access|download)|restricted|members only|authorized users|campus only|not available/i.test(txt(e)); })
      .slice(0, 6).forEach(function (el) { hits.push({ el: describe(el), context: txt(el.parentElement).slice(0, 220) }); ann(el, "RED4", "review", "access message"); });
    return hits;
  }
  function browseLinks() {
    return $$("a[href]").filter(visible).filter(function (a) { return /\b(browse|collections|communities|all items|exhibits)\b/i.test(accName(a)); })
      .slice(0, 5).map(function (a) { return { text: accName(a).slice(0, 60), href: a.href }; });
  }
  function clearControl() {
    var s = document.querySelector('[data-mdlaug-probe="search"]'); if (!s) return { found: false };
    var scope = s.closest("form") || s.parentElement;
    var c = $$('button, input[type="reset"], [role="button"], a', scope).filter(visible).filter(function (b) {
      return /clear|reset|×|✕|✖|remove/i.test(accName(b) + " " + (b.className || "") + " " + txt(b));
    })[0];
    if (c) ann(c, "EXE1", accName(c) && !/^[×✕✖x]$/i.test(accName(c)) ? "good" : "issue", accName(c) ? "clear control" : "unnamed clear control");
    else ann(s, "EXE1", "review", "no clear control found");
    return { found: !!c, el: describe(c), named: c ? !!accName(c) && !/^[×✕✖x]$/i.test(accName(c)) : false, native_search_type: s.type === "search" };
  }
  function suggestions() {
    var s = document.querySelector('[data-mdlaug-probe="search"]'); if (!s) return { input: false };
    var lists = $$('[role="listbox"], ul[class*="suggest" i], ul[class*="autocomplete" i], [class*="typeahead" i], .ui-autocomplete, datalist').filter(visible);
    return { input: true, visible_lists: lists.length, listbox_role: $$('[role="listbox"]').filter(visible).length,
      combobox: s.getAttribute("role") === "combobox" || !!s.closest('[role="combobox"]'),
      aria_expanded: s.getAttribute("aria-expanded"), aria_autocomplete: s.getAttribute("aria-autocomplete") || "",
      aria_controls: s.getAttribute("aria-controls") || s.getAttribute("aria-owns") || "" };
  }
  window.__mdlaugProbe = { summary: summary, findSearch: findSearch, findSearchToggle: findSearchToggle, nameStats: nameStats,
    targetSizes: targetSizes, resultsInfo: resultsInfo, images: images, dialogs: dialogs, helpLinks: helpLinks,
    restricted: restricted, browseLinks: browseLinks, clearControl: clearControl, suggestions: suggestions, accName: accName,
    engineMarks: engineMarks, annotateGood: annotateGood, annotateImages: annotateImages, collect: collect,
    remediationDiff: remediationDiff, undoRemediation: undoRemediation, blocker: blocker, dismissBlocker: dismissBlocker,
    programmaticSubmit: programmaticSubmit, searchFocused: searchFocused };
})();
