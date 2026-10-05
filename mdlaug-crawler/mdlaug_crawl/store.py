"""SQLite store. Everything the pipeline decides is recorded with *how* it decided
(method, confidence, evidence) so reviewers can correct it and we can measure which
checks need improvement (reviewer agreement per check/method)."""
import json
import sqlite3
import threading
import time
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs(
  id INTEGER PRIMARY KEY, started REAL, finished REAL, status TEXT,
  config TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS sites(
  id INTEGER PRIMARY KEY, collection_url TEXT UNIQUE, platform TEXT,
  library_type TEXT, institution TEXT, library_page TEXT, listings TEXT);
CREATE TABLE IF NOT EXISTS pages(
  id INTEGER PRIMARY KEY, run_id INTEGER, site_id INTEGER, url TEXT, final_url TEXT,
  page_type TEXT, type_method TEXT, type_confidence REAL, status TEXT, http_status INTEGER,
  title TEXT, device TEXT, load_ms INTEGER, screenshot TEXT, error TEXT, ts REAL);
CREATE TABLE IF NOT EXISTS findings(
  id INTEGER PRIMARY KEY, run_id INTEGER, site_id INTEGER, page_id INTEGER,
  code TEXT, check_id TEXT, method TEXT, outcome TEXT, score INTEGER,
  confidence REAL, needs_review INTEGER, message TEXT, evidence TEXT, ts REAL);
CREATE TABLE IF NOT EXISTS llm_calls(
  id INTEGER PRIMARY KEY, run_id INTEGER, site_id INTEGER, page_id INTEGER, task TEXT,
  model TEXT, prompt_hash TEXT, input_chars INTEGER, latency_ms INTEGER, ok INTEGER,
  raw TEXT, parsed TEXT, error TEXT, cached INTEGER, ts REAL);
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY, run_id INTEGER, ts REAL, level TEXT, site_id INTEGER,
  page_id INTEGER, stage TEXT, message TEXT, data TEXT, duration_ms INTEGER);
CREATE TABLE IF NOT EXISTS reviews(
  id INTEGER PRIMARY KEY, finding_id INTEGER, reviewer TEXT, decision TEXT,
  score INTEGER, issue_tag TEXT, note TEXT, ts REAL);
CREATE TABLE IF NOT EXISTS site_reviews(
  id INTEGER PRIMARY KEY, run_id INTEGER, site_id INTEGER, code TEXT, reviewer TEXT,
  final_score INTEGER, note TEXT, ts REAL);
CREATE TABLE IF NOT EXISTS settings(
  key TEXT PRIMARY KEY, value TEXT, updated REAL, updated_by TEXT);
CREATE TABLE IF NOT EXISTS settings_history(
  id INTEGER PRIMARY KEY, key TEXT, value TEXT, updated REAL, updated_by TEXT);
CREATE INDEX IF NOT EXISTS ix_find_site ON findings(run_id, site_id, code);
CREATE INDEX IF NOT EXISTS ix_ev_run ON events(run_id, stage);
"""

# Tags a reviewer can attach when the pipeline got something wrong — these drive the
# "workflow improvement" view.
ISSUE_TAGS = ["", "wrong page type", "selector missed element", "false positive",
              "false negative", "LLM wrong", "LLM low-quality rationale",
              "site blocked / failed to load", "needs mobile re-check", "other"]


class Store:
    def __init__(self, path, jsonl_dir=None):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._lock = threading.Lock()
        self.db = sqlite3.connect(path, check_same_thread=False, timeout=30)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)
        self._migrate()
        self.db.commit()
        self.jsonl_dir = jsonl_dir
        self._jsonl = None

    # columns added after the first release — existing databases are upgraded in place
    MIGRATIONS = {"sites": [("active", "INTEGER DEFAULT 1"), ("note", "TEXT"), ("added", "REAL")],
                  "pages": [("annotations", "TEXT"), ("fullshot", "TEXT"), ("annotated", "TEXT"),
                            ("remediation", "TEXT"), ("aftershot", "TEXT"), ("after_annotated", "TEXT")],
                  "reviews": [("exemplar", "TEXT")],
                  "llm_calls": [("prompt_version", "TEXT"), ("prompt", "TEXT"), ("role", "TEXT"), ("replay_of", "INTEGER")]}

    def _migrate(self):
        for table, cols in self.MIGRATIONS.items():
            have = {r[1] for r in self.db.execute(f"PRAGMA table_info({table})")}
            for name, typ in cols:
                if name not in have:
                    self.db.execute(f"ALTER TABLE {table} ADD COLUMN {name} {typ}")

    # -- settings (editable checks / prompts), with history -----------------
    def get_settings(self, prefix=""):
        return self.query("SELECT * FROM settings WHERE key LIKE ?", (prefix + "%",))

    def get_setting(self, key, default=None):
        r = self.query("SELECT value FROM settings WHERE key=?", (key,))
        return r[0]["value"] if r else default

    def set_setting(self, key, value, who=""):
        ts = time.time()
        self._exec("INSERT INTO settings(key,value,updated,updated_by) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE "
                   "SET value=excluded.value, updated=excluded.updated, updated_by=excluded.updated_by",
                   (key, value, ts, who))
        self._exec("INSERT INTO settings_history(key,value,updated,updated_by) VALUES(?,?,?,?)", (key, value, ts, who))

    def delete_setting(self, key, who=""):
        self._exec("DELETE FROM settings WHERE key=?", (key,))
        self._exec("INSERT INTO settings_history(key,value,updated,updated_by) VALUES(?,?,?,?)",
                   (key, None, time.time(), who))

    # -- helpers ----------------------------------------------------------
    def _exec(self, sql, args=()):
        with self._lock:
            cur = self.db.execute(sql, args)
            self.db.commit()
            return cur.lastrowid

    def query(self, sql, args=()):
        with self._lock:
            return [dict(r) for r in self.db.execute(sql, args).fetchall()]

    # -- runs -------------------------------------------------------------
    def start_run(self, config, note=""):
        rid = self._exec("INSERT INTO runs(started,status,config,note) VALUES(?,?,?,?)",
                         (time.time(), "running", json.dumps(config, default=str), note))
        if self.jsonl_dir:
            Path(self.jsonl_dir).mkdir(parents=True, exist_ok=True)
            self._jsonl = open(Path(self.jsonl_dir) / f"run-{rid}.jsonl", "a", encoding="utf-8")
        return rid

    def finish_run(self, run_id, status="done"):
        self._exec("UPDATE runs SET finished=?, status=? WHERE id=?", (time.time(), status, run_id))
        if self._jsonl:
            self._jsonl.close(); self._jsonl = None

    # -- sites / pages ----------------------------------------------------
    def set_site_active(self, site_id, active):
        self._exec("UPDATE sites SET active=? WHERE id=?", (1 if active else 0, site_id))

    def upsert_site(self, s):
        self._exec(
            "INSERT INTO sites(collection_url,platform,library_type,institution,library_page,listings) "
            "VALUES(?,?,?,?,?,?) ON CONFLICT(collection_url) DO UPDATE SET platform=excluded.platform, "
            "library_type=excluded.library_type, institution=excluded.institution, "
            "library_page=excluded.library_page, listings=excluded.listings",
            (s["collection_url"], s["platform"], s["library_type"], s["institution"],
             s.get("library_page", ""), json.dumps(s.get("listings", []))))
        return self.query("SELECT id FROM sites WHERE collection_url=?", (s["collection_url"],))[0]["id"]

    def add_page(self, run_id, site_id, **kw):
        cols = ["run_id", "site_id", "ts"] + list(kw)
        vals = [run_id, site_id, time.time()] + list(kw.values())
        return self._exec(f"INSERT INTO pages({','.join(cols)}) VALUES({','.join('?' * len(cols))})", vals)

    def update_page(self, page_id, **kw):
        sets = ",".join(f"{k}=?" for k in kw)
        self._exec(f"UPDATE pages SET {sets} WHERE id=?", list(kw.values()) + [page_id])

    # -- findings ---------------------------------------------------------
    def add_finding(self, run_id, site_id, page_id, code, check_id, method, outcome,
                    score=None, confidence=1.0, needs_review=False, message="", evidence=None):
        return self._exec(
            "INSERT INTO findings(run_id,site_id,page_id,code,check_id,method,outcome,score,"
            "confidence,needs_review,message,evidence,ts) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (run_id, site_id, page_id, code, check_id, method, outcome, score, confidence,
             1 if needs_review else 0, message, json.dumps(evidence or {}, default=str), time.time()))

    # -- logging ----------------------------------------------------------
    def log(self, run_id, stage, message, level="info", site_id=None, page_id=None,
            data=None, duration_ms=None):
        ts = time.time()
        self._exec("INSERT INTO events(run_id,ts,level,site_id,page_id,stage,message,data,duration_ms) "
                   "VALUES(?,?,?,?,?,?,?,?,?)",
                   (run_id, ts, level, site_id, page_id, stage, message,
                    json.dumps(data or {}, default=str), duration_ms))
        if self._jsonl:
            self._jsonl.write(json.dumps({"ts": ts, "run": run_id, "level": level, "site": site_id,
                                          "page": page_id, "stage": stage, "msg": message,
                                          "ms": duration_ms, "data": data}, default=str) + "\n")
            self._jsonl.flush()

    def log_llm(self, **kw):
        kw.setdefault("ts", time.time())
        cols = list(kw)
        return self._exec(f"INSERT INTO llm_calls({','.join(cols)}) VALUES({','.join('?' * len(cols))})",
                          list(kw.values()))

    def cached_llm(self, prompt_hash, model):
        r = self.query("SELECT parsed FROM llm_calls WHERE prompt_hash=? AND model=? AND ok=1 "
                       "ORDER BY id DESC LIMIT 1", (prompt_hash, model))
        return json.loads(r[0]["parsed"]) if r else None

    # -- reviews ----------------------------------------------------------
    def add_review(self, finding_id, reviewer, decision, score=None, issue_tag="", note="", exemplar=""):
        return self._exec("INSERT INTO reviews(finding_id,reviewer,decision,score,issue_tag,note,ts,exemplar) "
                          "VALUES(?,?,?,?,?,?,?,?)",
                          (finding_id, reviewer, decision, score, issue_tag, note, time.time(), exemplar or ""))

    def exemplars(self, code, limit=4):
        """Reviewer-marked good/bad examples for a situation (newest first)."""
        return self.query(
            "SELECT r.exemplar, r.note, r.score AS review_score, f.score AS auto_score, f.message, f.evidence, "
            "f.page_id, f.check_id, s.institution, p.final_url FROM reviews r JOIN findings f ON f.id=r.finding_id "
            "JOIN sites s ON s.id=f.site_id LEFT JOIN pages p ON p.id=f.page_id "
            "WHERE f.code=? AND r.exemplar IN ('good','bad') ORDER BY r.id DESC LIMIT ?", (code, limit))

    def set_site_score(self, run_id, site_id, code, reviewer, final_score, note=""):
        self._exec("DELETE FROM site_reviews WHERE run_id=? AND site_id=? AND code=?", (run_id, site_id, code))
        return self._exec("INSERT INTO site_reviews(run_id,site_id,code,reviewer,final_score,note,ts) "
                          "VALUES(?,?,?,?,?,?,?)",
                          (run_id, site_id, code, reviewer, final_score, note, time.time()))
