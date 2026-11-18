import { EndpointError } from 'sdk';
import {
  listPanelUsers, createPanelUser, setSuspended, deletePanelUser,
  setTelegramId, setBotToken,
} from '../lib/panelAuth.js';

// مدیریت کاربران پنل (فقط ادمین)
// op: list | create | suspend | unsuspend | delete | telegram-id | bot | password
export default async function (input, ctx) {
  const { op, username, password, telegramId, role, suspended } = input || {};

  if (op === 'list') {
    return { users: await listPanelUsers() };
  }

  if (op === 'create') {
    if (!username || !password) throw new EndpointError('یوزرنیم و رمز الزامی است.', { code: 'MISSING_FIELDS' });
    return await createPanelUser(username, password, telegramId, role);
  }

  if (op === 'suspend' || op === 'unsuspend') {
    if (!username) throw new EndpointError('یوزرنیم الزامی است.', { code: 'MISSING_USERNAME' });
    return await setSuspended(username, op === 'suspend');
  }

  if (op === 'delete') {
    if (!username) throw new EndpointError('یوزرنیم الزامی است.', { code: 'MISSING_USERNAME' });
    return await deletePanelUser(username);
  }

  if (op === 'telegram-id') {
    if (!username) throw new EndpointError('یوزرنیم الزامی است.', { code: 'MISSING_USERNAME' });
    return await setTelegramId(username, telegramId);
  }

  if (op === 'bot') {
    if (!username) throw new EndpointError('یوزرنیم الزامی است.', { code: 'MISSING_USERNAME' });
    return await setBotToken(username, password);
  }

  if (op === 'password') {
    if (!username || !password) throw new EndpointError('یوزرنیم و رمز جدید الزامی است.', { code: 'MISSING_FIELDS' });
    return await setPasswordByAdmin(username, password);
  }

  throw new EndpointError('عملیات نامعتبر است.', { code: 'BAD_OP' });
}
