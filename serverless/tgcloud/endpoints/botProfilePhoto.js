import { api, InputFile, EndpointError } from 'sdk';
import { requireMember } from '../lib/auth.js';
import { b64decode, b64encode } from '../lib/b64.js';
import { mimeOf } from '../lib/media.js';
import { faError } from '../lib/util.js';

// عکس پروفایل ربات. get: عکس فعلی (base64) | set: آپلود JPEG | delete: حذف.
// Bot API 9.4: setMyProfilePhoto({ photo: { type: 'static', photo: InputFile } })
async function botPhoto() {
  const me = await api.getMe();
  let fileId = '';
  try {
    const photos = await api.getUserProfilePhotos({ user_id: me.id, limit: 1 });
    const first = photos && Array.isArray(photos.photos) ? photos.photos[0] : null;
    // کوچک‌ترین سایز برای پیش‌نمایش آواتار (حجم پاسخ را کم نگه می‌دارد)
    if (first && first.length) fileId = first[0].file_id;
  } catch (e) { /* برخی نسخه‌ها برای خود ربات اجازه نمی‌دهند */ }
  if (!fileId) {
    try {
      const chat = await api.getChat({ chat_id: me.id });
      if (chat && chat.photo) fileId = chat.photo.small_file_id || chat.photo.big_file_id || '';
    } catch (e) { /* اختیاری */ }
  }
  if (!fileId) return { has: false, b64: '', mime: '' };
  const bytes = await api.getFileContent(fileId);
  return { has: true, b64: b64encode(bytes), mime: mimeOf(bytes), fileId };
}

export default async function (input, ctx) {
  await requireMember(ctx, true);
  const op = input.op || 'get';

  if (op === 'get') {
    try { return await botPhoto(); }
    catch (e) { return { has: false, b64: '', mime: '', error: faError(e) }; }
  }

  if (op === 'delete') {
    try { await api.removeMyProfilePhoto({}); }
    catch (e) { throw new EndpointError('حذف عکس انجام نشد: ' + faError(e)); }
    return { ok: true };
  }

  if (op === 'set') {
    const raw = String(input.b64 || '').replace(/^data:[^;]+;base64,/, '');
    if (!raw) throw new EndpointError('عکس ارسال نشده.', { code: 'NO_PHOTO' });
    let bytes;
    try { bytes = b64decode(raw); } catch (e) { throw new EndpointError('عکس نامعتبر است.', { code: 'BAD_PHOTO' }); }
    if (!bytes || bytes.length < 4) throw new EndpointError('عکس خالی است.', { code: 'BAD_PHOTO' });
    if (bytes.length > 5 * 1024 * 1024) throw new EndpointError('حجم عکس باید کمتر از ۵ مگابایت باشد.', { code: 'PHOTO_TOO_BIG' });
    if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) {
      throw new EndpointError('عکس باید JPG باشد.', { code: 'NOT_JPEG' });
    }
    try {
      await api.setMyProfilePhoto({ photo: { type: 'static', photo: new InputFile(bytes, 'photo.jpg', { type: 'image/jpeg' }) } });
    } catch (e) {
      throw new EndpointError('تلگرام عکس را نپذیرفت: ' + faError(e));
    }
    return { ok: true };
  }

  throw new EndpointError('عملیات نامعتبر است.', { code: 'BAD_OP' });
}
