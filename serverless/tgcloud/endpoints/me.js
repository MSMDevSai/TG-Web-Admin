import { EndpointError } from 'sdk';
import { eq } from 'sdk/db';
import { authenticateSession } from '../lib/panelAuth.js';
import { memberRole } from '../lib/store.js';
import { BOOTSTRAP_ADMINS } from '../lib/config.js';
import { members } from '../schema.js';
import { db } from 'sdk';

// اطلاعات کاربر فعلی — کارکرد دوگانه:
//  - داخل تلگرام: از initData (تélégram numeric ID) استفاده می‌شود
//  - خارج از تلگرام: از توکن جلسه (session token) در input استفاده می‌شود
export default async function (input, ctx) {
  const token = input?.token;
  let user = null;

  if (token) {
    user = await authenticateSession(token);
    if (!user) throw new EndpointError('جلسه منقضی شده است.', { code: 'SESSION_EXPIRED' });
  } else if (ctx && ctx.initData && ctx.initData.user) {
    const tgId = Number(ctx.initData.user.id);
    const role = await memberRole(tgId);
    if (!role) throw new EndpointError('دسترسی به پنل ندارید.', { code: 'FORBIDDEN' });
    user = {
      username: 'tg_' + tgId,
      role,
      telegramId: tgId,
      is_owner: BOOTSTRAP_ADMINS.includes(tgId),
      suspended: false,
    };
  } else {
    throw new EndpointError('احراز هویت لازم است.', { code: 'UNAUTHORIZED' });
  }

  return {
    username: user.username,
    role: user.role,
    telegramId: user.telegramId,
    is_owner: user.is_owner,
    suspended: !!user.suspended,
  };
}
