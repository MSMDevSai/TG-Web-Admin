import { db } from 'sdk';
import { eq } from 'sdk/db';
import { messages } from '../schema.js';
import { findByTg } from '../lib/store.js';

export default async function (r) {
  const row = await findByTg(r.chat.id, r.message_id);
  if (!row) return;
  const first = (r.new_reaction || []).find((x) => x.type === 'emoji');
  await db.update(messages).set({ theirReaction: first ? first.emoji : null }).where(eq(messages.id, row.id)).run();
}
