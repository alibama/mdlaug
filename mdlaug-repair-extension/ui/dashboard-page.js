/* mDLAUG dashboard — dependency-free SVG charts over the active store (local or Turso). */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var status = $("status");
  var LVLCOLOR = { A: "#1f9e8f", AA: "#e8912a", AAA: "#b1315e" };
  var cfg = { storage: "local", tursoUrl: "", tursoToken: "", assessor: "" };
  var allRows = [];         // listAssessments
  var lastExport = null;    // cached full dump for JSON export

  function setStatus(t) { status.textContent = t; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function store() { return window.mDLAUG.store.resolve(cfg); }

  function loadConfig() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get({ mdlaug_store: null, mdlaug_turso: { url: "", token: "", assessor: "" } }, function (s) {
          if (s.mdlaug_store) cfg = s.mdlaug_store;
          else { var lg = s.mdlaug_turso || {}; cfg = { storage: (lg.url && lg.token) ? "turso-cloud" : "local", tursoUrl: lg.url || "", tursoToken: lg.token || "", assessor: lg.assessor || "" }; }
          resolve();
        });
      } catch (e) { resolve(); }
    });
  }

  function selectedLib() { var v = $("lib").value; return v || undefined; }

  function refresh() {
    setStatus("Loading… (" + (store().label || "local") + ")");
    var st = store();
    st.initSchema().then(function () { return st.listAssessments({ limit: 500 }); }).then(function (rows) {
      allRows = rows || [];
      populateLibs();
      return render();
    }).then(function () { setStatus(allRows.length + " audit(s) · " + (store().label || "local")); })
      .catch(function (e) { setStatus("Could not load: " + e.message); });
  }

  function populateLibs() {
    var sel = $("lib"); var cur = sel.value;
    var seen = {}, opts = ['<option value="">All libraries</option>'];
    allRows.forEach(function (r) {
      if (r.dl_url && !seen[r.dl_url]) { seen[r.dl_url] = 1; opts.push('<option value="' + esc(r.dl_url) + '">' + esc(r.dl_name || r.dl_url) + '</option>'); }
    });
    sel.innerHTML = opts.join("");
    if (cur) sel.value = cur;
  }

  function render() {
    var st = store(), lib = selectedLib();
    var filtered = lib ? allRows.filter(function (r) { return r.dl_url === lib; }) : allRows;
    // stats
    var libs = {}; allRows.forEach(function (r) { if (r.dl_url) libs[r.dl_url] = 1; });
    var latest = filtered.map(function (r) { return r.created_at || ""; }).sort().slice(-1)[0] || "—";
    $("stats").innerHTML =
      tile(filtered.length, "audits" + (lib ? " (this library)" : "")) +
      tile(Object.keys(libs).length, "libraries") +
      tile(esc(latest.slice(0, 10) || "—"), "latest audit");

    // compliance by situation + level rollup
    return st.complianceByCode(lib).then(function (codes) {
      codes.sort(function (a, b) { return (a.code || "").localeCompare(b.code || ""); });
      $("bysit").innerHTML = codes.length ? barChart(codes) + codeTable(codes) : emptyMsg("No scored audits yet.");
      $("bylevel").innerHTML = codes.length ? levelTiles(codes) : "";
      return buildTrend(filtered);
    });
  }

  function tile(v, label) { return '<div class="stat"><b>' + v + '</b><span>' + label + '</span></div>'; }
  function emptyMsg(t) { return '<div class="warn">' + esc(t) + ' Run an audit from the toolbar → <strong>Audit this page</strong>, then <strong>Save audit</strong>.</div>'; }

  // horizontal bar chart of avg score (1..7) per situation code
  function barChart(codes) {
    var Lx = 128, top = 8, rowH = 26, W = 680, valW = 46;
    var barMax = W - Lx - valW - 8;
    var H = top + codes.length * rowH + 8;
    var parts = ['<svg width="100%" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Average compliance score by situation">'];
    parts.push('<title>Average compliance by situation</title><desc>Average 1 to 7 score for each mDLAUG situation.</desc>');
    // gridlines at 1..7
    for (var g = 0; g <= 7; g++) {
      var gx = Lx + (g / 7) * barMax;
      parts.push('<line x1="' + gx + '" y1="' + top + '" x2="' + gx + '" y2="' + (H - 8) + '" stroke="#e3e0d6" stroke-width="1"/>');
      parts.push('<text x="' + gx + '" y="' + (H - 1) + '" font-size="9" fill="#8a8a82" text-anchor="middle">' + g + '</text>');
    }
    codes.forEach(function (c, i) {
      var y = top + i * rowH, avg = c.avg_score || 0;
      var w = Math.max(2, (avg / 7) * barMax);
      var col = LVLCOLOR[c.level] || "#888";
      parts.push('<text x="6" y="' + (y + rowH / 2) + '" font-size="11" font-family="ui-monospace,monospace" fill="#12211d" dominant-baseline="central">' + esc(c.code) + '</text>');
      parts.push('<rect x="' + Lx + '" y="' + (y + 4) + '" width="' + w + '" height="' + (rowH - 10) + '" rx="3" fill="' + col + '"/>');
      parts.push('<text x="' + (Lx + w + 6) + '" y="' + (y + rowH / 2) + '" font-size="11" fill="#3a3a36" dominant-baseline="central">' + avg.toFixed(1) + '</text>');
    });
    parts.push('</svg>');
    return parts.join("");
  }
  function codeTable(codes) {
    return '<details style="margin-top:8px"><summary style="cursor:pointer;font-size:12.5px;color:#5a6a63">Show as table</summary>' +
      '<table><thead><tr><th>Situation</th><th>Level</th><th>Avg score</th><th>n</th></tr></thead><tbody>' +
      codes.map(function (c) { return '<tr><td>' + esc(c.code) + '</td><td>' + esc(c.level) + '</td><td>' + (c.avg_score || 0).toFixed(2) + '</td><td>' + (c.n || 0) + '</td></tr>'; }).join("") +
      '</tbody></table></details>';
  }
  function levelTiles(codes) {
    var agg = { A: { s: 0, n: 0 }, AA: { s: 0, n: 0 }, AAA: { s: 0, n: 0 } };
    codes.forEach(function (c) { var L = agg[c.level]; if (!L) return; L.s += (c.avg_score || 0) * (c.n || 1); L.n += (c.n || 1); });
    return ["A", "AA", "AAA"].map(function (L) {
      var a = agg[L], v = a.n ? (a.s / a.n) : null;
      return '<div class="lvltile ' + L + '"><b>' + (v == null ? "—" : v.toFixed(1)) + '</b><span>Level ' + L + (v == null ? " · no data" : " avg (of 7)") + '</span></div>';
    }).join("");
  }

  // trend: overall avg compliance per audit over time (needs per-audit detail)
  function buildTrend(filtered) {
    var st = store();
    var subset = filtered.slice().sort(function (a, b) { return (a.created_at || "").localeCompare(b.created_at || ""); }).slice(-30);
    if (subset.length < 2) { $("trend").innerHTML = emptyMsg(subset.length === 1 ? "Only one audit for this selection — trend needs at least two." : "No audits yet."); return Promise.resolve(); }
    return Promise.all(subset.map(function (r) {
      return st.getAssessment(r.id).then(function (full) {
        var scores = (full.situations || []).map(function (s) { return s.compliance_score; }).filter(function (x) { return x != null; });
        var avg = scores.length ? scores.reduce(function (a, b) { return a + b; }, 0) / scores.length : null;
        return { date: (r.created_at || "").slice(0, 10), avg: avg };
      });
    })).then(function (points) {
      points = points.filter(function (p) { return p.avg != null; });
      $("trend").innerHTML = points.length >= 2 ? lineChart(points) : emptyMsg("Not enough scored audits for a trend.");
    });
  }
  function lineChart(points) {
    var W = 680, H = 220, padL = 34, padR = 12, padT = 12, padB = 28;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var x = function (i) { return padL + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW); };
    var y = function (v) { return padT + plotH - ((v - 1) / 6) * plotH; };
    var parts = ['<svg width="100%" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Overall compliance trend over time">'];
    parts.push('<title>Compliance trend</title><desc>Overall average score per audit over time.</desc>');
    [1, 4, 7].forEach(function (v) {
      parts.push('<line x1="' + padL + '" y1="' + y(v) + '" x2="' + (W - padR) + '" y2="' + y(v) + '" stroke="#e3e0d6" stroke-width="1"/>');
      parts.push('<text x="' + (padL - 6) + '" y="' + (y(v) + 3) + '" font-size="9" fill="#8a8a82" text-anchor="end">' + v + '</text>');
    });
    var d = points.map(function (p, i) { return (i ? "L" : "M") + x(i) + " " + y(p.avg); }).join(" ");
    parts.push('<path d="' + d + '" fill="none" stroke="#12332e" stroke-width="2"/>');
    points.forEach(function (p, i) {
      parts.push('<circle cx="' + x(i) + '" cy="' + y(p.avg) + '" r="3" fill="#1f9e8f"/>');
      if (i === 0 || i === points.length - 1) parts.push('<text x="' + x(i) + '" y="' + (H - 8) + '" font-size="9" fill="#8a8a82" text-anchor="' + (i ? "end" : "start") + '">' + esc(p.date) + '</text>');
    });
    parts.push('</svg>');
    return parts.join("");
  }

  // exports
  function download(name, text, type) {
    var blob = new Blob([text], { type: type || "text/plain" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }
  function exportCsv() {
    setStatus("Building CSV…");
    store().complianceByCode(selectedLib()).then(function (codes) {
      var rows = [["code", "level", "avg_score", "n"]].concat(codes.map(function (c) { return [c.code, c.level, (c.avg_score || 0).toFixed(3), c.n || 0]; }));
      download("mdlaug-compliance.csv", rows.map(function (r) { return r.join(","); }).join("\n"), "text/csv");
      setStatus("CSV exported.");
    }).catch(function (e) { setStatus("CSV failed: " + e.message); });
  }
  function exportJson() {
    setStatus("Bundling full data…");
    var st = store(), lib = selectedLib();
    var subset = (lib ? allRows.filter(function (r) { return r.dl_url === lib; }) : allRows);
    Promise.all(subset.map(function (r) { return st.getAssessment(r.id); })).then(function (full) {
      download("mdlaug-audits.json", JSON.stringify({ exported_at: new Date().toISOString(), count: full.length, audits: full }, null, 2), "application/json");
      setStatus("Exported " + full.length + " audit(s) as JSON.");
    }).catch(function (e) { setStatus("Export failed: " + e.message); });
  }

  $("refresh").addEventListener("click", refresh);
  $("lib").addEventListener("change", function () { render().then(function () { setStatus("Filtered."); }); });
  $("csv").addEventListener("click", exportCsv);
  $("json").addEventListener("click", exportJson);

  loadConfig().then(refresh);
})();
