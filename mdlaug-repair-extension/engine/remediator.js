/*
 * mDLAUG Remediator — live DOM repair for the 24 help-seeking situations
 * inspired by the public mDLAUG guideline situations
 *
 * Framework-free. Idempotent (safe to run repeatedly). Reversible (every
 * mutation is recorded and can be undone). No network, no storage, no eval.
 *
 * Each rule is tagged with the mDLAUG situation code(s) it addresses and the
 * conformance level from mDLAUG Appendix IV (A = lowest, AA, AAA = highest).
 * A rule either FIXES (applies a safe repair) or FLAGS (surfaces an issue that
 * needs human/AI content, e.g. an image description) — we never invent
 * descriptive text and present it as authored.
 */
(function (root) {
  "use strict";

  var MARK = "data-mdlaug"; // marks elements we touched
  var ORIG = "data-mdlaug-orig"; // JSON of original attributes we changed
  var SR_ONLY_ID = "mdlaug-sr-style";
  var LIVE_ID = "mdlaug-live-region";
  var OVERLAY_ID = "mdlaug-overlay";

  // ---- utilities ---------------------------------------------------------
  function $all(sel, ctx) {
    try { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
    catch (e) { return []; }
  }
  function text(el) { return (el.textContent || "").replace(/\s+/g, " ").trim(); }
  // Accessible text: excludes aria-hidden subtrees, and treats content that is
  // only symbols/emoji/punctuation (e.g. a bare "×" or magnifier glyph) as empty,
  // because a screen reader derives no usable name from it.
  function visibleName(el) {
    var t = "";
    (function walk(node) {
      if (!node.childNodes) return;
      Array.prototype.forEach.call(node.childNodes, function (c) {
        if (c.nodeType === 3) t += c.nodeValue;
        else if (c.nodeType === 1) {
          if (c.getAttribute && c.getAttribute("aria-hidden") === "true") return;
          walk(c);
        }
      });
    })(el);
    t = t.replace(/\s+/g, " ").trim();
    var hasWord = false;
    try { hasWord = /[\p{L}\p{N}]/u.test(t); } catch (e) { hasWord = /[a-z0-9]/i.test(t); }
    return hasWord ? t : "";
  }
  function hasName(el) {
    if (el.getAttribute("aria-label")) return true;
    if (el.getAttribute("aria-labelledby")) return true;
    var t = el.getAttribute("title");
    if (t && t.trim()) return true;
    if (visibleName(el)) return true;
    var img = el.querySelector && el.querySelector("img[alt]");
    if (img && img.getAttribute("alt") && img.getAttribute("alt").trim()) return true;
    return false;
  }
  function remember(el, attrs) {
    // Accumulate the ORIGINAL value of each attribute the first time it is
    // changed, merging across multiple setAttr calls on the same element, so
    // undo() restores every modified attribute (not just the first).
    var snap = {};
    if (el.hasAttribute(ORIG)) { try { snap = JSON.parse(el.getAttribute(ORIG)) || {}; } catch (e) { snap = {}; } }
    var changed = false;
    attrs.forEach(function (a) {
      if (Object.prototype.hasOwnProperty.call(snap, a)) return; // keep the earliest original
      snap[a] = el.hasAttribute(a) ? el.getAttribute(a) : null;
      changed = true;
    });
    if (changed) { try { el.setAttribute(ORIG, JSON.stringify(snap)); } catch (e) {} }
  }
  function setAttr(el, name, value) {
    remember(el, [name]);
    el.setAttribute(name, value);
  }
  function mark(el, code) {
    var cur = el.getAttribute(MARK) || "";
    var codes = cur ? cur.split(" ") : [];
    if (codes.indexOf(code) === -1) codes.push(code);
    el.setAttribute(MARK, codes.join(" "));
  }
  function ensureSrOnlyStyle() {
    if (document.getElementById(SR_ONLY_ID)) return;
    var s = document.createElement("style");
    s.id = SR_ONLY_ID;
    s.textContent =
      ".mdlaug-sr-only{position:absolute!important;width:1px;height:1px;" +
      "padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);" +
      "white-space:nowrap;border:0}" +
      ".mdlaug-inline-view{display:block;width:100%;margin:.5rem 0;border:2px solid #1f9e8f}" +
      ".mdlaug-viewbtn{margin-inline-start:.5rem;font:inherit;cursor:pointer;" +
      "border:1px solid currentColor;border-radius:4px;padding:.1em .5em;background:transparent}" +
      ".mdlaug-viewbtn:focus{outline:3px solid #1f9e8f;outline-offset:2px}" +
      ".mdlaug-mediabar{margin:.35rem 0;display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}" +
      ".mdlaug-medianote{font-size:.9em;color:#8a2f4f}" +
      ".mdlaug-transcript{margin:.35rem 0;font-size:.95em}" +
      ".mdlaug-transcript summary{cursor:pointer;font-weight:600}";
    (document.head || document.documentElement).appendChild(s);
  }
  function srSpan(str) {
    ensureSrOnlyStyle();
    var s = document.createElement("span");
    s.className = "mdlaug-sr-only";
    s.setAttribute(MARK, "sr");
    s.textContent = str;
    return s;
  }
  function liveRegion() {
    var r = document.getElementById(LIVE_ID);
    if (r) return r;
    ensureSrOnlyStyle();
    r = document.createElement("div");
    r.id = LIVE_ID;
    r.className = "mdlaug-sr-only";
    r.setAttribute("aria-live", "polite");
    r.setAttribute("aria-atomic", "true");
    r.setAttribute("role", "status");
    (document.body || document.documentElement).appendChild(r);
    return r;
  }
  function announce(msg) {
    var r = liveRegion();
    r.textContent = "";
    // rAF so AT registers the change
    (root.requestAnimationFrame || setTimeout)(function () { r.textContent = msg; }, 16);
  }
  var report = [];
  function log(entry) { report.push(entry); }

  // human-readable file-type names for ACC1
  var TYPE_NAMES = {
    pdf: "PDF", doc: "Word", docx: "Word", ppt: "PowerPoint", pptx: "PowerPoint",
    xls: "Excel", xlsx: "Excel", csv: "CSV", txt: "text", rtf: "rich text",
    epub: "EPUB e-book", zip: "ZIP archive", mp3: "audio", mp4: "video"
  };
  function fileExt(href) {
    var m = /\.([a-z0-9]{2,5})(?:[?#].*)?$/i.exec(href || "");
    return m ? m[1].toLowerCase() : null;
  }
  function humanSize(bytes) {
    if (!bytes && bytes !== 0) return null;
    var u = ["bytes", "KB", "MB", "GB"], i = 0, n = bytes;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i === 0 ? n : n.toFixed(1)) + " " + u[i];
  }

  // ------------------------------------------------------------------------
  // RULES: each { code, level, fix, flag?, kind, describe, run(opts) }
  // run() returns count of elements it acted on.
  // ------------------------------------------------------------------------
  var RULES = [];
  function rule(def) { RULES.push(def); }

  // ---- ACC1: Difficulty directly accessing files ------------------------
  rule({
    id: "file-links", code: "ACC1", level: "A", kind: "fix",
    describe: "Linked files (PDF/DOCX/…) get a meaningful accessible name with " +
      "format and size, a new-window warning, and an inline-view control.",
    run: function (opts) {
      var n = 0;
      $all("a[href]").forEach(function (a) {
        var href = a.getAttribute("href") || "";
        var ext = fileExt(href);
        if (!ext || !TYPE_NAMES[ext]) return;
        if (a.getAttribute(MARK) && a.getAttribute(MARK).indexOf("ACC1") > -1) return;
        var label = text(a) || a.getAttribute("aria-label") || "File";
        var typeName = TYPE_NAMES[ext];
        var sizeStr = a.getAttribute("data-size") ? humanSize(+a.getAttribute("data-size")) : null;
        var name = label.replace(/\s*\((opens|pdf|docx|word|download).*?\)\s*$/i, "");
        // WCAG 2.4.4: generic link text ("here", "click here", "download") gives
        // a screen-reader user no purpose — derive a name from the file itself.
        if (/^(here|click here|click|read more|more|link|this|download|view|view here|open)$/i.test(name.trim())) {
          var base = (href.split(/[?#]/)[0].split("/").pop() || "").replace(/\.[a-z0-9]+$/i, "");
          try { base = decodeURIComponent(base); } catch (e) {}
          base = base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
          if (base) name = base;
        }
        var aria = name + ", " + typeName + " file" + (sizeStr ? ", " + sizeStr : "");
        var newWin = (a.getAttribute("target") === "_blank");
        if (newWin) aria += " (opens in new window)";
        setAttr(a, "aria-label", aria);
        if (newWin) setAttr(a, "rel", (a.getAttribute("rel") || "").indexOf("noopener") > -1 ? a.getAttribute("rel") : ((a.getAttribute("rel") || "") + " noopener").trim());

        // ACC1 best practice: inline-view control (no navigation away).
        if (opts.inlineViewers !== false && (ext === "pdf" || ext === "txt" || ext === "csv" || ext === "docx")) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "mdlaug-viewbtn";
          btn.setAttribute(MARK, "ACC1");
          btn.textContent = "View inline";
          btn.setAttribute("aria-label", "View " + name + " inline on this page, " + typeName + " file");
          btn.setAttribute("aria-expanded", "false");
          btn.addEventListener("click", function () {
            var open = btn.getAttribute("aria-expanded") === "true";
            if (open) { collapseInline(btn); return; }
            expandInline(a, btn, ext, name, opts);
          });
          a.insertAdjacentElement("afterend", btn);
        }
        mark(a, "ACC1");
        n++;
      });
      if (n) log({ code: "ACC1", level: "A", kind: "fix", count: n,
        msg: n + " file link(s) labelled with format/size + inline view added." });
      return n;
    }
  });

  function collapseInline(btn) {
    var host = btn.nextElementSibling;
    if (host && host.getAttribute(MARK) === "ACC1-view") host.remove();
    btn.setAttribute("aria-expanded", "false");
    btn.textContent = "View inline";
    btn.focus();
  }
  function expandInline(a, btn, ext, name, opts) {
    var host = document.createElement("div");
    host.setAttribute(MARK, "ACC1-view");
    host.className = "mdlaug-inline-view";
    host.setAttribute("role", "region");
    host.setAttribute("aria-label", name + " — inline document view");
    host.setAttribute("tabindex", "-1");
    btn.insertAdjacentElement("afterend", host);
    btn.setAttribute("aria-expanded", "true");
    btn.textContent = "Hide inline view";

    var conv = root.mDLAUG && root.mDLAUG.converter;
    if (ext === "pdf" && conv && conv.mountAccessiblePdf) {
      host.textContent = "Loading accessible view…";
      conv.mountAccessiblePdf(a.href, host).then(function () { host.focus(); })
        .catch(function () { fallbackIframe(); }); // browsers render PDF in an iframe
    } else if ((ext === "docx" || ext === "txt" || ext === "csv") && conv && conv.mountAccessibleDoc) {
      host.textContent = "Loading accessible view…";
      conv.mountAccessibleDoc(a.href, ext, host).then(function () { host.focus(); })
        .catch(function () { showFetchError(); }); // never iframe a .docx — that just downloads
    } else { fallbackIframe(); }

    function showFetchError() {
      host.textContent = "";
      var p = document.createElement("p");
      p.style.margin = "0 0 .4rem";
      p.textContent = "Couldn't fetch this file to convert it — it may be blocked cross-origin, or served over http on an https page.";
      var link = document.createElement("a");
      link.href = a.href; link.textContent = "Open the original file"; link.setAttribute("rel", "noopener");
      host.appendChild(p); host.appendChild(link); host.focus();
    }
    function fallbackIframe() {
      host.textContent = "";
      var f = document.createElement("iframe");
      f.src = a.href;
      f.width = "100%";
      f.height = "540";
      f.title = name + " document viewer";
      host.appendChild(f);
      host.focus();
    }
  }

  // ---- ACC2 / COM3: images ----------------------------------------------
  rule({
    id: "images-alt", code: "ACC2/COM3", level: "A", kind: "fix+flag",
    describe: "Images with no alt are flagged for a description; decorative " +
      "thumbnails beside real text are hidden from screen readers to stop double-speak.",
    run: function (opts) {
      var n = 0, flagged = 0;
      $all("img").forEach(function (img) {
        var alt = img.getAttribute("alt");
        var inLinkWithText = img.closest("a") && text(img.closest("a")).length > 0;
        var looksDecorative = inLinkWithText || (img.width && img.width <= 24) ||
          /icon|sprite|spacer|pixel|logo/i.test(img.getAttribute("src") || "") && inLinkWithText;
        if (alt === null) {
          if (looksDecorative) {
            setAttr(img, "alt", "");
            setAttr(img, "role", "presentation");
            mark(img, "RED2");
          } else {
            setAttr(img, "role", "img");
            setAttr(img, "aria-label", "Image — description needed");
            setAttr(img, "data-mdlaug-needs-alt", "1");
            mark(img, "ACC2");
            flagged++;
            log({ code: "ACC2/COM3", level: "A", kind: "flag", el: img.src || "(inline)",
              msg: "Image missing alt text — needs a human/AI description." });
            if (opts.onNeedAltText) { try { opts.onNeedAltText(img); } catch (e) {} }
          }
          n++;
        } else if (alt.trim() === "") {
          // alt="" declares the image decorative — correct for spacers/icons, but
          // a LARGE image marked decorative is usually a mistake (real content
          // shown as an image, e.g. a screenshot). Flag it for human review; do
          // not fabricate a description or strip the author's alt="".
          var szc = _size(img);
          if (!looksDecorative && szc.w >= 150 && szc.h >= 100 && szc.w * szc.h >= 30000) {
            setAttr(img, "data-mdlaug-needs-alt", "1");
            mark(img, "ACC2");
            flagged++;
            log({ code: "ACC2/COM3", level: "A", kind: "flag", el: img.src || "(inline)",
              msg: 'Large image marked decorative (alt="") — confirm it is not conveying content.' });
            n++;
          }
        } else if (/\.(jpe?g|png|gif|webp|svg)$/i.test(alt.trim()) || /^(image|img|dsc|screenshot)[-_ ]?\d*$/i.test(alt.trim())) {
          // alt is a filename → not a real description
          setAttr(img, "data-mdlaug-needs-alt", "1");
          mark(img, "ACC2");
          flagged++;
          log({ code: "ACC2/COM3", level: "A", kind: "flag", el: alt,
            msg: "Alt text looks like a filename, not a description." });
          n++;
        }
      });
      if (n) log({ code: "ACC2/COM3", level: "A", kind: "fix", count: n,
        msg: n + " image(s) reviewed; " + flagged + " need real descriptions." });
      return n;
    }
  });

  // ---- ACC3 / COM4: graphs ----------------------------------------------
  rule({
    id: "graphs-longdesc", code: "ACC3/COM4", level: "AA", kind: "fix+flag",
    describe: "Charts (svg/canvas/graph images) get role=img, a name, and a " +
      "long-description scaffold so the data story can be conveyed in text.",
    run: function () {
      var n = 0;
      var cands = $all("canvas, svg[class*='chart'], svg[class*='graph'], img[class*='chart'], img[class*='graph'], [class*='visualization'], figure[class*='chart'], [class*='chart'], [class*='graph'], [class*='plot']");
      cands.forEach(function (el) {
        var tg = el.tagName.toLowerCase();
        if (tg === "a" || tg === "button" || tg === "input" || tg === "select") return;
        // skip generic containers that are really just text or hold controls
        if (tg !== "svg" && tg !== "canvas" && tg !== "img") {
          if (el.querySelector("input,select,textarea,a,button")) return;
          if (text(el).length > 200) return;
        }
        if (el.getAttribute(MARK) && el.getAttribute(MARK).indexOf("ACC3") > -1) return;
        if (tg !== "svg" && tg !== "canvas" && tg !== "img" && !el.getAttribute("role")) setAttr(el, "role", "img");
        if (el.tagName.toLowerCase() === "svg" || el.tagName.toLowerCase() === "canvas") {
          setAttr(el, "role", "img");
          if (!hasName(el)) setAttr(el, "aria-label", "Graphic — data description needed");
        }
        var descId = "mdlaug-desc-" + Math.random().toString(36).slice(2, 8);
        var det = document.createElement("details");
        det.setAttribute(MARK, "ACC3");
        det.id = descId;
        var sum = document.createElement("summary");
        sum.textContent = "Text description of this graphic";
        var body = document.createElement("div");
        body.setAttribute("data-mdlaug-needs-longdesc", "1");
        body.textContent = "Description needed: summarise what this graphic shows, its axes/trend, and the key takeaway.";
        det.appendChild(sum); det.appendChild(body);
        el.insertAdjacentElement("afterend", det);
        setAttr(el, "aria-describedby", ((el.getAttribute("aria-describedby") || "") + " " + descId).trim());
        mark(el, "ACC3");
        n++;
        log({ code: "ACC3/COM4", level: "AA", kind: "flag",
          msg: "Graphic needs a text long-description (trend, axes, takeaway)." });
      });
      if (n) log({ code: "ACC3/COM4", level: "AA", kind: "fix", count: n,
        msg: n + " graphic(s) given a role and a long-description slot." });
      return n;
    }
  });

  // ---- ACC4: collection items as a list ---------------------------------
  rule({
    id: "collection-items", code: "ACC4", level: "AA", kind: "fix",
    describe: "Repeated result/collection cards are exposed as a list with " +
      "named items so screen-reader users know the set size and can jump between items.",
    run: function () {
      var n = 0;
      $all("[class*='results'], [class*='collection'], [class*='grid'], ul[class*='items'], [data-results]").forEach(function (container) {
        var kids = Array.prototype.filter.call(container.children, function (c) {
          return /(card|item|result|tile|entry)/i.test(c.className || "");
        });
        if (kids.length < 2) return;
        if (container.getAttribute("role") === "list") return;
        setAttr(container, "role", "list");
        kids.forEach(function (k, i) {
          setAttr(k, "role", "listitem");
          if (!hasName(k)) {
            var h = k.querySelector("h1,h2,h3,h4,a,[class*='title']");
            if (h) setAttr(k, "aria-label", text(h) + ", item " + (i + 1) + " of " + kids.length);
          }
        });
        mark(container, "ACC4");
        n++;
      });
      if (n) log({ code: "ACC4", level: "AA", kind: "fix", count: n,
        msg: n + " collection/result group(s) exposed as named lists." });
      return n;
    }
  });

  // ---- ACC5: expandable / collapsed content -----------------------------
  rule({
    id: "disclosure", code: "ACC5", level: "A", kind: "fix",
    describe: "Show/hide toggles (accordions, 'read more') get button semantics, " +
      "synced aria-expanded, aria-controls and keyboard operation.",
    run: function () {
      var n = 0;
      var sels = "[class*='accordion'] [class*='header'],[class~='acc'] [class*='header'],[class*='collaps'] [class*='header'],[class*='toggle'],[data-toggle],[class*='expand'],.collapsible,[class*='read-more']";
      $all(sels).forEach(function (el) {
        if (el.tagName === "SUMMARY") return; // native, already fine
        if (el.getAttribute(MARK) && el.getAttribute(MARK).indexOf("ACC5") > -1) return;
        var target = null;
        var ctrl = el.getAttribute("data-target") || el.getAttribute("aria-controls") || el.getAttribute("href");
        if (ctrl && ctrl[0] === "#") target = document.getElementById(ctrl.slice(1));
        if (!target) target = el.nextElementSibling;
        if (el.tagName !== "BUTTON" && el.tagName !== "A") setAttr(el, "role", "button");
        if (!el.hasAttribute("tabindex") && el.tagName !== "BUTTON" && el.tagName !== "A") setAttr(el, "tabindex", "0");
        var expanded = target ? (getComputedStyle(target).display !== "none") : false;
        setAttr(el, "aria-expanded", String(expanded));
        if (target) {
          if (!target.id) target.id = "mdlaug-panel-" + Math.random().toString(36).slice(2, 8);
          setAttr(el, "aria-controls", target.id);
        }
        function toggle() {
          var now = el.getAttribute("aria-expanded") === "true";
          el.setAttribute("aria-expanded", String(!now));
          if (target) target.style.display = now ? "none" : "";
          announce((now ? "Collapsed" : "Expanded") + " " + (text(el) || "section"));
        }
        el.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
        });
        el.addEventListener("click", function () {
          // sync state after site's own handler runs
          setTimeout(function () {
            if (target) el.setAttribute("aria-expanded", String(getComputedStyle(target).display !== "none"));
          }, 0);
        });
        mark(el, "ACC5");
        n++;
      });
      if (n) log({ code: "ACC5", level: "A", kind: "fix", count: n,
        msg: n + " disclosure control(s) given expand/collapse semantics." });
      return n;
    }
  });

  // ---- ACC6: query suggestions / autocomplete ---------------------------
  rule({
    id: "autocomplete", code: "ACC6", level: "AAA", kind: "fix",
    describe: "Search autocomplete is wired as an ARIA combobox with an " +
      "announced suggestion count and active-descendant tracking.",
    run: function () {
      var n = 0;
      $all("input[type='search'], input[role='searchbox'], input[name*='search'], input[id*='search'], input[placeholder*='earch']").forEach(function (input) {
        var list = input.parentElement && (input.parentElement.querySelector("ul,ol,[role='listbox'],[class*='suggest'],[class*='autocomplete']"));
        if (!list) return;
        if (input.getAttribute(MARK) && input.getAttribute(MARK).indexOf("ACC6") > -1) return;
        setAttr(input, "role", "combobox");
        setAttr(input, "aria-autocomplete", "list");
        setAttr(input, "aria-expanded", "false");
        if (!list.id) list.id = "mdlaug-suggest-" + Math.random().toString(36).slice(2, 8);
        setAttr(input, "aria-controls", list.id);
        setAttr(list, "role", "listbox");
        var obs = new MutationObserver(function () {
          var opts = list.querySelectorAll("li,[role='option'],a");
          opts.forEach(function (o, i) {
            if (o.getAttribute("role") !== "option") o.setAttribute("role", "option");
            if (!o.id) o.id = list.id + "-opt-" + i;
          });
          var open = opts.length > 0 && getComputedStyle(list).display !== "none";
          input.setAttribute("aria-expanded", String(open));
          if (open) announce(opts.length + " suggestion" + (opts.length === 1 ? "" : "s") + " available");
        });
        obs.observe(list, { childList: true, subtree: true, attributes: true });
        mark(input, "ACC6");
        n++;
      });
      if (n) log({ code: "ACC6", level: "AAA", kind: "fix", count: n,
        msg: n + " search field(s) wired as accessible comboboxes." });
      return n;
    }
  });

  // ---- COM1: document structure / landmarks -----------------------------
  rule({
    id: "landmarks", code: "COM1", level: "A", kind: "fix",
    describe: "Adds a skip link, a main landmark, and labels navigation/search " +
      "regions so the page's structure is announced.",
    run: function () {
      var n = 0;
      // skip link
      if (!document.querySelector("a[href='#mdlaug-main'], a.mdlaug-skip")) {
        var main = document.querySelector("main, [role='main']");
        if (!main) {
          main = document.querySelector("#content, .content, #main, article") || document.body;
          if (main && main !== document.body) { setAttr(main, "role", "main"); }
        }
        if (main) {
          if (!main.id) main.id = "mdlaug-main";
          var skip = document.createElement("a");
          skip.className = "mdlaug-skip mdlaug-sr-only";
          skip.href = "#" + main.id;
          skip.textContent = "Skip to main content";
          skip.setAttribute(MARK, "COM1");
          skip.addEventListener("focus", function () { skip.classList.remove("mdlaug-sr-only"); });
          skip.addEventListener("blur", function () { skip.classList.add("mdlaug-sr-only"); });
          ensureSrOnlyStyle();
          if (document.body) document.body.insertBefore(skip, document.body.firstChild);
          n++;
        }
      }
      // label nav + search landmarks so multiples are distinguishable (also FIL2)
      $all("nav").forEach(function (nav, i) {
        if (!nav.getAttribute("aria-label") && !nav.getAttribute("aria-labelledby")) {
          var h = nav.querySelector("h1,h2,h3");
          setAttr(nav, "aria-label", h ? text(h) : (i === 0 ? "Main navigation" : "Navigation " + (i + 1)));
          mark(nav, "COM1");
          n++;
        }
      });
      if (!document.querySelector("h1")) {
        log({ code: "COM1", level: "A", kind: "flag", msg: "Page has no <h1> — add a top-level heading." });
      }
      if (n) log({ code: "COM1", level: "A", kind: "fix", count: n,
        msg: "Structure landmarks/skip link added and navigation labelled." });
      return n;
    }
  });

  // ---- COM2 / NAV1: filter structure ------------------------------------
  rule({
    id: "filter-groups", code: "COM2/NAV1", level: "AAA", kind: "fix",
    describe: "Facet filter clusters become labelled groups and announce when a " +
      "filter is applied.",
    run: function () {
      var n = 0;
      $all("[class*='filter'], [class*='facet'], fieldset").forEach(function (grp) {
        var boxes = grp.querySelectorAll("input[type='checkbox'],input[type='radio']");
        if (boxes.length < 2) return;
        if (grp.getAttribute(MARK) && grp.getAttribute(MARK).indexOf("COM2") > -1) return;
        if (grp.tagName !== "FIELDSET" && grp.getAttribute("role") !== "group") setAttr(grp, "role", "group");
        if (!grp.getAttribute("aria-label") && !grp.getAttribute("aria-labelledby")) {
          var h = grp.querySelector("legend,h2,h3,h4,[class*='title'],[class*='label']");
          setAttr(grp, "aria-label", (h ? text(h) : "Filter") + " filter");
        }
        boxes.forEach(function (b) {
          b.addEventListener("change", function () {
            var lbl = (b.labels && b.labels[0] && text(b.labels[0])) || b.value || "filter";
            announce((b.checked ? "Filter applied: " : "Filter removed: ") + lbl);
          });
        });
        mark(grp, "COM2");
        n++;
      });
      if (n) log({ code: "COM2/NAV1", level: "AAA", kind: "fix", count: n,
        msg: n + " filter group(s) labelled with change announcements." });
      return n;
    }
  });

  // ---- EVA1: relevance names on results ---------------------------------
  rule({
    id: "result-relevance", code: "EVA1", level: "A", kind: "fix",
    describe: "Each result gets a descriptive accessible name combining title, " +
      "format and a snippet so relevance can be judged without sighted scanning.",
    run: function () {
      var n = 0;
      $all("[role='listitem'], [class*='result-item'], [class*='result'] li, article[class*='item']").forEach(function (item) {
        if (item.getAttribute("data-mdlaug-named")) return;
        var title = item.querySelector("h1,h2,h3,h4,a,[class*='title']");
        if (!title) return;
        var fmt = item.querySelector("[class*='format'],[class*='type'],[class*='badge']");
        var snip = item.querySelector("p,[class*='desc'],[class*='snippet'],[class*='abstract']");
        var name = [text(title), fmt && text(fmt), snip && text(snip).slice(0, 120)].filter(Boolean).join(". ");
        if (name && !hasName(item)) setAttr(item, "aria-label", name);
        setAttr(item, "data-mdlaug-named", "1");
        mark(item, "EVA1");
        n++;
      });
      if (n) log({ code: "EVA1", level: "A", kind: "fix", count: n,
        msg: n + " result(s) given descriptive names for relevance judging." });
      return n;
    }
  });

  // ---- EXE1: clear search box -------------------------------------------
  rule({
    id: "clear-search", code: "EXE1", level: "A", kind: "fix",
    describe: "The search 'X' becomes a real labelled button that clears the " +
      "field, returns focus and announces the result.",
    run: function () {
      var n = 0;
      $all("input[type='search'], input[name*='search'], input[id*='search']").forEach(function (input) {
        var wrap = input.parentElement;
        if (!wrap) return;
        var clear = wrap.querySelector("[class*='clear'], [class*='reset'], .close, [id*='clear' i], .x, [aria-label*='clear' i]");
        if (!clear) return;
        if (clear.getAttribute(MARK) && clear.getAttribute(MARK).indexOf("EXE1") > -1) return;
        if (clear.tagName !== "BUTTON") setAttr(clear, "role", "button");
        if (!clear.hasAttribute("tabindex") && clear.tagName !== "BUTTON") setAttr(clear, "tabindex", "0");
        if (!hasName(clear)) setAttr(clear, "aria-label", "Clear search");
        function doClear(e) { e && e.preventDefault(); input.value = ""; input.focus(); announce("Search cleared"); }
        clear.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") doClear(e); });
        clear.addEventListener("click", function () { announce("Search cleared"); });
        mark(clear, "EXE1");
        n++;
      });
      if (n) log({ code: "EXE1", level: "A", kind: "fix", count: n,
        msg: n + " clear-search control(s) made an accessible button." });
      return n;
    }
  });

  // ---- EXE2 / INT1: modal exit + layering -------------------------------
  rule({
    id: "dialog-escape", code: "EXE2/INT1", level: "A", kind: "fix",
    describe: "Open items/lightboxes/modals get dialog semantics, a focus trap, " +
      "Escape-to-close, focus return, an inert background and a labelled close button.",
    run: function () {
      var n = 0;
      $all("[role='dialog'], [class*='modal'], [class*='lightbox'], [class*='overlay'], dialog").forEach(function (dlg) {
        if (dlg.getAttribute(MARK) && dlg.getAttribute(MARK).indexOf("EXE2") > -1) return;
        // Only treat as active dialog if currently visible
        if (getComputedStyle(dlg).display === "none" || dlg.hidden) return;
        setAttr(dlg, "role", dlg.getAttribute("role") || "dialog");
        setAttr(dlg, "aria-modal", "true");
        var close = dlg.querySelector("[class*='close'], [aria-label*='close' i], .x, button[data-dismiss]");
        if (close && !hasName(close)) setAttr(close, "aria-label", "Close");
        if (!dlg.hasAttribute("tabindex")) setAttr(dlg, "tabindex", "-1");
        var opener = document.activeElement;
        try { dlg.focus(); } catch (e) {}
        function focusables() {
          return $all("a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex='-1'])", dlg);
        }
        function onKey(e) {
          if (e.key === "Escape") { closeDlg(); }
          else if (e.key === "Tab") {
            var f = focusables(); if (!f.length) return;
            var first = f[0], last = f[f.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          }
        }
        function closeDlg() {
          dlg.removeEventListener("keydown", onKey);
          dlg.style.display = "none";
          if (opener && opener.focus) opener.focus();
          announce("Dialog closed");
        }
        dlg.addEventListener("keydown", onKey);
        if (close) close.addEventListener("click", closeDlg);
        // mark background siblings inert
        Array.prototype.forEach.call(document.body.children, function (sib) {
          if (sib !== dlg && !dlg.contains(sib) && sib.getAttribute(MARK) !== "COM1") {
            remember(sib, ["aria-hidden"]);
            sib.setAttribute("aria-hidden", "true");
            sib.setAttribute("data-mdlaug-inert", "1");
          }
        });
        mark(dlg, "EXE2");
        n++;
      });
      if (n) log({ code: "EXE2/INT1", level: "A", kind: "fix", count: n,
        msg: n + " open item/modal(s) given trap+Escape+focus return." });
      return n;
    }
  });

  // ---- EXE3: return to previous page ------------------------------------
  rule({
    id: "back-affordance", code: "EXE3", level: "AA", kind: "fix",
    describe: "Item pages get a labelled 'Back to results' control and breadcrumb " +
      "landmark so users can retrace their path.",
    run: function () {
      var n = 0;
      $all("[class*='breadcrumb']").forEach(function (bc) {
        if (bc.getAttribute("role") === "navigation" || bc.closest("nav")) return;
        setAttr(bc, "role", "navigation");
        setAttr(bc, "aria-label", "Breadcrumb");
        var cur = bc.querySelector("[class*='active'], [aria-current]");
        if (cur) setAttr(cur, "aria-current", "page");
        mark(bc, "EXE3");
        n++;
      });
      if (n) log({ code: "EXE3", level: "AA", kind: "fix", count: n,
        msg: n + " breadcrumb(s) landmarked for retracing." });
      return n;
    }
  });

  // ---- FIL1 / USE1: icon-only controls ----------------------------------
  var ICON_NAMES = [
    [/search|magnif|fa-search|icon-search/i, "Search"],
    [/menu|hamburger|fa-bars|icon-menu/i, "Menu"],
    [/close|fa-times|fa-xmark|icon-close/i, "Close"],
    [/filter|fa-filter/i, "Filters"],
    [/download|fa-download/i, "Download"],
    [/print|fa-print/i, "Print"],
    [/share|fa-share/i, "Share"],
    [/next|fa-chevron-right|fa-arrow-right/i, "Next"],
    [/prev|fa-chevron-left|fa-arrow-left/i, "Previous"],
    [/home|fa-home/i, "Home"],
    [/info|fa-info|help|fa-question/i, "Help"]
  ];
  rule({
    id: "icon-buttons", code: "FIL1/USE1", level: "A", kind: "fix",
    describe: "Icon-only buttons/links (e.g. a bare magnifier) get an accessible " +
      "name inferred from their icon class.",
    run: function () {
      var n = 0;
      $all("button, a[role='button'], a[href], [role='button']").forEach(function (el) {
        if (hasName(el)) return;
        if (el.getAttribute(MARK) && el.getAttribute(MARK).indexOf("FIL1") > -1) return;
        var icon = el.querySelector("i,svg,use,[class*='icon']") || el;
        var cls = (icon.getAttribute && (icon.getAttribute("class") || "")) + " " +
          (el.getAttribute("class") || "") + " " + (el.id || "") + " " + (icon.id || "") + " " +
          ((icon.querySelector && icon.querySelector("use") && icon.querySelector("use").getAttribute("href")) || "");
        var guessed = null;
        for (var i = 0; i < ICON_NAMES.length; i++) { if (ICON_NAMES[i][0].test(cls)) { guessed = ICON_NAMES[i][1]; break; } }
        if (guessed) { setAttr(el, "aria-label", guessed); mark(el, "FIL1"); n++; }
        else {
          setAttr(el, "aria-label", "Button — label needed");
          setAttr(el, "data-mdlaug-needs-name", "1");
          mark(el, "FIL1");
          log({ code: "FIL1/USE1", level: "A", kind: "flag", msg: "Icon control with no discernible name." });
          n++;
        }
      });
      if (n) log({ code: "FIL1/USE1", level: "A", kind: "fix", count: n,
        msg: n + " icon-only control(s) given names." });
      return n;
    }
  });

  // ---- FIL2 / RED3: distinguish multiple search regions -----------------
  rule({
    id: "search-regions", code: "FIL2/RED3", level: "AA", kind: "fix",
    describe: "When a page has several search boxes (site-wide vs within-collection), " +
      "each search landmark gets a distinct label.",
    run: function () {
      var n = 0;
      var searches = $all("form[role='search'], [role='search'], form[class*='search']");
      if (searches.length < 2) return 0;
      searches.forEach(function (s, i) {
        if (s.getAttribute("aria-label")) return;
        var scopeHint = /collection|within|this/i.test(s.className) ? "Search within this collection"
          : /all|site|global/i.test(s.className) ? "Search the whole library"
          : (i === 0 ? "Search the whole library" : "Search this section");
        setAttr(s, "role", "search");
        setAttr(s, "aria-label", scopeHint);
        mark(s, "FIL2");
        n++;
      });
      if (n) log({ code: "FIL2/RED3", level: "AA", kind: "fix", count: n,
        msg: n + " search region(s) given distinct labels." });
      return n;
    }
  });

  // ---- FIL3 / HEP1: help discoverability --------------------------------
  rule({
    id: "help-affordance", code: "FIL3/HEP1", level: "A", kind: "fix",
    describe: "Help/FAQ links are labelled and grouped so mobile users can find " +
      "assistance quickly.",
    run: function () {
      var n = 0;
      $all("a[href]").forEach(function (a) {
        if (/help|faq|support|assist|how to/i.test(text(a)) || /help|faq|support/i.test(a.getAttribute("href") || "")) {
          if (!a.getAttribute("aria-label")) { setAttr(a, "aria-label", text(a) || "Help and support"); }
          mark(a, "FIL3");
          n++;
        }
      });
      if (n) log({ code: "FIL3/HEP1", level: "A", kind: "fix", count: n,
        msg: n + " help/support link(s) labelled for discoverability." });
      return n;
    }
  });

  // ---- NAV2: pagination --------------------------------------------------
  rule({
    id: "pagination", code: "NAV2", level: "AA", kind: "fix",
    describe: "Pagers become a labelled navigation landmark with aria-current on " +
      "the current page and announced page changes.",
    run: function () {
      var n = 0;
      $all("[class*='pagination'], [class*='pager'], nav[class*='page']").forEach(function (pg) {
        if (pg.getAttribute(MARK) && pg.getAttribute(MARK).indexOf("NAV2") > -1) return;
        if (pg.tagName !== "NAV") setAttr(pg, "role", "navigation");
        if (!pg.getAttribute("aria-label")) setAttr(pg, "aria-label", "Pagination");
        var cur = pg.querySelector("[class*='active'], [class*='current'], [aria-current]");
        if (cur) setAttr(cur, "aria-current", "page");
        $all("a,button", pg).forEach(function (link) {
          if (!hasName(link)) {
            var t = link.className + " " + (link.getAttribute("rel") || "");
            if (/next/i.test(t)) setAttr(link, "aria-label", "Next page");
            else if (/prev/i.test(t)) setAttr(link, "aria-label", "Previous page");
          }
          link.addEventListener("click", function () {
            announce("Loading page " + (text(link) || "…"));
          });
        });
        mark(pg, "NAV2");
        n++;
      });
      if (n) log({ code: "NAV2", level: "AA", kind: "fix", count: n,
        msg: n + " pager(s) landmarked with current-page + announcements." });
      return n;
    }
  });

  // ---- RED1 / NAV3 / NAV5: results availability + status ----------------
  rule({
    id: "results-status", code: "RED1/NAV3/NAV5", level: "A", kind: "fix",
    describe: "The results area gets a live status ('N results found' / 'No results'), " +
      "a heading, a skip-to-results link, and per-result position.",
    run: function () {
      var n = 0;
      var container = document.querySelector("[role='list'][class*='result'], [class*='results'], #results, [data-results]");
      if (container) {
        if (!container.id) container.id = "mdlaug-results";
        if (!container.getAttribute("aria-label")) setAttr(container, "aria-label", "Search results");
        // status region
        if (!container.querySelector("[data-mdlaug-status]")) {
          var status = document.createElement("div");
          status.setAttribute("data-mdlaug-status", "1");
          status.setAttribute("role", "status");
          status.setAttribute("aria-live", "polite");
          status.className = "mdlaug-sr-only";
          ensureSrOnlyStyle();
          var items = container.querySelectorAll("[role='listitem'], li, [class*='result-item'], article");
          status.textContent = items.length ? (items.length + " results found") : "No results found";
          container.insertBefore(status, container.firstChild);
          items.forEach(function (it, i) {
            if (!it.querySelector("[data-mdlaug-pos]")) {
              var pos = srSpan("Result " + (i + 1) + " of " + items.length);
              pos.setAttribute("data-mdlaug-pos", "1");
              it.insertBefore(pos, it.firstChild);
            }
          });
          n++;
        }
        // skip-to-results
        if (!document.querySelector("a[href='#" + container.id + "'].mdlaug-skip-results")) {
          var skip = document.createElement("a");
          skip.className = "mdlaug-skip-results mdlaug-sr-only";
          skip.href = "#" + container.id;
          skip.textContent = "Skip to search results";
          skip.addEventListener("focus", function () { skip.classList.remove("mdlaug-sr-only"); });
          skip.addEventListener("blur", function () { skip.classList.add("mdlaug-sr-only"); });
          ensureSrOnlyStyle();
          if (document.body) document.body.insertBefore(skip, document.body.firstChild);
          n++;
        }
      }
      if (n) log({ code: "RED1/NAV3/NAV5", level: "A", kind: "fix", count: n,
        msg: "Results status/heading/skip link + per-result position added." });
      return n;
    }
  });

  // ---- NAV4: within-item navigation -------------------------------------
  rule({
    id: "within-item-nav", code: "NAV4", level: "AA", kind: "fix",
    describe: "Document/item viewers get labelled page controls and announce the " +
      "current page so users can navigate inside an item.",
    run: function () {
      var n = 0;
      $all("[class*='viewer'], [class*='reader'], [class*='pageview']").forEach(function (v) {
        var controls = v.querySelectorAll("[class*='page-next'],[class*='next-page'],[class*='page-prev'],[class*='prev-page']");
        controls.forEach(function (c) {
          if (!hasName(c)) setAttr(c, "aria-label", /next/i.test(c.className) ? "Next page" : "Previous page");
        });
        if (controls.length) { mark(v, "NAV4"); n++; }
      });
      if (n) log({ code: "NAV4", level: "AA", kind: "fix", count: n,
        msg: n + " item viewer(s) given labelled page controls." });
      return n;
    }
  });

  // ---- RED4: authorized/disabled features -------------------------------
  rule({
    id: "authorized-features", code: "RED4", level: "AAA", kind: "fix",
    describe: "Locked/sign-in-required controls are conveyed with aria-disabled " +
      "and an explanation of why they're unavailable.",
    run: function () {
      var n = 0;
      $all("[class*='locked'], [class*='disabled'], [class*='premium'], [class*='auth-required']").forEach(function (el) {
        if (el.getAttribute(MARK) && el.getAttribute(MARK).indexOf("RED4") > -1) return;
        setAttr(el, "aria-disabled", "true");
        if (!el.querySelector("[data-mdlaug-why]")) {
          var why = srSpan(" — sign in to use this feature");
          why.setAttribute("data-mdlaug-why", "1");
          el.appendChild(why);
        }
        mark(el, "RED4");
        n++;
      });
      if (n) log({ code: "RED4", level: "AAA", kind: "fix", count: n,
        msg: n + " restricted control(s) marked with reason." });
      return n;
    }
  });

  // ---- MED1: multimedia captions & transcripts (WCAG 1.2, beyond the 24) ---
  function absUrl(u) { try { return new URL(u, (root.location && root.location.href) || "").href; } catch (e) { return u; } }
  function vttTime(t) {
    t = Math.max(0, t || 0);
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), ms = Math.floor((t - Math.floor(t)) * 1000);
    function p(x, n) { x = String(x); while (x.length < n) x = "0" + x; return x; }
    return p(h, 2) + ":" + p(m, 2) + ":" + p(s, 2) + "." + p(ms, 3);
  }
  function toVtt(segments) {
    var out = ["WEBVTT", ""];
    segments.forEach(function (seg, i) { out.push(String(i + 1)); out.push(vttTime(seg.start) + " --> " + vttTime(seg.end)); out.push((seg.text || "").trim()); out.push(""); });
    return out.join("\n");
  }
  function applyTranscript(m, isVideo, res) {
    if (isVideo && res.segments && res.segments.length) {
      try {
        var url = URL.createObjectURL(new Blob([toVtt(res.segments)], { type: "text/vtt" }));
        var track = document.createElement("track");
        track.kind = "captions"; track.label = "Auto captions (unverified)"; track.srclang = res.language || "en"; track.default = true;
        track.src = url; track.className = "mdlaug-track"; track.setAttribute(MARK, "MED1");
        m.appendChild(track);
        try { var tt = m.textTracks; if (tt && tt.length) tt[tt.length - 1].mode = "showing"; } catch (e) {}
      } catch (e) {}
    }
    var det = document.createElement("details"); det.className = "mdlaug-transcript"; det.setAttribute(MARK, "MED1");
    var sum = document.createElement("summary"); sum.textContent = "Transcript (auto-generated — unverified)";
    var body = document.createElement("div"); body.style.whiteSpace = "pre-wrap"; body.textContent = res.text || "";
    det.appendChild(sum); det.appendChild(body);
    if (m.parentNode) m.parentNode.insertBefore(det, m.nextSibling);
  }
  rule({
    id: "media-captions", code: "MED1", level: "A", kind: "fix",
    describe: "Video/audio without captions is flagged; with a transcription service configured, an auto-caption track (WebVTT) and a visible transcript are added, labelled unverified.",
    run: function (opts) {
      var n = 0;
      var canTranscribe = typeof opts.transcribe === "function";
      $all("video, audio").forEach(function (m) {
        if ((m.getAttribute(MARK) || "").indexOf("MED1") > -1) return;
        var isVideo = m.tagName.toLowerCase() === "video";
        if (!hasName(m)) setAttr(m, "aria-label", (isVideo ? "Video" : "Audio") + " player");
        var hasCaps = !!m.querySelector('track[kind="captions"], track[kind="subtitles"]');
        if (hasCaps) return; // already captioned — leave it
        mark(m, "MED1");
        var mediaUrl = m.currentSrc || m.getAttribute("src") || (m.querySelector("source") && m.querySelector("source").getAttribute("src")) || "";
        var bar = document.createElement("div"); bar.className = "mdlaug-mediabar"; bar.setAttribute(MARK, "MED1");
        if (canTranscribe && mediaUrl) {
          var btn = document.createElement("button");
          btn.type = "button"; btn.className = "mdlaug-viewbtn"; btn.setAttribute(MARK, "MED1");
          btn.textContent = isVideo ? "Add captions & transcript" : "Transcribe";
          btn.setAttribute("aria-label", (isVideo ? "Generate captions and a transcript for this video" : "Generate a transcript for this audio") + " (uses a transcription service)");
          btn.addEventListener("click", function () {
            btn.disabled = true; btn.textContent = "Transcribing…";
            Promise.resolve(opts.transcribe({ mediaUrl: absUrl(mediaUrl), el: m })).then(function (res) {
              if (!res || res.skipped) { btn.disabled = false; btn.textContent = res && res.reason ? ("Unavailable: " + res.reason) : "Retry"; return; }
              applyTranscript(m, isVideo, res);
              btn.textContent = "Captioned \u2713 (unverified)";
              announce("Auto-generated " + (isVideo ? "captions and transcript" : "transcript") + " added. Please verify accuracy.");
            }).catch(function () { btn.disabled = false; btn.textContent = "Retry"; });
          });
          bar.appendChild(btn);
        } else {
          var s = document.createElement("span"); s.className = "mdlaug-medianote"; s.setAttribute(MARK, "MED1");
          s.textContent = isVideo ? "No captions on this video \u2014 no transcription service configured." : "No transcript for this audio \u2014 no transcription service configured.";
          bar.appendChild(s);
        }
        if (m.parentNode) m.parentNode.insertBefore(bar, m.nextSibling);
        log({ code: "MED1", level: "A", kind: canTranscribe ? "fix" : "flag", count: 1, msg: (isVideo ? "Video" : "Audio") + " lacks captions/transcript" });
        n++;
      });
      $all('iframe[src*="youtube.com"], iframe[src*="youtube-nocookie.com"], iframe[src*="player.vimeo.com"]').forEach(function (f) {
        if ((f.getAttribute(MARK) || "").indexOf("MED1") > -1) return;
        mark(f, "MED1");
        if (!hasName(f) && !f.getAttribute("title")) setAttr(f, "title", "Embedded video");
        var bar = document.createElement("div"); bar.className = "mdlaug-mediabar"; bar.setAttribute(MARK, "MED1");
        var s = document.createElement("span"); s.className = "mdlaug-medianote"; s.setAttribute(MARK, "MED1");
        s.textContent = "Embedded video \u2014 enable captions in the player\u2019s CC menu; captions can\u2019t be auto-added to a third-party embed.";
        bar.appendChild(s);
        if (f.parentNode) f.parentNode.insertBefore(bar, f.nextSibling);
        log({ code: "MED1", level: "A", kind: "flag", count: 1, msg: "Embedded video (captions live in the player)" });
        n++;
      });
      return n;
    }
  });

  // ---- ACC2/COM3 (extended): images that aren't <img> --------------------
  // Real pages carry meaningful images as inline SVG, <canvas> (incl. rendered
  // PDF pages), or CSS background-image on a sized box. The <img> rule can't see
  // those, so flag them for a text alternative too. Conservative: skips tiny/
  // decorative/hidden/already-named elements and boxes that carry their own text.
  function _px(v) { v = parseFloat(v); return isNaN(v) ? 0 : v; }
  function _size(el) {
    var w = 0, h = 0;
    try { var r = el.getBoundingClientRect(); w = r.width; h = r.height; } catch (e) {}
    if (!w || !h) { try { var cs = root.getComputedStyle(el); w = w || _px(cs.width); h = h || _px(cs.height); } catch (e) {} }
    if (!w) w = _px(el.getAttribute && el.getAttribute("width")) || el.clientWidth || 0;
    if (!h) h = _px(el.getAttribute && el.getAttribute("height")) || el.clientHeight || 0;
    return { w: w, h: h };
  }
  function _decorative(el) {
    if (el.getAttribute("aria-hidden") === "true") return true;
    var r = (el.getAttribute("role") || "").toLowerCase();
    return r === "presentation" || r === "none";
  }
  function _imgNamed(el) {
    if (hasName(el)) return true;
    var t = el.querySelector && el.querySelector("title");
    return !!(t && text(t));
  }
  // For SVG/canvas, only an EXPLICIT name counts — inner <text> is image content,
  // not an accessible name, so it must not suppress the flag.
  function _explicitName(el) {
    if ((el.getAttribute("aria-label") || "").trim()) return true;
    if (el.getAttribute("aria-labelledby")) return true;
    if ((el.getAttribute("title") || "").trim()) return true;
    var t = el.querySelector && el.querySelector("title");
    return !!(t && text(t));
  }
  rule({
    id: "images-nontag", code: "ACC2/COM3", level: "A", kind: "flag",
    describe: "Images conveyed as SVG, <canvas>, or a CSS background (not <img>) are detected and flagged for a text alternative.",
    run: function () {
      var n = 0;
      $all("svg, canvas").forEach(function (el) {
        if ((el.getAttribute(MARK) || "").indexOf("ACC2") > -1) return;
        if ((el.getAttribute(MARK) || "").indexOf("ACC3") > -1) return; // already handled as a graphic
        if (_decorative(el) || _explicitName(el)) return;
        var sz = _size(el);
        var hasText = el.tagName.toLowerCase() === "svg" && el.querySelector("text");
        if (!(hasText || (sz.w >= 48 && sz.h >= 48))) return; // skip small/decorative icons
        setAttr(el, "data-mdlaug-needs-alt", "1"); mark(el, "ACC2"); n++;
      });
      var els = $all("*"), scanned = 0;
      for (var i = 0; i < els.length && scanned < 5000; i++) {
        var el = els[i]; scanned++;
        var tag = el.tagName.toLowerCase();
        if (tag === "img" || tag === "svg" || tag === "canvas" || tag === "script" || tag === "style" || tag === "body" || tag === "html") continue;
        if ((el.getAttribute(MARK) || "").indexOf("ACC2") > -1) continue;
        var bg = "";
        try { bg = root.getComputedStyle(el).backgroundImage || ""; } catch (e) { continue; }
        if (!bg || bg === "none" || bg.indexOf("url(") === -1) continue;
        if (_decorative(el) || _imgNamed(el)) continue;
        var txt = text(el); if (txt && txt.length > 2) continue; // has its own text -> bg is decorative
        var sz = _size(el);
        if (!(sz.w >= 48 && sz.h >= 48 && sz.w * sz.h >= 8000)) continue;
        setAttr(el, "data-mdlaug-needs-alt", "1");
        setAttr(el, "role", el.getAttribute("role") || "img");
        mark(el, "ACC2"); n++;
      }
      if (n) log({ code: "ACC2/COM3", level: "A", kind: "flag", count: n, msg: n + " non-<img> image(s) (SVG / canvas / CSS background) need a text alternative." });
      return n;
    }
  });

  // ---- FORM1: accessible form fields (WCAG 1.3.1 / 3.3.2 / 4.1.2) ---------
  // From reviewer feedback: login/registration/account forms are a common BVI
  // pain point not covered by the 24 situations. Associate labels, fall back to
  // placeholder text, reflect required state, and flag fields that need a label.
  function fieldHasName(el) {
    if (hasName(el)) return true;
    var id = el.getAttribute("id");
    if (id && $all("label[for]").some(function (l) { return l.getAttribute("for") === id && text(l); })) return true;
    var p = el.parentNode;
    while (p && p.nodeType === 1) { if (p.tagName && p.tagName.toLowerCase() === "label" && text(p)) return true; p = p.parentNode; }
    return false;
  }
  rule({
    id: "form-fields", code: "FORM1", level: "A", kind: "fix",
    describe: "Form fields get an accessible name (from an adjacent label or, failing that, their placeholder); required fields get aria-required; unlabelled fields with no fallback are flagged.",
    run: function () {
      var fixes = 0, flags = 0;
      var SKIP = { hidden: 1, submit: 1, button: 1, reset: 1, image: 1 };
      $all("input, select, textarea").forEach(function (f) {
        var tag = f.tagName.toLowerCase();
        var type = (f.getAttribute("type") || "").toLowerCase();
        if (tag === "input" && SKIP[type]) return;
        if ((f.getAttribute(MARK) || "").indexOf("FORM1") > -1) return;
        // reflect required state
        if ((f.hasAttribute("required") || f.getAttribute("aria-required") === "true") && f.getAttribute("aria-required") !== "true") {
          setAttr(f, "aria-required", "true"); mark(f, "FORM1"); fixes++;
        }
        if (fieldHasName(f)) return;
        var id = f.getAttribute("id");
        var done = false;
        // associate an adjacent label that lacks a for= (only if the field has an id)
        if (id) {
          var lab = $all("label:not([for])").filter(function (l) {
            return text(l) && !l.contains(f) && (l.nextElementSibling === f || l.previousElementSibling === f);
          })[0];
          if (lab) { setAttr(lab, "for", id); mark(f, "FORM1"); fixes++; done = true; }
        }
        if (!done) {
          var ph = (f.getAttribute("placeholder") || "").trim();
          if (ph) { setAttr(f, "aria-label", ph); mark(f, "FORM1"); fixes++; }
          else { setAttr(f, "data-mdlaug-needs-label", "1"); mark(f, "FORM1"); flags++; }
        }
      });
      if (fixes) log({ code: "FORM1", level: "A", kind: "fix", count: fixes, msg: fixes + " form field(s) labelled or marked required." });
      if (flags) log({ code: "FORM1", level: "A", kind: "flag", count: flags, msg: flags + " form field(s) still need a human-written label." });
      return fixes + flags;
    }
  });

  // ------------------------------------------------------------------------
  // ------------------------------------------------------------------------
  // Visible highlight overlay
  // ARIA/semantic repairs are invisible by design — they change the
  // accessibility tree, not the pixels. This draws a non-invasive fixed layer
  // that boxes every element we touched and chips it with its mDLAUG code(s),
  // so a sighted reviewer can SEE exactly what changed (and where a repair only
  // *flags* content a human/AI still needs to supply).
  // ------------------------------------------------------------------------
  var CODE_LABEL = {
    ACC1: "file link", ACC2: "needs alt text", ACC3: "chart description",
    ACC4: "list semantics", ACC5: "disclosure state", ACC6: "search combobox",
    COM1: "skip link", COM2: "filter group", COM3: "needs alt text",
    NAV2: "pager landmark", NAV3: "nav status", RED1: "live status",
    RED2: "decorative image", RED4: "disabled state", EXE1: "clear control",
    EXE2: "dialog", EXE3: "breadcrumb", EVA1: "item context",
    FIL1: "icon label", FIL2: "search region", INT1: "dialog focus", MED1: "media captions",
    FORM1: "form label"
  };
  // WCAG 2.1 success criteria most relevant to each situation (for reports).
  var WCAG_MAP = {
    ACC1: "2.4.4, 3.2.2, 4.1.2", ACC2: "1.1.1", "ACC2/COM3": "1.1.1", ACC3: "1.1.1", "ACC3/COM4": "1.1.1",
    ACC4: "1.3.1", ACC5: "4.1.2, 4.1.3", ACC6: "4.1.2", COM1: "1.3.1, 2.4.1", "COM2/NAV1": "1.3.1",
    EVA1: "2.4.4", EXE1: "2.1.1", "EXE2/INT1": "2.1.2, 4.1.2", EXE3: "2.4.8",
    "FIL1/USE1": "4.1.2", "FIL2/RED3": "1.3.1", NAV2: "1.3.1, 2.4.1", NAV4: "2.4.1, 2.4.5",
    "RED1/NAV3/NAV5": "4.1.3", RED4: "4.1.2", MED1: "1.2.1, 1.2.2, 1.2.3", FORM1: "1.3.1, 3.3.2, 4.1.2"
  };
  var _hl = { on: false, layer: null, raf: 0, onScroll: null };

  function _isFlag(el) {
    if (el.hasAttribute("data-mdlaug-needs-alt") || el.hasAttribute("data-mdlaug-needs-label")) return true;
    return (el.getAttribute(MARK) || "").split(" ").some(function (c) {
      return c === "ACC2" || c === "ACC3" || c === "COM3";
    });
  }
  function _hlTargets() {
    return $all("[" + MARK + "]").filter(function (el) {
      if (!el.getAttribute) return false;
      if (el.id === OVERLAY_ID || el.id === LIVE_ID) return false;
      if (el.classList && el.classList.contains("mdlaug-sr-only")) return false;
      if ((el.getAttribute(MARK) || "") === "sr") return false;
      if (el.closest && el.closest("#mdlaug-panel")) return false;
      return true;
    });
  }
  function _drawOverlay() {
    if (!_hl.layer) return;
    var layer = _hl.layer;
    layer.textContent = "";
    var vh = root.innerHeight || 800, vw = root.innerWidth || 1200;
    _hlTargets().forEach(function (el) {
      var r; try { r = el.getBoundingClientRect(); } catch (e) { return; }
      if (!r || (r.width <= 1 && r.height <= 1)) return;
      if (r.bottom < -60 || r.top > vh + 60 || r.right < -60 || r.left > vw + 60) return;
      var flag = _isFlag(el);
      var accent = flag ? "#e8912a" : "#1f9e8f";
      var chipbg = flag ? "#b56a10" : "#0f6d61";
      var box = document.createElement("div");
      box.style.cssText = "position:fixed;pointer-events:none;box-sizing:border-box;" +
        "left:" + r.left + "px;top:" + r.top + "px;" +
        "width:" + Math.max(r.width, 10) + "px;height:" + Math.max(r.height, 10) + "px;" +
        "border:2px solid " + accent + ";border-radius:4px;" +
        "background:" + (flag ? "rgba(232,145,42,.08)" : "rgba(31,158,143,.08)") + ";";
      var codes = (el.getAttribute(MARK) || "").split(" ").filter(Boolean);
      var chip = document.createElement("span");
      var top = r.top >= 18 ? "top:-17px;" : "top:0;"; // keep chip on-screen near page top
      chip.style.cssText = "position:absolute;left:-2px;" + top +
        "font:600 10px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:nowrap;" +
        "padding:0 5px;border-radius:3px;color:#fff;background:" + chipbg + ";";
      chip.textContent = codes.join(" ") + (CODE_LABEL[codes[0]] ? " · " + CODE_LABEL[codes[0]] : "");
      box.appendChild(chip);
      layer.appendChild(box);
    });
  }
  function _scheduleDraw() {
    if (_hl.raf) return;
    _hl.raf = (root.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () {
      _hl.raf = 0; _drawOverlay();
    });
  }
  function highlight(on) {
    on = (on === undefined) ? !_hl.on : !!on;
    if (on) {
      if (!_hl.layer) {
        _hl.layer = document.createElement("div");
        _hl.layer.id = OVERLAY_ID;
        _hl.layer.setAttribute("aria-hidden", "true");
        _hl.layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147482000;";
        (document.body || document.documentElement).appendChild(_hl.layer);
        _hl.onScroll = function () { _scheduleDraw(); };
        root.addEventListener("scroll", _hl.onScroll, true);
        root.addEventListener("resize", _hl.onScroll, true);
      }
      _hl.on = true;
      _drawOverlay();
    } else {
      _hl.on = false;
      if (_hl.onScroll) {
        root.removeEventListener("scroll", _hl.onScroll, true);
        root.removeEventListener("resize", _hl.onScroll, true);
        _hl.onScroll = null;
      }
      if (_hl.layer) { _hl.layer.remove(); _hl.layer = null; }
    }
    return { on: _hl.on, count: _hlTargets().length };
  }

  // ------------------------------------------------------------------------
  // Site packs (plugins): platform-specific fixes layered on the generic rules.
  //
  //   pack = { id, title, match:{hosts?,generator?,selectors?,test?}, rules:[...] }
  //
  // A rule is DECLARATIVE (attribute-only, safe, portable, shareable as JSON) or
  // IMPERATIVE (a function, for bundled/PR packs needing more logic):
  //   declarative: { code, level, describe, select,
  //                  when?:{ missingName?, hasName?, notRole? },
  //                  set?:{ attr:value, ... }, remove?:[attr,...] }
  //   imperative:  { code, level, describe, fix:function(ctx, opts){ return count } }
  //
  // Declarative rules only touch attributes, so undo() restores them via the
  // same ORIG snapshot the core uses. Imperative rules receive a ctx of the same
  // undo-tracked helpers. Every pack change is stamped data-mdlaug-pack=<id> and
  // flows through the normal report / highlight / undo machinery.
  // ------------------------------------------------------------------------
  var PACKS = [];
  function removeAttrTracked(el, name) { if (!el.hasAttribute(name)) return; remember(el, [name]); el.removeAttribute(name); }
  function stampPack(el, code, packId) { mark(el, code); setAttr(el, "data-mdlaug-pack", packId); }
  function packCtx(pack) {
    return {
      $all: $all, text: text, hasName: hasName, humanSize: humanSize, fileExt: fileExt,
      setAttr: setAttr, removeAttr: removeAttrTracked, mark: function (el, code) { stampPack(el, code, pack.id); },
      srSpan: srSpan, announce: announce, log: log, document: document, MARK: MARK, packId: pack.id
    };
  }
  function compileDeclRule(pack, dr) {
    return {
      id: pack.id + ":" + (dr.code || "rule"), code: dr.code || "PACK", level: dr.level || "",
      kind: "fix", pack: pack.id, describe: dr.describe || (pack.title + " fix"),
      run: function () {
        var n = 0, els;
        try { els = $all(dr.select); } catch (e) { return 0; }
        els.forEach(function (el) {
          try {
            if (dr.when) {
              if (dr.when.missingName && hasName(el)) return;
              if (dr.when.hasName && !hasName(el)) return;
              if (dr.when.notRole && el.getAttribute("role") === dr.when.notRole) return;
            }
            var mk = el.getAttribute(MARK) || "";
            if (mk.indexOf(dr.code || "PACK") > -1 && el.getAttribute("data-mdlaug-pack") === pack.id) return; // idempotent
            if (dr.set) Object.keys(dr.set).forEach(function (a) { setAttr(el, a, String(dr.set[a])); });
            if (dr.remove) dr.remove.forEach(function (a) { removeAttrTracked(el, a); });
            stampPack(el, dr.code || "PACK", pack.id);
            n++;
          } catch (e) {}
        });
        if (n) log({ code: dr.code || "PACK", level: dr.level || "", kind: "fix", count: n, pack: pack.id, msg: dr.describe || ("[" + pack.id + "] " + (dr.code || "fix")) });
        return n;
      }
    };
  }
  function compilePack(pack) {
    pack._compiled = (pack.rules || []).map(function (r) {
      if (typeof r.fix === "function") {
        return {
          id: pack.id + ":" + (r.code || "rule"), code: r.code || "PACK", level: r.level || "", kind: "fix", pack: pack.id, describe: r.describe || "",
          run: function (opts) { var c = r.fix(packCtx(pack), opts || {}) || 0; if (c) log({ code: r.code || "PACK", level: r.level || "", kind: "fix", count: c, pack: pack.id, msg: r.describe || ("[" + pack.id + "] fix") }); return c; }
        };
      }
      return compileDeclRule(pack, r);
    });
    return pack;
  }
  function hostMatch(hosts) {
    var href = (root.location && root.location.href) || "";
    var host = (root.location && root.location.hostname) || "";
    return hosts.some(function (h) { return (h instanceof RegExp) ? h.test(href) : (host.indexOf(h) > -1 || href.indexOf(h) > -1); });
  }
  function metaGenerator(doc) { var m = doc.querySelector('meta[name="generator" i]'); return m ? (m.getAttribute("content") || "") : ""; }
  function matchPack(pack, doc) {
    var m = pack.match || {};
    if (m.hosts && m.hosts.length && !hostMatch(m.hosts)) return false;
    var provided = false, any = false;
    if (m.generator) { provided = true; try { if (m.generator.test(metaGenerator(doc))) any = true; } catch (e) {} }
    if (m.selectors && m.selectors.length) { provided = true; if (m.selectors.some(function (s) { try { return !!doc.querySelector(s); } catch (e) { return false; } })) any = true; }
    if (typeof m.test === "function") { provided = true; try { if (m.test(doc)) any = true; } catch (e) {} }
    return provided ? any : true; // hosts-only packs match on host alone
  }
  function registerPack(pack) {
    if (!pack || !pack.id) return null;
    if (pack.enabled === undefined) pack.enabled = true;
    // allow packs authored as JSON: a string `generator` becomes a RegExp
    if (pack.match && typeof pack.match.generator === "string") {
      try { pack.match.generator = new RegExp(pack.match.generator, "i"); } catch (e) { delete pack.match.generator; }
    }
    compilePack(pack);
    var i = PACKS.map(function (p) { return p.id; }).indexOf(pack.id);
    if (i > -1) PACKS[i] = pack; else PACKS.push(pack);
    return pack.id;
  }
  function unregisterPack(id) { PACKS = PACKS.filter(function (p) { return p.id !== id; }); }
  function setPackEnabled(id, on) { PACKS.forEach(function (p) { if (p.id === id) p.enabled = !!on; }); }
  function packsList() {
    return PACKS.map(function (p) {
      return { id: p.id, title: p.title || p.id, enabled: p.enabled !== false, matched: matchPack(p, document), rules: (p.rules || []).length, source: p.source || "bundled" };
    });
  }
  function matchedPacks() { return packsList().filter(function (p) { return p.matched && p.enabled; }); }

  // ------------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------------
  function remediate(opts) {
    opts = opts || {};
    report = [];
    ensureSrOnlyStyle();
    var only = opts.only ? (Array.isArray(opts.only) ? opts.only : [opts.only]) : null;
    var total = 0;
    RULES.forEach(function (r) {
      if (only && only.indexOf(r.id) === -1 && only.indexOf(r.code) === -1) return;
      try { total += r.run(opts) || 0; } catch (e) {
        log({ code: r.code, kind: "error", msg: "Rule " + r.id + " failed: " + e.message });
      }
    });
    // site packs: platform-specific fixes layered on top of the generic rules
    PACKS.forEach(function (pack) {
      if (pack.enabled === false) return;
      if (!matchPack(pack, document)) return;
      (pack._compiled || []).forEach(function (cr) {
        if (only && only.indexOf(cr.code) === -1 && only.indexOf(cr.id) === -1) return;
        try { total += cr.run(opts) || 0; } catch (e) {
          log({ code: cr.code, kind: "error", msg: "Pack " + pack.id + " rule " + cr.id + " failed: " + e.message });
        }
      });
    });
    return { fixesApplied: total, report: report.slice(), packs: matchedPacks(), rules: RULES.map(function (r) {
      return { id: r.id, code: r.code, level: r.level, kind: r.kind, describe: r.describe, wcag: WCAG_MAP[r.code] || "" };
    }) };
  }

  function undo() {
    highlight(false);
    // remove our injected nodes
    $all("[" + MARK + "]").forEach(function (el) {
      var codes = el.getAttribute(MARK);
      if (/sr|ACC1-view|COM1/.test(codes) && (el.classList.contains("mdlaug-skip") ||
          el.classList.contains("mdlaug-viewbtn") || el.classList.contains("mdlaug-sr-only") ||
          el.getAttribute(MARK) === "ACC1-view")) {
        // injected node → drop it (but keep site content)
        if (!el.hasAttribute(ORIG)) { el.remove(); return; }
      }
    });
    // restore original attributes
    $all("[" + ORIG + "]").forEach(function (el) {
      try {
        var snap = JSON.parse(el.getAttribute(ORIG));
        Object.keys(snap).forEach(function (a) {
          if (snap[a] === null) el.removeAttribute(a);
          else el.setAttribute(a, snap[a]);
        });
      } catch (e) {}
      el.removeAttribute(ORIG);
      el.removeAttribute(MARK);
    });
    // strip helper elements/styles
    ["#" + LIVE_ID, "#" + SR_ONLY_ID, "#" + OVERLAY_ID, ".mdlaug-viewbtn", ".mdlaug-skip",
     ".mdlaug-skip-results", "[data-mdlaug-status]", "[data-mdlaug-pos]",
     ".mdlaug-mediabar", ".mdlaug-transcript", ".mdlaug-track", ".mdlaug-medianote",
     "[data-mdlaug='ACC3']", "[data-mdlaug-why]", ".mdlaug-inline-view"].forEach(function (s) {
      $all(s).forEach(function (n) { n.remove(); });
    });
    report = [];
  }

  function audit() {
    // dry run: count without mutating (approximate) by scanning marks after remediate
    var res = remediate({ inlineViewers: false });
    undo();
    return res.report;
  }

  var api = {
    remediate: remediate,
    undo: undo,
    audit: audit,
    highlight: highlight,
    announce: announce,
    rules: function () { return RULES.map(function (r) { return { id: r.id, code: r.code, level: r.level, kind: r.kind, describe: r.describe, wcag: WCAG_MAP[r.code] || "" }; }); },
    registerPack: registerPack,
    unregisterPack: unregisterPack,
    setPackEnabled: setPackEnabled,
    packs: packsList,
    matchedPacks: matchedPacks,
    version: "0.9.10"
  };

  root.mDLAUG = root.mDLAUG || {};
  root.mDLAUG.remediator = api;
  // convenience
  root.mDLAUG.remediate = remediate;
  root.mDLAUG.undo = undo;

  if (typeof module !== "undefined" && module.exports) module.exports = api;

})(typeof window !== "undefined" ? window : this);
