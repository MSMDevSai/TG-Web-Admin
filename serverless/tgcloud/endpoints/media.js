import { db, api, EndpointError } from 'sdk';
import { eq, and, desc, isNotNull } from 'sdk/db';
import { media, messages } from '../schema.js';
import { requireMember } from '../lib/auth.js';
import { b64encode } from '../lib/b64.js';
import { getSettings } from '../lib/store.js';
import { archiveMedia } from '../lib/media.js';

const CHUNK = 393216;   // ۳۸۴ کیلوبایت (مضرب ۳ → base64 تکه‌ها تمیز به هم می‌چسبن)

// بایت‌های رسانه‌ی ذخیره‌شده، تکه‌تکه. اگر ذخیره نشده بود و هنوز file_id معتبره، از تلگرام می‌گیره.
export default async function (input, ctx) {
  await requireMember(ctx);

  // بدون key → لیست استیکرها/GIFهای اخیر برای پنل کامپوزر
  if (!input.key && (input.type === 'sticker' || input.type === 'animation')) {
    const rows = await db.select().from(messages)
      .where(and(eq(messages.type, input.type), isNotNull(messages.mediaKey)))
      .orderBy(desc(messages.id)).limit(160).all();
    const seen = new Set();
    return rows.filter((r) => {
      if (seen.has(r.mediaKey)) return false;
      seen.add(r.mediaKey); return true;
    }).slice(0, 60).map((r) => ({
      mediaKey: r.mediaKey, emoji: input.type === 'sticker' ? String(r.text || '') : '', kind: input.type,
    }));
  }

  const key = String(input.key || '');
  const part = Math.max(0, Number(input.part) || 0);
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
