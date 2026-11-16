// تست‌های فاز دوم. با run.mjs اجرا می‌شود (sh dev/test.sh).
import { anonMessages, anonBlocks, anonSessions, anonLinks, chatCategories, modLog, chats } from './tgcloud/schema.js';
import { and, eq, lt } from 'sdk/db';

export default async function (T) {
  const { H, E, ok, ctxOf, calls, since, expectErr, sleep, ADMIN, saveSettings, getChat, db, messages } = T;
  const before = calls().length && 0;
  let fails = 0;
  const check = (c, m) => { ok(c, m); if (!c) fails++; };
  const call = async (name, input, ctx) => (await E(name))(input, ctx);
  const u = (id) => ctxOf(id);
  console.log('\n── فاز دوم ──');

  // ───────── دسته‌بندی چت‌ها ─────────
  await saveSettings({ ai_mode: false });
  check(await expectErr(call('categories', { op: 'create', name: 'x' }, u(2222)), 'FORBIDDEN'), 'دسته‌بندی: کاربر معمولی نمی‌تواند بسازد');
  await call('categories', { op: 'create', name: 'مشتری‌ها', emoji: '⭐' }, u(3333));
  await call('categories', { op: 'create', name: 'دوستان' }, u(3333));
  check(await expectErr(call('categories', { op: 'create', name: 'دوستان' }, u(3333))), 'دسته‌بندی: نام تکراری رد شد');
  let cl = (await call('categories', { op: 'list' }, u(2222))).categories;
  check(cl.length === 2 && cl[0].name === 'مشتری‌ها' && cl[0].emoji === '⭐', 'دسته‌بندی: لیست برای همه‌ی اعضا');
  const [c1, c2] = [cl[0].id, cl[1].id];
  const as = await call('categories', { op: 'assign', chatId: 500, categoryIds: [c1, c2, 99999, c1] }, u(2222));
  check(as.categoryIds.length === 2, 'دسته‌بندی: انتساب چت (آیدی نامعتبر و تکراری حذف شد)');
  let chl = await call('chats', {}, u(2222));
  check(chl.categories.length === 2 && chl.chats.find((c) => c.id === 500).cats.length === 2, 'دسته‌بندی: لیست چت‌ها دسته‌ها را همراه دارد');
  await call('categories', { op: 'update', id: c1, name: 'مشتری ویژه' }, u(3333));
  await call('categories', { op: 'reorder', ids: [c2, c1] }, u(3333));
  cl = (await call('categories', { op: 'list' }, u(2222))).categories;
  check(cl[0].id === c2 && cl[1].name === 'مشتری ویژه', 'دسته‌بندی: ویرایش نام و تغییر ترتیب');
  await call('categories', { op: 'delete', id: c2 }, u(3333));
  chl = await call('chats', {}, u(2222));
  check(chl.categories.length === 1 && chl.chats.find((c) => c.id === 500).cats.join() === String(c1), 'دسته‌بندی: حذف دسته، انتساب‌هایش را هم پاک کرد');

  // ───────── جستجو ─────────
  const sr = (i, id = 2222) => call('search', i, u(id));
  let r = await sr({ q: 'سلام' });
  check(r.results.length >= 1 && r.results.every((x) => x.snippet.includes('سلام')), 'جستجو: نتیجه‌ی سراسری با snippet');
  r = await sr({ q: 'خوبی', chatId: 500 });
  check(r.results.length === 1 && r.results[0].deleted === true, 'جستجو: پیام حذف‌شده هم پیدا می‌شود و علامت دارد');
  check(await expectErr(sr({ q: 'a' })), 'جستجو: کمتر از ۲ حرف رد شد');
  r = await sr({ q: '100%' });
  check(r.results.length === 0, 'جستجو: کاراکترهای ویژه‌ی LIKE (%) امن هستند');
  r = await sr({ q: 'سلام', chatId: 12345 });
  check(r.results.length === 0, 'جستجو: فیلتر روی چت');

  // ───────── پرش به پیام و سنجاق داخل چت ─────────
  const ms = (i, id = 2222) => call('messages', i, u(id));
  const all = await ms({ chatId: 500, limit: 200 });
  const mid = all.messages[3].id;
  const ar = await ms({ chatId: 500, aroundId: mid });
  check(ar.around && ar.messages.some((m) => m.id === mid) && ar.messages.length === all.messages.length, 'جستجو: پرش به پیام، پیام‌های اطراف را آورد');
  check((await ms({ chatId: 500 }, 3333)).messages.some((m) => m.senderId), 'ادمین آیدی فرستنده را می‌بیند');
  check(!(await ms({ chatId: 500 }, 2222)).messages.some((m) => m.senderId), 'کاربر معمولی آیدی فرستنده را نمی‌بیند');

  let c0 = calls().length;
  await call('pinMessage', { chatId: 500, msgId: 1, pin: true }, u(2222));
  check(!since(c0).some((x) => x.method === 'pinChatMessage'), 'سنجاق: کاربر فقط در پنل سنجاق می‌کند');
  let pm = await ms({ chatId: 500 });
  check(pm.pinned && pm.pinned.msgId === 1, 'سنجاق: بنر پیام سنجاق‌شده در پاسخ هست');
  c0 = calls().length;
  await call('pinMessage', { chatId: 500, msgId: 10, pin: true }, u(3333));
  check(since(c0).some((x) => x.method === 'pinChatMessage' && x.p.business_connection_id === 'bc1' && x.p.message_id === 10), 'سنجاق: ادمین در تلگرام هم سنجاق می‌کند (با اتصال بیزینس)');
  globalThis.__apiFail.pinChatMessage = 'Bad Request: not enough rights to pin a message';
  r = await call('pinMessage', { chatId: 500, msgId: 30, pin: true }, u(3333));
  check(r.pinned && r.tgError && r.tgError.includes('سنجاق'), 'سنجاق: خطای تلگرام گزارش می‌شود ولی سنجاق پنل می‌ماند');
  delete globalThis.__apiFail.pinChatMessage;
  await call('pinMessage', { chatId: 500, msgId: 30, pin: false }, u(3333));
  check((await ms({ chatId: 500 })).pinned.msgId === 10, 'سنجاق: برداشتن سنجاق، بنر را به قبلی برمی‌گرداند');

  // ───────── فوروارد ─────────
  const mh = await H('message');
  const dm = (from, text, extra) => ({ message_id: ++T.__n, date: Math.floor(Date.now() / 1000), chat: { id: from.id, type: 'private', first_name: from.first_name }, from, text, ...(extra || {}) });
  T.__n = 100;
  await mh({ message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: 600, type: 'private', first_name: 'Sara' }, from: { id: 600, first_name: 'Sara' }, text: 'hi from sara' });
  check(!!(await getChat(600)), 'فوروارد: چت دوم (پیام مستقیم) ساخته شد');
  c0 = calls().length;
  let f = await call('forward', { chatId: 500, msgIds: [1], targets: [{ chatId: 600, mode: 'bot' }] }, u(2222));
  let sm = since(c0).find((x) => x.method === 'sendMessage' && x.p.chat_id === 600);
  check(f.results[0].ok && sm && sm.p.text.includes('↪ فوروارد از Ali') && sm.p.text.includes('سلام (ویرایش)') && !sm.p.business_connection_id, 'فوروارد: متن با برچسب مبدأ به چت دیگر رفت');
  const fr = await db.select().from(messages).where(eq(messages.chatId, 600)).all();
  check(fr.some((m) => m.forwardedFrom === 'Ali' && m.role === 'admin'), 'فوروارد: در چت مقصد ثبت شد (forwardedFrom)');
  c0 = calls().length;
  f = await call('forward', { chatId: 500, msgIds: [20], targets: [{ chatId: 600, mode: 'bot' }], showOrigin: true }, u(2222));
  let sp = since(c0).find((x) => x.method === 'sendPhoto');
  check(sp && sp.p.photo === 'F1' && sp.p.caption.includes('ببین') && sp.p.caption.includes('↪'), 'فوروارد: عکس با file_id و کپشن مبدأ ارسال شد');
  c0 = calls().length;
  await call('forward', { chatId: 600, msgIds: [1], targets: [{ chatId: 500, mode: 'me' }], showOrigin: false }, u(2222));
  sm = since(c0).find((x) => x.method === 'sendMessage' && x.p.chat_id === 500);
  check(sm && sm.p.business_connection_id === 'bc1' && sm.p.text === 'hi from sara', 'فوروارد: حالت «من» با اتصال بیزینس و بدون برچسب مبدأ');
  globalThis.__apiFail.sendMessage = 'Forbidden: bot was blocked by the user';
  f = await call('forward', { chatId: 500, msgIds: [1], targets: [{ chatId: 600, mode: 'bot' }] }, u(2222));
  check(f.results[0].ok === false && f.results[0].error.includes('بلاک'), 'فوروارد: خطا برای هر مقصد جدا گزارش می‌شود');
  delete globalThis.__apiFail.sendMessage;
  check(await expectErr(call('forward', { chatId: 500, msgIds: [1], targets: [] }, u(2222))), 'فوروارد: بدون مقصد رد شد');

  // ───────── مدیریت گروه ─────────
  const G = -1001;
  const gm = (id, uid, name, text) => ({ message_id: id, date: Math.floor(Date.now() / 1000), chat: { id: G, type: 'supergroup', title: 'گروه تست' }, from: { id: uid, first_name: name }, text });
  for (let i = 1; i <= 3; i++) await mh(gm(i, 700, 'Reza', 'spam' + i));
  await mh(gm(4, 701, 'Neda', 'سلام گروه'));
  await mh(gm(5, 701, 'Neda', 'خوبید؟'));
  const gchat = await getChat(G);
  check(gchat && gchat.isGroup && gchat.title === 'گروه تست', 'گروه: چت گروه ثبت شد');
  check(await expectErr(call('groupMod', { chatId: G, op: 'ban', userId: 700 }, u(2222)), 'FORBIDDEN'), 'گروه: کاربر معمولی اجازه‌ی مدیریت ندارد');
  check(await expectErr(call('groupMod', { chatId: 500, op: 'ban', userId: 700 }, u(3333))), 'گروه: روی چت غیرگروهی رد شد');
  c0 = calls().length;
  await call('groupMod', { chatId: G, op: 'ban', userId: 700, name: 'Reza', revoke: true }, u(3333));
  check(since(c0).some((x) => x.method === 'banChatMember' && x.p.chat_id === G && x.p.user_id === 700 && x.p.revoke_messages === true), 'گروه: بن با حذف پیام‌ها');
  c0 = calls().length;
  await call('groupMod', { chatId: G, op: 'mute', userId: 701, name: 'Neda', minutes: 60 }, u(3333));
  let rc = since(c0).find((x) => x.method === 'restrictChatMember');
  check(rc && rc.p.permissions.can_send_messages === false && rc.p.until_date > Math.floor(Date.now() / 1000), 'گروه: میوت یک‌ساعته با until_date');
  c0 = calls().length;
  await call('groupMod', { chatId: G, op: 'mute', userId: 701, minutes: 0 }, u(3333));
  rc = since(c0).find((x) => x.method === 'restrictChatMember');
  check(rc && !('until_date' in rc.p), 'گروه: میوت همیشگی بدون until_date');
  c0 = calls().length;
  await call('groupMod', { chatId: G, op: 'unmute', userId: 701 }, u(3333));
  rc = since(c0).find((x) => x.method === 'restrictChatMember');
  check(rc && rc.p.permissions.can_send_messages === true, 'گروه: رفع میوت');
  c0 = calls().length;
  await call('groupMod', { chatId: G, op: 'kick', userId: 701 }, u(3333));
  check(since(c0).map((x) => x.method).filter((m) => /ChatMember/.test(m)).join() === 'banChatMember,unbanChatMember', 'گروه: اخراج = بن + آنبن');
  c0 = calls().length;
  await call('groupMod', { chatId: G, op: 'unban', userId: 700 }, u(3333));
  check(since(c0).some((x) => x.method === 'unbanChatMember' && x.p.only_if_banned === true), 'گروه: رفع بن');
  c0 = calls().length;
  r = await call('groupMod', { chatId: G, op: 'deleteUser', userId: 700, name: 'Reza' }, u(3333));
  const dc = since(c0).find((x) => x.method === 'deleteMessages');
  check(r.deleted === 3 && dc && dc.p.message_ids.join() === '3,2,1', 'گروه: حذف همه‌ی پیام‌های یک کاربر (دسته‌ای)');
  const rz = await db.select().from(messages).where(and(eq(messages.chatId, G), eq(messages.senderId, 700))).all();
  check(rz.length === 3 && rz.every((m) => m.deletedAt && m.text.startsWith('spam')), 'گروه: متن پیام‌های حذف‌شده در پنل محفوظ ماند');
  r = await call('groupMod', { chatId: G, op: 'log' }, u(3333));
  check(r.log.length === 7 && r.log[0].action === 'delete_user' && r.log[0].by, 'گروه: گزارش اقدام‌ها (' + r.log.length + ')');
  globalThis.__apiFail.banChatMember = 'Bad Request: CHAT_ADMIN_REQUIRED';
  try { await call('groupMod', { chatId: G, op: 'ban', userId: 702 }, u(3333)); check(false, 'گروه: خطا'); }
  catch (e) { check(e.message.includes('ادمین'), 'گروه: خطای تلگرام فارسی شد → ' + e.message); }
  delete globalThis.__apiFail.banChatMember;
  // حذف گروهی (انتخاب چندتایی)
  c0 = calls().length;
  r = await call('deleteMessages', { chatId: G, msgIds: [4, 5] }, u(3333));
  check(r.deleted === 2 && since(c0).some((x) => x.method === 'deleteMessages' && x.p.message_ids.join() === '4,5'), 'حذف گروهی در گروه');
  c0 = calls().length;
  r = await call('deleteMessages', { chatId: 500, msgIds: [10, 30, 99999] }, u(3333));
  check(r.deleted === 2 && since(c0).some((x) => x.method === 'deleteBusinessMessages' && x.p.business_connection_id === 'bc1'), 'حذف گروهی در چت بیزینس (با اتصال بیزینس)');
  check(await expectErr(call('deleteMessages', { chatId: 500, msgIds: [1] }, u(2222)), 'FORBIDDEN'), 'حذف گروهی: فقط ادمین');
  const kept = await db.select().from(messages).where(and(eq(messages.chatId, 500), eq(messages.msgId, 10))).get();
  check(kept.deletedAt && kept.text === 'یه سوال داشتم', 'حذف گروهی: محتوا در آرشیو ماند');

  // ───────── پیام ناشناس ─────────
  console.log('\n── پیام ناشناس ──');
  const OWNER = { id: 5000, first_name: 'Owner' };
  const V1 = { id: 6000, first_name: 'VisitorOne' };
  const V2 = { id: 6001, first_name: 'VisitorTwo' };
  const chatsBefore = (await db.select().from(chats).all()).length;
  c0 = calls().length;
  await mh(dm(OWNER, '/anon'));
  const linkMsg = since(c0).find((x) => x.method === 'sendMessage' && x.p.chat_id === 5000 && /t\.me\/mock_bot\?start=anon_/.test(x.p.text));
  check(!!linkMsg, 'ناشناس: /anon لینک خصوصی ساخت');
  const token = linkMsg.p.text.match(/start=anon_([A-Za-z0-9]+)/)[1];
  check(token.length === 16, 'ناشناس: توکن ۱۶ کاراکتری (' + token + ')');
  c0 = calls().length;
  await mh(dm(OWNER, '/anon'));
  check(since(c0).some((x) => x.p.text && x.p.text.includes(token)), 'ناشناس: /anon دوباره همان لینک را نشان می‌دهد');

  c0 = calls().length;
  await mh(dm(V1, '/start anon_' + token));
  check(since(c0).some((x) => x.p.chat_id === 6000 && x.p.text.includes('Owner') && x.p.text.includes('ناشناس') && x.p.text.includes('ادمین ربات')), 'ناشناس: فرستنده راهنما و اطلاعیه‌ی حریم خصوصی را می‌بیند');
  c0 = calls().length;
  await mh(dm(V1, 'سلام ناشناس'));
  const toOwner = since(c0).find((x) => x.method === 'sendMessage' && x.p.chat_id === 5000);
  const leak = JSON.stringify(since(c0).filter((x) => x.p.chat_id === 5000 || x.p.chat_id === OWNER.id));
  check(toOwner && toOwner.p.text.includes('ناشناس #1') && toOwner.p.text.includes('سلام ناشناس'), 'ناشناس: پیام با برچسب «ناشناس #1» به مالک رسید');
  check(!leak.includes('6000') && !leak.includes('VisitorOne'), 'ناشناس: هیچ ردی از هویت فرستنده برای مالک نیست');
  check(!!toOwner.p.reply_markup.inline_keyboard[0].find((b) => b.callback_data.startsWith('ab:')) && !!toOwner.p.reply_markup.inline_keyboard[0].find((b) => b.callback_data.startsWith('ar:')), 'ناشناس: دکمه‌های بلاک و گزارش زیر پیام');
  check(!(await getChat(6000)) && (await db.select().from(chats).all()).length === chatsBefore, 'ناشناس: چتی در پنل ساخته نشد');
  check(!(await db.select().from(messages).all()).some((m) => m.text.includes('سلام ناشناس')), 'ناشناس: متن پیام در جدول پیام‌های پنل ذخیره نشد');
  check(!(await db.select().from(anonMessages).all()).some((m) => JSON.stringify(m).includes('سلام')), 'ناشناس: متن پیام در جدول مسیریابی هم نیست');
  check(since(c0).some((x) => x.method === 'setMessageReaction' && x.p.chat_id === 6000), 'ناشناس: فرستنده با ری‌اکشن 👍 تأیید می‌گیرد');

  // رسانه با copyMessage (بدون «فوروارد از»)
  c0 = calls().length;
  await mh(dm(V1, undefined, { photo: [{ file_id: 'PX', file_unique_id: 'UPX', file_size: 10 }], caption: 'عکس من' }));
  const cp = since(c0).find((x) => x.method === 'copyMessage' && x.p.chat_id === 5000);
  check(cp && cp.p.caption.includes('ناشناس #1') && cp.p.caption.includes('عکس من') && cp.p.from_chat_id === 6000, 'ناشناس: عکس با copyMessage و کپشن ناشناس رسید');
  c0 = calls().length;
  await mh(dm(V1, undefined, { sticker: { file_id: 'S', file_unique_id: 'US', emoji: '😀' } }));
  check(since(c0).some((x) => x.method === 'sendMessage' && x.p.chat_id === 5000 && x.p.text.includes('ناشناس #1')) && since(c0).some((x) => x.method === 'copyMessage'), 'ناشناس: استیکر → سرتیتر + copyMessage');
  c0 = calls().length;
  await mh(dm(V1, undefined, { location: { latitude: 1, longitude: 2 } }));
  check(since(c0).some((x) => x.p.chat_id === 6000 && x.p.text.includes('پشتیبانی نمی')) && !since(c0).some((x) => x.p.chat_id === 5000), 'ناشناس: نوع ناسازگار (موقعیت مکانی) رد شد');

  // پاسخ مالک با Reply
  const lastIn = (await db.select().from(anonMessages).all()).filter((m) => m.dir === 'in').sort((a, b) => a.id - b.id)[0];
  c0 = calls().length;
  await mh(dm(OWNER, 'جواب من', { reply_to_message: { message_id: lastIn.ownerMsgId } }));
  const back = since(c0).find((x) => x.method === 'sendMessage' && x.p.chat_id === 6000);
  check(back && back.p.text.includes('پاسخ از طرف Owner') && back.p.text.includes('جواب من'), 'ناشناس: پاسخ مالک ناشناس به فرستنده رسید');
  check(!(await getChat(5000)), 'ناشناس: چت مالک هم وارد پنل نشد');
  // دومین فرستنده
  await mh(dm(V2, '/start anon_' + token));
  c0 = calls().length;
  await mh(dm(V2, 'من نفر دومم'));
  check(since(c0).some((x) => x.p.chat_id === 5000 && x.p.text.includes('ناشناس #2')), 'ناشناس: فرستنده‌ی دوم شماره‌ی #2 می‌گیرد');
  await mh(dm(V1, 'باز هم من'));
  check(since(c0).some((x) => x.p.chat_id === 5000 && x.p.text.includes('ناشناس #1') && x.p.text.includes('باز هم من')), 'ناشناس: شماره‌ی هر فرستنده ثابت می‌ماند');

  // خودِ مالک روی لینک خودش
  c0 = calls().length;
  await mh(dm(OWNER, '/start anon_' + token));
  check(since(c0).some((x) => x.p.chat_id === 5000 && x.p.text.includes('لینک خودته')), 'ناشناس: مالک روی لینک خودش نمی‌تواند پیام بدهد');

  // بلاک و گزارش
  const cb = (from, data, msgChat = from.id) => ({ id: 'cb' + Math.random(), from, data, message: { chat: { id: msgChat }, message_id: 77 } });
  const cq = await H('callback_query');
  const rows = (await db.select().from(anonMessages).all()).filter((m) => m.dir === 'in' && m.senderId === 6001);
  const ref = rows[0].ref;
  c0 = calls().length;
  await cq(cb({ id: 4242, first_name: 'X' }, 'ab:' + ref));
  check((await db.select().from(anonBlocks).all()).length === 0 && since(c0).some((x) => x.method === 'answerCallbackQuery' && x.p.text.includes('دیگر در دسترس')), 'ناشناس: غیرمالک نمی‌تواند با دکمه بلاک کند');
  c0 = calls().length;
  await cq(cb(OWNER, 'ar:' + ref, 5000));
  const rep = since(c0).find((x) => x.method === 'sendMessage' && x.p.chat_id === ADMIN && x.p.text.includes('گزارش پیام ناشناس'));
  check(rep && rep.p.text.includes('6001') && since(c0).some((x) => x.method === 'copyMessage' && x.p.chat_id === ADMIN), 'ناشناس: گزارش، پیام و شناسه‌ی فرستنده را فقط برای ادمین می‌فرستد');
  await cq(cb({ id: 4242, first_name: 'X' }, 'ag:6001'));
  check(!(await db.select().from(anonBlocks).all()).some((b) => b.ownerId === 0), 'ناشناس: بلاک سراسری فقط توسط ادمین');
  await cq(cb({ id: ADMIN, first_name: 'A' }, 'ag:6001'));
  check((await db.select().from(anonBlocks).all()).some((b) => b.key === '0:6001'), 'ناشناس: ادمین فرستنده را سراسری بلاک کرد');
  c0 = calls().length;
  await mh(dm(V2, 'پیام بعد از بلاک سراسری'));
  check(since(c0).some((x) => x.p.chat_id === 6001 && x.p.text.includes('ممکن نیست')) && !since(c0).some((x) => x.p.chat_id === 5000), 'ناشناس: فرستنده‌ی بلاک‌شده پیامش نمی‌رسد');
  await cq(cb(OWNER, 'ab:' + (await db.select().from(anonMessages).all()).filter((m) => m.dir === 'in' && m.senderId === 6000)[0].ref, 5000));
  check((await db.select().from(anonBlocks).all()).some((b) => b.key === '5000:6000'), 'ناشناس: مالک فرستنده را بلاک کرد');
  c0 = calls().length;
  await mh(dm(V1, 'من بلاکم؟'));
  check(since(c0).some((x) => x.p.chat_id === 6000 && x.p.text.includes('ممکن نیست')) && !since(c0).some((x) => x.p.chat_id === 5000), 'ناشناس: بلاک مالک اعمال شد (پیام بلاک/غیرفعال یکسان است)');

  // خاموش/روشن، لینک جدید
  const V3 = { id: 6002, first_name: 'VisitorThree' };
  await mh(dm(V3, '/start anon_' + token));
  await cq(cb(OWNER, 'an:toggle', 5000));
  check((await db.select().from(anonLinks).get()).enabled === false, 'ناشناس: مالک لینک را خاموش کرد');
  c0 = calls().length;
  await mh(dm(V3, 'سلام؟'));
  check(since(c0).some((x) => x.p.chat_id === 6002 && x.p.text.includes('ممکن نیست')) && !since(c0).some((x) => x.p.chat_id === 5000), 'ناشناس: لینک خاموش پیام نمی‌گیرد');
  await mh(dm(OWNER, '/anon on'));
  check((await db.select().from(anonLinks).get()).enabled === true, 'ناشناس: /anon on دوباره روشن کرد');
  await mh(dm(OWNER, '/anon new'));
  const newLink = await db.select().from(anonLinks).get();
  check(newLink.token !== token && !(await db.select().from(anonSessions).all()).some((s) => s.token === token), 'ناشناس: لینک جدید ساخته و نشست‌های لینک قدیمی بسته شد');
  c0 = calls().length;
  await mh(dm(V3, '/start anon_' + token));
  check(since(c0).some((x) => x.p.chat_id === 6002 && x.p.text.includes('ممکن نیست')), 'ناشناس: لینک قدیمی باطل است');

  // محدودیت نرخ + /stop
  const V4 = { id: 6003, first_name: 'VisitorFour' };
  await saveSettings({ anon_rate_per_hour: 2 });
  await mh(dm(V4, '/start anon_' + newLink.token));
  await mh(dm(V4, 'یک')); await mh(dm(V4, 'دو'));
  c0 = calls().length;
  await mh(dm(V4, 'سه'));
  check(since(c0).some((x) => x.p.chat_id === 6003 && x.p.text.includes('سقف')) && !since(c0).some((x) => x.p.chat_id === 5000), 'ناشناس: محدودیت نرخ ساعتی');
  await saveSettings({ anon_rate_per_hour: 30 });
  await mh(dm(V4, '/stop'));
  check(!(await db.select().from(anonSessions).all()).some((s) => s.senderId === 6003), 'ناشناس: /stop نشست را بست');

  // خطای تحویل → چیزی به پنل نمی‌رود
  await mh(dm(V4, '/start anon_' + newLink.token));
  globalThis.__apiFail.copyMessage = 'Forbidden: bot was blocked by the user';
  c0 = calls().length;
  const rowsBefore = (await db.select().from(anonMessages).all()).length;
  await mh(dm(V4, undefined, { photo: [{ file_id: 'Q', file_unique_id: 'UQ', file_size: 1 }] }));
  delete globalThis.__apiFail.copyMessage;
  check(since(c0).some((x) => x.p.chat_id === 6003 && x.p.text.includes('تحویل داده نشد')) && (await db.select().from(anonMessages).all()).length === rowsBefore && !(await getChat(6003)), 'ناشناس: خطای تحویل → اطلاع به فرستنده، بدون نشت به پنل');

  // نگهداری (retention)
  await db.insert(anonMessages).values({ ref: 'oldref', dir: 'in', ownerId: 5000, senderId: 6009, ownerMsgId: 1, ts: Date.now() - 40 * 86400000 }).run();
  await mh(dm(V4, 'برای پاک‌سازی'));
  check(!(await db.select().from(anonMessages).all()).some((m) => m.ref === 'oldref'), 'ناشناس: ردیف‌های قدیمی طبق تنظیم نگهداری پاک شد');

  // خاموش کردن کلی
  await saveSettings({ anon_enabled: false });
  c0 = calls().length;
  await mh(dm(OWNER, '/anon'));
  check(since(c0).some((x) => x.p.chat_id === 5000 && x.p.text.includes('خاموش')), 'ناشناس: خاموش بودن کلی');
  c0 = calls().length;
  await mh(dm(V4, '/start anon_' + newLink.token));
  check(since(c0).some((x) => x.p.chat_id === 6003 && x.p.text.includes('ممکن نیست')), 'ناشناس: با خاموش بودن کلی لینک‌ها کار نمی‌کنند');
  await saveSettings({ anon_enabled: true });

  // پنل ادمین
  const ov = await call('anonAdmin', { op: 'overview' }, u(3333));
  check(ov.links === 1 && ov.messages24h >= 5 && ov.globalBlocks.some((b) => b.senderId === 6001) && ov.ownerBlocks === 1, 'ناشناس: نمای کلی ادمین (' + JSON.stringify({ l: ov.links, m: ov.messages24h }) + ')');
  check(await expectErr(call('anonAdmin', {}, u(2222)), 'FORBIDDEN'), 'ناشناس: نمای ادمین برای کاربر معمولی بسته است');
  await call('anonAdmin', { op: 'unblock', senderId: 6001 }, u(3333));
  check(!(await call('anonAdmin', {}, u(3333))).globalBlocks.length, 'ناشناس: رفع بلاک سراسری از پنل');
  await call('anonAdmin', { op: 'block', senderId: 6100 }, u(3333));
  check((await call('anonAdmin', {}, u(3333))).globalBlocks[0].senderId === 6100, 'ناشناس: بلاک سراسری از پنل');
  check(await expectErr(call('settings', { op: 'save', values: { anon_rate_per_hour: 5000 } }, u(3333))), 'تنظیمات ناشناس: مقدار خارج از بازه رد شد');
  await call('settings', { op: 'save', values: { anon_retention_days: 7, anon_enabled: true } }, u(3333));

  return fails;
}
