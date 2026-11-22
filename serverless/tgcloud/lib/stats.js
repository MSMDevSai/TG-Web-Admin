import { db } from 'sdk';
import { and, eq, sql } from 'sdk/db';
import { counters, anonLinks, anonMessages, anonReports } from '../schema.js';
import { now } from './util.js';

// شمارنده‌های ساده‌ی آماری. درج/افزایش اتمیک است تا چند پیام هم‌زمان
// مقدار را خراب نکند (SQLite UPSERT).
export async function bump(key, n = 1) {
  const k = String(key || '').slice(0, 60);
  if (!k) return;
  const v = Number(n) || 1;
  try {
    await db.run(sql`
      INSERT INTO counters (key, value, ts) VALUES (${k}, ${v}, ${now()})
      ON CONFLICT(key) DO UPDATE SET value = counters.value + ${v}, ts = ${now()}`);
  } catch (e) { /* آمار نباید مسیر اصلی را بشکند */ }
}

export async function getCounters() {
  const rows = await db.select().from(counters).all();
  const out = {};
  for (const r of rows) out[r.key] = Number(r.value) || 0;
  return out;
}

// آمار پیام ناشناس؛ ownerId=0 یعنی کل ربات (برای ادمین)
export async function anonStats(ownerId = 0) {
  const all = !ownerId;
  const where = all ? '' : `WHERE owner_id = ${Number(ownerId)}`;
  const day = now() - 86400000;
  const row = (await db.get(sql`
    SELECT
      COUNT(*) AS messages,
      SUM(CASE WHEN dir = 'in'  THEN 1 ELSE 0 END) AS incoming,
      SUM(CASE WHEN dir = 'out' THEN 1 ELSE 0 END) AS outgoing,
      SUM(CASE WHEN dir = 'in' AND ts > ${day} THEN 1 ELSE 0 END) AS last24h,
      COUNT(DISTINCT sender_id) AS senders
    FROM anon_messages ${sql.raw(where)}`)) || {};

  const links = all
    ? await db.select().from(anonLinks).all()
    : await db.select().from(anonLinks).where(eq(anonLinks.ownerId, Number(ownerId))).all();
  const openReports = all
    ? await db.$count(anonReports, eq(anonReports.status, 'open'))
    : await db.$count(anonReports, and(eq(anonReports.status, 'open'), eq(anonReports.ownerId, Number(ownerId))));

  return {
    links: links.length,
    activeLinks: links.filter((l) => l.enabled).length,
    views: links.reduce((s, l) => s + (Number(l.uses) || 0), 0),
    senders: Number(row.senders) || 0,
    incoming: Number(row.incoming) || 0,
    outgoing: Number(row.outgoing) || 0,
    messages: Number(row.messages) || 0,
    last24h: Number(row.last24h) || 0,
    openReports: openReports || 0,
  };
}

export function fmtNum(n) {
  try { return new Intl.NumberFormat('fa-IR').format(Number(n) || 0); }
  catch (e) { return String(Number(n) || 0); }
}
