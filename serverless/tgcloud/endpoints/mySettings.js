import { EndpointError } from 'sdk';
import { requireMember } from '../lib/auth.js';
import { getMemberSettings, saveMemberSettings, userOverrides, getSettingsFor, getSettings } from '../lib/store.js';

// تنظیمات AI شخصیِ هر عضو.
// پیش‌فرض‌ها را ادمین در `settings` می‌گذارد؛ این اندپوینت فقط overrideهای خودِ
// کاربر را ذخیره می‌کند و مقدار «مؤثر» (پیش‌فرض + override) را برمی‌گرداند.
// کلید Gemini هرگز برنمی‌گردد؛ فقط وجودش.

const MODEL_MAX = 80, PROMPT_MAX = 8000, LABEL_MAX = 80;
const KEY_RE = /^AIza[0-9A-Za-z_\-]{20,}$/;

async function summary(tgId) {
  const st = await getSettingsFor(tgId);
  const row = await getMemberSettings(tgId);
  const own = userOverrides(row);
  const glob = await getSettings();
  const ownKey = !!String((row && row.geminiApiKey) || '').trim();
  const defaultKey = !!String(glob.gemini_api_key || '').trim();
  const shared = glob.share_gemini_key !== false;

  return {
    ok: true,
    settings: {
      ai_mode: !!st.ai_mode,
      gemini_model: String(st.gemini_model || ''),
      // پرامپت پیش‌فرض ادمین برگردانده نمی‌شود؛ فقط override خودِ کاربر.
      assistant_label: String(st.assistant_label || ''),
      has_key: !!String(st.gemini_api_key || '').trim(),
      has_own_key: ownKey,
      using_default_key: !ownKey && defaultKey && shared,
      share_default_key: shared,
    },
    overrides: {
      ai_mode: 'ai_mode' in own ? (own.ai_mode ? 'on' : 'off') : null,
      gemini_model: own.gemini_model || null,
      system_prompt: own.system_prompt || null,
      assistant_label: own.assistant_label || null,
      has_own_key: ownKey,
    },
    defaults: {
      ai_mode: !!glob.ai_mode,
      gemini_model: String(glob.gemini_model || ''),
      has_key: defaultKey,
      share_default_key: shared,
    },
  };
}

export default async function (input, ctx) {
  const me = await requireMember(ctx);
  const op = input.op || 'get';
  const v = input.values || {};

  if (op === 'save') {
    const patch = {};

    if ('gemini_model' in v) {
      const m = String(v.gemini_model || '').trim().slice(0, MODEL_MAX);
      patch.geminiModel = m || null;              // خالی = برگشت به پیش‌فرض
    }
    if ('system_prompt' in v) {
      const p = String(v.system_prompt || '').trim().slice(0, PROMPT_MAX);
      patch.systemPrompt = p || null;
    }
    if ('assistant_label' in v) {
      const l = String(v.assistant_label || '').trim().slice(0, LABEL_MAX);
      patch.assistantLabel = l || null;
    }
    if ('ai_mode' in v) {
      patch.aiMode = v.ai_mode === null ? null : (v.ai_mode ? 'on' : 'off');
    }
    if (typeof v.gemini_api_key === 'string' && v.gemini_api_key.trim()) {
      const key = v.gemini_api_key.trim();
      if (!KEY_RE.test(key)) throw new EndpointError('کلید Google AI Studio معتبر نیست (باید با AIza شروع شود).');
      patch.geminiApiKey = key;
    }
    if (v.clear_gemini_key) patch.geminiApiKey = '';
    if (!Object.keys(patch).length) throw new EndpointError('مقداری برای ذخیره نیست.');

    await saveMemberSettings(me.id, patch);
  } else if (op === 'reset') {
    // همهٔ overrideها (جز کلید) پاک می‌شوند؛ مدل/پرامپت/حالت به پیش‌فرض ادمین برمی‌گردد.
    await saveMemberSettings(me.id, { geminiModel: null, systemPrompt: null, assistantLabel: null, aiMode: null });
  } else if (op !== 'get') {
    throw new EndpointError('عملیات نامعتبر.');
  }

  return await summary(me.id);
}
