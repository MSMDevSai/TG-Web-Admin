import { db, api, EndpointError } from 'sdk';
import { eq, sql } from 'sdk/db';
import { media } from '../schema.js';
import { requireMember } from '../lib/auth.js';
import { canAccessMedia, visibleChatsSubSql } from '../lib/scope.js';
import { b64encode } from '../lib/b64.js';
import { getSettings } from '../lib/store.js';
import { archiveMedia } from '../lib/media.js';

const CHUNK = 393216;   // ۳۸۴ کیلوبایت (مضرب ۳ → base64 تکه‌ها تمیز به هم می‌چسبن)

// بایت‌های رسانه‌ی ذخیره‌شده، تکه‌تکه. اگر ذخیره نشده بود و هنوز file_id معتبره، از تلگرام می‌گیره.
export default async function (input, ctx) {
  const me = await requireMember(ctx);

  // بدون key → لیست استیکرها/GIFهای اخیر برای پنل کامپوزر (فقط چت‌های مجاز)
  if (!input.key && (input.type === 'sticker' || input.type === 'animation')) {
    const t = input.type === 'sticker' ? 'sticker' : 'animation';
    const rows = await db.all(sql`
      SELECT media_key, text FROM messages
      WHERE type = ${t} AND media_key IS NOT NULL
        AND chat_id IN (${visibleChatsSubSql(me)})
      ORDER BY id DESC LIMIT 160`);
    const seen = new Set();
    return rows.filter((r) => {
      if (seen.has(r.media_key)) return false;
      seen.add(r.media_key); return true;
    }).slice(0, 60).map((r) => ({
      mediaKey: r.media_key, emoji: t === 'sticker' ? String(r.text || '') : '', kind: t,
    }));
  }

  const key = String(input.key || '');
  const part = Math.max(0, Number(input.part) || 0);
  if (!(await canAccessMedia(me, key))) throw new EndpointError('رسانه پیدا نشد.');
  let row = await db.select().from(media).where(eq(media.key, key)).get();
  if (!row) throw new EndpointError('رسانه پیدا نشد.');

  let data = row.saved && row.data ? new Uint8Array(row.data) : null;
  if (!data) {
    try { data = await api.getFileContent(row.fileId); }
    catch (e) { throw new EndpointError('این فایل دیگر در دسترس نیست (ذخیره نشده بود).'); }
    try { await archiveMedia({ key, fileId: row.fileId, type: row.kind, mime: row.mime, size: data.length }, await getSettings(), data); } catch (e) { /* ignore */ }
  }
  const parts = Math.max(1, Math.ceil(data.length / CHUNK));
  if (part >= parts) throw new EndpointError('بخش نامعتبر.');
  return { mime: row.mime || 'application/octet-stream', size: data.length, parts, part, b64: b64encode(data.subarray(part * CHUNK, (part + 1) * CHUNK)) };
}
