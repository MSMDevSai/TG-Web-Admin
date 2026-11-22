"""
Web bridge for the Telegram Serverless panel
============================================

The serverless platform only accepts ``POST /api/<name>`` when the request
carries ``Authorization: TMA <base64(initData)>`` where ``initData`` is signed
with the bot token. A normal browser cannot produce that signature, so this
tiny service sits in front of the same panel and:

  * serves the panel's static files from the serverless origin (GET passthrough),
  * authenticates the browser with the panel's *own* username/password
    (``/api/login``, stored as ``TG_SESSION`` by the UI),
  * signs a fresh ``initData`` for the logged-in panel user's Telegram id and
    forwards every other ``/api/*`` call to the serverless origin.

The bot token never leaves this process. Deploy it as a **private** Hugging Face
**Gradio SDK Space** (no Docker plan needed): Gradio serves a small landing page
at ``/gradio`` and the same process mounts the panel proxy at ``/``; see
README.md.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import time
from typing import Optional
from urllib.parse import quote, urlencode

import httpx
import gradio as gr
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse, RedirectResponse, Response

# ─────────────────────────────── configuration ──────────────────────────────

BOT_TOKEN = os.environ.get("BOT_TOKEN", "").strip()
ORIGIN = os.environ.get("SERVERLESS_ORIGIN", "https://app8813333912.tgcloud.ai").rstrip("/")

# Any Telegram id can sign/verify the proxy's own calls (login / me / reset);
# it does not need to be a member. Membership is checked per logged-in user via
# the panel's `boot` endpoint right after a successful login.
SIGNER_ID = int(os.environ.get("PROXY_TELEGRAM_ID", "111111111") or 111111111)

SESSION_TTL = 15 * 60          # seconds; after that the token is re-validated via /api/me
LOGIN_LIMIT_PER_MIN = 12       # per client IP
ENDPOINT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

PUBLIC_ENDPOINTS = {"login", "request_password_reset", "reset_password"}

app = FastAPI(title="Telegram Serverless Web Bridge", docs_url=None, redoc_url=None)
client = httpx.AsyncClient(base_url=ORIGIN, timeout=45.0, follow_redirects=False)

_sessions: dict[str, tuple[int, float]] = {}
_login_hits: dict[str, list[float]] = {}


# ─────────────────────────────── initData signing ───────────────────────────

def make_init_data(user_id: int, first_name: str = "Web Panel") -> str:
    """Return a freshly signed initData string (telegram-web-app format).

    secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)
    hash       = HMAC_SHA256(key=secret_key, msg=data_check_string)
    """
    if not BOT_TOKEN:
        raise RuntimeError("BOT_TOKEN is not configured")

    user = {"id": int(user_id), "first_name": first_name, "language_code": "fa"}
    data = {
        "auth_date": str(int(time.time())),
        "user": json.dumps(user, separators=(",", ":"), ensure_ascii=False),
    }
    check_string = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    secret = hmac.new(b"WebAppData", BOT_TOKEN.encode("utf-8"), hashlib.sha256).digest()
    data["hash"] = hmac.new(secret, check_string.encode("utf-8"), hashlib.sha256).hexdigest()
    # encodeURIComponent-style encoding (quote, not quote_plus) like Telegram's client
    return urlencode(data, quote_via=quote)


def auth_header(user_id: int) -> str:
    raw = make_init_data(user_id)
    return "TMA " + base64.b64encode(raw.encode("utf-8")).decode("ascii")


# ─────────────────────────────── helpers ────────────────────────────────────

def envelope_error(description: str, status: int = 400, code: str = "BRIDGE_ERROR") -> JSONResponse:
    return JSONResponse(
        {
            "ok": False,
            "description": description,
            "error_code": status,
            "error_type": "ENDPOINT_ERROR",
            "parameters": {"code": code},
        },
        status_code=status,
        headers={"cache-control": "no-store"},
    )


def _json_response(payload: dict, status: int = 200) -> JSONResponse:
    return JSONResponse(payload, status_code=status, headers={"cache-control": "no-store"})


def _forward(r: Optional[httpx.Response]) -> Response:
    if r is None:
        return envelope_error("ارتباط با سرورلس برقرار نشد.", 502, "ORIGIN_DOWN")
    return Response(
        content=r.content,
        status_code=r.status_code,
        headers={
            "content-type": r.headers.get("content-type", "application/json; charset=utf-8"),
            "cache-control": "no-store",
        },
    )


def _result(r: Optional[httpx.Response]) -> Optional[dict]:
    if r is None or r.status_code != 200:
        return None
    try:
        data = r.json()
    except Exception:
        return None
    return data.get("result") if isinstance(data, dict) else None


def _description(r: Optional[httpx.Response], fallback: str) -> str:
    if r is not None:
        try:
            data = r.json()
            if isinstance(data, dict) and isinstance(data.get("description"), str):
                return data["description"]
        except Exception:
            pass
    return fallback


async def call_origin(name: str, payload: dict, user_id: int) -> Optional[httpx.Response]:
    try:
        return await client.post(
            f"/api/{name}",
            json=payload or {},
            headers={
                "Authorization": auth_header(user_id),
                "Content-Type": "application/json",
            },
        )
    except Exception:
        return None


async def _read_json(request: Request) -> dict:
    try:
        body = await request.body()
        data = json.loads(body or b"{}")
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    return (fwd.split(",")[0].strip() if fwd else "") or (request.client.host if request.client else "?")


def _rate_limited(ip: str) -> bool:
    now = time.time()
    hits = [t for t in _login_hits.get(ip, []) if now - t < 60]
    _login_hits[ip] = hits
    if len(hits) >= LOGIN_LIMIT_PER_MIN:
        return True
    hits.append(now)
    return False


def _bearer(request: Request) -> str:
    raw = request.headers.get("authorization", "").strip()
    if raw.lower().startswith("bearer "):
        raw = raw[7:].strip()
    # The panel stores the raw session token; never forward this as the origin's
    # Authorization header (that one must be the signed initData).
    return "" if raw.lower().startswith("tma ") else raw


async def resolve_token(token: str) -> Optional[int]:
    """Map a panel session token to its Telegram id (cached, re-validated)."""
    hit = _sessions.get(token)
    if hit and time.time() - hit[1] < SESSION_TTL:
        return hit[0]
    r = await call_origin("me", {"token": token}, SIGNER_ID)
    res = _result(r)
    if not res:
        _sessions.pop(token, None)
        return None
    tg = res.get("telegramId")
    if not tg:
        return None
    tg = int(tg)
    _sessions[token] = (tg, time.time())
    return tg


async def _finish_login(result: dict) -> Response:
    """Validate that the panel user maps to a real panel member, then cache token."""
    token = result.get("token")
    tg = result.get("telegramId")
    if not token:
        return envelope_error("پاسخ ورود نامعتبر بود.", 502, "BAD_LOGIN_RESULT")
    if not tg:
        return envelope_error(
            "این کاربر پنل به آیدی عددی تلگرام وصل نیست. ادمین باید در ثبت کاربر، آیدی تلگرام را وارد کند.",
            403,
            "NO_TELEGRAM_ID",
        )
    tg = int(tg)

    # The panel decides permissions by the *Telegram member* role, not by the
    # panel user's role — check membership now and surface a useful message.
    boot = await call_origin("boot", {}, tg)
    if boot is None or boot.status_code != 200:
        desc = _description(boot, "این آیدی تلگرام عضو پنل نیست.")
        return envelope_error(f"{desc} (آیدی تلگرام: {tg})", 403, "NOT_A_MEMBER")

    boot_res = _result(boot) or {}
    me = boot_res.get("me") or {}
    if me.get("role"):
        result["role"] = me["role"]

    _sessions[token] = (tg, time.time())
    return _json_response({"ok": True, "result": result})


# ─────────────────────────────── API proxy ──────────────────────────────────

@app.post("/api/{name}")
async def api_proxy(name: str, request: Request):
    if not ENDPOINT_RE.match(name):
        return envelope_error("نام اندپوینت نامعتبر است.", 400, "BAD_ENDPOINT")
    if not BOT_TOKEN:
        return envelope_error("BOT_TOKEN روی سرویس تنظیم نشده است.", 500, "NO_BOT_TOKEN")

    payload = await _read_json(request)

    if name == "login":
        if _rate_limited(_client_ip(request)):
            return envelope_error("تلاش‌های ورود زیاد است؛ یک دقیقه بعد دوباره امتحان کنید.", 429, "RATE_LIMITED")
        r = await call_origin("login", payload, SIGNER_ID)
        if r is None or r.status_code != 200:
            return _forward(r)
        return await _finish_login(_result(r) or {})

    if name == "reset_password":
        if _rate_limited(_client_ip(request)):
            return envelope_error("تلاش‌های بازیابی زیاد است؛ یک دقیقه بعد دوباره امتحان کنید.", 429, "RATE_LIMITED")
        r = await call_origin("reset_password", payload, SIGNER_ID)
        if r is None or r.status_code != 200:
            return _forward(r)
        res = _result(r) or {}
        # A reset returns a session token; validate/cache it like a login.
        if res.get("token"):
            return await _finish_login(res)
        return _json_response({"ok": True, "result": res})

    if name == "request_password_reset":
        if _rate_limited(_client_ip(request)):
            return envelope_error("درخواست‌های بازیابی زیاد است؛ یک دقیقه بعد دوباره امتحان کنید.", 429, "RATE_LIMITED")
        r = await call_origin("request_password_reset", payload, SIGNER_ID)
        return _forward(r)

    if name == "me" and not payload.get("token"):
        return envelope_error("توکن جلسه لازم است.", 401, "UNAUTHORIZED")

    token = _bearer(request) or str(payload.get("token") or "")
    if not token:
        return envelope_error("ابتدا وارد شوید.", 401, "UNAUTHORIZED")

    # `me` resolves the token itself; everything else needs the mapped Telegram id.
    if name == "me":
        return _forward(await call_origin("me", {"token": token}, SIGNER_ID))

    tg = await resolve_token(token)
    if not tg:
        return envelope_error("جلسه منقضی شده است؛ دوباره وارد شوید.", 401, "SESSION_EXPIRED")

    r = await call_origin(name, payload, tg)
    if name == "logout":
        _sessions.pop(token, None)
    return _forward(r)


# ───────────────────────────── Gradio landing page ─────────────────────────
# Hugging Face runs this file for a "gradio" SDK Space. The Gradio UI is only a
# small landing/status page; the panel itself is served by the proxy below at
# `/`, so opening the Space URL lands directly on the real panel.
with gr.Blocks(title="پل پنل وب تلگرام", theme=gr.themes.Soft()) as demo:
    gr.Markdown(
        """
        # 🌐 پل پنل وب تلگرام
        این Space فقط یک **پل** است: خودِ پنل و همهٔ داده‌ها روی
        **Telegram Serverless** می‌مانند و این‌جا فقط درخواست‌ها را با
        `initData` امضاشده به همان دامنه می‌فرستد.
        """
    )
    gr.HTML(
        '<a href="/" target="_top" '
        'style="display:inline-block;padding:.8rem 1.6rem;border-radius:10px;'
        'background:#4f46e5;color:#fff;font-weight:700;text-decoration:none">'
        'ورود به پنل ←</a>'
    )
    gr.Markdown(
        f"""
        ---
        **دامنهٔ سرورلس:** `{ORIGIN}`  
        **وضعیت توکن ربات:** {'✅ تنظیم شده' if BOT_TOKEN else '❌ تنظیم نشده (Secret را اضافه کنید)'}  
        **سلامت سرویس:** [`/healthz`](/healthz)
        """
    )


app = gr.mount_gradio_app(app, demo, path="/gradio")


@app.get("/gradio", include_in_schema=False)
async def _gradio_redirect():
    # `/gradio` (no trailing slash) would otherwise fall through to the panel
    # catch-all route below, because Starlette Mount only returns a redirect.
    return RedirectResponse(url="/gradio/", status_code=307)


# ─────────────────────────────── static proxy ───────────────────────────────

@app.get("/healthz")
async def healthz():
    return {"ok": True, "origin": ORIGIN, "token_configured": bool(BOT_TOKEN)}


@app.api_route("/{path:path}", methods=["GET", "HEAD"])
async def static_proxy(path: str, request: Request):
    if path == "api" or path.startswith("api/"):
        return envelope_error("متد پشتیبانی نمی‌شود.", 405, "METHOD_NOT_ALLOWED")
    if ".." in path.split("/"):
        return PlainTextResponse("bad path", status_code=400)

    target = "/" + path
    if request.url.query:
        target += "?" + request.url.query

    try:
        r = await client.get(target, headers={"accept": request.headers.get("accept", "*/*")})
    except Exception:
        return PlainTextResponse("web-bridge: serverless origin is unreachable", status_code=502)

    body = r.content
    ctype = r.headers.get("content-type", "application/octet-stream")

    # Let the panel UI know it is served through the bridge (login IS possible here).
    if "text/html" in ctype and b"__WEB_BRIDGE__" not in body:
        text = body.decode("utf-8", "replace")
        marker = "<script>window.__WEB_BRIDGE__=true;</script>"
        text = text.replace("</head>", marker + "</head>", 1) if "</head>" in text else marker + text
        body = text.encode("utf-8")

    headers = {
        "content-type": ctype,
        "cache-control": r.headers.get("cache-control", "no-cache"),
    }
    if r.headers.get("etag"):
        headers["etag"] = r.headers["etag"]
    return Response(content=body, status_code=r.status_code, headers=headers)


@app.on_event("startup")
async def _warn_missing_token():
    if not BOT_TOKEN:
        print("[web-bridge] WARNING: BOT_TOKEN is empty — API calls will fail.", flush=True)
    else:
        print(f"[web-bridge] origin={ORIGIN} signer_id={SIGNER_ID}", flush=True)


if __name__ == "__main__":
    # Hugging Face Spaces (gradio SDK) run `python app.py`; default port is 7860.
    port = int(os.environ.get("PORT") or os.environ.get("GRADIO_SERVER_PORT") or 7860)
    uvicorn.run(app, host="0.0.0.0", port=port)
