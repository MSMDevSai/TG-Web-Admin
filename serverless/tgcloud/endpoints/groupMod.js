import { api, db, EndpointError } from 'sdk';
import { and, eq, desc, isNull, isNotNull } from 'sdk/db';
import { messages, modLog } from '../schema.js';
import { requireMember } from '../lib/auth.js';
import { assertCanSee } from '../lib/scope.js';
import { getChat, getSettings, saveSettings, touchChat } from '../lib/store.js';
import { b64encode } from '../lib/b64.js';
import { mimeOf } from '../lib/media.js';
import { now, faError } from '../lib/util.js';

// مدیریت گروه (ربات هم باید در گروه ادمین باشد): ban | kick | unban | mute | unmute |
// deleteUser | deleteBulk | info | members | filter | filterGet | log | owner
// عملیات مخرب فقط برای ادمین‌های پنل؛ صاحب گروه (عضو عادی) فقط اطلاعات/فیلتر/مالکیت را می‌بیند.
const MEMBER_OPS = ['info', 'members', 'filterGet', 'filter', 'log', 'owner'];
const NONE = { can_send_messages: false, can_send_audios: false, can_send_documents: false, can_send_photos: false, can_send_videos: false,
  can_send_video_notes: false, can_send_voice_notes: false, can_send_polls: false, can_send_other_messages: false, can_add_web_page_previews: false };
const SEND_ALL = Object.fromEntries(Object.keys(NONE).map((k) => [k, true]));
const FILTER_KEYS = ['sticker', 'gif', 'voice', 'video', 'photo', 'file', 'link', 'song'];
const filterKey = (chatId) => 'group_filter_' + chatId;

async function log(chat, me, action, userId, name, extra) {
  await db.insert(modLog).values({ chatId: chat.id, targetId: userId || null, targetName: name || '', action, untilTs: extra && extra.until || null,
    count: extra && extra.count || null, byId: me.id, byName: me.name, ts: now() }).run();
}

export default async function (input, ctx) {
  const me = await requireMember(ctx);
  const chat = await getChat(Number(input.chatId));
  if (!chat) throw new EndpointError('چت پیدا نشد.');
  assertCanSee(me, chat);
  if (!chat.isGroup) throw new EndpointError('این بخش فقط برای گروه‌هاست.');
  const op = String(input.op || '');
  const isAdmin = me.role === 'admin';
  if (!isAdmin && !MEMBER_OPS.includes(op)) throw new EndpointError('این عملیات فقط برای ادمین‌های پنل است.', { code: 'FORBIDDEN' });
  const userId = Number(input.userId);
  const name = String(input.name || '').slice(0, 60);

  if (op === 'log') {
    const rows = await db.select().from(modLog).where(eq(modLog.chatId, chat.id)).orderBy(desc(modLog.id)).limit(30).all();
    return { log: rows.map((r) => ({ action: r.action, targetId: r.targetId, targetName: r.targetName, untilTs: r.untilTs, count: r.count, by: r.byName, ts: r.ts })) };
  }

  if (op === 'info') {
    let tg = null, tgError = '';
    try { tg = await api.getChat({ chat_id: chat.id }); }
    catch (e) { tgError = faError(e); }
    let member_count = null;
    try {
      const c = await api.getChatMemberCount({ chat_id: chat.id });
      member_count = typeof c === 'number' ? c : (c && (c.member_count || c.count)) || null;
    } catch (e) { /* اختیاری */ }

    let photo_b64 = '', photo_mime = '';
    const big = tg && tg.photo && (tg.photo.small_file_id || tg.photo.big_file_id);
    if (big) {
      try { const bytes = await api.getFileContent(big); photo_b64 = b64encode(bytes); photo_mime = mimeOf(bytes); }
      catch (e) { /* عکس در دسترس نیست */ }
    }

    return {
      info: {
        id: chat.id,
        title: (tg && tg.title) || chat.title || '',
        description: (tg && tg.description) || '',
        username: (tg && tg.username) || '',
        invite_link: (tg && tg.invite_link) || '',
        type: (tg && tg.type) || chat.kind || 'group',
        member_count,
        is_group: true,
        photo_b64,
        photo_mime,
      },
      tg_error: tgError,
    };
  }

  if (op === 'members') {
    try {
      const admins = await api.getChatAdministrators({ chat_id: chat.id });
      return {
        admins: (Array.isArray(admins) ? admins : []).map((a) => ({
          id: a.user && a.user.id,
          first_name: (a.user && a.user.first_name) || '',
          last_name: (a.user && a.user.last_name) || '',
          username: (a.user && a.user.username) || '',
          is_bot: !!(a.user && a.user.is_bot),
          status: a.status || 'administrator',
        })),
      };
    } catch (e) {
      throw new EndpointError('دریافت لیست ادمین‌ها انجام نشد: ' + faError(e));
    }
  }

  if (op === 'filterGet') {
    const st = await getSettings();
    const f = st[filterKey(chat.id)];
    const out = {};
    for (const k of FILTER_KEYS) out[k] = !!(f && typeof f === 'object' && f[k]);
    return { filters: out };
  }

  if (op === 'filter') {
    const src = input.filters && typeof input.filters === 'object' ? input.filters : {};
    const filters = {};
    for (const k of FILTER_KEYS) filters[k] = !!src[k];
    await saveSettings({ [filterKey(chat.id)]: filters });
    await log(chat, me, 'content_filter', null, '', { count: Object.values(filters).filter(Boolean).length });
    return { ok: true, filters };
  }

  // تعیین صاحب گروه (برای جداسازی پنل‌ها). userId=0 → بدون صاحب (فقط ادمین‌ها می‌بینند).
  if (op === 'owner') {
    const uid = Number(input.ownerId || 0);
    // عضو عادی فقط می‌تواند گروه را به خودش نسبت دهد (نه به کسی دیگر).
    if (!isAdmin && !(uid === 0 || uid === Number(me.id))) throw new EndpointError('فقط ادمین می‌تواند صاحب گروه را تغییر دهد.', { code: 'FORBIDDEN' });
    const oName = uid === Number(me.id) ? me.name : String(input.ownerName || '').slice(0, 60);
    await touchChat(chat.id, { ownerId: uid > 0 ? uid : null, ownerName: uid > 0 ? oName : '' });
    return { ok: true, ownerId: uid > 0 ? uid : null, ownerName: uid > 0 ? oName : '' };
  }

  if (op === 'deleteBulk') {
    const count = Math.max(1, Math.min(Number(input.count) || 10, 200));
    const rows = await db.select().from(messages)
      .where(and(eq(messages.chatId, chat.id), isNull(messages.deletedAt), isNotNull(messages.msgId)))
      .orderBy(desc(messages.id)).limit(count).all();
    if (!rows.length) return { ok: true, deleted: 0 };
    let deleted = 0;
    try {
      for (let i = 0; i < rows.length; i += 100) {
        const part = rows.slice(i, i + 100);
        await api.deleteMessages({ chat_id: chat.id, message_ids: part.map((r) => r.msgId) });
        for (const r of part) await db.update(messages).set({ deletedAt: now(), deletedBy: 'panel' }).where(eq(messages.id, r.id)).run();
        deleted += part.length;
      }
    } catch (e) {
      throw new EndpointError(faError(e));
    }
    await log(chat, me, 'delete_bulk', null, '', { count: deleted });
    return { ok: true, deleted };
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
