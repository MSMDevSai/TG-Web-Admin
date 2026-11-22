import { api, EndpointError } from 'sdk';
import { requireMember } from '../lib/auth.js';
import { assertCanWrite } from '../lib/scope.js';
import { findByTg, getChat, touchChat, addMessage } from '../lib/store.js';
import { now, clip, faError } from '../lib/util.js';

// فوروارد پیام‌ها به یک یا چند چت دیگر. چون پیام‌های چت بیزینس با forwardMessage قابل فوروارد نیستند،
// محتوا (متن یا file_id رسانه) دوباره ارسال می‌شود و در صورت showOrigin بالایش «↪ فوروارد از …» می‌آید.
const MEDIA = {
  photo: ['sendPhoto', 'photo', true], video: ['sendVideo', 'video', true], voice: ['sendVoice', 'voice', true],
  audio: ['sendAudio', 'audio', true], document: ['sendDocument', 'document', true], animation: ['sendAnimation', 'animation', true],
  sticker: ['sendSticker', 'sticker', false], video_note: ['sendVideoNote', 'video_note', false],
};
const PLACEHOLDER = /^\[(عکس|ویدیو|ویدیو مسیج|ویس|موزیک|گیف|فایل)\]/;
const realText = (row) => (row.type === 'sticker' || PLACEHOLDER.test(row.text || '')) ? '' : (row.text || '');

export default async function (input, ctx) {
  const me = await requireMember(ctx);
  const srcId = Number(input.chatId);
  const src = await getChat(srcId);
  if (!src) throw new EndpointError('چت مبدأ پیدا نشد.');
  assertCanWrite(me, src);
  const ids = [...new Set((Array.isArray(input.msgIds) ? input.msgIds : [input.msgId]).map(Number))].filter(Boolean).slice(0, 20);
  const tgts = (Array.isArray(input.targets) ? input.targets : []).slice(0, 10);
  if (!ids.length || !tgts.length) throw new EndpointError('پیام یا مقصدی انتخاب نشده.');

  const rows = [];
  for (const id of ids) { const r = await findByTg(srcId, id); if (r) rows.push(r); }
  rows.sort((a, b) => a.id - b.id);
  if (!rows.length) throw new EndpointError('پیامی پیدا نشد.');

  const results = [];
  for (const t of tgts) {
    const target = await getChat(Number(t.chatId));
    if (!target) { results.push({ chatId: t.chatId, ok: false, error: 'چت پیدا نشد.' }); continue; }
    try { assertCanWrite(me, target); }
    catch (e) { results.push({ chatId: t.chatId, ok: false, error: e.message }); continue; }
    const mode = t.mode === 'me' && target.bizId && !target.isGroup ? 'me' : 'bot';
    let okCount = 0, error = null;
    for (const row of rows) {
      const origin = input.showOrigin === false ? '' : `↪ فوروارد از ${row.forwardedFrom || row.sender || src.title}`;
      const p = { chat_id: target.id };
      if (mode === 'me') p.business_connection_id = target.bizId;
      try {
        let sent, text;
        const m = row.type && row.fileId ? MEDIA[row.type] : null;
        if (m) {
          text = [m[2] ? origin : '', realText(row)].filter(Boolean).join('\n\n');
          sent = await api[m[0]]({ ...p, [m[1]]: row.fileId, ...(m[2] && text ? { caption: clip(text, 1024) } : {}) });
          if (!m[2] && origin) await api.sendMessage({ ...p, text: origin });
        } else {
          text = origin ? `${origin}\n\n${row.text}` : row.text;
          sent = await api.sendMessage({ ...p, text });
        }
        await addMessage({ chatId: target.id, msgId: sent.message_id, role: 'admin', sender: me.name, senderId: me.id, text: text || row.text,
          type: row.type, fileId: row.fileId, mediaKey: row.mediaKey, forwardedFrom: row.forwardedFrom || row.sender || src.title,
          senderMode: mode, byMember: me.id, ts: now() });
        await touchChat(target.id, { lastText: clip(text || row.text, 200), lastSender: me.name, lastTs: now(), aiPendingUntil: 0 });
        okCount++;
      } catch (e) { error = faError(e); break; }
    }
    results.push({ chatId: target.id, ok: okCount === rows.length, sent: okCount, error });
  }
  return { results };
}
