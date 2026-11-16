import { BotApiError } from 'sdk';

export const now = () => Date.now();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
export const fullName = (u) => [u?.first_name, u?.last_name].filter(Boolean).join(' ');
export const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// ترجمه‌ی خطاهای رایج تلگرام
export function faError(e) {
  const d = String((e instanceof BotApiError ? e.description : e?.message) || e || '');
  const l = d.toLowerCase();
  if (!d) return 'خطای نامشخصی از تلگرام دریافت شد.';
  if (l.includes("can't be pinned") || l.includes('not enough rights to pin')) return 'امکان سنجاق این پیام در تلگرام نیست (دسترسی یا نوع چت).';
  if (l.includes("can't initiate") || l.includes('bot can')) return 'این کاربر مستقیماً به ربات پیام نداده (فقط با اکانت بیزینسی چت کرده)، پس ربات نمی‌تونه بهش پیام شروع کنه. حالت ارسال «من» رو انتخاب کن.';
  if (l.includes('chat not found')) return 'این چت/کاربر پیدا نشد.';
  if (l.includes('blocked')) return 'کاربر ربات رو بلاک کرده.';
  if (l.includes('not enough rights') || l.includes('no rights')) return 'ربات دسترسی لازم رو نداره.';
  if (l.includes('business connection')) return 'اتصال بیزینسی معتبر نیست یا قطع شده.';
  if (l.includes('message to edit not found')) return 'پیام اصلی برای ویرایش پیدا نشد.';
  if (l.includes('message is not modified')) return 'متن جدید با قبلی یکیه.';
  if (l.includes("can't be deleted") || l.includes('message to delete not found')) return 'این پیام قابل حذف نیست یا قبلاً حذف شده.';
  if (l.includes('chat_admin_required') || l.includes('need to be an administrator') || l.includes('not enough rights to restrict')) return 'ربات در این گروه ادمین نیست یا دسترسی لازم (بن/میوت/حذف پیام) را ندارد.';
  if (l.includes('administrator of the chat') || l.includes("can't remove chat owner") || l.includes("can't restrict")) return 'روی ادمین یا مالک گروه نمی‌شود اقدام کرد.';
  if (l.includes('user not found') || l.includes('participant_id_invalid') || l.includes('user_id_invalid')) return 'این کاربر پیدا نشد.';
  if (l.includes('supergroup') && l.includes('only')) return 'این قابلیت فقط در سوپرگروه‌ها کار می‌کند.';
  if (l.includes('message identifier is not specified') || l.includes('message_id_invalid')) return 'شناسه‌ی پیام نامعتبر است.';
  if (l.includes('too many requests')) return 'تلگرام موقتاً محدود کرده؛ کمی بعد دوباره امتحان کن.';
  return d;
}
