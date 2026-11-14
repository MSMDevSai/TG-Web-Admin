from harness import *
from harness import FAIL, BIZ
from starlette.testclient import TestClient
import asyncio, re, time

loop = asyncio.new_event_loop(); run = lambda c: loop.run_until_complete(c)
ok = True
def check(name, cond):
    global ok; print(("PASS " if cond else "FAIL ")+name); ok = ok and bool(cond)
def msgs(chat, tok=None):
    return [(u, j) for u, j in calls if u.endswith("/sendMessage") and str((j or {}).get("chat_id")) == str(chat) and (tok is None or f"/bot{tok}/" in u)]

c = TestClient(A.app)
def login(u, p): return c.post("/api/login", json={"username": u, "password": p})
tokh = lambda r: {"Authorization": r.json()["token"]}
O = tokh(login("owner", "ownerpw"))

# ------------------------------------------------------------------ accounts
run(A.handle_admin_command("-100", "/signup sai pass1234 4242", None))
run(A.handle_admin_command("-100", "/setbot sai GOODTOKEN_SAI", None))
run(A.handle_admin_command("-100", "/signup lee pass5678", None))
run(A.handle_admin_command("-100", "/setbot lee GOODTOKEN_LEE", None))
routes = run(A.get_tenant_routes()); users = run(A.get_users())
sec_sai = users["sai"]["webhook_secret"]; H_sai_hook = {"X-Telegram-Bot-Api-Secret-Token": sec_sai}
r = login("sai", "pass1234"); S = tokh(r)

# ------------------------------------------------------------------ A. recovery by Telegram
calls.clear()
j_real = c.post("/api/request-password-reset", json={"username": "sai"}).json()
j_ghost = c.post("/api/request-password-reset", json={"username": "nobody"}).json()
check("identical response for real and nonexistent account", j_real == j_ghost)
m = msgs(4242, "GOODTOKEN_SAI")
check("temp password sent to the holder's Telegram THROUGH THEIR OWN bot", len(m) == 1 and not msgs(4242, "OWNERTOKEN"))
temp = re.search(r"`([^`]+)`", m[0][1]["text"]).group(1) if m else ""
check("temp password is 10 chars, stored only as a hash", len(temp) == 10 and temp not in json.dumps(run(A.get_users())))
check("real password still works after a reset request (no lock-out)", login("sai", "pass1234").status_code == 200)
c.post("/api/request-password-reset", json={"username": "sai"}); check("cooldown: no second message within a minute", len(msgs(4242)) == 1)

rt = login("sai", temp); check("temp password logs in and demands a change", rt.status_code == 200 and rt.json()["must_change"] is True)
T = tokh(rt)
check("…and nothing else works until then (403)", c.get("/api/chats", headers=T).status_code == 403 and c.get("/api/settings", headers=T).status_code == 403)
check("temp password is single-use", login("sai", temp).status_code == 401)
check("too-short new password rejected", c.post("/api/change-password", headers=T, json={"newPassword": "123"}).status_code == 400)
rc = c.post("/api/change-password", headers=T, json={"newPassword": "brandnew77"}); check("forced change succeeds without the old password", rc.status_code == 200 and rc.json()["token"])
check("the forced session itself is retired", c.get("/api/chats", headers=T).status_code == 401)
check("new token is a normal session", c.get("/api/chats", headers={"Authorization": rc.json()["token"]}).status_code == 200)
check("old password dead, new one works", login("sai", "pass1234").status_code == 401 and login("sai", "brandnew77").status_code == 200)
S = tokh(login("sai", "brandnew77"))
check("voluntary change needs the CURRENT password", c.post("/api/change-password", headers=S, json={"currentPassword": "wrong", "newPassword": "another99"}).status_code == 400)
check("voluntary change with right current password", c.post("/api/change-password", headers=S, json={"currentPassword": "brandnew77", "newPassword": "another99"}).status_code == 200)
check("owner can't change WEB_PASSWORD through the API", c.post("/api/change-password", headers=O, json={"newPassword": "whatever1"}).status_code == 400)

# expiry
A.kv.cache.pop("PANEL_USERS", None)
u = run(A.get_users()); u["sai"].update(temp_hash=A.hash_password("EXPIRED123")[0], temp_salt=A.hash_password("EXPIRED123", "s")[1], temp_expires=A.now_ts() - 1000)
u["sai"]["temp_hash"], u["sai"]["temp_salt"] = A.hash_password("EXPIRED123", "salty")[0], "salty"; run(A.save_users(u))
check("expired temp password rejected", login("sai", "EXPIRED123").status_code == 401)

# failure paths notify the admins
def reset_cooldown(name): 
    uu = run(A.get_users()); uu[name]["temp_requested_ts"] = 0; run(A.save_users(uu))
calls.clear(); A._last_admin_notify.clear()
FAIL["GOODTOKEN_SAI/sendMessage"] = "Forbidden: bot can't initiate conversation with a user"
reset_cooldown("sai"); c.post("/api/request-password-reset", json={"username": "sai"})
note = [j["text"] for u_, j in msgs(-100, "OWNERTOKEN")]
check("DM refused -> owner's admin group told, with the /start hint", any("sai" in t and "/start" in t for t in note))
_u = run(A.get_users())["sai"]
check("…and no usable temp password was left behind", not (_u.get("temp_hash") and _u.get("temp_expires", 0) > A.now_ts()))
FAIL.clear()
calls.clear(); A._last_admin_notify.clear(); reset_cooldown("lee"); c.post("/api/request-password-reset", json={"username": "lee"})
check("account without a Telegram id -> admin told, nothing sent", not msgs(4242) and any("آیدی عددی تلگرام" in j["text"] for u_, j in msgs(-100, "OWNERTOKEN")))
run(A.handle_admin_command("-100", "/suspend sai", None)); calls.clear(); reset_cooldown("sai"); c.post("/api/request-password-reset", json={"username": "sai"})
check("suspended accounts get no recovery message", not msgs(4242)); run(A.handle_admin_command("-100", "/unsuspend sai", None))

# ------------------------------------------------------------------ B. per-account admin group
S = tokh(login("sai", "another99")); L = tokh(login("lee", "pass5678"))
s = c.get("/api/settings", headers=S).json()
check("bad admin group id rejected", c.post("/api/settings", headers=S, json={**s, "admin_group_id": "abc"}).status_code == 400)
check("bad telegram id rejected", c.post("/api/settings", headers=S, json={**s, "owner_user_id": "12ab"}).status_code == 400)
check("valid group id + telegram id saved", c.post("/api/settings", headers=S, json={**s, "admin_group_id": "-100777", "owner_user_id": "4242", "ai_mode": False}).status_code == 200)
back = c.get("/api/settings", headers=S).json(); check("…and read back", back["admin_group_id"] == "-100777" and back["owner_user_id"] == "4242")
calls.clear()
upd = {"update_id": 1, "message": {"message_id": 5, "chat": {"id": 31337, "type": "private", "first_name": "Cust"}, "from": {"id": 31337, "first_name": "Cust"}, "text": "/send_msg please call me", "date": 1}}
c.post(f"/webhook/{sec_sai}", json=upd, headers=H_sai_hook)
fwd = msgs(-100777, "GOODTOKEN_SAI")
check("/send_msg lands in THE ACCOUNT'S OWN admin group, via its own bot", len(fwd) == 1 and "please call me" in fwd[0][1]["text"])
check("…and never in the owner's group", not any("please call me" in (j or {}).get("text", "") for u_, j in msgs(-100)))
A._last_admin_notify.clear(); calls.clear()
run(A.run_as_tenant("sai", A.notify_admin_error, "boom", "something broke"))
check("an account's error reaches the account's own group", any("something broke" in j["text"] for u_, j in msgs(-100777, "GOODTOKEN_SAI")))
owner_copy = [j["text"] for u_, j in msgs(-100, "OWNERTOKEN")]
check("…AND the owner's group, tagged with the account", any("sai" in t and "something broke" in t for t in owner_copy))
calls.clear(); run(A.run_as_tenant("lee", A.notify_admin_error, "boom", "lee broke"))
check("an account with no group: only the owner hears it", len(msgs(-100777)) == 0 and any("lee broke" in j["text"] for u_, j in msgs(-100, "OWNERTOKEN")))
calls.clear(); run(A.notify_admin_error("own", "owner's own problem"))
check("owner errors stay in the owner's group untagged", [j["text"] for u_, j in msgs(-100)] and "حساب" not in msgs(-100)[0][1]["text"])
calls.clear(); t_ok = c.post("/api/admin-group/test", headers=S, json={})
check("admin-group test sends through the account's bot", t_ok.status_code == 200 and len(msgs(-100777, "GOODTOKEN_SAI")) == 1)
FAIL["GOODTOKEN_SAI/sendMessage"] = "Bad Request: chat not found"
check("admin-group test reports Telegram's refusal", c.post("/api/admin-group/test", headers=S, json={}).status_code == 400); FAIL.clear()
check("admin-group test with nothing configured asks for an id", c.post("/api/admin-group/test", headers=L, json={}).status_code == 400)

# ------------------------------------------------------------------ C. own Gemini key per account
A.GEMINI_API_KEY = "OWNER_ENV_KEY"
check("owner falls back to the env key", run(A.resolve_gemini_key()) == "OWNER_ENV_KEY")
check("an account WITHOUT a key never gets the owner's", run(A.run_as_tenant("lee", A.resolve_gemini_key)) == "")
s = c.get("/api/settings", headers=S).json()
c.post("/api/settings", headers=S, json={**s, "gemini_api_key": "SAI_OWN_KEY"})
g = c.get("/api/settings", headers=S).json()
check("key stored, never returned, flag says it exists", g["gemini_api_key"] == "" and g["has_gemini_api_key"] is True and "SAI_OWN_KEY" not in json.dumps(g))
c.post("/api/settings", headers=S, json={**g, "gemini_api_key": ""}); check("blank key box keeps the stored key", run(A.run_as_tenant("sai", A.resolve_gemini_key)) == "SAI_OWN_KEY")
check("the key lives only in that account's slice", run(A.run_as_tenant("lee", A.resolve_gemini_key)) == "" and run(A.resolve_gemini_key()) == "OWNER_ENV_KEY")

c.post("/api/settings", headers=S, json={**c.get("/api/settings", headers=S).json(), "ai_mode": True})   # section B switched it off
gem_calls = []
base_post = A.http.post
async def gem_post(url, **kw):
    if "generativelanguage" in url:
        gem_calls.append(kw["headers"]["x-goog-api-key"]); return FakeResp({"candidates": [{"content": {"parts": [{"text": "AI says hi"}]}}]})
    return await base_post(url, **kw)
A.http.post = gem_post
async def seed_and_flush(tenant):
    async def go():
        await A.append_history("900", {"id": "1", "role": "user", "text": "hello", "sender": "C", "time": "1", "ts": 1, "msg_id": 1})
        A.ai_biz_ids["900"] = None
        await A.flush_ai("900")
    await A.run_as_tenant(tenant, go)
calls.clear(); run(seed_and_flush("sai"))
check("AI call uses THAT account's key", gem_calls == ["SAI_OWN_KEY"])
check("…and the reply went out through that account's bot", any("AI says hi" in (j or {}).get("text", "") for u_, j in msgs(900, "GOODTOKEN_SAI")))
gem_calls.clear(); calls.clear(); A._last_admin_notify.clear(); run(seed_and_flush("lee"))
check("account without a key: no Gemini call, nothing sent to the customer", gem_calls == [] and not msgs(900, "GOODTOKEN_LEE"))
check("…but the admins are told why", any("کلید Gemini" in j["text"] for u_, j in msgs(-100, "OWNERTOKEN")))
c.post("/api/settings", headers=S, json={**g, "owner_user_id": "4242", "admin_group_id": "-100777", "gemini_api_key": "SAI_OWN_KEY"})
c.post("/api/settings", headers=S, json={"clear_gemini_api_key": True})   # a PARTIAL save
_after = c.get("/api/settings", headers=S).json()
check("partial save (just clearing the key) keeps owner id + admin group", _after["owner_user_id"] == "4242" and _after["admin_group_id"] == "-100777")
c.post("/api/settings", headers=S, json={"gemini_api_key": "SAI_OWN_KEY"}); c.post("/api/settings", headers=S, json={**g, "clear_gemini_api_key": True}); check("explicit clear removes the key", run(A.run_as_tenant("sai", A.resolve_gemini_key)) == "")
A.http.post = base_post

# ------------------------------------------------------------------ D. account holder detected from the business connection
c.post("/api/settings", headers=S, json={**c.get("/api/settings", headers=S).json(), "owner_user_id": "", "ai_mode": True})
BIZ["conn1"] = 900900
def biz_upd(frm, text, mid):
    return {"update_id": mid, "business_message": {"message_id": mid, "business_connection_id": "conn1", "chat": {"id": 555, "type": "private", "first_name": "Customer Joe"},
            "from": {"id": frm, "first_name": "Sai (me)" if frm == 900900 else "Customer Joe"}, "text": text, "date": 1}}
c.post(f"/webhook/{sec_sai}", json=biz_upd(555, "hi, do you have it?", 10), headers=H_sai_hook)
c.post(f"/webhook/{sec_sai}", json=biz_upd(900900, "yes, sending now", 11), headers=H_sai_hook)
h = [(m_["role"], m_["text"]) for m_ in c.get("/api/chat?id=555", headers=S).json()]
check("customer = user, account holder = owner — no id typed anywhere", h == [("user", "hi, do you have it?"), ("owner", "yes, sending now")])
check("holder's own message doesn't rename the chat to the holder's name", [x["title"] for x in c.get("/api/chats", headers=S).json() if x["id"] == "555"] == ["Customer Joe"])
check("holder's id was learned and saved for next time", c.get("/api/settings", headers=S).json()["owner_user_id"] == "900900")
scheduled = []
_orig_sched = A.schedule_ai_flush
async def _rec(chat_id, biz): scheduled.append((A.current_tenant.get(), chat_id))
A.schedule_ai_flush = _rec
c.post(f"/webhook/{sec_sai}", json={**biz_upd(900900, "only me talking", 20), "update_id": 20}, headers=H_sai_hook)   # chat 555 again, holder only
holder_only = {"update_id": 21, "business_message": {"message_id": 21, "business_connection_id": "conn1", "chat": {"id": 556, "type": "private", "first_name": "Other Customer"},
               "from": {"id": 900900, "first_name": "Sai (me)"}, "text": "I write first here", "date": 1}}
c.post(f"/webhook/{sec_sai}", json=holder_only, headers=H_sai_hook)
cust_only = {"update_id": 22, "business_message": {"message_id": 22, "business_connection_id": "conn1", "chat": {"id": 557, "type": "private", "first_name": "Third"},
             "from": {"id": 557, "first_name": "Third"}, "text": "hello?", "date": 1}}
c.post(f"/webhook/{sec_sai}", json=cust_only, headers=H_sai_hook)
check("AI is NOT scheduled for the account holder's own messages", ("sai", "556") not in scheduled and ("sai", "555") not in scheduled[-1:])
check("…but IS scheduled for a customer's message (control)", ("sai", "557") in scheduled)
A.schedule_ai_flush = _orig_sched
BIZ["conn1"] = 1
c.post(f"/webhook/{sec_sai}", json=biz_upd(900900, "second (cache must not break)", 12), headers=H_sai_hook)
check("detection is cached per connection", [m_["role"] for m_ in c.get("/api/chat?id=555", headers=S).json()][-1] == "owner")

# ------------------------------------------------------------------ E. settings hygiene
legacy = {**json.loads(run(A.kv.get("GLOBAL_SETTINGS")) or "{}"), "system_email": "x@y.com", "system_email_password": "OLDSECRET", "smtp_host": "h", "email_provider": "resend"}
run(A.kv.put("GLOBAL_SETTINGS", json.dumps(legacy)))
g = c.get("/api/settings", headers=O).json()
check("legacy email credentials are never served", not any(k in g for k in ("system_email", "system_email_password", "smtp_host", "email_provider")))
c.post("/api/settings", headers=O, json=g)
check("…and a save scrubs them from storage", "OLDSECRET" not in open(os.path.join(os.environ["DATA_DIR"], "GLOBAL_SETTINGS.dat")).read())

# ------------------------------------------------------------------ F. bot profile
p = c.get("/api/bot-profile", headers=S).json()
check("bot profile shows current id/username/name/descriptions", p["connected"] and p["username"] == "bot_goodtoken_sai" and p["id"] == 777 and p["name"] == "Name of GOODTOKEN_SAI" and "Full desc" in p["description"] and "Short of" in p["short_description"])
run(A.handle_admin_command("-100", "/deleteuser lee", None)); run(A.handle_admin_command("-100", "/signup nobot pw123456", None))
NB = tokh(login("nobot", "pw123456")); check("a brand-new account with no bot: connected = False", c.get("/api/bot-profile", headers=NB).json()["connected"] is False)
jpeg = b"\xff\xd8\xff\xe0" + b"0" * 200
calls.clear(); r = c.post("/api/bot-profile/photo", headers=S, files={"file": ("a.jpg", jpeg, "image/jpeg")})
sp = [(u_, j) for u_, j in calls if u_.endswith("/setMyProfilePhoto")]
check("JPG photo is sent as setMyProfilePhoto with the bot's own token", r.status_code == 200 and len(sp) == 1 and "GOODTOKEN_SAI" in sp[0][0] and json.loads(sp[0][1]["photo"]) == {"type": "static", "photo": "attach://pic"})
check("PNG rejected before touching Telegram", c.post("/api/bot-profile/photo", headers=S, files={"file": ("a.png", b"\x89PNG" + b"0" * 50, "image/png")}).status_code == 400)
check("oversized photo rejected", c.post("/api/bot-profile/photo", headers=S, files={"file": ("a.jpg", jpeg + b"0" * 5_100_000, "image/jpeg")}).status_code == 400)
check("account without a bot can't upload", c.post("/api/bot-profile/photo", headers=NB, files={"file": ("a.jpg", jpeg, "image/jpeg")}).status_code == 400)
FAIL["GOODTOKEN_SAI/setMyProfilePhoto"] = "Not Found"
r = c.post("/api/bot-profile/photo", headers=S, files={"file": ("a.jpg", jpeg, "image/jpeg")})
check("older Bot API -> explains the BotFather fallback", r.status_code == 400 and "BotFather" in r.json()["error"]); FAIL.clear()
FAIL["GOODTOKEN_SAI/setMyName"] = "Too Many Requests: retry after 3600"
r = c.post("/api/bot-profile", headers=S, json={"name": "New name"})
print("   refusal text shown to the user:", r.json()["error"])
check("a Telegram refusal is reported, not swallowed", r.status_code == 400 and r.json()["success"] is False and "محدود" in r.json()["error"] and "60" in r.json()["error"]); FAIL.clear()
calls.clear(); r = c.post("/api/bot-profile", headers=S, json={"short_description": "only this"})
check("only the fields sent are changed", r.status_code == 200 and [u_.rsplit("/", 1)[-1] for u_, j in calls] == ["setMyShortDescription"])
check("remove photo", c.delete("/api/bot-profile/photo", headers=S).status_code == 200 and any(u_.endswith("/removeMyProfilePhoto") for u_, j in calls))
print("ALL OK" if ok else "SOME FAILED")
