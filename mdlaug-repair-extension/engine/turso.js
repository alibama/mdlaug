/*
 * mDLAUG Turso store
 *
 * A tiny client for Turso / libSQL's HTTP "pipeline" API (v2). It lets the
 * extension persist accessibility assessments to the user's own edge database
 * with no server of its own.
 *
 *   POST {dbUrl}/v2/pipeline
 *   Authorization: Bearer <token>
 *   { requests:[ {type:"execute", stmt:{sql, args:[{type,value}...]}}, {type:"close"} ] }
 *
 * The schema mirrors the mDLAUG assessment survey: one ASSESSMENT per review of
 * a digital library, one SITUATION_RESULT per help-seeking situation (ACC1, …)
 * carrying the 1–7 compliance score plus the tool's auto findings, and EVIDENCE
 * rows for the violation / good-technique screenshots.
 *
 * Ids are generated client-side (uuid TEXT keys) so a whole assessment — parent,
 * its situations, and their evidence — can be written as ONE atomic
 * BEGIN…COMMIT batch without needing last_insert_rowid round-trips.
 *
 * SECURITY: the auth token is a database credential. The host stores it in
 * chrome.storage.local (device-local, never synced) and the extension talks to
 * Turso directly. For a shared/production deployment, front Turso with a thin
 * relay that holds the token server-side and let this client point at the relay
 * instead — the request shape is identical.
 */
(function (root) {
  "use strict";

  function uuid() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0, v = c === "x" ? r : (r & 0x3) | 0x8; return v.toString(16);
    });
  }

  function normalizeUrl(u) {
    if (!u) return "";
    u = String(u).trim().replace(/\/+$/, "");
    if (/^libsql:\/\//i.test(u)) u = u.replace(/^libsql:\/\//i, "https://");
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    return u;
  }

  function encVal(v) {
    if (v === null || v === undefined) return { type: "null" };
    if (typeof v === "boolean") return { type: "integer", value: v ? "1" : "0" };
    if (typeof v === "number") return Number.isInteger(v) ? { type: "integer", value: String(v) } : { type: "float", value: v };
    if (v && typeof v === "object" && v.__blob != null) return { type: "blob", base64: v.__blob };
    return { type: "text", value: String(v) };
  }
  function decVal(cell) {
    if (!cell) return null;
    switch (cell.type) {
      case "null": return null;
      case "integer": return parseInt(cell.value, 10);
      case "float": return typeof cell.value === "number" ? cell.value : parseFloat(cell.value);
      case "text": return cell.value;
      case "blob": return cell.base64 != null ? cell.base64 : cell.value;
      default: return cell.value != null ? cell.value : null;
    }
  }

  function TursoClient(opts) {
    opts = opts || {};
    this.url = normalizeUrl(opts.url);
    this.token = opts.token || "";
    this._fetch = opts.fetch || (root.fetch && root.fetch.bind(root));
    if (!this._fetch) throw new Error("No fetch available");
  }

  // Run a pipeline of {sql, args} statements on one connection, in order.
  TursoClient.prototype._pipeline = function (stmts) {
    var self = this;
    var requests = stmts.map(function (s) {
      return { type: "execute", stmt: { sql: s.sql, args: (s.args || []).map(encVal) } };
    });
    requests.push({ type: "close" });
    return this._fetch(this.url + "/v2/pipeline", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + this.token
      },
      body: JSON.stringify({ requests: requests })
    }).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { throw new Error("Turso HTTP " + res.status + ": " + (t || res.statusText)); });
      return res.json();
    }).then(function (body) {
      var out = [];
      (body.results || []).forEach(function (r, i) {
        if (i >= stmts.length) return; // the trailing close
        if (r.type === "error") throw new Error("SQL error: " + (r.error && r.error.message || "unknown") + " [" + stmts[i].sql.slice(0, 60) + "]");
        var result = r.response && r.response.result;
        out.push(self._decodeResult(result));
      });
      return out;
    });
  };
  TursoClient.prototype._decodeResult = function (result) {
    if (!result) return { rows: [], affected: 0 };
    var cols = (result.cols || []).map(function (c) { return c.name; });
    var rows = (result.rows || []).map(function (row) {
      var o = {};
      row.forEach(function (cell, i) { o[cols[i]] = decVal(cell); });
      return o;
    });
    return {
      rows: rows,
      cols: cols,
      affected: result.affected_row_count || 0,
      lastRowid: result.last_insert_rowid != null ? result.last_insert_rowid : null
    };
  };
  TursoClient.prototype.exec = function (sql, args) {
    return this._pipeline([{ sql: sql, args: args || [] }]).then(function (r) { return r[0]; });
  };
  TursoClient.prototype.batch = function (stmts) { return this._pipeline(stmts); };
  // wrap statements in a transaction
  TursoClient.prototype.transaction = function (stmts) {
    var wrapped = [{ sql: "BEGIN" }].concat(stmts, [{ sql: "COMMIT" }]);
    return this._pipeline(wrapped);
  };
  TursoClient.prototype.ping = function () { return this.exec("select 1 as ok").then(function (r) { return r.rows[0] && r.rows[0].ok === 1; }); };

  // ---- schema -------------------------------------------------------------
  var SCHEMA = [
    "CREATE TABLE IF NOT EXISTS assessment (" +
      "id TEXT PRIMARY KEY, dl_name TEXT, dl_url TEXT, assessor TEXT," +
      "created_at TEXT, user_agent TEXT, tool_version TEXT," +
      "overall_note TEXT, auto_summary TEXT)",
    "CREATE TABLE IF NOT EXISTS situation_result (" +
      "id TEXT PRIMARY KEY, assessment_id TEXT NOT NULL," +
      "code TEXT, level TEXT, title TEXT," +
      "compliance_score INTEGER, auto_score INTEGER," +
      "auto_findings TEXT, violations_note TEXT, good_note TEXT," +
      "FOREIGN KEY(assessment_id) REFERENCES assessment(id))",
    "CREATE TABLE IF NOT EXISTS evidence (" +
      "id TEXT PRIMARY KEY, situation_result_id TEXT NOT NULL," +
      "kind TEXT, filename TEXT, note TEXT, image_base64 TEXT," +
      "FOREIGN KEY(situation_result_id) REFERENCES situation_result(id))",
    "CREATE INDEX IF NOT EXISTS idx_sr_assessment ON situation_result(assessment_id)",
    "CREATE INDEX IF NOT EXISTS idx_ev_sr ON evidence(situation_result_id)",
    "CREATE INDEX IF NOT EXISTS idx_assessment_url ON assessment(dl_url)"
  ];

  function Store(client) { this.c = client; }
  Store.prototype.initSchema = function () { return this.c.batch(SCHEMA.map(function (s) { return { sql: s }; })); };
  Store.prototype.ping = function () { return this.c.ping(); };

  // Persist a full assessment atomically. `a` shape:
  // { dlName, dlUrl, assessor, overallNote, toolVersion, autoSummary,
  //   situations:[ { code, level, title, complianceScore, autoScore, autoFindings,
  //                  violationsNote, goodNote,
  //                  evidence:[ { kind, filename, note, imageBase64 } ] } ] }
  Store.prototype.saveAssessment = function (a) {
    a = a || {};
    var aid = uuid();
    var stmts = [];
    stmts.push({
      sql: "INSERT INTO assessment (id,dl_name,dl_url,assessor,created_at,user_agent,tool_version,overall_note,auto_summary)" +
        " VALUES (?,?,?,?,?,?,?,?,?)",
      args: [aid, a.dlName || "", a.dlUrl || "", a.assessor || "",
        a.createdAt || new Date().toISOString(),
        a.userAgent || (root.navigator && root.navigator.userAgent) || "",
        a.toolVersion || "", a.overallNote || "",
        a.autoSummary ? JSON.stringify(a.autoSummary) : null]
    });
    (a.situations || []).forEach(function (s) {
      var sid = uuid();
      stmts.push({
        sql: "INSERT INTO situation_result (id,assessment_id,code,level,title,compliance_score,auto_score,auto_findings,violations_note,good_note)" +
          " VALUES (?,?,?,?,?,?,?,?,?,?)",
        args: [sid, aid, s.code || "", s.level || "", s.title || "",
          (s.complianceScore == null ? null : s.complianceScore),
          (s.autoScore == null ? null : s.autoScore),
          s.autoFindings ? JSON.stringify(s.autoFindings) : null,
          s.violationsNote || "", s.goodNote || ""]
      });
      (s.evidence || []).forEach(function (e) {
        stmts.push({
          sql: "INSERT INTO evidence (id,situation_result_id,kind,filename,note,image_base64) VALUES (?,?,?,?,?,?)",
          args: [uuid(), sid, e.kind || "violation", e.filename || "", e.note || "", e.imageBase64 || null]
        });
      });
    });
    return this.c.transaction(stmts).then(function () { return { id: aid, statements: stmts.length }; });
  };

  Store.prototype.listAssessments = function (opts) {
    opts = opts || {};
    var sql = "SELECT id,dl_name,dl_url,assessor,created_at,tool_version FROM assessment";
    var args = [];
    if (opts.dlUrl) { sql += " WHERE dl_url = ?"; args.push(opts.dlUrl); }
    sql += " ORDER BY created_at DESC LIMIT ?";
    args.push(opts.limit || 25);
    return this.c.exec(sql, args).then(function (r) { return r.rows; });
  };
  Store.prototype.getAssessment = function (id) {
    var c = this.c;
    return c.batch([
      { sql: "SELECT * FROM assessment WHERE id = ?", args: [id] },
      { sql: "SELECT * FROM situation_result WHERE assessment_id = ? ORDER BY code", args: [id] }
    ]).then(function (res) {
      var head = res[0].rows[0] || null;
      var sits = res[1].rows;
      if (!sits.length) return { assessment: head, situations: [] };
      var ids = sits.map(function (s) { return s.id; });
      var placeholders = ids.map(function () { return "?"; }).join(",");
      return c.exec("SELECT * FROM evidence WHERE situation_result_id IN (" + placeholders + ")", ids)
        .then(function (ev) {
          var byS = {};
          ev.rows.forEach(function (e) { (byS[e.situation_result_id] = byS[e.situation_result_id] || []).push(e); });
          sits.forEach(function (s) { s.evidence = byS[s.id] || []; if (s.auto_findings) { try { s.auto_findings = JSON.parse(s.auto_findings); } catch (e) {} } });
          return { assessment: head, situations: sits };
        });
    });
  };
  // Aggregate scores across the most recent assessment per DL (a leaderboard/trend feed).
  Store.prototype.complianceByCode = function (dlUrl) {
    return this.c.exec(
      "SELECT sr.code, sr.level, AVG(sr.compliance_score) AS avg_score, COUNT(*) AS n" +
      " FROM situation_result sr JOIN assessment a ON a.id = sr.assessment_id" +
      (dlUrl ? " WHERE a.dl_url = ?" : "") +
      " GROUP BY sr.code, sr.level ORDER BY sr.code",
      dlUrl ? [dlUrl] : []
    ).then(function (r) { return r.rows; });
  };

  var api = {
    TursoClient: TursoClient,
    Store: Store,
    SCHEMA: SCHEMA,
    uuid: uuid,
    normalizeUrl: normalizeUrl,
    version: "0.9.0"
  };
  root.mDLAUG = root.mDLAUG || {};
  root.mDLAUG.turso = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

})(typeof window !== "undefined" ? window : this);
