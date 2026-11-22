import { db, EndpointError } from 'sdk';
import { and, eq, asc } from 'sdk/db';
import { edits } from '../schema.js';
import { requireMember } from '../lib/auth.js';
import { assertCanSee } from '../lib/scope.js';
import { getChat } from '../lib/store.js';

export default async function (input, ctx) {
  const me = await requireMember(ctx);
  const chatId = Number(input.chatId);
  assertCanSee(me, await getChat(chatId));
  const rows = await db.select().from(edits)
    .where(and(eq(edits.chatId, chatId), eq(edits.msgId, Number(input.msgId))))
    .orderBy(asc(edits.id)).all();
  return { edits: rows.map((r) => ({ text: r.oldText, ts: r.ts })) };
}
