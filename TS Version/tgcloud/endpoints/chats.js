import { db } from 'sdk';
import { sql } from 'sdk/db';
import { requireMember } from '../lib/auth.js';
import { now } from '../lib/util.js';

// لیست چت‌ها + شمارنده‌ی نخوانده‌ی اختصاصی هر عضو (raw SQL → مقادیر boolean به شکل 0/1 برمی‌گردن)
export default async function (input, ctx) {
  const me = await requireMember(ctx);
  const prefix = `${me.id}:`;
  const rows = await db.all(sql`
    SELECT c.id, c.title, c.kind, c.is_group, c.biz_id, c.has_bot_chat, c.muted, c.pinned, c.ai_mode,
           c.last_text, c.last_sender, c.last_ts, c.ai_pending_until,
           (SELECT COUNT(*) FROM messages m
              WHERE m.chat_id = c.id AND m.role = 'user' AND m.deleted_at IS NULL
                AND m.id > COALESCE((SELECT r.last_id FROM reads r WHERE r.key = ${prefix} || c.id), 0)) AS unread
    FROM chats c
    ORDER BY c.pinned DESC, c.last_ts DESC
    LIMIT 300`);
  const t = now();
  return {
    chats: rows.map((r) => ({
      id: r.id, title: r.title, kind: r.kind, isGroup: !!r.is_group, business: !!r.biz_id, direct: !!r.has_bot_chat,
      muted: !!r.muted, pinned: !!r.pinned, aiMode: r.ai_mode || null,
      lastText: r.last_text, lastSender: r.last_sender, lastTs: r.last_ts,
      unread: r.unread || 0, aiPending: Number(r.ai_pending_until) > t,
    })),
  };
}
