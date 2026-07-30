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
  } else if (msg.type === "mdlaug-open-assessment") {
    chrome.tabs.create({ url: chrome.runtime.getURL("ui/assessment.html") });
  }
});
