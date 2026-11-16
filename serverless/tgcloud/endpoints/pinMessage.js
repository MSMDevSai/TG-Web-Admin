import { api, db, EndpointError } from 'sdk';
import { eq } from 'sdk/db';
import { messages } from '../schema.js';
import { requireMember } from '../lib/auth.js';
import { findByTg, getChat } from '../lib/store.js';
import { now, faError } from '../lib/util.js';

// سنجاق پیام داخل چت. همه‌ی اعضا: سنجاق در پنل. ادمین: علاوه بر پنل، در خود تلگرام هم سنجاق می‌شود.
// اگر تلگرام قبول نکرد، سنجاق پنل می‌ماند و خطا برگردانده می‌شود (tgError).
export default async function (input, ctx) {
  const me = await requireMember(ctx);
  const chatId = Number(input.chatId), msgId = Number(input.msgId);
  const pin = input.pin !== false;
  const row = await findByTg(chatId, msgId);
  const chat = await getChat(chatId);
  if (!row || !chat) throw new EndpointError('پیام پیدا نشد.');

  await db.update(messages).set({ pinnedAt: pin ? now() : null }).where(eq(messages.id, row.id)).run();

  let tgError = null;
  if (me.role === 'admin' && input.telegram !== false) {
    const p = { chat_id: chatId, message_id: msgId };
    if (chat.bizId && !chat.isGroup) p.business_connection_id = chat.bizId;
    try {
      if (pin) await api.pinChatMessage({ ...p, disable_notification: true });
      else await api.unpinChatMessage(p);
    } catch (e) { tgError = faError(e); }
  }
  return { ok: true, pinned: pin, tgError };
}
