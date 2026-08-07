(function(){
  var $=function(id){return document.getElementById(id);}, st=$("t-status");
  function mode(){ var r=document.querySelector('input[name="storage"]:checked'); return r?r.value:"local"; }
  function syncFields(){ var m=mode(); $("turso-fields").hidden = (m==="local"); $("t-token-l").style.opacity = (m==="turso-local")?".5":"1"; }
  Array.prototype.forEach.call(document.querySelectorAll('input[name="storage"]'), function(r){ r.addEventListener("change", syncFields); });
  try{
    chrome.storage.local.get({mdlaug_store:null, mdlaug_turso:{url:"",token:"",assessor:""}}, function(s){
      var c = s.mdlaug_store || (function(){ var lg=s.mdlaug_turso||{}, dflt=window.mDLAUG.store.defaultConfig(); return (lg.url&&lg.token)? { storage:"turso-cloud", tursoUrl:lg.url, tursoToken:lg.token, assessor:lg.assessor||"" } : { storage:dflt.storage, tursoUrl:dflt.tursoUrl, tursoToken:dflt.tursoToken, assessor:lg.assessor||"" }; })();
      var radio = document.querySelector('input[name="storage"][value="'+(c.storage||"local")+'"]'); if(radio) radio.checked=true;
      $("t-url").value=c.tursoUrl||""; $("t-token").value=c.tursoToken||""; $("t-assessor").value=c.assessor||"";
      syncFields();
    });
  }catch(e){ st.textContent="Available inside the extension only."; }
  function current(){ return { storage:mode(), tursoUrl:$("t-url").value.trim(), tursoToken:$("t-token").value.trim(), assessor:$("t-assessor").value.trim() }; }
  $("t-save").addEventListener("click", function(){
    try{ chrome.storage.local.set({mdlaug_store: current()}, function(){ st.textContent="Saved. Reopen the assessment page to apply."; }); }
    catch(e){ st.textContent="Could not save: "+e.message; }
  });
  $("t-test").addEventListener("click", function(){
    st.textContent="Checking…";
    try{
      var store = window.mDLAUG.store.resolve(current());
      store.initSchema().then(function(){ return store.ping(); })
        .then(function(ok){ st.textContent = ok ? ("Ready ✓ — "+(store.label||"local")) : "Reachable, unexpected reply."; })
        .catch(function(e){ st.textContent="Not reachable: "+e.message; });
    }catch(e){ st.textContent=e.message; }
  });
})();

(function(){
  var $=function(id){return document.getElementById(id);};
  var st=$("cfg-status");
  try{
    chrome.storage.sync.get({describeUrl:"",describeHeaders:"",transcribeUrl:"",transcribeHeaders:"",ocrEnabled:false,autoDescribe:false,concurrency:2,
      budget:{describeImage:"ask",describeGraph:"ask",ocr:"ask",reflowPdf:"auto",transcribe:"ask"}}, function(cfg){
      $("cfg-url").value=cfg.describeUrl||""; $("cfg-headers").value=cfg.describeHeaders||"";
      $("cfg-turl").value=cfg.transcribeUrl||""; $("cfg-theaders").value=cfg.transcribeHeaders||"";
      $("cfg-img").value=(cfg.budget&&cfg.budget.describeImage)||"ask";
      $("cfg-graph").value=(cfg.budget&&cfg.budget.describeGraph)||"ask";
      $("cfg-media").value=(cfg.budget&&cfg.budget.transcribe)||"ask";
      $("cfg-conc").value=cfg.concurrency||2; $("cfg-ocr").checked=!!cfg.ocrEnabled; if($("cfg-auto")) $("cfg-auto").checked=!!cfg.autoDescribe;
    });
  }catch(e){ st.textContent="Settings available only inside the extension."; }
  $("cfg-save").addEventListener("click", function(){
    var headers=$("cfg-headers").value.trim();
    if(headers){ try{ JSON.parse(headers); }catch(e){ st.textContent="Headers must be valid JSON."; return; } }
    var theaders=$("cfg-theaders").value.trim();
    if(theaders){ try{ JSON.parse(theaders); }catch(e){ st.textContent="Transcription headers must be valid JSON."; return; } }
    var cfg={ describeUrl:$("cfg-url").value.trim(), describeHeaders:headers,
      transcribeUrl:$("cfg-turl").value.trim(), transcribeHeaders:theaders,
      ocrEnabled:$("cfg-ocr").checked, autoDescribe:($("cfg-auto")?$("cfg-auto").checked:false), concurrency:Math.max(1,Math.min(6,parseInt($("cfg-conc").value,10)||2)),
      budget:{ describeImage:$("cfg-img").value, describeGraph:$("cfg-graph").value, transcribe:$("cfg-media").value, ocr:"ask", reflowPdf:"auto" } };
    try{ chrome.storage.sync.set(cfg, function(){ st.textContent="Saved. Reload the digital-library tab to apply."; }); }
    catch(e){ st.textContent="Could not save: "+e.message; }
  });
})();

(function(){
  var C = window.mDLAUG.converter;
  // extension pages block remote scripts, so use the vendored copies
  C.configure({
    pdfjsUrl: "../vendor/pdf.min.mjs",
    pdfWorkerUrl: "../vendor/pdf.worker.min.mjs",
    mammothUrl: "../vendor/mammoth.browser.min.js"
  });
  var drop=document.getElementById("drop"), input=document.getElementById("file"),
      status=document.getElementById("status"), view=document.getElementById("view"),
      tools=document.getElementById("tools");
  var current={ html:null, model:null, title:"document" };

  ["dragover","dragenter"].forEach(function(e){ drop.addEventListener(e,function(ev){ ev.preventDefault(); drop.classList.add("drag"); }); });
  ["dragleave","drop"].forEach(function(e){ drop.addEventListener(e,function(){ drop.classList.remove("drag"); }); });
  drop.addEventListener("drop", function(ev){ ev.preventDefault(); if(ev.dataTransfer.files[0]) handle(ev.dataTransfer.files[0]); });
  input.addEventListener("change", function(){ if(input.files[0]) handle(input.files[0]); });

  async function handle(file){
    var ext=(file.name.split(".").pop()||"").toLowerCase();
    current.title = file.name.replace(/\.[^.]+$/,"") || "document";
    status.textContent = "Converting "+file.name+"…";
    view.hidden=true; tools.hidden=true;
    try{
      if(ext==="pdf"){
        current.model = await C.pdfToModel(file);
        current.html = C.modelToHtml(current.model);
      } else if(ext==="docx"){
        current.html = await C.docxToHtml(file);
        current.model = null;
      } else if(ext==="csv"){
        current.html = C.csvToHtml(await file.text());
      } else {
        current.html = C.textToHtml(await file.text());
      }
      view.innerHTML = current.html;
      view.hidden=false; tools.hidden=false;
      status.textContent = "Converted. Review below, then download in your preferred format.";
      view.focus();
    }catch(err){
      status.textContent = "Couldn't convert this file: "+err.message;
    }
  }

  document.getElementById("dl-docx").addEventListener("click", function(){
    var blob = current.model ? C.modelToDocx(current.model) : C.htmlToDocx(current.html, current.title);
    C.triggerDownload(blob, current.title+".docx");
  });
  document.getElementById("dl-html").addEventListener("click", function(){
    var doc="<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>"+current.title+"</title></head><body>"+current.html+"</body></html>";
    C.triggerDownload(new Blob([doc],{type:"text/html"}), current.title+".html");
  });
})();

// ---- Site packs management (declarative JSON packs stored per device) -------
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var BUNDLED = ["blacklight", "dspace", "islandora", "omeka", "iiif"];
  var st = $("pack-status");
  if (!$("pack-list")) return; // section not present
  if ($("bundled-list")) $("bundled-list").textContent = "Bundled packs: " + BUNDLED.join(", ") + ".";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function withPacks(fn) { chrome.storage.local.get({ mdlaug_user_packs: [] }, function (s) { fn(s.mdlaug_user_packs || []); }); }
  function save(packs, msg) { chrome.storage.local.set({ mdlaug_user_packs: packs }, function () { st.textContent = msg || "Saved. Reload the target tab to apply."; render(); }); }
  function render() {
    try {
      withPacks(function (packs) {
        var list = $("pack-list");
        list.innerHTML = packs.length ? packs.map(function (p, i) {
          return '<div style="display:flex;gap:8px;align-items:center;border:1px solid #d7ddd8;border-radius:8px;padding:8px 10px;margin-bottom:6px">' +
            '<label style="flex:1"><input type="checkbox" data-i="' + i + '" class="pk-en"' + (p.enabled !== false ? " checked" : "") + '> <strong>' + esc(p.title || p.id) + '</strong> <span class="hint">(' + ((p.rules || []).length) + ' rule(s))</span></label>' +
            '<button data-i="' + i + '" class="pk-rm" style="background:transparent;color:#b1315e;border:1.5px solid #b1315e">Remove</button></div>';
        }).join("") : '<p class="hint">No custom packs yet.</p>';
        Array.prototype.forEach.call(list.querySelectorAll(".pk-en"), function (c) { c.addEventListener("change", function () { withPacks(function (p) { if (p[+c.getAttribute("data-i")]) { p[+c.getAttribute("data-i")].enabled = c.checked; save(p); } }); }); });
        Array.prototype.forEach.call(list.querySelectorAll(".pk-rm"), function (b) { b.addEventListener("click", function () { withPacks(function (p) { p.splice(+b.getAttribute("data-i"), 1); save(p, "Removed."); }); }); });
      });
    } catch (e) { st.textContent = "Available inside the extension only."; }
  }
  if ($("pack-add")) $("pack-add").addEventListener("click", function () {
    var raw = $("pack-json").value.trim();
    if (!raw) { st.textContent = "Paste a pack JSON first."; return; }
    var pack; try { pack = JSON.parse(raw); } catch (e) { st.textContent = "Invalid JSON: " + e.message; return; }
    if (!pack.id || !Array.isArray(pack.rules)) { st.textContent = "A pack needs an \"id\" and a \"rules\" array."; return; }
    withPacks(function (p) {
      var i = p.map(function (x) { return x.id; }).indexOf(pack.id);
      if (i > -1) p[i] = pack; else p.push(pack);
      save(p, "Added \u201C" + (pack.title || pack.id) + "\u201D. Reload the target tab to apply.");
      $("pack-json").value = "";
    });
  });
  render();
})();
