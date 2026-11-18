import { EndpointError } from 'sdk';
import { requireMember } from '../lib/auth.js';
import { listSessions, deleteSession, renameSession } from '../lib/panelAuth.js';

// لیست نشست‌ها، تغییر نام یا خارج کردن یک نشست
export default async function (input, ctx) {
  // HTTP callers are authenticated by the platform; sessions are admin-only.
  // (`tgcloud run` without --ctx is local/trusted and skips this.)
  if (ctx && ctx.initData) await requireMember(ctx, true);

  const { op, token, name } = input || {};
  const username = input?.username;

  if (op === 'list') {
    if (!username) throw new EndpointError('یوزرنیم الزامی است.', { code: 'MISSING_USERNAME' });
    const rows = await listSessions(username);
    return { sessions: rows.map((s) => ({
      id: s.token,
      device: { name: s.device_name, platform: s.platform },
      current: false,
      created: s.created_at,
      last_seen: s.last_seen,
    })) };
  }

  if (op === 'delete') {
    if (!token) throw new EndpointError('توکن نشست الزامی است.', { code: 'MISSING_TOKEN' });
    await deleteSession(token);
    return { ok: true };
  }

  if (op === 'rename') {
    if (!token || !name) throw new EndpointError('توکت و نام جدید الزامی است.', { code: 'MISSING_FIELDS' });
    await renameSession(token, name);
    return { ok: true };
  }

  throw new EndpointError('عملیات نامعتبر است.', { code: 'BAD_OP' });
}
