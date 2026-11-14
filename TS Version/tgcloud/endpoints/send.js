import { EndpointError } from 'sdk';
import { requireMember } from '../lib/auth.js';
import { getChat, touchChat, addMessage } from '../lib/store.js';
import { sendText } from '../lib/tg.js';
import { now, clip, faError } from '../lib/util.js';

// ارسال متن از پنل. mode: 'me' (با اکانت بیزینس، به‌جای خودت) یا 'bot' (از طرف ربات)
export default async function (input, ctx) {
  const me = await requireMember(ctx);
  const chat = await getChat(Number(input.chatId));
  if (!chat) throw new EndpointError('چت پیدا نشد.');
  const text = String(input.text || '').trim();
  if (!text) throw new EndpointError('متن خالی است.');
  const mode = input.mode === 'me' ? 'me' : 'bot';
  if (mode === 'me' && !chat.bizId) throw new EndpointError('این چت اتصال بیزینسی ندارد؛ حالت «ربات» را انتخاب کن.');

  let sent;
  try {
    sent = await sendText({ chatId: chat.id, text, bizId: mode === 'me' ? chat.bizId : null, replyTo: input.replyToMsgId, markdown: false });
  } catch (e) { throw new EndpointError(faError(e)); }

  await addMessage({ chatId: chat.id, msgId: sent.message_id, role: 'admin', sender: me.name, senderId: me.id, text,
    replyToMsgId: input.replyToMsgId ? Number(input.replyToMsgId) : undefined, replyPreview: input.replyPreview ? clip(input.replyPreview, 140) : undefined,
    senderMode: mode, byMember: me.id, ts: now() });
  await touchChat(chat.id, { lastText: clip(text, 200), lastSender: me.name, lastTs: now(), aiPendingUntil: 0 });
  return { ok: true, msgId: sent.message_id };
}
