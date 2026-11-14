import { db, EndpointError } from 'sdk';
import { eq } from 'sdk/db';
import { members } from '../schema.js';
import { requireMember } from '../lib/auth.js';
import { recipients, isBootstrap } from '../lib/store.js';
import { now } from '../lib/util.js';

// مدیریت اعضای مجاز (فقط ادمین): list | add | role | remove
export default async function (input, ctx) {
  const me = await requireMember(ctx, true);
  const op = input.op || 'list';
  const id = Number(input.tgId);

  if (op !== 'list') {
    if (!Number.isInteger(id) || id <= 0 || String(id).length > 15) throw new EndpointError('آیدی عددی نامعتبر است.');
    const role = input.role === 'admin' ? 'admin' : 'user';
    const ex = await db.select().from(members).where(eq(members.tgId, id)).get();
    if (op === 'add') {
      if (ex) throw new EndpointError('این آیدی قبلاً اضافه شده.');
      await db.insert(members).values({ tgId: id, role, name: String(input.name || '').slice(0, 60), notify: true, addedBy: me.id, createdAt: now() }).run();
    } else if (op === 'role') {
      if (isBootstrap(id)) throw new EndpointError('نقش ادمین‌های اصلی قابل تغییر نیست.');
      if (!ex) throw new EndpointError('عضو پیدا نشد.');
      await db.update(members).set({ role }).where(eq(members.tgId, id)).run();
    } else if (op === 'remove') {
      if (isBootstrap(id)) throw new EndpointError('ادمین‌های اصلی قابل حذف نیستند.');
      if (id === me.id) throw new EndpointError('نمی‌تونی خودت رو حذف کنی.');
      await db.delete(members).where(eq(members.tgId, id)).run();
    } else throw new EndpointError('عملیات نامعتبر.');
  }
  const list = await recipients();
  return { members: list.map((m) => ({ tgId: m.tgId, role: m.role, name: m.name || '', notify: !!m.notify, fixed: isBootstrap(m.tgId) })) };
}
