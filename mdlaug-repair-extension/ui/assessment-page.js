(function(){
  var A = window.mDLAUG.assessment, TU = window.mDLAUG.turso;
  var main = document.getElementById("main"), status = document.getElementById("status");
  var GUIDE = {
    "ACC1":"https://sites.uwm.edu/mdlaug/acc-1-difficulty-directly-accessing-files/",
    "ACC2/COM3":"https://sites.uwm.edu/mdlaug/acc-2-com-4-difficulty-accessing-comprehending-images/"
  };
  var INDEX = "https://sites.uwm.edu/mdlaug/";
  var draft = null, cfg = { storage:"local", tursoUrl:"", tursoToken:"", assessor:"" };
  var evidence = {}; // code -> [ {kind,filename,note,imageBase64} ]

  function setStatus(t){ status.textContent = t; }
  function activeStore(){ return window.mDLAUG.store.resolve(cfg); }

  function load(){
    try{
      chrome.storage.local.get({ mdlaug_draft:null, mdlaug_store:null, mdlaug_turso:{url:"",token:"",assessor:""} }, function(s){
        if(s.mdlaug_store){ cfg = s.mdlaug_store; }
        else { var lg = s.mdlaug_turso || {}; cfg = { storage:(lg.url&&lg.token)?"turso-cloud":"local", tursoUrl:lg.url||"", tursoToken:lg.token||"", assessor:lg.assessor||"" }; }
        draft = s.mdlaug_draft;
        document.getElementById("m-assessor").value = cfg.assessor || "";
        if(!draft){ main.innerHTML =
          '<div class="warn"><strong>No audit loaded yet.</strong><br>To run one: <ol style="margin:8px 0 0 18px">'+
          '<li>Open the digital library you want to check, in another tab.</li>'+
          '<li>Click the mDLAUG toolbar icon.</li>'+
          '<li>Choose <strong>Audit this page</strong> — it fills in all 24 situations here, and <strong>Save audit</strong> (top-left) stores the result.</li>'+
          '</ol><p style="margin:10px 0 0">Storage defaults to this browser — no account needed. History of past audits appears below.</p></div>';
          renderHistory(); return; }
        document.getElementById("m-name").value = draft.dlTitle || "";
        document.getElementById("m-url").value = draft.dlUrl || "";
        renderCards(draft.scorecard);
      });
    }catch(e){ main.innerHTML = '<div class="warn">This page works inside the extension only.</div>'; }
  }

  function renderCards(card){
    main.innerHTML = "";
    card.forEach(function(s, idx){
      evidence[s.code] = evidence[s.code] || [];
      var el = document.createElement("section"); el.className="sit"; el.id="sit-"+idx;
      var link = GUIDE[s.code] || INDEX;
      var vList = s.violations.length ? "<ul>"+s.violations.map(function(v){return "<li>"+esc(v.msg)+(v.count>1?" (\u00d7"+v.count+")":"")+"</li>";}).join("")+"</ul>" : '<span class="none">None detected automatically.</span>';
      var gList = s.goodTechniques.length ? "<ul>"+s.goodTechniques.map(function(g){return "<li>"+esc(g.msg)+"</li>";}).join("")+"</ul>" : '<span class="none">None detected automatically.</span>';
      var scale = [1,2,3,4,5,6,7].map(function(n){
        var chk = (s.complianceScore===n)?" checked":"";
        return '<label><input type="radio" name="score-'+idx+'" value="'+n+'"'+chk+'>'+n+'</label>';
      }).join("");
      el.innerHTML =
        '<h2>'+s.code+'. '+esc(s.title)+'</h2>'+
        '<p class="sub"><span class="lvl '+s.level+'">Level '+s.level+'</span> <a href="'+link+'" target="_blank" rel="noopener">Read the guideline</a>'+
          (s.autoScore!=null?'<span class="auto-hint">suggested: '+s.autoScore+'/7</span>':'<span class="auto-hint">no auto signal — please judge</span>')+'</p>'+
        '<div class="auto"><div class="box v"><h3>Auto-detected violations (1.2)</h3>'+vList+'</div>'+
          '<div class="box g"><h3>Good techniques found (1.3)</h3>'+gList+'</div></div>'+
        '<div><strong style="font-size:13px">1.1 Compliance (1 = none, 7 = full)</strong>'+
          '<div class="scale"><span class="ends">Non-compliance</span>'+scale+'<span class="ends">Full compliance</span></div></div>'+
        '<label class="fld" for="vn-'+idx+'">1.2 Violations — notes</label><textarea id="vn-'+idx+'">'+esc(s.violationsNote||"")+'</textarea>'+
        '<label class="fld" for="gn-'+idx+'">1.3 Good techniques — notes</label><textarea id="gn-'+idx+'">'+esc(s.goodNote||"")+'</textarea>'+
        '<div class="drop" data-code="'+s.code+'" tabindex="0">Drop screenshots here, or click to choose — name them like <code>'+s.code.replace(/\W+/g,"_")+'_image1</code>.'+
          '<input type="file" accept="image/*" multiple hidden></div>'+
        '<div class="ev" id="ev-'+idx+'"></div>';
      main.appendChild(el);
      wireDrop(el.querySelector(".drop"), s.code, el.querySelector("#ev-"+idx));
    });
  }

  function wireDrop(drop, code, evBox){
    var input = drop.querySelector("input");
    drop.addEventListener("click", function(){ input.click(); });
    drop.addEventListener("keydown", function(e){ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); input.click(); } });
    ["dragover","dragenter"].forEach(function(t){ drop.addEventListener(t,function(e){e.preventDefault();drop.classList.add("drag");}); });
    ["dragleave","drop"].forEach(function(t){ drop.addEventListener(t,function(){drop.classList.remove("drag");}); });
    drop.addEventListener("drop", function(e){ e.preventDefault(); Array.prototype.forEach.call(e.dataTransfer.files, function(f){ addFile(f,code,evBox); }); });
    input.addEventListener("change", function(){ Array.prototype.forEach.call(input.files, function(f){ addFile(f,code,evBox); }); input.value=""; });
  }
  function addFile(file, code, evBox){
    if(!/^image\//.test(file.type)) return;
    var r = new FileReader();
    r.onload = function(){
      var item = { kind:"violation", filename:file.name, note:"", imageBase64:r.result };
      evidence[code].push(item); renderEvidence(code, evBox);
    };
    r.readAsDataURL(file);
  }
  function renderEvidence(code, evBox){
    evBox.innerHTML = "";
    evidence[code].forEach(function(it, i){
      var fig = document.createElement("figure");
      fig.innerHTML = '<img src="'+it.imageBase64+'" alt="">'+
        '<figcaption><button class="k'+(it.kind==="good"?" good":"")+'" title="toggle violation/good">'+(it.kind==="good"?"good":"violation")+'</button> '+esc(it.filename)+'</figcaption>';
      fig.querySelector("button").addEventListener("click", function(){ it.kind = it.kind==="good"?"violation":"good"; renderEvidence(code,evBox); });
      evBox.appendChild(fig);
    });
  }

  function gather(){
    var card = draft.scorecard.map(function(s, idx){
      var picked = document.querySelector('input[name="score-'+idx+'"]:checked');
      s.complianceScore = picked ? parseInt(picked.value,10) : (s.complianceScore==null?null:s.complianceScore);
      s.violationsNote = (document.getElementById("vn-"+idx)||{}).value || "";
      s.goodNote = (document.getElementById("gn-"+idx)||{}).value || "";
      s.evidence = evidence[s.code] || [];
      return s;
    });
    return A.toAssessment(card, {
      dlName: document.getElementById("m-name").value.trim(),
      dlUrl: document.getElementById("m-url").value.trim(),
      assessor: document.getElementById("m-assessor").value.trim(),
      toolVersion: (window.mDLAUG.remediator && window.mDLAUG.remediator.version) || ""
    });
  }

  document.getElementById("save").addEventListener("click", function(){
    if(!draft){ setStatus("Nothing to save."); return; }
    setStatus("Saving…");
    try{
      var store = activeStore();
      store.initSchema().then(function(){ return store.saveAssessment(gather()); })
        .then(function(res){ setStatus("Saved ✓ to " + (store.label||"local") + "  (" + res.id + ")"); })
        .catch(function(e){ setStatus("Save failed: "+e.message); });
    }catch(e){ setStatus(e.message); }
  });
  document.getElementById("test").addEventListener("click", function(){
    setStatus("Checking storage…");
    try{ var store = activeStore(); store.initSchema().then(function(){ return store.ping(); })
      .then(function(ok){ setStatus(ok ? ("Ready ✓ — " + (store.label||"local")) : "Reachable, unexpected reply."); })
      .catch(function(e){ setStatus("Not reachable: "+e.message); }); }
    catch(e){ setStatus(e.message); }
  });
  document.getElementById("settings").addEventListener("click", function(){ chrome.runtime.openOptionsPage(); });
  document.getElementById("history").addEventListener("click", function(){ renderHistory(true); });

  function renderHistory(force){
    setStatus("Loading history…");
    var store;
    try{ store = activeStore(); }catch(e){ if(force) setStatus(e.message); return; }
    var url = document.getElementById("m-url").value.trim() || (draft && draft.dlUrl) || "";
    store.listAssessments({ dlUrl: url || undefined, limit:25 }).then(function(rows){
      setStatus(rows.length+" past assessment(s).");
      var div = document.createElement("section"); div.className="hist";
      div.innerHTML = "<h2 style='font-size:15px;margin:0 0 8px'>Past assessments"+(url?" for this DL":"")+"</h2>"+
        (rows.length? "<table><thead><tr><th>When</th><th>Library</th><th>Assessor</th></tr></thead><tbody>"+
          rows.map(function(r){return "<tr><td>"+esc((r.created_at||"").slice(0,16).replace('T',' '))+"</td><td>"+esc(r.dl_name||r.dl_url||"")+"</td><td>"+esc(r.assessor||"")+"</td></tr>";}).join("")+"</tbody></table>"
          : "<p>None yet.</p>");
      main.insertBefore(div, main.firstChild);
    }).catch(function(e){ setStatus("History failed: "+e.message); });
  }

  function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];}); }
  load();
})();
