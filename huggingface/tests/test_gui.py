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

with sync_playwright() as pw:
    br = pw.chromium.launch()
    ctx = br.new_context(viewport={"width":1100,"height":800}); p = new_page(ctx)
    login(p, "owner", "ownerpw")
    p.wait_for_selector("#mainApp:not(.d-none)", timeout=8000)
    check("owner logs in through the real login form", True)
    check("owner sees BOTH tabs: bot + «تلگرام»", p.locator('.view-btn[data-view="biz"]').is_visible() and p.inner_text('.view-btn[data-view="biz"]').strip().startswith("تلگرام"))
    check("no badge beside the + button anymore", p.locator("#gUnread").count() == 0)

    p.click('button[title="تنظیمات"]'); p.wait_for_selector("#settingsPage.show")
    check("settings list has 'کاربران پنل' for owner", p.locator("#spMain >> text=کاربران پنل").is_visible())
    p.click("#spMain >> text=کاربران پنل"); p.wait_for_selector("#spUsers", state="visible")
    check("users page opens", p.locator("#spUsers >> text=کاربر جدید").is_visible())

    # create user
    p.fill("#uName", "ali"); p.click("#spUsers button[title='تولید رمز تصادفی']")
    gen = p.input_value("#uPass"); check("generate-password fills 12 chars", len(gen)==12)
    p.fill("#uTgId", "123456789"); p.click("text=ساخت حساب")
    p.wait_for_selector(".u-card >> text=ali")
    check("user card appears after create", p.locator(".u-card").count()==1)
    check("card shows no-bot state + Telegram id", p.locator(".u-card >> text=ربات وصل نشده").is_visible() and p.locator(".u-card >> text=123456789").is_visible())
    check("form cleared after create", p.input_value("#uName")=="" and p.input_value("#uPass")=="")
    p.screenshot(path="/tmp/gui_users.png")

    # connect bot via dialog
    p.click(".u-btn:has-text(\"اتصال ربات\")"); p.wait_for_selector("#dlgToken")
    p.fill("#dlgToken", "GOODTOKEN_ALI"); p.click("#gmodModalOk")
    p.wait_for_selector(".u-card >> text=@bot_goodtoken_ali", timeout=6000); p.wait_for_selector("#gmodModal", state="hidden", timeout=4000); p.wait_for_function("history.state && history.state.level==='settings-sub'", timeout=4000)
    check("bot connected from GUI shows @username", True)

    # back button closes dialog but stays on users page
    p.click(".u-btn:has-text(\"آیدی تلگرام\")"); p.wait_for_selector("#dlgTg")
    p.wait_for_timeout(500); p.go_back(); p.wait_for_selector("#gmodModal", state="hidden", timeout=4000)
    check("device-back closes the dialog…", True)
    check("…and stays on the users page", p.locator("#spUsers").is_visible() and p.locator(".u-card").count()==1)

    # reset password -> login with it in a second browser context
    p.click(".u-btn:has-text(\"رمز جدید\")"); p.wait_for_selector("#dlgPass"); p.click("#gmodModal button:has(.bi-magic)")
    newpw = p.input_value("#dlgPass"); p.click("#gmodModalOk")
    p.wait_for_selector("#gmodModal", state="hidden", timeout=4000); p.wait_for_function("history.state && history.state.level==='settings-sub'", timeout=4000)
    ctx2 = br.new_context(); p2 = new_page(ctx2); login(p2, "ali", newpw)
    p2.wait_for_selector("#mainApp:not(.d-none)", timeout=8000)
    check("customer logs in with the generated password", True)
    p2.click('button[title="تنظیمات"]'); p2.wait_for_selector("#settingsPage.show")
    check("customer has no «کاربران پنل» row", not p2.locator("#spMain >> text=کاربران پنل").is_visible())
    check("customer sees both Bot and Business tabs", p2.locator('.view-btn[data-view="biz"]').is_visible())
    status = p2.evaluate("fetch('/api/admin/users',{headers:{Authorization:PASS}}).then(r=>r.status)")
    check("customer's token is rejected by admin API (403)", status==403)

    # suspend -> customer's live page gets kicked, login shows suspended message
    p.click(".u-btn:has-text(\"تعلیق\") >> nth=0"); p.wait_for_selector(".u-badge.off")
    check("badge flips to تعلیق‌شده", p.locator(".u-badge.off").is_visible())
    p2.wait_for_timeout(300); 
    p2.evaluate("apiFetch('/api/chats')"); p2.wait_for_selector("#authBox:not(.d-none)", timeout=8000)
    check("suspended customer's live session returns to login screen", True)
    p2.fill("#userInput","ali"); p2.fill("#passInput", newpw); p2.click("#authLogin button.btn-primary")
    p2.wait_for_selector("#authSuspended:not(.d-none)", timeout=5000)
    check("login screen shows 'این یوزر تعلیق شده است'", "تعلیق" in p2.inner_text("#authSuspended"))
    p2.screenshot(path="/tmp/gui_suspended.png")
    p.click(".u-btn:has-text(\"رفع تعلیق\")"); p.wait_for_selector(".u-badge.on")
    check("unsuspend works", True)

    # forgot-password UI toggles
    p2.reload(); p2.click("text=فراموشی رمز عبور"); check("forgot-password panel opens", p2.locator("#forgotUser").is_visible())

    # delete needs the typed username
    p.click(".u-btn:has-text(\"حذف\")"); p.wait_for_selector("#dlgConfirm")
    p.fill("#dlgConfirm", "wrong"); p.click("#gmodModalOk"); p.wait_for_timeout(400)
    check("delete with wrong confirmation keeps dialog + user", p.locator("#dlgConfirm").is_visible() and p.locator(".u-card").count()==1)
    p.fill("#dlgConfirm", "ali"); p.click("#gmodModalOk"); p.wait_for_selector(".u-card", state="detached", timeout=6000)
    check("delete with right confirmation removes the user", p.locator("text=هنوز کاربری ساخته نشده").is_visible())

    errs = p.errors + p2.errors
    check("no JavaScript errors on either page", not errs)
    if errs: print(errs)
    br.close()
print("ALL OK" if all(results) else f"SOME FAILED ({results.count(False)})")
