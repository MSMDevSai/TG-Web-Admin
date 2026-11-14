import { api } from 'sdk';
import { recipients, getSettings } from './store.js';
import { WEBAPP_URL } from './config.js';
import { clip } from './util.js';

export function chatKeyboard(chatId, muted) {
  const row = [{ text: muted ? '🔔 باز کردن اعلان این چت' : '🔕 بستن اعلان این چت', callback_data: (muted ? 'unmute:' : 'mute:') + chatId }];
  const rows = [row];
  if (WEBAPP_URL) rows.push([{ text: '📱 باز کردن در پنل', web_app: { url: `${WEBAPP_URL}${WEBAPP_URL.includes('?') ? '&' : '?'}chat=${chatId}` } }]);
  return { inline_keyboard: rows };
}

// اعلان تلگرامی به اعضا (با رعایت سوییچ کلی، سوییچ هر عضو و بی‌صدا بودن چت)
export async function notifyMembers(text, { chat, silentChat = false, plain = true } = {}) {
  const st = await getSettings();
  if (!st.notify_enabled) return;
  if (chat && chat.muted && !silentChat) return;
  const list = await recipients();
  for (const m of list) {
    if (!m.notify) continue;
    try {
      const p = { chat_id: m.tgId, text: clip(text, 3500) };
      if (chat) p.reply_markup = chatKeyboard(chat.id, !!chat.muted);
      await api.sendMessage(p);
    } catch (e) { /* عضو هنوز /start نزده یا ربات رو بلاک کرده؛ مهم نیست */ }
  }
}

// خطا/هشدار فقط برای ادمین‌ها، بدون توجه به بی‌صدا بودن
export async function alertAdmins(text) {
  const st = await getSettings();
  const list = (await recipients()).filter((m) => m.role === 'admin');
  for (const m of list) {
    try { await api.sendMessage({ chat_id: m.tgId, text: clip('⚠️ ' + text, 3500) }); } catch (e) { /* ignore */ }
  }
  if (st.admin_group_id) {
    try { await api.sendMessage({ chat_id: Number(st.admin_group_id), text: clip('⚠️ ' + text, 3500) }); } catch (e) { /* ignore */ }
  }
}
