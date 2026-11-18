import { EndpointError } from 'sdk';
import { loginWithPassword } from '../lib/panelAuth.js';

// ورود با یوزرنیم/پسورد (دسترسی خارج از تلگرام)
export default async function (input, ctx) {
  const { username, password, deviceInfo } = input || {};
  if (!username || !password) throw new EndpointError('یوزرنیم و رمز عبور الزامی است.', { code: 'MISSING_CREDENTIALS' });
  return await loginWithPassword(username, password, deviceInfo || {});
}
