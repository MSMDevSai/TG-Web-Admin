import { getChat, touchChat } from '../lib/store.js';
import { claimChat } from '../lib/scope.js';
import { fullName } from '../lib/util.js';

// ربات به گروه/کانال اضافه شد → صاحب چت = کسی که اضافه کرده.
// (اگر بعداً عضو دیگری پیام بفرستد و صاحب هنوز نامعلوم باشد، ingest خودش ثبت می‌کند.)
export default async function (u) {
  const chat = u && u.chat;
  const member = u && u.new_chat_member;
  if (!chat || !member || !chat.id) return;
  const botUser = member.user || {};
  if (!botUser.is_bot) return;
  const status = member.status;
  if (status !== 'member' && status !== 'administrator') return;
  if (!/^(group|supergroup|channel)$/.test(chat.type || '')) return;

  let row = await getChat(chat.id);
  if (!row) {
    await touchChat(chat.id, {
      title: chat.title || '',
      kind: chat.type,
      isGroup: chat.type !== 'channel',
    });
    row = await getChat(chat.id);
  }
  if (!row) return;

  const from = u.from || {};
  if (from.id) await claimChat(row, from.id, fullName(from));
}
