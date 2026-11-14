import { requireMember } from '../lib/auth.js';
import { getSettings } from '../lib/store.js';
import { WEBAPP_URL } from '../lib/config.js';

// اولین فراخوانی Mini App: من کی‌ام، نقشم چیه، تنظیمات
export default async function (input, ctx) {
  const me = await requireMember(ctx);
  const st = await getSettings();
  const out = {
    me: { id: me.id, role: me.role, name: me.name, notify: me.row ? !!me.row.notify : true },
    notifyEnabled: !!st.notify_enabled,
    webappUrl: WEBAPP_URL,
  };
  if (me.role === 'admin') {
    const { gemini_api_key, ...rest } = st;
    out.settings = { ...rest, has_key: !!String(gemini_api_key || '').trim() };
  }
  return out;
}
