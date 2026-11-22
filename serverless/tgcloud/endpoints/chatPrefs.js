import { EndpointError } from 'sdk';
import { requireMember } from '../lib/auth.js';
import { assertCanWrite } from '../lib/scope.js';
import { getChat, touchChat } from '../lib/store.js';

// تنظیمات هر چت. pin/mute برای همه‌ی اعضا؛ aiMode/prompt فقط ادمین.
export default async function (input, ctx) {
  const me = await requireMember(ctx);
  const chat = await getChat(Number(input.chatId));
  if (!chat) throw new EndpointError('چت پیدا نشد.');
  assertCanWrite(me, chat);
  const patch = {};
  if (typeof input.pinned === 'boolean') patch.pinned = input.pinned;
  if (typeof input.muted === 'boolean') patch.muted = input.muted;
  if ('aiMode' in input || 'prompt' in input) {
    if (me.role !== 'admin') throw new EndpointError('تنظیمات هوش مصنوعی فقط برای ادمین است.', { code: 'FORBIDDEN' });
    if ('aiMode' in input) {
      if (![null, 'on', 'off'].includes(input.aiMode)) throw new EndpointError('مقدار نامعتبر.');
      patch.aiMode = input.aiMode;
    }
    if ('prompt' in input) patch.prompt = String(input.prompt || '').slice(0, 8000);
  }
  await touchChat(chat.id, patch);
  return { ok: true };
}
