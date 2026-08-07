/* mDLAUG Repair — popup logic */
function tab(cb){ chrome.tabs.query({active:true,currentWindow:true},function(t){ cb(t[0]); }); }
function send(msg, cb){ tab(function(t){ chrome.tabs.sendMessage(t.id, msg, cb); }); }
(function initLauncherToggle(){
  var box=document.getElementById("showLauncher"); if(!box) return;
  try{ chrome.storage.sync.get({hideLauncher:false}, function(c){ box.checked=!c.hideLauncher; }); }catch(e){}
  box.addEventListener("change", function(){
    if(box.checked){ send({type:"mdlaug-show-launcher"}); try{chrome.storage.sync.set({hideLauncher:false});}catch(e){} }
    else { try{chrome.storage.sync.set({hideLauncher:true});}catch(e){} send({type:"mdlaug-undo"}); /* hide takes effect on next load or via page close button */ }
  });
})();

var runBtn = document.getElementById("run");
var reportEl = document.getElementById("report");

function render(report, count){
  if(!report || !report.length){ reportEl.innerHTML = count!=null ? "<p>"+count+" fixes applied.</p>" : ""; return; }
  var byCode = {};
  report.forEach(function(e){ (byCode[e.code]=byCode[e.code]||[]).push(e); });
  var out = ["<ul>"];
  Object.keys(byCode).forEach(function(code){
    var flag = byCode[code].some(function(m){return m.kind==="flag";});
    var msgs = byCode[code].map(function(m){return m.msg;}).join(" ");
    out.push("<li><span class='code'>"+code+"</span>"+(flag?"<span class='flag'>needs content</span>":"")+msgs+"</li>");
  });
  out.push("</ul>");
  reportEl.innerHTML = out.join("");
}

send({type:"mdlaug-status"}, function(res){
  if(chrome.runtime.lastError) return;
  if(res && res.on){ runBtn.textContent="Undo repairs"; runBtn.setAttribute("aria-pressed","true"); }
});

runBtn.addEventListener("click", function(){
  var on = runBtn.getAttribute("aria-pressed")==="true";
  if(on){
    send({type:"mdlaug-undo"}, function(){ runBtn.textContent="Repair this page"; runBtn.setAttribute("aria-pressed","false"); reportEl.innerHTML=""; });
  } else {
    send({type:"mdlaug-run"}, function(res){
      if(chrome.runtime.lastError){ reportEl.innerHTML="<p>Can't run on this page (browser-internal or blocked).</p>"; return; }
      runBtn.textContent="Undo repairs"; runBtn.setAttribute("aria-pressed","true");
      render(res && res.report, res && res.count);
    });
  }
});

document.getElementById("studio").addEventListener("click", function(){ chrome.runtime.openOptionsPage(); });
document.getElementById("dashboard").addEventListener("click", function(){ chrome.tabs.create({ url: chrome.runtime.getURL("ui/dashboard.html") }); });
document.getElementById("reader").addEventListener("click", function(){
  send({type:"mdlaug-reader"}, function(){ window.close(); });
});
document.getElementById("assess").addEventListener("click", function(){
  reportEl.innerHTML = "<p>Building audit…</p>";
  tab(function(t){
    chrome.tabs.sendMessage(t.id, {type:"mdlaug-assess"}, function(res){
      if(chrome.runtime.lastError || !res || !res.ok){ reportEl.innerHTML = "<p>Can't assess this page (browser-internal or blocked).</p>"; return; }
      var draft = { scorecard:res.scorecard, dlTitle:res.dlTitle||t.title, dlUrl:res.dlUrl||t.url, dlWindowId:t.windowId, capturedAt:Date.now() };
      chrome.storage.local.set({ mdlaug_draft: draft }, function(){
        chrome.tabs.create({ url: chrome.runtime.getURL("ui/assessment.html") });
        window.close();
      });
    });
  });
});

var auto = document.getElementById("autoRun");
chrome.storage.sync.get({autoRun:false}, function(cfg){ auto.checked = cfg.autoRun; });
auto.addEventListener("change", function(){ chrome.storage.sync.set({autoRun:auto.checked}); });
