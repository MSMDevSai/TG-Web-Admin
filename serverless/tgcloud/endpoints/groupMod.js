import { api, db, EndpointError } from 'sdk';
import { and, eq, desc, isNull, isNotNull } from 'sdk/db';
import { messages, modLog } from '../schema.js';
import { requireMember } from '../lib/auth.js';
import { getChat } from '../lib/store.js';
import { now, faError } from '../lib/util.js';

// مدیریت گروه (فقط ادمین پنل؛ ربات هم باید در گروه ادمین باشد): ban | kick | unban | mute | unmute | deleteUser | log
const NONE = { can_send_messages: false, can_send_audios: false, can_send_documents: false, can_send_photos: false, can_send_videos: false,
  can_send_video_notes: false, can_send_voice_notes: false, can_send_polls: false, can_send_other_messages: false, can_add_web_page_previews: false };
const SEND_ALL = Object.fromEntries(Object.keys(NONE).map((k) => [k, true]));

async function log(chat, me, action, userId, name, extra) {
  await db.insert(modLog).values({ chatId: chat.id, targetId: userId || null, targetName: name || '', action, untilTs: extra && extra.until || null,
    count: extra && extra.count || null, byId: me.id, byName: me.name, ts: now() }).run();
}

export default async function (input, ctx) {
  const me = await requireMember(ctx, true);
  const chat = await getChat(Number(input.chatId));
  if (!chat) throw new EndpointError('چت پیدا نشد.');
  if (!chat.isGroup) throw new EndpointError('این بخش فقط برای گروه‌هاست.');
  const op = String(input.op || '');
  const userId = Number(input.userId);
  const name = String(input.name || '').slice(0, 60);

  if (op === 'log') {
    const rows = await db.select().from(modLog).where(eq(modLog.chatId, chat.id)).orderBy(desc(modLog.id)).limit(30).all();
    return { log: rows.map((r) => ({ action: r.action, targetId: r.targetId, targetName: r.targetName, untilTs: r.untilTs, count: r.count, by: r.byName, ts: r.ts })) };
  }
  if (!Number.isInteger(userId) || userId <= 0) throw new EndpointError('کاربر نامعتبر است.');

  try {
    if (op === 'ban') {
      await api.banChatMember({ chat_id: chat.id, user_id: userId, revoke_messages: !!input.revoke });
      await log(chat, me, 'ban', userId, name);
    } else if (op === 'kick') {
      await api.banChatMember({ chat_id: chat.id, user_id: userId });
      await api.unbanChatMember({ chat_id: chat.id, user_id: userId, only_if_banned: true });
      await log(chat, me, 'kick', userId, name);
    } else if (op === 'unban') {
      await api.unbanChatMember({ chat_id: chat.id, user_id: userId, only_if_banned: true });
      await log(chat, me, 'unban', userId, name);
    } else if (op === 'mute') {
      const minutes = Math.max(0, Math.min(Number(input.minutes) || 0, 60 * 24 * 366));
      const p = { chat_id: chat.id, user_id: userId, permissions: NONE };
      let until = null;
      if (minutes > 0) { until = now() + minutes * 60000; p.until_date = Math.floor(until / 1000); }
      await api.restrictChatMember(p);
      await log(chat, me, 'mute', userId, name, { until });
    } else if (op === 'unmute') {
      let perms = SEND_ALL;
      try { const c = await api.getChat({ chat_id: chat.id }); if (c && c.permissions) perms = c.permissions; } catch (e) { /* از مجوزهای پیش‌فرض استفاده می‌شود */ }
      await api.restrictChatMember({ chat_id: chat.id, user_id: userId, permissions: perms });
      await log(chat, me, 'unmute', userId, name);
    } else if (op === 'deleteUser') {
      // آخرین ۳۰۰ پیامِ ثبت‌شده‌ی این کاربر در این گروه (محدودیت تلگرام: پیام‌های قدیمی‌تر از ۴۸ ساعت ممکن است حذف نشوند)
      const rows = await db.select().from(messages).where(and(eq(messages.chatId, chat.id), eq(messages.senderId, userId), eq(messages.role, 'user'), isNull(messages.deletedAt), isNotNull(messages.msgId)))
        .orderBy(desc(messages.id)).limit(300).all();
      let deleted = 0;
      for (let i = 0; i < rows.length; i += 100) {
        const part = rows.slice(i, i + 100);
        await api.deleteMessages({ chat_id: chat.id, message_ids: part.map((r) => r.msgId) });
        for (const r of part) await db.update(messages).set({ deletedAt: now(), deletedBy: 'panel' }).where(eq(messages.id, r.id)).run();
        deleted += part.length;
      }
      await log(chat, me, 'delete_user', userId, name, { count: deleted });
      return { ok: true, deleted };
    } else throw new EndpointError('عملیات نامعتبر.');
  } catch (e) {
    if (e instanceof EndpointError) throw e;
    throw new EndpointError(faError(e));
  }
  return { ok: true };
}
