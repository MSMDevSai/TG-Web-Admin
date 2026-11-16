import { api, db, EndpointError } from 'sdk';
import { and, eq, inArray } from 'sdk/db';
import { messages } from '../schema.js';
import { requireMember } from '../lib/auth.js';
import { getChat } from '../lib/store.js';
import { now, faError } from '../lib/util.js';

// حذف گروهیِ چند پیام (فقط ادمین). در تلگرام پاک می‌شود، در پنل محفوظ می‌ماند و فقط 🗑 می‌خورد.
export default async function (input, ctx) {
  const me = await requireMember(ctx, true);
  const chat = await getChat(Number(input.chatId));
  if (!chat) throw new EndpointError('چت پیدا نشد.');
  const ids = [...new Set((Array.isArray(input.msgIds) ? input.msgIds : []).map(Number))].filter(Boolean).slice(0, 200);
  if (!ids.length) throw new EndpointError('پیامی انتخاب نشده.');
  const rows = (await db.select().from(messages).where(and(eq(messages.chatId, chat.id), inArray(messages.msgId, ids))).all()).filter((r) => !r.deletedAt);
  if (!rows.length) return { ok: true, deleted: 0 };
  const business = chat.bizId && !chat.isGroup;
  try {
    for (let i = 0; i < rows.length; i += 100) {
      const part = rows.slice(i, i + 100).map((r) => r.msgId);
      if (business) await api.deleteBusinessMessages({ business_connection_id: chat.bizId, message_ids: part });
      else await api.deleteMessages({ chat_id: chat.id, message_ids: part });
    }
  } catch (e) { throw new EndpointError(faError(e)); }
  await db.update(messages).set({ deletedAt: now(), deletedBy: 'panel' }).where(and(eq(messages.chatId, chat.id), inArray(messages.msgId, rows.map((r) => r.msgId)))).run();
  return { ok: true, deleted: rows.length };
}
