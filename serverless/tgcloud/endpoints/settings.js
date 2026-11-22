import { EndpointError } from 'sdk';
import { requireMember } from '../lib/auth.js';
import { getSettings, saveSettings } from '../lib/store.js';

const NUM = { ai_delay_seconds: [1, 600], ai_history_limit: [5, 400], archive_max_mb: [1, 20], anon_rate_per_hour: [1, 1000], anon_retention_days: [1, 90] };
const BOOL = ['ai_mode', 'notify_enabled', 'notify_deleted', 'archive_media', 'archive_video_note', 'anon_enabled', 'share_gemini_key', 'filter_enabled'];
const STR = { system_prompt: 8000, gemini_model: 80, assistant_label: 80, admin_group_id: 30, banned_words: 4000 };

// فقط ادمین. کلید Gemini هیچ‌وقت برگردانده نمی‌شه؛ فقط خالی نبودنش.
export default async function (input, ctx) {
  await requireMember(ctx, true);
  if (input.op === 'save') {
    const v = input.values || {};
    const out = {};
    for (const [k, [lo, hi]] of Object.entries(NUM)) if (k in v) { const n = Number(v[k]); if (!(n >= lo && n <= hi)) throw new EndpointError(`مقدار ${k} باید بین ${lo} و ${hi} باشد.`); out[k] = n; }
    for (const k of BOOL) if (k in v) out[k] = !!v[k];
    for (const [k, max] of Object.entries(STR)) if (k in v) out[k] = String(v[k] ?? '').trim().slice(0, max);
    if (typeof v.gemini_api_key === 'string' && v.gemini_api_key.trim()) out.gemini_api_key = v.gemini_api_key.trim();
    if (v.clear_gemini_key) out.gemini_api_key = '';
    if (out.admin_group_id && !/^-?\d+$/.test(out.admin_group_id)) throw new EndpointError('آیدی گروه ادمین باید عدد باشد.');
    await saveSettings(out);
  }
  const { gemini_api_key, ...rest } = await getSettings();
  return { settings: { ...rest, has_key: !!String(gemini_api_key || '').trim() } };
}
