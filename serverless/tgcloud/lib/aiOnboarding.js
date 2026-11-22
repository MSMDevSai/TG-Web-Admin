import { api } from 'sdk';
import { WEBAPP_URL } from './config.js';
import { getSettings, getMemberSettings, saveMemberSettings, memberRole } from './store.js';
import { now } from './util.js';

// درخواست کلید اختصاصی Google AI Studio از اعضای پنل.
// هر عضو (صاحب اکانت/چت‌ها) کلید خودش را دارد؛ اگر نداشته باشد و ادمین اجازه
// داده باشد، از کلید پیش‌فرض استفاده می‌شود. کلید با /key یا داخل پنل ثبت می‌شود.

export const KEY_RE = /AIza[0-9A-Za-z_\-]{20,}/;
const ASK_EVERY = 7 * 86400000;               // اگر کلید ثبت نشده، هر چند وقت یادآوری شود

export function keyOf(text) {
  const m = String(text || '').match(KEY_RE);
  return m ? m[0] : null;
}

export function panelKeyboard(label) {
  if (!WEBAPP_URL) return undefined;
  return { inline_keyboard: [[{ text: label || '📱 باز کردن پنل', web_app: { url: WEBAPP_URL } }]] };
}

// دکمه‌ای که مستقیم بخش «هوش مصنوعی» تنظیمات را در Mini App باز می‌کند
export function aiKeyboard() {
  if (!WEBAPP_URL) return undefined;
  const url = WEBAPP_URL + (WEBAPP_URL.includes('?') ? '&' : '?') + 'settings=ai';
  return { inline_keyboard: [
    [{ text: '⚙️ تنظیمات هوش مصنوعی', web_app: { url } }],
    [{ text: '📱 باز کردن پنل', web_app: { url: WEBAPP_URL } }],
  ] };
}

export function keyGuide() {
  return (
    '🔑 کلید اختصاصی Google AI Studio\n' +
    'برای اینکه پاسخ‌های AI با سهمیهٔ خودت ارسال بشن، یک کلید بگیر:\n' +
    'https://aistudio.google.com/apikey\n\n' +
    'ثبتش کن:\n' +
    '• پنل → تنظیمات → هوش مصنوعی → «کلید من»، یا\n' +
    '• همین‌جا بنویس: /key AIza...\n' +
    '(بعد از ارسال، پیام حاوی کلید را از چت پاک کن.)'
  );
}

export async function hasOwnKey(tgId) {
  const row = await getMemberSettings(tgId);
  return !!String((row && row.geminiApiKey) || '').trim();
}

// اگر کلید ندارد، یک‌بار (هر ۷ روز) راهنما را در چت خصوصی بفرست.
export async function maybeAskKey(tgId, { force = false } = {}) {
  const row = await getMemberSettings(tgId);
  if (String((row && row.geminiApiKey) || '').trim()) return false;

  const st = await getSettings();
  // ادمینی که کلید پیش‌فرض را خودش گذاشته، به کلید جداگانه نیاز ندارد.
  if (await memberRole(tgId) === 'admin' && String(st.gemini_api_key || '').trim()) return false;

  const last = Number(row && row.onboardedAt) || 0;
  if (!force && last && now() - last < ASK_EVERY) return false;

  const usingDefault = st.share_gemini_key !== false && !!String(st.gemini_api_key || '').trim();
  const text = keyGuide() +
    '\n\n🧠 مدل، پرامپت و برچسب دستیار رو هم می‌تونی برای خودت عوض کنی؛ ' +
    'هر چیزی که تعیین نکنی از پیش‌فرض ادمین استفاده می‌شه.' +
    (usingDefault ? '\n\nℹ️ تا وقتی کلید خودت را ثبت نکنی، از کلید پیش‌فرض ادمین استفاده می‌شه.' : '');

  await api.sendMessage({ chat_id: tgId, text, reply_markup: aiKeyboard(), disable_web_page_preview: true });
  await saveMemberSettings(tgId, { onboardedAt: now() });
  return true;
}
