#!/usr/bin/env python3
"""
Zero-dependency local dev server for the Efficiency Workbench frontend.
Serves static files from `frontend/` and reverse-proxies `/api/*`, `/docs`,
and `/openapi.json` to the local FastAPI backend while preserving same-origin
Host/Origin headers and HttpOnly session cookies.
"""
import argparse
import http.client
import mimetypes
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
PROXY_PREFIXES = ("/api/", "/docs", "/openapi.json", "/redoc")


class WorkbenchDevHandler(BaseHTTPRequestHandler):
    backend_host = "127.0.0.1"
    backend_port = 8000

    def _is_proxy(self):
        path = urlsplit(self.path).path
        return path == "/api" or any(path.startswith(p) for p in PROXY_PREFIXES)

    def _proxy(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        body = self.rfile.read(length) if length > 0 else None
        conn = http.client.HTTPConnection(self.backend_host, self.backend_port, timeout=30)
        headers = {k: v for k, v in self.headers.items() if k.lower() != "connection"}
        try:
            conn.request(self.command, self.path, body=body, headers=headers)
            resp = conn.getresponse()
            data = resp.read()
            self.send_response(resp.status, resp.reason)
            for k, v in resp.getheaders():
                if k.lower() in ("transfer-encoding", "connection"):
                    continue
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(data)
        except OSError as exc:
            msg = f'{{"detail":"无法连接后端服务 ({exc})"}}'.encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)
        finally:
            conn.close()

    def _serve_static(self):
        raw_path = urlsplit(self.path).path
        rel = raw_path.lstrip("/") or "index.html"
        target = (ROOT / rel).resolve()
        if not str(target).startswith(str(ROOT)) or not target.is_file():
            target = ROOT / "index.html"
        ctype, _ = mimetypes.guess_type(str(target))
        if target.suffix == ".js":
            ctype = "application/javascript; charset=utf-8"
        elif target.suffix == ".css":
            ctype = "text/css; charset=utf-8"
        elif target.suffix == ".json":
            ctype = "application/json; charset=utf-8"
        elif target.suffix == ".html":
            ctype = "text/html; charset=utf-8"
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def do_GET(self):
        self._proxy() if self._is_proxy() else self._serve_static()

    def do_HEAD(self):
        self._proxy() if self._is_proxy() else self._serve_static()

    def do_POST(self):
        self._proxy()

    def do_PUT(self):
        self._proxy()

    def do_PATCH(self):
        self._proxy()

    def do_DELETE(self):
        self._proxy()

    def do_OPTIONS(self):
        self._proxy()


def main():
    parser = argparse.ArgumentParser(description="多端效率工作台前端本地开发服务器")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5173)
    parser.add_argument("--backend-host", default="127.0.0.1")
    parser.add_argument("--backend-port", type=int, default=8000)
    args = parser.parse_args()

    WorkbenchDevHandler.backend_host = args.backend_host
    WorkbenchDevHandler.backend_port = args.backend_port
    server = ThreadingHTTPServer((args.host, args.port), WorkbenchDevHandler)
    print(f"Frontend dev server: http://{args.host}:{args.port} -> API http://{args.backend_host}:{args.backend_port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
