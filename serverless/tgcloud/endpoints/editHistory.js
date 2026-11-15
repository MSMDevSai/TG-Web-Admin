import { db } from 'sdk';
import { and, eq, asc } from 'sdk/db';
import { edits } from '../schema.js';
import { requireMember } from '../lib/auth.js';

export default async function (input, ctx) {
  await requireMember(ctx);
  const rows = await db.select().from(edits)
    .where(and(eq(edits.chatId, Number(input.chatId)), eq(edits.msgId, Number(input.msgId))))
    .orderBy(asc(edits.id)).all();
  return { edits: rows.map((r) => ({ text: r.oldText, ts: r.ts })) };
}
