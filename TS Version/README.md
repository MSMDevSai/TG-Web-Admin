# ☁️ Telegram Panel — Telegram Serverless edition

**Languages:** [English](#english) · [Persian (فارسی)](#persian) · [Russian (Русский)](#russian)

> This is the **Telegram Serverless edition**: no server, everything runs on Telegram's own infrastructure. The Python edition for Hugging Face Spaces lives in [`../huggingface/`](../huggingface/). Differences are summarised in each language below.

---

## English

### What it is

An AI assistant for your **Telegram Business** account plus a **Mini App panel**. The bot answers your contacts on your behalf with Gemini; the panel lets you and the people you trust read every chat, answer, send media, and browse a permanent archive — including messages and files that were deleted in Telegram.

### Features

- **Access by Telegram numeric ID.** No passwords, no public panel. Telegram verifies who opens the Mini App; the app checks the ID against a members list. Roles: **admin** and **user**.
- **AI replies (Gemini)** with a configurable silence delay (default 28 s): several quick messages get one answer, and if you (or the panel) answer first, the AI stays quiet. The panel shows "✨ preparing a reply".
- **Collector archive.** Messages are never deleted. A message deleted by the contact is marked 🗑 but its content stays. Every edit keeps the previous text in an edit history. Photos, voice notes, video, stickers and files are stored as bytes (up to a configurable size) and stay viewable after deletion.
- **Telegram notifications.** The bot sends each new message to members' private chats, with buttons "mute this chat" and "open in the panel". Off switches: global (admin), per chat, and personal (`/notify off` or the 🔔 button). Contacts deleting a message also trigger a notification that includes the saved text.
- **Media in the panel:** photos, video, GIFs, voice, audio, stickers (static / video), files — viewing and sending (attach button and voice recording).
- **Panel:** chat list with search, unread counters, pin / mute, filters "All / Media / Deleted", reply, react, edit, delete (admin), edit history, per-chat AI mode and prompt, global settings, member management.
- **Commands for contacts:** `/start`, `/send_msg <text>` (forwards a message to the admins).

### Roles

| | Admin | User |
|---|---|---|
| View chats, archive (media / deleted), edit history | ✅ | ✅ |
| Send text / media / voice, react, edit own messages, pin and mute chats | ✅ | ✅ |
| Delete a message from Telegram (it stays in the panel) | ✅ | ❌ |
| AI settings, Gemini key, prompt, global settings | ✅ | ❌ |
| Manage members | ✅ | ❌ |

IDs listed in `BOOTSTRAP_ADMINS` (`tgcloud/lib/config.js`) are always admins and cannot be removed or demoted from the panel, so you can never lock yourself out.

### How it works

1. **Telegram → handlers.** Each update type has a file in `tgcloud/handlers/` (`business_message`, `edited_business_message`, `deleted_business_messages`, `business_connection`, `message_reaction`, `callback_query`, `message`, `edited_message`).
2. **Ingest** (`lib/ingest.js`): identifies the owner via the business connection, skips duplicates, stores the message, archives media bytes, updates the chat, sends notifications.
3. **AI debounce:** after storing a contact's message the handler records "pending until…", waits `ai_delay_seconds`, then checks whether its message is *still the latest message of the chat*. If yes it calls Gemini with the last N messages and sends the reply; if a newer contact message exists, that newer invocation answers; if you or the panel replied meanwhile, nothing is sent.
4. **Edits and deletions:** an edit saves the old text in `edits`; a deletion only sets `deleted_at`.
5. **Panel → endpoints.** The Mini App calls functions in `tgcloud/endpoints/`; each begins by checking the verified Telegram ID against the members table and the required role.
6. **Media transfer:** endpoints return JSON only, so files travel as base64 chunks of 384 KB in both directions.

### Project layout

```
tgcloud/
  schema.js        members, settings, connections, chats, messages, edits, media, upload_parts, reads
  handlers/        Telegram update handlers
  endpoints/       boot, chats, messages, send, upload, media, react, editMessage, editHistory,
                   deleteMessage, chatPrefs, settings, members, prefs
  lib/             config, store, auth, ingest, ai, media, notify, edits, tg, util, b64
web/               Mini App (index.html, app.js, style.css) — no build step
dev/               local tests on a mock SDK + SQLite  (sh dev/test.sh)
tgcloud.jsonc  package.json
```

### Setup

1. **BotFather:** Serverless enabled; `Bot Settings → Business Mode` on.
2. **Telegram (Premium):** `Settings → Business → Chatbots` → connect the bot with permission to reply (and to delete, if you want panel deletion to work).
3. Scaffold a project so the CLI and docs match your version, then copy this edition over it:
   ```bash
   npm create @tgcloud/bot panel && cd panel
   # copy tgcloud/, web/ and tgcloud.jsonc from this edition (replace the sample handlers/message.js)
   ```
4. Edit `tgcloud/lib/config.js`: put your numeric ID in `BOOTSTRAP_ADMINS`.
5. Deploy:
   ```bash
   npx tgcloud login
   npx tgcloud push
   npx tgcloud migrate      # approve the safe changes
   ```
6. `push` prints `https://app<ID>.tgcloud.ai/`. Put it into `WEBAPP_URL` in `config.js`, push again, and register it in BotFather as the bot's Mini App / menu button.
7. Every member sends `/start` to the bot once (needed for Telegram notifications).
8. Open the panel → ⚙️ → enter the Gemini key → save. Add members from 👥 (e.g. `2222` as user, `3333` as admin).

### Settings (panel → ⚙️, admin only)

`ai_mode`, `gemini_api_key` (never sent back to the panel), `gemini_model`, `ai_delay_seconds`, `ai_history_limit`, `system_prompt`, `assistant_label`, `notify_enabled`, `notify_deleted`, `admin_group_id`, `archive_media`, `archive_max_mb` (max 20), `archive_video_note` (round video messages are recorded but their bytes are not stored by default).

### To verify on the real platform (in this order)

1. **The silence timer.** The documentation does not mention timers or execution-time limits. Set `ai_delay_seconds` to 10, message from another account, and watch whether a reply arrives or the run is cut off.
2. **Business updates.** `npx tgcloud webhook` should list `business_message`, `edited_business_message`, `deleted_business_messages`, `business_connection`, `message_reaction`, `callback_query`.
3. **Sign-in.** `npx tgcloud run endpoints/boot '{}' --ctx '{ initData: { user: { id: <your id>, first_name: "x" } } }'`.
4. **Business delete / edit / reaction** depend on the permissions granted in Telegram Business; errors appear in the panel as readable messages.
5. **Voice from the Mini App.** Telegram's web view may record ogg, m4a or webm. The panel tries `voice → audio → document`; if webm is produced it will not become a real voice note and an ogg conversion has to be added.
6. **JSON size limits and database size** are not specified in the documentation. If responses are rejected, lower `CHUNK` in `endpoints/media.js` and `web/app.js` / `endpoints/upload.js`; limit storage with `archive_max_mb` and `archive_media`.

The bundled tests (`sh dev/test.sh`, Node 22.5+) check the project's own logic against a mock SDK and SQLite — they do not prove how the real platform behaves.

### Differences from the Hugging Face edition

| | ☁️ Serverless (this one) | 🤗 Hugging Face |
|---|---|---|
| Runs on | Telegram's JavaScript sandbox, no server | Always-on Python container (FastAPI) |
| Panel access | Mini App only; Telegram numeric ID; roles admin / user | Public web panel / PWA; username + password |
| Users | One bot per project, several members | Multi-tenant, many accounts with their own bots |
| Live updates | Polling + Telegram notifications | WebSocket + Web Push |
| External apps | None (endpoints callable only from the Mini App) | Documented REST API v1 |
| Storage | SQLite tables | JSON in files / Cloudflare KV |
| AI context | Last N messages | Whole history |
| Media | Bytes archived in the database, chunked transfer, no ffmpeg | Streamed from Telegram by `file_id`, Range, ffmpeg |
| Deleted messages | Marked 🗑, content kept; edit history kept | History kept; deletions not marked |
| Not yet ported | Group moderation, sticker / GIF panel, forward, in-chat pin, bot profile editing, profile photos, animated (tgs) stickers | — |

---

## Persian

<div dir="rtl">

**فارسی**

> این **نسخه‌ی Telegram Serverless** است: بدون سرور، همه‌چیز روی زیرساخت خود تلگرام اجرا می‌شود. نسخه‌ی پایتونی برای Hugging Face Space در [`../huggingface/`](../huggingface/) است. تفاوت‌ها در پایان همین بخش آمده است.

### این پروژه چیست؟

یک دستیار هوشمند برای اکانت **Telegram Business** شما به‌همراه یک **پنل Mini App**. ربات به‌جای شما با Gemini به مخاطب‌ها جواب می‌دهد؛ پنل به شما و افراد مورد اعتمادتان اجازه می‌دهد همه‌ی چت‌ها را بخوانید، پاسخ بدهید، رسانه بفرستید و در یک آرشیو دائمی بگردید — حتی پیام‌ها و فایل‌هایی که در تلگرام پاک شده‌اند.

### قابلیت‌ها

- **دسترسی با آیدی عددی تلگرام.** بدون رمز و بدون پنل عمومی. تلگرام تأیید می‌کند چه کسی Mini App را باز کرده و برنامه آیدی او را با فهرست اعضا مقایسه می‌کند. نقش‌ها: **ادمین** و **کاربر**.
- **پاسخ هوشمند (Gemini)** با مکث قابل‌تنظیم (پیش‌فرض ۲۸ ثانیه): چند پیام سریع یک پاسخ می‌گیرند و اگر خودتان (یا پنل) زودتر جواب بدهید، AI ساکت می‌ماند. پنل «✨ در حال آماده‌سازی پاسخ» را نشان می‌دهد.
- **آرشیو کالکتور.** پیام‌ها هرگز پاک نمی‌شوند. پیامی که مخاطب حذف کند علامت 🗑 می‌گیرد ولی محتوایش می‌ماند. هر ویرایش، متن قبلی را در تاریخچه‌ی ویرایش نگه می‌دارد. عکس، ویس، ویدیو، استیکر و فایل به‌صورت بایت (تا حجم قابل‌تنظیم) ذخیره می‌شوند و بعد از حذف هم قابل‌دیدن‌اند.
- **اعلان تلگرامی.** ربات هر پیام جدید را در پیوی اعضا می‌فرستد، با دکمه‌ی «بستن اعلان این چت» و «باز کردن در پنل». کلیدهای خاموش‌کردن: کلی (ادمین)، هر چت، و شخصی (`/notify off` یا دکمه‌ی 🔔). وقتی مخاطب پیامی را پاک کند هم اعلانی همراه متن ذخیره‌شده می‌آید.
- **رسانه در پنل:** عکس، ویدیو، گیف، ویس، موزیک، استیکر (ثابت / ویدیویی)، فایل — هم نمایش و هم ارسال (دکمه‌ی پیوست و ضبط ویس).
- **پنل:** لیست چت‌ها با جستجو، شمارنده‌ی نخوانده، پین / بی‌صدا، فیلتر «همه / رسانه / حذف‌شده»، پاسخ، ری‌اکشن، ویرایش، حذف (ادمین)، تاریخچه‌ی ویرایش، حالت و پرامپت AI برای هر چت، تنظیمات کلی، مدیریت اعضا.
- **دستورهای مخاطب:** `/start` و `/send_msg <متن>` (ارسال پیام برای ادمین‌ها).

### نقش‌ها

| | ادمین | کاربر |
|---|---|---|
| دیدن چت‌ها، آرشیو (رسانه / حذف‌شده)، تاریخچه‌ی ویرایش | ✅ | ✅ |
| ارسال متن / رسانه / ویس، ری‌اکشن، ویرایش پیام‌های خودمان، پین و بی‌صدا کردن چت | ✅ | ✅ |
| حذف پیام از تلگرام (در پنل می‌ماند) | ✅ | ❌ |
| تنظیمات AI، کلید Gemini، پرامپت، تنظیمات کلی | ✅ | ❌ |
| مدیریت اعضا | ✅ | ❌ |

آیدی‌های `BOOTSTRAP_ADMINS` (در `tgcloud/lib/config.js`) همیشه ادمین‌اند و از پنل حذف یا تنزل نمی‌شوند؛ پس هرگز از پنل قفل نمی‌شوید.

### منطق کار

۱. **تلگرام ← handlerها.** برای هر نوع آپدیت یک فایل در `tgcloud/handlers/` هست (`business_message`، `edited_business_message`، `deleted_business_messages`، `business_connection`، `message_reaction`، `callback_query`، `message`، `edited_message`).
۲. **دریافت (ingest)** در `lib/ingest.js`: مالک را از روی اتصال بیزینس تشخیص می‌دهد، تکراری‌ها را رد می‌کند، پیام را ذخیره می‌کند، بایت رسانه را آرشیو می‌کند، چت را به‌روز می‌کند و اعلان می‌فرستد.
۳. **مکث AI:** بعد از ذخیره‌ی پیام مخاطب، handler «در انتظار تا…» را ثبت می‌کند، `ai_delay_seconds` صبر می‌کند و بررسی می‌کند پیامش هنوز *آخرین پیام چت* است یا نه. اگر بله، آخرین N پیام را به Gemini می‌دهد و پاسخ را می‌فرستد؛ اگر پیام جدیدتری از مخاطب آمده باشد، همان اجرای جدید پاسخ می‌دهد؛ اگر در این فاصله شما یا پنل جواب داده باشید، چیزی ارسال نمی‌شود.
۴. **ویرایش و حذف:** ویرایش متن قبلی را در `edits` می‌گذارد؛ حذف فقط `deleted_at` را مقدار می‌دهد.
۵. **پنل ← endpointها.** Mini App توابع `tgcloud/endpoints/` را صدا می‌زند؛ هرکدام اول آیدی تأییدشده‌ی تلگرام را با جدول اعضا و نقش لازم مقایسه می‌کنند.
۶. **انتقال رسانه:** endpointها فقط JSON برمی‌گردانند، پس فایل‌ها در هر دو جهت به‌صورت تکه‌های base64 با اندازه‌ی ۳۸۴ کیلوبایت جابه‌جا می‌شوند.

### ساختار پروژه

```
tgcloud/
  schema.js        members، settings، connections، chats، messages، edits، media، upload_parts، reads
  handlers/        مدیریت آپدیت‌های تلگرام
  endpoints/       boot، chats، messages، send، upload، media، react، editMessage، editHistory،
                   deleteMessage، chatPrefs، settings، members، prefs
  lib/             config، store، auth، ingest، ai، media، notify، edits، tg، util، b64
web/               Mini App (‏index.html، app.js، style.css) — بدون build
dev/               تست‌های محلی روی SDK ساختگی + SQLite  (sh dev/test.sh)
tgcloud.jsonc  package.json
```

### راه‌اندازی

۱. **BotFather:** Serverless فعال؛ `Bot Settings ← Business Mode` روشن.
۲. **تلگرام (Premium):** `Settings ← Business ← Chatbots` ← ربات را با اجازه‌ی پاسخ دادن (و اگر حذف از پنل را می‌خواهید، اجازه‌ی حذف) وصل کنید.
۳. یک پروژه بسازید تا CLI و مستندات با نسخه‌ی شما هم‌خوان باشد و بعد این نسخه را روی آن کپی کنید:
   ```bash
   npm create @tgcloud/bot panel && cd panel
   # پوشه‌های tgcloud/ و web/ و فایل tgcloud.jsonc را کپی کنید (handlers/message.js نمونه را جایگزین کنید)
   ```
۴. `tgcloud/lib/config.js` را ویرایش کنید: آیدی عددی خودتان را در `BOOTSTRAP_ADMINS` بگذارید.
۵. دیپلوی:
   ```bash
   npx tgcloud login
   npx tgcloud push
   npx tgcloud migrate      # تغییرات safe را تأیید کنید
   ```
۶. `push` آدرس `https://app<ID>.tgcloud.ai/` را چاپ می‌کند. آن را در `WEBAPP_URL` داخل `config.js` بگذارید، دوباره push کنید و در BotFather به‌عنوان Mini App / دکمه‌ی منوی ربات ثبت کنید.
۷. هر عضو یک‌بار به ربات `/start` بزند (برای اعلان‌های تلگرامی لازم است).
۸. پنل را باز کنید ← ⚙️ ← کلید Gemini را وارد و ذخیره کنید. از 👥 اعضا را اضافه کنید (مثلاً `2222` کاربر و `3333` ادمین).

### تنظیمات (پنل ← ⚙️، فقط ادمین)

`ai_mode`، `gemini_api_key` (هرگز به پنل برگردانده نمی‌شود)، `gemini_model`، `ai_delay_seconds`، `ai_history_limit`، `system_prompt`، `assistant_label`، `notify_enabled`، `notify_deleted`، `admin_group_id`، `archive_media`، `archive_max_mb` (حداکثر ۲۰)، `archive_video_note` (ویدیو مسیج‌های گرد ثبت می‌شوند ولی بایتشان پیش‌فرض ذخیره نمی‌شود).

### چیزهایی که باید روی پلتفرم واقعی تأیید شوند (به همین ترتیب)

۱. **تایمر سکوت.** مستندات از تایمر یا محدودیت زمان اجرا حرفی نمی‌زنند. `ai_delay_seconds` را ۱۰ بگذارید، از اکانت دیگری پیام بدهید و ببینید پاسخ می‌آید یا اجرا قطع می‌شود.
۲. **آپدیت‌های بیزینس.** `npx tgcloud webhook` باید `business_message`، `edited_business_message`، `deleted_business_messages`، `business_connection`، `message_reaction` و `callback_query` را نشان دهد.
۳. **ورود.** `npx tgcloud run endpoints/boot '{}' --ctx '{ initData: { user: { id: <آیدی شما>, first_name: "x" } } }'`.
۴. **حذف / ویرایش / ری‌اکشن بیزینسی** به دسترسی‌های Telegram Business بستگی دارند؛ خطاها در پنل به‌صورت پیام خوانا نشان داده می‌شوند.
۵. **ویس از Mini App.** مرورگر داخلی تلگرام ممکن است ogg، m4a یا webm ضبط کند. پنل `voice ← audio ← document` را امتحان می‌کند؛ اگر webm تولید شود ویس واقعی نمی‌شود و باید تبدیل به ogg اضافه شود.
۶. **سقف حجم JSON و حجم دیتابیس** در مستندات مشخص نیست. اگر پاسخ‌ها رد شدند، `CHUNK` را در `endpoints/media.js` و `web/app.js` / `endpoints/upload.js` کم کنید؛ حجم ذخیره‌سازی را با `archive_max_mb` و `archive_media` محدود کنید.

تست‌های همراه پروژه (`sh dev/test.sh`، نیازمند Node 22.5+) منطق خود پروژه را روی SDK ساختگی و SQLite می‌سنجند — رفتار واقعی پلتفرم را ثابت نمی‌کنند.

### تفاوت با نسخه‌ی Hugging Face

| | ☁️ Serverless (همین نسخه) | 🤗 Hugging Face |
|---|---|---|
| محل اجرا | محیط JavaScript تلگرام، بدون سرور | کانتینر پایتون همیشه‌روشن (FastAPI) |
| دسترسی به پنل | فقط Mini App؛ آیدی عددی تلگرام؛ نقش ادمین / کاربر | پنل وب / PWA عمومی؛ نام کاربری و رمز |
| کاربران | یک ربات برای هر پروژه، چند عضو | چندکاربره، حساب‌های متعدد با ربات‌های مخصوص خودشان |
| به‌روزرسانی زنده | polling + اعلان تلگرام | WebSocket + Web Push |
| اپ‌های بیرونی | ندارد (endpointها فقط از داخل Mini App قابل صدا زدن‌اند) | API مستند REST نسخه‌ی ۱ |
| ذخیره‌سازی | جدول‌های SQLite | JSON در فایل / Cloudflare KV |
| حافظه‌ی AI | N پیام آخر | کل تاریخچه |
| رسانه | بایت‌ها در دیتابیس آرشیو می‌شوند، انتقال تکه‌تکه، بدون ffmpeg | استریم از تلگرام با `file_id`، Range، ffmpeg |
| پیام‌های حذف‌شده | علامت 🗑 می‌خورند و محتوا می‌ماند؛ تاریخچه‌ی ویرایش نگه داشته می‌شود | تاریخچه می‌ماند؛ حذف علامت نمی‌خورد |
| هنوز منتقل نشده | مدیریت گروه، پنل استیکر / گیف، فوروارد، پین داخل چت، ویرایش پروفایل ربات، عکس پروفایل، استیکرهای متحرک (tgs) | — |

</div>

---

## Russian

**Русский**

> Это **редакция Telegram Serverless**: без сервера, всё работает на собственной инфраструктуре Telegram. Python-редакция для Hugging Face Spaces находится в [`../huggingface/`](../huggingface/). Различия кратко перечислены в конце раздела.

### Что это

ИИ-ассистент для вашего аккаунта **Telegram Business** и **панель в виде Mini App**. Бот отвечает контактам от вашего имени с помощью Gemini; панель позволяет вам и доверенным людям читать все чаты, отвечать, отправлять медиа и пользоваться постоянным архивом — в том числе сообщениями и файлами, удалёнными в Telegram.

### Возможности

- **Доступ по числовому ID Telegram.** Без паролей и без публичной панели. Telegram подтверждает, кто открыл Mini App, а приложение сверяет ID со списком участников. Роли: **admin** и **user**.
- **Ответы ИИ (Gemini)** с настраиваемой паузой (по умолчанию 28 с): несколько быстрых сообщений получают один ответ, а если вы (или панель) ответите раньше, ИИ молчит. Панель показывает «✨ готовится ответ».
- **Архив-коллектор.** Сообщения никогда не удаляются. Сообщение, удалённое контактом, помечается 🗑, но его содержимое остаётся. Каждая правка сохраняет прежний текст в истории правок. Фото, голосовые, видео, стикеры и файлы хранятся в виде байтов (до настраиваемого размера) и остаются доступными после удаления.
- **Уведомления Telegram.** Бот присылает каждое новое сообщение участникам в личку с кнопками «отключить этот чат» и «открыть в панели». Переключатели: общий (admin), по чату и личный (`/notify off` или кнопка 🔔). Удаление сообщения контактом тоже вызывает уведомление с сохранённым текстом.
- **Медиа в панели:** фото, видео, GIF, голосовые, аудио, стикеры (статичные / видео), файлы — просмотр и отправка (кнопка вложения и запись голоса).
- **Панель:** список чатов с поиском, счётчики непрочитанного, закрепление / отключение уведомлений, фильтры «Все / Медиа / Удалённые», ответ, реакции, правка, удаление (admin), история правок, режим и промпт ИИ для каждого чата, общие настройки, управление участниками.
- **Команды для контактов:** `/start`, `/send_msg <текст>` (пересылает сообщение администраторам).

### Роли

| | Admin | User |
|---|---|---|
| Просмотр чатов, архива (медиа / удалённые), истории правок | ✅ | ✅ |
| Отправка текста / медиа / голоса, реакции, правка своих сообщений, закрепление и отключение уведомлений чатов | ✅ | ✅ |
| Удаление сообщения в Telegram (в панели остаётся) | ✅ | ❌ |
| Настройки ИИ, ключ Gemini, промпт, общие настройки | ✅ | ❌ |
| Управление участниками | ✅ | ❌ |

ID из `BOOTSTRAP_ADMINS` (`tgcloud/lib/config.js`) всегда остаются администраторами и не могут быть удалены или понижены из панели — заблокировать себя невозможно.

### Как это работает

1. **Telegram → обработчики.** Для каждого типа обновления есть файл в `tgcloud/handlers/` (`business_message`, `edited_business_message`, `deleted_business_messages`, `business_connection`, `message_reaction`, `callback_query`, `message`, `edited_message`).
2. **Приём (ingest)**, `lib/ingest.js`: определяет владельца по бизнес-подключению, отбрасывает дубликаты, сохраняет сообщение, архивирует байты медиа, обновляет чат, отправляет уведомления.
3. **Пауза ИИ:** сохранив сообщение контакта, обработчик записывает «ожидание до…», ждёт `ai_delay_seconds` и проверяет, остаётся ли его сообщение *последним в чате*. Если да — вызывает Gemini с последними N сообщениями и отправляет ответ; если есть более новое сообщение контакта, отвечает уже тот, новый вызов; если за это время ответили вы или панель, ничего не отправляется.
4. **Правки и удаления:** правка сохраняет старый текст в `edits`; удаление лишь выставляет `deleted_at`.
5. **Панель → endpoint'ы.** Mini App вызывает функции из `tgcloud/endpoints/`; каждая сначала сверяет подтверждённый ID Telegram с таблицей участников и нужной ролью.
6. **Передача медиа:** endpoint'ы возвращают только JSON, поэтому файлы передаются в обе стороны фрагментами base64 по 384 КБ.

### Структура проекта

```
tgcloud/
  schema.js        members, settings, connections, chats, messages, edits, media, upload_parts, reads
  handlers/        обработчики обновлений Telegram
  endpoints/       boot, chats, messages, send, upload, media, react, editMessage, editHistory,
                   deleteMessage, chatPrefs, settings, members, prefs
  lib/             config, store, auth, ingest, ai, media, notify, edits, tg, util, b64
web/               Mini App (index.html, app.js, style.css) — без сборки
dev/               локальные тесты на мок-SDK + SQLite  (sh dev/test.sh)
tgcloud.jsonc  package.json
```

### Установка

1. **BotFather:** Serverless включён; `Bot Settings → Business Mode` включён.
2. **Telegram (Premium):** `Настройки → Telegram Business → Чат-боты` → подключите бота с правом отвечать (и удалять, если нужно удаление из панели).
3. Создайте проект, чтобы CLI и документация соответствовали вашей версии, затем скопируйте поверх него эту редакцию:
   ```bash
   npm create @tgcloud/bot panel && cd panel
   # скопируйте tgcloud/, web/ и tgcloud.jsonc (замените шаблонный handlers/message.js)
   ```
4. Отредактируйте `tgcloud/lib/config.js`: укажите свой числовой ID в `BOOTSTRAP_ADMINS`.
5. Деплой:
   ```bash
   npx tgcloud login
   npx tgcloud push
   npx tgcloud migrate      # подтвердите безопасные изменения
   ```
6. `push` выведет `https://app<ID>.tgcloud.ai/`. Впишите адрес в `WEBAPP_URL` в `config.js`, выполните push ещё раз и зарегистрируйте его в BotFather как Mini App / кнопку меню бота.
7. Каждый участник один раз отправляет боту `/start` (нужно для уведомлений Telegram).
8. Откройте панель → ⚙️ → введите ключ Gemini → сохраните. Добавьте участников через 👥 (например, `2222` как user, `3333` как admin).

### Настройки (панель → ⚙️, только admin)

`ai_mode`, `gemini_api_key` (никогда не возвращается в панель), `gemini_model`, `ai_delay_seconds`, `ai_history_limit`, `system_prompt`, `assistant_label`, `notify_enabled`, `notify_deleted`, `admin_group_id`, `archive_media`, `archive_max_mb` (максимум 20), `archive_video_note` (круглые видеосообщения записываются, но их байты по умолчанию не сохраняются).

### Что нужно проверить на реальной платформе (в таком порядке)

1. **Таймер паузы.** В документации нет ни слова о таймерах и ограничениях времени выполнения. Поставьте `ai_delay_seconds` = 10, напишите с другого аккаунта и посмотрите, придёт ли ответ или выполнение прервётся.
2. **Бизнес-обновления.** `npx tgcloud webhook` должен показывать `business_message`, `edited_business_message`, `deleted_business_messages`, `business_connection`, `message_reaction`, `callback_query`.
3. **Вход.** `npx tgcloud run endpoints/boot '{}' --ctx '{ initData: { user: { id: <ваш id>, first_name: "x" } } }'`.
4. **Удаление / правка / реакции в бизнес-чатах** зависят от прав, выданных в Telegram Business; ошибки показываются в панели читаемыми сообщениями.
5. **Голосовые из Mini App.** Веб-вью Telegram может записывать ogg, m4a или webm. Панель пробует `voice → audio → document`; если получится webm, настоящим голосовым оно не станет — потребуется конвертация в ogg.
6. **Лимиты размера JSON и размера базы** в документации не указаны. Если ответы отклоняются, уменьшите `CHUNK` в `endpoints/media.js` и `web/app.js` / `endpoints/upload.js`; ограничивайте хранилище через `archive_max_mb` и `archive_media`.

Встроенные тесты (`sh dev/test.sh`, Node 22.5+) проверяют логику самого проекта на мок-SDK и SQLite — они не доказывают поведение реальной платформы.

### Отличия от версии для Hugging Face

| | ☁️ Serverless (эта) | 🤗 Hugging Face |
|---|---|---|
| Где работает | JavaScript-среда Telegram, без сервера | Постоянно запущенный контейнер Python (FastAPI) |
| Доступ к панели | Только Mini App; числовой ID Telegram; роли admin / user | Публичная веб-панель / PWA; логин и пароль |
| Пользователи | Один бот на проект, несколько участников | Мультитенантность, много аккаунтов со своими ботами |
| Живые обновления | Опрос (polling) + уведомления Telegram | WebSocket + Web Push |
| Внешние приложения | Нет (endpoint'ы вызываются только из Mini App) | Документированный REST API v1 |
| Хранилище | Таблицы SQLite | JSON в файлах / Cloudflare KV |
| Контекст ИИ | Последние N сообщений | Вся история |
| Медиа | Байты в базе, передача частями, без ffmpeg | Стриминг из Telegram по `file_id`, Range, ffmpeg |
| Удалённые сообщения | Помечаются 🗑, содержимое остаётся; история правок сохраняется | История сохраняется; удаление не помечается |
| Ещё не перенесено | Модерация групп, панель стикеров / GIF, пересылка, закрепление в чате, редактирование профиля бота, фото профиля, анимированные (tgs) стикеры | — |
