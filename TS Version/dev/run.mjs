import * as schema from './tgcloud/schema.js';
import { saveSettings, getChat } from './tgcloud/lib/store.js';
import { db } from 'sdk';
import { messages, edits, media, members } from './tgcloud/schema.js';
import { eq } from 'sdk/db';
import { BOOTSTRAP_ADMINS } from './tgcloud/lib/config.js';
const ADMIN = BOOTSTRAP_ADMINS[0];
const H = (n) => import(`./tgcloud/handlers/${n}.js`).then((m) => m.default);
const E = (n) => import(`./tgcloud/endpoints/${n}.js`).then((m) => m.default);
let fails = 0; const ok = (c, msg) => { console.log((c ? '✅ ' : '❌ ') + msg); if (!c) fails++; };
const calls = () => globalThis.__calls; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const since = (i) => calls().slice(i);
const mkMsg = (o) => ({ message_id: o.id, date: Math.floor(Date.now() / 1000), chat: { id: o.chat || 500, type: 'private', first_name: 'Ali' }, from: o.from || { id: 500, first_name: 'Ali' }, business_connection_id: 'bc1', text: o.text, ...o.extra });
const ctxOf = (id, name = 'U') => ({ initData: { user: { id, first_name: name } } });
const expectErr = async (p, code) => { try { await p; return false; } catch (e) { return code ? (e.parameters && e.parameters.code) === code : true; } };

await saveSettings({ gemini_api_key: 'KEY', ai_delay_seconds: 1 });
await (await H('business_connection'))({ id: 'bc1', user: { id: 777 }, is_enabled: true });

// ── ۱) دو پیام پشت‌سرهم مخاطب → فقط «یک» پاسخ AI (debounce)
let c0 = calls().length; const bm = await H('business_message');
await Promise.all([bm(mkMsg({ id: 1, text: 'سلام' })), (async () => { await sleep(150); await bm(mkMsg({ id: 2, text: 'خوبی؟' })); })()]);
let c = since(c0);
const notifs = c.filter((x) => x.method === 'sendMessage' && x.p.chat_id === ADMIN);
ok(notifs.length === 2, 'اعلان تلگرامی برای هر پیام به ادمین رسید (' + notifs.length + ')');
ok(globalThis.__fetches.length === 1, 'فقط یک بار Gemini صدا زده شد (debounce) → ' + globalThis.__fetches.length);
const ai = c.filter((x) => x.method === 'sendMessage' && x.p.chat_id === 500);
ok(ai.length === 1 && ai[0].p.business_connection_id === 'bc1' && ai[0].p.text.startsWith('sai:dev AI Assistant:'), 'پاسخ AI با برچسب و business_connection_id رفت');
const body = JSON.parse(globalThis.__fetches[0].o.body);
ok(body.contents[0].role === 'user' && body.contents[0].parts[0].text.includes('Ali: سلام') && body.contents[0].parts[0].text.includes('Ali: خوبی؟'), 'تاریخچه‌ی هر دو پیام با نام فرستنده به مدل رفت');
ok((await getChat(500)).aiPendingUntil === 0, 'وضعیت «در حال آماده‌سازی» پاک شد');

// ── ۲) صاحب اکانت وسط تایمر جواب بده → AI ساکت
globalThis.__fetches.length = 0; c0 = calls().length;
await Promise.all([bm(mkMsg({ id: 10, text: 'یه سوال داشتم' })), (async () => { await sleep(300); await bm(mkMsg({ id: 11, text: 'جواب خودم', from: { id: 777, first_name: 'Me' } })); })()]);
ok(globalThis.__fetches.length === 0, 'وقتی خودت جواب دادی AI دخالت نکرد');
ok(since(c0).filter((x) => x.p.chat_id === ADMIN).length === 1, 'پیام خودت اعلان نداشت');
ok((await db.select().from(messages).where(eq(messages.msgId, 11)).get()).role === 'owner', 'پیام صاحب اکانت role=owner ثبت شد');

// ── ۳) ویرایش و حذف توسط مخاطب → محتوا می‌مونه
await (await H('edited_business_message'))({ ...mkMsg({ id: 1, text: 'سلام (ویرایش)' }), edit_date: Math.floor(Date.now() / 1000) });
const ed = await db.select().from(edits).all();
ok(ed.length === 1 && ed[0].oldText === 'سلام', 'متن قبلی در تاریخچه‌ی ویرایش ماند');
c0 = calls().length;
await (await H('deleted_business_messages'))({ business_connection_id: 'bc1', chat: { id: 500 }, message_ids: [2] });
const del = await db.select().from(messages).where(eq(messages.msgId, 2)).get();
ok(del.deletedAt && del.text === 'خوبی؟', 'پیام حذف‌شده علامت خورد ولی متنش ماند');
ok(since(c0).some((x) => x.method === 'sendMessage' && x.p.text.includes('خوبی؟') && x.p.text.includes('🗑')), 'اعلان حذف با متن پیام فرستاده شد');

// ── ۴) رسانه: عکس مخاطب → بایت‌ها آرشیو می‌شن
await bm(mkMsg({ id: 20, text: undefined, extra: { photo: [{ file_id: 'F1', file_unique_id: 'U1', file_size: 1000 }], caption: 'ببین' } }));
const mrow = await db.select().from(media).where(eq(media.key, 'U1')).get();
ok(mrow && mrow.saved && mrow.size === 1000, 'بایت عکس در دیتابیس ذخیره شد');
await (await H('deleted_business_messages'))({ business_connection_id: 'bc1', chat: { id: 500 }, message_ids: [20] });
ok((await db.select().from(media).where(eq(media.key, 'U1')).get()).saved, 'عکس بعد از حذف پیام هنوز در آرشیو هست');

// ── ۵) واکنش و بی‌صدا کردن چت از دکمه‌ی اعلان
await (await H('message_reaction'))({ chat: { id: 500 }, message_id: 20, new_reaction: [{ type: 'emoji', emoji: '🔥' }] });
ok((await db.select().from(messages).where(eq(messages.msgId, 20)).get()).theirReaction === '🔥', 'ری‌اکشن مخاطب ثبت شد');
c0 = calls().length;
await (await H('callback_query'))({ id: 'q1', from: { id: ADMIN }, data: 'mute:500', message: { chat: { id: ADMIN }, message_id: 5 } });
ok((await getChat(500)).muted === true, 'دکمه‌ی «بستن اعلان» چت رو بی‌صدا کرد');
await saveSettings({ ai_mode: false });
c0 = calls().length; await bm(mkMsg({ id: 30, text: 'پیام بعد از mute' }));
ok(!since(c0).some((x) => x.p.chat_id === ADMIN), 'چت بی‌صدا اعلان نفرستاد');
c0 = calls().length; await (await H('callback_query'))({ id: 'q2', from: { id: 4242 }, data: 'unmute:500' });
ok((await getChat(500)).muted === true && since(c0).some((x) => x.method === 'answerCallbackQuery' && x.p.text === 'دسترسی نداری.'), 'عضو نامجاز نمی‌تواند با دکمه‌ی اعلان چت را باز کند');
await (await H('callback_query'))({ id: 'q3', from: { id: ADMIN }, data: 'unmute:500', message: { chat: { id: ADMIN }, message_id: 5 } });

// ── ۶) دسترسی با آیدی عددی
const boot = await E('boot'), members_ = await E('members'), settings_ = await E('settings'), chats_ = await E('chats');
const b1 = await boot({}, ctxOf(ADMIN, 'Admin'));
ok(b1.me.role === 'admin' && b1.settings && b1.settings.has_key === true && !('gemini_api_key' in b1.settings), 'ادمین اصلی وارد شد و کلید Gemini برنگشت');
ok(await expectErr(boot({}, ctxOf(2222)), 'FORBIDDEN'), 'آیدی ناشناس FORBIDDEN شد');
ok(await expectErr(boot({}, {}), 'UNAUTHORIZED'), 'بدون initData رد شد');
await members_({ op: 'add', tgId: 2222, role: 'user', name: 'نفر دوم' }, ctxOf(ADMIN));
await members_({ op: 'add', tgId: 3333, role: 'admin', name: 'نفر سوم' }, ctxOf(ADMIN));
ok((await boot({}, ctxOf(2222))).me.role === 'user', '2222 با نقش user وارد شد');
ok((await boot({}, ctxOf(3333))).me.role === 'admin' && (await boot({}, ctxOf(3333))).settings, '3333 با نقش admin پنل ادمین گرفت');
ok(await expectErr(settings_({ op: 'get' }, ctxOf(2222)), 'FORBIDDEN'), 'user به تنظیمات دسترسی ندارد');
ok(await expectErr(members_({ op: 'list' }, ctxOf(2222)), 'FORBIDDEN'), 'user به اعضا دسترسی ندارد');
ok(await expectErr(members_({ op: 'remove', tgId: ADMIN }, ctxOf(3333))), 'ادمین اصلی قابل حذف نیست');
await members_({ op: 'role', tgId: 2222, role: 'admin' }, ctxOf(3333));
ok((await boot({}, ctxOf(2222))).me.role === 'admin', 'ادمین دوم می‌تواند نقش عوض کند');
await members_({ op: 'role', tgId: 2222, role: 'user' }, ctxOf(ADMIN));

// ── ۷) پنل: چت‌ها، پیام‌ها، ارسال، رسانه، آپلود
const cl = (await chats_({}, ctxOf(2222))).chats.find((x) => x.id === 500);
ok(cl && cl.unread > 0, 'لیست چت‌ها با شمارنده‌ی نخوانده (' + (cl && cl.unread) + ')');
const msgs_ = await (await E('messages'))({ chatId: 500 }, ctxOf(2222));
ok(msgs_.messages.some((m) => m.deletedAt && m.text === 'خوبی؟'), 'پیام حذف‌شده هنوز در پنل قابل خواندن است');
ok(((await chats_({}, ctxOf(2222))).chats.find((x) => x.id === 500)).unread === 0, 'بعد از باز کردن چت، نخوانده صفر شد');
ok((await (await E('messages'))({ chatId: 500, filter: 'deleted' }, ctxOf(2222))).messages.length === 2, 'فیلتر «حذف‌شده‌ها» ۲ پیام داد');
ok((await (await E('messages'))({ chatId: 500, filter: 'media' }, ctxOf(2222))).messages.length === 1, 'فیلتر «رسانه‌ها» عکس حذف‌شده را نشان داد');
c0 = calls().length;
await (await E('send'))({ chatId: 500, text: 'از پنل', mode: 'me' }, ctxOf(2222, 'نفر دوم'));
ok(since(c0).some((x) => x.method === 'sendMessage' && x.p.chat_id === 500 && x.p.business_connection_id === 'bc1'), 'ارسال حالت «من» با اتصال بیزینس رفت');
const m1 = await (await E('media'))({ key: 'U1', part: 0 }, ctxOf(2222));
ok(m1.parts === 1 && m1.size === 1000 && m1.mime === 'image/jpeg' && m1.b64.length > 1000, 'endpoint رسانه بایت‌های آرشیو را داد');
// آپلود دو تکه‌ای یک عکس
const { b64encode } = await import('./tgcloud/lib/b64.js'); const big = new Uint8Array(500000).map((_, i) => i & 255); const CH = 393216;
c0 = calls().length; const up = await E('upload'); let r;
for (let i = 0; i < 2; i++) r = await up({ uploadId: 'upl123', part: i, parts: 2, b64: b64encode(big.subarray(i * CH, (i + 1) * CH)), meta: i === 1 ? { chatId: 500, kind: 'photo', filename: 'a.jpg', mime: 'image/jpeg', mode: 'me' } : undefined }, ctxOf(2222));
const sp = since(c0).find((x) => x.method === 'sendPhoto');
ok(r.done && sp && sp.p.photo.bytes.length === 500000 && sp.p.business_connection_id === 'bc1', 'آپلود تکه‌ای به یک فایل کامل ۵۰۰هزار بایتی تبدیل و ارسال شد');
ok((await db.select().from(media).where(eq(media.key, 'uph1')).get()).saved, 'عکس ارسالی هم آرشیو شد');
// ویس با fallback
globalThis.__apiFail.sendVoice = 'Bad Request: wrong file type'; globalThis.__apiFail.sendAudio = 'Bad Request: wrong file type'; c0 = calls().length;
r = await up({ uploadId: 'upl456', part: 0, parts: 1, b64: b64encode(big.subarray(0, 3000)), meta: { chatId: 500, kind: 'voice', filename: 'v.webm', mime: 'audio/webm', mode: 'bot' } }, ctxOf(2222));
ok(r.done && since(c0).map((x) => x.method).join() === 'sendVoice,sendAudio,sendDocument', 'ویس: زنجیره‌ی fallback به document رسید');
delete globalThis.__apiFail.sendVoice; delete globalThis.__apiFail.sendAudio;
// ویرایش پیام از پنل + حذف (ادمین) محتوا را نگه می‌دارد
const sentRow = (await db.select().from(messages).where(eq(messages.role, 'admin')).all())[0];
await (await E('editMessage'))({ chatId: 500, msgId: sentRow.msgId, text: 'از پنل (ویرایش)' }, ctxOf(2222));
ok((await db.select().from(edits).all()).length === 2, 'ویرایش از پنل هم در تاریخچه ثبت شد');
ok(await expectErr((await E('deleteMessage'))({ chatId: 500, msgId: sentRow.msgId }, ctxOf(2222)), 'FORBIDDEN'), 'user نمی‌تواند حذف کند');
await (await E('deleteMessage'))({ chatId: 500, msgId: sentRow.msgId }, ctxOf(3333));
const after = await db.select().from(messages).where(eq(messages.id, sentRow.id)).get();
ok(after.deletedAt && after.text === 'از پنل (ویرایش)', 'حذف ادمین: در تلگرام پاک، در پنل محفوظ');
// دستور /send_msg و prefs
c0 = calls().length; await bm(mkMsg({ id: 40, text: '/send_msg کارت دارم' }));
ok(since(c0).some((x) => x.p.text && x.p.text.includes('کارت دارم') && x.p.chat_id === ADMIN), '/send_msg به ادمین‌ها رسید');
await (await E('prefs'))({ notify: false }, ctxOf(2222));
ok((await db.select().from(members).where(eq(members.tgId, 2222)).get()).notify === false, 'خاموش کردن اعلان شخصی ذخیره شد');
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
