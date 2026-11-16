import { db, EndpointError } from 'sdk';
import { and, eq, gt } from 'sdk/db';
import { anonLinks, anonMessages, anonBlocks } from '../schema.js';
import { requireMember } from '../lib/auth.js';
import { now } from '../lib/util.js';

// نمای کلیِ پیام ناشناس برای ادمین: آمار کلی و بلاک‌های سراسری. هیچ متن پیامی ذخیره/نمایش داده نمی‌شود.
export default async function (input, ctx) {
  const me = await requireMember(ctx, true);
  const op = input.op || 'overview';
  const sid = Number(input.senderId);
  if (op === 'block' || op === 'unblock') {
    if (!Number.isInteger(sid) || sid <= 0) throw new EndpointError('آیدی عددی نامعتبر است.');
    if (op === 'block') await db.insert(anonBlocks).values({ key: `0:${sid}`, ownerId: 0, senderId: sid, by: 'admin:' + me.id, ts: now() })
      .onConflictDoUpdate({ target: anonBlocks.key, set: { ts: now() } }).run();
    else await db.delete(anonBlocks).where(eq(anonBlocks.key, `0:${sid}`)).run();
  } else if (op !== 'overview') throw new EndpointError('عملیات نامعتبر.');

  const day = now() - 86400000;
  return {
    links: await db.$count(anonLinks),
    activeLinks: await db.$count(anonLinks, eq(anonLinks.enabled, true)),
    messages24h: await db.$count(anonMessages, and(eq(anonMessages.dir, 'in'), gt(anonMessages.ts, day))),
    ownerBlocks: await db.$count(anonBlocks, gt(anonBlocks.ownerId, 0)),
    globalBlocks: (await db.select().from(anonBlocks).where(eq(anonBlocks.ownerId, 0)).all()).map((b) => ({ senderId: b.senderId, by: b.by, ts: b.ts })).slice(0, 200),
  };
}
