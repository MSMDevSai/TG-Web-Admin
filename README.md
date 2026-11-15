# 🤖 Telegram AI Assistant & Panel

**Languages:** [English](#english) · [Persian (فارسی)](#persian) · [Russian (Русский)](#russian)

One project, **two editions**:

| | Folder | Summary |
|---|---|---|
| 🤗 | [`huggingface/`](huggingface/) | Python (FastAPI) app on a Hugging Face Space. Public web panel / PWA, multi-user, full feature set. |
| ☁️ | [`serverless/`](serverless/) | JavaScript on **Telegram Serverless**. No server; the panel is a Mini App with login by Telegram numeric ID. |

---

## English

### What the project does

A Telegram bot that **answers your Telegram Business chats on your behalf with Gemini**, and an admin panel where you (and people you trust) read, search and answer every conversation. Both editions share the same idea and the same persona prompt; they differ in where they run and how the panel is reached.

### Which edition should I use?

| You want… | Choose |
|---|---|
| A panel reachable from any browser, installable as a PWA, with its own usernames and passwords | 🤗 Hugging Face |
| Many independent accounts, each with its own bot, on one deployment | 🤗 Hugging Face |
| A documented REST API for building Android / Windows apps | 🤗 Hugging Face |
| The most complete feature set today (group moderation, stickers / GIFs, forward, bot profile…) | 🤗 Hugging Face |
| No server to run or pay for; everything hosted by Telegram | ☁️ Serverless |
| Panel opened only inside Telegram, access controlled by a list of Telegram numeric IDs with admin / user roles | ☁️ Serverless |
| A **collector archive**: deleted messages stay (marked 🗑), edit history is kept, photos / voices / files are stored as bytes | ☁️ Serverless |
| Notifications delivered by Telegram itself, with global / per-chat / personal off switches | ☁️ Serverless |

### Side by side

| | 🤗 Hugging Face | ☁️ Serverless |
|---|---|---|
| Language / runtime | Python, FastAPI, always-on container | JavaScript, Telegram's V8 sandbox |
| Panel | Web / PWA | Mini App |
| Login | Username + password, device sessions | Telegram numeric ID (verified by Telegram), roles admin / user |
| Users | Multi-tenant (each account has its own bot) | One bot per project, several members |
| Live updates | WebSocket + Web Push | Polling + Telegram notifications |
| Storage | JSON in files / Cloudflare KV | SQLite |
| AI context | Whole history | Last N messages (default 60) |
| External API | Yes (`docs/API.md`) | No |
| Status | Complete | New rewrite, being debugged on the platform |

### Repository layout

```
.
├── README.md                 this file
├── huggingface/              the content of the Space repo
│   ├── README.md             Space README (the YAML front matter must stay at the very top)
│   ├── app.py  index.html  prompt.txt  requirements.txt
│   └── static/  docs/  tests/
└── serverless/
    ├── README.md
    ├── tgcloud/              schema, handlers, endpoints, lib  (deployed to Telegram)
    ├── web/                  Mini App front end (no build step)
    ├── dev/                  local tests on a mock SDK
    └── tgcloud.jsonc  package.json
```

> A Hugging Face Space needs `README.md` with its front matter at the **root of the Space repository**, so push the *contents* of `huggingface/` to the Space, not the whole repository.

### Quick start

- 🤗 **Hugging Face:** see [`huggingface/README.md`](huggingface/README.md) — create a Space, add secrets, register the webhook.
- ☁️ **Serverless:** see [`serverless/README.md`](serverless/README.md) — scaffold with `npm create @tgcloud/bot`, copy `tgcloud/` and `web/`, set your numeric ID in `tgcloud/lib/config.js`, then `npx tgcloud push` and `npx tgcloud migrate`.

---

## Persian

<div dir="rtl">

**فارسی**

یک پروژه، **دو نسخه**:

| | پوشه | خلاصه |
|---|---|---|
| 🤗 | [`huggingface/`](huggingface/) | برنامه‌ی پایتون (FastAPI) روی Hugging Face Space. پنل وب / PWA عمومی، چندکاربره، کامل‌ترین مجموعه‌ی قابلیت‌ها. |
| ☁️ | [`serverless/`](serverless/) | جاوااسکریپت روی **Telegram Serverless**. بدون سرور؛ پنل یک Mini App با ورود از طریق آیدی عددی تلگرام است. |

### این پروژه چه می‌کند؟

یک ربات تلگرام که **در چت‌های Telegram Business شما به‌جای خودتان با Gemini جواب می‌دهد** و یک پنل مدیریت که شما (و افراد مورد اعتمادتان) همه‌ی گفتگوها را در آن می‌خوانید، جستجو می‌کنید و پاسخ می‌دهید. هر دو نسخه ایده و پرامپت شخصیتی یکسانی دارند؛ تفاوتشان در محل اجرا و نحوه‌ی دسترسی به پنل است.

### کدام نسخه را انتخاب کنم؟

| اگر می‌خواهید… | انتخاب |
|---|---|
| پنلی که از هر مرورگر باز شود، به‌صورت PWA نصب شود و نام کاربری و رمز خودش را داشته باشد | 🤗 Hugging Face |
| حساب‌های مستقل زیاد، هرکدام با ربات خودش، روی یک استقرار | 🤗 Hugging Face |
| API مستند REST برای ساخت اپ اندروید / ویندوز | 🤗 Hugging Face |
| کامل‌ترین قابلیت‌ها در حال حاضر (مدیریت گروه، استیکر / گیف، فوروارد، پروفایل ربات…) | 🤗 Hugging Face |
| بدون سرور برای اجرا یا پرداخت؛ همه‌چیز روی تلگرام | ☁️ Serverless |
| پنل فقط داخل تلگرام و کنترل دسترسی با فهرست آیدی‌های عددی و نقش ادمین / کاربر | ☁️ Serverless |
| **آرشیو کالکتور**: پیام‌های حذف‌شده می‌مانند (با علامت 🗑)، تاریخچه‌ی ویرایش نگه داشته می‌شود، عکس / ویس / فایل به‌صورت بایت ذخیره می‌شود | ☁️ Serverless |
| اعلان‌ها از خود تلگرام، با کلید خاموش‌کردن کلی / هر چت / شخصی | ☁️ Serverless |

### مقایسه‌ی کنار هم

| | 🤗 Hugging Face | ☁️ Serverless |
|---|---|---|
| زبان / اجرا | پایتون، FastAPI، کانتینر همیشه‌روشن | جاوااسکریپت، محیط V8 تلگرام |
| پنل | وب / PWA | Mini App |
| ورود | نام کاربری و رمز، نشست هر دستگاه | آیدی عددی تلگرام (تأییدشده توسط تلگرام)، نقش ادمین / کاربر |
| کاربران | چندکاربره (هر حساب ربات خودش را دارد) | یک ربات برای هر پروژه، چند عضو |
| به‌روزرسانی زنده | WebSocket + Web Push | polling + اعلان تلگرام |
| ذخیره‌سازی | JSON در فایل / Cloudflare KV | SQLite |
| حافظه‌ی AI | کل تاریخچه | N پیام آخر (پیش‌فرض ۶۰) |
| API بیرونی | دارد (`docs/API.md`) | ندارد |
| وضعیت | کامل | بازنویسی تازه، در حال دیباگ روی پلتفرم |

### ساختار مخزن

```
.
├── README.md                 همین فایل
├── huggingface/              محتوای مخزن Space
│   ├── README.md             README مخصوص Space (front matter باید بالاترین بخش بماند)
│   ├── app.py  index.html  prompt.txt  requirements.txt
│   └── static/  docs/  tests/
└── serverless/
    ├── README.md
    ├── tgcloud/              schema، handlerها، endpointها، lib  (روی تلگرام دیپلوی می‌شود)
    ├── web/                  فرانت Mini App (بدون build)
    ├── dev/                  تست‌های محلی روی SDK ساختگی
    └── tgcloud.jsonc  package.json
```

> Hugging Face Space باید `README.md` همراه front matter را در **ریشه‌ی مخزن Space** داشته باشد؛ پس *محتوای* پوشه‌ی `huggingface/` را روی Space بگذارید، نه کل مخزن را.

### شروع سریع

- 🤗 **Hugging Face:** [`huggingface/README.md`](huggingface/README.md) را ببینید — ساخت Space، افزودن secretها، ثبت webhook.
- ☁️ **Serverless:** [`serverless/README.md`](serverless/README.md) را ببینید — با `npm create @tgcloud/bot` پروژه بسازید، `tgcloud/` و `web/` را کپی کنید، آیدی عددی خودتان را در `tgcloud/lib/config.js` بگذارید، سپس `npx tgcloud push` و `npx tgcloud migrate`.

</div>

---

## Russian

**Русский**

Один проект, **две редакции**:

| | Папка | Кратко |
|---|---|---|
| 🤗 | [`huggingface/`](huggingface/) | Приложение на Python (FastAPI) на Hugging Face Space. Публичная веб-панель / PWA, несколько пользователей, самый полный набор функций. |
| ☁️ | [`serverless/`](serverless/) | JavaScript на **Telegram Serverless**. Без сервера; панель — Mini App со входом по числовому ID Telegram. |

### Что делает проект

Telegram-бот, который **отвечает в ваших чатах Telegram Business от вашего имени с помощью Gemini**, и панель администратора, где вы (и доверенные люди) читаете, ищете и отвечаете на любые диалоги. Обе редакции построены на одной идее и одном промпте персоны; различаются местом запуска и способом доступа к панели.

### Какую редакцию выбрать

| Вам нужно… | Выбор |
|---|---|
| Панель из любого браузера, устанавливаемая как PWA, со своими логинами и паролями | 🤗 Hugging Face |
| Много независимых аккаунтов, у каждого свой бот, на одном развёртывании | 🤗 Hugging Face |
| Документированный REST API для Android / Windows-приложений | 🤗 Hugging Face |
| Самый полный набор функций сейчас (модерация групп, стикеры / GIF, пересылка, профиль бота…) | 🤗 Hugging Face |
| Никаких серверов, которые нужно запускать или оплачивать; всё хостит Telegram | ☁️ Serverless |
| Панель только внутри Telegram, доступ по списку числовых ID с ролями admin / user | ☁️ Serverless |
| **Архив-коллектор**: удалённые сообщения остаются (с пометкой 🗑), история правок сохраняется, фото / голосовые / файлы хранятся в виде байтов | ☁️ Serverless |
| Уведомления от самого Telegram с общим / по-чатовым / личным выключателем | ☁️ Serverless |

### Сравнение

| | 🤗 Hugging Face | ☁️ Serverless |
|---|---|---|
| Язык / среда | Python, FastAPI, постоянно работающий контейнер | JavaScript, V8-песочница Telegram |
| Панель | Веб / PWA | Mini App |
| Вход | Логин и пароль, сессии устройств | Числовой ID Telegram (проверяется Telegram), роли admin / user |
| Пользователи | Мультитенантность (у каждого аккаунта свой бот) | Один бот на проект, несколько участников |
| Живые обновления | WebSocket + Web Push | Опрос (polling) + уведомления Telegram |
| Хранилище | JSON в файлах / Cloudflare KV | SQLite |
| Контекст ИИ | Вся история | Последние N сообщений (по умолчанию 60) |
| Внешний API | Есть (`docs/API.md`) | Нет |
| Статус | Завершена | Свежая переработка, отлаживается на платформе |

### Структура репозитория

```
.
├── README.md                 этот файл
├── huggingface/              содержимое репозитория Space
│   ├── README.md             README для Space (YAML front matter должен оставаться в самом начале)
│   ├── app.py  index.html  prompt.txt  requirements.txt
│   └── static/  docs/  tests/
└── serverless/
    ├── README.md
    ├── tgcloud/              schema, handlers, endpoints, lib  (деплоится в Telegram)
    ├── web/                  фронтенд Mini App (без сборки)
    ├── dev/                  локальные тесты на мок-SDK
    └── tgcloud.jsonc  package.json
```

> Hugging Face Space требует `README.md` с front matter в **корне репозитория Space**, поэтому в Space нужно загружать *содержимое* папки `huggingface/`, а не весь репозиторий.

### Быстрый старт

- 🤗 **Hugging Face:** см. [`huggingface/README.md`](huggingface/README.md) — создать Space, добавить secrets, зарегистрировать webhook.
- ☁️ **Serverless:** см. [`serverless/README.md`](serverless/README.md) — создать проект через `npm create @tgcloud/bot`, скопировать `tgcloud/` и `web/`, указать свой числовой ID в `tgcloud/lib/config.js`, затем `npx tgcloud push` и `npx tgcloud migrate`.
