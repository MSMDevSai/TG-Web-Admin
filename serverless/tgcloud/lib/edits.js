import { db } from 'sdk';
import { eq } from 'sdk/db';
import { messages, edits } from '../schema.js';
import { findByTg, touchChat } from './store.js';
import { ingest } from './ingest.js';
import { now, clip } from './util.js';

// ویرایش پیام: متن قبلی در جدول edits می‌مونه (کالکتور)
export async function applyEdit(msg) {
  const chatId = msg.chat.id;
  const ex = await findByTg(chatId, msg.message_id);
  if (!ex) { await ingest(msg); return; }
  const newText = msg.text || msg.caption || '';
  if (!newText || newText === ex.text) return;
  const ts = msg.edit_date ? msg.edit_date * 1000 : now();
  await db.insert(edits).values({ chatId, msgId: msg.message_id, oldText: ex.text, ts }).run();
  await db.update(messages).set({ text: newText, editedAt: ts }).where(eq(messages.id, ex.id)).run();
}
