/*
 * mDLAUG storage resolver
 *
 * "It just works" by default: assessments save to a local in-browser database
 * (IndexedDB) that needs zero setup and uses the SAME logical schema as Turso.
 * Admins can switch the backend to a Turso database — either a local dev server
 * (`turso dev`, http://127.0.0.1:8080, no token) or a cloud database — without
 * changing anything else, because every backend implements one interface:
 *
 *   initSchema() -> Promise
 *   ping()       -> Promise<bool>
 *   saveAssessment(a) -> Promise<{id}>
 *   listAssessments({dlUrl?, limit?}) -> Promise<rows>
 *   getAssessment(id) -> Promise<{assessment, situations}>
 *   complianceByCode(dlUrl?) -> Promise<rows>
 *
 * Schema is versioned (SCHEMA_VERSION). Because both backends use the identical
 * table/field shape, a local database can be replayed into Turso later with no
 * translation. Keep schema changes ADDITIVE (new nullable columns / new object
 * stores) and bump SCHEMA_VERSION; CREATE IF NOT EXISTS / IndexedDB onupgrade
 * both handle additive growth cleanly.
 */
(function (root) {
  "use strict";

  var SCHEMA_VERSION = 1;
  var DB_NAME = "mdlaug";
  var STORES = ["assessment", "situation_result", "evidence"];

  function uuid() {
    var T = root.mDLAUG && root.mDLAUG.turso;
    if (T && T.uuid) return T.uuid();
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });
  }

  // ---- IndexedDB-backed local store (default) -----------------------------
  function LocalStore(opts) { opts = opts || {}; this.name = opts.name || DB_NAME; this._db = null; this.label = "This browser (local)"; }

  LocalStore.prototype._open = function () {
    var self = this;
    if (this._db) return Promise.resolve(this._db);
    return new Promise(function (resolve, reject) {
      var idb = root.indexedDB;
      if (!idb) return reject(new Error("IndexedDB unavailable"));
      var req = idb.open(self.name, SCHEMA_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains("assessment")) {
          var a = db.createObjectStore("assessment", { keyPath: "id" });
          a.createIndex("dl_url", "dl_url", { unique: false });
          a.createIndex("created_at", "created_at", { unique: false });
        }
        if (!db.objectStoreNames.contains("situation_result")) {
          var s = db.createObjectStore("situation_result", { keyPath: "id" });
          s.createIndex("assessment_id", "assessment_id", { unique: false });
        }
        if (!db.objectStoreNames.contains("evidence")) {
          var ev = db.createObjectStore("evidence", { keyPath: "id" });
          ev.createIndex("situation_result_id", "situation_result_id", { unique: false });
        }
      };
      req.onsuccess = function () { self._db = req.result; resolve(self._db); };
      req.onerror = function () { reject(req.error || new Error("open failed")); };
    });
  };
  LocalStore.prototype.initSchema = function () { return this._open().then(function () { return true; }); };
  LocalStore.prototype.ping = function () { return this._open().then(function () { return true; }).catch(function () { return false; }); };

  LocalStore.prototype.saveAssessment = function (a) {
    a = a || {};
    var self = this;
    return this._open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORES, "readwrite");
        var aid = uuid();
        tx.objectStore("assessment").put({
          id: aid, dl_name: a.dlName || "", dl_url: a.dlUrl || "", assessor: a.assessor || "",
          created_at: a.createdAt || new Date().toISOString(),
          user_agent: a.userAgent || (root.navigator && root.navigator.userAgent) || "",
          tool_version: a.toolVersion || "", overall_note: a.overallNote || "",
          auto_summary: a.autoSummary || null
        });
        (a.situations || []).forEach(function (s) {
          var sid = uuid();
          tx.objectStore("situation_result").put({
            id: sid, assessment_id: aid, code: s.code || "", level: s.level || "", title: s.title || "",
            compliance_score: (s.complianceScore == null ? null : s.complianceScore),
            auto_score: (s.autoScore == null ? null : s.autoScore),
            auto_findings: s.autoFindings || null, violations_note: s.violationsNote || "", good_note: s.goodNote || ""
          });
          (s.evidence || []).forEach(function (e) {
            tx.objectStore("evidence").put({ id: uuid(), situation_result_id: sid, kind: e.kind || "violation", filename: e.filename || "", note: e.note || "", image_base64: e.imageBase64 || null });
          });
        });
        tx.oncomplete = function () { resolve({ id: aid }); };
        tx.onerror = function () { reject(tx.error || new Error("save failed")); };
        tx.onabort = function () { reject(tx.error || new Error("save aborted")); };
      });
    });
  };

  LocalStore.prototype._all = function (store, index, key) {
    return this._open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var os = db.transaction(store, "readonly").objectStore(store);
        var src = index ? os.index(index) : os;
        var req = (index && key !== undefined) ? src.getAll(key) : src.getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  };
  LocalStore.prototype.listAssessments = function (opts) {
    opts = opts || {};
    return this._all("assessment").then(function (rows) {
      if (opts.dlUrl) rows = rows.filter(function (r) { return r.dl_url === opts.dlUrl; });
      rows.sort(function (x, y) { return (y.created_at || "").localeCompare(x.created_at || ""); });
      return rows.slice(0, opts.limit || 25);
    });
  };
  LocalStore.prototype.getAssessment = function (id) {
    var self = this;
    return this._all("assessment").then(function (as) {
      var head = as.filter(function (r) { return r.id === id; })[0] || null;
      return self._all("situation_result", "assessment_id", id).then(function (sits) {
        sits.sort(function (a, b) { return (a.code || "").localeCompare(b.code || ""); });
        return Promise.all(sits.map(function (s) {
          return self._all("evidence", "situation_result_id", s.id).then(function (ev) { s.evidence = ev; return s; });
        })).then(function (withEv) { return { assessment: head, situations: withEv }; });
      });
    });
  };
  LocalStore.prototype.complianceByCode = function (dlUrl) {
    var self = this;
    return this._all("assessment").then(function (as) {
      var okIds = {};
      as.forEach(function (a) { if (!dlUrl || a.dl_url === dlUrl) okIds[a.id] = 1; });
      return self._all("situation_result").then(function (sits) {
        var agg = {};
        sits.forEach(function (s) {
          if (!okIds[s.assessment_id]) return;
          if (s.compliance_score == null) return;
          var k = s.code;
          agg[k] = agg[k] || { code: s.code, level: s.level, sum: 0, n: 0 };
          agg[k].sum += s.compliance_score; agg[k].n++;
        });
        return Object.keys(agg).sort().map(function (k) { return { code: agg[k].code, level: agg[k].level, avg_score: agg[k].sum / agg[k].n, n: agg[k].n }; });
      });
    });
  };

  // ---- resolver -----------------------------------------------------------
  // cfg: { storage:"local"|"turso-local"|"turso-cloud", tursoUrl, tursoToken }
  function resolve(cfg) {
    cfg = cfg || {};
    var mode = cfg.storage || "local";
    var T = root.mDLAUG && root.mDLAUG.turso;
    if (mode === "turso-local") {
      if (!T) throw new Error("Turso client not loaded");
      var c = new T.TursoClient({ url: cfg.tursoUrl || "http://127.0.0.1:8080", token: cfg.tursoToken || "" });
      var s = new T.Store(c); s.label = "Turso local dev (" + (cfg.tursoUrl || "127.0.0.1:8080") + ")"; return s;
    }
    if (mode === "turso-cloud") {
      if (!T) throw new Error("Turso client not loaded");
      if (!cfg.tursoUrl || !cfg.tursoToken) throw new Error("Set the Turso cloud URL and token in settings.");
      var cc = new T.TursoClient({ url: cfg.tursoUrl, token: cfg.tursoToken });
      var sc = new T.Store(cc); sc.label = "Turso cloud"; return sc;
    }
    return new LocalStore(); // default
  }

  // The default storage config for this deployment: central (Turso via relay) if
  // config.js sets MDLAUG_CONFIG.centralUrl, otherwise a private local database.
  function defaultConfig() {
    var c = (root.MDLAUG_CONFIG) || {};
    if (c.centralUrl) return { storage: "turso-cloud", tursoUrl: c.centralUrl, tursoToken: c.centralToken || "" };
    return { storage: "local", tursoUrl: "", tursoToken: "" };
  }

  var api = { LocalStore: LocalStore, resolve: resolve, defaultConfig: defaultConfig, SCHEMA_VERSION: SCHEMA_VERSION, uuid: uuid, version: "0.9.0" };
  root.mDLAUG = root.mDLAUG || {};
  root.mDLAUG.store = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

})(typeof window !== "undefined" ? window : this);
