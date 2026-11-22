import { db } from 'sdk';
import { sql } from 'sdk/db';
import { EndpointError } from 'sdk';
import { touchChat } from './store.js';
import { messages } from '../schema.js';

// ─── جداسازی چت‌ها بین اعضا ───────────────────────────────────────────────
// هر چت یک صاحب دارد (chats.ownerId). عضو عادی فقط چت‌های خودش را می‌بیند؛
// ادمین (گرداننده‌ی ربات) برای پشتیبانی/نظارت همه را می‌بیند.
//
// قاعده‌ی تشخیص صاحب:
//   • چت بیزینس  → userId اتصال بیزینس (connections.userId)
//   • چت خصوصی   → خودِ طرف مقابل (chat.id)
//   • گروه/کانال → کسی که ربات را اضافه کرده (handlers/my_chat_member)
//                  یا اولین عضو پنل که در گروه پیام می‌فرستد
//
// ردیف‌های قدیمی (قبل از افزودن ستون) ownerId ندارند؛ برای همین شرط SQL
// همان قاعده را روی خود داده حساب می‌کند تا داده‌ی قبلی هم درست دیده شود.

export function seesAll(me) {
  return !!me && me.role === 'admin';
}

// صاحب مؤثر یک چت (بدون کوئری؛ فقط با استفاده از ستون‌ها)
export function ownerOf(chat) {
  if (!chat) return null;
  if (chat.ownerId) return Number(chat.ownerId);
  if (!chat.isGroup && !chat.bizId) return Number(chat.id);
  return null;
}

export function canSeeChat(me, chat) {
  if (!me || !chat) return false;
  if (seesAll(me)) return true;
  return ownerOf(chat) === Number(me.id);
}

export function assertCanSee(me, chat) {
  if (!chat) throw new EndpointError('چت پیدا نشد.');
  if (!canSeeChat(me, chat)) throw new EndpointError('این چت به حساب شما مربوط نیست.', { code: 'FORBIDDEN' });
  return chat;
}

// شرط SQL روی جدول chats با نام مستعار c — برای درج در WHERE
export function visibleChatSql(me) {
  if (seesAll(me)) return sql`1 = 1`;
  return sql`(
    c.owner_id = ${me.id}
    OR (c.is_group = 0 AND c.biz_id IS NULL AND c.id = ${me.id})
    OR (c.biz_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM connections cn WHERE cn.id = c.biz_id AND cn.user_id = ${me.id}
    ))
  )`;
}

// زیرکوئری شناسه‌ی چت‌های مجاز — برای فیلتر جدول messages (m.chat_id IN ...)
export function visibleChatsSubSql(me) {
  if (seesAll(me)) return sql`SELECT id FROM chats`;
  return sql`SELECT c.id FROM chats c WHERE ${visibleChatSql(me)}`;
}

// آیا این عضو می‌تواند به این چت پیام بفرستد/در آن اقدامی کند؟
export function assertCanWrite(me, chat) {
  assertCanSee(me, chat);
  if (me.role === 'user' && ownerOf(chat) !== Number(me.id)) {
    throw new EndpointError('این چت مال شما نیست.', { code: 'FORBIDDEN' });
  }
  return chat;
}

// ثبت صاحب چت اگر هنوز ندارد (اولین‌بار برنده است؛ صاحب دستی هم پاک نمی‌شود)
export async function claimChat(chat, ownerId, ownerName) {
  if (!chat || !ownerId || chat.ownerId) return chat;
  const name = String(ownerName || '').slice(0, 80);
  await touchChat(chat.id, { ownerId: Number(ownerId), ownerName: name });
  chat.ownerId = Number(ownerId);
  if (name) chat.ownerName = name;
  return chat;
}

// آیا این رسانه به یکی از چت‌های مجاز این عضو تعلق دارد؟
// جلوی خواندن فایل‌های چت دیگران با حدس‌زدن کلید را می‌گیرد.
export async function canAccessMedia(me, key) {
  if (!key) return false;
  if (seesAll(me)) return true;
  const row = await db.get(sql`
    SELECT 1 AS ok FROM messages m
    WHERE m.media_key = ${String(key)}
      AND m.chat_id IN (${visibleChatsSubSql(me)})
    LIMIT 1`);
  return !!row;
}
