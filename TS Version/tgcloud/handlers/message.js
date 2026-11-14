import { api } from 'sdk';
import { ingest } from '../lib/ingest.js';
import { memberRole } from '../lib/store.js';
import { WEBAPP_URL } from '../lib/config.js';
import { db } from 'sdk';
import { eq } from 'sdk/db';
import { members } from '../schema.js';

// پیام‌های مستقیم به ربات. اعضای پنل فقط دستور می‌گیرن؛ بقیه مثل یک چت عادی ذخیره و (در صورت فعال بودن) جواب داده می‌شن.
export default async function (msg) {
  if (msg.chat.type === 'private' && msg.from) {
    const role = await memberRole(msg.from.id);
    if (role) { await memberDm(msg, role); return; }
  }
  await ingest(msg);
}

async function memberDm(msg, role) {
  const text = String(msg.text || '').trim();
  const cmd = text.split(/\s+/)[0].split('@')[0].toLowerCase();
  const arg = (text.split(/\s+/)[1] || '').toLowerCase();
  const id = msg.from.id;

  if (cmd === '/notify' && (arg === 'on' || arg === 'off')) {
    const on = arg === 'on';
    await db.insert(members).values({ tgId: id, role, name: msg.from.first_name || '', notify: on })
      .onConflictDoUpdate({ target: members.tgId, set: { notify: on } }).run();
    await api.sendMessage({ chat_id: id, text: on ? '🔔 اعلان‌ها روشن شد.' : '🔕 اعلان‌ها خاموش شد. (با /notify on دوباره روشن می‌شه)' });
    return;
  }

  const p = { chat_id: id, text: `سلام! تو ${role === 'admin' ? 'ادمین' : 'کاربر'} این پنل هستی.\n\n/notify on  ← روشن کردن اعلان پیام‌ها\n/notify off ← خاموش کردن اعلان‌ها` };
  if (WEBAPP_URL) p.reply_markup = { inline_keyboard: [[{ text: '📱 باز کردن پنل', web_app: { url: WEBAPP_URL } }]] };
  await api.sendMessage(p);
}
