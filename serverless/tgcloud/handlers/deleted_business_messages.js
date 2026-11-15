import { db } from 'sdk';
import { and, eq, inArray } from 'sdk/db';
import { messages } from '../schema.js';
import { getChat, getSettings } from '../lib/store.js';
import { notifyMembers } from '../lib/notify.js';
import { now, clip } from '../lib/util.js';

// مخاطب (یا خودت) پیام پاک کرد → محتوا می‌مونه و فقط علامت «حذف‌شده» می‌خوره
export default async function (upd) {
  const chatId = upd.chat.id;
  const ids = upd.message_ids || [];
  if (!ids.length) return;
  const rows = await db.select().from(messages)
    .where(and(eq(messages.chatId, chatId), inArray(messages.msgId, ids))).all();
  const fresh = rows.filter((r) => !r.deletedAt);
  if (!fresh.length) return;
  await db.update(messages).set({ deletedAt: now(), deletedBy: 'contact' })
    .where(and(eq(messages.chatId, chatId), inArray(messages.msgId, ids))).run();

  const st = await getSettings();
  if (!st.notify_deleted) return;
  const theirs = fresh.filter((r) => r.role === 'user');
  if (!theirs.length) return;
  const chat = await getChat(chatId);
  if (!chat) return;
  const body = theirs.map((r) => clip(r.text, 300)).join('\n— ');
  await notifyMembers(`🗑 ${chat.title} پیامی را پاک کرد (در پنل محفوظ است):\n${body}`, { chat });
}
