import { saveConnection } from '../lib/store.js';
export default async function (c) {
  if (c && c.id && c.user) await saveConnection(c.id, c.user.id, c.is_enabled !== false);
}
