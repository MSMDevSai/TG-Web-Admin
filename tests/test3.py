from harness import *
from starlette.testclient import TestClient
import asyncio
loop = asyncio.new_event_loop(); run = lambda c: loop.run_until_complete(c)
ok = True
def check(name, cond):
    global ok; print(("PASS " if cond else "FAIL ")+name); ok = ok and bool(cond)
c = TestClient(A.app)
tok = lambda u,p: {"Authorization": c.post("/api/login", json={"username":u,"password":p}).json()["token"]}
O = tok("owner","ownerpw")

# create via GUI endpoint
r = c.post("/api/admin/users", headers=O, json={"username":"ali","password":"alipass1","telegramId":"123456789"})
check("create user", r.status_code==200 and r.json()["success"])
check("duplicate rejected", c.post("/api/admin/users", headers=O, json={"username":"ali","password":"alipass1"}).status_code==400)
check("weak password rejected", c.post("/api/admin/users", headers=O, json={"username":"zed","password":"123"}).status_code==400)
check("bad username rejected", c.post("/api/admin/users", headers=O, json={"username":"a b","password":"abcdef"}).status_code==400)
lst = c.get("/api/admin/users", headers=O).json()["users"]
check("list shows user, no secrets", lst[0]["username"]=="ali" and lst[0]["telegram_id"]=="123456789" and not any(k in lst[0] for k in ("password_hash","salt","bot_token","webhook_secret","temp_hash")))
A_ = tok("ali","alipass1")
check("new user can log in", "Authorization" in A_)

# tenant cannot use any admin endpoint
for method, path, body in [("get","/api/admin/users",None),("post","/api/admin/users",{"username":"x1x","password":"abcdef"}),
                           ("post","/api/admin/users/ali/password",{"password":"hacked123"}),("post","/api/admin/users/ali/suspend",{"suspended":True}),
                           ("post","/api/admin/users/ali/bot",{"token":"GOODX"}),("delete","/api/admin/users/ali",None)]:
    r = getattr(c, method)(path, headers=A_, **({"json":body} if body is not None else {}))
    check(f"tenant blocked: {method.upper()} {path}", r.status_code==403)
check("owner-only list unaffected by those attempts", len(c.get("/api/admin/users", headers=O).json()["users"])==1)

# telegram id, bot, password, suspend, delete
check("bad telegram id rejected", c.post("/api/admin/users/ali/telegram-id", headers=O, json={"telegramId":"nope"}).status_code==400)
check("set telegram id", c.post("/api/admin/users/ali/telegram-id", headers=O, json={"telegramId":"555000111"}).status_code==200)
check("set bot", c.post("/api/admin/users/ali/bot", headers=O, json={"token":"GOODTOKEN_ALI"}).status_code==200)
u = c.get("/api/admin/users", headers=O).json()["users"][0]
check("list shows bot + telegram id + recovery ready", u["has_bot"] and u["bot_username"]=="bot_goodtoken_ali" and u["telegram_id"]=="555000111" and u["recovery_ready"] is True)
check("bad bot token rejected", c.post("/api/admin/users/ali/bot", headers=O, json={"token":"BAD"}).status_code==400)
check("unknown user -> 400", c.post("/api/admin/users/ghost/password", headers=O, json={"password":"abcdef12"}).status_code==400)
check("reset password kills old session", c.post("/api/admin/users/ali/password", headers=O, json={"password":"brandnew1"}).status_code==200
      and c.get("/api/chats", headers=A_).status_code==401)
check("old password fails, new works", c.post("/api/login", json={"username":"ali","password":"alipass1"}).status_code==401
      and c.post("/api/login", json={"username":"ali","password":"brandnew1"}).status_code==200)
A2 = tok("ali","brandnew1")
check("suspend", c.post("/api/admin/users/ali/suspend", headers=O, json={"suspended":True}).status_code==200
      and c.post("/api/login", json={"username":"ali","password":"brandnew1"}).json().get("suspended") is True and c.get("/api/chats", headers=A2).status_code==401)
check("unsuspend", c.post("/api/admin/users/ali/suspend", headers=O, json={"suspended":False}).status_code==200 and c.post("/api/login", json={"username":"ali","password":"brandnew1"}).status_code==200)

# GUI and Telegram commands share state
run(A.handle_admin_command("-100","/settgid ali 777888999",None))
check("telegram /settgid visible in GUI list", c.get("/api/admin/users", headers=O).json()["users"][0]["telegram_id"]=="777888999")
check("delete", c.delete("/api/admin/users/ali", headers=O).status_code==200 and c.get("/api/admin/users", headers=O).json()["users"]==[])
check("deleted user can't log in", c.post("/api/login", json={"username":"ali","password":"brandnew1"}).status_code==401)
print("ALL OK" if ok else "SOME FAILED")
