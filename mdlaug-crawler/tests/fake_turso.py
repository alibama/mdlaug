"""A local stand-in for Turso: speaks the /v2/pipeline protocol over SQLite."""
import http.server, json, socketserver, sqlite3, threading

def _dec(v):
    t = v.get("type")
    return None if t == "null" else int(v["value"]) if t == "integer" else float(v["value"]) if t == "float" else v.get("value")

def _enc(v):
    if v is None: return {"type": "null"}
    if isinstance(v, int): return {"type": "integer", "value": str(v)}
    if isinstance(v, float): return {"type": "float", "value": v}
    return {"type": "text", "value": str(v)}

def serve(token="t0ken"):
    con = sqlite3.connect(":memory:", check_same_thread=False)
    lock = threading.Lock()
    calls = {"n": 0}

    class H(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            if self.headers.get("Authorization") != f"Bearer {token}":
                self.send_response(401); self.end_headers(); return
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            results = []
            with lock:
                calls["n"] += 1
                for rq in body["requests"]:
                    if rq["type"] == "close":
                        results.append({"type": "ok", "response": {"type": "close"}}); continue
                    try:
                        cur = con.execute(rq["stmt"]["sql"], [_dec(a) for a in rq["stmt"].get("args", [])])
                        cols = [{"name": d[0]} for d in (cur.description or [])]
                        rows = [[_enc(v) for v in r] for r in cur.fetchall()]
                        con.commit()
                        results.append({"type": "ok", "response": {"type": "execute", "result": {"cols": cols, "rows": rows}}})
                    except Exception as e:
                        results.append({"type": "error", "error": {"message": str(e)}})
            out = json.dumps({"results": results}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(out)
        def log_message(self, *a): pass

    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), H)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}", token, con, calls
