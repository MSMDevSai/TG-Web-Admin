import { db, api, InputFile, EndpointError } from 'sdk';
import { eq, lt, asc } from 'sdk/db';
import { uploadParts } from '../schema.js';
import { requireMember } from '../lib/auth.js';
import { assertCanWrite } from '../lib/scope.js';
import { getChat, touchChat, addMessage, getSettings } from '../lib/store.js';
import { describeMedia, archiveMedia } from '../lib/media.js';
import { b64decode, concat } from '../lib/b64.js';
import { now, clip, faError } from '../lib/util.js';

const METHOD = { photo: 'sendPhoto', video: 'sendVideo', voice: 'sendVoice', audio: 'sendAudio', document: 'sendDocument', animation: 'sendAnimation' };

// آپلود تکه‌تکه (base64) از Mini App. با آخرین تکه، فایل کامل ساخته و ارسال می‌شه.
export default async function (input, ctx) {
  const me = await requireMember(ctx);
  const uploadId = String(input.uploadId || '');
  const part = Number(input.part), parts = Number(input.parts);
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(uploadId) || !(part >= 0) || !(parts >= 1) || part >= parts) throw new EndpointError('درخواست آپلود نامعتبر است.');
  if (parts > 400) throw new EndpointError('حجم فایل بیش از حد مجاز است.');
  // آپلود هر عضو جدا نگه داشته می‌شود تا کسی با حدس uploadId تکه‌های دیگری را عوض نکند.
  const uid = me.id + ':' + uploadId;

  await db.delete(uploadParts).where(lt(uploadParts.ts, now() - 3600000)).run();   // پاکسازی تکه‌های رهاشده
  const key = `${uid}:${part}`;
  const b64 = String(input.b64 || '');
  if (b64.length > 700000) throw new EndpointError('تکه‌ی آپلود بیش از حد بزرگ است.');
  await db.insert(uploadParts).values({ key, uploadId: uid, part, data: b64, ts: now() })
    .onConflictDoUpdate({ target: uploadParts.key, set: { data: b64, ts: now() } }).run();
  if (part < parts - 1) return { done: false };

  const rows = await db.select().from(uploadParts).where(eq(uploadParts.uploadId, uid)).orderBy(asc(uploadParts.part)).all();
  if (rows.length !== parts) throw new EndpointError('آپلود ناقص بود؛ دوباره امتحان کن.');
  const bytes = concat(rows.map((r) => b64decode(r.data)));
  await db.delete(uploadParts).where(eq(uploadParts.uploadId, uid)).run();
  if (bytes.length > 25 * 1048576) throw new EndpointError('حجم فایل باید کمتر از ۲۵ مگابایت باشد.');

  const meta = input.meta || {};
  const chat = await getChat(Number(meta.chatId));
  if (!chat) throw new EndpointError('چت پیدا نشد.');
  assertCanWrite(me, chat);
  let kind = METHOD[meta.kind] ? meta.kind : 'document';
  if (kind === 'photo' && bytes.length > 10 * 1048576) kind = 'document';
  const mode = meta.mode === 'me' ? 'me' : 'bot';
  if (mode === 'me' && !chat.bizId) throw new EndpointError('این چت اتصال بیزینسی ندارد؛ حالت «ربات» را انتخاب کن.');

  const filename = String(meta.filename || kind).slice(0, 100);
  const mime = String(meta.mime || 'application/octet-stream');
  const caption = String(meta.caption || '').slice(0, 1000);

  const attempt = async (k) => {
    const p = { chat_id: chat.id, [k]: new InputFile(bytes, filename, { type: mime }) };
    if (caption) p.caption = caption;
    if (mode === 'me') p.business_connection_id = chat.bizId;
    if (meta.replyToMsgId) p.reply_parameters = { message_id: Number(meta.replyToMsgId), allow_sending_without_reply: true };
    return api[METHOD[k]](p);
  };

  // ویس: اگر فرمت صوتی مرورگر برای sendVoice قابل‌قبول نبود، به ترتیب audio و بعد document
  const chain = kind === 'voice' ? ['voice', 'audio', 'document'] : [kind];
  let sent = null, lastErr = null;
  for (const k of chain) {
    try { sent = await attempt(k); break; } catch (e) { lastErr = e; }
  }
  if (!sent) throw new EndpointError(faError(lastErr));

  const st = await getSettings();
  const info = describeMedia(sent);
  if (info) await archiveMedia(info, st, bytes);
  const text = caption || (info ? info.ph : '');
  await addMessage({ chatId: chat.id, msgId: sent.message_id, role: 'admin', sender: me.name, senderId: me.id, text,
    type: info ? info.type : null, fileId: info ? info.fileId : null, mediaKey: info ? info.key : null,
    senderMode: mode, byMember: me.id, ts: now() });
  await touchChat(chat.id, { lastText: clip(text, 200), lastSender: me.name, lastTs: now(), aiPendingUntil: 0 });
  return { done: true, msgId: sent.message_id };
}
