import { EndpointError } from 'sdk';
import { resetPassword } from '../lib/panelAuth.js';

// بازیابی رمز با کد یک‌بار مصرف
export default async function (input) {
  const { code, newPassword } = input || {};
  if (!code || !newPassword) throw new EndpointError('کد و رمز جدید الزامی است.', { code: 'MISSING_FIELDS' });
  return await resetPassword(code, newPassword);
}
