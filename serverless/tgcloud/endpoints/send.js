import { api, db, EndpointError } from 'sdk';
import { eq } from 'sdk/db';
import { media } from '../schema.js';
import { requireMember } from '../lib/auth.js';
import { assertCanWrite, canAccessMedia } from '../lib/scope.js';
import { getChat, touchChat, addMessage } from '../lib/store.js';
import { sendText } from '../lib/tg.js';
import { now, clip, faError } from '../lib/util.js';
import { bump } from '../lib/stats.js';

// ارسال از پنل. mode: 'me' (با اکانت بیزینس، به‌جای خودت) یا 'bot' (از طرف ربات)
//  - متن: { chatId, text }
//  - استیکر/GIF ذخیره‌شده: { chatId, mediaKey, type: 'sticker'|'animation' }
// اگر چت هنوز در دیتابیس نباشد و حالت «ربات» باشد، با آیدی عددی یا @username ساخته می‌شود.
export default async function (input, ctx) {
  const me = await requireMember(ctx);
  const raw = String(input.chatId == null ? '' : input.chatId).trim();
  const numeric = Number(raw);
  const isNumeric = Number.isInteger(numeric) && numeric > 0;
  const isUsername = /^@?[a-zA-Z][a-zA-Z0-9_]{3,31}$/.test(raw);

  const chat = isNumeric ? await getChat(numeric) : null;
  const mode = input.mode === 'me' ? 'me' : 'bot';
  const mediaKey = input.mediaKey ? String(input.mediaKey) : '';
  const mediaType = input.type === 'sticker' || input.type === 'animation' ? input.type : null;

  if (!chat) {
    if (mediaType) throw new EndpointError('این چت پیدا نشد.');
    if (mode === 'me') throw new EndpointError('برای شروع چت جدید فقط حالت «ربات» ممکن است.');
    if (!isNumeric && !isUsername) throw new EndpointError('شناسه‌ی چت نامعتبر است.');
  }
  if (mode === 'me' && chat && !chat.bizId) throw new EndpointError('این چت اتصال بیزینسی ندارد؛ حالت «ربات» را انتخاب کن.');
  if (chat) assertCanWrite(me, chat);

  // ---------- استیکر / GIF با file_id (بدون آپلود دوباره) ----------
  if (mediaType) {
    if (!mediaKey) throw new EndpointError('رسانه انتخاب نشده.');
    if (!(await canAccessMedia(me, mediaKey))) throw new EndpointError('این رسانه در دسترس نیست.');
    const row = await db.select().from(media).where(eq(media.key, mediaKey)).get();
    if (!row) throw new EndpointError('این استیکر/GIF در آرشیو نیست.');
    const method = mediaType === 'sticker' ? 'sendSticker' : 'sendAnimation';
    const field = mediaType === 'sticker' ? 'sticker' : 'animation';
    const payload = { chat_id: chat.id, [field]: row.fileId };
    if (mode === 'me') payload.business_connection_id = chat.bizId;
    if (input.replyToMsgId) payload.reply_parameters = { message_id: Number(input.replyToMsgId), allow_sending_without_reply: true };

    let sent;
    try { sent = await api[method](payload); } catch (e) { throw new EndpointError(faError(e)); }

    const emoji = String(input.text || '').trim();
    const text = mediaType === 'sticker' ? (emoji || '🎭') : '[گیف]';
    await addMessage({ chatId: chat.id, msgId: sent.message_id, role: 'admin', sender: me.name, senderId: me.id, text,
      type: mediaType, fileId: row.fileId, mediaKey, replyToMsgId: input.replyToMsgId ? Number(input.replyToMsgId) : undefined,
      replyPreview: input.replyPreview ? clip(input.replyPreview, 140) : undefined,
      senderMode: mode, byMember: me.id, ts: now() });
    await touchChat(chat.id, { lastText: text, lastSender: me.name, lastTs: now(), aiPendingUntil: 0 });
    try { await bump('messages_out'); } catch (e) { /* ignore */ }
    return { ok: true, msgId: sent.message_id, resolvedChatId: chat.id };
  }

  // ---------- متن ----------
  const text = String(input.text || '').trim();
  if (!text) throw new EndpointError('متن خالی است.');

  let sent;
  const target = chat ? chat.id : (isNumeric ? numeric : '@' + raw.replace(/^@/, ''));
  try {
    sent = await sendText({
      chatId: target,
      text,
      bizId: mode === 'me' ? chat.bizId : null,
      replyTo: input.replyToMsgId,
      markdown: false,
    });
  } catch (e) { throw new EndpointError(faError(e)); }

  // چت تازه: شناسه‌ی واقعی را از پاسخ تلگرام بگیر و ثبتش کن.
  const chatId = chat ? chat.id : Number(sent.chat && sent.chat.id) || numeric;
  if (!chat) {
    const isGrp = !!(sent.chat && /group|supergroup|channel/.test(sent.chat.type || ''));
    await touchChat(chatId, {
      title: clip(String(input.customTitle || '').trim() || (sent.chat && sent.chat.title) || (sent.chat && sent.chat.username) || `چت ${chatId}`, 120),
      kind: (sent.chat && sent.chat.type) || 'private',
      isGroup: isGrp,
      hasBotChat: true,
      // چتی که از پنل شروع می‌شود به همان عضو تعلق دارد تا از دید خودش خارج نشود.
      ownerId: me.id,
      ownerName: me.name,
    });
  }

  await addMessage({ chatId, msgId: sent.message_id, role: 'admin', sender: me.name, senderId: me.id, text,
    replyToMsgId: input.replyToMsgId ? Number(input.replyToMsgId) : undefined, replyPreview: input.replyPreview ? clip(input.replyPreview, 140) : undefined,
    senderMode: mode, byMember: me.id, ts: now() });
  await touchChat(chatId, { lastText: clip(text, 200), lastSender: me.name, lastTs: now(), aiPendingUntil: 0 });
  try { await bump('messages_out'); } catch (e) { /* ignore */ }
  return { ok: true, msgId: sent.message_id, resolvedChatId: chatId };
}
