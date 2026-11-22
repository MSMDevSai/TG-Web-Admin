import { api, EndpointError } from 'sdk';
import { requireMember } from '../lib/auth.js';
import { assertCanSee, seesAll } from '../lib/scope.js';
import { getChat } from '../lib/store.js';
import { b64encode } from '../lib/b64.js';
import { mimeOf } from '../lib/media.js';
import { faError } from '../lib/util.js';

// پروفایل یک کاربر/گروه: getChat + عکس (base64). اگر رابطه‌ی مستقیم ربات با
// مخاطب نباشد (فقط چت بیزینسی)، از اطلاعات محلی پنل استفاده می‌شود.
export default async function (input, ctx) {
  const me = await requireMember(ctx);

  const chatId = Number(input.chatId);
  if (!Number.isInteger(chatId) || chatId === 0) throw new EndpointError('شناسه‌ی چت الزامی است.', { code: 'NO_CHAT' });
  // کاربر عادی فقط پروفایل چت‌های خودش را می‌بیند (ادمین همه را).
  if (!seesAll(me)) assertCanSee(me, await getChat(chatId));

  let chat = null, limited = false, limited_reason = '', tgError = '';
  try {
    chat = await api.getChat({ chat_id: chatId });
  } catch (e) {
    tgError = faError(e);
    const row = await getChat(chatId);
    if (!row) throw new EndpointError(tgError || 'اطلاعات این چت در دسترس نیست.', { code: 'CHAT_NOT_FOUND' });
    limited = true;
    limited_reason = row.isGroup
      ? 'ربات هنوز دسترسی کامل به اطلاعات این گروه ندارد؛ اطلاعات نمایش‌داده‌شده از آرشیو پنل است.'
      : 'این مخاطب فقط از طریق اتصال بیزینسی در دسترس است؛ ربات چت مستقیمی با او ندارد، پس تلگرام جزئیات کامل پروفایل را نمی‌دهد.';
    chat = {
      id: row.id,
      type: row.isGroup ? 'supergroup' : 'private',
      title: row.title || '',
      first_name: row.title || '',
      is_group: !!row.isGroup,
    };
  }

  const isGroup = !!(chat.is_group || chat.type === 'group' || chat.type === 'supergroup' || chat.type === 'channel');

  let photo_b64 = '', photo_mime = '';
  let fileId = chat.photo && (chat.photo.small_file_id || chat.photo.big_file_id);
  // برای کاربر خصوصی اگر getChat عکس نداد، از پروفایل‌فتوها امتحان می‌کنیم.
  if (!fileId && !isGroup) {
    try {
      const photos = await api.getUserProfilePhotos({ user_id: chatId, limit: 1 });
      const first = photos && Array.isArray(photos.photos) ? photos.photos[0] : null;
      if (first && first.length) fileId = first[0].file_id;
    } catch (e) { /* اختیاری */ }
  }
  if (fileId) {
    try {
      const bytes = await api.getFileContent(fileId);
      photo_b64 = b64encode(bytes);
      photo_mime = mimeOf(bytes);
    } catch (e) { /* عکس قابل دانلود نیست */ }
  }

  return {
    id: chat.id || chatId,
    type: chat.type || '',
    is_group: isGroup,
    title: chat.title || '',
    first_name: chat.first_name || '',
    last_name: chat.last_name || '',
    username: chat.username || '',
    bio: chat.bio || '',
    description: chat.description || '',
    invite_link: chat.invite_link || '',
    has_private_chat: !!chat.has_private_chat,
    photo_b64,
    photo_mime,
    limited,
    limited_reason,
    tg_error: tgError,
  };
}
