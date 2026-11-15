import { api, db, EndpointError } from 'sdk';
import { eq } from 'sdk/db';
import { messages, edits } from '../schema.js';
import { requireMember } from '../lib/auth.js';
import { findByTg, getChat } from '../lib/store.js';
import { now, faError } from '../lib/util.js';

// ویرایش پیامی که از طرف ما رفته (متن قبلی در تاریخچه می‌مونه)
export default async function (input, ctx) {
  await requireMember(ctx);
  const chatId = Number(input.chatId), msgId = Number(input.msgId);
  const text = String(input.text || '').trim();
  if (!text) throw new EndpointError('متن خالی است.');
  const row = await findByTg(chatId, msgId);
  const chat = await getChat(chatId);
  if (!row || !chat) throw new EndpointError('پیام پیدا نشد.');
  if (row.role === 'user') throw new EndpointError('پیام مخاطب قابل ویرایش نیست.');

  const p = { chat_id: chatId, message_id: msgId };
  if (row.senderMode === 'me' || row.role === 'owner') {
    if (!chat.bizId) throw new EndpointError('اتصال بیزینسی این چت موجود نیست.');
    p.business_connection_id = chat.bizId;
  }
  try {
    if (row.type && row.type !== 'sticker') await api.editMessageCaption({ ...p, caption: text });
    else await api.editMessageText({ ...p, text });
  } catch (e) { throw new EndpointError(faError(e)); }

  const ts = now();
  await db.insert(edits).values({ chatId, msgId, oldText: row.text, ts }).run();
  await db.update(messages).set({ text, editedAt: ts }).where(eq(messages.id, row.id)).run();
  return { ok: true };
}
