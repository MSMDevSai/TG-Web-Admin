import { db } from 'sdk';
import { eq, and, desc, inArray } from 'sdk/db';
import { settings, chats, messages, connections, members } from '../schema.js';
import { DEFAULTS, BOOTSTRAP_ADMINS } from './config.js';
import { clean, now } from './util.js';

export async function getSettings() {
  const rows = await db.select().from(settings).all();
  const s = { ...DEFAULTS };
  for (const r of rows) s[r.key] = r.value;
  return s;
}

export async function saveSettings(obj) {
  for (const [k, v] of Object.entries(obj)) {
    await db.insert(settings).values({ key: k, value: v })
      .onConflictDoUpdate({ target: settings.key, set: { value: v } }).run();
  }
}

export async function getChat(id) {
  return (await db.select().from(chats).where(eq(chats.id, id)).get()) || null;
}

export async function touchChat(id, patch) {
  const p = clean(patch);
  const ex = await getChat(id);
  if (!ex) {
    await db.insert(chats).values({ id, title: `چت ${id}`, createdAt: now(), ...p }).run();
  } else if (Object.keys(p).length) {
    await db.update(chats).set(p).where(eq(chats.id, id)).run();
  }
}

export async function findByTg(chatId, msgId) {
  if (msgId == null) return null;
  return (await db.select().from(messages)
    .where(and(eq(messages.chatId, chatId), eq(messages.msgId, msgId)))
    .orderBy(desc(messages.id)).limit(1).get()) || null;
}

export async function addMessage(row) {
  await db.insert(messages).values(clean(row)).run();
}

export async function latestMessage(chatId) {
  return (await db.select().from(messages).where(eq(messages.chatId, chatId))
    .orderBy(desc(messages.id)).limit(1).get()) || null;
}

// ─── اتصال‌های بیزینس ───
export async function saveConnection(id, userId, enabled) {
  await db.insert(connections).values({ id, userId, enabled: !!enabled, ts: now() })
    .onConflictDoUpdate({ target: connections.id, set: { userId, enabled: !!enabled, ts: now() } }).run();
}

// ─── اعضای پنل ───
export const isBootstrap = (id) => BOOTSTRAP_ADMINS.includes(Number(id));

export async function memberRole(tgId) {
  tgId = Number(tgId);
  if (isBootstrap(tgId)) return 'admin';
  const r = await db.select().from(members).where(eq(members.tgId, tgId)).get();
  return r ? r.role : null;
}

// همه‌ی گیرنده‌های اعلان (اعضا + ادمین‌های اصلی که هنوز وارد پنل نشدن)
export async function recipients() {
  const rows = await db.select().from(members).all();
  const map = new Map(rows.map((r) => [r.tgId, r]));
  for (const id of BOOTSTRAP_ADMINS) if (!map.has(id)) map.set(id, { tgId: id, role: 'admin', notify: true });
  return [...map.values()];
}

export async function adminIds() {
  return (await recipients()).filter((r) => r.role === 'admin').map((r) => r.tgId);
}
