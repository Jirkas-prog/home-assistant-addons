"""Local demo server. Uses a free loopback port and no Home Assistant access."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(Path(__file__).resolve().parents[1])))
    print(f"http://127.0.0.1:{server.server_port}/preview/", flush=True)
    server.serve_forever()
