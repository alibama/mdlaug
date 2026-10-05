"""Fake Ollama: /api/tags lists models; /api/chat answers per model; one model rejects 'think'."""
import http.server, json, socketserver, threading

MODELS = [{"name": "qwen3:4b", "size": 2_600_000_000, "details": {"parameter_size": "4.0B", "quantization_level": "Q4_K_M"}},
          {"name": "gemma3:4b", "size": 3_300_000_000, "details": {"parameter_size": "4.3B", "quantization_level": "Q4_K_M"}}]

def serve(no_think=("gemma3:4b",)):
    seen = []
    class H(http.server.BaseHTTPRequestHandler):
        def _send(self, code, obj):
            b = json.dumps(obj).encode()
            self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
        def do_GET(self):
            self._send(200, {"models": MODELS}) if self.path == "/api/tags" else self._send(404, {})
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            seen.append(body)
            if body["model"] in no_think and "think" in body:
                self._send(400, {"error": f'"{body["model"]}" does not support thinking'}); return
            score = 5 if body["model"] == "qwen3:4b" else 3
            self._send(200, {"message": {"content": json.dumps({"score_1_7": score, "confidence": 0.8, "rationale": "x"})}})
        def log_message(self, *a): pass
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), H); srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}", seen
