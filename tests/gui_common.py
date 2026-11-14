"""Real-browser test of the owner's user-management GUI (needs playwright + chromium)."""
from harness import *
import threading, time, re, uvicorn, mimetypes
from playwright.sync_api import sync_playwright

CDN = os.environ.get("CDN_DIR", "/tmp/cdn/node_modules")  # folder where `npm i bootstrap@5.3.2 bootstrap-icons@1.11.1 lottie-web@5.12.2 pako@2.1.0 twemoji@14.0.2` was run + /node_modules
ROUTES = {
  "bootstrap-icons@1.11.1/": f"{CDN}/bootstrap-icons/", "bootstrap@5.3.2/": f"{CDN}/bootstrap/",
  "lottie-web@5.12.2/": f"{CDN}/lottie-web/", "pako@2.1.0/": f"{CDN}/pako/", "twemoji@14.0.2/": f"{CDN}/twemoji/",
}
def local_for(url):
    for k, base in ROUTES.items():
        if k in url: return base + url.split(k,1)[1].split("?")[0]
    return None

import socket as _s
_sock = _s.socket(); _sock.bind(("127.0.0.1", 0)); PORT = _sock.getsockname()[1]; _sock.close()   # a free port every run
cfg = uvicorn.Config(A.app, host="127.0.0.1", port=PORT, log_level="error")
server = uvicorn.Server(cfg); threading.Thread(target=server.run, daemon=True).start()
for _ in range(50):
    if server.started: break
    time.sleep(.1)
URL = f"http://127.0.0.1:{PORT}/"

results=[]; 
def check(name, cond):
    results.append(bool(cond)); print(("PASS " if cond else "FAIL ")+name)

def new_page(ctx):
    p = ctx.new_page()
    errors=[]; p.on("pageerror", lambda e: errors.append(str(e))); p.errors=errors
    def handle(route):
        f = local_for(route.request.url)
        if f and os.path.exists(f): route.fulfill(path=f, content_type=mimetypes.guess_type(f)[0] or "application/octet-stream")
        elif "googleapis" in route.request.url or "gstatic" in route.request.url or "jsdelivr" in route.request.url: route.abort()
        else: route.continue_()
    p.route("**/*", handle)
    return p

def login(p, user, pw):
    p.goto(URL); p.fill("#userInput", user); p.fill("#passInput", pw); p.click("#authLogin button.btn-primary")

