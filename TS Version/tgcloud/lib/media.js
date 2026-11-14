import { api } from 'sdk';
import { eq } from 'sdk/db';
import { db } from 'sdk';
import { media } from '../schema.js';
import { now } from './util.js';

// نوع و file_id رسانه‌ی یک پیام تلگرام
export function describeMedia(m) {
  if (m.photo && m.photo.length) {
    const p = m.photo[m.photo.length - 1];
    return { type: 'photo', fileId: p.file_id, key: p.file_unique_id, mime: 'image/jpeg', size: p.file_size || 0, ph: '[عکس]' };
  }
  if (m.video) return { type: 'video', fileId: m.video.file_id, key: m.video.file_unique_id, mime: m.video.mime_type || 'video/mp4', size: m.video.file_size || 0, ph: '[ویدیو]' };
  if (m.video_note) return { type: 'video_note', fileId: m.video_note.file_id, key: m.video_note.file_unique_id, mime: 'video/mp4', size: m.video_note.file_size || 0, ph: '[ویدیو مسیج]' };
  if (m.voice) return { type: 'voice', fileId: m.voice.file_id, key: m.voice.file_unique_id, mime: m.voice.mime_type || 'audio/ogg', size: m.voice.file_size || 0, ph: '[ویس]' };
  if (m.audio) return { type: 'audio', fileId: m.audio.file_id, key: m.audio.file_unique_id, mime: m.audio.mime_type || 'audio/mpeg', size: m.audio.file_size || 0, ph: '[موزیک]' };
  if (m.animation) return { type: 'animation', fileId: m.animation.file_id, key: m.animation.file_unique_id, mime: m.animation.mime_type || 'video/mp4', size: m.animation.file_size || 0, ph: '[گیف]' };
  if (m.sticker) {
    const s = m.sticker;
    const mime = s.is_animated ? 'application/x-tgsticker' : s.is_video ? 'video/webm' : 'image/webp';
    return { type: 'sticker', fileId: s.file_id, key: s.file_unique_id, mime, size: s.file_size || 0, ph: s.emoji || '🎭' };
  }
  if (m.document) return { type: 'document', fileId: m.document.file_id, key: m.document.file_unique_id, mime: m.document.mime_type || 'application/octet-stream', size: m.document.file_size || 0, ph: '[فایل] ' + (m.document.file_name || ''), fileName: m.document.file_name || '' };
  return null;
}

// ذخیره‌ی رکورد رسانه؛ اگر مجاز و جا باشه بایت‌ها هم دانلود و ذخیره می‌شن
export async function archiveMedia(info, st, bytes) {
  if (!info || !info.key) return;
  const ex = await db.select().from(media).where(eq(media.key, info.key)).get();
  if (ex && ex.saved) return;

  const cap = (Number(st.archive_max_mb) || 20) * 1048576;
  const allowed = st.archive_media && (info.type !== 'video_note' || st.archive_video_note);
  let data = bytes || null;
  if (!data && allowed && (!info.size || info.size <= cap)) {
    try { data = await api.getFileContent(info.fileId); } catch (e) { data = null; }
  }
  if (data && data.length > cap) data = null;

  const row = { key: info.key, fileId: info.fileId, kind: info.type, mime: info.mime,
    size: data ? data.length : info.size || 0, data, saved: !!data, ts: now() };
  try {
    if (ex) await db.update(media).set(row).where(eq(media.key, info.key)).run();
    else await db.insert(media).values(row).run();
  } catch (e) { /* ثبت تکراری/محدودیت اندازه: مهم نیست، file_id هنوز در پیام هست */ }
}
