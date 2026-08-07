/* mDLAUG Repair — service worker: badge + best-effort file-size lookup */
chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
  if (msg.type === "mdlaug-count") {
    var tabId = sender.tab && sender.tab.id;
    if (tabId != null) {
      chrome.action.setBadgeText({ tabId: tabId, text: msg.count ? String(msg.count) : "" });
      chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: "#1f9e8f" });
    }
  } else if (msg.type === "mdlaug-headsize") {
    // content scripts can't always read cross-origin Content-Length; do it here
    fetch(msg.url, { method: "HEAD" })
      .then(function (r) { reply({ size: r.headers.get("content-length") }); })
      .catch(function () { reply({ size: null }); });
    return true; // async
  } else if (msg.type === "mdlaug-capture") {
    // capture the visible area of the requesting tab's window (evidence screenshots)
    var winId = (sender.tab && sender.tab.windowId);
    var doCapture = function (wid) {
      chrome.tabs.captureVisibleTab(wid, { format: "png" }, function (dataUrl) {
        if (chrome.runtime.lastError) reply({ error: chrome.runtime.lastError.message });
        else reply({ dataUrl: dataUrl });
      });
    };
    if (winId != null) doCapture(winId);
    else chrome.windows.getLastFocused(function (w) { doCapture(w && w.id); });
    return true; // async
  } else if (msg.type === "mdlaug-fetch-bytes") {
    // Fetch a linked file's bytes for on-page conversion. The background can read
    // cross-origin responses (host_permissions), and we upgrade http->https first
    // so an http file on an https page doesn't hit the mixed-content block.
    var tries = [];
    if (/^http:\/\//i.test(msg.url)) tries.push(msg.url.replace(/^http:/i, "https:"));
    tries.push(msg.url);
    (function attempt(i) {
      if (i >= tries.length) { reply({ ok: false, error: "could not fetch file (cross-origin or unreachable)" }); return; }
      fetch(tries[i]).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.arrayBuffer();
      }).then(function (buf) {
        var bytes = new Uint8Array(buf), bin = "", CH = 0x8000;
        for (var j = 0; j < bytes.length; j += CH) bin += String.fromCharCode.apply(null, bytes.subarray(j, j + CH));
        reply({ ok: true, b64: btoa(bin), url: tries[i] });
      }).catch(function () { attempt(i + 1); });
    })(0);
    return true; // async
  } else if (msg.type === "mdlaug-inject") {
    // Inject a bundled library (e.g. mammoth) into the SAME isolated world the
    // content scripts run in, so the converter can see window.<lib>. This avoids
    // the page's CSP (which blocks injecting a <script> into the page) and the
    // isolated/main-world split that leaves root.<lib> undefined.
    var itab = sender.tab && sender.tab.id;
    if (itab == null) { reply({ ok: false, error: "no tab" }); return true; }
    chrome.scripting.executeScript({ target: { tabId: itab }, files: msg.files, world: "ISOLATED" })
      .then(function () { reply({ ok: true }); })
      .catch(function (e) { reply({ ok: false, error: String(e && e.message || e) }); });
    return true; // async
  } else if (msg.type === "mdlaug-open-assessment") {
    chrome.tabs.create({ url: chrome.runtime.getURL("ui/assessment.html") });
  }
});
