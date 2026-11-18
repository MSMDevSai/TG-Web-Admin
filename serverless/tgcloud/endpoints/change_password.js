import { EndpointError } from 'sdk';
import { authenticateSession, changePassword, setPasswordByAdmin } from '../lib/panelAuth.js';

// تغییر رمز با رمز فعلی (لازم است کاربر وارد شده باشد)
// خارج از تلگرام: از توکن جلسه برای یافتن یوزرنیم استفاده می‌شود
export default async function (input, ctx) {
  const { currentPassword, newPassword, username } = input || {};

  let targetUser = username;
  if (!targetUser && ctx && ctx.initData && ctx.initData.user) {
    targetUser = 'tg_' + ctx.initData.user.id;
  }
  if (!targetUser && input?.token) {
    const sess = await authenticateSession(input.token);
    if (!sess) throw new EndpointError('جلسه منقضی شده است.', { code: 'SESSION_EXPIRED' });
    targetUser = sess.username;
  }

  if (!targetUser || !currentPassword || !newPassword) {
    throw new EndpointError('همه فیلدها الزامی است.', { code: 'MISSING_FIELDS' });
  }
  return await changePassword(targetUser, currentPassword, newPassword);
}
