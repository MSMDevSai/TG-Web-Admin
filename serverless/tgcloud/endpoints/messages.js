import { db, EndpointError } from 'sdk';
import { and, eq, lt, gt, desc, asc, isNotNull } from 'sdk/db';
import { messages, reads } from '../schema.js';
import { requireMember } from '../lib/auth.js';
import { assertCanSee } from '../lib/scope.js';
import { getChat } from '../lib/store.js';
import { now } from '../lib/util.js';

// صفحه‌ای از پیام‌های یک چت. filter: undefined | 'media' | 'deleted'
export default async function (input, ctx) {
  const me = await requireMember(ctx);
  const chatId = Number(input.chatId);
  const chat = await getChat(chatId);
  if (!chat) throw new EndpointError('چت پیدا نشد.');
  assertCanSee(me, chat);

  const limit = Math.min(Math.max(Number(input.limit) || 60, 1), 200);
  const conds = [eq(messages.chatId, chatId)];
  if (input.filter === 'deleted') conds.push(isNotNull(messages.deletedAt));
  if (input.filter === 'media') conds.push(isNotNull(messages.type));
  if (input.beforeId) conds.push(lt(messages.id, Number(input.beforeId)));

  let rows, hasMoreOlder = false, hasMoreNewer = false;
  if (input.aroundId) {
    // پرش به یک پیام (از نتیجه‌ی جستجو): ۴۰ پیام قبل و ۴۰ پیام بعد.
    // فیلتر این‌جا اعمال نمی‌شود تا خودِ پیامِ هدف همیشه در خروجی باشد.
    const aid = Number(input.aroundId);
    const before = await db.select().from(messages).where(and(eq(messages.chatId, chatId), lt(messages.id, aid)))
      .orderBy(desc(messages.id)).limit(41).all();
    const after = await db.select().from(messages).where(and(eq(messages.chatId, chatId), gt(messages.id, aid - 1)))
      .orderBy(asc(messages.id)).limit(42).all();
    hasMoreOlder = before.length > 40;
    hasMoreNewer = after.length > 41;
    rows = [...before.slice(0, 40).reverse(), ...after.slice(0, 41)];
  } else {
    rows = (await db.select().from(messages).where(and(...conds)).orderBy(desc(messages.id)).limit(limit).all()).reverse();
    hasMoreOlder = rows.length === limit;
  }
  const pinRow = await db.select().from(messages).where(and(eq(messages.chatId, chatId), isNotNull(messages.pinnedAt))).orderBy(desc(messages.pinnedAt), desc(messages.id)).limit(1).get();

  if (!input.filter && !input.beforeId && !input.aroundId && rows.length) {
    const lastId = rows[rows.length - 1].id;
    const key = `${me.id}:${chatId}`;
    await db.insert(reads).values({ key, tgId: me.id, chatId, lastId })
      .onConflictDoUpdate({ target: reads.key, set: { lastId } }).run();
  }

  return {
    chat: { id: chat.id, title: chat.title, isGroup: chat.isGroup, kind: chat.kind, business: !!chat.bizId, direct: chat.hasBotChat,
      ownerId: chat.ownerId || null, ownerName: chat.ownerName || '',
      muted: chat.muted, pinned: chat.pinned, aiMode: chat.aiMode, prompt: me.role === 'admin' ? chat.prompt : undefined,
      aiPending: chat.aiPendingUntil > now() },
    hasMore: hasMoreOlder, hasMoreNewer, around: !!input.aroundId,
    pinned: pinRow ? { id: pinRow.id, msgId: pinRow.msgId, text: String(pinRow.text || '').slice(0, 120), sender: pinRow.sender, type: pinRow.type } : null,
    messages: rows.map((r) => ({
      id: r.id, msgId: r.msgId, role: r.role, sender: r.sender, text: r.text, type: r.type, mediaKey: r.mediaKey,
      replyTo: r.replyToMsgId, replyPreview: r.replyPreview, fwd: r.forwardedFrom,
      myReaction: r.myReaction, theirReaction: r.theirReaction, mode: r.senderMode,
      ts: r.ts, editedAt: r.editedAt, deletedAt: r.deletedAt, deletedBy: r.deletedBy, pinnedAt: r.pinnedAt,
      senderId: me.role === 'admin' && r.role === 'user' ? r.senderId : undefined,
    })),
  };
}
