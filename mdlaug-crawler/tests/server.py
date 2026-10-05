"""Tiny fixture server: routes /search → results.html, /item/* → item.html, etc."""
import http.server, threading, socketserver
from pathlib import Path
ROOT = Path(__file__).parent / "fixture_site"
ROUTES = {"/": "index.html", "/search": "results.html", "/help": "help.html", "/browse": "browse.html",
          "/robots.txt": "robots.txt", "/consent/": "consent.html"}

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?")[0]
        f = ROUTES.get(path) or ("item.html" if path.startswith("/item/") else None)
        if not f:
            self.send_response(404); self.end_headers(); return
        body = (ROOT / f).read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain" if f.endswith(".txt") else "text/html; charset=utf-8")
        self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass

def serve():
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), H)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}/"
