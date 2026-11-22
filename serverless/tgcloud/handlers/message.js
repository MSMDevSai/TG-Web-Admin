import { api } from 'sdk';
import { ingest } from '../lib/ingest.js';
import { memberRole, getSettings, saveMemberSettings } from '../lib/store.js';
import { tryHandle as anonHandle } from '../lib/anon.js';
import { db } from 'sdk';
import { eq } from 'sdk/db';
import { members } from '../schema.js';
import { now } from '../lib/util.js';
import { keyOf, keyGuide, aiKeyboard, panelKeyboard, maybeAskKey } from '../lib/aiOnboarding.js';

// پیام‌های مستقیم به ربات. اعضای پنل فقط دستور می‌گیرن؛ بقیه مثل یک چت عادی ذخیره و (در صورت فعال بودن) جواب داده می‌شن.
export default async function (msg) {
  // پیام ناشناس اول بررسی می‌شود تا هرگز وارد ذخیره‌ی عادی چت‌ها (پنل) نشود
  if (await anonHandle(msg)) return;
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

  // ─── ثبت کلید Google AI Studio (ارسال مستقیم در چت یا /key <token>) ───
  const key = keyOf(text);
  if (key) {
    await saveMemberSettings(id, { geminiApiKey: key, onboardedAt: now() });
    await api.sendMessage({
      chat_id: id,
      text: '✅ کلید Google AI Studio ذخیره شد.\nفقط برای پاسخ‌های AI اکانت خودت استفاده می‌شه.\n\n' +
        'برای امنیت بیشتر، همین پیامِ حاوی کلید رو از چت پاک کن.',
    });
    return;
  }

  if (cmd === '/key' || cmd === '/apikey' || cmd === '/token') {
    await api.sendMessage({ chat_id: id, text: keyGuide(), reply_markup: aiKeyboard() });
    return;
  }

  if (cmd === '/notify' && (arg === 'on' || arg === 'off')) {
    const on = arg === 'on';
    await db.insert(members).values({ tgId: id, role, name: msg.from.first_name || '', notify: on })
      .onConflictDoUpdate({ target: members.tgId, set: { notify: on } }).run();
    await api.sendMessage({ chat_id: id, text: on ? '🔔 اعلان‌ها روشن شد.' : '🔕 اعلان‌ها خاموش شد. (با /notify on دوباره روشن می‌شه)' });
    return;
  }

  if (cmd === '/panel' || cmd === '/settings') {
    await api.sendMessage({ chat_id: id, text: '📱 پنل و تنظیمات از همین‌جا باز می‌شه.', reply_markup: panelKeyboard() });
    return;
  }

  // ─── پیام عادی: راهنما + (در صورت نیاز) درخواست کلید ───
  const st = await getSettings();
  const usingDefault = st.share_gemini_key !== false && !!String(st.gemini_api_key || '').trim();

  let out = `سلام! 👋 تو ${role === 'admin' ? 'ادمین' : 'کاربر'} این پنل هستی.\n\n` +
    '/notify on  ← روشن کردن اعلان پیام‌ها\n' +
    '/notify off ← خاموش کردن اعلان‌ها\n' +
    '/key ← راهنمای ثبت کلید AI\n' +
    '/panel ← باز کردن پنل';
  if (usingDefault) out += '\n\nℹ️ الان از کلید پیش‌فرض ادمین برای AI استفاده می‌کنی.';

  await api.sendMessage({ chat_id: id, text: out, reply_markup: panelKeyboard(), disable_web_page_preview: true });

  // اولین پیام/هر ۷ روز: درخواست کلید اختصاصی (کلید هرگز از پنل برنمی‌گردد).
  try { await maybeAskKey(id); } catch (e) { /* ربات بلاک شده یا شبکه */ }
}
