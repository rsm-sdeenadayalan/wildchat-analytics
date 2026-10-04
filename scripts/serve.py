"""Serve dist/ locally for review, with caching disabled so every reload shows the current build.

  uv run python scripts/serve.py            # http://localhost:8800/
  uv run python scripts/serve.py 9000
"""
from __future__ import annotations

import http.server
import sys
from functools import partial
from pathlib import Path


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, *args) -> None:  # quiet
        pass


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8800
    handler = partial(NoCacheHandler, directory=str(Path("dist").resolve()))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"serving dist/ at http://localhost:{port}/ (no-cache)", file=sys.stderr)
        httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
