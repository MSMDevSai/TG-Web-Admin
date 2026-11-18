import { EndpointError } from 'sdk';
import { requestPasswordReset } from '../lib/panelAuth.js';

// درخواست بازیابی رمز — ارسال کد یک‌بار مصرف به تلگرام
export default async function (input) {
  const { username } = input || {};
  if (!username) throw new EndpointError('یوزرنیم الزامی است.', { code: 'MISSING_USERNAME' });
  return await requestPasswordReset(username);
}
