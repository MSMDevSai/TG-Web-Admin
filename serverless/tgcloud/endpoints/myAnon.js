import { api, db } from 'sdk';
import { and, eq, gt } from 'sdk/db';
import { anonLinks, anonSessions, anonMessages, anonAliases } from '../schema.js';
import { requireMember } from '../lib/auth.js';
import { getSettings, saveSettings } from '../lib/store.js';
import { now, clip } from '../lib/util.js';

// مدیریت لینک پیام ناشناسِ خودِ کاربر از داخل پنل (Settings → پیام ناشناس).
// هر عضو فقط لینک خودش را می‌بیند/تغییر می‌دهد؛ ownerId همیشه آیدی خود اوست.
// متن پیام‌ها این‌جا هرگز نمایش داده نمی‌شود — فقط شمارش و وضعیت.

const AL = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randToken(n) {
  const out = []; const c = globalThis.crypto;
  if (c && c.getRandomValues) {
    const b = new Uint8Array(n);
    c.getRandomValues(b);
    for (let i = 0; i < n; i++) out.push(AL[b[i] % AL.length]);
  } else {
    for (let i = 0; i < n; i++) out.push(AL[Math.floor(Math.random() * AL.length)]);
  }
  return out.join('');
}

async function botUsername(st) {
  if (st.bot_username) return st.bot_username;
  const me = await api.getMe();
  await saveSettings({ bot_username: me.username });
  st.bot_username = me.username;
  return me.username;
}

async function linkOf(ownerId) {
  return (await db.select().from(anonLinks).where(eq(anonLinks.ownerId, ownerId)).get()) || null;
}

async function ensureLink(ownerId, ownerName) {
  let l = await linkOf(ownerId);
  if (!l) {
    const token = randToken(16);
    await db.insert(anonLinks).values({
      token, ownerId, ownerName: clip(ownerName || '', 60),
      enabled: true, uses: 0, createdAt: now(),
    }).run();
    l = await linkOf(ownerId);
  }
  return l;
}

async function overview(me, st) {
  const l = await linkOf(me.id);
  const enabled = !!st.anon_enabled;
  let link = null;
  if (l) {
    let url = null;
    try {
      const user = await botUsername(st);
      url = `https://t.me/${user}?start=anon_${l.token}`;
    } catch (e) { /* نام کاربری ربات موقتاً در دسترس نیست */ }

    const day = now() - 86400000;
    link = {
      url,
      token: l.token,
      enabled: !!l.enabled,
      uses: Number(l.uses || 0),
      senders: await db.$count(anonAliases, eq(anonAliases.ownerId, me.id)),
      messages: await db.$count(anonMessages, and(eq(anonMessages.ownerId, me.id), eq(anonMessages.dir, 'in'))),
      last24h: await db.$count(anonMessages, and(
        eq(anonMessages.ownerId, me.id), eq(anonMessages.dir, 'in'), gt(anonMessages.ts, day),
      )),
      createdAt: l.createdAt || null,
    };
  }
  return { ok: true, available: enabled, link };
}

export default async function (input, ctx) {
  const me = await requireMember(ctx);
  const st = await getSettings();
  const op = input.op || 'overview';

  if (op === 'overview') return await overview(me, st);

  if (!st.anon_enabled) return { ok: false, error: 'قابلیت پیام ناشناس توسط ادمین خاموش شده است.' };

  if (op === 'create') {
    await ensureLink(me.id, me.name);
    return await overview(me, st);
  }

  if (op === 'toggle') {
    const l = await ensureLink(me.id, me.name);
    const enabled = typeof input.enabled === 'boolean' ? input.enabled : !l.enabled;
    await db.update(anonLinks).set({ enabled }).where(eq(anonLinks.token, l.token)).run();
    return await overview(me, st);
  }

  if (op === 'new') {
    const l = await linkOf(me.id);
    if (l) {
      await db.delete(anonSessions).where(eq(anonSessions.token, l.token)).run();
      await db.delete(anonLinks).where(eq(anonLinks.token, l.token)).run();
    }
    await ensureLink(me.id, me.name);
    return await overview(me, st);
  }

  return { ok: false, error: 'عملیات نامعتبر.' };
}
