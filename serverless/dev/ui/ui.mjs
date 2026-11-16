// تست رابط کاربری واقعی: Mini App در Chromium ↔ پل HTTP ↔ endpointهای واقعی روی SDK ساختگی + SQLite.
// اجرا از ریشه‌ی پروژه:  sh dev/ui-test.sh      (نیاز: Node 22.5+ و playwright با Chromium)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
let chromium;
for (const base of [process.env.PW_DIR, '/opt/npm-tools/node_modules/x.js'].filter(Boolean)) { try { ({ chromium } = createRequire(base)('playwright')); break; } catch (e) { /* مسیر بعدی */ } }
if (!chromium) { console.error('playwright پیدا نشد. در ریشه‌ی پروژه: npm i -D playwright && npx playwright install chromium'); process.exit(2); }
import * as schema from './tgcloud/schema.js';
import { saveSettings } from './tgcloud/lib/store.js';
import { db } from 'sdk';
import { media } from './tgcloud/schema.js';
import { eq } from 'sdk/db';
import { BOOTSTRAP_ADMINS } from './tgcloud/lib/config.js';

const ADMIN = BOOTSTRAP_ADMINS[0];
const WEB = process.env.WEB_DIR || path.resolve('web');
const SHOTS = process.env.SHOTS_DIR || '/tmp/shots'; fs.mkdirSync(SHOTS, { recursive: true });
let fails = 0; const ok = (c, m) => { console.log((c ? '✅ ' : '❌ ') + m); if (!c) fails++; };
const H = (n) => import(`./tgcloud/handlers/${n}.js`).then((m) => m.default);
const E = (n) => import(`./tgcloud/endpoints/${n}.js`).then((m) => m.default);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ctxOf = (id, name = 'U') => ({ initData: { user: { id, first_name: name } } });
const now = Math.floor(Date.now() / 1000);

// ───────── داده‌ی نمونه (از مسیر handlerهای واقعی) ─────────
await saveSettings({ ai_mode: false, gemini_api_key: 'k' });
await (await H('business_connection'))({ id: 'bc1', user: { id: 777 }, is_enabled: true });
const bm = await H('business_message'), mh = await H('message');
const biz = (id, text, o = {}) => ({ message_id: id, date: o.date || now, chat: { id: 500, type: 'private', first_name: 'علی', last_name: 'رضایی' }, from: o.from || { id: 500, first_name: 'علی', last_name: 'رضایی' }, business_connection_id: 'bc1', text, ...(o.extra || {}) });
const DAY = 86400;
await bm(biz(1, 'سلام، وقت بخیر', { date: now - 3 * DAY }));
await bm(biz(2, 'برای سفارش جدید قیمت می‌خواستم', { date: now - 3 * DAY + 60 }));
await bm(biz(3, 'سلام علی جان، الان قیمت‌ها رو می‌فرستم', { date: now - 3 * DAY + 120, from: { id: 777, first_name: 'من' } }));
await bm(biz(4, 'این عکس محصوله', { date: now - 2 * DAY, extra: { text: undefined, photo: [{ file_id: 'F1', file_unique_id: 'U1', file_size: 1000 }], caption: 'این عکس محصوله' } }));
await bm(biz(5, 'ویس', { date: now - 2 * DAY + 30, extra: { text: undefined, voice: { file_id: 'V1', file_unique_id: 'UV1', mime_type: 'audio/ogg', file_size: 500 } } }));
await bm(biz(6, 'این پیام رو بعداً پاک می‌کنم', { date: now - DAY }));
await bm(biz(7, 'قیمت اشتباه نوشتم', { date: now - DAY + 10 }));
await (await H('edited_business_message'))({ ...biz(7, 'قیمت درست: ۲۵۰ هزار تومان'), edit_date: now - DAY + 50 });
await (await H('deleted_business_messages'))({ business_connection_id: 'bc1', chat: { id: 500 }, message_ids: [6] });
await bm(biz(8, 'پس سفارش رو ثبت کنید لطفاً', { date: now - 3600 }));
await mh({ message_id: 1, date: now - 7200, chat: { id: 600, type: 'private', first_name: 'سارا' }, from: { id: 600, first_name: 'سارا' }, text: 'سلام، ممنون از پیگیری' });
const G = -1001;
const gm = (id, uid, name, text, date) => ({ message_id: id, date, chat: { id: G, type: 'supergroup', title: 'گروه پشتیبانی' }, from: { id: uid, first_name: name }, text });
await mh(gm(1, 700, 'رضا', 'تبلیغات! همین حالا بخرید', now - 5000)); await mh(gm(2, 700, 'رضا', 'تخفیف ویژه فقط امروز', now - 4900)); await mh(gm(3, 701, 'ندا', 'سلام به همه', now - 4800));
// عکس واقعی برای نمایش
const png = new Uint8Array(fs.readFileSync(new URL('./sample.png', import.meta.url)));
await db.update(media).set({ data: png, mime: 'image/png', size: png.length }).where(eq(media.key, 'U1')).run();
await (await E('members'))({ op: 'add', tgId: 2222, role: 'user', name: 'نفر دوم' }, ctxOf(ADMIN));
await (await E('members'))({ op: 'add', tgId: 3333, role: 'admin', name: 'نفر سوم' }, ctxOf(ADMIN));
await (await E('pinMessage'))({ chatId: 500, msgId: 2, pin: true, telegram: false }, ctxOf(ADMIN));
globalThis.__calls.length = 0;

// ───────── پل HTTP: فایل‌های وب + اجرای endpointها ─────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/__call') {
    let body = ''; for await (const c of req) body += c; const { name, input, user } = JSON.parse(body);
    res.setHeader('content-type', 'application/json');
    try {
      const fn = await E(name);
      const out = await fn(input || {}, { initData: { user } });
      return res.end(JSON.stringify({ result: JSON.parse(JSON.stringify(out ?? null)) }));
    } catch (e) { return res.end(JSON.stringify({ error: { type: e.parameters ? 'ENDPOINT_ERROR' : 'INTERNAL_ERROR', message: e.message, parameters: e.parameters } })); }
  }
  if (url.pathname === '/__calls') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(globalThis.__calls)); }
  const f = path.join(WEB, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!f.startsWith(WEB) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(0, r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const errors = [];
async function newPage(userId, name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, locale: 'fa-IR', permissions: [] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.route('**/*', (r) => (r.request().url().startsWith(ORIGIN) ? r.continue() : r.abort()));
  await page.addInitScript(([uid, nm]) => {
    window.__back = null;
    window.Telegram = { WebApp: { ready() {}, expand() {}, disableVerticalSwipes() {}, initDataUnsafe: { user: { id: uid, first_name: nm } },
      BackButton: { show() {}, hide() {}, onClick(f) { window.__back = f; }, offClick() {} },
      Serverless: { call(name, input, cb) {
        fetch('/__call', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, input, user: { id: uid, first_name: nm } }) })
          .then((r) => r.json()).then((j) => (j.error ? cb(j.error) : cb(null, j.result))).catch((e) => cb({ message: String(e) })); } } } };
  }, [userId, name]);
  await page.goto(ORIGIN + '/');
  return page;
}
const calls = async (page) => JSON.parse(await (await page.request.get(ORIGIN + '/__calls')).text());
const shot = (page, n) => page.screenshot({ path: `${SHOTS}/${n}.png` });
const junk = async (page, label) => {
  const t = await page.evaluate(() => document.body.innerText);
  const m = t.match(/(^|\s)(null|undefined|false|NaN)(\s|$)/);
  ok(!m, 'بدون متن‌های junk (null/undefined/false/NaN) در: ' + label + (m ? ' → «' + m[2] + '»' : ''));
};
const closeSheet = (page) => page.locator('.ov').first().evaluate((el) => el.remove()).catch(() => {});

// ═════════ ادمین ═════════
let p = await newPage(ADMIN, 'ادمین');
await p.waitForSelector('.chat');
ok((await p.locator('.chat').count()) === 3, 'لیست: سه چت نمایش داده شد');
ok((await p.locator('#tabs .chip').allTextContents()).join('|').includes('گروه‌ها'), 'لیست: تب‌های همه/نخوانده/خصوصی/گروه‌ها');
await junk(p, 'لیست چت‌ها'); await shot(p, '01-list');
await p.locator('#tabs .chip', { hasText: 'گروه‌ها' }).click();
ok((await p.locator('.chat').count()) === 1 && (await p.locator('.chat').first().textContent()).includes('گروه پشتیبانی'), 'تب «گروه‌ها» فقط گروه را نشان می‌دهد');
await p.locator('#tabs .chip', { hasText: 'خصوصی' }).click();
ok((await p.locator('.chat').count()) === 2, 'تب «خصوصی» دو چت را نشان می‌دهد');
await p.locator('#tabs .chip', { hasText: 'همه' }).click();

// دسته‌بندی از راه UI
await p.click('button[title="بیشتر"]');
ok((await p.locator('.sheet .act').allTextContents()).some((t) => t.includes('پیام ناشناس')), 'منو: گزینه‌ی پیام ناشناس');
await p.locator('.sheet .act', { hasText: 'دسته‌بندی چت‌ها' }).click();
await p.fill('.sheet input[placeholder^="نام دسته"]', 'مشتری ویژه'); await p.fill('.sheet input[placeholder="🙂"]', '⭐');
await p.locator('.sheet .btn', { hasText: 'افزودن' }).click();
await p.waitForSelector('.sheet [data-cat]');
await p.fill('.sheet input[placeholder^="نام دسته"]', 'همکاران');
await p.locator('.sheet .btn', { hasText: 'افزودن' }).click();
await p.waitForFunction(() => document.querySelectorAll('.sheet [data-cat]').length === 2);
await shot(p, '02-categories');
await p.locator('.sheet [data-cat]').nth(1).locator('button', { hasText: '▲' }).click();   // جابه‌جایی ترتیب
await p.waitForFunction(() => document.querySelector('.sheet [data-cat] input[type=text]:nth-of-type(2)')?.value === 'همکاران');
ok(true, 'دسته‌بندی: ساخت دو دسته و تغییر ترتیب از UI');
await closeSheet(p);
await p.waitForFunction(() => document.querySelectorAll('#tabs .chip').length === 6);
ok((await p.locator('#tabs .chip').allTextContents()).join('|').includes('⭐ مشتری ویژه'), 'دسته‌ها به‌صورت تب در لیست اضافه شدند');
// انتساب چت به دسته با اقدام سریع
await p.locator('.chat[data-chat="500"] .qa').click();
await p.locator('.sheet .act', { hasText: 'دسته‌بندی چت' }).click();
await p.waitForSelector('.sheet .sw');
await p.locator('.sheet .row', { hasText: 'مشتری ویژه' }).locator('.sw').click();
await sleep(400); await closeSheet(p);
await p.locator('#tabs .chip', { hasText: 'مشتری ویژه' }).click();
ok((await p.locator('.chat').count()) === 1 && (await p.locator('.chat').first().textContent()).includes('علی'), 'انتساب چت به دسته و فیلتر تب');
await p.locator('#tabs .chip', { hasText: 'همه' }).click();
// پین چت
await p.locator('.chat[data-chat="600"] .qa').click();
await p.locator('.sheet .row', { hasText: 'سنجاق چت' }).locator('.sw').click();
await sleep(400); await closeSheet(p);
await p.waitForFunction(() => document.querySelector('.chat')?.dataset.chat === '600');
ok(true, 'پین خود چت: چت سنجاق‌شده بالای لیست رفت');
await shot(p, '03-list-after');

// ───────── داخل چت ─────────
await p.locator('.chat[data-chat="500"]').click();
await p.waitForSelector('.msg');
await p.waitForSelector('img.m', { timeout: 8000 });
await sleep(300);
ok(await p.locator('img.m').first().evaluate((i) => i.complete && i.naturalWidth === 160), 'رسانه: عکس از آرشیو (base64 تکه‌ای) واقعاً رندر شد');
ok(await p.locator('audio').count() === 1, 'رسانه: ویس به‌صورت پخش‌کننده');
ok(await p.locator('.msg.deleted .del').count() === 1 && (await p.locator('.msg.deleted').textContent()).includes('این پیام رو بعداً پاک می‌کنم'), 'کالکتور: پیام حذف‌شده با علامت 🗑 و متن محفوظ');
ok((await p.locator('.msg').allTextContents()).some((t) => t.includes('ویرایش‌شده') && t.includes('۲۵۰')), 'پیام ویرایش‌شده علامت دارد');
ok((await p.locator('#pinbar').isVisible()) && (await p.locator('#pinbar').textContent()).includes('برای سفارش جدید'), 'سنجاق داخل چت: نوار پیام سنجاق‌شده');
await junk(p, 'صفحه‌ی چت و نوار پیام‌نویسی'); await shot(p, '04-chat');
// پرش با کلیک روی نوار سنجاق
await p.locator('#pinbar').click();
await p.waitForSelector('.msg.flash');
ok(await p.locator('#fab').isVisible(), 'پرش به پیام: دکمه‌ی «آخرین پیام‌ها» ظاهر شد');
await p.locator('#fab').click(); await p.waitForFunction(() => document.getElementById('fab').style.display === 'none');
// جستجو در چت
await p.click('button[title="جستجو در چت"]');
await p.fill('#csearch input[type=search]', 'قیمت');
await p.waitForSelector('#csearch .sr');
ok((await p.locator('#csearch .sr').count()) === 3 && (await p.locator('#csearch mark').count()) >= 3, 'جستجو در چت: نتیجه‌ها با هایلایت (' + (await p.locator('#csearch .sr').count()) + ')');
await junk(p, 'نتایج جستجوی چت'); await shot(p, '05-chat-search');
await p.locator('#csearch .sr').first().click();
await p.waitForSelector('.msg.flash');
ok(!(await p.locator('#csearch').isVisible()), 'جستجو: انتخاب نتیجه، به پیام پرید و پنل جستجو بسته شد');
await p.locator('#fab').click(); await sleep(300);

// منوی پیام، سنجاق، انتخاب چندتایی، فوروارد
const bubbleOf = (txt) => p.locator('.msg', { hasText: txt }).first();
await bubbleOf('پس سفارش رو ثبت کنید').click();
const menu = (await p.locator('.sheet .act').allTextContents()).join('|');
ok(['پاسخ', 'فوروارد', 'سنجاق در چت', 'انتخاب چندتایی', 'کپی متن', 'حذف از تلگرام'].every((x) => menu.includes(x)), 'منوی پیام: همه‌ی گزینه‌ها (ادمین)');
await shot(p, '06-msg-menu');
await p.locator('.sheet .act', { hasText: 'سنجاق در چت' }).click();
await p.waitForFunction(() => document.getElementById('pinbar').textContent.includes('پس سفارش'));
ok((await calls(p)).some((c) => c.method === 'pinChatMessage' && c.p.business_connection_id === 'bc1'), 'سنجاق: ادمین → در تلگرام هم (با اتصال بیزینس) و بنر عوض شد');
await bubbleOf('برای سفارش جدید').click();
await p.locator('.sheet .act', { hasText: 'انتخاب چندتایی' }).click();
await p.waitForSelector('.selbar');
await bubbleOf('این عکس محصوله').click();
ok((await p.locator('.selbar').textContent()).includes('2 پیام') || (await p.locator('.selbar').textContent()).includes('۲ پیام'), 'انتخاب چندتایی: شمارنده‌ی ۲ پیام');
ok((await p.locator('.msg.sel').count()) === 2, 'انتخاب چندتایی: دو پیام علامت خورد');
await junk(p, 'حالت انتخاب چندتایی'); await shot(p, '07-selection');
await p.locator('.selbar .btn', { hasText: 'فوروارد' }).click();
await p.waitForSelector('.fwlist .row');
await p.locator('.fwlist .row[data-fw="600"]').click();
await shot(p, '08-forward');
await p.locator('.sheet .btn', { hasText: 'ارسال به 1 چت' }).or(p.locator('.sheet .btn', { hasText: 'ارسال به ۱ چت' })).click();
await p.waitForFunction(() => document.getElementById('toast').textContent.includes('فوروارد شد'));
const cs = await calls(p);
ok(cs.filter((c) => c.p && c.p.chat_id === 600 && (c.method === 'sendMessage' || c.method === 'sendPhoto')).length === 2, 'فوروارد از UI: متن و عکس به چت مقصد رفت');
ok(await p.locator('.selbar').count() === 0, 'بعد از فوروارد، حالت انتخاب بسته شد');
// حذف گروهی
await bubbleOf('قیمت درست').click(); await p.locator('.sheet .act', { hasText: 'انتخاب چندتایی' }).click();
await bubbleOf('سلام، وقت بخیر').click();
await p.locator('.selbar .btn.danger').click();
await p.waitForFunction(() => document.getElementById('toast').textContent.includes('پیام حذف شد'));
ok((await calls(p)).some((c) => c.method === 'deleteBusinessMessages' && c.p.message_ids.length === 2), 'حذف گروهی از UI → deleteBusinessMessages');
await p.waitForFunction(() => document.querySelectorAll('.msg.deleted').length === 3);
ok((await p.locator('.msg.deleted').allTextContents()).some((t) => t.includes('سلام، وقت بخیر')), 'حذف گروهی: متن در پنل محفوظ ماند');
await shot(p, '09-after-bulk-delete');

// ───────── گروه: مدیریت کاربر ─────────
await p.click('button >> text=→');   // برگشت به لیست
await p.waitForSelector('.chat');
await p.locator('.chat[data-chat="-1001"]').click();
await p.waitForSelector('.msg');
await p.locator('.msg', { hasText: 'تبلیغات' }).click();
ok((await p.locator('.sheet .act').allTextContents()).some((t) => t.includes('مدیریت این کاربر در گروه')), 'گروه: گزینه‌ی مدیریت کاربر برای ادمین');
await p.locator('.sheet .act', { hasText: 'مدیریت این کاربر' }).click();
await shot(p, '10-mod-user');
await p.locator('.sheet .chip', { hasText: '۱ ساعت' }).click();
await p.waitForFunction(() => document.getElementById('toast').textContent.includes('میوت شد'));
const rc = (await calls(p)).find((c) => c.method === 'restrictChatMember');
ok(rc && rc.p.user_id === 700 && rc.p.permissions.can_send_messages === false && rc.p.until_date > now, 'گروه: میوت یک‌ساعته از UI');
await p.locator('.msg', { hasText: 'تبلیغات' }).click(); await p.locator('.sheet .act', { hasText: 'مدیریت این کاربر' }).click();
await p.locator('.sheet .act', { hasText: 'حذف همه‌ی پیام‌های این کاربر' }).click();
await p.waitForFunction(() => document.getElementById('toast').textContent.includes('حذف شد'));
const dm = (await calls(p)).find((c) => c.method === 'deleteMessages' && c.p.chat_id === -1001);
ok(dm && dm.p.message_ids.join() === '2,1', 'گروه: حذف همه‌ی پیام‌های یک کاربر از UI');
await p.waitForFunction(() => document.querySelectorAll('.msg.deleted').length === 2);
await p.click('button[title="تنظیمات چت"]');
await p.locator('.sheet .act', { hasText: 'گزارش اقدام‌های مدیریت گروه' }).click();
await p.waitForSelector('.sheet .row');
const logText = (await p.locator('.sheet').textContent());
ok(logText.includes('میوت') && logText.includes('حذف پیام‌ها') && logText.includes('بازگردانی'), 'گروه: گزارش اقدام‌ها با دکمه‌ی بازگردانی');
await p.locator('.sheet .btn', { hasText: 'بازگردانی' }).click();
await p.waitForFunction(() => document.getElementById('toast').textContent.includes('انجام شد'));
ok((await calls(p)).filter((c) => c.method === 'restrictChatMember').length === 2, 'گروه: بازگردانی (رفع میوت) از گزارش');
await closeSheet(p);

// ───────── جستجوی سراسری ─────────
await p.click('button >> text=→'); await p.waitForSelector('.chat');
await p.click('button[title="جستجو در متن پیام‌ها"]');
await p.fill('input[type=search]', 'سفارش');
await p.waitForSelector('.sres .sr');
const gl = await p.locator('.sres .sr').allTextContents();
ok(gl.length >= 3 && gl.some((t) => t.includes('علی')), 'جستجوی سراسری: نتیجه با نام چت (' + gl.length + ')');
await junk(p, 'جستجوی سراسری'); await shot(p, '11-global-search');
const firstTitle = (await p.locator('.sres .sr .sr-t b').first().textContent()).trim();
await p.locator('.sres .sr').first().click();
await p.waitForSelector('.msg.flash');
ok((await p.locator('#chead h1').textContent()).includes(firstTitle), 'جستجوی سراسری: کلیک → باز شدن چتِ «' + firstTitle + '» و پرش به پیام');

// ───────── پیام ناشناس (ادمین) ─────────
await p.click('button >> text=→'); await p.waitForSelector('.chat');
await p.click('button[title="بیشتر"]'); await p.locator('.sheet .act', { hasText: 'پیام ناشناس' }).click();
await p.waitForSelector('.sheet .btn');
const an = await p.locator('.sheet').textContent();
ok(an.includes('/anon') && an.includes('لینک‌ها') && an.includes('بلاک‌های سراسری'), 'پیام ناشناس: توضیح + آمار + بلاک‌ها در پنل ادمین');
await p.fill('.sheet input[placeholder="آیدی عددی فرستنده"]', '6100');
await p.locator('.sheet .btn.sm', { hasText: 'بلاک' }).last().click();
await p.waitForFunction(() => document.querySelector('.sheet')?.textContent.includes('6100'));
await junk(p, 'پنل پیام ناشناس'); await shot(p, '12-anon');
ok(true, 'پیام ناشناس: بلاک سراسری از پنل');
await closeSheet(p);
await p.close();

// ═════════ کاربر معمولی ═════════
p = await newPage(2222, 'نفر دوم');
await p.waitForSelector('.chat');
await p.click('button[title="بیشتر"]');
const um = (await p.locator('.sheet .act').allTextContents()).join('|');
ok(um.includes('پیام ناشناس') && !um.includes('اعضا') && !um.includes('تنظیمات') && !um.includes('دسته‌بندی چت‌ها'), 'کاربر معمولی: منو فقط پیام ناشناس دارد');
await closeSheet(p);
await p.locator('.chat[data-chat="500"]').click(); await p.waitForSelector('.msg');
await p.locator('.msg', { hasText: 'پس سفارش' }).click();
const um2 = (await p.locator('.sheet .act').allTextContents()).join('|');
ok(um2.includes('فوروارد') && um2.includes('سنجاق') && !um2.includes('حذف از تلگرام'), 'کاربر معمولی: فوروارد/سنجاق هست، حذف نیست');
await p.locator('.sheet .act', { hasText: 'انتخاب چندتایی' }).click();
ok((await p.locator('.selbar .btn.danger').count()) === 0, 'کاربر معمولی: دکمه‌ی حذف گروهی ندارد');
await p.locator('.selbar .ib').click();
await p.click('button[title="تنظیمات چت"]');
ok((await p.locator('.sheet').textContent()).includes('دسته‌بندی چت') && !(await p.locator('.sheet').textContent()).includes('پرامپت'), 'کاربر معمولی: تنظیمات AI چت را نمی‌بیند');
await p.locator('.sheet .act', { hasText: 'دسته‌بندی چت' }).click();
await p.waitForSelector('.sheet .sw');
await junk(p, 'انتساب دسته برای کاربر معمولی (بدون دکمه‌ی مدیریت)');
ok(!(await p.locator('.sheet').textContent()).includes('مدیریت دسته'), 'کاربر معمولی: دکمه‌ی مدیریت دسته‌ها را نمی‌بیند');
await closeSheet(p);
await p.close();

// ═════════ ناشناس مجاز نیست ═════════
p = await newPage(9999, 'غریبه');
await p.waitForSelector('.fatal');
ok((await p.locator('.fatal').textContent()).includes('9999') && (await p.locator('.fatal').textContent()).includes('دسترسی نداری'), 'آیدی نامجاز: صفحه‌ی «دسترسی نداری» با آیدی خودش');
await shot(p, '13-forbidden');
await p.close();

ok(errors.length === 0, 'هیچ خطای JavaScript/کنسول در صفحه نبود' + (errors.length ? ' → ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
console.log(fails ? `\n${fails} FAILED` : '\nUI ALL PASSED');
process.exit(fails ? 1 : 0);
