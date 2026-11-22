// ═══════════════════════════════════════════════════════════════
//  Settings: per-user AI (key/model/prompt), admin defaults,
//  anonymous link management, and the `?settings=` deep link.
//  Loaded before the inline script in index.html.
// ═══════════════════════════════════════════════════════════════
function $id(id) { return document.getElementById(id); }
function $val(id) { const e = $id(id); return e ? e.value : ''; }

// Hide/show every `.owner-only` block according to the current role.
function applyRoleUi() {
  const admin = !!(S.me && S.me.role === 'admin');
  document.querySelectorAll('.owner-only').forEach((n) => n.classList.toggle('d-none', !admin));
}

function applyAdminSettings(s) {
  if (!s) return;
  if ($id('gAiToggle')) $id('gAiToggle').checked = s.ai_mode !== false;
  if ($id('gPrompt')) $id('gPrompt').value = s.system_prompt || '';
  if ($id('gModel')) $id('gModel').value = s.gemini_model || 'gemini-2.5-flash';
  if ($id('gDelay')) $id('gDelay').value = s.ai_delay_seconds || 28;
  if ($id('gShare')) $id('gShare').checked = s.share_gemini_key !== false;
  if ($id('gKey')) $id('gKey').value = '';
  if ($id('gKeyStatus')) {
    $id('gKeyStatus').textContent = s.has_key ? '✅ کلید پیش‌فرض ثبت شده است.' : 'کلید پیش‌فرض ثبت نشده است.';
  }
}

async function loadAdminDefaults() {
  if (!(S.me && S.me.role === 'admin')) return;
  try {
    const r = await call('settings', {});
    const s = r && r.settings ? r.settings : r;
    if (s && !s.error) applyAdminSettings(s);
  } catch (e) { /* فقط ادمین */ }
}

// ───────────── تنظیمات شخصی ─────────────
async function loadMyAi() {
  let r = null;
  try { r = await call('mySettings', { op: 'get' }); } catch (e) { r = null; }
  if (!r || !r.settings) return;
  const s = r.settings, o = r.overrides || {}, d = r.defaults || {};

  const model = $id('myModel');
  if (model) {
    const mine = o.gemini_model || '';
    if (mine && ![...model.options].some((op) => op.value === mine)) {
      const opt = document.createElement('option');
      opt.value = mine; opt.textContent = mine;
      model.appendChild(opt);
    }
    model.value = mine;
  }
  if ($id('myPrompt')) $id('myPrompt').value = o.system_prompt || '';
  if ($id('myKey')) $id('myKey').value = '';
  if ($id('myKeyStatus')) {
    $id('myKeyStatus').textContent = s.has_own_key
      ? '✅ کلید اختصاصی ثبت شده'
      : s.using_default_key
        ? 'استفاده از کلید پیش‌فرض ادمین'
        : 'کلید ثبت نشده (AI ممکن است پاسخ ندهد)';
  }
  if ($id('myDefaults')) {
    $id('myDefaults').textContent =
      `${d.gemini_model || '—'} · AI ${d.ai_mode ? 'فعال' : 'غیرفعال'} · ` +
      (d.has_key ? (d.share_default_key ? 'کلید پیش‌فرض مشترک' : 'کلید پیش‌فرض خصوصی') : 'بدون کلید پیش‌فرض');
  }

  const sum = $id('spAiSummary');
  if (sum) sum.textContent = s.has_own_key ? 'کلید شخصی' : (s.ai_mode ? 'پیش‌فرض' : 'غیرفعال');
}

async function saveMyAi() {
  const r = await safeCall('mySettings', {
    op: 'save',
    values: { gemini_model: $val('myModel'), system_prompt: $val('myPrompt') },
  });
  if (r && r.ok) {
    showToast('تنظیمات شما ذخیره شد', 'success');
    loadMyAi();
    refreshAiSummary();
  } else {
    showToast((r && (r.error || r.description)) || 'خطا در ذخیره', 'error', 4000);
  }
}

async function saveMyKey() {
  const key = $val('myKey').trim();
  if (!key) { showToast('کلید را وارد کنید', 'warn'); return; }
  const r = await safeCall('mySettings', { op: 'save', values: { gemini_api_key: key } });
  if (r && r.ok) {
    if ($id('myKey')) $id('myKey').value = '';
    showToast('کلید اختصاصی ذخیره شد', 'success');
    loadMyAi();
  } else {
    showToast((r && (r.error || r.description)) || 'کلید نامعتبر است', 'error', 4000);
  }
}

async function clearMyKey() {
  const r = await safeCall('mySettings', { op: 'save', values: { clear_gemini_key: true } });
  toastResult(r, 'کلید اختصاصی حذف شد');
  loadMyAi();
}

async function resetMyAi() {
  const r = await safeCall('mySettings', { op: 'reset' });
  toastResult(r, 'به پیش‌فرض‌های ادمین برگشت');
  loadMyAi();
}

async function clearDefaultKey() {
  const r = await safeCall('settings', { op: 'save', values: { clear_gemini_key: true } });
  if (r && r.settings) {
    showToast('کلید پیش‌فرض حذف شد', 'success');
    applyAdminSettings(r.settings);
    loadMyAi();
  } else {
    showToast((r && (r.error || r.description)) || 'خطا', 'error', 4000);
  }
}

// ───────────── پیام ناشناس ─────────────
async function loadAnon() {
  const body = $id('anonBody');
  const btn = $id('anonCreateBtn');
  if (!body) return;
  body.textContent = 'در حال بارگذاری…';
  if (btn) btn.classList.add('d-none');

  let r = null;
  try { r = await call('myAnon', { op: 'overview' }); } catch (e) { r = null; }
  if (!r || r.error) {
    body.textContent = (r && r.error) || 'بارگذاری نشد';
    return;
  }
  if (!r.available) {
    body.textContent = 'این قابلیت توسط ادمین خاموش شده است.';
    const sum = $id('spAnonSummary'); if (sum) sum.textContent = 'خاموش';
    return;
  }
  if (!r.link) {
    body.textContent = 'هنوز لینکی نساخته‌ای. با دکمهٔ زیر یک لینک خصوصی بساز.';
    if (btn) btn.classList.remove('d-none');
    const sum = $id('spAnonSummary'); if (sum) sum.textContent = 'بدون لینک';
    return;
  }
  renderAnon(r.link);
}

function renderAnon(l) {
  const body = $id('anonBody');
  if (!body) return;
  body.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'd-flex align-items-center justify-content-between mb-2';
  const t = document.createElement('strong');
  t.textContent = 'لینک پیام ناشناس من';
  const st = document.createElement('span');
  st.className = 'u-badge ' + (l.enabled ? 'on' : 'off');
  st.textContent = l.enabled ? 'روشن' : 'خاموش';
  head.append(t, st);
  body.appendChild(head);

  if (l.url) {
    const inp = document.createElement('input');
    inp.className = 'form-control mb-2';
    inp.dir = 'ltr';
    inp.readOnly = true;
    inp.value = l.url;
    inp.onfocus = () => inp.select();
    body.appendChild(inp);
  } else {
    const p = document.createElement('div');
    p.className = 'text-secondary mb-2';
    p.textContent = 'لینک ساخته شده، ولی نام کاربری ربات در دسترس نیست. دوباره تلاش کن.';
    body.appendChild(p);
  }

  const row = document.createElement('div');
  row.className = 'd-flex gap-2 flex-wrap mb-3';
  const mk = (label, fn) => {
    const b = document.createElement('button');
    b.className = 'btn btn-outline-secondary btn-sm';
    b.textContent = label;
    b.onclick = fn;
    return b;
  };
  if (l.url) row.appendChild(mk('کپی لینک', () => copyAnon(l.url)));
  row.appendChild(mk(l.enabled ? 'خاموش کردن' : 'روشن کردن', toggleAnon));
  row.appendChild(mk('لینک جدید', newAnon));
  body.appendChild(row);

  const stats = document.createElement('div');
  stats.className = 'd-flex gap-3 flex-wrap';
  const add = (v, k) => {
    const d = document.createElement('div');
    const n = document.createElement('div');
    n.style.fontWeight = '700'; n.textContent = String(v);
    const c = document.createElement('div');
    c.className = 'text-secondary'; c.style.fontSize = '.72rem'; c.textContent = k;
    d.append(n, c);
    stats.appendChild(d);
  };
  add(l.uses || 0, 'بازدید لینک');
  add(l.senders || 0, 'فرستنده');
  add(l.messages || 0, 'پیام دریافتی');
  add(l.last24h || 0, '۲۴ ساعت اخیر');
  body.appendChild(stats);

  const sum = $id('spAnonSummary');
  if (sum) sum.textContent = l.enabled ? 'روشن' : 'خاموش';
}

async function copyAnon(url) {
  try {
    await navigator.clipboard.writeText(url);
    showToast('لینک کپی شد', 'success');
  } catch (e) {
    showToast('کپی نشد؛ لینک را دستی انتخاب کن', 'warn');
  }
}

async function createAnon() {
  const r = await safeCall('myAnon', { op: 'create' });
  if (r && r.ok) { showToast('لینک ساخته شد', 'success'); renderAnon(r.link); }
  else showToast((r && (r.error || r.description)) || 'خطا', 'error', 4000);
}

async function toggleAnon() {
  const r = await safeCall('myAnon', { op: 'toggle' });
  if (r && r.ok) { toastResult(r, 'وضعیت لینک تغییر کرد'); renderAnon(r.link); }
  else showToast((r && (r.error || r.description)) || 'خطا', 'error', 4000);
}

async function newAnon() {
  const r = await safeCall('myAnon', { op: 'new' });
  if (r && r.ok) { showToast('لینک جدید ساخته شد؛ لینک قبلی باطل شد', 'success'); renderAnon(r.link); }
  else showToast((r && (r.error || r.description)) || 'خطا', 'error', 4000);
}

// پنل و اعلان‌ها: نرخ بروزرسانی فقط سمت مرورگر است (نیازی به اندپوینت ادمین ندارد)
function savePanelPrefs() {
  const pollVal = Math.max(500, Math.min(parseInt($val('gPoll')) || 3000, 60000));
  localStorage.setItem('pollMs', String(pollVal));
  pollMs = pollVal;
  startPoller();
  showToast('ذخیره شد', 'success');
  goBackOneLevel();
}

// ───────────── deep link: ?settings=ai ─────────────
function maybeOpenFromQuery() {
  try {
    const q = new URLSearchParams(location.search);
    const sub = q.get('settings');
    if (!sub) return;
    q.delete('settings');
    const qs = q.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + (location.hash || ''));
    openSettings();
    if (['ai', 'anon', 'panel', 'about', 'members'].includes(sub)) openSettingsSub(sub);
  } catch (e) { /* ignore */ }
}
