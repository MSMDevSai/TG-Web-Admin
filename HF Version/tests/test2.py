from harness import *
from starlette.testclient import TestClient
import asyncio

loop = asyncio.new_event_loop()
def run(coro): return loop.run_until_complete(coro)
ok = True
def check(name, cond):
    global ok
    print(("PASS " if cond else "FAIL ")+name); ok = ok and bool(cond)

# accounts via the real admin-command path
run(A.handle_admin_command("-100", "/signup bob pass1234", None))
run(A.handle_admin_command("-100", "/signup carol pass5678", None))
run(A.handle_admin_command("-100", "/setbot bob GOODTOKEN_BOB", None))
run(A.handle_admin_command("-100", "/setbot carol GOODTOKEN_CAROL", None))
users = run(A.get_users()); bob_secret = users["bob"]["webhook_secret"]; carol_secret = users["carol"]["webhook_secret"]

c = TestClient(A.app)
def login(u,p):
    return c.post("/api/login", json={"username":u,"password":p})
r_owner = login("owner","ownerpw"); r_bob = login("bob","pass1234"); r_carol = login("carol","pass5678")
check("owner/bob/carol can log in", r_owner.status_code==r_bob.status_code==r_carol.status_code==200)
H = lambda r: {"Authorization": r.json()["token"]}
check("wrong password 401", login("bob","nope").status_code==401)
check("no token 401", c.get("/api/chats").status_code==401)

# webhook: wrong/missing secret rejected, right secret accepted -> lands in the right tenant
def upd(chat, text, mid=1):
    return {"update_id": mid, "message": {"message_id": mid, "chat":{"id":chat,"type":"private","first_name":"Customer"},
            "from":{"id":chat,"first_name":"Customer"}, "text": text, "date": 1}}
# turn AI off for both tenants + owner so no Gemini timers
for r in (r_owner, r_bob, r_carol):
    s = c.get("/api/settings", headers=H(r)).json(); s["ai_mode"]=False
    check("settings save ok", c.post("/api/settings", headers=H(r), json=s).status_code==200)
check("webhook wrong secret header -> 403", c.post(f"/webhook/{bob_secret}", json=upd(111,"hi"), headers={"X-Telegram-Bot-Api-Secret-Token":"wrong"}).status_code==403)
check("webhook unknown path -> 403", c.post("/webhook/nonsense", json=upd(111,"hi"), headers={"X-Telegram-Bot-Api-Secret-Token":"nonsense"}).status_code==403)
check("owner bot can't be hit via tenant path with bob's secret on carol's path", c.post(f"/webhook/{carol_secret}", json=upd(111,"hi"), headers={"X-Telegram-Bot-Api-Secret-Token":bob_secret}).status_code==403)
sec = lambda s: {"X-Telegram-Bot-Api-Secret-Token": s}
check("bob webhook ok", c.post(f"/webhook/{bob_secret}", json=upd(111,"I am bob's customer",1), headers=sec(bob_secret)).status_code==200)
check("carol webhook ok (SAME chat id 111)", c.post(f"/webhook/{carol_secret}", json=upd(111,"I am carol's customer",1), headers=sec(carol_secret)).status_code==200)
check("owner webhook ok (SAME chat id 111)", c.post("/webhook", json=upd(111,"I am owner's customer",1)).status_code==200)

def chats(r): return c.get("/api/chats", headers=H(r)).json()
def hist(r, chat): return [m["text"] for m in c.get(f"/api/chat?id={chat}", headers=H(r)).json()]
check("bob sees only his chat", [x["id"] for x in chats(r_bob)]==["111"] and hist(r_bob,111)==["I am bob's customer"])
check("carol sees only hers", hist(r_carol,111)==["I am carol's customer"])
check("owner sees only his", hist(r_owner,111)==["I am owner's customer"])
check("bob's chat title/preview not leaked to carol", all("bob" not in json.dumps(x).lower() for x in chats(r_carol)))

# suspended tenant: login blocked, live session killed, webhook ignored
run(A.handle_admin_command("-100", "/suspend bob", None))
check("suspended login -> 403 + flag", login("bob","pass1234").status_code==403 and login("bob","pass1234").json().get("suspended") is True)
check("suspended live session dead (401)", c.get("/api/chats", headers=H(r_bob)).status_code==401)
before = len(run(A.kv.get("CHAT_111") and asyncio.sleep(0)) or [])  # no-op, keeps style
check("suspended webhook accepted but ignored", c.post(f"/webhook/{bob_secret}", json=upd(111,"while suspended",2), headers=sec(bob_secret)).status_code==200)
run(A.handle_admin_command("-100", "/unsuspend bob", None))
r_bob2 = login("bob","pass1234"); check("unsuspend -> can log in", r_bob2.status_code==200)
check("nothing was recorded during suspension", hist(r_bob2,111)==["I am bob's customer"])

# settings are per account
s = c.get("/api/settings", headers=H(r_bob2)).json()
c.post("/api/settings", headers=H(r_bob2), json={**s, "ai_mode": False, "system_prompt": "bob prompt"})
check("tenant saves his own settings", c.get("/api/settings", headers=H(r_bob2)).json()["system_prompt"] == "bob prompt")
check("…which don't touch the owner's", c.get("/api/settings", headers=H(r_owner)).json()["system_prompt"] != "bob prompt")

# admin commands: password never recorded anywhere (the bug I found)
calls.clear()
upd_cmd = {"update_id": 9, "message": {"message_id": 50, "chat":{"id":-100,"type":"supergroup","title":"Admins"}, "from":{"id":42,"first_name":"Me"}, "text":"/signup dave topsecret99", "date":1}}
s = c.get("/api/settings", headers=H(r_owner)).json(); s["owner_user_id"]="42"
c.post("/api/settings", headers=H(r_owner), json=s)
check("owner cmd webhook ok", c.post("/webhook", json=upd_cmd).status_code==200)
check("dave created from a real webhook update", "dave" in run(A.get_users()))
blob = " ".join(open(os.path.join(os.environ["DATA_DIR"], f)).read() for f in os.listdir(os.environ["DATA_DIR"]) if not f.startswith("PANEL_USERS"))
check("password text appears in NO stored history/index/push data", "topsecret99" not in blob)
check("command message got deleted from the group", any(u.endswith("/deleteMessage") and j.get("message_id")==50 for u,j in calls))
# a non-owner in the admin group can't run it
upd_cmd2 = {"update_id": 10, "message": {"message_id": 51, "chat":{"id":-100,"type":"supergroup","title":"Admins"}, "from":{"id":99,"first_name":"Mallory"}, "text":"/signup mallory hunter222", "date":1}}
c.post("/webhook", json=upd_cmd2)
check("non-owner member can't /signup", "mallory" not in run(A.get_users()))
# tenant's own bot can't run admin commands even from a chat with the admin group's id
upd_cmd3 = {"update_id": 11, "message": {"message_id": 52, "chat":{"id":-100,"type":"supergroup","title":"x"}, "from":{"id":42,"first_name":"Me"}, "text":"/signup eve evepass123", "date":1}}
c.post(f"/webhook/{carol_secret}", json=upd_cmd3, headers=sec(carol_secret))
check("admin commands via a tenant webhook are ignored", "eve" not in run(A.get_users()))
# /send_msg isn't forwarded into the owner's admin group from a tenant bot
calls.clear()
c.post(f"/webhook/{carol_secret}", json=upd(222,"/send_msg hello owner",5), headers=sec(carol_secret))
check("tenant /send_msg never reaches owner admin group", not any(j and str(j.get("chat_id"))=="-100" and "hello owner" in str(j.get("text")) for u,j in calls))
print("ALL OK" if ok else "SOME FAILED")
