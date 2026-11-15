---
title: Telegram Bot
emoji: 🤖
sdk: gradio
sdk_version: 5.49.1
app_file: app.py
pinned: false
---

# 🤖 Telegram Bot — Hugging Face edition

**Languages:** [English](#english) · [Persian (فارسی)](#persian) · [Russian (Русский)](#russian)

> This is the **Hugging Face Space edition** of the project. There is also a **Telegram Serverless edition** (no server at all, runs on Telegram's own infrastructure) — see the comparison table in each language below.

---

## English

### What it is

A Telegram bot that **answers your Telegram Business chats on your behalf with Gemini**, plus a **Telegram-Web-style admin panel** (web / PWA) where you read and answer every conversation yourself. Everything lives in one FastAPI app running on a Hugging Face Space. (The tiny Gradio app at the bottom of `app.py` only exists to satisfy the Space start-up check; the real server is FastAPI on port 7860.)

### Features

- **Telegram Business:** replies are sent from your own account through the business connection. Direct chats with the bot and groups are supported too.
- **AI replies (Gemini):** persona in `prompt.txt`; a short batching delay (default 28 s) so several quick messages get a single answer; a configurable label in front of AI replies.
- **Admin panel:** Telegram-Web-K-like UI (RTL, Persian). Chat list, full history, send / edit / delete / forward / react / pin / mute, media (photos, video, voice, stickers, GIFs, files), group moderation tools, bot profile editing, profile photos.
- **Live updates:** WebSocket "something changed" hints and Web Push notifications (installable PWA).
- **Multi-user:** the owner plus extra panel accounts created from the admin group (`/signup`, `/setbot`, `/resetpass`, `/suspend`, …). Each account has its own bot token and webhook. Temporary passwords are sent through Telegram and must be changed on first login. Per-device sessions and login rate limiting.
- **Client API v1** documented in `docs/API.md` (ETag, cursor-based sync, HTTP Range media) for building Android / Windows apps.
- **Storage:** a persistent directory (`DATA_DIR`, e.g. a mounted Hugging Face Storage Bucket) or Cloudflare KV as a fallback.

### How it works

1. Telegram calls `/webhook` (owner) or `/webhook/{secret}` (each panel account's bot). The app answers `OK` immediately and works in the background.
2. The message is stored in the chat history, the panel gets a live hint, and Web Push is sent.
3. Commands (`/start`, `/send_msg`) are handled directly. Everything else waits for the batching delay; after the silence, the whole chat history is sent to Gemini and the reply is sent back (through the business connection if the chat came from one).
4. The panel talks to the app over `/api/*` and listens on `/ws` for hints.

### Setup on a Space

1. Create a Space with the **Gradio** SDK and upload the project files (this README's front matter must stay at the top of `README.md`).
2. Add the **Secrets / variables** below.
3. Give the Space persistent storage and set `DATA_DIR` to it.
4. Register the owner webhook yourself (tenant bots are registered automatically by `/setbot`):

   `https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<your-space>.hf.space/webhook&secret_token=<WEBHOOK_SECRET>&allowed_updates=["message","business_connection","business_message","edited_business_message","deleted_business_messages","message_reaction","channel_post"]`

5. In Telegram (Premium): **Settings → Business → Chatbots** → connect your bot.
6. Open the Space URL and sign in as `owner` with `WEB_PASSWORD`.

| Name | Purpose |
|---|---|
| `BOT_TOKEN` | Owner bot token |
| `GEMINI_API_KEY` | Gemini API key |
| `GEMINI_MODEL` | Model name (code default: `gemma-4-26b-a4b-it`) |
| `WEB_PASSWORD` | Owner's panel password |
| `WEBHOOK_SECRET` | Optional secret checked on `/webhook` (header `X-Telegram-Bot-Api-Secret-Token`) |
| `PUBLIC_BASE_URL` | Public URL of the Space; required to register tenant webhooks |
| `ADMIN_GROUP_ID` | Admin group (error reports, account commands, `/send_msg` target) |
| `AI_BATCH_DELAY` | Seconds of silence before the AI answers (default `28`) |
| `ASSISTANT_LABEL` | Prefix of AI replies (default `sai:dev AI Assistant:`) |
| `DATA_DIR` | Persistent storage directory |
| `CF_ACCOUNT_ID`, `CF_KV_NAMESPACE_ID`, `CF_API_TOKEN` | Cloudflare KV fallback (used only if `DATA_DIR` is unset) |
| `VAPID_SUB` | Contact (`mailto:`) for Web Push |
| `BOT_TZ` | Time zone (default `Asia/Tehran`) |

> Voice notes recorded in the browser are converted with **ffmpeg**; make sure it is installed in the Space (add `ffmpeg` to `packages.txt`).

### Hugging Face edition vs. Telegram Serverless edition

| | 🤗 Hugging Face (this one) | ☁️ Telegram Serverless |
|---|---|---|
| Runs on | Always-on Python container (FastAPI) | Telegram's own JavaScript sandbox, no server |
| Panel access | Public web panel / PWA, username + password, device sessions | Mini App inside Telegram only, login by Telegram numeric ID, roles admin / user |
| Users | Multi-tenant: many accounts, each with its own bot | One bot per project, several members |
| Live updates | WebSocket + Web Push | Polling + Telegram's own notifications (with off switches) |
| External apps | Documented REST API v1 | None (endpoints are callable only from the Mini App) |
| Storage | JSON blobs in files / Cloudflare KV | SQLite tables |
| AI context | Whole chat history | Last N messages (default 60) |
| Media | Streamed from Telegram by `file_id`, Range support, ffmpeg voice conversion | Bytes archived in the database, chunked transfer, no ffmpeg |
| Deleted messages | History is kept; deletions are not marked | Marked 🗑, content kept; edit history kept |
| Feature coverage | Full (moderation, stickers / GIFs, forward, bot profile…) | Core features; the rest is planned |
| Maturity | Complete | New rewrite, still being debugged on the platform |

---

## Persian

<div dir="rtl">

**فارسی**

### این پروژه چیست؟

یک ربات تلگرام که **در چت‌های Telegram Business شما به‌جای خودتان با Gemini جواب می‌دهد** و یک **پنل مدیریت شبیه Telegram Web** (وب / PWA) دارد تا همه‌ی گفتگوها را خودتان هم بخوانید و پاسخ بدهید. همه‌چیز یک برنامه‌ی FastAPI است که روی Hugging Face Space اجرا می‌شود. (برنامه‌ی کوچک Gradio انتهای `app.py` فقط برای قبول شدن در بررسی راه‌اندازی Space است؛ سرور واقعی FastAPI روی پورت ۷۸۶۰ است.)

### قابلیت‌ها

- **Telegram Business:** پاسخ‌ها از اکانت خودتان و از طریق اتصال بیزینس ارسال می‌شود. پیام مستقیم به ربات و گروه‌ها هم پشتیبانی می‌شود.
- **پاسخ هوشمند (Gemini):** شخصیت ربات در `prompt.txt`؛ یک مکث کوتاه (پیش‌فرض ۲۸ ثانیه) تا چند پیام پشت‌سرهم یک پاسخ بگیرند؛ برچسب قابل‌تنظیم ابتدای پاسخ‌ها.
- **پنل مدیریت:** رابط شبیه Telegram Web K (راست‌به‌چپ، فارسی). لیست چت‌ها، تاریخچه‌ی کامل، ارسال / ویرایش / حذف / فوروارد / ری‌اکشن / پین / بی‌صدا، رسانه (عکس، ویدیو، ویس، استیکر، گیف، فایل)، ابزار مدیریت گروه، ویرایش پروفایل ربات و عکس پروفایل.
- **به‌روزرسانی زنده:** WebSocket برای اعلام «چیزی تغییر کرد» و اعلان Web Push (PWA قابل نصب).
- **چندکاربره:** مالک + حساب‌های پنل که از گروه ادمین ساخته می‌شوند (`/signup`، `/setbot`، `/resetpass`، `/suspend`، …). هر حساب ربات و webhook مخصوص خودش را دارد. رمز موقت از طریق تلگرام می‌رسد و در اولین ورود باید عوض شود. نشست جدا برای هر دستگاه و محدودیت تلاش ناموفق ورود.
- **API مستند (نسخه‌ی ۱)** در `docs/API.md` (ETag، همگام‌سازی با cursor، Range برای رسانه) برای ساخت اپ اندروید / ویندوز.
- **ذخیره‌سازی:** یک پوشه‌ی پایدار (`DATA_DIR`، مثلاً Hugging Face Storage Bucket) یا Cloudflare KV به‌عنوان جایگزین.

### چطور کار می‌کند؟

1. تلگرام `/webhook` (مالک) یا `/webhook/{secret}` (ربات هر حساب پنل) را صدا می‌زند. برنامه فوراً `OK` می‌دهد و کار را در پس‌زمینه انجام می‌دهد.
2. پیام در تاریخچه‌ی چت ذخیره می‌شود، پنل یک اشاره‌ی زنده می‌گیرد و Web Push ارسال می‌شود.
3. دستورها (`/start` و `/send_msg`) مستقیم اجرا می‌شوند. بقیه‌ی پیام‌ها منتظر مکث می‌مانند؛ بعد از سکوت، کل تاریخچه‌ی چت به Gemini داده می‌شود و پاسخ برمی‌گردد (اگر چت از اتصال بیزینس آمده باشد، از همان مسیر).
4. پنل از طریق `/api/*` با برنامه حرف می‌زند و برای اشاره‌ها به `/ws` گوش می‌دهد.

### راه‌اندازی روی Space

1. یک Space با SDK **Gradio** بسازید و فایل‌های پروژه را آپلود کنید (front matter این README باید بالای `README.md` بماند).
2. **Secrets / متغیرهای** جدول زیر را اضافه کنید.
3. برای Space فضای ذخیره‌ی پایدار بگیرید و `DATA_DIR` را روی آن بگذارید.
4. webhook مالک را خودتان ثبت کنید (ربات‌های حساب‌های دیگر را `/setbot` خودکار ثبت می‌کند):

   `https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<your-space>.hf.space/webhook&secret_token=<WEBHOOK_SECRET>&allowed_updates=["message","business_connection","business_message","edited_business_message","deleted_business_messages","message_reaction","channel_post"]`

5. در تلگرام: **Settings ← Business ← Chatbots** و ربات را وصل کنید.
6. آدرس Space را باز کنید و با نام کاربری `owner` و رمز `WEB_PASSWORD` وارد شوید.

| نام | کاربرد |
|---|---|
| `BOT_TOKEN` | توکن ربات مالک |
| `GEMINI_API_KEY` | کلید API جمینای |
| `GEMINI_MODEL` | نام مدل (پیش‌فرض کد: `gemma-4-26b-a4b-it`) |
| `WEB_PASSWORD` | رمز پنل برای مالک |
| `WEBHOOK_SECRET` | رمز اختیاری که روی `/webhook` بررسی می‌شود (هدر `X-Telegram-Bot-Api-Secret-Token`) |
| `PUBLIC_BASE_URL` | آدرس عمومی Space؛ برای ثبت webhook حساب‌های دیگر لازم است |
| `ADMIN_GROUP_ID` | گروه ادمین (گزارش خطا، دستورهای حساب‌ها، مقصد `/send_msg`) |
| `AI_BATCH_DELAY` | ثانیه‌های سکوت پیش از پاسخ AI (پیش‌فرض `28`) |
| `ASSISTANT_LABEL` | برچسب ابتدای پاسخ‌های AI (پیش‌فرض `sai:dev AI Assistant:`) |
| `DATA_DIR` | پوشه‌ی ذخیره‌سازی پایدار |
| `CF_ACCOUNT_ID`، `CF_KV_NAMESPACE_ID`، `CF_API_TOKEN` | جایگزین Cloudflare KV (فقط اگر `DATA_DIR` تنظیم نباشد) |
| `VAPID_SUB` | راه تماس (`mailto:`) برای Web Push |
| `BOT_TZ` | منطقه‌ی زمانی (پیش‌فرض `Asia/Tehran`) |

> ویس‌هایی که در مرورگر ضبط می‌شوند با **ffmpeg** تبدیل می‌شوند؛ مطمئن شوید روی Space نصب است (`ffmpeg` را به `packages.txt` اضافه کنید).

### نسخه‌ی Hugging Face در برابر نسخه‌ی Telegram Serverless

| | 🤗 Hugging Face (همین نسخه) | ☁️ Telegram Serverless |
|---|---|---|
| محل اجرا | کانتینر پایتون همیشه‌روشن (FastAPI) | محیط JavaScript خودِ تلگرام، بدون سرور |
| دسترسی به پنل | پنل وب / PWA عمومی، نام کاربری و رمز، نشست هر دستگاه | فقط Mini App داخل تلگرام، ورود با آیدی عددی تلگرام، نقش ادمین / کاربر |
| کاربران | چندکاربره: حساب‌های متعدد، هرکدام ربات خودش | یک ربات برای هر پروژه، چند عضو |
| به‌روزرسانی زنده | WebSocket + Web Push | polling + اعلان خود تلگرام (با کلید خاموش‌کردن) |
| اپ‌های بیرونی | API مستند نسخه‌ی ۱ | ندارد (endpointها فقط از داخل Mini App قابل صدا زدن‌اند) |
| ذخیره‌سازی | JSON در فایل / Cloudflare KV | جدول‌های SQLite |
| حافظه‌ی AI | کل تاریخچه‌ی چت | N پیام آخر (پیش‌فرض ۶۰) |
| رسانه | استریم از تلگرام با `file_id`، پشتیبانی Range، تبدیل ویس با ffmpeg | ذخیره‌ی بایت‌ها در دیتابیس، انتقال تکه‌تکه، بدون ffmpeg |
| پیام‌های حذف‌شده | تاریخچه می‌ماند ولی حذف علامت نمی‌خورد | علامت 🗑 می‌خورد و محتوا می‌ماند؛ تاریخچه‌ی ویرایش هم نگهداری می‌شود |
| پوشش قابلیت‌ها | کامل (مدیریت گروه، استیکر / گیف، فوروارد، پروفایل ربات…) | قابلیت‌های اصلی؛ بقیه برنامه‌ریزی شده |
| پختگی | کامل | بازنویسی تازه، هنوز در حال دیباگ روی پلتفرم |

</div>

---

## Russian

**Русский**

### Что это

Telegram-бот, который **отвечает в ваших чатах Telegram Business от вашего имени с помощью Gemini**, плюс **панель администратора в стиле Telegram Web** (веб / PWA), где вы сами читаете и отвечаете на любые диалоги. Всё это — одно приложение FastAPI на Hugging Face Space. (Маленькое приложение Gradio в конце `app.py` нужно только для прохождения стартовой проверки Space; настоящий сервер — FastAPI на порту 7860.)

### Возможности

- **Telegram Business:** ответы уходят с вашего аккаунта через бизнес-подключение. Личные чаты с ботом и группы тоже поддерживаются.
- **Ответы ИИ (Gemini):** персона в `prompt.txt`; короткая задержка (по умолчанию 28 с), чтобы несколько быстрых сообщений получили один ответ; настраиваемая метка перед ответами ИИ.
- **Панель администратора:** интерфейс в стиле Telegram Web K (RTL, персидский). Список чатов, полная история, отправка / правка / удаление / пересылка / реакции / закрепление / отключение уведомлений, медиа (фото, видео, голосовые, стикеры, GIF, файлы), инструменты модерации групп, редактирование профиля бота, фото профиля.
- **Живые обновления:** WebSocket-подсказки «что-то изменилось» и Web Push (устанавливаемое PWA).
- **Несколько пользователей:** владелец плюс дополнительные аккаунты панели, создаваемые из админ-группы (`/signup`, `/setbot`, `/resetpass`, `/suspend`, …). У каждого аккаунта свой токен бота и webhook. Временные пароли приходят через Telegram и меняются при первом входе. Отдельные сессии для каждого устройства и ограничение попыток входа.
- **Клиентский API v1** описан в `docs/API.md` (ETag, синхронизация по курсору, HTTP Range для медиа) — для Android / Windows-приложений.
- **Хранилище:** постоянная папка (`DATA_DIR`, например подключённый Hugging Face Storage Bucket) или Cloudflare KV как запасной вариант.

### Как это работает

1. Telegram вызывает `/webhook` (владелец) или `/webhook/{secret}` (бот каждого аккаунта панели). Приложение сразу отвечает `OK` и работает в фоне.
2. Сообщение сохраняется в историю чата, панель получает живую подсказку, отправляется Web Push.
3. Команды (`/start`, `/send_msg`) обрабатываются сразу. Остальные сообщения ждут паузу; после тишины вся история чата отправляется в Gemini, а ответ уходит обратно (через бизнес-подключение, если чат пришёл оттуда).
4. Панель общается с приложением через `/api/*` и слушает `/ws` для подсказок.

### Настройка на Space

1. Создайте Space с SDK **Gradio** и загрузите файлы проекта (front matter этого README должен остаться в начале `README.md`).
2. Добавьте **Secrets / переменные** из таблицы ниже.
3. Подключите к Space постоянное хранилище и укажите его в `DATA_DIR`.
4. Зарегистрируйте webhook владельца самостоятельно (боты остальных аккаунтов регистрируются автоматически командой `/setbot`):

   `https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<your-space>.hf.space/webhook&secret_token=<WEBHOOK_SECRET>&allowed_updates=["message","business_connection","business_message","edited_business_message","deleted_business_messages","message_reaction","channel_post"]`

5. В Telegram (нужен Premium): **Настройки → Telegram Business → Чат-боты** — подключите бота.
6. Откройте адрес Space и войдите как `owner` с паролем `WEB_PASSWORD`.

| Имя | Назначение |
|---|---|
| `BOT_TOKEN` | Токен бота владельца |
| `GEMINI_API_KEY` | Ключ API Gemini |
| `GEMINI_MODEL` | Название модели (по умолчанию в коде: `gemma-4-26b-a4b-it`) |
| `WEB_PASSWORD` | Пароль панели для владельца |
| `WEBHOOK_SECRET` | Необязательный секрет, проверяемый на `/webhook` (заголовок `X-Telegram-Bot-Api-Secret-Token`) |
| `PUBLIC_BASE_URL` | Публичный адрес Space; нужен для регистрации webhook других аккаунтов |
| `ADMIN_GROUP_ID` | Админ-группа (отчёты об ошибках, команды аккаунтов, получатель `/send_msg`) |
| `AI_BATCH_DELAY` | Секунды тишины до ответа ИИ (по умолчанию `28`) |
| `ASSISTANT_LABEL` | Префикс ответов ИИ (по умолчанию `sai:dev AI Assistant:`) |
| `DATA_DIR` | Папка постоянного хранилища |
| `CF_ACCOUNT_ID`, `CF_KV_NAMESPACE_ID`, `CF_API_TOKEN` | Запасной вариант Cloudflare KV (только если `DATA_DIR` не задан) |
| `VAPID_SUB` | Контакт (`mailto:`) для Web Push |
| `BOT_TZ` | Часовой пояс (по умолчанию `Asia/Tehran`) |

> Голосовые, записанные в браузере, конвертируются через **ffmpeg**; убедитесь, что он установлен в Space (добавьте `ffmpeg` в `packages.txt`).

### Версия для Hugging Face и версия Telegram Serverless

| | 🤗 Hugging Face (эта) | ☁️ Telegram Serverless |
|---|---|---|
| Где работает | Постоянно запущенный контейнер Python (FastAPI) | Собственная JavaScript-среда Telegram, без сервера |
| Доступ к панели | Публичная веб-панель / PWA, логин и пароль, сессии устройств | Только Mini App внутри Telegram, вход по числовому ID Telegram, роли admin / user |
| Пользователи | Мультитенантность: много аккаунтов, у каждого свой бот | Один бот на проект, несколько участников |
| Живые обновления | WebSocket + Web Push | Опрос (polling) + собственные уведомления Telegram (с переключателями) |
| Внешние приложения | Документированный REST API v1 | Нет (endpoint'ы вызываются только из Mini App) |
| Хранилище | JSON в файлах / Cloudflare KV | Таблицы SQLite |
| Контекст ИИ | Вся история чата | Последние N сообщений (по умолчанию 60) |
| Медиа | Стриминг из Telegram по `file_id`, Range, конвертация голосовых через ffmpeg | Байты хранятся в базе, передача частями, без ffmpeg |
| Удалённые сообщения | История сохраняется, удаление не помечается | Помечаются 🗑, содержимое остаётся; история правок сохраняется |
| Набор функций | Полный (модерация, стикеры / GIF, пересылка, профиль бота…) | Основные функции; остальное в планах |
| Зрелость | Завершена | Свежая переработка, ещё отлаживается на платформе |
