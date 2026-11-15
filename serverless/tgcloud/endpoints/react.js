import { api, db, EndpointError } from 'sdk';
import { eq } from 'sdk/db';
import { messages } from '../schema.js';
import { requireMember } from '../lib/auth.js';
import { findByTg } from '../lib/store.js';
import { faError } from '../lib/util.js';

export default async function (input, ctx) {
  await requireMember(ctx);
  const chatId = Number(input.chatId), msgId = Number(input.msgId);
  const row = await findByTg(chatId, msgId);
  if (!row) throw new EndpointError('پیام پیدا نشد.');
  const emoji = String(input.emoji || '');
  try {
    await api.setMessageReaction({ chat_id: chatId, message_id: msgId, reaction: emoji ? [{ type: 'emoji', emoji }] : [] });
  } catch (e) { throw new EndpointError(faError(e)); }
  await db.update(messages).set({ myReaction: emoji || null }).where(eq(messages.id, row.id)).run();
  return { ok: true };
}
