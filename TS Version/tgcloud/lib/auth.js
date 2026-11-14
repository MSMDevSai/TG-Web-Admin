import { db, EndpointError } from 'sdk';
import { eq } from 'sdk/db';
import { members } from '../schema.js';
import { isBootstrap } from './store.js';
import { now, fullName } from './util.js';

// هویت از initData تأییدشده‌ی تلگرام می‌آید (ctx.initData)؛ خودمان رمز/توکن نداریم.
export async function requireMember(ctx, needAdmin = false) {
  const u = ctx && ctx.initData && ctx.initData.user;
  if (!u || !u.id) throw new EndpointError('فقط از داخل تلگرام قابل استفاده است.', { code: 'UNAUTHORIZED' });
  const id = Number(u.id);
  let row = await db.select().from(members).where(eq(members.tgId, id)).get();
  let role = row ? row.role : null;

  if (isBootstrap(id)) {
    role = 'admin';
    if (!row) {
      await db.insert(members).values({ tgId: id, role: 'admin', name: fullName(u), notify: true, addedBy: id, createdAt: now() }).run();
      row = await db.select().from(members).where(eq(members.tgId, id)).get();
    } else if (row.role !== 'admin') {
      await db.update(members).set({ role: 'admin' }).where(eq(members.tgId, id)).run();
    }
  }
  if (!role) throw new EndpointError('این اکانت اجازه‌ی دسترسی به پنل را ندارد.', { code: 'FORBIDDEN' });
  if (needAdmin && role !== 'admin') throw new EndpointError('این بخش فقط برای ادمین‌هاست.', { code: 'FORBIDDEN' });
  return { id, role, name: fullName(u) || String(id), row };
}
