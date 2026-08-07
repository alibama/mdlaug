/*
 * mDLAUG Compute Manager
 *
 * Several mDLAUG remedies need real compute that is too heavy to run eagerly on
 * every element of every page:
 *   - OCR of scanned/image-only files & image-of-text (ACC1, ACC2/COM3)
 *   - describing images that ship no alt text            (ACC2/COM3)
 *   - describing/《explaining》 graphs & charts            (ACC3/COM4)
 *   - reflowing large PDFs into a linear reading order    (ACC1, NAV4)
 *
 * This module turns those into *managed jobs*: each capability is a pluggable
 * PROVIDER; jobs run through one queue with a concurrency cap; a BUDGET POLICY
 * decides whether a job runs automatically, waits for an explicit tap, or is
 * skipped; results are CACHED (keyed by content hash) so the same image is
 * never described twice; and every state change emits an event so a manager UI
 * can show queued / running / done / failed and let the user cancel.
 *
 * We never fabricate descriptions and present them as authored: provider output
 * is always tagged { generated:true, verified:false } so the UI can label it as
 * an unverified machine description the author still needs to confirm.
 *
 * Design intent: a provider can be (a) a bundled local engine (e.g. Tesseract
 * WASM for OCR), (b) a user-configured local/remote endpoint (e.g. an
 * OpenAI-compatible vision model on the user's own machine — ideal for a
 * privacy-preserving self-hosted setup), or (c) absent, in which case the
 * capability degrades to a flag rather than an error.
 */
(function (root) {
  "use strict";

  // ---- tiny event emitter -------------------------------------------------
  function Emitter() { this._l = {}; }
  Emitter.prototype.on = function (t, fn) { (this._l[t] = this._l[t] || []).push(fn); return this; };
  Emitter.prototype.off = function (t, fn) { this._l[t] = (this._l[t] || []).filter(function (f) { return f !== fn; }); };
  Emitter.prototype.emit = function (t, d) { (this._l[t] || []).slice().forEach(function (f) { try { f(d); } catch (e) {} }); };

  // ---- content hashing for the cache (FNV-1a, stable & cheap) -------------
  function hash(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
    return ("0000000" + h.toString(16)).slice(-8);
  }

  var CAPS = ["ocr", "describeImage", "describeGraph", "reflowPdf", "transcribe"];

  function ComputeManager() {
    Emitter.call(this);
    this.providers = {};              // cap -> { name, run(input, ctx), available() }
    this.policy = {};                 // cap -> "auto" | "ask" | "off"
    CAPS.forEach(function (c) { this.policy[c] = (c === "reflowPdf" ? "auto" : "ask"); }, this);
    this.concurrency = 2;
    this.cache = {};                  // key -> result
    this.jobs = [];                   // all jobs (queued/running/done/failed)
    this._running = 0;
    this._seq = 0;
  }
  ComputeManager.prototype = Object.create(Emitter.prototype);

  ComputeManager.prototype.configure = function (opts) {
    opts = opts || {};
    if (opts.policy) { var p = this.policy; Object.keys(opts.policy).forEach(function (k) { p[k] = opts.policy[k]; }); }
    if (typeof opts.concurrency === "number") this.concurrency = Math.max(1, opts.concurrency | 0);
    return this;
  };

  // Register a provider for a capability.
  //   run(input, ctx) -> Promise<result>; ctx.progress(fraction, note), ctx.signal (AbortSignal)
  //   available() -> boolean (is the engine/endpoint actually usable right now?)
  ComputeManager.prototype.registerProvider = function (cap, provider) {
    if (CAPS.indexOf(cap) === -1) throw new Error("Unknown capability: " + cap);
    this.providers[cap] = provider;
    this.emit("providers", this.status());
    return this;
  };
  ComputeManager.prototype.hasProvider = function (cap) {
    var p = this.providers[cap];
    if (!p) return false;
    try { return p.available ? !!p.available() : true; } catch (e) { return false; }
  };

  ComputeManager.prototype.status = function () {
    var self = this;
    return {
      concurrency: this.concurrency,
      running: this._running,
      queued: this.jobs.filter(function (j) { return j.state === "queued"; }).length,
      capabilities: CAPS.map(function (c) {
        return {
          cap: c,
          provider: self.providers[c] ? (self.providers[c].name || "provider") : null,
          available: self.hasProvider(c),
          policy: self.policy[c]
        };
      }),
      jobs: this.jobs.map(function (j) {
        return { id: j.id, cap: j.cap, label: j.label, state: j.state, progress: j.progress, note: j.note, error: j.error, cached: j.cached };
      })
    };
  };

  // Enqueue a job. Returns a job handle whose .promise resolves with the result
  // (or rejects). If the capability is cached, resolves synchronously-ish from
  // cache. If policy is "off" or no provider, resolves with { skipped:true }.
  // If policy is "ask", the job is parked in state "held" until run(id) is called.
  ComputeManager.prototype.enqueue = function (cap, input, meta) {
    var self = this;
    meta = meta || {};
    var key = cap + ":" + (meta.key || hash(String(input && input.hashSource != null ? input.hashSource : (input && input.text) || (input && input.src) || JSON.stringify(input))));
    var job = {
      id: "job_" + (++this._seq), cap: cap, label: meta.label || cap, key: key,
      input: input, state: "queued", progress: 0, note: "", error: null, cached: false, _abort: null
    };

    // cache hit
    if (this.cache[key]) {
      job.state = "done"; job.progress = 1; job.cached = true; job.result = this.cache[key];
      this.jobs.push(job); this.emit("job", job); this.emit("status", this.status());
      job.promise = Promise.resolve(this.cache[key]);
      return job;
    }
    // no usable provider or turned off -> degrade to a flag
    if (!this.hasProvider(cap) || this.policy[cap] === "off") {
      job.state = "skipped"; job.note = !this.hasProvider(cap) ? "no provider configured" : "turned off";
      this.jobs.push(job); this.emit("job", job); this.emit("status", this.status());
      job.promise = Promise.resolve({ skipped: true, reason: job.note });
      return job;
    }

    job.promise = new Promise(function (resolve, reject) { job._resolve = resolve; job._reject = reject; });
    this.jobs.push(job);

    if (this.policy[cap] === "ask") {
      job.state = "held"; job.note = "waiting for you to run it";
      this.emit("job", job); this.emit("status", this.status());
    } else { // auto
      this._pump();
    }
    return job;
  };

  // Explicitly release a held job (or re-run a failed one).
  ComputeManager.prototype.run = function (id) {
    var job = this._find(id);
    if (!job) return;
    if (job.state === "held" || job.state === "failed") { job.state = "queued"; job.error = null; this._pump(); }
  };
  ComputeManager.prototype.runAllHeld = function (cap) {
    this.jobs.forEach(function (j) { if (j.state === "held" && (!cap || j.cap === cap)) j.state = "queued"; });
    this._pump();
  };
  ComputeManager.prototype.cancel = function (id) {
    var job = this._find(id);
    if (!job) return;
    if (job.state === "running" && job._abort) { try { job._abort.abort(); } catch (e) {} }
    if (job.state === "queued" || job.state === "held") { job.state = "cancelled"; if (job._reject) job._reject(new Error("cancelled")); }
    this.emit("job", job); this.emit("status", this.status());
  };
  ComputeManager.prototype.setPolicy = function (cap, policy) {
    if (CAPS.indexOf(cap) === -1) return;
    this.policy[cap] = policy;
    if (policy === "auto") this.runAllHeld(cap);
    this.emit("status", this.status());
  };
  ComputeManager.prototype.clearDone = function () {
    this.jobs = this.jobs.filter(function (j) { return j.state === "queued" || j.state === "running" || j.state === "held"; });
    this.emit("status", this.status());
  };

  ComputeManager.prototype._find = function (id) { for (var i = 0; i < this.jobs.length; i++) if (this.jobs[i].id === id) return this.jobs[i]; return null; };

  ComputeManager.prototype._pump = function () {
    var self = this;
    if (this._running >= this.concurrency) return;
    var next = null;
    for (var i = 0; i < this.jobs.length; i++) { if (this.jobs[i].state === "queued") { next = this.jobs[i]; break; } }
    if (!next) return;

    var provider = this.providers[next.cap];
    next.state = "running"; next.progress = 0; this._running++;
    this.emit("job", next); this.emit("status", this.status());

    var AbortCtrl = root.AbortController || function () { this.signal = {}; this.abort = function () { this.signal.aborted = true; }; };
    next._abort = new AbortCtrl();
    var ctx = {
      signal: next._abort.signal,
      progress: function (frac, note) {
        next.progress = Math.max(0, Math.min(1, frac || 0));
        if (note != null) next.note = note;
        self.emit("job", next); self.emit("progress", next);
      }
    };

    Promise.resolve().then(function () { return provider.run(next.input, ctx); }).then(function (result) {
      var out = result || {};
      // stamp provenance: machine-generated, not author-verified
      if (out && typeof out === "object" && !out.skipped) { out.generated = true; if (out.verified == null) out.verified = false; out.provider = provider.name || next.cap; }
      self.cache[next.key] = out; next.result = out;
      next.state = "done"; next.progress = 1; next.note = "";
      self._running--; self.emit("job", next); self.emit("status", self.status());
      if (next._resolve) next._resolve(out);
      self._pump();
    }).catch(function (err) {
      next.state = (err && err.message === "cancelled") ? "cancelled" : "failed";
      next.error = (err && err.message) || String(err);
      self._running--; self.emit("job", next); self.emit("status", self.status());
      if (next._reject) next._reject(err);
      self._pump();
    });

    // fill remaining concurrency slots
    this._pump();
  };

  // ---- built-in provider factories ---------------------------------------
  // These are optional; the host wires whichever are appropriate.

  // Endpoint-backed vision/description provider (OpenAI-compatible chat/vision
  // shape, or any endpoint returning { description }). Off unless configured.
  function endpointDescriber(opts) {
    opts = opts || {};
    return {
      name: opts.name || "endpoint",
      available: function () { return !!opts.url; },
      run: function (input, ctx) {
        ctx.progress(0.1, "contacting description service");
        var body = opts.buildBody ? opts.buildBody(input)
          : { image: input.dataUrl || input.src, prompt: input.prompt || "Describe this image for a blind reader in one concise sentence." };
        return fetch(opts.url, {
          method: "POST",
          headers: Object.assign({ "Content-Type": "application/json" }, opts.headers || {}),
          body: JSON.stringify(body),
          signal: ctx.signal
        }).then(function (r) {
          if (!r.ok) throw new Error("service returned " + r.status);
          ctx.progress(0.8, "reading response");
          return r.json();
        }).then(function (j) {
          var text = opts.parse ? opts.parse(j) : (j.description || (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "");
          if (!text) throw new Error("empty description");
          return { description: String(text).trim() };
        });
      }
    };
  }

  // Tesseract WASM OCR provider — lazy-loads the engine only when a job runs,
  // and only if the vendored files are present. Absent => capability degrades
  // to a flag (no error, no network).
  function tesseractOcr(opts) {
    opts = opts || {};
    var lib = null;
    return {
      name: "tesseract",
      available: function () { return !!(opts.scriptUrl && opts.workerPath && opts.corePath && opts.langPath); },
      run: function (input, ctx) {
        ctx.progress(0.02, "loading OCR engine");
        function ensure() {
          if (root.Tesseract) { lib = root.Tesseract; return Promise.resolve(lib); }
          if (!opts.scriptUrl) return Promise.reject(new Error("OCR engine not installed"));
          // Preferred: inject the bundled engine into this isolated world via the
          // background (CSP-safe, correct world) — same approach as the DOCX lib.
          function pageLoad() {
            return new Promise(function (res, rej) {
              var s = (root.document && root.document.createElement) ? root.document.createElement("script") : null;
              if (!s) return rej(new Error("no DOM to load OCR engine"));
              s.src = opts.scriptUrl; s.onload = function () { lib = root.Tesseract; res(lib); };
              s.onerror = function () { rej(new Error("failed to load OCR engine")); };
              root.document.head.appendChild(s);
            });
          }
          if (opts.injectFiles && root.chrome && root.chrome.runtime && root.chrome.runtime.sendMessage) {
            return new Promise(function (res) {
              try { root.chrome.runtime.sendMessage({ type: "mdlaug-inject", files: opts.injectFiles }, function () { res(); }); }
              catch (e) { res(); }
            }).then(function () {
              if (root.Tesseract) { lib = root.Tesseract; return lib; }
              return pageLoad();
            });
          }
          return pageLoad();
        }
        return ensure().then(function (T) {
          return T.recognize(input.dataUrl || input.src, opts.lang || "eng", {
            workerPath: opts.workerPath, corePath: opts.corePath, langPath: opts.langPath,
            logger: function (m) { if (m && m.status) ctx.progress(0.1 + 0.85 * (m.progress || 0), m.status); }
          });
        }).then(function (r) {
          return { text: (r && r.data && r.data.text ? r.data.text : "").trim() };
        });
      }
    };
  }

  // Endpoint-backed speech-to-text (Whisper-style). The media URL is sent to the
  // service, which returns { text, segments:[{start,end,text}] }. Off unless configured.
  function endpointTranscriber(opts) {
    opts = opts || {};
    return {
      name: opts.name || "transcription service",
      available: function () { return !!opts.url; },
      run: function (input, ctx) {
        ctx.progress(0.1, "sending media to transcription service");
        var body = opts.buildBody ? opts.buildBody(input) : { mediaUrl: input.mediaUrl || input.src, language: input.language || "en" };
        return fetch(opts.url, {
          method: "POST",
          headers: Object.assign({ "Content-Type": "application/json" }, opts.headers || {}),
          body: JSON.stringify(body),
          signal: ctx.signal
        }).then(function (r) {
          if (!r.ok) throw new Error("service returned " + r.status);
          ctx.progress(0.85, "reading transcript");
          return r.json();
        }).then(function (j) {
          var text = opts.parse ? opts.parse(j) : (j.text || (j.segments || []).map(function (s) { return s.text; }).join(" "));
          var segments = j.segments || null;
          if (!text) throw new Error("empty transcript");
          return { text: String(text).trim(), segments: segments };
        });
      }
    };
  }

  var api = {
    ComputeManager: ComputeManager,
    endpointDescriber: endpointDescriber,
    tesseractOcr: tesseractOcr,
    endpointTranscriber: endpointTranscriber,
    hash: hash,
    CAPS: CAPS,
    version: "0.9.0"
  };
  root.mDLAUG = root.mDLAUG || {};
  root.mDLAUG.compute = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

})(typeof window !== "undefined" ? window : this);
