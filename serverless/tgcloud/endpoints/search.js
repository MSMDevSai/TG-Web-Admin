import { db, EndpointError } from 'sdk';
import { sql } from 'sdk/db';
import { requireMember } from '../lib/auth.js';

// جستجو در متن همه‌ی پیام‌ها (شامل حذف‌شده‌ها). chatId اختیاری؛ بدون آن در همه‌ی چت‌ها.
export default async function (input, ctx) {
  await requireMember(ctx);
  const q = String(input.q || '').trim();
  if (q.length < 2) throw new EndpointError('حداقل ۲ حرف بنویس.');
  const limit = Math.min(Math.max(Number(input.limit) || 30, 1), 50);
  const like = '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
  const chatId = input.chatId != null ? Number(input.chatId) : null;
  const before = input.beforeId ? Number(input.beforeId) : null;
  const rows = await db.all(sql`
    SELECT m.id, m.chat_id, m.msg_id, m.role, m.sender, m.text, m.type, m.ts, m.deleted_at, c.title
    FROM messages m LEFT JOIN chats c ON c.id = m.chat_id
    WHERE m.text LIKE ${like} ESCAPE '\\'
      AND (${chatId} IS NULL OR m.chat_id = ${chatId})
      AND (${before} IS NULL OR m.id < ${before})
    ORDER BY m.id DESC LIMIT ${limit + 1}`);
  const more = rows.length > limit;
  const lq = q.toLowerCase();
  return {
    more,
    results: rows.slice(0, limit).map((r) => {
      const t = String(r.text || ''); const i = Math.max(0, t.toLowerCase().indexOf(lq));
      const start = Math.max(0, i - 50);
      return { id: r.id, chatId: r.chat_id, chatTitle: r.title || '', msgId: r.msg_id, role: r.role, sender: r.sender, type: r.type, ts: r.ts,
        deleted: !!r.deleted_at, snippet: (start > 0 ? '…' : '') + t.slice(start, start + 160) + (start + 160 < t.length ? '…' : '') };
    }),
  };
}
