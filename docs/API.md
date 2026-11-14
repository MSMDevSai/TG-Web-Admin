# Panel API — contract for clients (web panel, Android app)

Base URL: the Space URL. All paths below are under `/api`. JSON in, JSON out. API version: **1** (`GET /api/version`).
Breaking changes will go to `/api/v2`; additive changes (new fields / endpoints) can appear in v1, so **ignore unknown fields**.

## 1. Authentication

| | |
|---|---|
| `POST /api/login` | body `{"username","password","deviceName?","platform?","appVersion?"}` (`platform`: `web` · `pwa` · `android` · `windows`) → `{"token","username","is_owner","must_change?"}`. Owner signs in with an empty / `owner` / `admin` username + the web password. |
| `POST /api/logout` | revokes the token you send. |
| Sending the token | `Authorization: Bearer <token>` (the web panel's raw `Authorization: <token>` still works). Media `<img>`/`<video>` URLs may use `?auth=<token>` instead. |
| `GET /api/sessions` | your signed-in devices: `[{"id","device":{"name","platform","app"},"created","last_seen","current"}]` (`last_seen` is stamped at most every 5 min, so treat it as ±5 min). Never contains tokens. |
| `PATCH /api/sessions/{id}` | body `{"name"}` — rename a device (max 60 chars) so the list is recognisable. |
| `DELETE /api/sessions/{id}` | sign one device out (works on the current one too). |
| `POST /api/change-password` | required before anything else when login returned `must_change: true` (every other call answers `403 must_change_password`). |

Errors: `401` bad/expired token → send the user to sign-in. `403` suspended or must-change. `429` too many failed logins — body has `retry_after` (seconds) and the `Retry-After` header is set. Failed-login limit: 8 per 10 minutes per client+account.
Tokens do not expire on their own; they end on logout, revoke, password change or account suspension.

## 2. Reading data (cache-friendly)

* `GET /api/chats` → every conversation, newest activity first: `{id,title,last_text,last_sender,time,is_group?,business_connection_id?,has_bot_chat?,muted?,pinned?,ai_pending}`.
* `GET /api/chat?id=<chatId>&limit=<1..500, default 120>[&before_id=<message id>]` → messages oldest→newest. Without `before_id` it is the newest `limit`; with it, the `limit` messages just before that one (empty list = reached the start).
* Message: `{id, msg_id, role, text, sender, time, ts, type?, file_id?, reply_to_msg_id?, reply_to_preview?, forwarded_from?, my_reaction?, their_reaction?}` (`my_reaction` = emoji you set, `their_reaction` = the contact's).
  `id` is the panel's own id (string, ascending — use it for paging and as the local primary key); `msg_id` is Telegram's id (use it when replying / editing / deleting).
  `role`: `user` (customer), `owner`, `admin`/`model`/`bot_auto` (everything sent from the panel / AI / bot).
* **ETag**: `/chats` and the newest-page form of `/chat` send `ETag`. Send it back as `If-None-Match` → `304` with no body when nothing changed. Use it on every refresh.
* Media: `GET /api/media?file_id=…` and `GET /api/user-photo?id=…` accept the token as header or `?auth=`; cache the bytes locally keyed by `file_id`. `/api/media` supports **HTTP Range** (`206 Partial Content`, `Accept-Ranges: bytes`), so video / voice players can seek; files over Telegram's 20 MB bot-download limit answer 404.

**Merging rule for a local cache.** A fetched page covers the id range `[first.id … last.id]`. Replace your local rows in exactly that range with the response (rows missing from the response were deleted); never touch rows outside it. The server only keeps history for a limited time (inactive chats can expire after ~7 days on the Cloudflare KV backend), so **an old row that is no longer on the server is not a deletion** — your local copy may be the only one.

## 3. Staying up to date

### 3a. WebSocket `/ws` (live hints)
1. Connect `wss://<host>/ws`, then **first frame** `{"t":"auth","token":"<token>"}` within 10 s (tokens are never put in the URL).
2. Server → `{"t":"hello","cursor":"<c>"}`; or `{"t":"unauthorized"}` + close code `4401` (stop reconnecting, sign in again).
3. Server → `{"t":"dirty","chats":bool,"chat":["<chatId>",…],"cursor":"<c>"}` — *something changed*: `chats` = the chat list, `chat` = those chats' messages. **It carries no data**: refetch through the REST calls above (ETag makes unchanged answers free).
4. Keep-alive: server sends `{"t":"ping"}` every 25 s — answer `{"t":"pong"}` (any frame counts). Silent for > 75 s ⇒ reconnect. Reconnect with exponential back-off (1 s → 15 s) and immediately when the network returns.

### 3b. Catch-up after being away: `GET /api/sync?cursor=<c>`
Keep the last `cursor` you saw (from `hello`, `dirty` or a previous sync). → `{"cursor","reset","index","chats":[…]}`
* `reset:false` — `index:true` ⇒ refetch `/chats`; every id in `chats` ⇒ refetch that chat's newest page. Store the returned `cursor`.
* `reset:true` — cursor unusable (first run, or the server restarted): treat all cached data as stale once (refetch `/chats` and the chats you display), then continue with the returned cursor.
Recommended app loop: on launch / reconnect → `sync(lastCursor)`; while connected → react to `dirty`; fall back to `sync` every ~30 s if the socket cannot connect.

## 4. Writing
`POST /api/send` `{chatId, text, replyToMsgId?, …}` · `POST /api/send-media` (multipart) · `POST /api/send-sticker` · `POST /api/edit` · `POST /api/forward` · `POST /api/delete-message` · `POST /api/react` · `POST /api/pin-message` · `POST /api/mute` `{chatId,muted}` · `POST /api/pin` `{chatId,pinned}` (pins the conversation to the top of the panel list; Telegram is untouched) · `POST /api/pin-message` · `POST /api/delete-chat` (removes it from the panel only; Telegram is untouched). Each returns `{"success":true}` or `{"error":"…"}` with a 4xx status; the `error` text is user-presentable (Persian). All writes also fire a `dirty` hint to every connected device, including the sender's other devices.

## 5. Not available yet
* **Push while the app is closed (FCM)** — device registration + sender are not built yet; they need a Firebase project. Until then, a killed app only learns about new messages when it is opened (then `sync`).
* Per-device Web Push subscriptions: `/api/save-subscription` still stores a single subscription for the account.
