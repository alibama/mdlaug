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
  var COUNT_RE = /(\d[\d,\.]*)\s*(results?|items?|records?|hits|matches|objects?|documents?)\b|\b(results?|items?)\s*\d[\d,]*\s*(-|–|to)\s*\d[\d,]*\s*of\s*\d[\d,]*|\(\s*\d[\d,]*\s*total\s*\)|\b\d[\d,]*\s+total\b/i;

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

  // ---- overlays: consent managers, modals, promos, interstitials ----
  // Known consent-management platforms: [name, container, dismiss controls in order of
  // preference — reject/necessary-only first, then close, then accept as a last resort].
  var CMP = [
    ["OneTrust", "#onetrust-banner-sdk, #onetrust-pc-sdk", "#onetrust-reject-all-handler, .ot-pc-refuse-all-handler, .onetrust-close-btn-handler, #onetrust-accept-btn-handler"],
    ["Cookiebot", "#CybotCookiebotDialog", "#CybotCookiebotDialogBodyButtonDecline, #CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll, #CybotCookiebotDialogBodyLevelButtonLevelOptinAllowallSelection"],
    ["Klaro", ".klaro .cookie-notice, .klaro .cookie-modal, #klaro .cookie-notice, #klaro .cookie-modal", ".cn-decline, .cm-btn-decline, .cm-btn-danger, .cm-btn-accept"],
    ["CookieYes", ".cky-consent-container, #cookie-law-info-bar", ".cky-btn-reject, #cookie_action_close_header_reject, [data-cli_action='reject'], .cky-banner-btn-close"],
    ["Osano", ".osano-cm-window .osano-cm-dialog, .osano-cm-dialog", ".osano-cm-denyAll, .osano-cm-button--type_denyAll, .osano-cm-dialog__close"],
    ["Didomi", "#didomi-popup, #didomi-notice", "#didomi-notice-disagree-button, .didomi-continue-without-agreeing"],
    ["TrustArc", "#truste-consent-track, .truste_box_overlay, #consent_blackbar", "#truste-consent-required, .truste-consent-required"],
    ["Usercentrics", "#usercentrics-root, #usercentrics-cmp-ui", "[data-testid='uc-deny-all-button']"],
    ["Quantcast", ".qc-cmp2-container", ".qc-cmp2-summary-buttons button[mode='secondary']"],
    ["Complianz", ".cmplz-cookiebanner", ".cmplz-deny, .cmplz-close"],
    ["Iubenda", "#iubenda-cs-banner", ".iubenda-cs-reject-btn, .iubenda-cs-close-btn"],
    ["Termly", "[class*='termly-styles-root']", "[data-tid='banner-decline']"],
    ["CookieConsent", ".cc-window, .cc-banner, #cc-main .cm, #cc--main #cm", ".cc-deny, .cc-dismiss, .cm__btn[data-role='necessary'], #c-s-bn, .cc-btn.cc-allow"],
    ["EU Cookie Compliance (Drupal)", "#sliding-popup, .eu-cookie-compliance-banner", ".decline-button, .eu-cookie-compliance-default-button, .agree-button"],
    ["Cookie Notice (WordPress)", "#cookie-notice", "#cn-refuse-cookie, #cn-close-notice, #cn-accept-cookie"],
    ["Civic Cookie Control", "#ccc-notify, #ccc-module, #ccc-overlay", "#ccc-notify-reject, #ccc-reject-settings, #ccc-close"],
    ["GDPR Cookie Compliance", "#moove_gdpr_cookie_info_bar", ".moove-gdpr-infobar-reject-btn, .moove-gdpr-infobar-close-btn"],
    ["Borlabs", "#BorlabsCookieBox", "[data-cookie-refuse], .brlbs-btn-accept-only-essential"]
  ];
  var DIALOG_SEL = '[role="dialog"], [role="alertdialog"], dialog[open], [aria-modal="true"], .modal.show, .modal.in, .modal_overlay';
  var CONSENT_TXT = /cookie|consent|gdpr|ccpa|tracking technolog|personal (data|information)|privacy (policy|preferences|settings)|we use|do not sell/i;
  var PROMO_TXT = /newsletter|subscribe|sign ?up|survey|feedback|donat|membership|join us|mailing list/i;
  var APP_TXT = /switch to (the )?(desktop|mobile|full|classic) (view|site|version)|desktop view|(get|download|open in) (the|our) app|open in app/i;
  var DISMISS = [/reject all|decline all|deny all|refuse all|reject|decline|deny|refuse|necessary only|only necessary|essential only|only essential|necessary cookies only|accept (only )?(the )?(necessary|essential)|continue without/i,
                 /^(×|✕|✖|x)$|^close|close (this|dialog|banner|window|notice|pop)|dismiss|no,? thanks|not now|maybe later|^skip$|hide/i,
                 /^ok$|okay|got it|i understand|understood|continue|accept all|accept|agree|allow all|allow|that'?s ok/i];
  var BTN_SEL = "button, a[href], [role=button], input[type=button], input[type=submit]";

  function fixedRoot(el) {   // outermost fixed-position ancestor with a size (what actually floats over the page)
    var best = null, zeroFixed = null, chain = [];
    for (var p = el; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      chain.push(p);
      if (getComputedStyle(p).position === "fixed") {
        var r = p.getBoundingClientRect();
        if (r.width * r.height > 0) best = p; else zeroFixed = p;
      }
    }
    if (best) return best;
    if (zeroFixed) {   // consent libraries often wrap the dialog in a zero-size fixed container: use its sized child
      for (var j = chain.indexOf(zeroFixed) - 1; j >= 0; j--) {
        var rr = chain[j].getBoundingClientRect(); if (rr.width * rr.height > 0) return chain[j];
      }
    }
    return null;
  }
  function coverage(el) {
    var r = el.getBoundingClientRect();
    var w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    var h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    return (w * h) / Math.max(1, innerWidth * innerHeight);
  }
  // Web components (e.g. <notice-dialog>) draw their dialog inside a shadow root: the host
  // element itself may have no size or position, so measure the layer inside it.
  function layer(el) {
    var sr = el && el.shadowRoot;
    if (!sr) return el;
    var cand = Array.prototype.slice.call(sr.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"], *'))
      .filter(function (x) { return visible(x) && (x.matches('dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]') ||
        getComputedStyle(x).position === "fixed"); });
    return cand.sort(function (a, b) { return coverage(b) - coverage(a); })[0] || el;
  }
  // A closed shadow root can't be read at all and its host reports no size, but hit-testing
  // still lands on the host wherever its layer is drawn: estimate coverage from a 5×7 grid.
  function closedHost(el) {
    if (!el || el.shadowRoot || el.tagName.indexOf("-") < 0) return false;
    var r = el.getBoundingClientRect(); return r.width * r.height < 4;
  }
  function hostHits(el) {
    var n = 0;
    for (var gx = 1; gx <= 5; gx++) for (var gy = 1; gy <= 7; gy++) {
      if (document.elementFromPoint(innerWidth * gx / 6, innerHeight * gy / 8) === el) n++;
    }
    return n;
  }
  function layerCoverage(el) { return closedHost(el) ? hostHits(el) / 35 : coverage(layer(el)); }
  function layerVisible(el) { return closedHost(el) ? hostHits(el) >= 2 : visible(layer(el)); }
  function deepButtons(el) {
    var out = $$(BTN_SEL, el);
    if (el.shadowRoot) out = out.concat(Array.prototype.slice.call(el.shadowRoot.querySelectorAll(BTN_SEL)));
    return out.filter(visible);
  }
  function isOurs(el) { return !!(el.closest && el.closest('[class*="mdlaug-"], [id^="mdlaug"], #__mdlaug')); }
  function cmpFor(el) {
    for (var i = 0; i < CMP.length; i++) { try { if (el.matches(CMP[i][1]) || el.closest(CMP[i][1]) || el.querySelector(CMP[i][1])) return CMP[i]; } catch (e) {} }
    return null;
  }
  // Every visible overlay, outermost element only. An overlay is a known consent manager,
  // an element exposed as a dialog, or a fixed-position layer that either covers most of
  // the screen or carries consent/promo text. Fixed site headers and nav bars are not overlays.
  function overlays() {
    var roots = [];
    function add(el) {
      if (!el || isOurs(el) || !layerVisible(el)) return;
      for (var i = 0; i < roots.length; i++) { if (roots[i] === el || roots[i].contains(el)) return; if (el.contains(roots[i])) { roots.splice(i, 1); i--; } }
      roots.push(el);
    }
    CMP.forEach(function (c) { $$(c[1]).filter(visible).forEach(function (el) { add(fixedRoot(el) || el); }); });
    // dialogs: modal ones, big ones, or consent/promo ones (a small non-modal share bar or chat launcher is page furniture)
    $$(DIALOG_SEL).filter(visible).forEach(function (el) {
      var cov = coverage(el), t = txt(el).slice(0, 600);
      var modal = el.getAttribute("aria-modal") === "true" || (el.tagName === "DIALOG" && el.matches(":modal"));
      // a dialog sitting in the page flow (a search form marked role=dialog) isn't floating over anything
      var floats = !!fixedRoot(el) || getComputedStyle(el).position === "absolute";
      var inChrome = !modal && !!el.closest("header, nav, [role=banner], [role=navigation]") && !CONSENT_TXT.test(t);
      if (inChrome) return;      // a search panel or menu in the site header, not a layer over the page
      if (cov > 0.01 && (modal || cov >= 0.5 || (floats && (cov >= 0.15 || CONSENT_TXT.test(t) || PROMO_TXT.test(t) || APP_TXT.test(t)))))
        add(fixedRoot(el) || el);
    });
    // sample the viewport: what floats on top of the page?
    for (var gx = 1; gx <= 5; gx++) for (var gy = 1; gy <= 7; gy++) {
      var top = document.elementFromPoint(innerWidth * gx / 6, innerHeight * gy / 8); if (!top) continue;
      if (top.shadowRoot && top.tagName.indexOf("-") > 0) {
        var ly = layer(top);
        if (ly !== top && coverage(ly) >= 0.04) { add(top); continue; }
      }
      if (closedHost(top)) { if (hostHits(top) >= 2) add(top); continue; }
      var fr = fixedRoot(top); if (!fr || isOurs(fr)) continue;
      var t = txt(fr).slice(0, 600), cov = coverage(fr);
      var chrome = fr.matches("header, nav, [role=banner], [role=navigation], footer, [role=contentinfo]") ||
        (fr.querySelector("nav, [role=navigation]") && cov < 0.4);
      if (cov >= 0.5 || (!chrome && cov >= 0.03 && (CONSENT_TXT.test(t) || PROMO_TXT.test(t) || APP_TXT.test(t)) && fr.querySelector(BTN_SEL))) add(fr);
    }
    return roots;
  }
  function overlayInfo(el, i) {
    el.setAttribute("data-mdlaug-overlay", String(i));
    var closed = closedHost(el), ly = layer(el), c = cmpFor(el), t = txt(ly).slice(0, 400), cov = layerCoverage(el);
    var dlg = ly.matches(DIALOG_SEL) ? ly : (ly.querySelector(DIALOG_SEL) || null);
    var named = dlg ? accName(dlg) || "" : "";
    if (dlg && !named && dlg.getAttribute("aria-labelledby")) {
      var root = dlg.getRootNode && dlg.getRootNode().getElementById ? dlg.getRootNode() : document;
      named = txt(root.getElementById(dlg.getAttribute("aria-labelledby")));
    }
    var btns = deepButtons(el);
    var names = btns.map(function (b) { return (accName(b) || b.value || "").trim(); });
    var cx = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    if (closed) {   // nothing inside is readable: report what hit-testing shows, the rest as unknown
      ann(el, "INT1", "review", "overlay in a closed shadow root");
      return { index: i, kind: "dialog", cmp: "", el: describe(el), coverage: Math.round(cov * 100) / 100,
        blocks_center: document.elementFromPoint(innerWidth / 2, innerHeight / 2) === el, closed_shadow: true,
        dialog_role: null, dialog_tag: "", aria_modal: null, name: null, focus_inside: document.activeElement === el,
        buttons: [], unnamed_buttons: null, has_reject: null, has_close: null, text: "" };
    }
    var kind = c || CONSENT_TXT.test(t) ? "consent" : PROMO_TXT.test(t) ? "promo" : APP_TXT.test(t) ? "app_banner" : (!t && cov >= 0.5) ? "backdrop" :
      /verify|human|robot|captcha/i.test(t) ? "challenge" : dlg ? "dialog" : "interstitial";
    var info = {
      index: i, kind: kind, cmp: c ? c[0] : "", el: describe(el), coverage: Math.round(cov * 100) / 100,
      blocks_center: !!(cx && (el.contains(cx) || cx === el)), dialog_role: !!dlg, shadow: ly !== el, dialog_tag: dlg ? (dlg.getAttribute("role") || dlg.tagName.toLowerCase()) : "",
      aria_modal: !!(dlg && dlg.getAttribute("aria-modal") === "true") || !!(dlg && dlg.tagName === "DIALOG" && dlg.matches(":modal")),
      name: (named || "").slice(0, 120), focus_inside: el.contains(document.activeElement) || (!!el.shadowRoot && !!el.shadowRoot.activeElement),
      buttons: names.slice(0, 8), unnamed_buttons: names.filter(function (n) { return !n; }).length,
      has_reject: names.some(function (n) { return DISMISS[0].test(n); }), has_close: names.some(function (n) { return DISMISS[1].test(n); }),
      text: t.slice(0, 200)
    };
    ann(el, "INT1", "issue", (c ? c[0] + " " : "") + kind + " overlay on load");
    return info;
  }
  function detectOverlays() {
    $$("[data-mdlaug-overlay]").forEach(function (e) { e.removeAttribute("data-mdlaug-overlay"); });
    return overlays().map(overlayInfo);
  }
  function overlayVisible(i) {
    var el = document.querySelector('[data-mdlaug-overlay="' + i + '"]');
    if (!el || !el.isConnected) return false;
    if (closedHost(el)) return getComputedStyle(el).display !== "none" && hostHits(el) >= 2;
    if (!visible(el) && !el.shadowRoot) return false;
    var ly = layer(el);
    return visible(ly) && coverage(ly) > 0;
  }
  function overlayFocusable(i) {   // is keyboard focus currently inside overlay i?
    var el = document.querySelector('[data-mdlaug-overlay="' + i + '"]');
    return !!(el && (el.contains(document.activeElement) || document.activeElement === el || (el.shadowRoot && el.shadowRoot.activeElement)));
  }
  // Dismiss overlay i using controls INSIDE it (never a page-wide search): the consent
  // manager's own reject control, then any reject/close/accept button by name.
  function dismissOverlay(i) {
    var el = document.querySelector('[data-mdlaug-overlay="' + i + '"]'); if (!el) return { dismissed: false, via: "gone" };
    var c = cmpFor(el), deferred = [];
    function click(b, via, extra) { var lb = (accName(b) || b.value || "").trim(); b.click(); return Object.assign({ dismissed: true, via: via, label: lb.slice(0, 60) }, extra || {}); }
    if (c) {
      var scope = el.matches(c[1]) || el.querySelector(c[1]) ? el : document;   // CMP buttons can sit in a sibling preference pane
      var sels = c[2].split(/\s*,\s*/);
      for (var k = 0; k < sels.length; k++) {
        if (/accept|agree|allow/i.test(sels[k])) { deferred.push(sels[k]); continue; }   // accepting is the last resort
        var b = $$(sels[k], scope).filter(visible)[0] || (scope === el ? $$(sels[k]).filter(function (x) { return visible(x) && x.closest(c[1]); })[0] : null);
        if (b) return click(b, "cmp-control", { cmp: c[0], priority: 0 });
      }
    }
    var btns = deepButtons(el);
    for (var p = 0; p < 2; p++) {    // reject, then close
      var hit = btns.filter(function (x) { return DISMISS[p].test((accName(x) || x.value || "").trim()); })[0];
      if (hit) return click(hit, "button", { priority: p });
    }
    var closeSel = '[class*="close" i], [aria-label*="close" i], [title*="close" i]';
    var x = $$(closeSel, el).concat(el.shadowRoot ? Array.prototype.slice.call(el.shadowRoot.querySelectorAll(closeSel)) : []).filter(visible)[0];
    if (x) return click(x, "close-icon", { priority: 1 });
    try {   // consent-manager APIs, privacy-preferring, before anything that accepts
      if (window.OneTrust && OneTrust.RejectAll) { OneTrust.RejectAll(); return { dismissed: true, via: "cmp-api", cmp: "OneTrust", label: "OneTrust.RejectAll()", priority: 0 }; }
      if (window.Cookiebot && Cookiebot.decline) { Cookiebot.decline(); return { dismissed: true, via: "cmp-api", cmp: "Cookiebot", label: "Cookiebot.decline()", priority: 0 }; }
      if (window.Didomi && Didomi.setUserDisagreeToAll) { Didomi.setUserDisagreeToAll(); return { dismissed: true, via: "cmp-api", cmp: "Didomi", label: "Didomi.setUserDisagreeToAll()", priority: 0 }; }
    } catch (e) {}
    for (var d = 0; d < deferred.length; d++) {
      var a = $$(deferred[d]).filter(visible)[0];
      if (a) return click(a, "cmp-control", { cmp: c[0], priority: 2 });
    }
    var acc = btns.filter(function (x) { return DISMISS[2].test((accName(x) || x.value || "").trim()); })[0];
    if (acc) return click(acc, "button", { priority: 2 });
    return { dismissed: false, via: "none" };
  }
  // Last resort so measurements see the page: hide the overlay and any full-screen
  // backdrop, and release the scroll lock / inert attribute overlays leave behind.
  function hideOverlay(i) {
    var el = document.querySelector('[data-mdlaug-overlay="' + i + '"]');
    if (el) el.style.setProperty("display", "none", "important");
    $$(".onetrust-pc-dark-filter, .modal-backdrop, [class*='backdrop' i], [class*='overlay' i]").filter(function (b) {
      return visible(b) && !txt(b) && getComputedStyle(b).position === "fixed" && coverage(b) > 0.5;
    }).forEach(function (b) { b.style.setProperty("display", "none", "important"); });
    [document.documentElement, document.body].forEach(function (n) {
      if (getComputedStyle(n).overflow === "hidden" || getComputedStyle(n).overflowY === "hidden") n.style.setProperty("overflow", "auto", "important");
    });
    $$("[inert]").forEach(function (n) { n.removeAttribute("inert"); });
    return { hidden: !!el };
  }
  // What is on top of the search box? Only an overlay counts as a blocker; an ordinary
  // page element overlapping the box (sticky header, dropdown) is reported, not dismissed.
  function blocker() {
    var s = document.querySelector('[data-mdlaug-probe="search"]'); if (!s) return { found: false };
    var r = s.getBoundingClientRect();
    var x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1), y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
    var top = document.elementFromPoint(x, y);
    if (!top || top === s || s.contains(top) || top.contains(s)) return { found: false };
    var ov = overlays().filter(function (o) { return o.contains(top); })[0];
    if (!ov) return { found: false, covered_by: describe(top) };
    var n = $$("[data-mdlaug-overlay]").length;
    ov.setAttribute("data-mdlaug-probe", "blocker");
    var info = overlayInfo(ov, ov.getAttribute("data-mdlaug-overlay") || ("late" + n));
    return { found: true, el: describe(ov), covering: describe(top), overlay: info };
  }
  function dismissBlocker() {
    var el = document.querySelector('[data-mdlaug-probe="blocker"]'); if (!el) return { dismissed: false };
    var i = el.getAttribute("data-mdlaug-overlay");
    var res = dismissOverlay(i);
    if (!res.dismissed) { hideOverlay(i); res = { dismissed: true, via: "hidden", label: "" }; }
    return res;
  }

  // ---- bot protection: a challenge page instead of the site (never solved, only recorded) ----
  function challenge() {
    var body = txt(document.body), t = (document.title || "") + " " + body.slice(0, 1500);
    var sig = [];
    if (/just a moment|attention required|performing security verification|verify(ing)? (that )?you are (a )?human|checking (your|if the site connection is secure)|human verification|are you a robot|pardon our interruption|request unsuccessful|incapsula|ddos protection by|bot (detection|protection)|(not|aren'?t) a (ro)?bot|failed the browser check|\bsecurity check\b|making sure you'?re not a bot/i.test(t)) sig.push("text");
    if (document.querySelector('iframe[src*="challenges.cloudflare.com"], iframe[src*="hcaptcha.com"], iframe[src*="recaptcha"], #challenge-form, #cf-challenge-running, .cf-turnstile, #px-captcha, #challenge-stage')) sig.push("widget");
    if (/turnstile_challenge|__cf_chl|\/captcha|cdn-cgi\/challenge/i.test(location.href)) sig.push("url");
    var short = body.length < 1500;
    var blocked = sig.indexOf("url") >= 0 || (sig.indexOf("text") >= 0 && body.length < 3000) || (sig.indexOf("widget") >= 0 && short);
    return { blocked: blocked, signals: sig, title: (document.title || "").slice(0, 120), body_chars: body.length };
  }

  // ---- platform fingerprint: which repository software is this, by its own markers ----
  var FP = [
    ["CONTENTdm", [/powered by contentdm/i, /\/digital\/(collection|search|api)\//, /\/customizations\/global\//, /contentdm\.oclc\.org/, /wp-content\/plugins\/contentdm/]],
    ["DSpace", [/dspace/i, /<ds-app|ds-app#?/, /\/handle\/\d+\/\d+/, /\/(xmlui|jspui)\b/, /dspace-angular-state/]],
    ["Digital commons", [/bepress/i, /ir-style\.css/, /\/do\/search/, /digital commons network/i, /network\.bepress\.com/]],
    ["Islandora", [/islandora/i, /\/islandora\/(object|search)/, /search_api_fulltext/]],
    ["Omeka", [/omeka/i, /\/application\/views\/scripts\//, /\/application\/asset\//, /\/items\/(show|browse)/, /\/s\/[a-z0-9-]+\/(item|page)/]],
    ["Samvera", [/hyrax|hyku|samvera/i, /blacklight/i, /\/concern\//, /spotlight/i, /arclight/i, /\/catalog\?/]],
    ["Preservica", [/preservica/i]], ["Primo", [/primo|\/discovery\/(search|collectionDiscovery)/i]],
    ["CollectiveAccess", [/collectiveaccess|pawtucket/i]], ["ArchivesSpace", [/archivesspace/i]],
    ["Quartex", [/quartex/i]], ["LUNA", [/luna\/servlet/i]], ["Archive-It", [/archive-it\.org/i]],
    ["WordPress", [/wp-content|wp-includes/]], ["Drupal", [/drupal/i]]
  ];
  function fingerprint() {
    var gen = $$('meta[name="generator" i]').map(function (m) { return m.content || ""; });
    var hay = [gen.join(" | "),
      $$("script[src]").map(function (s) { return s.getAttribute("src"); }).join(" "),
      $$("link[rel~=stylesheet]").map(function (l) { return l.getAttribute("href"); }).join(" "),
      document.documentElement.className + " " + (document.body ? document.body.className : ""),
      $$("body > *").map(function (e) { return e.tagName.toLowerCase() + (e.id ? "#" + e.id : ""); }).join(" "),
      $$("a[href]").slice(0, 400).map(function (a) { return a.getAttribute("href"); }).join(" "),
      txt(document.body).slice(-800), location.href].join("\n");
    var scores = FP.map(function (f) {
      var hits = f[1].filter(function (re) { return re.test(hay); }).map(String);
      return { platform: f[0], hits: hits };
    }).filter(function (s) { return s.hits.length; });
    // repository software outranks the CMS/framework it may sit on (Islandora is Drupal; CONTENTdm sites often front WordPress)
    var generic = { WordPress: 1, Drupal: 1 };
    scores.sort(function (a, b) { return (generic[a.platform] || 0) - (generic[b.platform] || 0) || b.hits.length - a.hits.length; });
    var best = scores[0] || null;
    return { platform: best ? best.platform : "", confidence: best ? (best.hits.length >= 2 ? "high" : "low") : "none",
      generator: gen.slice(0, 3), candidates: scores.slice(0, 4) };
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
    var lists = $$("ol,ul,[role=list],table > tbody").filter(function (l) { return l.children.length >= 3 && $$(":scope > * a[href]", l).length >= 3 && !l.closest("nav,header,footer"); });
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
    // first result = first link in the result items that leads to a record, not back into search (facets, sorting, paging)
    var first = null, NOT_ITEM = /[?&](f|fq|facet|filter|sort|per_page|page|range|search_field)(\[|%5B|=)|\/(search|discover)\b|\/catalog\?|^javascript:|#$/i;
    items.slice(0, 6).some(function (it) {
      var a = $$("a[href]", it).filter(function (x) { return !NOT_ITEM.test(x.getAttribute("href") || ""); })[0];
      if (a) { a.setAttribute("data-mdlaug-probe", "first-result"); first = a.href; return true; } return false;
    });
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
  // Cheap, side-effect-free check used while waiting for a results page to finish rendering.
  function resultsState() {
    var main = document.querySelector("main,[role='main']") || document.body, body = txt(main);
    var busy = $$('[aria-busy="true"], [class*="spinner" i], [class*="loading" i], [class*="loader" i]').filter(visible)
      .filter(function (e) { return coverage(e) > 0.002; }).length;
    var loading = busy > 0 || /^\s*(loading|searching|please wait)\b/i.test(body.slice(0, 300)) || /\bloading\.{3}|\bloading…/i.test(body.slice(0, 1500));
    var lists = $$("ol,ul,[role=list],table > tbody").filter(function (l) { return l.children.length >= 3 && $$(":scope > * a[href]", l).length >= 3 && !l.closest("nav,header,footer"); });
    var cards = $$("[class*='result' i], article, [class*='item' i], [class*='record' i]").filter(function (e) {
      return e.querySelector("a[href]") && txt(e).length > 20 && !e.closest("nav,header,footer") && visible(e); });
    var m = body.match(COUNT_RE);
    return { loading: loading, count_text: m ? m[0] : "", lists: lists.length, cards: cards.length,
      no_results: /no (results|items|records|matches|documents)( were)? found|did not match any|0 results|nothing (was )?found|returned no results|no matching/i.test(body),
      chars: body.length };
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
    programmaticSubmit: programmaticSubmit, searchFocused: searchFocused, detectOverlays: detectOverlays,
    overlayVisible: overlayVisible, overlayFocusable: overlayFocusable, dismissOverlay: dismissOverlay,
    hideOverlay: hideOverlay, challenge: challenge, fingerprint: fingerprint, resultsState: resultsState };
})();
