"""
Telegram bot + admin panel: port of the Cloudflare Worker to Python (FastAPI).
Runs on a Hugging Face Gradio/ZeroGPU Space (the tiny Gradio app at the bottom
only exists to satisfy the ZeroGPU startup check).
"""
import os

# Gradio's SSR mode (default on Spaces) starts a Node server that can hold port 7860.
# We run our own uvicorn on 7860, so it must be off. Set before importing gradio.
os.environ["GRADIO_SSR_MODE"] = "False"

import asyncio
import base64
import contextvars
import hashlib
import json
import logging
import re
import secrets
import socket
import time
from collections import OrderedDict, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

import gradio as gr
import httpx
import uvicorn
from fastapi import APIRouter, BackgroundTasks, Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("tgbot")

# ---- startup diagnostics: if the container ever exits "cleanly" with no error
# (HF shows "Exit code: 0"), these lines say who loaded the file and why the
# process ended, instead of leaving an empty log. ----
import atexit
import faulthandler
import sys

faulthandler.enable()
log.info("app.py loaded: __name__=%s python=%s pid=%s", __name__, sys.version.split()[0], os.getpid())
atexit.register(lambda: log.warning("process exiting (pid=%s, __name__=%s)", os.getpid(), __name__))

BASE = Path(__file__).parent

# ----------------------------- config (Space secrets) -----------------------------
BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemma-4-26b-a4b-it")
WEB_PASSWORD = os.environ.get("WEB_PASSWORD", "")
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "")
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")  # e.g. https://panel.yourdomain.com — needed to register each tenant bot's webhook
ADMIN_GROUP_ID = os.environ.get("ADMIN_GROUP_ID", "")  # private group: /send_msg forwards here, errors are reported here too
AI_BATCH_DELAY = float(os.environ.get("AI_BATCH_DELAY", "28"))  # seconds of silence before AI answers
ASSISTANT_LABEL = os.environ.get("ASSISTANT_LABEL", "sai:dev AI Assistant:")
VAPID_SUB = os.environ.get("VAPID_SUB", "mailto:admin@example.com")

# Storage backend: prefer a mounted HF Storage Bucket (plain local folder, no
# operation limits). Falls back to Cloudflare KV over REST only if DATA_DIR is unset.
DATA_DIR = os.environ.get("DATA_DIR", "").strip()
CF_ACCOUNT_ID = os.environ.get("CF_ACCOUNT_ID", "")
CF_KV_NAMESPACE_ID = os.environ.get("CF_KV_NAMESPACE_ID", "")
CF_API_TOKEN = os.environ.get("CF_API_TOKEN", "")

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo(os.environ.get("BOT_TZ", "Asia/Tehran"))
except Exception:
    TZ = timezone(timedelta(hours=3, minutes=30))
_FA = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")


def now_str() -> str:
    return datetime.now(TZ).strftime("%H:%M").translate(_FA)


def now_ts() -> int:
    """Epoch milliseconds, used so the panel can group full history by real
    calendar day (now_str() above only ever returns a bare HH:MM with no
    date at all, which is why every day used to render as "امروز")."""
    return int(datetime.now(TZ).timestamp() * 1000)


def load_default_prompt() -> str:
    p = BASE / "prompt.txt"
    if p.exists():
        return p.read_text(encoding="utf-8")
    return "تو دستیار هوش مصنوعی sai:dev هستی. کوتاه، صمیمی و مودبانه پاسخ بده."


DEFAULT_PROMPT = load_default_prompt()
http = httpx.AsyncClient(timeout=30)


# ----------------------------- tenants -----------------------------
# Every panel account is a tenant with its own bot token and its own slice of
# storage. The tenant for the current request/task lives in a ContextVar, so
# kv.get/put, tg(), the per-chat locks/timers etc. all pick it up without
# every helper in the file needing a new parameter. "owner" is the original
# single-tenant setup: no key prefix at all, so existing data stays exactly
# where it is. Any other tenant's keys are stored as T/<username>/<key>.
# Keys starting with PANEL_ (accounts, sessions, reset tokens, webhook
# routes) are global by design.
current_tenant: contextvars.ContextVar = contextvars.ContextVar("current_tenant", default="owner")
GLOBAL_KEY_PREFIXES = ("PANEL_",)


def scoped_key(key: str) -> str:
    t = current_tenant.get()
    if t == "owner" or key.startswith(GLOBAL_KEY_PREFIXES):
        return key
    return f"T/{t}/{key}"


class TDict:
    """dict (optionally defaultdict-like) whose keys are implicitly scoped to
    the current tenant — the same Telegram chat id can exist under two
    different bots, so per-chat in-memory state must never be shared."""

    def __init__(self, factory=None):
        self._d: dict = {}
        self._factory = factory

    def _k(self, key):
        return (current_tenant.get(), key)

    def __getitem__(self, key):
        k = self._k(key)
        if k not in self._d:
            if self._factory is None:
                raise KeyError(key)
            self._d[k] = self._factory()
        return self._d[k]

    def __setitem__(self, key, value):
        self._d[self._k(key)] = value

    def get(self, key, default=None):
        return self._d.get(self._k(key), default)

    def pop(self, key, default=None):
        return self._d.pop(self._k(key), default)

    def __contains__(self, key):
        return self._k(key) in self._d


async def run_as_tenant(tenant: str, fn, *args):
    token = current_tenant.set(tenant)
    try:
        return await fn(*args)
    finally:
        current_tenant.reset(token)


async def resolve_bot_token() -> str:
    t = current_tenant.get()
    if t == "owner":
        return BOT_TOKEN
    return ((await get_users()).get(t) or {}).get("bot_token", "")


# ----------------------------- admin error reporting (throttled) -----------------------------
_last_admin_notify: dict = {}
_ADMIN_NOTIFY_COOLDOWN = 300  # seconds; avoid spamming the admin group on repeated failures


async def _post_markdown(token: str, chat_id: str, text: str):
    try:
        p = {"chat_id": chat_id, "text": text, "parse_mode": "Markdown"}
        r = await http.post(f"https://api.telegram.org/bot{token}/sendMessage", json=p)
        if r.status_code != 200:
            p.pop("parse_mode")
            await http.post(f"https://api.telegram.org/bot{token}/sendMessage", json=p)
    except Exception:
        log.exception("failed to post to admin group")


async def current_admin_group() -> str:
    """The admin group of the CURRENT account: the owner uses the
    ADMIN_GROUP_ID env var; every other account has its own, set in Settings."""
    if current_tenant.get() == "owner":
        return str(ADMIN_GROUP_ID or "")
    return str((await get_global_settings()).get("admin_group_id") or "").strip()


async def notify_admin_error(key: str, context: str, exc: Exception | None = None):
    """Error report, at most once per `key` every 5 minutes. The owner's admin
    group hears about EVERY account's errors (tagged with the account name);
    a non-owner account's own admin group hears about that account's errors too."""
    tenant = current_tenant.get()
    key = f"{tenant}:{key}"
    now = time.time()
    if now - _last_admin_notify.get(key, 0) < _ADMIN_NOTIFY_COOLDOWN:
        return
    _last_admin_notify[key] = now
    detail = f"⚠️ خطای ربات ({key}):\n{context}"
    if exc:
        detail += f"\n\n`{type(exc).__name__}: {exc}`"[:900]
    if ADMIN_GROUP_ID:
        await _post_markdown(BOT_TOKEN, ADMIN_GROUP_ID, detail if tenant == "owner" else f"👤 حساب «{tenant}»\n" + detail)
    else:
        log.error("ADMIN_GROUP_ID not set; cannot notify owner. [%s] %s | %s", key, context, exc)
    if tenant != "owner":
        try:
            gid, token = await current_admin_group(), await resolve_bot_token()
            if gid and token:
                await _post_markdown(token, gid, detail)
        except Exception:
            log.exception("failed to notify the account's own admin group")


# ----------------------------- storage (local Bucket file, or Cloudflare KV fallback) -----------------------------
class Realtime:
    """Live push channel (WebSocket) for the panel and, later, the native apps.

    It carries *hints*, never data: "the chat list changed" / "chat X changed".
    The client reacts by re-fetching through the normal, ETag-cached REST
    endpoints, so permissions, formatting and pagination stay in exactly one
    place and a dropped socket can never cause a missed or half-applied update
    (the REST poll is still there as a slow safety net).

    Hints are produced centrally in KV.put(): every write of a chat's history,
    the chat index or a chat's config announces itself, so no individual
    endpoint / webhook branch has to remember to notify. Bursts are coalesced
    into one frame per tenant per FLUSH_DELAY."""
    FLUSH_DELAY = 0.05

    def __init__(self):
        self.conns: dict = defaultdict(set)      # tenant -> {WebSocket}
        self.pending: dict = {}                  # tenant -> {"chats": bool, "chat": set[str]}
        self.flushing: set = set()
        # Change log behind GET /api/sync: a per-tenant counter plus "last counter value at which X changed".
        # Kept in memory on purpose — `epoch` is new on every process start, so a cursor from before a restart
        # is recognised and the client simply does one full refresh instead of trusting a log that is gone.
        self.epoch = secrets.token_hex(4)
        self.seq: dict = defaultdict(int)
        self.index_rev: dict = defaultdict(int)
        self.chat_rev: dict = defaultdict(dict)

    def cursor(self, tenant: str) -> str:
        return f"{self.epoch}:{self.seq[tenant]}"

    def changes_since(self, tenant: str, cursor: str):
        """What changed after `cursor`; None = cursor unusable (other epoch / malformed) → caller must full-refresh."""
        try:
            epoch, n = str(cursor).split(":")
            n = int(n)
        except ValueError:
            return None
        if epoch != self.epoch or n < 0 or n > self.seq[tenant]:
            return None
        return {"index": self.index_rev[tenant] > n,
                "chats": [c for c, r in self.chat_rev[tenant].items() if r > n]}

    def publish(self, tenant: str, chats: bool = False, chat_id=None):
        # always recorded (even with nobody connected) so an offline client can sync later
        self.seq[tenant] += 1
        if chats:
            self.index_rev[tenant] = self.seq[tenant]
        if chat_id:
            self.chat_rev[tenant][str(chat_id)] = self.seq[tenant]
        if not self.conns.get(tenant):
            return
        p = self.pending.setdefault(tenant, {"chats": False, "chat": set()})
        if chats:
            p["chats"] = True
        if chat_id:
            p["chat"].add(str(chat_id))
        if tenant in self.flushing:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        self.flushing.add(tenant)
        loop.create_task(self._flush(tenant))

    async def _flush(self, tenant: str):
        await asyncio.sleep(self.FLUSH_DELAY)
        self.flushing.discard(tenant)
        p = self.pending.pop(tenant, None)
        if not p:
            return
        frame = json.dumps({"t": "dirty", "chats": p["chats"], "chat": sorted(p["chat"]), "cursor": self.cursor(tenant)}, ensure_ascii=False)
        for ws in list(self.conns.get(tenant, ())):
            try:
                await ws.send_text(frame)
            except Exception:
                self.conns[tenant].discard(ws)

    async def kick(self, tenant: str):
        """Drop a user's sockets (their sessions were revoked); live clients re-auth on reconnect."""
        for ws in list(self.conns.get(tenant, ())):
            try:
                await ws.close(code=4401)
            except Exception:
                pass
        self.conns.pop(tenant, None)


realtime = Realtime()


class KV:
    """Write-through cache in front of a storage backend.
    - local (preferred): a mounted HF Storage Bucket, used as a plain folder — no
      operation limits, no network round-trip.
    - cloudflare (fallback): Cloudflare KV over REST, used only if DATA_DIR isn't set.
      Free-tier KV caps out at ~1,000 writes/day, which a chat bot burns through fast."""

    def __init__(self):
        self.cache: dict = {}
        self.locks: defaultdict = defaultdict(asyncio.Lock)
        self.backend = "none"

        if DATA_DIR:
            try:
                self.dir = Path(DATA_DIR)
                self.dir.mkdir(parents=True, exist_ok=True)
                probe = self.dir / ".write_test"
                probe.write_text("ok", encoding="utf-8")
                probe.unlink(missing_ok=True)
                self.backend = "local"
                log.info("KV backend: local bucket at %s", self.dir)
            except Exception as e:
                log.error("DATA_DIR (%s) is not writable, falling back: %s", DATA_DIR, e)

        if self.backend == "none" and CF_ACCOUNT_ID and CF_KV_NAMESPACE_ID and CF_API_TOKEN:
            self.base = (
                f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}"
                f"/storage/kv/namespaces/{CF_KV_NAMESPACE_ID}/values"
            )
            self.headers = {"Authorization": f"Bearer {CF_API_TOKEN}"}
            self.backend = "cloudflare"
            log.info("KV backend: Cloudflare KV (fallback)")

        if self.backend == "none":
            log.error("No storage backend configured (set DATA_DIR, or the CF_* secrets). Data will not persist.")

    @staticmethod
    def _announce(raw_key: str):
        """Turn a write of a chat-related key into a realtime hint for the current tenant."""
        if raw_key == "CHAT_INDEX" or raw_key.startswith("CHAT_CFG_"):
            realtime.publish(current_tenant.get(), chats=True)
        elif raw_key.startswith("CHAT_"):
            realtime.publish(current_tenant.get(), chat_id=raw_key[5:])

    def _path(self, key: str) -> Path:
        return self.dir / (quote(key, safe="") + ".dat")

    async def get(self, key: str):
        key = scoped_key(key)
        if key in self.cache:
            return self.cache[key]
        value = None
        if self.backend == "local":
            value = await self._local_get(key)
        elif self.backend == "cloudflare":
            value = await self._cf_get(key)
        self.cache[key] = value
        return value

    async def put(self, key: str, value: str, ttl: int | None = None) -> bool:
        self._announce(key)
        key = scoped_key(key)
        self.cache[key] = value
        if self.backend == "local":
            return await self._local_put(key, value)
        elif self.backend == "cloudflare":
            return await self._cf_put(key, value, ttl)
        await notify_admin_error("kv_no_backend", f"ذخیره‌سازی برای کلید {key} انجام نشد: هیچ بک‌اندی تنظیم نشده.")
        return False

    async def purge_prefix(self, prefix: str):
        """Erases every stored key starting with `prefix` (a deleted tenant's
        whole slice). Returns the number removed, or None when the backend
        (Cloudflare KV fallback) has no cheap way to list/delete by prefix."""
        for k in [k for k in self.cache if k.startswith(prefix)]:
            self.cache.pop(k, None)
        if self.backend != "local":
            return None
        pattern = quote(prefix, safe="") + "*.dat"

        def _rm():
            n = 0
            for p in self.dir.glob(pattern):
                p.unlink(missing_ok=True)
                n += 1
            return n

        return await asyncio.to_thread(_rm)

    async def _local_get(self, key: str):
        async with self.locks[key]:
            p = self._path(key)
            if not p.exists():
                return None
            try:
                return await asyncio.to_thread(p.read_text, encoding="utf-8")
            except Exception as e:
                log.error("LocalKV get %s failed: %s", key, e)
                await notify_admin_error("kv_local_get", f"خواندن {key} از Storage Bucket شکست خورد.", e)
                return None

    async def _local_put(self, key: str, value: str) -> bool:
        async with self.locks[key]:
            p = self._path(key)
            tmp = p.with_suffix(p.suffix + ".tmp")
            try:
                await asyncio.to_thread(tmp.write_text, value, encoding="utf-8")
                await asyncio.to_thread(os.replace, str(tmp), str(p))
                return True
            except Exception as e:
                log.error("LocalKV put %s failed: %s", key, e)
                await notify_admin_error("kv_local_put", f"نوشتن {key} روی Storage Bucket شکست خورد.", e)
                return False

    async def _cf_get(self, key: str):
        try:
            r = await http.get(f"{self.base}/{quote(key, safe='')}", headers=self.headers)
            if r.status_code == 404:
                return None
            if r.status_code == 200:
                return r.text
            log.error("KV get %s -> %s %s", key, r.status_code, r.text[:200])
            await notify_admin_error("kv_cf_get", f"خواندن {key} از Cloudflare KV شکست خورد ({r.status_code}).")
            return None
        except Exception as e:
            log.error("KV get %s failed: %s", key, e)
            await notify_admin_error("kv_cf_get_exc", f"خواندن {key} از Cloudflare KV با خطا مواجه شد.", e)
            return None

    async def _cf_put(self, key: str, value: str, ttl: int | None) -> bool:
        params = {"expiration_ttl": max(60, ttl)} if ttl else None
        try:
            r = await http.put(
                f"{self.base}/{quote(key, safe='')}",
                headers={**self.headers, "Content-Type": "text/plain"},
                params=params,
                content=value.encode("utf-8"),
            )
            if r.status_code == 200:
                return True
            log.error("KV put %s -> %s %s", key, r.status_code, r.text[:200])
            await notify_admin_error(
                "kv_cf_put",
                f"نوشتن {key} روی Cloudflare KV شکست خورد ({r.status_code}). "
                "احتمالاً سقف روزانه‌ی نوشتن (۱۰۰۰ عملیات) پر شده — بهتره به Storage Bucket سوییچ کنی.",
            )
            return False
        except Exception as e:
            log.error("KV put %s failed: %s", key, e)
            await notify_admin_error("kv_cf_put_exc", f"نوشتن {key} روی Cloudflare KV با خطا مواجه شد.", e)
            return False


kv = KV()
chat_locks = TDict(asyncio.Lock)
index_lock = asyncio.Lock()
bg_tasks: set = set()


async def send_and_log(chat_id: str, text: str, biz_id=None, *, role: str = "bot_auto",
                        sender_label: str = "ربات", title=None, is_group=None,
                        reply_to: int | None = None) -> dict:
    """Sends a text message as the bot/business-connection AND records it in
    local history + the sidebar index — so anything the bot says on its own
    (welcome message, /send_msg confirmation, error notices, AI replies) is
    visible in the panel too, not just messages sent manually from the UI."""
    res = await send_tg(chat_id, text, biz_id, reply_to=reply_to)
    if res.get("ok"):
        msg_id = (res.get("result") or {}).get("message_id")
        await append_history(chat_id, {
            "id": str(int(datetime.now().timestamp() * 1000)),
            "msg_id": msg_id, "role": role, "text": text, "sender": sender_label, "time": now_str(), "ts": now_ts(),
        })
        await update_index(chat_id, text, sender_label, title, biz_id,
                            is_group=is_group, bot_direct=(biz_id is None))
    return res

# per-chat AI debounce state
ai_timers = TDict()
ai_biz_ids = TDict()


def track(coro):
    t = asyncio.create_task(coro)
    bg_tasks.add(t)
    t.add_done_callback(bg_tasks.discard)
    return t


# ----------------------------- data helpers -----------------------------
def fmt_id(x) -> str:
    if not x:
        return ""
    x = str(x).strip()
    if re.fullmatch(r"-?\d+", x):
        return x
    return x if x.startswith("@") else f"@{x}"


async def get_global_settings() -> dict:
    s = {
        "ai_mode": True,
        "system_prompt": DEFAULT_PROMPT,
        "poll_interval": 3000,
        "gemini_model": GEMINI_MODEL,
        "batch_delay_seconds": AI_BATCH_DELAY,
        "owner_user_id": "",  # your own Telegram numeric user id, for group-message attribution
        "sticker_packs": "",  # comma-separated sticker-set short names for the composer's sticker panel
        "gemini_api_key": "",  # each account uses its OWN Google AI Studio key (owner falls back to the GEMINI_API_KEY env)
        "admin_group_id": "",  # this account's own admin group: /send_msg + error reports (owner uses ADMIN_GROUP_ID env)
    }
    raw = await kv.get("GLOBAL_SETTINGS")
    if raw:
        s.update(json.loads(raw))
    return s


async def get_chat_config(chat_id) -> dict:
    if not chat_id:
        return {"ai_mode": True, "system_prompt": ""}
    raw = await kv.get(f"CHAT_CFG_{chat_id}")
    return json.loads(raw) if raw else {"system_prompt": ""}


async def get_history(chat_id) -> list:
    raw = await kv.get(f"CHAT_{chat_id}")
    return json.loads(raw) if raw else []


HISTORY_MAX_MESSAGES = None  # no cap — every message (and every voice/photo/
# video/sticker file_id alongside it) is kept, regardless of how long or
# heavy a chat gets. There used to be a cap here (first 60, then 5000); both
# silently deleted older messages once a chat passed that size.


async def append_history(chat_id: str, item: dict) -> list:
    async with chat_locks[chat_id]:
        h = await get_history(chat_id)
        h.append(item)
        if HISTORY_MAX_MESSAGES:
            h = h[-HISTORY_MAX_MESSAGES:]
        await kv.put(f"CHAT_{chat_id}", json.dumps(h, ensure_ascii=False), ttl=604800)
        return h


async def get_index() -> list:
    raw = await kv.get("CHAT_INDEX")
    return json.loads(raw) if raw else []


async def update_index(chat_id, last_text, last_sender, title=None, biz_id=None,
                        is_group=None, bot_direct=None):
    """`bot_direct=True` records that the bot has a plain (non-business) chat
    with this id — i.e. it can sendMessage there directly. This is sticky
    (once True, always True) so it doesn't flicker as different message
    types come in. `is_group` and `business_connection_id` are likewise only
    ever written when actually known, never cleared."""
    async with index_lock:
        index = await get_index()
        item = next((i for i in index if i["id"] == chat_id), None)
        if not item:
            item = {"id": chat_id, "title": title or f"چت {chat_id}"}
        item["last_text"] = last_text
        item["last_sender"] = last_sender
        item["time"] = now_str()
        if title:
            item["title"] = title
        if biz_id:
            item["business_connection_id"] = biz_id
        if is_group is not None:
            item["is_group"] = is_group
        if bot_direct:
            item["has_bot_chat"] = True
        index = [i for i in index if i["id"] != chat_id]
        index.insert(0, item)
        # No cap, on purpose: this used to silently keep only the 50
        # most-recently-active chats and drop the rest from the sidebar list
        # — the chat's actual history was still there in storage, it just
        # became impossible to find or open. Every chat stays listed now,
        # however many there are.
        await kv.put("CHAT_INDEX", json.dumps(index, ensure_ascii=False))


# ----------------------------- Telegram helpers -----------------------------
def humanize_tg_error(desc: str | None) -> str:
    """Telegram's raw API error strings are in English and often confusing
    (e.g. "Forbidden: bot can't initiate conversation with a user" when the
    panel tried to send "as bot" to someone who only ever talked to the
    connected Business account). Translate the common ones."""
    if not desc:
        return "خطای نامشخصی از تلگرام دریافت شد."
    d = desc.lower()
    if "can't initiate conversation" in d or "bot can't initiate" in d:
        return ("این کاربر مستقیماً به ربات پیام نداده (فقط با اکانت بیزینسی چت کرده)، "
                "پس ربات نمی‌تونه بهش پیام شروع کنه. حالت ارسال «من» رو انتخاب کن.")
    if "chat not found" in d:
        return "این چت/کاربر پیدا نشد. شناسه رو بررسی کن."
    if "bot was blocked" in d or ("blocked" in d and "user" in d):
        return "کاربر ربات رو بلاک کرده."
    if "not enough rights" in d or "have no rights" in d or "not enough permission" in d:
        return "ربات دسترسی لازم رو نداره (باید ادمین گروه باشه)."
    if "business connection" in d and ("not found" in d or "invalid" in d or "expired" in d):
        return "اتصال بیزینسی معتبر نیست یا قطع شده."
    if "message to edit not found" in d:
        return "پیام اصلی برای ویرایش پیدا نشد (شاید حذف شده)."
    if "message can't be deleted" in d or "message to delete not found" in d:
        return "این پیام قابل حذف نیست یا قبلاً حذف شده."
    if "too many requests" in d:
        m = re.search(r"retry after (\d+)", d)
        wait = f" (حدود {max(1, int(m.group(1)) // 60)} دقیقه‌ی دیگر)" if m else ""
        return "تلگرام این تغییر را موقتاً محدود کرده؛ بعداً دوباره امتحان کن" + wait + "."
    return desc


async def tg(method: str, payload: dict | None = None) -> dict:
    token = await resolve_bot_token()
    if not token:
        return {"ok": False, "description": "برای این حساب هنوز رباتی متصل نشده است."}
    try:
        r = await http.post(f"https://api.telegram.org/bot{token}/{method}", json=payload or {})
        return r.json()
    except Exception as e:
        log.error("tg %s failed: %s", method, e)
        return {"ok": False, "description": str(e)}


async def send_tg(chat_id, text, biz_id=None, reply_to: int | None = None) -> dict:
    p = {"chat_id": chat_id, "text": text, "parse_mode": "Markdown"}
    if biz_id:
        p["business_connection_id"] = biz_id
    if reply_to:
        p["reply_parameters"] = {"message_id": int(reply_to), "allow_sending_without_reply": True}
    res = await tg("sendMessage", p)
    if not res.get("ok") and "parse" in (res.get("description") or "").lower():
        p.pop("parse_mode")
        res = await tg("sendMessage", p)
    return res


async def send_media_tg(chat_id, method: str, field: str, filename: str, content: bytes,
                         mime: str, caption: str = "", biz_id=None, reply_to: int | None = None) -> dict:
    """multipart upload to sendPhoto/sendVideo/sendVoice/sendDocument."""
    data = {"chat_id": str(chat_id)}
    if caption:
        data["caption"] = caption
    if biz_id:
        data["business_connection_id"] = biz_id
    if reply_to:
        data["reply_parameters"] = json.dumps({"message_id": int(reply_to), "allow_sending_without_reply": True})
    token = await resolve_bot_token()
    if not token:
        return {"ok": False, "description": "برای این حساب هنوز رباتی متصل نشده است."}
    try:
        r = await http.post(
            f"https://api.telegram.org/bot{token}/{method}",
            data=data,
            files={field: (filename, content, mime)},
            timeout=120,
        )
        return r.json()
    except Exception as e:
        log.error("send_media_tg %s failed: %s", method, e)
        return {"ok": False, "description": str(e)}


_bot_id_cache: dict = {}


async def get_bot_id() -> int | None:
    """Cached bot user id, needed to tell "my reaction" apart from the contact's."""
    tkey = current_tenant.get()
    if tkey in _bot_id_cache:
        return _bot_id_cache[tkey]
    res = await tg("getMe")
    bid = (res.get("result") or {}).get("id") if res.get("ok") else None
    if bid:
        _bot_id_cache[tkey] = bid
    return bid


async def edit_tg(chat_id, message_id, text, biz_id=None) -> dict:
    p = {"chat_id": chat_id, "message_id": int(message_id), "text": text, "parse_mode": "Markdown"}
    if biz_id:
        p["business_connection_id"] = biz_id
    res = await tg("editMessageText", p)
    if not res.get("ok") and "parse" in (res.get("description") or "").lower():
        p.pop("parse_mode")
        res = await tg("editMessageText", p)
    return res


# ----------------------------- Web Push (VAPID) -----------------------------
def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


async def get_vapid() -> dict:
    raw = await kv.get("VAPID_KEYS")
    if raw:
        d = json.loads(raw)
        if d.get("privatePem"):
            return d
    from cryptography.hazmat.primitives import serialization
    from py_vapid import Vapid

    v = Vapid()
    v.generate_keys()
    pub = v.public_key.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    d = {"publicKey": _b64url(pub), "privatePem": v.private_pem().decode()}
    await kv.put("VAPID_KEYS", json.dumps(d))
    return d


def _push_sync(sub: dict, payload: str, pem: str):
    from py_vapid import Vapid
    from pywebpush import webpush

    webpush(
        subscription_info=sub,
        data=payload,
        vapid_private_key=Vapid.from_pem(pem.encode()),
        vapid_claims={"sub": VAPID_SUB},
        ttl=86400,
    )


async def send_push(title: str, body: str):
    try:
        raw = await kv.get("PUSH_SUBSCRIPTION")
        sub = json.loads(raw) if raw else None
        if not sub:
            return
        keys = await get_vapid()
        payload = json.dumps({"title": title, "body": body, "url": "/"}, ensure_ascii=False)
        await asyncio.to_thread(_push_sync, sub, payload, keys["privatePem"])
    except Exception as e:
        log.error("Push error: %s", e)


# ----------------------------- AI mode: single source of truth -----------------------------
async def resolve_gemini_key() -> str:
    """Every account brings its own Google AI Studio key. Only the owner may
    fall back to the shared GEMINI_API_KEY env; other accounts without a key
    simply get no AI replies (they never spend the owner's quota)."""
    own = str((await get_global_settings()).get("gemini_api_key") or "").strip()
    if own:
        return own
    return GEMINI_API_KEY if current_tenant.get() == "owner" else ""


async def get_ai_status(chat_id: str) -> tuple[bool, str, str, float]:
    """Per-chat setting always wins when explicitly set; otherwise falls back to
    the global switch/prompt. Re-read at both schedule time and flush time so a
    toggle flipped mid-wait is always respected. Model + batch delay are always
    the global (panel-configured) values — no per-chat override for those."""
    cfg = await get_chat_config(chat_id)
    gs = await get_global_settings()
    enabled = cfg["ai_mode"] if cfg.get("ai_mode") is not None else gs["ai_mode"]
    prompt = (cfg.get("system_prompt") or "").strip() or gs["system_prompt"]
    model = (gs.get("gemini_model") or GEMINI_MODEL).strip()
    delay = float(gs.get("batch_delay_seconds") or AI_BATCH_DELAY)
    return bool(enabled), prompt, model, delay


# ----------------------------- AI batching (debounce) -----------------------------
async def schedule_ai_flush(chat_id: str, biz_id):
    """Cancel any pending flush for this chat and schedule a new one. Every new
    message from the user pushes the AI reply back, so a burst of messages is
    answered once, together, ~batch_delay_seconds after the last one."""
    ai_biz_ids[chat_id] = biz_id
    old = ai_timers.get(chat_id)
    if old and not old.done():
        old.cancel()

    gs = await get_global_settings()
    delay = float(gs.get("batch_delay_seconds") or AI_BATCH_DELAY)

    async def _wait_then_flush():
        try:
            await asyncio.sleep(delay)
            await flush_ai(chat_id)
        except asyncio.CancelledError:
            pass
        finally:
            if ai_timers.get(chat_id) is asyncio.current_task():
                ai_timers.pop(chat_id, None)
            realtime.publish(current_tenant.get(), chats=True)   # indicator cleared

    ai_timers[chat_id] = asyncio.create_task(_wait_then_flush())
    realtime.publish(current_tenant.get(), chats=True)       # chat now shows "preparing a reply"


async def flush_ai(chat_id: str):
    biz_id = ai_biz_ids.get(chat_id)
    try:
        ai_on, prompt, model, _delay = await get_ai_status(chat_id)
        if not ai_on:
            return
        history = await get_history(chat_id)
        if not history:
            return

        contents = [
            {"role": "user" if h["role"] in ("user", "owner") else "model", "parts": [{"text": h["text"]}]}
            for h in history
            if h.get("text")
        ]
        if not contents:
            return

        key = await resolve_gemini_key()
        if not key:
            await notify_admin_error("gemini_key_missing", "کلید Gemini برای این حساب تنظیم نشده، پس هوش مصنوعی پاسخی نمی‌دهد (تنظیمات ← هوش مصنوعی).")
            return
        r = await http.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            headers={"x-goog-api-key": key},
            json={"systemInstruction": {"parts": [{"text": prompt}]}, "contents": contents},
            timeout=90,
        )
        data = r.json()
        parts = ((data.get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
        if not parts:
            raise RuntimeError(f"Gemini returned no parts: {str(data)[:300]}")
        answer = [p for p in parts if not p.get("thought")]
        reply = "\n".join(p.get("text", "") for p in answer) if answer else parts[-1].get("text", "")
        reply = reply.strip()
        if not reply:
            return

        branded = f"{ASSISTANT_LABEL}\n{reply}"
        res = await send_and_log(chat_id, branded, biz_id, role="model", sender_label="دستیار (AI)")
        if not res.get("ok"):
            raise RuntimeError(f"Telegram sendMessage failed: {res.get('description')}")
    except Exception as e:
        log.exception("flush_ai failed for chat %s", chat_id)
        await notify_admin_error("flush_ai", f"پردازش هوش مصنوعی برای چت `{chat_id}` شکست خورد.", e)
        try:
            await send_and_log(
                chat_id,
                "متاسفم، الان در پردازش پیامت خطایی پیش اومد 🙏 چند لحظه دیگه دوباره امتحان کن، "
                "یا برای اطمینان از دستور زیر استفاده کن:\n/send_msg <پیام>",
                biz_id,
            )
        except Exception:
            log.exception("failed to notify user about AI error")


# ----------------------------- bot commands (never go to AI) -----------------------------
async def forward_to_admin_group(msg: dict, text: str, sender_name: str) -> bool:
    gid = await current_admin_group()
    if not gid:
        log.error("no admin group configured for account %s", current_tenant.get())
        return False
    frm = msg.get("from") or {}
    uid = frm.get("id")
    username = frm.get("username")
    if username:
        link = f"[{sender_name}](https://t.me/{username})"
    elif uid:
        link = f"[{sender_name}](tg://user?id={uid})"
    else:
        link = sender_name
    formatted = f"{link}:\n{text}\n\nساعت ارسال: {now_str()}"
    res = await send_tg(gid, formatted)
    return bool(res.get("ok"))


_biz_owner_cache = TDict()


async def business_owner_id(biz_id):
    """Who owns a business connection = the account holder, as Telegram
    itself reports it. No hand-typed numeric id needed (and none to get wrong)
    to tell the account holder's own messages from their customers'."""
    if not biz_id:
        return None
    cached = _biz_owner_cache.get(biz_id)
    if cached:
        return cached
    res = await tg("getBusinessConnection", {"business_connection_id": biz_id})
    uid = ((res.get("result") or {}).get("user") or {}).get("id") if res.get("ok") else None
    if uid:
        _biz_owner_cache[biz_id] = uid
    return uid


async def _remember_owner_id(uid):
    """First time we learn the account holder's id from a business connection,
    save it (only if empty): that also makes DM detection and password
    recovery work without anyone typing the id."""
    gs = dict(await get_global_settings())
    if str(gs.get("owner_user_id") or "").strip():
        return
    gs["owner_user_id"] = str(uid)
    await kv.put("GLOBAL_SETTINGS", json.dumps(gs, ensure_ascii=False))


ADMIN_USER_COMMANDS = {"/signup", "/userlist", "/resetpass", "/suspend", "/unsuspend", "/deleteuser", "/setbot", "/settgid"}
TENANT_WEBHOOK_UPDATES = ["message", "business_connection", "business_message", "edited_business_message",
                          "deleted_business_messages", "message_reaction", "channel_post"]


# ---- account management: ONE implementation, used by both the admin-group
# commands below and the owner's graphical panel (/api/admin/users...). Each
# returns (ok, message_for_the_owner). Nothing here ever returns or logs a
# password, hash or bot token. ----
USERNAME_RE = re.compile(r"[a-zA-Z0-9_]{3,32}")


def _public_user(uname: str, u: dict) -> dict:
    return {
        "username": uname, "suspended": bool(u.get("suspended")),
        "has_bot": bool(u.get("bot_token")), "bot_username": u.get("bot_username", ""),
        "created_ts": u.get("created_ts"),
    }


TELEGRAM_ID_RE = re.compile(r"\d{1,15}")


async def _read_tenant_owner_id(username: str) -> str:
    gs = await run_as_tenant(username, get_global_settings)
    return str(gs.get("owner_user_id") or "").strip()


async def _write_tenant_owner_id(username: str, tid: str):
    async def _w():
        gs = dict(await get_global_settings())
        gs["owner_user_id"] = tid
        await kv.put("GLOBAL_SETTINGS", json.dumps(gs, ensure_ascii=False))
    await run_as_tenant(username, _w)


async def acct_list() -> list[dict]:
    out = []
    for n, u in (await get_users()).items():
        d = _public_user(n, u)
        try:
            d["telegram_id"] = await _read_tenant_owner_id(n)
        except Exception:
            d["telegram_id"] = ""
        d["recovery_ready"] = bool(d["telegram_id"] and d["has_bot"])
        out.append(d)
    return out


async def acct_create(username: str, password: str, telegram_id: str = "") -> tuple[bool, str]:
    username = (username or "").strip()
    telegram_id = (telegram_id or "").strip()
    if not USERNAME_RE.fullmatch(username):
        return False, "یوزرنیم فقط حروف لاتین/عدد/آندرلاین، ۳ تا ۳۲ کاراکتر."
    if len(password or "") < 6:
        return False, "رمز عبور باید حداقل ۶ کاراکتر باشد."
    if telegram_id and not TELEGRAM_ID_RE.fullmatch(telegram_id):
        return False, "آیدی عددی تلگرام فقط عدد است (مثل 123456789)."
    users = await get_users()
    if username in users or username in ("owner", "admin"):
        return False, f"یوزرنیم «{username}» قبلاً وجود دارد."
    digest, salt = hash_password(password)
    users[username] = {"password_hash": digest, "salt": salt, "suspended": False, "created_ts": now_ts()}
    await save_users(users)
    await kv.purge_prefix(f"T/{username}/")  # never inherit leftovers from an earlier account with this name
    if telegram_id:
        await _write_tenant_owner_id(username, telegram_id)
    return True, f"حساب «{username}» ساخته شد."


async def acct_set_password(username: str, new_password: str) -> tuple[bool, str]:
    if len(new_password or "") < 6:
        return False, "رمز عبور باید حداقل ۶ کاراکتر باشد."
    users = await get_users()
    if username not in users:
        return False, f"کاربر «{username}» پیدا نشد."
    digest, salt = hash_password(new_password)
    users[username]["password_hash"], users[username]["salt"] = digest, salt
    await save_users(users)
    await revoke_sessions_for(username)
    return True, f"رمز «{username}» تغییر کرد و از پنل خارج شد."


async def acct_set_suspended(username: str, suspended: bool) -> tuple[bool, str]:
    users = await get_users()
    if username not in users:
        return False, f"کاربر «{username}» پیدا نشد."
    users[username]["suspended"] = bool(suspended)
    await save_users(users)
    if suspended:
        await revoke_sessions_for(username)
        return True, f"«{username}» تعلیق شد."
    return True, f"تعلیق «{username}» برداشته شد."


async def acct_set_telegram_id(username: str, telegram_id: str) -> tuple[bool, str]:
    """The account holder's own Telegram id — used both to tell their own
    messages from their customers' and as the address for password recovery."""
    telegram_id = (telegram_id or "").strip()
    if telegram_id and not TELEGRAM_ID_RE.fullmatch(telegram_id):
        return False, "آیدی عددی تلگرام فقط عدد است (مثل 123456789)."
    if username not in await get_users():
        return False, f"کاربر «{username}» پیدا نشد."
    await _write_tenant_owner_id(username, telegram_id)
    return True, "آیدی تلگرام ذخیره شد." if telegram_id else "آیدی تلگرام پاک شد."


async def acct_set_bot(username: str, token: str) -> tuple[bool, str]:
    token = (token or "").strip()
    users = await get_users()
    if username not in users:
        return False, f"کاربر «{username}» پیدا نشد."
    if not PUBLIC_BASE_URL:
        return False, "متغیر PUBLIC_BASE_URL (مثلاً https://panel.yourdomain.com) روی Space تنظیم نشده؛ بدونش نمی‌شه webhook ثبت کرد."
    if not token:
        return False, "توکن ربات خالیه."
    if token == BOT_TOKEN or any(u.get("bot_token") == token for n, u in users.items() if n != username):
        return False, "این توکن قبلاً به حساب دیگری وصل شده."
    try:
        me = (await http.post(f"https://api.telegram.org/bot{token}/getMe")).json()
    except Exception:
        me = {}
    if not me.get("ok"):
        return False, "توکن نامعتبره (getMe شکست خورد)."
    secret = secrets.token_urlsafe(24)
    try:
        sw = (await http.post(f"https://api.telegram.org/bot{token}/setWebhook", json={
            "url": f"{PUBLIC_BASE_URL}/webhook/{secret}", "secret_token": secret,
            "allowed_updates": TENANT_WEBHOOK_UPDATES,
        })).json()
    except Exception as e:
        sw = {"ok": False, "description": str(e)}
    if not sw.get("ok"):
        return False, f"ثبت webhook شکست خورد: {sw.get('description')}"
    routes = await get_tenant_routes()
    old_secret, old_token = users[username].get("webhook_secret"), users[username].get("bot_token")
    if old_secret:
        routes.pop(old_secret, None)
    if old_token and old_token != token:
        try:
            await http.post(f"https://api.telegram.org/bot{old_token}/deleteWebhook")
        except Exception:
            pass
    routes[secret] = username
    await kv.put(TENANT_ROUTES_KEY, json.dumps(routes, ensure_ascii=False))
    bot_username = (me.get("result") or {}).get("username", "")
    users[username].update(bot_token=token, webhook_secret=secret, bot_username=bot_username)
    await save_users(users)
    return True, f"ربات @{bot_username} به حساب «{username}» وصل شد."


async def acct_delete(username: str) -> tuple[bool, str]:
    users = await get_users()
    if username not in users:
        return False, f"کاربر «{username}» پیدا نشد."
    gone = users.pop(username) or {}
    await save_users(users)
    await revoke_sessions_for(username)
    if gone.get("webhook_secret"):
        routes = await get_tenant_routes()
        routes.pop(gone["webhook_secret"], None)
        await kv.put(TENANT_ROUTES_KEY, json.dumps(routes, ensure_ascii=False))
    if gone.get("bot_token"):
        try:
            await http.post(f"https://api.telegram.org/bot{gone['bot_token']}/deleteWebhook")
        except Exception:
            pass
    purged = await kv.purge_prefix(f"T/{username}/")
    note = f"{purged} فایل داده پاک شد." if purged is not None else "داده‌ها پاک نشد (ذخیره‌سازی فعلی Bucket محلی نیست)."
    return True, f"کاربر «{username}» حذف شد؛ webhook ربات برداشته شد. {note}"


async def handle_admin_command(chat_id: str, text: str, biz_id):
    """Telegram-group front-end for the account services above — owner-only,
    admin-group-only (checked by the caller)."""
    async def say(msg):
        await send_and_log(chat_id, msg, biz_id)

    try:
        parts = text.strip().split()
        cmd, args = parts[0].split("@")[0].lower(), parts[1:]

        if cmd == "/userlist":
            users = await acct_list()
            if not users:
                return await say("هنوز هیچ کاربری ثبت نشده.")
            lines = [f"{u['username']} — {'🔴 تعلیق‌شده' if u['suspended'] else '🟢 فعال'} — "
                     + (f"🤖 @{u['bot_username']}" if u["has_bot"] else "⚪️ بدون ربات")
                     + (f" — 🆔 {u['telegram_id']}" if u["telegram_id"] else " — ⚠️ بدون آیدی تلگرام") for u in users]
            return await say("کاربران پنل:\n" + "\n".join(lines))

        usage = {
            "/signup": "/signup <username> <password> [telegram_id]", "/resetpass": "/resetpass <username> <newpassword>",
            "/setbot": "/setbot <username> <bot_token>", "/settgid": "/settgid <username> <telegram_id>",
            "/suspend": "/suspend <username>", "/unsuspend": "/unsuspend <username>", "/deleteuser": "/deleteuser <username>",
        }
        need = 2 if cmd in ("/signup", "/resetpass", "/setbot", "/settgid") else 1
        if len(args) < need:
            return await say("فرمت درست:\n" + usage.get(cmd, cmd))

        if cmd == "/signup":
            ok, msg = await acct_create(args[0], args[1], args[2] if len(args) > 2 else "")
            return await say((f"✅ {msg}\nبرای وصل کردن رباتش:\n/setbot {args[0]} <bot_token>") if ok else msg)
        if cmd == "/resetpass":
            ok, msg = await acct_set_password(args[0], args[1])
        elif cmd == "/setbot":
            ok, msg = await acct_set_bot(args[0], args[1])
        elif cmd == "/settgid":
            ok, msg = await acct_set_telegram_id(args[0], args[1])
        elif cmd in ("/suspend", "/unsuspend"):
            ok, msg = await acct_set_suspended(args[0], cmd == "/suspend")
        elif cmd == "/deleteuser":
            ok, msg = await acct_delete(args[0])
        else:
            return
        await say(("✅ " if ok else "") + msg)
    except Exception as e:
        log.exception("handle_admin_command failed")
        await notify_admin_error("handle_admin_command", f"دستور «{text.split()[0]}» شکست خورد.", e)


async def handle_command(chat_id: str, msg: dict, text: str, biz_id, sender_name: str):
    try:
        parts = text.strip().split(maxsplit=1)
        cmd = parts[0].split("@")[0].lower()  # strip /cmd@BotName form
        arg = parts[1].strip() if len(parts) > 1 else ""

        if cmd == "/start":
            await send_and_log(
                chat_id,
                f"{ASSISTANT_LABEL}\nسلام! من دستیار هوش مصنوعی sai:dev هستم. "
                "هر چی بنویسی می‌خونم و در جریانش می‌ذارمش. برای رسوندن پیام مهم و فوری هم از دستور زیر استفاده کن:\n"
                "/send_msg <پیام شما>",
                biz_id,
            )
            return

        if cmd == "/send_msg":
            if not arg:
                await send_and_log(
                    chat_id,
                    "لطفاً پیامت رو همراه دستور بنویس. مثال:\n/send_msg سلام، می‌خواستم در مورد ... باهات صحبت کنم.",
                    biz_id,
                )
                return
            ok = await forward_to_admin_group(msg, arg, sender_name)
            if ok:
                await send_and_log(chat_id, "پیامت با موفقیت ارسال شد ✅ به‌زودی جوابتو می‌گیری.", biz_id)
            else:
                await send_and_log(chat_id, "متاسفم، در ارسال پیام مشکلی پیش اومد. لطفاً دوباره امتحان کن.", biz_id)
                await notify_admin_error("send_msg_forward", f"فوروارد /send_msg از چت `{chat_id}` شکست خورد (آیدی گروه ادمین درست تنظیم شده و ربات عضو گروهه؟).")
            return

        await send_and_log(
            chat_id,
            "این دستور رو نمی‌شناسم. برای رسوندن پیامت به من از دستور زیر استفاده کن:\n/send_msg <پیام شما>",
            biz_id,
        )
    except Exception as e:
        log.exception("handle_command failed")
        await notify_admin_error("handle_command", f"اجرای دستور از چت `{chat_id}` شکست خورد: {text[:80]}", e)
        try:
            await send_and_log(chat_id, "متاسفم، در انجام عملیات خطایی پیش اومد. لطفاً دوباره امتحان کن.", biz_id)
        except Exception:
            pass


# ----------------------------- incoming Telegram updates -----------------------------
async def handle_update(update: dict):
    chat_id = None
    biz = None
    try:
        msg = update.get("business_message") or update.get("message") or update.get("channel_post")
        if not msg:
            return
        chat = msg["chat"]
        chat_id = str(chat["id"])
        sender = (msg.get("from") or {}).get("first_name") or chat.get("title") or "مخاطب"
        biz = msg.get("business_connection_id")
        is_group = chat.get("type") in ("group", "supergroup")

        from_id = (msg.get("from") or {}).get("id")
        gs_owner = str((await get_global_settings()).get("owner_user_id") or "").strip()
        is_configured_owner = bool(gs_owner) and str(from_id) == gs_owner   # strict: gates the admin commands
        is_owner = is_configured_owner
        if not is_owner and biz:
            bo = await business_owner_id(biz)
            if bo and str(from_id) == str(bo):
                is_owner = True
                if not gs_owner:
                    await _remember_owner_id(bo)
        # Title bug root cause: `sender` is whoever actually typed THIS
        # message — for a business chat that's the OWNER half the time, so
        # relying on it (or on correctly configuring owner_user_id) let the
        # contact's name get overwritten with the owner's own name. `chat`
        # itself is far more reliable: for a private chat, Telegram always
        # fills chat.first_name/last_name with the identity of the OTHER
        # party in that conversation — the actual contact — regardless of
        # who sent any particular message. Prefer that; fall back to
        # `sender` only if it's ever missing, and never use it for a
        # message that came from the owner.
        if is_group:
            title = chat.get("title")
        else:
            chat_name = " ".join(p for p in (chat.get("first_name"), chat.get("last_name")) if p).strip()
            title = chat_name or (None if is_owner else sender)

        text = msg.get("text") or msg.get("caption") or ""
        media_type = None
        file_id = None
        if msg.get("photo"):
            media_type, file_id = "photo", msg["photo"][-1]["file_id"]
        elif msg.get("video"):
            media_type, file_id = "video", msg["video"]["file_id"]
        elif msg.get("voice"):
            media_type, file_id = "voice", msg["voice"]["file_id"]
        elif msg.get("animation"):
            media_type, file_id = "animation", msg["animation"]["file_id"]
        elif msg.get("sticker"):
            media_type = "sticker"
            file_id = msg["sticker"]["file_id"]
            if not text:
                text = msg["sticker"].get("emoji") or "🎭"
        elif msg.get("document"):
            media_type, file_id = "document", msg["document"]["file_id"]

        if not text and not media_type:
            return  # nothing we can show/process (e.g. stickers, service messages)

        is_command = text.startswith("/")

        # Panel-account commands never touch history/index/push: /signup and
        # /resetpass carry a password and /setbot a bot token, and recording
        # them (as the first version of this did) would keep them in
        # plaintext in the chat history. Owner-only, admin-group-only, and
        # only for the owner's own tenant. The original message is deleted
        # from the group right after.
        if (is_command and current_tenant.get() == "owner" and ADMIN_GROUP_ID and is_configured_owner
                and chat_id == str(ADMIN_GROUP_ID)
                and text.split()[0].split("@")[0].lower() in ADMIN_USER_COMMANDS):
            cmd0 = text.split()[0].split("@")[0].lower()
            await handle_admin_command(chat_id, text, biz)
            if cmd0 in ("/signup", "/resetpass", "/setbot"):
                dres = await tg("deleteMessage", {"chat_id": chat_id, "message_id": msg.get("message_id")})
                if not dres.get("ok"):
                    await send_and_log(chat_id, "⚠️ نتونستم پیام دستور رو پاک کنم؛ رمز/توکن توی گروه مونده. ربات رو ادمینِ گروه با دسترسی «حذف پیام» کن و این پیام رو دستی پاک کن.", biz)
            return

        item = {
            "id": str(int(datetime.now().timestamp() * 1000)),
            "msg_id": msg.get("message_id"),
            "role": "owner" if is_owner else "user",
            "text": text, "sender": "شما" if is_owner else sender, "time": now_str(), "ts": now_ts(),
        }
        if media_type:
            item["type"] = media_type
            item["file_id"] = file_id
            if not text:
                item["text"] = {
                    "photo": "[عکس]", "video": "[ویدیو]", "voice": "[پیام صوتی]",
                    "document": "[فایل]", "animation": "[GIF]", "sticker": "🎭",
                }.get(media_type, "[رسانه]")

        reply_src = msg.get("reply_to_message")
        if reply_src:
            rtext = reply_src.get("text") or reply_src.get("caption") or "[رسانه]"
            rsender = (reply_src.get("from") or {}).get("first_name") or "پیام"
            item["reply_to_msg_id"] = reply_src.get("message_id")
            item["reply_to_preview"] = f"{rsender}: {rtext}"[:120]

        fwd_name = None
        origin = msg.get("forward_origin")
        if origin:
            otype = origin.get("type")
            if otype == "user":
                fwd_name = (origin.get("sender_user") or {}).get("first_name")
            elif otype == "hidden_user":
                fwd_name = origin.get("sender_user_name")
            elif otype == "chat":
                fwd_name = (origin.get("sender_chat") or {}).get("title")
            elif otype == "channel":
                fwd_name = (origin.get("chat") or {}).get("title")
        elif msg.get("forward_from"):
            fwd_name = msg["forward_from"].get("first_name")
        elif msg.get("forward_from_chat"):
            fwd_name = msg["forward_from_chat"].get("title")
        elif msg.get("forward_sender_name"):
            fwd_name = msg.get("forward_sender_name")
        if fwd_name:
            item["forwarded_from"] = fwd_name

        await append_history(chat_id, item)
        if media_type in ("sticker", "animation"):
            await _track_recent(
                RECENT_STICKERS_KEY if media_type == "sticker" else RECENT_GIFS_KEY,
                file_id, {"emoji": item.get("text", "")} if media_type == "sticker" else None,
            )
        preview = item["text"]
        await update_index(chat_id, preview, item["sender"], title, biz,
                            is_group=is_group, bot_direct=(biz is None))
        track(send_push(item["sender"], preview))

        if is_command:
            await handle_command(chat_id, msg, text, biz, sender)
            return
        if is_owner:
            return  # your own message in a group/chat — not a query for the AI to answer

        ai_on, _, _, _ = await get_ai_status(chat_id)
        if ai_on:
            await schedule_ai_flush(chat_id, biz)
    except Exception as e:
        log.exception("handle_update error")
        await notify_admin_error("handle_update", f"پردازش پیام ورودی از چت `{chat_id}` شکست خورد.", e)
        if chat_id:
            try:
                await send_and_log(chat_id, "متاسفم، در انجام عملیات خطایی پیش اومد. لطفاً دوباره امتحان کن.", biz)
            except Exception:
                log.exception("failed to notify user about update error")


# ----------------------------- incoming reaction updates -----------------------------
async def handle_message_reaction(update: dict):
    """Telegram sends this separately from `message` when someone changes their
    reaction. We only care about the contact's own reaction here — our own
    reaction (set via /api/react) is already recorded locally when we set it."""
    try:
        mr = update.get("message_reaction")
        if not mr:
            return
        chat_id = str(mr["chat"]["id"])
        message_id = mr.get("message_id")
        actor = mr.get("user") or {}
        actor_id = actor.get("id")
        bot_id = await get_bot_id()
        if actor_id and bot_id and actor_id == bot_id:
            return  # our own reaction; already tracked when we set it
        new_reaction = mr.get("new_reaction") or []
        emojis = [r.get("emoji") for r in new_reaction if r.get("type") == "emoji" and r.get("emoji")]
        value = emojis[0] if emojis else None

        async with chat_locks[chat_id]:
            history = await get_history(chat_id)
            for h in history:
                if h.get("msg_id") == message_id:
                    h["their_reaction"] = value
                    await kv.put(f"CHAT_{chat_id}", json.dumps(history, ensure_ascii=False), ttl=604800)
                    break
    except Exception as e:
        log.exception("handle_message_reaction error")
        await notify_admin_error("message_reaction", "پردازش آپدیت ری‌اکشن شکست خورد.", e)


async def convert_to_ogg_opus(content: bytes) -> bytes | None:
    """Browsers record voice as webm/opus; Telegram wants an .ogg/opus container.
    The codec is already opus, so this is a fast remux (-c:a copy), not a re-encode."""
    import subprocess
    import tempfile

    def _run():
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as fin:
            fin.write(content)
            in_path = fin.name
        out_path = in_path + ".ogg"
        try:
            r = subprocess.run(
                ["ffmpeg", "-y", "-i", in_path, "-c:a", "libopus", "-b:a", "64k", out_path],
                capture_output=True, timeout=30,
            )
            if r.returncode != 0:
                log.error("ffmpeg failed: %s", r.stderr.decode(errors="ignore")[:500])
                return None
            return Path(out_path).read_bytes()
        finally:
            for p in (in_path, out_path):
                try:
                    os.remove(p)
                except OSError:
                    pass

    try:
        return await asyncio.to_thread(_run)
    except Exception as e:
        log.error("convert_to_ogg_opus failed: %s", e)
        return None


# ----------------------------- accounts / auth -----------------------------
# Multi-tenant login: username+password (created only via /signup in the
# admin group, by the owner) instead of one shared WEB_PASSWORD for
# everyone. The owner still logs in with WEB_PASSWORD (bootstrap — there
# has to be a way in before any /signup has ever run), as a special
# "owner" pseudo-account; everyone else is a real account in PANEL_USERS.
# Session tokens (not passwords) are what the frontend actually carries
# around afterward, same as the old PASS value was used everywhere.
USERS_KEY = "PANEL_USERS"
SESSIONS_KEY = "PANEL_SESSIONS"
SESSION_MAX = 300
TEMP_PASSWORD_TTL_SECONDS = 900   # a recovery password is good for 15 minutes, once
RESET_COOLDOWN_SECONDS = 60     # at most one recovery message per account per minute


async def get_users() -> dict:
    raw = await kv.get(USERS_KEY)
    return json.loads(raw) if raw else {}


async def save_users(users: dict) -> bool:
    return await kv.put(USERS_KEY, json.dumps(users, ensure_ascii=False))


def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000).hex()
    return digest, salt


def verify_password(password: str, digest: str, salt: str) -> bool:
    check, _ = hash_password(password, salt)
    return secrets.compare_digest(check, digest)


async def get_sessions() -> dict:
    raw = await kv.get(SESSIONS_KEY)
    return json.loads(raw) if raw else {}


# "Last active" per session. The panel hits the API every few seconds, so this is NOT written per request:
# a session is stamped at most once per SESSION_TOUCH_EVERY seconds (and once after each server start), in a
# background task so the request never waits on storage. Resolution is therefore ~5 minutes — fine for a
# devices list, and a few writes per hour per signed-in device.
SESSION_TOUCH_EVERY = 300
_last_touch: dict = {}
_bg_tasks: set = set()


async def _touch_session(token: str):
    try:
        sessions = await get_sessions()
        s = sessions.get(token)
        if not s:                       # revoked meanwhile — never write a stale copy back
            return
        s["last_seen"] = now_ts()
        await kv.put(SESSIONS_KEY, json.dumps(sessions, ensure_ascii=False))
    except Exception:
        log.exception("session touch failed")


def _maybe_touch(token: str):
    now = time.time()
    if now - _last_touch.get(token, 0) < SESSION_TOUCH_EVERY:
        return
    if len(_last_touch) > 5000:
        _last_touch.clear()
    _last_touch[token] = now
    task = asyncio.get_running_loop().create_task(_touch_session(token))
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)


def _device_from(b: dict) -> dict:
    """Optional label a client may send at login:
    {"deviceName": "Pixel 8", "platform": "android" | "web" | "pwa" | "windows", "appVersion": "1.0.0"}."""
    return {"name": " ".join(str(b.get("deviceName") or "").split())[:60],
            "platform": str(b.get("platform") or "web")[:20],
            "app": str(b.get("appVersion") or "")[:20]}


def _sid(token: str) -> str:
    """Public handle for a session — safe to show in a list, useless as a credential."""
    return hashlib.sha256(token.encode()).hexdigest()[:16]


async def create_session(username: str, must_change: bool = False, device: dict | None = None) -> str:
    sessions = await get_sessions()
    token = secrets.token_urlsafe(32)
    sessions[token] = {"username": username, "created": now_ts(), "must_change": must_change, "device": device or {}}
    if len(sessions) > SESSION_MAX:
        for old_token in sorted(sessions, key=lambda t: sessions[t].get("created", 0))[: len(sessions) - SESSION_MAX]:
            sessions.pop(old_token, None)
    await kv.put(SESSIONS_KEY, json.dumps(sessions, ensure_ascii=False))
    return token


async def revoke_sessions_for(username: str):
    sessions = await get_sessions()
    sessions = {t: s for t, s in sessions.items() if s.get("username") != username}
    await kv.put(SESSIONS_KEY, json.dumps(sessions, ensure_ascii=False))
    await realtime.kick(username)


# ----------------------------- API -----------------------------
def _token_from(request: Request) -> str:
    """Raw token (what the web panel sends) or the standard `Bearer <token>`; `?auth=` for <img>/<video> URLs."""
    given = (request.headers.get("Authorization") or request.query_params.get("auth") or "").strip()
    if given[:7].lower() == "bearer ":
        given = given[7:].strip()
    return given


async def require_auth(request: Request):
    given = _token_from(request)
    if not given:
        raise HTTPException(status_code=401, detail="unauthorized")
    sessions = await get_sessions()
    session = sessions.get(given)
    if not session:
        raise HTTPException(status_code=401, detail="unauthorized")
    username = session["username"]
    if username != "owner":
        u = (await get_users()).get(username)
        if not u or u.get("suspended"):
            raise HTTPException(status_code=401, detail="unauthorized")
    request.state.username = username
    request.state.is_owner = username == "owner"
    request.state.must_change = bool(session.get("must_change"))
    _maybe_touch(given)
    if request.state.must_change and request.url.path != "/api/change-password":
        # logged in with a one-time recovery password: nothing else works
        # until a new password has been chosen
        raise HTTPException(status_code=403, detail="must_change_password")
    current_tenant.set(username)  # everything this request touches is now this tenant's


api = APIRouter(prefix="/api", dependencies=[Depends(require_auth)])
# login / logout / password-reset can't sit behind require_auth (they're
# how you GET a session in the first place) — their own router, no
# auth dependency, included into the app alongside `api` below.
public_api = APIRouter(prefix="/api")


class LoginLimiter:
    """Slows password guessing against the (public) login endpoint: after PER_KEY failed attempts for one
    client+account within WINDOW seconds, further attempts get 429 until the oldest one ages out.
    Keyed on (client address, username) so one person's typos never block someone else. Client address is
    the right-most X-Forwarded-For entry (the one our own proxy appended — the left side is client-controlled);
    if every request arrives through one shared proxy address this degrades to a per-account limit."""
    WINDOW, PER_KEY = 600, 8

    def __init__(self):
        self.fails: dict = defaultdict(list)

    @staticmethod
    def key(request: Request, username: str) -> str:
        xff = request.headers.get("x-forwarded-for", "")
        ip = xff.split(",")[-1].strip() if xff else (request.client.host if request.client else "?")
        return f"{ip}|{username.lower()}"

    def retry_after(self, key: str) -> int:
        now = time.time()
        hits = [h for h in self.fails.get(key, ()) if now - h < self.WINDOW]
        if hits:
            self.fails[key] = hits
        else:
            self.fails.pop(key, None)
        return int(self.WINDOW - (now - hits[0])) + 1 if len(hits) >= self.PER_KEY else 0

    def fail(self, key: str):
        if len(self.fails) > 5000:                    # bounded memory under a spray attack
            self.fails.clear()
        self.fails[key].append(time.time())

    def ok(self, key: str):
        self.fails.pop(key, None)


login_limiter = LoginLimiter()


@public_api.post("/login")
async def login_post(request: Request):
    b = await request.json()
    username = (b.get("username") or "").strip()
    password = b.get("password") or ""
    device = _device_from(b)
    lkey = login_limiter.key(request, username)
    wait = login_limiter.retry_after(lkey)
    if wait:
        return JSONResponse({"error": "تلاش‌های ناموفق زیاد بود؛ کمی بعد دوباره امتحان کن.", "retry_after": wait},
                            status_code=429, headers={"Retry-After": str(wait)})

    if WEB_PASSWORD and username in ("", "owner", "admin") and secrets.compare_digest(password.encode(), WEB_PASSWORD.encode()):
        login_limiter.ok(lkey)
        token = await create_session("owner", device=device)
        return {"token": token, "username": "owner", "is_owner": True}

    users = await get_users()
    u = users.get(username)
    if not u:
        login_limiter.fail(lkey)
        return JSONResponse({"error": "یوزرنیم یا رمز عبور اشتباه است."}, status_code=401)
    if u.get("suspended"):
        return JSONResponse({"error": "این حساب تعلیق شده است.", "suspended": True}, status_code=403)
    if verify_password(password, u["password_hash"], u["salt"]):
        login_limiter.ok(lkey)
        return {"token": await create_session(username, device=device), "username": username, "is_owner": False, "must_change": False}
    # not the real password — maybe the one-time recovery password the bot sent
    if (u.get("temp_hash") and u.get("temp_expires", 0) > now_ts()
            and verify_password(password, u["temp_hash"], u["temp_salt"])):
        for k in ("temp_hash", "temp_salt", "temp_expires"):
            u.pop(k, None)  # single use
        await save_users(users)
        login_limiter.ok(lkey)
        return {"token": await create_session(username, must_change=True, device=device), "username": username,
                "is_owner": False, "must_change": True}
    login_limiter.fail(lkey)
    return JSONResponse({"error": "یوزرنیم یا رمز عبور اشتباه است."}, status_code=401)


@public_api.post("/logout")
async def logout_post(request: Request):
    given = _token_from(request)
    sessions = await get_sessions()
    sessions.pop(given, None)
    await kv.put(SESSIONS_KEY, json.dumps(sessions, ensure_ascii=False))
    return {"success": True}


_TEMP_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"


async def _deliver_temp_password(username: str):
    """Runs AS the account's own tenant: the temporary password goes to the
    account holder's Telegram (their numeric id from Settings) through THEIR
    bot. The real password keeps working meanwhile (so nobody can lock an
    account out just by requesting resets), and the temporary one is hashed,
    single-use and expires after 15 minutes."""
    gs = await get_global_settings()
    tid = str(gs.get("owner_user_id") or "").strip()
    if not tid:
        await notify_admin_error("temp_password", f"رمز موقت برای «{username}» ارسال نشد: آیدی عددی تلگرام این حساب ثبت نیست (تنظیمات یا /settgid).")
        return
    temp = "".join(secrets.choice(_TEMP_ALPHABET) for _ in range(10))
    res = await send_tg(tid, f"🔐 رمز موقت ورود به پنل:\n`{temp}`\n\nتا ۱۵ دقیقه و فقط یک‌بار معتبره؛ بعد از ورود باید رمز جدید انتخاب کنی.\nاگه خودت درخواست ندادی، نادیده‌اش بگیر و رمزت رو عوض کن.")
    if not res.get("ok"):
        hint = " (کاربر باید یک بار ربات خودش را /start کند)" if "initiate" in (res.get("description") or "").lower() else ""
        await notify_admin_error("temp_password", f"رمز موقت برای «{username}» ارسال نشد: {humanize_tg_error(res.get('description'))}{hint}")
        return
    digest, salt = hash_password(temp)
    users = await get_users()  # fresh read: don't clobber other changes made meanwhile
    if username in users:
        users[username].update(temp_hash=digest, temp_salt=salt, temp_expires=now_ts() + TEMP_PASSWORD_TTL_SECONDS * 1000)
        await save_users(users)


async def _recover_password(username: str):
    users = await get_users()
    u = users.get(username)
    if not u or u.get("suspended") or not u.get("bot_token"):
        return
    if now_ts() - u.get("temp_requested_ts", 0) < RESET_COOLDOWN_SECONDS * 1000:
        return
    u["temp_requested_ts"] = now_ts()
    await save_users(users)
    await run_as_tenant(username, _deliver_temp_password, username)


@public_api.post("/request-password-reset")
async def request_password_reset(request: Request, bg: BackgroundTasks):
    b = await request.json()
    # Same work, same timing, same answer whether or not the account exists:
    # everything account-specific happens after the response is sent.
    bg.add_task(_recover_password, (b.get("username") or "").strip())
    return {"success": True, "message": "اگر حساب وجود داشته باشد، رمز موقت به تلگرام صاحب حساب ارسال شد."}


API_VERSION = 1


@public_api.get("/version")
async def api_version():
    """Lets a client check compatibility before logging in. `min_client` is the oldest app build the server
    still supports — raise it only for a breaking change, and an old app can show "please update"."""
    return {"api": API_VERSION, "min_client": 1, "server_time": now_ts()}


@api.get("/sync")
async def sync_get(cursor: str = ""):
    """Cheap "what changed since I last looked?" for apps that keep a local copy.
    Send the `cursor` from your previous sync / WebSocket `hello` / `dirty` frame. You get back which chats
    changed (re-fetch just those through the normal ETag-cached /chat) and whether the chat list itself did
    (re-fetch /chats). `reset: true` means the cursor can't be used (server restarted, or first run):
    treat everything as stale once. No await between reading changes and the cursor, so they are consistent."""
    tenant = current_tenant.get()
    ch = realtime.changes_since(tenant, cursor)
    if ch is None:
        return {"cursor": realtime.cursor(tenant), "reset": True, "index": True, "chats": []}
    return {"cursor": realtime.cursor(tenant), "reset": False, **ch}


@api.get("/sessions")
async def sessions_list(request: Request):
    """Devices signed in to this account (never includes the tokens themselves)."""
    me = _sid(_token_from(request))
    rows = [{"id": _sid(tok), "device": s.get("device") or {}, "created": s.get("created"),
             "last_seen": s.get("last_seen") or s.get("created"), "current": _sid(tok) == me}
            for tok, s in (await get_sessions()).items() if s.get("username") == request.state.username]
    return sorted(rows, key=lambda r: r["created"] or 0, reverse=True)


@api.patch("/sessions/{sid}")
async def sessions_rename(sid: str, request: Request):
    """Give one of your devices a name you'll recognise ("Work laptop", "Mom's phone")."""
    b = await request.json()
    name = " ".join(str(b.get("name") or "").split())[:60]
    if not name:
        return JSONResponse({"error": "نام نمی‌تواند خالی باشد."}, status_code=400)
    sessions = await get_sessions()
    hit = [s for tok, s in sessions.items() if s.get("username") == request.state.username and _sid(tok) == sid]
    if not hit:
        raise HTTPException(status_code=404, detail="session not found")
    for s in hit:
        s["device"] = {**(s.get("device") or {}), "name": name}
    await kv.put(SESSIONS_KEY, json.dumps(sessions, ensure_ascii=False))
    return {"success": True, "name": name}


@api.delete("/sessions/{sid}")
async def sessions_revoke(sid: str, request: Request):
    sessions = await get_sessions()
    doomed = [tok for tok, s in sessions.items() if s.get("username") == request.state.username and _sid(tok) == sid]
    if not doomed:
        raise HTTPException(status_code=404, detail="session not found")
    for tok in doomed:
        sessions.pop(tok, None)
    await kv.put(SESSIONS_KEY, json.dumps(sessions, ensure_ascii=False))
    await realtime.kick(request.state.username)     # sockets reconnect; the revoked one fails auth and stays out
    return {"success": True}


@api.post("/change-password")
async def change_password(request: Request):
    if request.state.is_owner:
        return JSONResponse({"error": "رمز مالک از متغیر WEB_PASSWORD روی Space تنظیم می‌شود."}, status_code=400)
    b = await request.json()
    new = b.get("newPassword") or ""
    if len(new) < 6:
        return JSONResponse({"error": "رمز عبور باید حداقل ۶ کاراکتر باشد."}, status_code=400)
    users = await get_users()
    u = users.get(request.state.username)
    if not u:
        return JSONResponse({"error": "حساب پیدا نشد."}, status_code=404)
    if not request.state.must_change and not verify_password(b.get("currentPassword") or "", u["password_hash"], u["salt"]):
        return JSONResponse({"error": "رمز فعلی اشتباه است."}, status_code=400)
    u["password_hash"], u["salt"] = hash_password(new)
    for k in ("temp_hash", "temp_salt", "temp_expires"):
        u.pop(k, None)
    await save_users(users)
    await revoke_sessions_for(request.state.username)  # every other device signs out
    return {"success": True, "token": await create_session(request.state.username)}


# ---- owner-only account management for the graphical panel ----
def _owner_only(request: Request):
    if not request.state.is_owner:
        raise HTTPException(status_code=403, detail="owner only")


def _res(ok_msg):
    ok, msg = ok_msg
    return {"success": True, "message": msg} if ok else JSONResponse({"error": msg}, status_code=400)


@api.get("/admin/users")
async def admin_users_list(request: Request):
    _owner_only(request)
    return {"users": await acct_list(), "public_base_url_set": bool(PUBLIC_BASE_URL)}


@api.post("/admin/users")
async def admin_users_create(request: Request):
    _owner_only(request)
    b = await request.json()
    return _res(await acct_create(b.get("username", ""), b.get("password", ""), b.get("telegramId", "")))


@api.post("/admin/users/{username}/password")
async def admin_user_password(username: str, request: Request):
    _owner_only(request)
    return _res(await acct_set_password(username, (await request.json()).get("password", "")))


@api.post("/admin/users/{username}/suspend")
async def admin_user_suspend(username: str, request: Request):
    _owner_only(request)
    return _res(await acct_set_suspended(username, bool((await request.json()).get("suspended"))))


@api.post("/admin/users/{username}/telegram-id")
async def admin_user_telegram_id(username: str, request: Request):
    _owner_only(request)
    return _res(await acct_set_telegram_id(username, (await request.json()).get("telegramId", "")))


@api.post("/admin/users/{username}/bot")
async def admin_user_bot(username: str, request: Request):
    _owner_only(request)
    return _res(await acct_set_bot(username, (await request.json()).get("token", "")))


@api.delete("/admin/users/{username}")
async def admin_user_delete(username: str, request: Request):
    _owner_only(request)
    return _res(await acct_delete(username))


LEGACY_SETTING_KEYS = ("system_email", "system_email_password", "smtp_host", "smtp_port", "email_provider")


@api.get("/settings")
async def settings_get(request: Request):
    s = dict(await get_global_settings())
    for k in LEGACY_SETTING_KEYS:
        s.pop(k, None)
    s["has_gemini_api_key"] = bool(str(s.get("gemini_api_key") or "").strip())
    s["gemini_api_key"] = ""  # the key itself is never sent back to the browser
    return s


@api.post("/settings")
async def settings_post(request: Request):
    incoming = await request.json()
    for k in LEGACY_SETTING_KEYS:
        incoming.pop(k, None)
    incoming.pop("has_gemini_api_key", None)
    current = dict(await get_global_settings())
    for k in LEGACY_SETTING_KEYS:
        current.pop(k, None)  # scrubs the old (removed) email credentials from storage too

    # blank key box = "leave it as is" (GET never returns it); clear is explicit
    new_key = str(incoming.get("gemini_api_key") or "").strip()
    if incoming.pop("clear_gemini_api_key", False):
        incoming["gemini_api_key"] = ""
    elif new_key:
        incoming["gemini_api_key"] = new_key
    else:
        incoming["gemini_api_key"] = current.get("gemini_api_key", "")

    # validate/normalise only what was actually sent — a partial save (e.g.
    # just "clear my Gemini key") must not blank the fields it didn't mention
    if "admin_group_id" in incoming:
        gid = str(incoming["admin_group_id"] or "").strip()
        if gid and not re.fullmatch(r"-?\d{5,20}", gid):
            return JSONResponse({"success": False, "error": "آیدی گروه ادمین فقط عدد است (معمولاً با - شروع می‌شود، مثل -1001234567890)."}, status_code=400)
        incoming["admin_group_id"] = gid
    if "owner_user_id" in incoming:
        oid = str(incoming["owner_user_id"] or "").strip()
        if oid and not TELEGRAM_ID_RE.fullmatch(oid):
            return JSONResponse({"success": False, "error": "آیدی عددی تلگرام فقط عدد است (مثل 123456789)."}, status_code=400)
        incoming["owner_user_id"] = oid

    ok = await kv.put("GLOBAL_SETTINGS", json.dumps({**current, **incoming}, ensure_ascii=False))
    if not ok:
        return JSONResponse({"success": False, "error": "ذخیره‌سازی تنظیمات کلی شکست خورد. به ادمین اطلاع داده شد."}, status_code=500)
    return {"success": True}


@api.post("/admin-group/test")
async def admin_group_test(request: Request):
    """Sends a test line to the account's admin group (through the account's own bot)."""
    b = await request.json()
    gid = str(b.get("groupId") or "").strip() or await current_admin_group()
    if not gid or not re.fullmatch(r"-?\d{5,20}", gid):
        return JSONResponse({"error": "اول آیدی گروه ادمین را وارد کن."}, status_code=400)
    res = await tg("sendMessage", {"chat_id": gid, "text": "✅ اتصال گروه ادمین برقرار است."})
    if res.get("ok"):
        return {"success": True, "message": "پیام آزمایشی به گروه ادمین رفت."}
    return JSONResponse({"error": humanize_tg_error(res.get("description")) + " (ربات باید عضو گروه باشد)"}, status_code=400)


@api.get("/vapid-public-key")
async def vapid_key():
    return {"publicKey": (await get_vapid())["publicKey"]}


@api.post("/save-subscription")
async def save_sub(request: Request):
    await kv.put("PUSH_SUBSCRIPTION", json.dumps(await request.json()))
    return {"success": True}


@api.get("/user-profile")
async def user_profile(id: str):
    """getChat only works for a chat_id the BOT itself has some relationship
    with (it messaged them, or they messaged it directly) — a contact who's
    only ever been reached through a Business connection has no such
    relationship with the bot's own identity, so getChat fails for them
    even though the panel clearly has real history with them. Fall back to
    what's already known locally instead of a bare "profile didn't load"."""
    chat_id = fmt_id(id)
    res = await tg("getChat", {"chat_id": chat_id})
    if res.get("ok"):
        return res["result"]
    index = await get_index()
    item = next((i for i in index if i["id"] == str(id)), None)
    if item:
        return {
            "id": id, "first_name": item.get("title") or "", "username": None,
            "bio": None, "type": "private", "limited": True,
            "limited_reason": "این مخاطب فقط از طریق اتصال بیزینسی در دسترسه؛ ربات خودش چت مستقیمی باهاش نداره، پس تلگرام جزئیات کامل پروفایل رو نمی‌ده.",
        }
    return {"error": res.get("description") or "اطلاعات کاربر یافت نشد."}


@api.get("/user-photo")
async def user_photo(id: str):
    """getChat's own `photo` field works for private chats, groups, supergroups
    and channels alike — getUserProfilePhotos only works for a user id, which is
    why group avatars never loaded before. Try getChat first, always."""
    target = fmt_id(id)
    info = await tg("getChat", {"chat_id": target})
    file_id = None
    if info.get("ok"):
        photo = (info["result"] or {}).get("photo")
        if photo:
            file_id = photo.get("big_file_id") or photo.get("small_file_id")
        uid = info["result"].get("id", target)
    else:
        uid = target

    if not file_id and re.fullmatch(r"\d+", str(uid)):
        photos = await tg("getUserProfilePhotos", {"user_id": uid, "limit": 1})
        if photos.get("ok") and photos["result"].get("photos"):
            file_id = photos["result"]["photos"][0][-1]["file_id"]

    if not file_id:
        return PlainTextResponse("No profile photo", status_code=404)

    f = await tg("getFile", {"file_id": file_id})
    if not f.get("ok"):
        return PlainTextResponse("File not found", status_code=404)
    img = await http.get(f"https://api.telegram.org/file/bot{await resolve_bot_token()}/{f['result']['file_path']}")
    return Response(
        img.content,
        media_type=img.headers.get("content-type", "image/jpeg"),
        headers={"Cache-Control": "public, max-age=86400"},
    )


# ---- /media: streaming with HTTP Range, so video/voice players can seek and start playing right away ----
MEDIA_MIME = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp",
    "gif": "image/gif", "mp4": "video/mp4", "mov": "video/quicktime", "webm": "video/webm",
    "ogg": "audio/ogg", "oga": "audio/ogg", "mp3": "audio/mpeg", "m4a": "audio/mp4", "pdf": "application/pdf",
    "tgs": "application/gzip",
}
_MEDIA_CACHE: "OrderedDict[str, tuple[bytes, str]]" = OrderedDict()     # file_id -> (bytes, mime), most recent last
_MEDIA_CACHE_MAX = 48 * 1024 * 1024
_media_cache_size = 0
_media_locks: dict = {}


def parse_byte_range(header: str, total: int):
    """`Range: bytes=a-b` | `a-` | `-n` → (start, end) inclusive; None = no/ignorable header (send the whole file);
    False = valid syntax but outside the file (416). Multi-range requests are answered with the whole file."""
    if not header or not header.lower().startswith("bytes=") or "," in header:
        return None
    spec = header[6:].strip()
    try:
        a, b = spec.split("-", 1)
        if a == "":                              # suffix: last n bytes
            n = int(b)
            if n <= 0:
                return False
            return max(0, total - n), total - 1
        start = int(a)
        end = int(b) if b != "" else total - 1
    except ValueError:
        return None
    if start >= total or start < 0 or end < start:
        return False
    return start, min(end, total - 1)


async def _load_media(file_id: str):
    """(bytes, mime) for a Telegram file, from the small in-memory cache when possible; None if Telegram has no download for it."""
    global _media_cache_size
    hit = _MEDIA_CACHE.get(file_id)
    if hit is not None:
        _MEDIA_CACHE.move_to_end(file_id)
        return hit
    lock = _media_locks.setdefault(file_id, asyncio.Lock())
    try:
        async with lock:
            hit = _MEDIA_CACHE.get(file_id)               # another request may have filled it while we waited
            if hit is not None:
                return hit
            f = await tg("getFile", {"file_id": file_id})
            path = (f.get("result") or {}).get("file_path") if f.get("ok") else None
            if not path:                                   # unknown id, or >20 MB: Telegram gives no download path
                return None
            r = await http.get(f"https://api.telegram.org/file/bot{await resolve_bot_token()}/{path}")
            if r.status_code != 200:
                return None
            ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
            item = (r.content, MEDIA_MIME.get(ext, "application/octet-stream"))
            if len(item[0]) <= _MEDIA_CACHE_MAX // 2:      # never let one huge file evict everything
                _MEDIA_CACHE[file_id] = item
                _media_cache_size += len(item[0])
                while _media_cache_size > _MEDIA_CACHE_MAX and len(_MEDIA_CACHE) > 1:
                    _, (old, _m) = _MEDIA_CACHE.popitem(last=False)
                    _media_cache_size -= len(old)
            return item
    finally:
        _media_locks.pop(file_id, None)


@api.get("/media")
async def media_get(request: Request, file_id: str):
    """Streams a Telegram photo/video/voice/document file so the panel never needs the bot token. Supports Range."""
    item = await _load_media(file_id)
    if item is None:
        return PlainTextResponse("Not found", status_code=404)
    data, mime = item
    headers = {"Cache-Control": "public, max-age=86400", "Accept-Ranges": "bytes"}
    rng = parse_byte_range(request.headers.get("range", ""), len(data))
    if rng is False:
        return Response(status_code=416, headers={**headers, "Content-Range": f"bytes */{len(data)}"})
    if rng is None:
        return Response(data, media_type=mime, headers=headers)
    start, end = rng
    return Response(data[start:end + 1], status_code=206, media_type=mime,
                    headers={**headers, "Content-Range": f"bytes {start}-{end}/{len(data)}"})


@api.post("/react")
async def react_post(request: Request):
    b = await request.json()
    chat_id = fmt_id(b.get("chatId"))
    message_id = b.get("msgId")
    emoji = b.get("emoji")  # falsy/None clears the reaction
    if not chat_id or not message_id:
        return JSONResponse({"error": "chatId و msgId لازم است."}, status_code=400)
    payload = {"chat_id": chat_id, "message_id": int(message_id)}
    payload["reaction"] = [{"type": "emoji", "emoji": emoji}] if emoji else []
    res = await tg("setMessageReaction", payload)
    if not res.get("ok"):
        return JSONResponse({"error": res.get("description") or "ری‌اکشن ثبت نشد."}, status_code=400)
    # reflect it locally right away so the panel doesn't need to wait for a poll
    async with chat_locks[chat_id]:
        history = await get_history(chat_id)
        for h in history:
            if h.get("msg_id") == int(message_id):
                h["my_reaction"] = emoji or None
                await kv.put(f"CHAT_{chat_id}", json.dumps(history, ensure_ascii=False), ttl=604800)
                break
    return {"success": True}


@api.get("/bot-profile")
async def bot_profile_get():
    me = await tg("getMe")
    if not me.get("ok"):
        return {"connected": False, "error": humanize_tg_error(me.get("description"))}
    n = await tg("getMyName")
    d = await tg("getMyDescription")
    s = await tg("getMyShortDescription")
    r = me["result"]
    return {
        "connected": True, "id": r.get("id"), "username": r.get("username", ""),
        "name": (n.get("result") or {}).get("name", "") or r.get("first_name", ""),
        "description": (d.get("result") or {}).get("description", ""),
        "short_description": (s.get("result") or {}).get("short_description", ""),
    }


@api.post("/bot-profile/photo")
async def bot_profile_photo_set(request: Request):
    """Bot API 9.4 setMyProfilePhoto — the file must be a static JPG."""
    form = await request.form()
    f = form.get("file")
    data = await f.read() if f is not None and hasattr(f, "read") else b""
    if not data or len(data) > 5_000_000:
        return JSONResponse({"error": "عکس خالیه یا از ۵ مگابایت بزرگ‌تره."}, status_code=400)
    if not data.startswith(b"\xff\xd8\xff"):
        return JSONResponse({"error": "عکس باید JPG باشد."}, status_code=400)
    token = await resolve_bot_token()
    if not token:
        return JSONResponse({"error": "برای این حساب هنوز رباتی متصل نشده است."}, status_code=400)
    try:
        r = await http.post(
            f"https://api.telegram.org/bot{token}/setMyProfilePhoto", timeout=60,
            data={"photo": json.dumps({"type": "static", "photo": "attach://pic"})},
            files={"pic": ("photo.jpg", data, "image/jpeg")},
        )
        res = r.json()
    except Exception as e:
        return JSONResponse({"error": f"ارتباط با تلگرام شکست خورد: {e}"}, status_code=502)
    if res.get("ok"):
        return {"success": True, "message": "عکس ربات تغییر کرد."}
    desc = res.get("description") or ""
    if "not found" in desc.lower():
        desc = "این نسخه‌ی Bot API از تغییر عکس پشتیبانی نمی‌کند؛ از BotFather → /setuserpic استفاده کن."
    else:
        desc = humanize_tg_error(desc)
    return JSONResponse({"error": desc}, status_code=400)


@api.delete("/bot-profile/photo")
async def bot_profile_photo_remove():
    res = await tg("removeMyProfilePhoto")
    if res.get("ok"):
        return {"success": True, "message": "عکس ربات حذف شد."}
    return JSONResponse({"error": humanize_tg_error(res.get("description"))}, status_code=400)


@api.post("/bot-profile")
async def bot_profile_post(request: Request):
    b = await request.json()
    errors = []
    for field, method in (("name", "setMyName"), ("description", "setMyDescription"), ("short_description", "setMyShortDescription")):
        if b.get(field) is not None:
            res = await tg(method, {field: b[field]})
            if not res.get("ok"):
                errors.append(humanize_tg_error(res.get("description")))
    if errors:  # Telegram refused (e.g. rate-limited name change) — say so instead of reporting success
        return JSONResponse({"success": False, "error": " | ".join(errors)}, status_code=400)
    return {"success": True}


@api.get("/chat-settings")
async def chat_settings_get(id: str):
    return await get_chat_config(id)


@api.post("/chat-settings")
async def chat_settings_post(request: Request):
    b = await request.json()
    if not b.get("chatId"):
        return JSONResponse({"success": False, "error": "chatId لازم است."}, status_code=400)
    ok = await kv.put(f"CHAT_CFG_{b['chatId']}", json.dumps(b, ensure_ascii=False))
    if not ok:
        return JSONResponse({"success": False, "error": "ذخیره‌سازی تنظیمات این چت شکست خورد. به ادمین اطلاع داده شد."}, status_code=500)
    return {"success": True}


def _etag_response(request: Request, data):
    """Polling endpoints answer 304 (no body) when nothing changed since the
    client's last copy — on a phone that saves downloading, parsing and
    diffing the same JSON every few seconds."""
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    etag = '"' + hashlib.md5(body.encode()).hexdigest() + '"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    return Response(body, media_type="application/json", headers={"ETag": etag, "Cache-Control": "no-cache"})


@api.get("/chats")
async def chats_get(request: Request):
    index = await get_index()
    # transient, honest signal: is an AI batch-reply actually queued right now?
    for item in index:
        t = ai_timers.get(item["id"])
        item["ai_pending"] = bool(t and not t.done())
    return _etag_response(request, index)


@api.get("/chat")
async def chat_get(request: Request, id: str, limit: int = 120, before_id: str | None = None):
    """Paginated on purpose: a chat with thousands of messages used to get
    sent (and re-sent on every poll) as ONE giant JSON blob, which the panel
    then fully re-rendered every few seconds — on long chats this was slow
    enough to look like the panel "wasn't loading", and the huge DOM rebuild
    is exactly what produced the "scrolling in from way above" jump. Default:
    the most recent `limit` messages. `before_id` (a message's internal
    `id`) pages further back for "load older messages"."""
    history = await get_history(id)
    limit = max(1, min(limit, 500))
    if before_id:
        idx = next((i for i, h in enumerate(history) if h.get("id") == before_id), None)
        if idx is None:
            return []
        start = max(0, idx - limit)
        return history[start:idx]
    return _etag_response(request, history[-limit:])


@api.post("/send")
async def send(request: Request):
    b = await request.json()
    target = fmt_id(b.get("chatId"))
    text = b.get("text", "")
    reply_to = b.get("replyToMsgId")

    # senderMode picks which identity actually sends the message:
    #  - "me"  -> via the Business connection (looks like it's from your own
    #             personal Telegram account). Requires a real businessConnectionId.
    #  - "bot" -> the bot itself sends it directly (no business_connection_id).
    #             Only works if this chat has ever messaged the bot directly —
    #             otherwise Telegram refuses with "can't initiate conversation".
    # If the frontend hasn't been updated to send senderMode yet, we fall back
    # to the old behaviour (use businessConnectionId iff one was sent).
    sender_mode = b.get("senderMode")
    if sender_mode is None:
        biz = b.get("businessConnectionId")
        sender_mode = "me" if biz else "bot"
    else:
        sender_mode = str(sender_mode).strip().lower()
        biz = b.get("businessConnectionId") if sender_mode == "me" else None
        if sender_mode == "me" and not biz:
            return JSONResponse(
                {"error": "این چت اتصال بیزینسی (Business) فعالی نداره، نمی‌شه بعنوان «من» ارسال کرد."},
                status_code=400,
            )

    res = await send_tg(target, text, biz, reply_to=reply_to)
    if not res.get("ok"):
        return JSONResponse({"error": humanize_tg_error(res.get("description"))}, status_code=400)
    result = res.get("result") or {}
    resolved = str((result.get("chat") or {}).get("id") or target)
    sender_label = "پنل"  # uniform regardless of sender_mode — see chat.js for why
    msg = {
        "id": str(int(datetime.now().timestamp() * 1000)),
        "msg_id": result.get("message_id"),
        "role": "admin", "text": text, "sender": sender_label,
        "sender_mode": sender_mode, "time": now_str(), "ts": now_ts(),
    }
    if reply_to:
        async with chat_locks[resolved]:
            history = await get_history(resolved)
            src = next((h for h in history if h.get("msg_id") == int(reply_to)), None)
        if src:
            preview = src.get("text") or "[رسانه]"
            msg["reply_to_msg_id"] = int(reply_to)
            msg["reply_to_preview"] = f"{src.get('sender', '')}: {preview}"[:120]
    await append_history(resolved, msg)
    await update_index(resolved, text, sender_label, b.get("customTitle"), biz,
                        bot_direct=(biz is None))
    return {"success": True, "message": msg, "resolvedChatId": resolved}


MEDIA_ROUTES = {
    "photo": ("sendPhoto", "photo"),
    "video": ("sendVideo", "video"),
    "voice": ("sendVoice", "voice"),
    "document": ("sendDocument", "document"),
    "animation": ("sendAnimation", "animation"),
}


@api.post("/send-media")
async def send_media(request: Request):
    """multipart/form-data: chatId, type (photo|video|voice|document), file,
    caption?, replyToMsgId?, businessConnectionId?, senderMode? (bot|me)"""
    form = await request.form()
    target = fmt_id(form.get("chatId"))
    media_type = form.get("type")
    caption = form.get("caption") or ""
    reply_to = form.get("replyToMsgId") or None
    upload = form.get("file")
    if media_type not in MEDIA_ROUTES or not upload or not target:
        return JSONResponse({"error": "پارامترهای ارسال رسانه ناقص است."}, status_code=400)

    sender_mode = form.get("senderMode")
    raw_biz = form.get("businessConnectionId") or None
    if sender_mode is None:
        biz = raw_biz
        sender_mode = "me" if biz else "bot"
    else:
        sender_mode = str(sender_mode).strip().lower()
        biz = raw_biz if sender_mode == "me" else None
        if sender_mode == "me" and not biz:
            return JSONResponse(
                {"error": "این چت اتصال بیزینسی (Business) فعالی نداره، نمی‌شه بعنوان «من» ارسال کرد."},
                status_code=400,
            )

    content = await upload.read()
    filename = upload.filename or f"upload.{'ogg' if media_type == 'voice' else 'bin'}"
    mime = upload.content_type or "application/octet-stream"

    if media_type == "voice" and "ogg" not in mime and not filename.lower().endswith(".ogg"):
        converted = await convert_to_ogg_opus(content)
        if converted:
            content, filename, mime = converted, "voice.ogg", "audio/ogg"
        else:
            await notify_admin_error("voice_convert", "تبدیل پیام صوتی به OGG با ffmpeg شکست خورد؛ فایل اصلی ارسال شد.")

    method, field = MEDIA_ROUTES[media_type]
    res = await send_media_tg(target, method, field, filename, content, mime, caption, biz, reply_to)
    if not res.get("ok"):
        return JSONResponse({"error": humanize_tg_error(res.get("description"))}, status_code=400)

    result = res.get("result") or {}
    resolved = str((result.get("chat") or {}).get("id") or target)
    tg_file_id = None
    if media_type == "photo":
        sizes = result.get("photo") or []
        tg_file_id = sizes[-1]["file_id"] if sizes else None
    else:
        tg_file_id = (result.get(media_type) or {}).get("file_id")

    sender_label = "پنل"  # uniform regardless of sender_mode — see chat.js for why
    msg = {
        "id": str(int(datetime.now().timestamp() * 1000)),
        "msg_id": result.get("message_id"),
        "role": "admin", "sender": sender_label, "sender_mode": sender_mode, "time": now_str(), "ts": now_ts(),
        "type": media_type, "file_id": tg_file_id,
        "text": caption or {"photo": "[عکس]", "video": "[ویدیو]", "voice": "[پیام صوتی]", "document": "[فایل]", "animation": "[GIF]"}.get(media_type, "[رسانه]"),
    }
    await append_history(resolved, msg)
    await update_index(resolved, msg["text"], sender_label, form.get("customTitle"), biz,
                        bot_direct=(biz is None))
    if media_type == "animation" and tg_file_id:
        await _track_recent(RECENT_GIFS_KEY, tg_file_id)
    return {"success": True, "message": msg, "resolvedChatId": resolved}


# ── sticker / GIF panel ───────────────────────────────────────────────────────
# The Bot API has no "browse/search all stickers" endpoint (that's an
# MTProto-only client feature) — a bot can only fetch a sticker SET it
# already knows the short name of. So the panel offers two tabs: packs the
# admin has configured by name (getStickerSet), and a rolling list of
# stickers/GIFs the admin has actually sent before (tracked ourselves),
# which covers the common "reuse what I already have" case.
RECENT_STICKERS_KEY = "RECENT_STICKERS"
RECENT_GIFS_KEY = "RECENT_GIFS"
RECENT_MAX = 40


async def _track_recent(kv_key: str, file_id: str, extra: dict | None = None):
    raw = await kv.get(kv_key)
    items = json.loads(raw) if raw else []
    items = [i for i in items if i.get("file_id") != file_id]
    items.insert(0, {"file_id": file_id, **(extra or {})})
    await kv.put(kv_key, json.dumps(items[:RECENT_MAX], ensure_ascii=False))


@api.get("/sticker-set")
async def sticker_set_get(name: str):
    res = await tg("getStickerSet", {"name": name})
    if not res.get("ok"):
        return JSONResponse({"error": humanize_tg_error(res.get("description")) or "پک استیکر پیدا نشد."}, status_code=400)
    stickers = res["result"].get("stickers", [])
    return {"title": res["result"].get("title"), "stickers": [
        {"file_id": s["file_id"], "emoji": s.get("emoji", "")} for s in stickers
    ]}


@api.get("/recent-media")
async def recent_media_get(type: str):
    key = RECENT_STICKERS_KEY if type == "sticker" else RECENT_GIFS_KEY
    raw = await kv.get(key)
    return json.loads(raw) if raw else []


@api.post("/add-recent-media")
async def add_recent_media(request: Request):
    """Explicit "افزودن به پنل" from the message context menu — a received
    sticker/GIF is already auto-tracked the moment it arrives, but this
    lets the admin deliberately (re-)add one on demand too, e.g. after
    clearing recents or for one they want to make sure sticks around."""
    b = await request.json()
    file_id = b.get("fileId")
    media_type = b.get("type")
    if not file_id or media_type not in ("sticker", "animation"):
        return JSONResponse({"error": "fileId و type لازم است."}, status_code=400)
    key = RECENT_STICKERS_KEY if media_type == "sticker" else RECENT_GIFS_KEY
    await _track_recent(key, file_id, {"emoji": b.get("emoji", "")} if media_type == "sticker" else None)
    return {"success": True}


@api.post("/send-sticker")
async def send_sticker(request: Request):
    """Resends an existing sticker/GIF by file_id — no re-upload needed,
    Telegram just needs the file_id of a file it already has."""
    b = await request.json()
    target = fmt_id(b.get("chatId"))
    file_id = b.get("fileId")
    media_type = b.get("type")  # "sticker" | "animation"
    reply_to = b.get("replyToMsgId")
    sender_mode = b.get("senderMode") or "bot"
    biz = b.get("businessConnectionId") if sender_mode == "me" else None
    if not target or not file_id or media_type not in ("sticker", "animation"):
        return JSONResponse({"error": "chatId، fileId و type لازم است."}, status_code=400)

    method = "sendSticker" if media_type == "sticker" else "sendAnimation"
    field = "sticker" if media_type == "sticker" else "animation"
    payload = {"chat_id": target, field: file_id}
    if biz:
        payload["business_connection_id"] = biz
    if reply_to:
        payload["reply_parameters"] = {"message_id": int(reply_to), "allow_sending_without_reply": True}
    res = await tg(method, payload)
    if not res.get("ok"):
        return JSONResponse({"error": humanize_tg_error(res.get("description"))}, status_code=400)

    result = res.get("result") or {}
    resolved = str((result.get("chat") or {}).get("id") or target)
    sender_label = "پنل"  # uniform regardless of sender_mode — see chat.js for why
    out_file_id = (result.get(field) or {}).get("file_id") or file_id
    msg = {
        "id": str(int(datetime.now().timestamp() * 1000)),
        "msg_id": result.get("message_id"),
        "role": "admin", "sender": sender_label, "sender_mode": sender_mode, "time": now_str(), "ts": now_ts(),
        "type": media_type, "file_id": out_file_id,
        "text": "🎭" if media_type == "sticker" else "[GIF]",
    }
    await append_history(resolved, msg)
    await update_index(resolved, msg["text"], sender_label, b.get("customTitle"), biz,
                        bot_direct=(biz is None))
    await _track_recent(RECENT_STICKERS_KEY if media_type == "sticker" else RECENT_GIFS_KEY, out_file_id,
                         {"emoji": b.get("emoji", "")} if media_type == "sticker" else None)
    return {"success": True, "message": msg, "resolvedChatId": resolved}


@api.post("/mute")
async def mute_chat(request: Request):
    b = await request.json()
    chat_id = str(b.get("chatId") or "")
    muted = bool(b.get("muted"))
    if not chat_id:
        return JSONResponse({"error": "chatId لازم است."}, status_code=400)
    async with index_lock:
        index = await get_index()
        item = next((i for i in index if i["id"] == chat_id), None)
        if not item:
            return JSONResponse({"error": "این گفتگو در لیست نیست."}, status_code=404)
        item["muted"] = muted
        await kv.put("CHAT_INDEX", json.dumps(index, ensure_ascii=False))
    return {"success": True}


@api.post("/pin")
async def pin_chat(request: Request):
    b = await request.json()
    chat_id = str(b.get("chatId") or "")
    pinned = bool(b.get("pinned"))
    if not chat_id:
        return JSONResponse({"error": "chatId لازم است."}, status_code=400)
    async with index_lock:
        index = await get_index()
        item = next((i for i in index if i["id"] == chat_id), None)
        if not item:
            return JSONResponse({"error": "این گفتگو در لیست نیست."}, status_code=404)
        item["pinned"] = pinned
        await kv.put("CHAT_INDEX", json.dumps(index, ensure_ascii=False))
    return {"success": True}


@api.post("/delete-chat")
async def delete_chat(request: Request):
    b = await request.json()
    chat_id = str(b.get("chatId") or "")
    if not chat_id:
        return JSONResponse({"error": "chatId لازم است."}, status_code=400)
    async with index_lock:
        index = await get_index()
        index = [i for i in index if i["id"] != chat_id]
        await kv.put("CHAT_INDEX", json.dumps(index, ensure_ascii=False))
    async with chat_locks[chat_id]:
        await kv.put(f"CHAT_{chat_id}", json.dumps([], ensure_ascii=False))
    return {"success": True}


@api.post("/edit")
async def edit(request: Request):
    b = await request.json()
    target = fmt_id(b.get("chatId"))
    msg_id, internal_id, new_text = b.get("msgId"), b.get("internalId"), b.get("newText", "")
    if msg_id not in (None, "", "null"):
        # editMessageText requires business_connection_id for a message
        # that was originally sent through a business connection — look the
        # chat's known connection id up from the index instead of trusting
        # the frontend to track it per message.
        index = await get_index()
        chat_item = next((i for i in index if i["id"] == target), None)
        biz_id = (chat_item or {}).get("business_connection_id")
        res = await edit_tg(target, msg_id, new_text, biz_id)
        if not res.get("ok"):
            return JSONResponse({"error": humanize_tg_error(res.get("description"))}, status_code=400)
    async with chat_locks[target]:
        history = await get_history(target)
        for h in history:
            if h.get("id") == internal_id or (msg_id and str(h.get("msg_id")) == str(msg_id)):
                h["text"] = new_text
                break
        await kv.put(f"CHAT_{target}", json.dumps(history, ensure_ascii=False), ttl=604800)
    return {"success": True, "history": history}


@api.post("/forward")
async def forward_post(request: Request):
    """Forwards (keeps 'Forwarded from') or copies (no attribution) a message
    from one chat this bot/business-connection can see to another."""
    b = await request.json()
    from_chat = fmt_id(b.get("fromChatId"))
    to_chat = fmt_id(b.get("toChatId"))
    msg_id = b.get("msgId")
    keep_attribution = b.get("keepAttribution", True)
    biz = b.get("businessConnectionId")
    if not from_chat or not to_chat or not msg_id:
        return JSONResponse({"error": "fromChatId، toChatId و msgId لازم است."}, status_code=400)
    method = "forwardMessage" if keep_attribution else "copyMessage"
    payload = {"chat_id": to_chat, "from_chat_id": from_chat, "message_id": int(msg_id)}
    if biz:
        payload["business_connection_id"] = biz
    res = await tg(method, payload)
    if not res.get("ok"):
        return JSONResponse({"error": humanize_tg_error(res.get("description"))}, status_code=400)
    result = res.get("result") or {}
    new_msg_id = result.get("message_id") if method == "copyMessage" else result.get("message_id")

    async with chat_locks[from_chat]:
        src_history = await get_history(from_chat)
        src = next((h for h in src_history if h.get("msg_id") == int(msg_id)), None)

    msg = {
        "id": str(int(datetime.now().timestamp() * 1000)),
        "msg_id": new_msg_id,
        "role": "admin", "sender": "شما", "time": now_str(), "ts": now_ts(),
        "text": (src or {}).get("text", ""),
    }
    if src and src.get("type"):
        msg["type"] = src["type"]
        msg["file_id"] = src.get("file_id")
    if keep_attribution and src:
        msg["forwarded_from"] = src.get("sender") or "چت دیگر"
    await append_history(to_chat, msg)
    await update_index(to_chat, msg["text"] or "[رسانه]", "شما", None, biz, bot_direct=(biz is None))
    return {"success": True, "message": msg}


@api.post("/pin-message")
async def pin_message_post(request: Request):
    """Pin/unpin a message inside the actual Telegram chat (pinChatMessage).
    Requires the bot (or the connected Business account) to have pin rights there."""
    b = await request.json()
    chat_id = fmt_id(b.get("chatId"))
    msg_id = b.get("msgId")
    unpin = bool(b.get("unpin"))
    biz = b.get("businessConnectionId")
    if not chat_id or not msg_id:
        return JSONResponse({"error": "chatId و msgId لازم است."}, status_code=400)
    payload = {"chat_id": chat_id, "message_id": int(msg_id)}
    if biz:
        payload["business_connection_id"] = biz
    res = await tg("unpinChatMessage" if unpin else "pinChatMessage", payload)
    if not res.get("ok"):
        return JSONResponse({"error": humanize_tg_error(res.get("description"))}, status_code=400)
    return {"success": True}


@api.post("/delete-message")
async def delete_message_post(request: Request):
    """Deletes a single message (Telegram's deleteMessage) — used by the
    message context menu's «حذف» action, as opposed to /group/delete-messages
    which deletes the N most recent messages in a group."""
    b = await request.json()
    chat_id = fmt_id(b.get("chatId"))
    msg_id = b.get("msgId")
    if not chat_id or not msg_id:
        return JSONResponse({"error": "chatId و msgId لازم است."}, status_code=400)
    res = await tg("deleteMessage", {"chat_id": chat_id, "message_id": int(msg_id)})
    if not res.get("ok"):
        return JSONResponse({"error": humanize_tg_error(res.get("description"))}, status_code=400)
    async with chat_locks[chat_id]:
        history = await get_history(chat_id)
        history = [h for h in history if h.get("msg_id") != int(msg_id)]
        await kv.put(f"CHAT_{chat_id}", json.dumps(history, ensure_ascii=False), ttl=604800)
    return {"success": True}


@api.post("/pin-chat")
async def pin_chat_post(request: Request):
    """Local-only: pins a conversation to the top of the sidebar (panel state, not Telegram)."""
    b = await request.json()
    chat_id = b.get("chatId")
    pinned = bool(b.get("pinned"))
    if not chat_id:
        return JSONResponse({"error": "chatId لازم است."}, status_code=400)
    async with index_lock:
        index = await get_index()
        for i in index:
            if i["id"] == chat_id:
                i["pinned"] = pinned
                break
        ok = await kv.put("CHAT_INDEX", json.dumps(index, ensure_ascii=False))
    if not ok:
        return JSONResponse({"error": "ذخیره نشد."}, status_code=500)
    return {"success": True}


# ----------------------------- group moderation (requires bot admin rights) -----------------------------
MUTE_PERMS = {
    "can_send_messages": False, "can_send_audios": False, "can_send_documents": False,
    "can_send_photos": False, "can_send_videos": False, "can_send_video_notes": False,
    "can_send_voice_notes": False, "can_send_polls": False, "can_send_other_messages": False,
    "can_add_web_page_previews": False,
}
ALL_PERMS = {k: True for k in MUTE_PERMS}


@api.post("/group/restrict")
async def group_restrict(request: Request):
    b = await request.json()
    chat_id = fmt_id(b.get("chatId"))
    user_id = b.get("userId")
    until = b.get("untilDate", 0)  # 0 = permanent
    perms = MUTE_PERMS if b.get("mute", True) else ALL_PERMS
    if not chat_id or not user_id:
        return JSONResponse({"error": "chatId و userId لازم است."}, status_code=400)
    res = await tg("restrictChatMember", {
        "chat_id": chat_id, "user_id": int(user_id),
        "permissions": perms, "until_date": int(until)
    })
    if not res.get("ok"):
        return JSONResponse({"error": res.get("description") or "محدودیت اعمال نشد."}, status_code=400)
    return {"success": True}


@api.post("/group/ban")
async def group_ban(request: Request):
    b = await request.json()
    chat_id = fmt_id(b.get("chatId"))
    user_id = b.get("userId")
    until = b.get("untilDate", 0)
    revoke = bool(b.get("revokeMessages", False))
    if not chat_id or not user_id:
        return JSONResponse({"error": "chatId و userId لازم است."}, status_code=400)
    res = await tg("banChatMember", {
        "chat_id": chat_id, "user_id": int(user_id),
        "until_date": int(until), "revoke_messages": revoke
    })
    if not res.get("ok"):
        return JSONResponse({"error": res.get("description") or "بن انجام نشد."}, status_code=400)
    return {"success": True}


@api.post("/group/unban")
async def group_unban(request: Request):
    b = await request.json()
    chat_id = fmt_id(b.get("chatId"))
    user_id = b.get("userId")
    if not chat_id or not user_id:
        return JSONResponse({"error": "chatId و userId لازم است."}, status_code=400)
    res = await tg("unbanChatMember", {"chat_id": chat_id, "user_id": int(user_id), "only_if_banned": True})
    if not res.get("ok"):
        return JSONResponse({"error": res.get("description") or "آنبن انجام نشد."}, status_code=400)
    return {"success": True}


@api.post("/group/delete-messages")
async def group_delete_messages(request: Request):
    """Delete the last N messages from a group chat."""
    b = await request.json()
    chat_id = fmt_id(b.get("chatId"))
    count = min(int(b.get("count", 1)), 200)
    if not chat_id or count < 1:
        return JSONResponse({"error": "chatId و count لازم است."}, status_code=400)
    # Collect recent message ids from local history
    history = await get_history(chat_id)
    ids = [h["msg_id"] for h in reversed(history) if h.get("msg_id")][:count]
    if not ids:
        return JSONResponse({"error": "پیامی برای حذف یافت نشد."}, status_code=400)
    # deleteMessages accepts up to 100 per call
    deleted = 0
    for i in range(0, len(ids), 100):
        batch = ids[i:i+100]
        res = await tg("deleteMessages", {"chat_id": chat_id, "message_ids": batch})
        if res.get("ok"):
            deleted += len(batch)
    # Remove from local history too
    async with chat_locks[chat_id]:
        h = await get_history(chat_id)
        removed_ids = set(ids)
        h = [m for m in h if m.get("msg_id") not in removed_ids]
        await kv.put(f"CHAT_{chat_id}", json.dumps(h, ensure_ascii=False), ttl=604800)
    return {"success": True, "deleted": deleted}


@api.post("/group/delete-user-messages")
async def group_delete_user_messages(request: Request):
    b = await request.json()
    chat_id = fmt_id(b.get("chatId"))
    user_id = b.get("userId")
    if not chat_id or not user_id:
        return JSONResponse({"error": "chatId و userId لازم است."}, status_code=400)
    res = await tg("deleteChatMemberMessages", {"chat_id": chat_id, "user_id": int(user_id)})
    if not res.get("ok"):
        return JSONResponse({"error": res.get("description") or "حذف پیام‌ها انجام نشد."}, status_code=400)
    return {"success": True}


@api.get("/group/members")
async def group_members(chatId: str):
    chat_id = fmt_id(chatId)
    res = await tg("getChatAdministrators", {"chat_id": chat_id})
    if not res.get("ok"):
        return JSONResponse({"error": res.get("description") or "دریافت اعضا انجام نشد."}, status_code=400)
    return {"admins": res.get("result", [])}


@api.get("/group/info")
async def group_info(chatId: str):
    """Group-info panel header: title/description/avatar/member-count.
    Note: the Bot API only ever exposes the ADMIN list (getChatAdministrators)
    — there is no way for a bot to enumerate regular members, which is why
    the panel's "Members" tab only ever shows admins."""
    chat_id = fmt_id(chatId)
    res = await tg("getChat", {"chat_id": chat_id})
    if not res.get("ok"):
        return JSONResponse({"error": humanize_tg_error(res.get("description"))}, status_code=400)
    count_res = await tg("getChatMemberCount", {"chat_id": chat_id})
    result = res.get("result") or {}
    return {
        "id": result.get("id"), "title": result.get("title"),
        "description": result.get("description") or "",
        "username": result.get("username"),
        "invite_link": result.get("invite_link"),
        "type": result.get("type"),
        "member_count": count_res.get("result") if count_res.get("ok") else None,
    }


MEDIA_SCAN_TYPES = ("photo", "video", "voice", "document", "animation")
MEDIA_SCAN_CAP = 60  # per type — this is a quick "recent shared media" tab, not a full media library


@api.get("/chat-media")
async def chat_media_get(id: str):
    """Shared-media tabs for the profile panel (Photos/Videos/Files/Voice),
    pulled from locally-stored history — not a Telegram API call."""
    history = await get_history(id)
    out = {t: [] for t in MEDIA_SCAN_TYPES}
    for h in reversed(history):
        t = h.get("type")
        if t in out and h.get("file_id") and len(out[t]) < MEDIA_SCAN_CAP:
            out[t].append({"file_id": h["file_id"], "id": h.get("id"), "time": h.get("time")})
    return out


@api.post("/group/content-filter")
async def group_content_filter(request: Request):
    """Save per-group content filter settings (which media types to auto-delete)."""
    b = await request.json()
    chat_id = str(b.get("chatId") or "")
    if not chat_id:
        return JSONResponse({"error": "chatId لازم است."}, status_code=400)
    filters = b.get("filters", {})
    await kv.put(f"GROUP_FILTER_{chat_id}", json.dumps(filters, ensure_ascii=False))
    return {"success": True}


@api.get("/group/content-filter")
async def group_content_filter_get(chatId: str):
    raw = await kv.get(f"GROUP_FILTER_{chatId}")
    return json.loads(raw) if raw else {}


# ----------------------------- static UI / PWA -----------------------------
SW_JS = """
const CACHE_NAME = 'tg-admin-v4';
self.addEventListener('install', (event) => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(clients.claim()); });
self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/api/')) { return; }
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
self.addEventListener('push', function(event) {
  let data = { title: 'پیام جدید تلگرام', body: 'شما یک پیام جدید دارید', url: '/' };
  if (event.data) {
    try { data = event.data.json(); } catch (e) { data.body = event.data.text(); }
  }
  const options = { body: data.body, icon: '/icon.svg', badge: '/icon.svg', vibrate: [200, 100, 200], data: data.url || '/' };
  event.waitUntil(self.registration.showNotification(data.title, options));
});
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (let i = 0; i < clientList.length; i++) {
        let client = clientList[i];
        if ('focus' in client) { return client.focus(); }
      }
      if (clients.openWindow) { return clients.openWindow(event.notification.data); }
    })
  );
});
"""

ICON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#9fcaff"/><stop offset="1" stop-color="#1a6bb2"/></linearGradient></defs>
<rect width="512" height="512" rx="120" fill="#10131a"/>
<path d="M381 143.5L88 258c-8.5 3.5-8.3 15.5 0 18.5l75 25 28 88c2 6.5 10 9 15.5 4.5l42-38 82 60c7 5 17 1 18.5-7.5l58-258c1.5-7.5-6-13.5-13.5-11.5z" fill="url(#g)"/>
<path d="M191 394l-3-73 138-125c3-3-1-7-4-5l-165 104" fill="#ffffff"/>
</svg>"""

MANIFEST = {
    "name": "Telegram Web Admin", "short_name": "TG Admin", "description": "پنل مدیریت تلگرام وب",
    "start_url": "/", "display": "standalone", "background_color": "#10131a",
    "theme_color": "#10131a", "orientation": "portrait-primary",
    "icons": [{"src": "/icon.svg", "sizes": "192x192 512x512", "type": "image/svg+xml", "purpose": "any maskable"}],
}


def load_ui() -> str:
    p = BASE / "index.html"
    if not p.exists():
        return "<h3>index.html not found. Copy the HTML into index.html.</h3>"
    html = p.read_text(encoding="utf-8")
    return html.replace("rawData.charCodeAt(0)", "rawData.charCodeAt(i)")


UI_HTML = load_ui()

app = FastAPI()
app.include_router(public_api)
app.include_router(api)

# Phase 1: the left sidebar / chat list (and later phases: topbar, bubble,
# composer, ...) now live as standalone files under static/, ported from the
# real tweb source, instead of one giant inline <style>/<script> blob.
STATIC_DIR = BASE / "static"
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
else:
    log.warning("static/ directory not found next to app.py — sidebar/chat-list CSS+JS won't load.")


async def ws_authenticate(token: str):
    """Same rules as require_auth, for a socket: valid session, account not suspended,
    no pending forced password change. Returns the username or None."""
    if not token:
        return None
    session = (await get_sessions()).get(token)
    if not session or session.get("must_change"):
        return None
    username = session["username"]
    if username != "owner":
        u = (await get_users()).get(username)
        if not u or u.get("suspended"):
            return None
    _maybe_touch(token)
    return username


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    """Auth is the first frame ({"t":"auth","token":...}), not a URL parameter, so the
    session token never lands in proxy / access logs. Server pings every 25s (keeps
    HF's proxy from idling the socket out) and drops peers silent for >75s."""
    await ws.accept()
    username = None
    try:
        first = json.loads(await asyncio.wait_for(ws.receive_text(), timeout=10))
        username = await ws_authenticate(str(first.get("token") or "")) if first.get("t") == "auth" else None
        if not username:
            await ws.send_text('{"t":"unauthorized"}')
            await ws.close(code=4401)
            return
        realtime.conns[username].add(ws)
        await ws.send_text(json.dumps({"t": "hello", "cursor": realtime.cursor(username)}))
        last_rx = time.monotonic()
        while True:
            try:
                msg = await asyncio.wait_for(ws.receive_text(), timeout=25)
                last_rx = time.monotonic()
                if '"ping"' in msg:
                    await ws.send_text('{"t":"pong"}')
            except asyncio.TimeoutError:
                if time.monotonic() - last_rx > 75:
                    break
                await ws.send_text('{"t":"ping"}')
    except (WebSocketDisconnect, asyncio.TimeoutError, ValueError, RuntimeError):
        pass
    except Exception:
        log.exception("websocket error")
    finally:
        if username:
            realtime.conns[username].discard(ws)


@app.get("/manifest.json")
async def manifest():
    return JSONResponse(MANIFEST, media_type="application/manifest+json")


@app.get("/sw.js")
async def sw():
    return Response(SW_JS, media_type="application/javascript; charset=utf-8")


@app.get("/icon.svg")
async def icon():
    return Response(ICON_SVG, media_type="image/svg+xml")


@app.get("/")
async def ui():
    return HTMLResponse(UI_HTML)


@app.post("/")
@app.post("/webhook")
async def webhook(request: Request, bg: BackgroundTasks):
    if WEBHOOK_SECRET and request.headers.get("X-Telegram-Bot-Api-Secret-Token") != WEBHOOK_SECRET:
        raise HTTPException(status_code=403, detail="forbidden")
    try:
        update = await request.json()
    except Exception:
        return PlainTextResponse("OK")
    if "message_reaction" in update:
        bg.add_task(handle_message_reaction, update)
    else:
        bg.add_task(handle_update, update)  # answer Telegram immediately, work in background
    return PlainTextResponse("OK")


TENANT_ROUTES_KEY = "PANEL_TENANT_ROUTES"  # {webhook_secret: username}


async def get_tenant_routes() -> dict:
    raw = await kv.get(TENANT_ROUTES_KEY)
    return json.loads(raw) if raw else {}


@app.post("/webhook/{secret}")
async def tenant_webhook(secret: str, request: Request, bg: BackgroundTasks):
    """Each tenant's bot has its own webhook URL (registered by /setbot): the
    unguessable path segment picks the tenant, and Telegram echoes the same
    value back in the secret-token header — both must match."""
    header = request.headers.get("X-Telegram-Bot-Api-Secret-Token") or ""
    username = (await get_tenant_routes()).get(secret)
    if not username or not secrets.compare_digest(header.encode(), secret.encode()):
        raise HTTPException(status_code=403, detail="forbidden")
    u = (await get_users()).get(username)
    if not u or u.get("suspended"):
        return PlainTextResponse("OK")  # suspended/deleted: accept and ignore
    try:
        update = await request.json()
    except Exception:
        return PlainTextResponse("OK")
    fn = handle_message_reaction if "message_reaction" in update else handle_update
    bg.add_task(run_as_tenant, username, fn, update)
    return PlainTextResponse("OK")


# ----------------------------- ZeroGPU startup check -----------------------------
# ZeroGPU statically scans the source for a literal "@spaces.GPU" decorator at
# startup, so it must be written directly on the function (no indirection/alias).
import spaces


@spaces.GPU(duration=10)
def gpu_probe():
    return "ok"


with gr.Blocks() as demo:
    gr.Markdown("Bot is running.")
    _btn = gr.Button("probe")
    _out = gr.Textbox()
    _btn.click(gpu_probe, None, _out)

try:
    app = gr.mount_gradio_app(app, demo, path="/gradio", ssr_mode=False)
except TypeError:  # older gradio without the ssr_mode argument
    app = gr.mount_gradio_app(app, demo, path="/gradio")


def debug_port(port: int):
    """If the port is already taken, log who holds it (helps diagnose 'address in use')."""
    import socket
    import subprocess

    with socket.socket() as sk:
        sk.settimeout(1)
        if sk.connect_ex(("127.0.0.1", port)) != 0:
            return
    log.error("Port %s is ALREADY in use before we start.", port)
    for cmd in (["ss", "-ltnp"], ["ps", "aux"]):
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, timeout=5).stdout
            log.error("%s:\n%s", " ".join(cmd), out[:3000])
        except Exception as e:
            log.error("%s failed: %s", cmd[0], e)


if __name__ == "__main__":
    _port = int(os.environ.get("PORT", 7860))
    debug_port(_port)
    # Manual uvicorn (instead of demo.launch()) skips ZeroGPU's own startup
    # handshake, so it must be triggered explicitly or the Space is killed
    # with "No @spaces.GPU function detected during startup".
    try:
        from spaces import zero
        zero.startup()
        log.info("spaces.zero.startup() ok")
    except Exception as e:
        log.warning("spaces.zero.startup() skipped: %s", e)
    log.info("starting uvicorn on 0.0.0.0:%s", _port)
    try:
        uvicorn.run(app, host="0.0.0.0", port=_port)
        log.error("uvicorn.run() returned without an exception — the server stopped on its own")
    except BaseException:
        log.exception("uvicorn crashed")
        raise
else:
    log.warning("app.py was IMPORTED (__name__=%s), not run as a script — uvicorn is NOT started from this process", __name__)