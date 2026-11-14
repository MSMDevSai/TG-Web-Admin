"""Browser test: tabs/badge, per-account settings that PERSIST, own admin group + Gemini key,
bot profile (+photo), Telegram password recovery with forced change, change-password dialog."""
from gui_common import *
from harness import calls, FILES, FAIL
import re, struct, zlib

def tiny_png(w=40, h=24):
    raw = b"".join(b"\x00" + b"\xd0\x20\x20" * w for _ in range(h))
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
open("/tmp/tiny.png", "wb").write(tiny_png())

def reopen(p):
    p.reload(); p.wait_for_selector("#mainApp:not(.d-none)")   # stored session logs back in by itself
def settings(p, row):
    p.click('button[title="تنظیمات"]'); p.click(f"#spMain >> text={row}")
def toast(p, kind, timeout=6000):
    p.wait_for_selector(f".glass-toast.{kind}", timeout=timeout); return p.inner_text(f".glass-toast.{kind}")
def clear_toasts(p): p.wait_for_selector(".glass-toast", state="detached", timeout=9000)
def sent_to(chat, tok):
    return [j for u, j in calls if u.endswith("/sendMessage") and str((j or {}).get("chat_id")) == str(chat) and f"/bot{tok}/" in u]

with sync_playwright() as pw:
    br = pw.chromium.launch()
    ctx = br.new_context(viewport={"width": 1100, "height": 900}); p = new_page(ctx)
    p.on("dialog", lambda d: d.accept())
    login(p, "owner", "ownerpw"); p.wait_for_selector("#mainApp:not(.d-none)")
    api = lambda path, body=None, method="POST": p.evaluate("([path,body,method])=>fetch(path,{method,headers:{'Content-Type':'application/json',Authorization:PASS},body:body?JSON.stringify(body):undefined}).then(r=>r.status)", [path, body, method])
    check("(setup) create account with Telegram id", api("/api/admin/users", {"username": "sai", "password": "saipass1", "telegramId": "4242"}) == 200)
    check("(setup) connect its bot", api("/api/admin/users/sai/bot", {"token": "GOODTOKEN_SAI"}) == 200)

    # ---------------- tabs / badge
    check("tabs: «ربات» and «تلگرام» (owner sees both)", p.locator('.view-btn[data-view="bot"]').is_visible() and p.inner_text('.view-btn[data-view="biz"]').strip().startswith("تلگرام"))
    check("no unread badge beside the + button", p.locator("#gUnread").count() == 0 and p.locator(".sidebar-header .badge").count() == 0)
    p.evaluate("()=>{const b=document.getElementById('vbBizCount');b.textContent='3';b.classList.remove('d-none')}")
    g = p.evaluate("()=>{const b=document.getElementById('vbBizCount').getBoundingClientRect(),t=document.querySelector('.view-btn[data-view=\"biz\"]').getBoundingClientRect();return {bt:b.top,bb:b.bottom,bl:b.left,br:b.right,tt:t.top,tb:t.bottom,tl:t.left,tr:t.right,pos:getComputedStyle(document.getElementById('vbBizCount')).position}}")
    check("count badge sits on the tab's top corner (absolute, straddling the top edge, inside its width)", g["pos"] == "absolute" and g["bt"] < g["tt"] + 4 and g["bb"] > g["tt"] and g["bl"] >= g["tl"] and g["br"] <= g["tr"] + 1)
    p.screenshot(path="/tmp/gui_tabs.png", clip={"x": 700, "y": 0, "width": 400, "height": 140})
    p.evaluate("()=>document.getElementById('vbBizCount').classList.add('d-none')")

    # ---------------- a customer account: settings must load AND persist
    ctx2 = br.new_context(viewport={"width": 1100, "height": 900}); t = new_page(ctx2); t.on("dialog", lambda d: d.accept())
    login(t, "sai", "saipass1"); t.wait_for_selector("#mainApp:not(.d-none)")
    check("customer sees both tabs too", t.locator('.view-btn[data-view="biz"]').is_visible())
    settings(t, "پنل و اعلان‌ها"); t.wait_for_selector("#spPanel", state="visible")
    check("customer's form is FILLED from his saved settings (Telegram id 4242)", t.input_value("#gOwnerId") == "4242")
    check("customer sees the admin-group field", t.locator("#gAdminGroup").is_visible())
    check("owner does NOT see it (owner uses the server setting)", not p.evaluate("()=>{const e=document.getElementById('gAdminGroup');return !!e.offsetParent}"))
    t.fill("#gAdminGroup", "abc"); t.click("#spPanel button:has-text('تست')"); check("test button with a bad id -> error", "اول آیدی" in toast(t, "error")); clear_toasts(t)
    t.fill("#gAdminGroup", "-100555"); calls.clear(); t.click("#spPanel button:has-text('تست')")
    check("admin-group test succeeds", "آزمایشی" in toast(t, "success")); clear_toasts(t)
    check("…the line really went out through the customer's own bot", len(sent_to(-100555, "GOODTOKEN_SAI")) == 1)
    t.click("#spPanel >> text=ذخیره"); toast(t, "success"); clear_toasts(t)
    # THE reported bug: save, come back, the id must still be there
    reopen(t)
    settings(t, "پنل و اعلان‌ها"); t.wait_for_selector("#spPanel", state="visible")
    check("after save + fresh login: Telegram id still 4242", t.input_value("#gOwnerId") == "4242")
    check("…and the admin group persisted", t.input_value("#gAdminGroup") == "-100555")
    t.fill("#gOwnerId", "999000"); t.click("#spPanel >> text=ذخیره"); toast(t, "success"); clear_toasts(t)
    reopen(t); settings(t, "پنل و اعلان‌ها"); t.wait_for_selector("#spPanel", state="visible")
    check("edited Telegram id persisted too", t.input_value("#gOwnerId") == "999000")
    t.fill("#gOwnerId", "12ab"); t.click("#spPanel >> text=ذخیره")
    check("non-numeric id is refused with a message", "عدد" in toast(t, "error")); clear_toasts(t)
    t.fill("#gOwnerId", "999000")

    # ---------------- own Gemini key
    t.click("#spPanel button.icon-btn"); t.click("#spMain >> text=هوش مصنوعی"); t.wait_for_selector("#spAi", state="visible")
    check("AI page has a Google key field + 'each account has its own' hint", t.locator("#gGeminiKey").is_visible() and "هر حساب" in t.inner_text("#gGeminiHint"))
    t.fill("#gGeminiKey", "KEY_FOR_SAI"); t.click("#spAi button:has-text('ذخیره')"); toast(t, "success"); clear_toasts(t)
    reopen(t); settings(t, "هوش مصنوعی"); t.wait_for_selector("#spAi", state="visible")
    check("key saved: field empty, placeholder says it's stored (never echoed)", t.input_value("#gGeminiKey") == "" and "ذخیره‌شده" in t.get_attribute("#gGeminiKey", "placeholder"))
    t.click("#spAi button:has-text('ذخیره')"); toast(t, "success"); clear_toasts(t)   # save again WITHOUT typing a key
    reopen(t); settings(t, "هوش مصنوعی"); t.wait_for_selector("#spAi", state="visible")
    check("saving again without typing a key keeps the stored key", "ذخیره‌شده" in t.get_attribute("#gGeminiKey", "placeholder"))
    t.click("#spAi button:has-text('حذف')"); toast(t, "success"); clear_toasts(t)
    reopen(t); settings(t, "هوش مصنوعی"); t.wait_for_selector("#spAi", state="visible")
    check("delete key works; owner id + admin group untouched by that partial save",
          "ذخیره‌شده" not in t.get_attribute("#gGeminiKey", "placeholder") and t.evaluate("fetch('/api/settings',{headers:{Authorization:PASS}}).then(r=>r.json()).then(j=>j.owner_user_id+'|'+j.admin_group_id)") == "999000|-100555")

    # ---------------- bot profile
    t.click("#spAi button.icon-btn"); t.click("#spMain >> text=پروفایل ربات"); t.wait_for_selector("#spBot", state="visible"); t.wait_for_selector("#bpUser:not(:empty)")
    check("bot profile shows name / @username / ID", t.inner_text("#bpName") == "Name of GOODTOKEN_SAI" and t.inner_text("#bpUser") == "@bot_goodtoken_sai" and "777" in t.inner_text("#bpId"))
    check("short + full descriptions are filled in", "Short of" in t.input_value("#bShort") and "Full desc" in t.input_value("#bDesc"))
    check("no photo yet -> placeholder icon", t.locator("#bpPhotoFallback").is_visible() and not t.locator("#bpPhoto").is_visible())
    t.screenshot(path="/tmp/gui_botprofile.png")
    FILES.clear(); t.set_input_files("#bpFile", "/tmp/tiny.png")
    check("picture upload reports success", "عکس ربات" in toast(t, "success")); clear_toasts(t)
    up = [f for m, f in FILES if m == "setMyProfilePhoto"]
    check("a PNG was converted to JPEG in the browser before upload", len(up) == 1 and up[0]["pic"][1].startswith(b"\xff\xd8\xff"))
    calls.clear(); t.fill("#bName", "My Shop Bot"); t.click("#spBot >> text=ذخیره"); toast(t, "success"); clear_toasts(t)
    check("only the CHANGED field was sent to Telegram", [u.rsplit("/", 1)[-1] for u, j in calls if "setMy" in u and "Photo" not in u] == ["setMyName"])
    if t.locator("#spBot").is_hidden(): t.click("#spMain >> text=پروفایل ربات")   # saving returns to the settings list
    t.wait_for_selector("#spBot", state="visible"); t.wait_for_function("document.getElementById('bName').value==='Name of GOODTOKEN_SAI'"); FAIL["GOODTOKEN_SAI/setMyName"] = "Too Many Requests: retry after 3600"
    t.fill("#bName", "Another"); t.click("#spBot >> text=ذخیره")
    check("Telegram's refusal is shown (rate limit, in Persian) and the page stays", "محدود" in toast(t, "error") and t.locator("#spBot").is_visible()); FAIL.clear(); clear_toasts(t)
    t.click("#spBot button:has-text('حذف عکس')"); check("remove photo", "حذف شد" in toast(t, "success")); clear_toasts(t)

    # ---------------- change password from settings
    t.click("#spBot button.icon-btn"); 
    check("customer has «تغییر رمز عبور» in settings, owner doesn't", t.locator("#spMain >> text=تغییر رمز عبور").is_visible() and not p.evaluate("()=>[...document.querySelectorAll('#spMain .sp-list-row')].some(e=>e.textContent.includes('تغییر رمز')&&e.offsetParent)"))
    t.click("#spMain >> text=تغییر رمز عبور"); t.wait_for_selector("#cpOld"); t.fill("#cpOld", "wrong"); t.fill("#cpNew", "newpass77"); t.click("#gmodModalOk")
    check("wrong current password -> error", "فعلی" in toast(t, "error")); clear_toasts(t)
    t.fill("#cpOld", "saipass1"); t.click("#gmodModalOk"); check("right current password -> changed", "تغییر کرد" in toast(t, "success")); clear_toasts(t)
    check("the session was refreshed and keeps working", t.evaluate("fetch('/api/settings',{headers:{Authorization:PASS}}).then(r=>r.status)") == 200)
    t.evaluate("logout()")

    # ---------------- forgot password -> temp password via Telegram -> forced change
    ctx3 = br.new_context(viewport={"width": 1100, "height": 900}); f = new_page(ctx3)
    f.goto(URL); f.click("text=فراموشی رمز عبور"); check("recovery text promises a Telegram message (no email)", "تلگرام" in f.inner_text("#authForgot") and "ایمیل" not in f.inner_text("#authForgot"))
    calls.clear(); f.fill("#forgotUser", "sai"); f.click("#authForgot button.btn-primary"); toast(f, "success"); 
    f.wait_for_function("1", timeout=500); 
    m = sent_to(999000, "GOODTOKEN_SAI")
    for _ in range(20):
        if m: break
        f.wait_for_timeout(250); m = sent_to(999000, "GOODTOKEN_SAI")
    check("the temp password arrived at the account holder's Telegram id via THEIR bot", len(m) == 1)
    temp = re.search(r"`([^`]+)`", m[0]["text"]).group(1)
    check("after requesting, the page returns to the login form by itself", f.locator("#authLogin").is_visible()); f.fill("#userInput", "sai"); f.fill("#passInput", temp); f.click("#authLogin button.btn-primary")
    f.wait_for_selector("#authForce:not(.d-none)", timeout=6000)
    check("temp password -> 'choose a new password' screen, app NOT opened", f.locator("#mainApp").is_hidden())
    f.fill("#forceNew1", "short"); f.fill("#forceNew2", "short"); f.click("#authForce button.btn-primary"); check("too short refused", "۶" in toast(f, "warn")); clear_toasts(f)
    f.fill("#forceNew1", "freshpass1"); f.fill("#forceNew2", "different1"); f.click("#authForce button.btn-primary"); check("mismatch refused", "یکی نیست" in toast(f, "warn")); clear_toasts(f)
    f.fill("#forceNew2", "freshpass1"); f.click("#authForce button.btn-primary"); f.wait_for_selector("#mainApp:not(.d-none)", timeout=8000)
    check("new password chosen -> straight into the app, settings load", f.input_value("#gOwnerId") == "999000" if False else f.evaluate("fetch('/api/settings',{headers:{Authorization:PASS}}).then(r=>r.status)") == 200)
    f.evaluate("logout()"); f.wait_for_selector("#authBox:not(.d-none)")
    f.fill("#userInput", "sai"); f.fill("#passInput", "saipass1"); f.click("#authLogin button.btn-primary"); check("the OLD password no longer works", "اشتباه" in toast(f, "error")); clear_toasts(f)
    f.fill("#passInput", temp); f.click("#authLogin button.btn-primary"); check("the temp password can't be reused", "اشتباه" in toast(f, "error")); clear_toasts(f)
    f.fill("#passInput", "freshpass1"); f.click("#authLogin button.btn-primary"); f.wait_for_selector("#mainApp:not(.d-none)", timeout=8000); check("new password logs in normally", True)

    # ---------------- owner's user list reflects the Telegram id
    settings(p, "کاربران پنل"); p.wait_for_selector("#spUsers", state="visible"); p.wait_for_selector(".u-card")
    check("owner's card shows the Telegram id and recovery readiness", "999000" in p.inner_text(".u-card") and "بازیابی رمز کار نمی‌کند" not in p.inner_text(".u-card"))
    p.click(".u-btn:has-text('آیدی تلگرام')"); p.wait_for_selector("#dlgTg"); check("dialog is pre-filled with the current id", p.input_value("#dlgTg") == "999000")
    p.fill("#dlgTg", "777111"); p.click("#gmodModalOk"); toast(p, "success")
    p.wait_for_selector("#gmodModal", state="hidden", timeout=4000); p.wait_for_function("history.state && history.state.level==='settings-sub'", timeout=4000)
    p.wait_for_function("document.querySelector('.u-card').innerText.includes('777111')", timeout=6000); check("card updates after changing the id", True)
    errs = p.errors + t.errors + f.errors
    check("no JavaScript errors", not errs)
    if errs: print(errs)
    br.close()
print("ALL OK" if all(results) else f"SOME FAILED ({results.count(False)})")
