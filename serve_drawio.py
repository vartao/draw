import argparse
import functools
import mimetypes
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class DrawioRequestHandler(SimpleHTTPRequestHandler):
    extensions_map = SimpleHTTPRequestHandler.extensions_map.copy()
    extensions_map.update(
        {
            ".js": "application/javascript; charset=utf-8",
            ".mjs": "application/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".svg": "image/svg+xml",
            ".wasm": "application/wasm",
        }
    )

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def do_GET(self):
        if "If-Modified-Since" in self.headers:
            del self.headers["If-Modified-Since"]
        if "If-None-Match" in self.headers:
            del self.headers["If-None-Match"]
        super().do_GET()

    def do_HEAD(self):
        if "If-Modified-Since" in self.headers:
            del self.headers["If-Modified-Since"]
        if "If-None-Match" in self.headers:
            del self.headers["If-None-Match"]
        super().do_HEAD()


def main():
    parser = argparse.ArgumentParser(description="Serve draw.io webapp locally.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument(
        "--webapp",
        default=str(Path(__file__).resolve().parent / "drawio" / "src" / "main" / "webapp"),
    )
    args = parser.parse_args()

    mimetypes.add_type("application/javascript; charset=utf-8", ".js")
    mimetypes.add_type("application/javascript; charset=utf-8", ".mjs")
    mimetypes.add_type("application/json; charset=utf-8", ".json")
    mimetypes.add_type("text/css; charset=utf-8", ".css")
    mimetypes.add_type("image/svg+xml", ".svg")
    mimetypes.add_type("application/wasm", ".wasm")

    webapp = Path(args.webapp).resolve()
    handler = functools.partial(DrawioRequestHandler, directory=str(webapp))
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Serving {webapp} at http://{args.host}:{args.port}/index.html", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
