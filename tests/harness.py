import sys, types, os, json, asyncio, tempfile
# stub gradio + spaces (only used for the ZeroGPU startup shim)
gr = types.ModuleType("gradio")
class _B:
    def __enter__(self): return self
    def __exit__(self,*a): pass
gr.Blocks=lambda *a,**k:_B(); gr.Markdown=lambda *a,**k:None
gr.Button=lambda *a,**k:types.SimpleNamespace(click=lambda *a,**k:None); gr.Textbox=lambda *a,**k:None
gr.mount_gradio_app=lambda app,*a,**k: app
sys.modules["gradio"]=gr
sp = types.ModuleType("spaces"); sp.GPU=lambda **k:(lambda f:f); sys.modules["spaces"]=sp
os.environ.update(DATA_DIR=tempfile.mkdtemp(), BOT_TOKEN="OWNERTOKEN", WEB_PASSWORD="ownerpw", ADMIN_GROUP_ID="-100", PUBLIC_BASE_URL="https://panel.test")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # the folder that contains app.py
import app as A

calls=[]   # (url, json)
class FakeResp:
    def __init__(self, data): self._d=data; self.status_code=200; self.text=json.dumps(data); self.content=b""; self.headers={}
    def json(self): return self._d
FILES = []  # (method, files) of every multipart upload
FAIL = {}   # "TOKEN/method" -> description : makes that call return ok=False
BIZ = {}    # business_connection_id -> account holder's user id
async def fake_post(url, **kw):
    calls.append((url, kw.get("json") or kw.get("data")))
    if kw.get("files"): FILES.append((url.rsplit("/",1)[-1], kw["files"]))
    method=url.rsplit("/",1)[-1]
    tok=url.split("/bot")[1].split("/")[0]
    for k, desc in FAIL.items():
        if url.endswith(k): return FakeResp({"ok": False, "description": desc})
    j = kw.get("json") or {}
    if method=="getMe":
        return FakeResp({"ok": tok.startswith("GOOD") or tok=="OWNERTOKEN", "result":{"id": 777, "username":"bot_"+tok.lower(), "first_name":"Bot "+tok}})
    if method=="getBusinessConnection":
        bid = j.get("business_connection_id")
        return FakeResp({"ok": bid in BIZ, "result": {"user": {"id": BIZ.get(bid)}}})
    if method=="getMyName": return FakeResp({"ok":True,"result":{"name":"Name of "+tok}})
    if method=="getMyDescription": return FakeResp({"ok":True,"result":{"description":"Full desc of "+tok}})
    if method=="getMyShortDescription": return FakeResp({"ok":True,"result":{"short_description":"Short of "+tok}})
    if method in("setWebhook","deleteWebhook","deleteMessage","setMyProfilePhoto","removeMyProfilePhoto"): return FakeResp({"ok":True,"result":True})
    if method=="sendMessage": return FakeResp({"ok":True,"result":{"message_id": len(calls), "chat":{"id": j.get("chat_id")}}})
    return FakeResp({"ok":True,"result":{}})
A.http.post = fake_post
