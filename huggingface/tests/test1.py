from harness import *
import asyncio, glob

async def main():
    ok = True
    def check(name, cond):
        nonlocal ok
        print(("PASS " if cond else "FAIL ")+name); ok = ok and cond

    # --- 1. admin commands (owner context) ---
    await A.handle_admin_command("-100", "/signup bob pass1234", None)
    await A.handle_admin_command("-100", "/signup carol pass5678", None)
    users = await A.get_users()
    check("signup creates users", set(users)=={"bob","carol"})
    check("password stored hashed only", "pass1234" not in json.dumps(users))
    await A.handle_admin_command("-100", "/setbot bob GOODTOKEN_BOB", None)
    await A.handle_admin_command("-100", "/setbot carol GOODTOKEN_CAROL", None)
    users = await A.get_users(); routes = await A.get_tenant_routes()
    check("setbot stores token + route", users["bob"]["bot_token"]=="GOODTOKEN_BOB" and routes.get(users["bob"]["webhook_secret"])=="bob")
    sw=[c for c in calls if c[0].endswith("/setWebhook") and "GOODTOKEN_BOB" in c[0]][-1][1]
    check("webhook url + secret_token set", sw["url"]==f"https://panel.test/webhook/{users['bob']['webhook_secret']}" and sw["secret_token"]==users["bob"]["webhook_secret"])
    await A.handle_admin_command("-100", "/setbot carol GOODTOKEN_BOB", None)
    check("same token can't attach to 2 accounts", users["carol"]["bot_token"]=="GOODTOKEN_CAROL" and (await A.get_users())["carol"]["bot_token"]=="GOODTOKEN_CAROL")
    await A.handle_admin_command("-100", "/setbot carol BADTOKEN", None)
    check("invalid token rejected", (await A.get_users())["carol"]["bot_token"]=="GOODTOKEN_CAROL")

    # --- 2. storage isolation ---
    await A.append_history("555", {"id":"1","role":"user","text":"owner secret","time":"1","ts":1})
    tok = A.current_tenant.set("bob")
    await A.append_history("555", {"id":"2","role":"user","text":"bob secret","time":"1","ts":2})
    bob_hist = await A.get_history("555")
    A.current_tenant.reset(tok)
    tok = A.current_tenant.set("carol"); carol_hist = await A.get_history("555"); A.current_tenant.reset(tok)
    owner_hist = await A.get_history("555")
    check("same chat id, 3 tenants, 3 separate histories",
          [h["text"] for h in owner_hist]==["owner secret"] and [h["text"] for h in bob_hist]==["bob secret"] and carol_hist==[])
    files = os.listdir(os.environ["DATA_DIR"])
    check("bob's data lives under T/bob/ prefix", any(f.startswith("T%2Fbob%2F") for f in files))
    check("owner keys unprefixed (existing data untouched)", any(f=="CHAT_555.dat" for f in files))

    # --- 3. telegram calls use the tenant's token ---
    calls.clear()
    tok = A.current_tenant.set("bob"); await A.tg("getMe"); A.current_tenant.reset(tok)
    await A.tg("getMe")
    check("tg() uses bob's token for bob, owner's for owner", "bot"+"GOODTOKEN_BOB" in calls[0][0] and "botOWNERTOKEN" in calls[1][0])
    tok = A.current_tenant.set("dave"); r = await A.tg("getMe"); A.current_tenant.reset(tok)
    check("tenant without bot gets clean error, no call", r["ok"] is False)

    # --- 4. in-memory state isolation ---
    la = A.chat_locks["9"]; tok=A.current_tenant.set("bob"); lb = A.chat_locks["9"]; A.current_tenant.reset(tok)
    check("per-chat locks are per-tenant", la is not lb and la is A.chat_locks["9"])

    # --- 5. delete user purges everything ---
    await A.handle_admin_command("-100", "/deleteuser bob", None)
    files = os.listdir(os.environ["DATA_DIR"])
    check("deleteuser purges bob's data", not any(f.startswith("T%2Fbob%2F") for f in files))
    check("deleteuser removes route", not any(v=="bob" for v in (await A.get_tenant_routes()).values()))
    check("deleteuser calls deleteWebhook on bob's bot", any(c[0].endswith("/deleteWebhook") and "GOODTOKEN_BOB" in c[0] for c in calls))
    check("owner data survives", [h["text"] for h in await A.get_history("555")]==["owner secret"])
    # re-signup must start clean
    await A.handle_admin_command("-100", "/signup bob newpass99", None)
    tok = A.current_tenant.set("bob"); h = await A.get_history("555"); A.current_tenant.reset(tok)
    check("re-created bob starts empty", h==[])
    print("ALL OK" if ok else "SOME FAILED")
asyncio.run(main())
