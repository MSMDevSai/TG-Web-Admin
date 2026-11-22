import { db, EndpointError } from 'sdk';
import { and, eq, inArray, isNotNull, isNull, desc } from 'sdk/db';
import { messages } from '../schema.js';
import { requireMember } from '../lib/auth.js';
import { assertCanSee } from '../lib/scope.js';
import { getChat } from '../lib/store.js';

// رسانه‌های مشترک یک چت، گروه‌بندی‌شده برای تب‌های مودل پروفایل.
// فقط رکوردهایی که بایت‌هایشان (mediaKey) در دسترس است، قابل نمایش‌اند.
const TYPES = ['photo', 'video', 'voice', 'document', 'animation'];
const CAP = 60;

export default async function (input, ctx) {
  const me = await requireMember(ctx);

  const chatId = Number(input.chatId);
  if (!Number.isInteger(chatId) || chatId === 0) throw new EndpointError('شناسه‌ی چت الزامی است.', { code: 'NO_CHAT' });
  assertCanSee(me, await getChat(chatId));

  const limit = Math.min(Math.max(Number(input.limit) || 240, 1), 400);
  const rows = await db.select().from(messages)
    .where(and(
      eq(messages.chatId, chatId),
      inArray(messages.type, TYPES),
      isNotNull(messages.mediaKey),
      isNull(messages.deletedAt),
    ))
    .orderBy(desc(messages.id))
    .limit(limit).all();

  const out = {};
  for (const t of TYPES) out[t] = [];
  for (const r of rows) {
    const bucket = out[r.type];
    if (!bucket || bucket.length >= CAP) continue;
    bucket.push({
      id: r.id,
      msgId: r.msgId,
      type: r.type,
      fileId: r.fileId || '',
      mediaKey: r.mediaKey,
      text: r.text || '',
      ts: r.ts || 0,
    });
  }
  return out;
}
