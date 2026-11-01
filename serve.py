#!/usr/bin/env python3
"""Serve the web UI locally, with the proxy paths Caddy provides in production.

  python3 web/serve.py                                   # against production
  python3 web/serve.py --api http://localhost:8001 --storage http://localhost:3000

/maestro/* goes to the Maestro API, /storage/* to kernelci-storage (read
only: GET and HEAD), everything else is a file from web/ (data/ from --data).
"""

from __future__ import annotations  # Python 3.9 (macOS): `Path | None`

import argparse
import http.server
import shutil
import urllib.error
import urllib.request
from functools import partial
from pathlib import Path

WEB = Path(__file__).resolve().parent


class Handler(http.server.SimpleHTTPRequestHandler):
    upstreams: dict[str, str] = {}
    data_dir: Path | None = None

    def do_GET(self):
        for prefix, upstream in self.upstreams.items():
            if self.path.startswith(prefix):
                return self.proxy(upstream + self.path[len(prefix):])
        return super().do_GET()

    def do_HEAD(self):
        self.do_GET()

    def end_headers(self):
        # Revalidate on every load: without it browsers keep using cached
        # JS modules and data/*.json after they change
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def translate_path(self, path):
        if self.data_dir and path.startswith("/data/"):
            return str(self.data_dir / path[len("/data/"):].split("?")[0])
        return super().translate_path(path)

    def proxy(self, url):
        req = urllib.request.Request(url, method=self.command, headers={"Accept": self.headers.get("Accept", "*/*")})
        try:
            resp = urllib.request.urlopen(req, timeout=60)
        except urllib.error.HTTPError as e:
            resp = e
        except OSError as e:
            return self.send_error(502, f"{url}: {e}")
        with resp:
            self.send_response(resp.status)
            for key in ("Content-Type", "Content-Length", "Last-Modified"):
                if resp.headers.get(key):
                    self.send_header(key, resp.headers[key])
            self.end_headers()
            if self.command == "GET":
                shutil.copyfileobj(resp, self.wfile)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--api", default="https://api.openwrt-kci.aparcar.org", help="Maestro API base URL")
    parser.add_argument("--storage", default="https://storage.openwrt-kci.aparcar.org", help="kernelci-storage URL")
    parser.add_argument("--data", type=Path, help="data/ directory (default: web/data)")
    parser.add_argument("--port", type=int, default=7790)
    args = parser.parse_args()

    Handler.upstreams = {"/maestro/": args.api.rstrip("/") + "/", "/storage/": args.storage.rstrip("/") + "/"}
    Handler.data_dir = args.data.resolve() if args.data else None
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, directory=str(WEB)))
    print(f"http://127.0.0.1:{args.port}/  (Maestro: {args.api}, storage: {args.storage})")
    server.serve_forever()


if __name__ == "__main__":
    main()
