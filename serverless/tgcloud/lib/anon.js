import { api, db } from 'sdk';
import { and, eq, gt, lt, inArray } from 'sdk/db';
import { anonLinks, anonSessions, anonMessages, anonAliases, anonBlocks, anonReports } from '../schema.js';
import { getSettings, saveSettings, adminIds, memberRole } from './store.js';
import { describeMedia } from './media.js';
import { alertAdmins } from './notify.js';
import { getUiState, setUiState, clearUiState } from './moderation.js';
import { bump } from './stats.js';
import { now, fullName, clip, faError } from './util.js';

/*
  پیام ناشناس (مثل ربات‌های «پیام ناشناس»):
  • هر کسی در پیوی ربات /anon بزند، یک لینک خصوصی می‌گیرد:  https://t.me/<bot>?start=anon_<token>
  • هر کس روی لینک بزند و پیام بنویسد، پیامش بدون هیچ هویتی («📩 ناشناس #N») برای مالک لینک می‌رسد.
  • مالک روی همان پیام Reply می‌زند تا ناشناس جواب بدهد.
  • مالک می‌تواند فرستنده را بلاک کند، گزارش بدهد، لینک را خاموش یا عوض کند.
  هیچ‌وقت شناسه‌ی فرستنده برای مالک فرستاده نمی‌شود، ارسال با sendMessage/copyMessage انجام می‌شود (بدون «فوروارد از …»)
  و این پیام‌ها هرگز وارد جدول messages / چت‌های پنل نمی‌شوند.
*/

const AL = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randToken(n) {
  const out = []; const c = globalThis.crypto;
  if (c && c.getRandomValues) { const b = new Uint8Array(n); c.getRandomValues(b); for (let i = 0; i < n; i++) out.push(AL[b[i] % AL.length]); }
  else { for (let i = 0; i < n; i++) out.push(AL[Math.floor(Math.random() * AL.length)]); }
  return out.join('');
}

const OK_TYPES = ['photo', 'video', 'voice', 'audio', 'document', 'sticker', 'animation', 'video_note'];
const say = (chatId, text, extra) => api.sendMessage({ chat_id: chatId, text, ...(extra || {}) });
const NA = '⛔ ارسال به این لینک ممکن نیست.';

async function botUsername(st) {
  if (st.bot_username) return st.bot_username;
  const me = await api.getMe();
  await saveSettings({ bot_username: me.username });
  return me.username;
}
const linkUrl = (user, token) => `https://t.me/${user}?start=anon_${token}`;

async function linkOf(ownerId) {
  return (await db.select().from(anonLinks).where(eq(anonLinks.ownerId, ownerId)).get()) || null;
}
async function ensureLink(ownerId, ownerName) {
  let l = await linkOf(ownerId);
  if (!l) {
    const token = randToken(16);
    await db.insert(anonLinks).values({ token, ownerId, ownerName: clip(ownerName, 60), enabled: true, uses: 0, createdAt: now() }).run();
    l = await linkOf(ownerId);
  }
  return l;
}
async function isBlocked(ownerId, senderId) {
  const rows = await db.select().from(anonBlocks).where(inArray(anonBlocks.key, [`${ownerId}:${senderId}`, `0:${senderId}`])).all();
  return rows.length > 0;
}
async function aliasFor(ownerId, senderId) {
  const key = `${ownerId}:${senderId}`;
  const ex = await db.select().from(anonAliases).where(eq(anonAliases.key, key)).get();
  if (ex) return ex.n;
  const n = (await db.$count(anonAliases, eq(anonAliases.ownerId, ownerId))) + 1;
  await db.insert(anonAliases).values({ key, ownerId, senderId, n, ts: now() }).run();
  return n;
}
async function purge(st) {
  const days = Math.max(1, Number(st.anon_retention_days) || 14);
  const cut = now() - days * 86400000;
  await db.delete(anonMessages).where(lt(anonMessages.ts, cut)).run();
  await db.delete(anonAliases).where(lt(anonAliases.ts, cut)).run();
  await db.delete(anonSessions).where(lt(anonSessions.ts, now() - 7 * 86400000)).run();
}

// ───────── کیبورد/متن لینک مالک ─────────
function ownerKeyboard(l) {
  return { inline_keyboard: [[
    { text: l.enabled ? '⛔ خاموش کردن لینک' : '✅ روشن کردن لینک', callback_data: 'an:toggle' },
    { text: '🔄 لینک جدید', callback_data: 'an:new' },
  ], [{ text: '📊 آمار', callback_data: 'an:stats' }]] };
}
async function showLink(chatId, l, st) {
  const user = await botUsername(st);
  const text = `🕶 لینک پیام ناشناس تو:\n${linkUrl(user, l.token)}\n\n` +
    `هر کس روی این لینک بزنه می‌تونه برات ناشناس پیام بفرسته.\n` +
    `• برای ناشناس جواب دادن، روی پیامِ رسیده Reply بزن.\n` +
    `• از دکمه‌های زیر هر پیام می‌تونی فرستنده رو بلاک یا گزارش کنی.\n` +
    `• وضعیت لینک: ${l.enabled ? 'روشن ✅' : 'خاموش ⛔'}`;
  return say(chatId, text, { reply_markup: ownerKeyboard(l), disable_web_page_preview: true });
}
async function statsText(ownerId) {
  const l = await linkOf(ownerId);
  if (!l) return 'هنوز لینکی نساخته‌ای. /anon';
  const day = now() - 86400000;
  const total = await db.$count(anonMessages, and(eq(anonMessages.ownerId, ownerId), eq(anonMessages.dir, 'in')));
  const last = await db.$count(anonMessages, and(eq(anonMessages.ownerId, ownerId), eq(anonMessages.dir, 'in'), gt(anonMessages.ts, day)));
  const people = await db.$count(anonAliases, eq(anonAliases.ownerId, ownerId));
  return `📊 آمار پیام ناشناس\nبازدید لینک: ${l.uses}\nفرستنده‌ها: ${people}\nپیام‌های دریافتی: ${total} (۲۴ ساعت اخیر: ${last})\n(آمار بعد از چند روز طبق تنظیم نگهداری پاک می‌شود.)`;
}

// ───────── کارهای مالک ─────────
async function ownerAction(from, chatId, action, st) {
  if (action === 'stats') return say(chatId, await statsText(from.id));
  const l = await ensureLink(from.id, fullName(from));
  if (action === 'toggle' || action === 'on' || action === 'off') {
    const enabled = action === 'toggle' ? !l.enabled : action === 'on';
    await db.update(anonLinks).set({ enabled }).where(eq(anonLinks.token, l.token)).run();
    return showLink(chatId, { ...l, enabled }, st);
  }
  if (action === 'new') {
    await db.delete(anonSessions).where(eq(anonSessions.token, l.token)).run();
    await db.delete(anonLinks).where(eq(anonLinks.token, l.token)).run();
    const nl = await ensureLink(from.id, fullName(from));
    await say(chatId, '🔄 لینک قبلی باطل شد و لینک جدید ساخته شد.');
    return showLink(chatId, nl, st);
  }
  return showLink(chatId, l, st);
}

// ───────── ارسال محتوا (بدون هیچ ردی از فرستنده) ─────────
async function relayContent(msg, toChat, header, keyboard, replyTo) {
  const extra = {};
  if (keyboard) extra.reply_markup = keyboard;
  if (replyTo) extra.reply_parameters = { message_id: replyTo, allow_sending_without_reply: true };
  if (msg.text) return api.sendMessage({ chat_id: toChat, text: `${header}\n\n${msg.text}`, ...extra });
  const info = describeMedia(msg);
  if (!info || !OK_TYPES.includes(info.type)) throw new Error('unsupported');
  if (info.type === 'sticker' || info.type === 'video_note') {
    await api.sendMessage({ chat_id: toChat, text: header });
    return api.copyMessage({ chat_id: toChat, from_chat_id: msg.chat.id, message_id: msg.message_id, ...extra });
  }
  const caption = clip(`${header}${msg.caption ? '\n\n' + msg.caption : ''}`, 1024);
  return api.copyMessage({ chat_id: toChat, from_chat_id: msg.chat.id, message_id: msg.message_id, caption, ...extra });
}
const supported = (msg) => !!msg.text || (() => { const i = describeMedia(msg); return !!(i && OK_TYPES.includes(i.type)); })();
async function ack(msg) {
  try { await api.setMessageReaction({ chat_id: msg.chat.id, message_id: msg.message_id, reaction: [{ type: 'emoji', emoji: '👍' }] }); }
  catch (e) { try { await say(msg.chat.id, '✅ ارسال شد'); } catch (e2) { /* ignore */ } }
}

// ───────── فرستنده ─────────
async function visitorStart(msg, token, st) {
  const from = msg.from; const chatId = msg.chat.id;
  const l = await db.select().from(anonLinks).where(eq(anonLinks.token, token)).get();
  if (!st.anon_enabled || !l || !l.enabled || (await isBlocked(l.ownerId, from.id))) return say(chatId, NA);
  if (l.ownerId === from.id) return say(chatId, 'این لینک خودته 😄 اون رو به بقیه بده تا برات ناشناس پیام بفرستن.\nبرای مدیریتش: /anon');
  await db.insert(anonSessions).values({ senderId: from.id, token, ts: now() })
    .onConflictDoUpdate({ target: anonSessions.senderId, set: { token, ts: now() } }).run();
  await db.update(anonLinks).set({ uses: (l.uses || 0) + 1 }).where(eq(anonLinks.token, token)).run();
  return say(chatId,
    `✍️ پیامت رو بنویس؛ به‌صورت ناشناس برای «${l.ownerName || 'صاحب لینک'}» فرستاده می‌شه.\n` +
    `متن، عکس، ویدیو، ویس، فایل و استیکر پشتیبانی می‌شه. برای خروج: /stop\n\n` +
    `ℹ️ هویت تو برای صاحب لینک نمایش داده نمی‌شه. فقط اگه پیامی گزارش بشه، ادمین ربات اون پیام و شناسه‌ی فرستنده‌اش رو می‌بینه.`);
}
async function visitorMessage(msg, session, st) {
  const from = msg.from; const chatId = msg.chat.id;
  const l = await db.select().from(anonLinks).where(eq(anonLinks.token, session.token)).get();
  if (!st.anon_enabled || !l || !l.enabled || (await isBlocked(l.ownerId, from.id))) {
    await db.delete(anonSessions).where(eq(anonSessions.senderId, from.id)).run();
    return say(chatId, NA);
  }
  if (!supported(msg)) return say(chatId, 'این نوع پیام پشتیبانی نمی‌شه. متن، عکس، ویدیو، ویس، فایل یا استیکر بفرست.');
  const limit = Math.max(1, Number(st.anon_rate_per_hour) || 30);
  const recent = await db.$count(anonMessages, and(eq(anonMessages.dir, 'in'), eq(anonMessages.senderId, from.id), gt(anonMessages.ts, now() - 3600000)));
  if (recent >= limit) return say(chatId, '⏳ سقف پیام این ساعت تموم شده؛ کمی بعد دوباره امتحان کن.');

  await purge(st);
  const n = await aliasFor(l.ownerId, from.id);
  const ref = randToken(10);
  const info = describeMedia(msg);
  const kind = info ? info.type : (msg.text ? 'text' : 'other');
  const bodyText = clip(msg.text || msg.caption || '', 2000);
  await db.insert(anonMessages).values({ ref, dir: 'in', ownerId: l.ownerId, senderId: from.id, text: bodyText, kind, ts: now() }).run();
  const kb = { inline_keyboard: [[{ text: '🚫 بلاک', callback_data: `ab:${ref}` }, { text: '🚩 گزارش', callback_data: `ar:${ref}` }]] };
  let sent;
  try { sent = await relayContent(msg, l.ownerId, `📩 ناشناس #${n}`, kb); }
  catch (e) {
    await db.delete(anonMessages).where(eq(anonMessages.ref, ref)).run();
    return say(chatId, '⚠️ پیام تحویل داده نشد (صاحب لینک الان در دسترس نیست).');
  }
  await db.update(anonMessages).set({ ownerMsgId: sent.message_id }).where(eq(anonMessages.ref, ref)).run();
  try { await bump('anon_in'); } catch (e) { /* ignore */ }
  await ack(msg);
}

// ───────── پاسخ مالک ─────────
async function ownerReply(msg, row, st) {
  const l = await linkOf(row.ownerId);
  const name = (l && l.ownerName) || 'صاحب لینک';
  try {
    await relayContent(msg, row.senderId, `💬 پاسخ از طرف ${name}`, null);
  } catch (e) {
    return say(msg.chat.id, e.message === 'unsupported' ? 'این نوع پیام پشتیبانی نمی‌شه.' : '⚠️ پاسخ تحویل داده نشد (فرستنده ربات رو متوقف کرده).');
  }
  const info = describeMedia(msg);
  await db.insert(anonMessages).values({
    ref: randToken(10), dir: 'out', ownerId: row.ownerId, senderId: row.senderId,
    text: clip(msg.text || msg.caption || '', 2000), kind: info ? info.type : (msg.text ? 'text' : 'other'), ts: now(),
  }).run();
  try { await bump('anon_out'); } catch (e) { /* ignore */ }
  await ack(msg);
}

// ───────── ثبت دلیل گزارش و ارسال به ادمین ─────────
async function finishReport(msg, ref) {
  const from = msg.from || {};
  const chatId = msg.chat.id;
  const row = await db.select().from(anonMessages).where(and(eq(anonMessages.ref, String(ref)), eq(anonMessages.ownerId, from.id))).get();
  if (!row) {
    await clearUiState(from.id);
    return say(chatId, 'این پیام دیگر در دسترس نیست.');
  }
  const reason = clip(String(msg.text || msg.caption || '').trim(), 1000);
  await clearUiState(from.id);
  if (!reason) return say(chatId, 'دلیل گزارش خالی بود. دوباره روی دکمهٔ 🚩 گزارش بزن.');
  const ins = await db.insert(anonReports).values({
    ref: String(ref), ownerId: row.ownerId, senderId: row.senderId, reason, status: 'open', ts: now(),
  }).returning({ id: anonReports.id });
  const reportId = ins && ins[0] ? ins[0].id : 0;
  const markup = {
    inline_keyboard: [[
      { text: '🗂 دیدن کل گفتگو', callback_data: `arv:${reportId}` },
      { text: '🚫 بلاک سراسری فرستنده', callback_data: `ag:${row.senderId}` },
    ]],
  };
  await alertAdmins(
    `🚩 گزارش پیام ناشناس\nمالک لینک: ${row.ownerId}\nفرستنده: ${row.senderId}\nدلیل: ${reason}`,
    { markup },
  );
  return say(chatId, '🚩 گزارش با دلیل ثبت شد و برای ادمین‌ها ارسال شد.');
}

// ───────── ورودی اصلی از handler پیام‌های خصوصی؛ true یعنی مصرف شد ─────────
export async function tryHandle(msg) {
  const from = msg.from;
  if (!from || from.is_bot || msg.chat.type !== 'private') return false;
  const st = await getSettings();
  const text = String(msg.text || '').trim();
  const first = text.split(/\s+/)[0];
  const cmd = first.split('@')[0].toLowerCase();
  const arg = text.slice(first.length).trim();
  const chatId = msg.chat.id;

  try {
    // اگر مالک در حال نوشتن دلیل گزارش است، همین پیام دلیل است.
    const draft = await getUiState(from.id);
    if (draft && draft.key === 'anon_report' && draft.value && text && !text.startsWith('/')) {
      await finishReport(msg, draft.value);
      return true;
    }

    if (cmd === '/start' && /^anon_[A-Za-z0-9]{8,40}$/.test(arg)) { await visitorStart(msg, arg.slice(5), st); return true; }

    if (cmd === '/anon') {
      if (!st.anon_enabled) { await say(chatId, 'قابلیت پیام ناشناس فعلاً خاموش است.'); return true; }
      const a = arg.toLowerCase();
      await ownerAction(from, chatId, ['on', 'off', 'new', 'stats'].includes(a) ? a : 'show', st);
      return true;
    }

    if (cmd === '/stop') {
      const s = await db.select().from(anonSessions).where(eq(anonSessions.senderId, from.id)).get();
      if (s) { await db.delete(anonSessions).where(eq(anonSessions.senderId, from.id)).run(); await say(chatId, 'از حالت پیام ناشناس خارج شدی.'); return true; }
      return false;
    }

    if (msg.reply_to_message && st.anon_enabled) {
      const row = await db.select().from(anonMessages).where(and(eq(anonMessages.ownerId, from.id), eq(anonMessages.ownerMsgId, msg.reply_to_message.message_id), eq(anonMessages.dir, 'in'))).get();
      if (row) { await ownerReply(msg, row, st); return true; }
    }

    if (!text.startsWith('/')) {
      const s = await db.select().from(anonSessions).where(eq(anonSessions.senderId, from.id)).get();
      if (s && st.anon_enabled) { await visitorMessage(msg, s, st); return true; }
    }
    return false;
  } catch (e) {
    // هیچ‌وقت نگذار پیام ناشناس به مسیر عادی (ذخیره در پنل) برگردد
    const ids = await adminIds();
    for (const id of ids) { try { await say(id, '⚠️ خطای پیام ناشناس: ' + clip(faError(e), 300)); } catch (e2) { /* ignore */ } }
    try { await say(chatId, '⚠️ خطایی رخ داد؛ کمی بعد دوباره امتحان کن.'); } catch (e2) { /* ignore */ }
    return true;
  }
}

// ───────── دکمه‌های inline: an: (مالک) · ab: بلاک · ar: گزارش · ag: بلاک سراسری (ادمین) ─────────
export async function anonCallback(cq) {
  const [act, arg] = String(cq.data || '').split(':');
  const uid = cq.from.id; const st = await getSettings();
  const answer = (text) => api.answerCallbackQuery({ callback_query_id: cq.id, text });
  const doneKb = (label) => { if (cq.message) return api.editMessageReplyMarkup({ chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [[{ text: label, callback_data: 'noop' }]] } }).catch(() => {}); };

  if (act === 'an') {
    if (!st.anon_enabled) return answer('قابلیت ناشناس خاموش است.');
    await answer('');
    return ownerAction(cq.from, cq.message ? cq.message.chat.id : uid, arg, st);
  }
  if (act === 'ab' || act === 'ar') {
    const row = await db.select().from(anonMessages).where(and(eq(anonMessages.ref, String(arg)), eq(anonMessages.ownerId, uid))).get();
    if (!row) return answer('این پیام دیگر در دسترس نیست.');
    if (act === 'ab') {
      await db.insert(anonBlocks).values({ key: `${uid}:${row.senderId}`, ownerId: uid, senderId: row.senderId, by: 'owner', ts: now() })
        .onConflictDoUpdate({ target: anonBlocks.key, set: { ts: now() } }).run();
      await answer('🚫 این فرستنده بلاک شد.'); return doneKb('🚫 بلاک شد');
    }
    // گزارش: دلیل را از مالک می‌پرسیم و کل گفتگو برای ادمین قابل مشاهده می‌شود.
    await setUiState(uid, 'anon_report', row.ref);
    await answer('دلیل گزارش را بنویس');
    return say(cq.message ? cq.message.chat.id : uid,
      '🚩 دلیل گزارش را در یک پیام بنویس تا همراه با کل گفتگو برای ادمین ارسال شود.\n(برای انصراف: /stop)');
  }
  if (act === 'arv') {
    if ((await memberRole(uid)) !== 'admin') return answer('فقط ادمین.');
    const r = await db.select().from(anonReports).where(eq(anonReports.id, Number(arg))).get();
    if (!r) return answer('گزارش پیدا نشد.');
    await answer('');
    const text = await conversationText(r.ownerId, r.senderId, r.reason);
    return sendLong(cq.message ? cq.message.chat.id : uid, text);
  }
  if (act === 'ag') {
    if ((await memberRole(uid)) !== 'admin') return answer('فقط ادمین.');
    const sid = Number(arg);
    if (!sid) return answer('نامعتبر');
    await db.insert(anonBlocks).values({ key: `0:${sid}`, ownerId: 0, senderId: sid, by: 'admin:' + uid, ts: now() })
      .onConflictDoUpdate({ target: anonBlocks.key, set: { ts: now() } }).run();
    await answer('🚫 فرستنده در کل ربات بلاک شد.'); return doneKb('🚫 بلاک سراسری شد');
  }
  return answer('');
}

async function conversationText(ownerId, senderId, reason = '') {
  const rows = await db.select().from(anonMessages)
    .where(and(eq(anonMessages.ownerId, ownerId), eq(anonMessages.senderId, senderId)))
    .orderBy(anonMessages.id).limit(200).all();
  let body = rows.map((m) => {
    const who = m.dir === 'in' ? '👤 ناشناس' : '🧑 مالک';
    return `${who}: ${m.text || (m.kind ? `[${m.kind}]` : '[بدون متن]')}`;
  }).join('\n');
  if (!body) body = '(متن گفتگو در دسترس نیست؛ احتمالاً قبل از این نسخه ثبت شده یا طبق نگهداری پاک شده است.)';
  return `🗂 کل گفتگوی ناشناس\nمالک: ${ownerId}\nفرستنده: ${senderId}\n` +
    (reason ? `دلیل گزارش: ${reason}\n` : '') + '\n' + body;
}

async function sendLong(chatId, text) {
  const body = String(text || '');
  for (let i = 0; i < body.length; i += 3800) {
    await say(chatId, body.slice(i, i + 3800));
  }
}
