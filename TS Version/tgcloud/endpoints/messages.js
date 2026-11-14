import { db, EndpointError } from 'sdk';
import { and, eq, lt, desc, isNotNull } from 'sdk/db';
import { messages, reads } from '../schema.js';
import { requireMember } from '../lib/auth.js';
import { getChat } from '../lib/store.js';
import { now } from '../lib/util.js';

// صفحه‌ای از پیام‌های یک چت. filter: undefined | 'media' | 'deleted'
export default async function (input, ctx) {
  const me = await requireMember(ctx);
  const chatId = Number(input.chatId);
  const chat = await getChat(chatId);
  if (!chat) throw new EndpointError('چت پیدا نشد.');

  const limit = Math.min(Math.max(Number(input.limit) || 60, 1), 200);
  const conds = [eq(messages.chatId, chatId)];
  if (input.filter === 'deleted') conds.push(isNotNull(messages.deletedAt));
  if (input.filter === 'media') conds.push(isNotNull(messages.type));
  if (input.beforeId) conds.push(lt(messages.id, Number(input.beforeId)));

  const rows = (await db.select().from(messages).where(and(...conds)).orderBy(desc(messages.id)).limit(limit).all()).reverse();

  if (!input.filter && !input.beforeId && rows.length) {
    const lastId = rows[rows.length - 1].id;
    const key = `${me.id}:${chatId}`;
    await db.insert(reads).values({ key, tgId: me.id, chatId, lastId })
      .onConflictDoUpdate({ target: reads.key, set: { lastId } }).run();
  }

  return {
    chat: { id: chat.id, title: chat.title, isGroup: chat.isGroup, business: !!chat.bizId, direct: chat.hasBotChat,
      muted: chat.muted, pinned: chat.pinned, aiMode: chat.aiMode, prompt: me.role === 'admin' ? chat.prompt : undefined,
      aiPending: chat.aiPendingUntil > now() },
    hasMore: rows.length === limit,
    messages: rows.map((r) => ({
      id: r.id, msgId: r.msgId, role: r.role, sender: r.sender, text: r.text, type: r.type, mediaKey: r.mediaKey,
      replyTo: r.replyToMsgId, replyPreview: r.replyPreview, fwd: r.forwardedFrom,
      myReaction: r.myReaction, theirReaction: r.theirReaction, mode: r.senderMode,
      ts: r.ts, editedAt: r.editedAt, deletedAt: r.deletedAt, deletedBy: r.deletedBy,
    })),
  };
}
