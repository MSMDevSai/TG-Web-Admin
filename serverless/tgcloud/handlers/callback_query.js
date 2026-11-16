import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { chats } from '../schema.js';
import { memberRole } from '../lib/store.js';
import { chatKeyboard } from '../lib/notify.js';
import { anonCallback } from '../lib/anon.js';

// دکمه‌های زیر اعلان‌ها: بی‌صدا/باز کردن اعلان یک چت
export default async function (cq) {
  const kind = String(cq.data || '').split(':')[0];
  if (['an', 'ab', 'ar', 'ag', 'noop'].includes(kind)) { await anonCallback(cq); return; }   // دکمه‌های پیام ناشناس (برای همه، نه فقط اعضا)
  const role = await memberRole(cq.from.id);
  if (!role) { await api.answerCallbackQuery({ callback_query_id: cq.id, text: 'دسترسی نداری.' }); return; }
  const [act, arg] = String(cq.data || '').split(':');
  const chatId = Number(arg);
  if ((act === 'mute' || act === 'unmute') && chatId) {
    const muted = act === 'mute';
    await db.update(chats).set({ muted }).where(eq(chats.id, chatId)).run();
    await api.answerCallbackQuery({ callback_query_id: cq.id, text: muted ? '🔕 اعلان این چت بسته شد' : '🔔 اعلان این چت باز شد' });
    if (cq.message) {
      try { await api.editMessageReplyMarkup({ chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: chatKeyboard(chatId, muted) }); } catch (e) { /* ignore */ }
    }
    return;
  }
  await api.answerCallbackQuery({ callback_query_id: cq.id });
}
