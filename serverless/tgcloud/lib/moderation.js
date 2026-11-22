import { api, db } from 'sdk';
import { desc, eq } from 'sdk/db';
import { botUsers, userBlocks, warnings, contactRequests, uiState } from '../schema.js';
import { now, clip, fullName } from './util.js';
import { alertAdmins } from './notify.js';
import { WEBAPP_URL } from './config.js';

const say = (chatId, text, extra) => api.sendMessage({ chat_id: chatId, text, ...(extra || {}) });

export function parseCmd(text) {
  const s = String(text || '').trim();
  const first = s.split(/\s+/)[0] || '';
  return { cmd: first.split('@')[0].toLowerCase(), arg: s.slice(first.length).trim() };
}

// ─── ثبت کاربرانی که به بات پیام داده‌اند (برای لیست مخاطبین پنل) ───
export async function recordBotUser(from, text) {
  if (!from || !from.id || from.is_bot) return;
  const id = Number(from.id);
  if (!id) return;
  const name = clip(fullName(from) || `کاربر ${id}`, 120);
  const username = clip(String(from.username || ''), 64);
  const last = clip(String(text || ''), 300);
  try {
    await db.insert(botUsers)
      .values({ tgId: id, name, username, lastText: last, firstSeen: now(), lastSeen: now() })
      .onConflictDoUpdate({
        target: botUsers.tgId,
        set: { name, username, lastText: last, lastSeen: now() },
      }).run();
  } catch (e) { /* آمار/فهرست نباید مسیر پیام را بشکند */ }
}

// ─── بلاک سراسری ───
export async function getBlock(tgId) {
  const id = Number(tgId);
  if (!id) return null;
  return (await db.select().from(userBlocks).where(eq(userBlocks.tgId, id)).get()) || null;
}

export async function setBlock(tgId, { reason = '', permanent = false, by = '' } = {}) {
  const id = Number(tgId);
  if (!id) throw new Error('آیدی نامعتبر');
  await db.insert(userBlocks)
    .values({ tgId: id, reason: clip(String(reason || ''), 500), permanent: !!permanent, by: String(by || ''), ts: now() })
    .onConflictDoUpdate({
      target: userBlocks.tgId,
      set: { reason: clip(String(reason || ''), 500), permanent: !!permanent, by: String(by || ''), ts: now() },
    }).run();
  return await getBlock(id);
}

export async function removeBlock(tgId) {
  await db.delete(userBlocks).where(eq(userBlocks.tgId, Number(tgId))).run();
}

export function blockedMessage(block) {
  if (!block) return '';
  if (block.permanent) return '⛔ شما به‌طور قطعی از این ربات مسدود شده‌اید.';
  const why = String(block.reason || '').trim();
  return '⛔ شما از این ربات مسدود شده‌اید.' +
    (why ? `\nدلیل: ${why}` : '') +
    '\n\nاگر فکر می‌کنید خطایی رخ داده، با دستور\n/contact <متن پیام>\nدرخواستتان را برای ادمین بفرستید.';
}

// اگر کاربر بلاک باشد، پیام مناسب را می‌فرستد و true برمی‌گرداند.
export async function handleBlockedMessage(msg, block) {
  const text = String(msg.text || '').trim();
  const { cmd } = parseCmd(text);
  if (cmd === '/contact' || cmd === '/appeal') {
    await takeContact(msg, block);
    return true;
  }
  try { await say(msg.chat.id, blockedMessage(block)); } catch (e) { /* ignore */ }
  return true;
}

// درخواست تماس/اعتراض؛ برای کاربر بلاک‌شده و کاربر عادی.
export async function takeContact(msg, block = null) {
  const from = msg.from || {};
  const { cmd, arg } = parseCmd(msg.text);
  const isContact = cmd === '/contact' || cmd === '/appeal';
  if (!isContact) return false;

  if (block && block.permanent) {
    try { await say(msg.chat.id, '⛔ شما به‌طور قطعی از این ربات مسدود شده‌اید.'); } catch (e) { /* ignore */ }
    return true;
  }
  const text = clip(String(arg || '').trim(), 2000);
  if (!text) {
    try { await say(msg.chat.id, 'متن درخواستت را بعد از دستور بنویس. مثال:\n/contact سلام، فکر می‌کنم اشتباهی مسدود شدم.'); } catch (e) { /* ignore */ }
    return true;
  }

  const id = Number(from.id) || Number(msg.chat.id);
  const name = fullName(from) || `کاربر ${id}`;
  await db.insert(contactRequests).values({
    tgId: id, name: clip(name, 120), text, kind: block ? 'appeal' : 'contact', handled: false, ts: now(),
  }).run();

  const head = block ? '📨 اعتراض به مسدودسازی' : '📨 درخواست تماس';
  const why = block && block.reason ? `\nدلیل بلاک: ${block.reason}` : '';
  const markup = WEBAPP_URL
    ? { inline_keyboard: [[{ text: '📱 دیدن در پنل', web_app: { url: `${WEBAPP_URL}?settings=admin` } }]] }
    : null;
  await alertAdmins(
    `${head}\nاز: ${name}\nآیدی: ${id}${why}\n\n${text}`,
    { markup },
  );

  try {
    await say(msg.chat.id, block
      ? '✅ درخواست اعتراضت ثبت شد و برای ادمین فرستاده شد.'
      : '✅ پیامت برای ادمین فرستاده شد. اگر لازم باشد پاسخ می‌دهد.');
  } catch (e) { /* ignore */ }
  return true;
}

// ─── اخطار ───
export async function warnUser(tgId, reason, by = {}) {
  const id = Number(tgId);
  const why = clip(String(reason || '').trim(), 500) || 'رعایت قوانین ربات';
  if (!id) return { ok: false, sent: false, error: 'آیدی نامعتبر' };
  let sent = true;
  try {
    await say(id, `⚠️ اخطار\nدلیل: ${why}\n\nلطفاً قوانین را رعایت کن؛ تکرار باعث مسدود شدن می‌شود.`);
  } catch (e) { sent = false; }
  await db.insert(warnings).values({
    tgId: id, reason: why, byId: Number(by.id) || null, byName: clip(String(by.name || ''), 120), ts: now(),
  }).run();
  return { ok: true, sent };
}

export async function listWarnings(tgId, limit = 20) {
  return await db.select().from(warnings)
    .where(eq(warnings.tgId, Number(tgId)))
    .orderBy(desc(warnings.id)).limit(Math.min(100, Math.max(1, Number(limit) || 20))).all();
}

// ─── فیلتر کلمات ممنوعه ───
export function filterWords(st) {
  return String((st && st.banned_words) || '')
    .split(/[\n,،;]+/).map((w) => w.trim()).filter(Boolean).slice(0, 300);
}

export async function filterHit(text, st) {
  if (!st || !st.filter_enabled) return null;
  const body = String(text || '').toLowerCase();
  if (!body) return null;
  for (const w of filterWords(st)) {
    if (w && body.includes(w.toLowerCase())) return w;
  }
  return null;
}

export async function handleFilterHit(msg, word) {
  const from = msg.from || {};
  const id = Number(from.id) || Number(msg.chat.id);
  const name = fullName(from) || `کاربر ${id}`;
  const reason = `استفاده از کلمهٔ ممنوعه «${word}»`;
  try { await warnUser(id, reason, { id: 0, name: 'فیلتر خودکار' }); } catch (e) { /* ignore */ }
  await alertAdmins(`🚫 پیام فیلترشده\nاز: ${name}\nآیدی: ${id}\nکلمه: ${word}\n\n${clip(msg.text || msg.caption || '', 500)}`);
}

// ═══════════════════════════════════════════════════════════════
//  ورودی‌های موقت ادمین در ربات (منتظر دلیل بلاک/اخطار/متن پیام)
//  در handlers/message.js قبل از پردازش عادی مصرف می‌شوند.
// ═══════════════════════════════════════════════════════════════
export async function getUiState(tgId) {
  return (await db.select().from(uiState).where(eq(uiState.tgId, Number(tgId))).get()) || null;
}

export async function setUiState(tgId, key, value = '') {
  await db.insert(uiState).values({ tgId: Number(tgId), key: String(key), value: String(value || ''), ts: now() })
    .onConflictDoUpdate({ target: uiState.tgId, set: { key: String(key), value: String(value || ''), ts: now() } }).run();
}

export async function clearUiState(tgId) {
  await db.delete(uiState).where(eq(uiState.tgId, Number(tgId))).run();
}
