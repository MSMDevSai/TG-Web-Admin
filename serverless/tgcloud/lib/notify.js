import { api } from 'sdk';
import { recipients, getSettings } from './store.js';
import { ownerOf } from './scope.js';
import { WEBAPP_URL } from './config.js';
import { clip } from './util.js';
import { bump } from './stats.js';

export function chatKeyboard(chatId, muted) {
  const row = [{ text: muted ? '🔔 باز کردن اعلان این چت' : '🔕 بستن اعلان این چت', callback_data: (muted ? 'unmute:' : 'mute:') + chatId }];
  const rows = [row];
  if (WEBAPP_URL) rows.push([{ text: '📱 باز کردن در پنل', web_app: { url: `${WEBAPP_URL}${WEBAPP_URL.includes('?') ? '&' : '?'}chat=${chatId}` } }]);
  return { inline_keyboard: rows };
}

// اعلان تلگرامی به اعضا (با رعایت سوییچ کلی، سوییچ هر عضو و بی‌صدا بودن چت)
// اعلان هر چت فقط برای صاحب همان چت (و ادمین‌ها که همه را می‌بینند) می‌رود؛
// وگرنه پیام‌های یک نفر برای بقیه لو می‌رفت.
export async function notifyMembers(text, { chat, silentChat = false, plain = true } = {}) {
  const st = await getSettings();
  if (!st.notify_enabled) return;
  if (chat && chat.muted && !silentChat) return;
  const ownerId = chat ? ownerOf(chat) : null;
  const list = await recipients();
  for (const m of list) {
    if (!m.notify) continue;
    if (chat && ownerId && m.role !== 'admin' && Number(m.tgId) !== Number(ownerId)) continue;
    try {
      const p = { chat_id: m.tgId, text: clip(text, 3500) };
      if (chat) p.reply_markup = chatKeyboard(chat.id, !!chat.muted);
      await api.sendMessage(p);
    } catch (e) { /* عضو هنوز /start نزده یا ربات رو بلاک کرده؛ مهم نیست */ }
  }
}

// مقصدهای هشدار ادمین: پیوی همه‌ی ادمین‌ها + گروه ادمین (اگر تنظیم شده باشد).
// برخلاف اعلان‌های عادی، این‌ها به سوییچ اعلان هر عضو کاری ندارند تا خطا/گزارش
// هیچ‌وقت از دست ادمین نرود.
export async function adminTargets() {
  const ids = (await recipients()).filter((m) => m.role === 'admin').map((m) => Number(m.tgId)).filter(Boolean);
  const st = await getSettings();
  const group = Number(st.admin_group_id) || 0;
  const out = [];
  const seen = new Set();
  for (const id of [...ids, group]) {
    if (!id || seen.has(id)) continue;
    seen.add(id); out.push(id);
  }
  return out;
}

// خطا/هشدار/گزارش فقط برای ادمین‌ها؛ به گروه ادمین هم (در صورت وجود).
// opts.error = این پیام یک خطای واقعی است و در آمار «خطای کل» ثبت شود.
export async function alertAdmins(text, { error = false, markup = null } = {}) {
  if (error) { try { await bump('errors_total'); } catch (e) { /* ignore */ } }
  const body = clip('⚠️ ' + text, 3500);
  for (const id of await adminTargets()) {
    try {
      const p = { chat_id: id, text: body };
      if (markup) p.reply_markup = markup;
      await api.sendMessage(p);
    } catch (e) { /* ignore */ }
  }
}
