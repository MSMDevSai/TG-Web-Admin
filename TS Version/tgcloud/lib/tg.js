import { api, BotApiError } from 'sdk';

// ارسال متن؛ اگر Markdown شکست خورد بدون parse_mode دوباره
export async function sendText({ chatId, text, bizId, replyTo, markdown = true }) {
  const p = { chat_id: chatId, text };
  if (markdown) p.parse_mode = 'Markdown';
  if (bizId) p.business_connection_id = bizId;
  if (replyTo) p.reply_parameters = { message_id: Number(replyTo), allow_sending_without_reply: true };
  try {
    return await api.sendMessage(p);
  } catch (e) {
    if (markdown && e instanceof BotApiError && /parse|entit/i.test(e.description || '')) {
      delete p.parse_mode;
      return await api.sendMessage(p);
    }
    throw e;
  }
}
