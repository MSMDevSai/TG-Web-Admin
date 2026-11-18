import { deleteSession } from '../lib/panelAuth.js';

// خروج از پنل (توکن جلسه از input می‌آید)
export default async function (input) {
  const token = input?.token;
  if (token) await deleteSession(token);
  return { ok: true };
}
