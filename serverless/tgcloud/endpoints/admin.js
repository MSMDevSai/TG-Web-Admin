import { api, db, EndpointError } from 'sdk';
import { and, desc, eq, like, or } from 'sdk/db';
import {
  anonReports, anonMessages, botUsers, userBlocks, warnings, contactRequests,
  members, chats, messages, anonLinks,
} from '../schema.js';
import { requireMember } from '../lib/auth.js';
import { getCounters, anonStats } from '../lib/stats.js';
import { setBlock, removeBlock, warnUser } from '../lib/moderation.js';
import { now, clip } from '../lib/util.js';

// مدیریت کاربران ربات، بلاک/اخطار، گزارش‌ها، درخواست‌های تماس و آمار.
// همهٔ عملیات فقط برای ادمین‌های پنل.
export default async function (input, ctx) {
  const me = await requireMember(ctx, true);
  const op = input.op || 'stats';

  if (op === 'stats') {
    const c = await getCounters();
    const anon = await anonStats(0);
    return {
      counters: c,
      anon,
      counts: {
        users: await db.$count(botUsers),
        blocked: await db.$count(userBlocks),
        chats: await db.$count(chats),
        messages: await db.$count(messages),
        members: await db.$count(members),
        anonLinks: await db.$count(anonLinks),
        openReports: await db.$count(anonReports, eq(anonReports.status, 'open')),
        openContacts: await db.$count(contactRequests, eq(contactRequests.handled, false)),
      },
    };
  }

  if (op === 'users') {
    const q = String(input.q || '').trim();
    const limit = Math.min(100, Math.max(1, Number(input.limit) || 30));
    const offset = Math.max(0, Number(input.offset) || 0);
    const cond = q
      ? or(like(botUsers.name, `%${q}%`), like(botUsers.username, `%${q}%`), like(botUsers.tgId, `%${q}%`))
      : undefined;
    let qb = db.select().from(botUsers);
    if (cond) qb = qb.where(cond);
    const list = await qb.orderBy(desc(botUsers.lastSeen)).limit(limit).offset(offset).all();
    const blocks = await db.select().from(userBlocks).all();
    const bmap = new Map(blocks.map((b) => [b.tgId, b]));
    return {
      users: list.map((u) => ({
        tgId: u.tgId, name: u.name || '', username: u.username || '',
        lastText: u.lastText || '', firstSeen: u.firstSeen, lastSeen: u.lastSeen,
        blocked: bmap.has(u.tgId),
        permanent: !!(bmap.get(u.tgId) || {}).permanent,
        reason: (bmap.get(u.tgId) || {}).reason || '',
      })),
      total: await db.$count(botUsers),
    };
  }

  if (op === 'blocks') {
    const rows = await db.select().from(userBlocks).orderBy(desc(userBlocks.ts)).limit(200).all();
    const users = await db.select().from(botUsers).all();
    const nmap = new Map(users.map((u) => [u.tgId, u]));
    return {
      blocks: rows.map((b) => ({
        tgId: b.tgId, reason: b.reason || '', permanent: !!b.permanent, by: b.by || '', ts: b.ts,
        name: (nmap.get(b.tgId) || {}).name || '',
      })),
    };
  }

  if (op === 'block') {
    const tgId = Number(input.tgId);
    if (!Number.isInteger(tgId) || tgId <= 0) throw new EndpointError('آیدی عددی نامعتبر است.');
    const row = await setBlock(tgId, {
      reason: String(input.reason || '').trim(),
      permanent: !!input.permanent,
      by: `panel:${me.id}`,
    });
    return { ok: true, block: { tgId: row.tgId, reason: row.reason, permanent: !!row.permanent, ts: row.ts } };
  }

  if (op === 'unblock') {
    const tgId = Number(input.tgId);
    if (!tgId) throw new EndpointError('آیدی عددی نامعتبر است.');
    await removeBlock(tgId);
    return { ok: true };
  }

  if (op === 'warn') {
    const tgId = Number(input.tgId);
    const reason = String(input.reason || '').trim();
    if (!tgId) throw new EndpointError('آیدی عددی نامعتبر است.');
    if (!reason) throw new EndpointError('دلیل اخطار را بنویس.');
    const r = await warnUser(tgId, reason, { id: me.id, name: me.name });
    return { ok: true, sent: r.sent };
  }

  if (op === 'warnings') {
    const tgId = Number(input.tgId);
    let qb = db.select().from(warnings);
    if (tgId) qb = qb.where(eq(warnings.tgId, tgId));
    const rows = await qb.orderBy(desc(warnings.id)).limit(100).all();
    return { warnings: rows };
  }

  if (op === 'contacts') {
    let qb = db.select().from(contactRequests);
    if (!input.all) qb = qb.where(eq(contactRequests.handled, false));
    const rows = await qb.orderBy(desc(contactRequests.id)).limit(200).all();
    return { contacts: rows };
  }

  if (op === 'contactDone') {
    const id = Number(input.id);
    if (!id) throw new EndpointError('شناسه نامعتبر است.');
    await db.update(contactRequests).set({ handled: !!input.handled }).where(eq(contactRequests.id, id)).run();
    return { ok: true };
  }

  if (op === 'reports') {
    let qb = db.select().from(anonReports);
    if (!input.all) qb = qb.where(eq(anonReports.status, 'open'));
    const rows = await qb.orderBy(desc(anonReports.id)).limit(200).all();
    return { reports: rows };
  }

  if (op === 'report') {
    const id = Number(input.id);
    const r = await db.select().from(anonReports).where(eq(anonReports.id, id)).get();
    if (!r) throw new EndpointError('گزارش پیدا نشد.');
    const msgs = await db.select().from(anonMessages)
      .where(and(eq(anonMessages.ownerId, r.ownerId), eq(anonMessages.senderId, r.senderId)))
      .orderBy(anonMessages.id).limit(300).all();
    return {
      report: r,
      messages: msgs.map((m) => ({
        dir: m.dir, text: m.text || '', kind: m.kind || '', ts: m.ts,
      })),
    };
  }

  if (op === 'resolveReport') {
    const id = Number(input.id);
    if (!id) throw new EndpointError('شناسه نامعتبر است.');
    await db.update(anonReports).set({ status: 'resolved', resolvedAt: now(), by: me.id }).where(eq(anonReports.id, id)).run();
    return { ok: true };
  }

  if (op === 'reply') {
    // پاسخ ادمین به یک درخواست تماس یا گزارش، از طرف ربات
    const tgId = Number(input.tgId);
    const text = clip(String(input.text || '').trim(), 3500);
    if (!tgId || !text) throw new EndpointError('آیدی و متن لازم است.');
    try {
      await api.sendMessage({ chat_id: tgId, text });
      return { ok: true, sent: true };
    } catch (e) {
      return { ok: true, sent: false, error: 'کاربر ربات را بلاک کرده یا استارت نزده.' };
    }
  }

  throw new EndpointError('عملیات نامعتبر.');
}
