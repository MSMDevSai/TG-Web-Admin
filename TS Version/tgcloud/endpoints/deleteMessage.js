import { api, db, EndpointError } from 'sdk';
import { eq } from 'sdk/db';
import { messages } from '../schema.js';
import { requireMember } from '../lib/auth.js';
import { findByTg, getChat } from '../lib/store.js';
import { now, faError } from '../lib/util.js';

// حذف در تلگرام (فقط ادمین). در پنل محتوا می‌مونه و فقط علامت «حذف‌شده» می‌خوره.
export default async function (input, ctx) {
  await requireMember(ctx, true);
  const chatId = Number(input.chatId), msgId = Number(input.msgId);
  const row = await findByTg(chatId, msgId);
  const chat = await getChat(chatId);
  if (!row || !chat) throw new EndpointError('پیام پیدا نشد.');
  if (row.deletedAt) return { ok: true };
  try {
    if (chat.bizId && (row.senderMode === 'me' || row.role === 'owner' || row.role === 'user')) {
      await api.deleteBusinessMessages({ business_connection_id: chat.bizId, message_ids: [msgId] });
    } else {
      await api.deleteMessage({ chat_id: chatId, message_id: msgId });
    }
  } catch (e) { throw new EndpointError(faError(e)); }
  await db.update(messages).set({ deletedAt: now(), deletedBy: 'panel' }).where(eq(messages.id, row.id)).run();
  return { ok: true };
}
