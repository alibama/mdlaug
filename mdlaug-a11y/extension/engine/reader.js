/*
 * mDLAUG Reading Room
 *
 * A standardized, screen-reader-first VIEW of whatever page (or item, or file)
 * the user is on. Where the remediator repairs a site in place, the Reading
 * Room re-presents its content in ONE consistent linear layout so a BVI user
 * gets the same predictable experience on every digital library:
 *
 *   skip link → title/byline/source → Contents (jump links, NAV4.3) →
 *   linear content in true reading order, with every image, graph, table and
 *   attached file handled explicitly.
 *
 * Heavy work is never done inline. Missing image/graph descriptions, OCR of
 * image-of-text, and reflowing an attached PDF are all handed to the compute
 * manager (engine/compute.js), which queues them under a budget the user
 * controls. Machine-produced descriptions are always shown labelled as
 * unverified — we surface them, we don't pass them off as authored.
 *
 * Rendered into an open shadow root so the host site's CSS cannot distort the
 * standardized presentation, and font-size / spacing / theme are user-set.
 */
(function (root) {
  "use strict";

  var FILE_EXT = /\.(pdf|docx?|pptx?|xlsx?|csv|txt|rtf|epub)(\?|#|$)/i;
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, NAV: 1, HEADER: 1, FOOTER: 1, ASIDE: 1, FORM: 1, BUTTON: 1, IFRAME: 1 };
  var SKIP_ROLES = { navigation: 1, banner: 1, contentinfo: 1, complementary: 1, search: 1, menu: 1, menubar: 1, toolbar: 1 };

  function txt(el) { return (el.textContent || "").replace(/\s+/g, " ").trim(); }
  function visible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return false;
    if (el.hasAttribute && el.hasAttribute("hidden")) return false;
    // jsdom has no layout; only trust inline display:none when present
    var st = el.getAttribute && el.getAttribute("style");
    if (st && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(st)) return false;
    return true;
  }
  function slug(s, i) { return "rr-" + (String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "sec") + "-" + i; }

  // ---- extract a normalized reading model from a DOM subtree --------------
  function extract(rootEl, opts) {
    opts = opts || {};
    var doc = (rootEl && rootEl.ownerDocument) || root.document;
    var scope = rootEl ||
      doc.querySelector("main, [role='main'], article") ||
      doc.body || doc.documentElement;

    var model = {
      title: (opts.title || (doc.title || "").trim() || "").trim(),
      lang: (doc.documentElement && doc.documentElement.getAttribute("lang")) || opts.lang || "en",
      source: opts.source || (root.location && root.location.href) || "",
      byline: "", outline: [], blocks: []
    };

    var seq = 0, seenText = {};
    function pushHeading(level, text) {
      if (!text) return;
      var id = slug(text, seq++);
      model.outline.push({ id: id, level: level, text: text });
      model.blocks.push({ type: "heading", level: level, text: text, id: id });
    }
    function pushOnce(block, dedupeKey) {
      if (dedupeKey) { if (seenText[dedupeKey]) return; seenText[dedupeKey] = 1; }
      model.blocks.push(block);
    }

    function imgBlock(img) {
      var alt = img.getAttribute("alt");
      var w = +img.getAttribute("width") || 0, h = +img.getAttribute("height") || 0;
      var role = img.getAttribute("role");
      var decorative = alt === "" || role === "presentation" || role === "none" || (w && w <= 32) || (h && h <= 32);
      if (decorative) return null;
      var src = img.currentSrc || img.getAttribute("src") || "";
      var filenameAlt = alt && /\.(jpe?g|png|gif|webp|svg|tif)$/i.test(alt.trim());
      var needsDesc = !alt || !alt.trim() || filenameAlt;
      return { type: "image", src: src, alt: needsDesc ? "" : alt.trim(), needsDesc: needsDesc, id: "rr-img-" + (seq++) };
    }
    function tableBlock(t) {
      var headers = [];
      var head = t.querySelector("thead tr") || t.querySelector("tr");
      if (head) headers = Array.prototype.map.call(head.querySelectorAll("th,td"), txt);
      var rows = [];
      var bodyRows = t.querySelectorAll("tbody tr");
      if (!bodyRows.length) bodyRows = t.querySelectorAll("tr");
      Array.prototype.forEach.call(bodyRows, function (tr, i) {
        if (i === 0 && (!t.querySelector("thead")) && tr.querySelector("th")) return; // first row was header
        rows.push(Array.prototype.map.call(tr.querySelectorAll("td,th"), txt));
      });
      var caption = t.querySelector("caption");
      return { type: "table", caption: caption ? txt(caption) : "", headers: headers, rows: rows };
    }

    function emitFileLinks(container) {
      if (!container.querySelectorAll) return;
      Array.prototype.forEach.call(container.querySelectorAll("a[href]"), function (a) {
        var href = a.getAttribute("href") || "";
        if (FILE_EXT.test(href)) {
          var m = href.match(FILE_EXT);
          pushOnce({ type: "filelink", href: href, name: txt(a) || href.split("/").pop(), ext: (m ? m[1] : "").toLowerCase() }, "file:" + href);
        }
      });
    }

    (function walk(node) {
      for (var c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        if (!visible(c)) continue;
        var tag = c.tagName;
        if (SKIP_TAGS[tag]) continue;
        var role = c.getAttribute && c.getAttribute("role");
        if (role && SKIP_ROLES[role]) continue;

        if (/^H[1-6]$/.test(tag)) { pushHeading(+tag[1], txt(c)); continue; }
        if (tag === "IMG") { var ib = imgBlock(c); if (ib) model.blocks.push(ib); continue; }
        if (tag === "FIGURE") {
          var img = c.querySelector("img");
          var cap = c.querySelector("figcaption");
          if (img) {
            var b = imgBlock(img) || { type: "image", src: img.getAttribute("src") || "", alt: "", needsDesc: !cap, id: "rr-img-" + (seq++) };
            if (cap) { b.alt = txt(cap); b.needsDesc = false; }
            model.blocks.push(b);
          } else if (cap) { pushOnce({ type: "para", text: txt(cap) }, txt(cap)); }
          continue;
        }
        if (/(chart|graph|plot|visuali[sz]ation)/i.test((c.getAttribute("class") || "")) || (tag === "CANVAS")) {
          model.blocks.push({ type: "graph", label: txt(c).slice(0, 80) || "Data graphic", id: "rr-graph-" + (seq++), needsDesc: true });
          continue;
        }
        if (tag === "TABLE") { model.blocks.push(tableBlock(c)); continue; }
        if (tag === "UL" || tag === "OL") {
          var items = Array.prototype.map.call(c.querySelectorAll(":scope > li"), txt).filter(Boolean);
          if (items.length) model.blocks.push({ type: "list", ordered: tag === "OL", items: items });
          continue;
        }
        if (tag === "A") {
          var href = c.getAttribute("href") || "";
          if (FILE_EXT.test(href)) {
            var m = href.match(FILE_EXT);
            pushOnce({ type: "filelink", href: href, name: txt(c) || href.split("/").pop(), ext: (m ? m[1] : "").toLowerCase() }, "file:" + href);
            continue;
          }
        }
        if (tag === "BLOCKQUOTE") { pushOnce({ type: "quote", text: txt(c) }, "q:" + txt(c)); continue; }
        if (tag === "PRE") { pushOnce({ type: "code", text: c.textContent || "" }); continue; }
        if (tag === "P") { var t = txt(c); if (t) pushOnce({ type: "para", text: t }, "p:" + t); emitFileLinks(c); continue; }

        // block-ish container with direct text and no block children → paragraph
        var hasBlockChild = c.querySelector && c.querySelector("h1,h2,h3,h4,h5,h6,p,ul,ol,table,figure,img,li,section,article,div");
        if (!hasBlockChild) {
          emitFileLinks(c);
          var tt = txt(c);
          if (tt && tt.length > 1) { pushOnce({ type: "para", text: tt }, "p:" + tt); continue; }
        }
        walk(c);
      }
    })(scope);

    if (!model.title) { var h = model.outline[0]; model.title = h ? h.text : "Reading Room"; }
    return model;
  }

  // ---- render the standardized view ---------------------------------------
  var CSS = [
    ":host{all:initial}",
    ".rr-root{position:fixed;inset:0;z-index:2147483646;overflow:auto;",
    "  background:var(--rr-bg,#faf8f2);color:var(--rr-ink,#15211d);",
    "  font:var(--rr-fs,18px)/1.7 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}",
    ".rr-root.dark{--rr-bg:#12181a;--rr-ink:#e8efec;--rr-line:#2b3a36;--rr-card:#182220}",
    ".rr-root.sepia{--rr-bg:#f4ecd8;--rr-ink:#3a2f22;--rr-line:#ddccae;--rr-card:#efe4cc}",
    ".rr-bar{position:sticky;top:0;display:flex;flex-wrap:wrap;gap:8px;align-items:center;",
    "  padding:10px 16px;background:var(--rr-card,#12332e);color:#eef7f4;border-bottom:2px solid #f4c542;z-index:2}",
    ".rr-bar strong{font-size:15px;margin-right:auto}",
    ".rr-bar button{font:600 13px/1 inherit;border:1px solid rgba(255,255,255,.4);background:transparent;color:inherit;",
    "  border-radius:8px;padding:7px 11px;cursor:pointer}",
    ".rr-bar button:focus-visible,.rr-main a:focus-visible,.rr-main button:focus-visible{outline:3px solid #f4c542;outline-offset:2px}",
    ".rr-wrap{max-width:74ch;margin:0 auto;padding:24px 20px 120px}",
    ".rr-title{font-size:1.9em;line-height:1.2;margin:.2em 0}",
    ".rr-byline{color:var(--rr-mut,#5c6b64);font-size:.85em;margin:0 0 1em;word-break:break-word}",
    ".rr-toc{border:1px solid var(--rr-line,#dcd6c6);border-radius:12px;padding:12px 16px;margin:0 0 24px;background:var(--rr-card,#fff)}",
    ".rr-toc h2{font-size:.8em;text-transform:uppercase;letter-spacing:.1em;margin:0 0 8px;color:var(--rr-mut,#5c6b64)}",
    ".rr-toc ol{margin:0;padding-left:1.4em} .rr-toc li{margin:3px 0}",
    ".rr-toc a{color:inherit;text-decoration:none;border-bottom:1px solid transparent} .rr-toc a:hover{border-color:currentColor}",
    ".rr-main h1,.rr-main h2,.rr-main h3,.rr-main h4{line-height:1.25;margin:1.4em 0 .4em}",
    ".rr-main h1{font-size:1.5em}.rr-main h2{font-size:1.3em}.rr-main h3{font-size:1.12em}",
    ".rr-main p{margin:0 0 1em}.rr-main ul,.rr-main ol{margin:0 0 1em;padding-left:1.6em}",
    ".rr-fig{margin:1.2em 0;border:1px solid var(--rr-line,#dcd6c6);border-radius:12px;overflow:hidden;background:var(--rr-card,#fff)}",
    ".rr-fig img{display:block;max-width:100%;height:auto}",
    ".rr-fig figcaption{padding:10px 14px;font-size:.9em}",
    ".rr-needs{padding:10px 14px;font-size:.9em;border-top:1px solid var(--rr-line,#dcd6c6);display:flex;gap:10px;align-items:center;flex-wrap:wrap}",
    ".rr-tag{font:600 11px/1.5 ui-monospace,monospace;padding:1px 7px;border-radius:999px;background:#e8912a;color:#3a2400}",
    ".rr-tag.ai{background:#1f9e8f;color:#04231f}",
    ".rr-do{font:600 13px/1 inherit;border:0;border-radius:8px;padding:8px 12px;background:#12332e;color:#eef7f4;cursor:pointer}",
    ".rr-desc{padding:10px 14px;border-top:1px dashed var(--rr-line,#dcd6c6);font-size:.92em}",
    ".rr-desc .lab{font:600 11px/1.5 ui-monospace,monospace;color:#0f6d61;display:block;margin-bottom:2px}",
    ".rr-table{width:100%;border-collapse:collapse;margin:1.2em 0;font-size:.92em}",
    ".rr-table caption{text-align:left;font-weight:600;margin-bottom:6px}",
    ".rr-table th,.rr-table td{border:1px solid var(--rr-line,#dcd6c6);padding:6px 9px;text-align:left}",
    ".rr-file{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:1em 0;padding:12px 14px;border:1px solid var(--rr-line,#dcd6c6);border-radius:12px;background:var(--rr-card,#fff)}",
    ".rr-file .nm{font-weight:600}.rr-file .ext{font:600 11px/1.5 ui-monospace,monospace;background:#12332e;color:#eef7f4;border-radius:5px;padding:1px 6px}",
    ".rr-reflowed{margin:.8em 0 0;padding-top:.8em;border-top:1px dashed var(--rr-line,#dcd6c6)}",
    // compute drawer
    ".rr-drawer{position:fixed;right:0;bottom:0;width:min(420px,94vw);max-height:60vh;overflow:auto;",
    "  background:var(--rr-card,#fff);color:var(--rr-ink,#15211d);border:1px solid var(--rr-line,#dcd6c6);",
    "  border-radius:14px 0 0 0;box-shadow:0 -8px 30px rgba(0,0,0,.25);z-index:3}",
    ".rr-drawer h2{font-size:.8em;text-transform:uppercase;letter-spacing:.1em;margin:0;padding:12px 16px;border-bottom:1px solid var(--rr-line,#dcd6c6)}",
    ".rr-job{display:flex;gap:8px;align-items:center;padding:8px 16px;border-bottom:1px solid var(--rr-line,#eee);font-size:.85em}",
    ".rr-job .st{margin-left:auto;font:600 11px/1 ui-monospace,monospace}",
    ".rr-job .bar{height:4px;flex:1;background:#e6e2d5;border-radius:3px;overflow:hidden;max-width:120px}",
    ".rr-job .bar i{display:block;height:100%;background:#1f9e8f}",
    ".sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}"
  ].join("");

  function el(tag, attrs, kids) {
    var d = (root.document).createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "text") d.textContent = attrs[k];
      else if (k === "html") d.innerHTML = attrs[k];
      else d.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) d.appendChild(c); });
    return d;
  }

  function render(model, services) {
    services = services || {};
    var compute = services.compute, converter = services.converter;
    var docFrag = el("div", { class: "rr-root", role: "document" });

    // top bar
    var bar = el("div", { class: "rr-bar" });
    bar.appendChild(el("strong", { text: "Reading Room" }));
    function barBtn(label, fn, aria) { var b = el("button", { type: "button" }); b.textContent = label; if (aria) b.setAttribute("aria-label", aria); b.addEventListener("click", fn); bar.appendChild(b); return b; }
    var fs = parseInt(services.fontSize || 18, 10);
    function setFs(v) { fs = Math.max(14, Math.min(28, v)); docFrag.style.setProperty("--rr-fs", fs + "px"); }
    barBtn("A−", function () { setFs(fs - 2); }, "Decrease text size");
    barBtn("A+", function () { setFs(fs + 2); }, "Increase text size");
    var themes = ["", "dark", "sepia"], ti = 0;
    barBtn("Theme", function () { ti = (ti + 1) % themes.length; docFrag.className = "rr-root" + (themes[ti] ? " " + themes[ti] : ""); }, "Cycle color theme");
    var jobsBtn = barBtn("Tasks", function () { drawer.hidden = !drawer.hidden; }, "Show background tasks");
    barBtn("Close", function () { close(); }, "Close Reading Room");
    docFrag.appendChild(bar);

    var wrap = el("div", { class: "rr-wrap" });
    wrap.appendChild(el("a", { href: "#rr-content", class: "sr-only" , text: "Skip to content"}));
    wrap.appendChild(el("h1", { class: "rr-title", id: "rr-top", text: model.title }));
    if (model.source) wrap.appendChild(el("p", { class: "rr-byline", text: "Source: " + model.source }));

    // Contents (NAV4.3: overview of a lengthy item with links to its sections)
    if (model.outline.length >= 3) {
      var toc = el("nav", { class: "rr-toc", "aria-label": "Contents" });
      toc.appendChild(el("h2", { text: "Contents" }));
      var ol = el("ol");
      model.outline.forEach(function (h) {
        var li = el("li"); li.style.marginLeft = ((h.level - 1) * 10) + "px";
        li.appendChild(el("a", { href: "#" + h.id, text: h.text }));
        ol.appendChild(li);
      });
      toc.appendChild(ol); wrap.appendChild(toc);
    }

    var main = el("main", { class: "rr-main", id: "rr-content", tabindex: "-1" });
    model.blocks.forEach(function (b) { main.appendChild(blockNode(b, { compute: compute, converter: converter })); });
    wrap.appendChild(main);
    docFrag.appendChild(wrap);

    // compute drawer (background tasks)
    var drawer = el("div", { class: "rr-drawer", role: "region", "aria-label": "Background tasks", hidden: "" });
    drawer.appendChild(el("h2", { text: "Background tasks" }));
    var jobList = el("div"); drawer.appendChild(jobList);
    docFrag.appendChild(drawer);

    if (compute) {
      var refresh = function () {
        var st = compute.status();
        jobList.textContent = "";
        if (!st.jobs.length) { jobList.appendChild(el("div", { class: "rr-job", text: "No tasks yet." })); }
        st.jobs.slice(-30).reverse().forEach(function (j) {
          var row = el("div", { class: "rr-job" });
          row.appendChild(el("span", { text: j.label }));
          var bar2 = el("span", { class: "bar" }); var i = el("i"); i.style.width = Math.round((j.progress || 0) * 100) + "%"; bar2.appendChild(i); row.appendChild(bar2);
          row.appendChild(el("span", { class: "st", text: j.state + (j.cached ? " (cached)" : "") }));
          jobList.appendChild(row);
        });
        var pend = st.jobs.filter(function (j) { return j.state === "held" || j.state === "queued" || j.state === "running"; }).length;
        jobsBtn.textContent = pend ? "Tasks (" + pend + ")" : "Tasks";
      };
      compute.on("status", refresh); refresh();
    }

    // focus mgmt + escape
    function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(); } }
    var host, prevFocus;
    function mount() {
      prevFocus = root.document.activeElement;
      host = el("div", { id: "mdlaug-reading-room" });
      var shadow = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
      var style = el("style", { text: CSS });
      shadow.appendChild(style); shadow.appendChild(docFrag);
      root.document.body.appendChild(host);
      root.document.documentElement.style.setProperty("overflow", "hidden");
      docFrag.addEventListener("keydown", onKey);
      setTimeout(function () { main.focus(); }, 0);
      return shadow;
    }
    function close() {
      if (host && host.parentNode) host.parentNode.removeChild(host);
      root.document.documentElement.style.removeProperty("overflow");
      try { prevFocus && prevFocus.focus && prevFocus.focus(); } catch (e) {}
    }

    return { node: docFrag, mount: mount, close: close };
  }

  // one content block → a standardized DOM node
  function blockNode(b, services) {
    var compute = services.compute, converter = services.converter;
    switch (b.type) {
      case "heading":
        return el("h" + Math.min(b.level, 4), { id: b.id, text: b.text });
      case "para": return el("p", { text: b.text });
      case "quote": return el("blockquote", { text: b.text });
      case "code": { var pre = el("pre"); pre.textContent = b.text; return pre; }
      case "list": {
        var list = el(b.ordered ? "ol" : "ul");
        b.items.forEach(function (it) { list.appendChild(el("li", { text: it })); });
        return list;
      }
      case "table": {
        var t = el("table", { class: "rr-table" });
        if (b.caption) t.appendChild(el("caption", { text: b.caption }));
        if (b.headers && b.headers.length) {
          var thead = el("thead"), tr = el("tr");
          b.headers.forEach(function (h) { tr.appendChild(el("th", { scope: "col", text: h })); });
          thead.appendChild(tr); t.appendChild(thead);
        }
        var tb = el("tbody");
        (b.rows || []).forEach(function (r) {
          var row = el("tr");
          r.forEach(function (cell, i) { row.appendChild(el(i === 0 ? "th" : "td", i === 0 ? { scope: "row", text: cell } : { text: cell })); });
          tb.appendChild(row);
        });
        t.appendChild(tb);
        return t;
      }
      case "image": case "graph": return figureNode(b, services);
      case "filelink": return fileNode(b, services);
      default: return el("p", { text: b.text || "" });
    }
  }

  function figureNode(b, services) {
    var compute = services.compute;
    var fig = el("figure", { class: "rr-fig" });
    if (b.type === "image" && b.src) fig.appendChild(el("img", { src: b.src, alt: b.alt || "" }));
    if (b.type === "graph") fig.appendChild(el("figcaption", { text: "Data graphic: " + (b.label || "chart") }));

    if (b.type === "image" && b.alt) { fig.appendChild(el("figcaption", { text: b.alt })); return fig; }
    if (b.needsDesc) {
      var cap = (b.type === "graph") ? "describeGraph" : "describeImage";
      var needs = el("div", { class: "rr-needs" });
      needs.appendChild(el("span", { class: "rr-tag", text: "no description" }));
      var descBox = el("div", { class: "rr-desc" }); descBox.hidden = true; fig.appendChild(descBox);

      var applyResult = function (r) {
        if (!r || r.skipped) {
          needs.appendChild(el("span", { text: r && r.reason ? "Description service " + r.reason + " — configure one in settings." : "No description available yet." }));
          return;
        }
        var text = r.description || r.text || "";
        descBox.textContent = "";
        descBox.appendChild(el("span", { class: "lab", text: "Machine description — unverified" }));
        descBox.appendChild(root.document.createTextNode(text));
        descBox.hidden = false;
        needs.textContent = ""; needs.appendChild(el("span", { class: "rr-tag ai", text: "AI · unverified" }));
      };

      if (compute && compute.hasProvider(cap)) {
        if (compute.policy[cap] === "auto") {
          needs.appendChild(el("span", { text: "Describing…" }));
          compute.enqueue(cap, { src: b.src, hashSource: b.src || b.label, prompt: b.type === "graph" ? "Explain this chart's trend for a blind reader in 1-2 sentences." : "Describe this image for a blind reader in one concise sentence." }, { label: b.type === "graph" ? "Describe graph" : "Describe image" }).promise.then(applyResult);
        } else { // ask
          var btn = el("button", { class: "rr-do", type: "button", text: b.type === "graph" ? "Explain graph" : "Describe image" });
          btn.addEventListener("click", function () {
            btn.disabled = true; btn.textContent = "Working…";
            var job = compute.enqueue(cap, { src: b.src, hashSource: b.src || b.label, prompt: b.type === "graph" ? "Explain this chart's trend for a blind reader in 1-2 sentences." : "Describe this image for a blind reader in one concise sentence." }, { label: b.type === "graph" ? "Describe graph" : "Describe image" });
            compute.run(job.id);
            job.promise.then(applyResult).catch(function (e) { btn.disabled = false; btn.textContent = "Retry"; });
          });
          needs.appendChild(btn);
        }
      } else {
        needs.appendChild(el("span", { text: "Needs a description (no description service configured)." }));
      }
      fig.appendChild(needs);
    }
    return fig;
  }

  function fileNode(b, services) {
    var compute = services.compute, converter = services.converter;
    var wrap = el("div", { class: "rr-file" });
    wrap.appendChild(el("span", { class: "ext", text: b.ext.toUpperCase() }));
    wrap.appendChild(el("span", { class: "nm", text: b.name }));
    var reflowed = el("div", { class: "rr-reflowed" }); reflowed.hidden = true;
    if (converter && /^(pdf|docx?|csv|txt)$/i.test(b.ext)) {
      var btn = el("button", { class: "rr-do", type: "button", text: "Reflow inline" });
      btn.addEventListener("click", function () {
        btn.disabled = true; btn.textContent = "Reflowing…";
        var run = function () {
          if (/pdf/i.test(b.ext)) return converter.pdfToModel(b.href).then(function (m) { return converter.modelToHtml(m); });
          if (/docx?/i.test(b.ext)) return converter.docxToHtml(b.href);
          if (/csv/i.test(b.ext)) return fetch(b.href).then(function (r) { return r.text(); }).then(converter.csvToHtml);
          return fetch(b.href).then(function (r) { return r.text(); }).then(converter.textToHtml);
        };
        var go = compute
          ? compute.enqueue("reflowPdf", { source: b.href, hashSource: b.href, run: run }, { label: "Reflow " + b.name }).promise.then(function (r) { return r && r.html ? r.html : (r && r.skipped ? null : r); })
          : run();
        Promise.resolve(go).then(function (html) {
          if (html == null) { btn.textContent = "Reflow (turned off)"; btn.disabled = false; return; }
          reflowed.innerHTML = typeof html === "string" ? html : "";
          reflowed.hidden = false; btn.textContent = "Reflowed ✓";
        }).catch(function (e) { btn.disabled = false; btn.textContent = "Retry"; reflowed.hidden = false; reflowed.textContent = "Could not reflow: " + e.message; });
      });
      wrap.appendChild(btn);
    } else {
      wrap.appendChild(el("a", { href: b.href, text: "Open file" }));
    }
    var outer = el("div"); outer.appendChild(wrap); outer.appendChild(reflowed);
    return outer;
  }

  // open on the live page
  function open(services) {
    services = services || {};
    var model = extract(services.root || null, services);
    var r = render(model, services);
    r.mount();
    return { model: model, close: r.close };
  }

  var api = { extract: extract, render: render, open: open, version: "0.9.0" };
  root.mDLAUG = root.mDLAUG || {};
  root.mDLAUG.reader = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

})(typeof window !== "undefined" ? window : this);
