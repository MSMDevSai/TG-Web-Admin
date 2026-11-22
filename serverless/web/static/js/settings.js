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

// ───────────── مدیریت و آمار (ادمین) ─────────────
function adminEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function adminNum(n) {
  try { return new Intl.NumberFormat('fa-IR').format(Number(n) || 0); }
  catch (e) { return String(Number(n) || 0); }
}

function adminTime(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleString('fa-IR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch (e) { return ''; }
}

async function loadAdminPage() {
  if (!(S.me && S.me.role === 'admin')) return;
  if ($id('adminStats')) $id('adminStats').textContent = 'در حال بارگذاری…';
  await Promise.all([loadAdminStats(), loadAdminUsers(), loadAdminBlocks(), loadAdminReports(), loadAdminContacts(), loadAdminFilter()]);
}

async function loadAdminFilter() {
  const r = await safeCall('settings', {});
  const s = r && r.settings ? r.settings : null;
  if (!s || s.error) return;
  if ($id('adminFilter')) $id('adminFilter').checked = s.filter_enabled === true;
  if ($id('adminBannedWords')) $id('adminBannedWords').value = s.banned_words || '';
}

async function saveAdminFilter() {
  const values = {
    filter_enabled: !!($id('adminFilter') && $id('adminFilter').checked),
    banned_words: $val('adminBannedWords'),
  };
  const r = await safeCall('settings', { op: 'save', values });
  if (r && r.settings) showToast('فیلتر ذخیره شد ✅', 'success');
  else showToast((r && (r.error || r.description)) || 'خطا در ذخیره', 'error', 4000);
}

async function loadAdminStats() {
  const host = $id('adminStats');
  if (!host) return;
  const r = await safeCall('admin', { op: 'stats' });
  if (!r || r.error) { host.textContent = (r && r.error) || 'بارگذاری نشد'; return; }
  const c = r.counters || {}, a = r.anon || {}, n = r.counts || {};
  const cell = (label, value) => `<div style="display:flex;justify-content:space-between;gap:.5rem;padding:.18rem 0"><span>${label}</span><b>${adminNum(value)}</b></div>`;
  host.innerHTML =
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 1rem">` +
    cell('👥 کاربران بات', n.users) +
    cell('🚫 بلاک‌شده', n.blocked) +
    cell('💬 پیام دریافتی', c.messages_in) +
    cell('📤 پیام ارسالی', c.messages_out) +
    cell('🤖 درخواست AI', c.ai_requests) +
    cell('⚠️ خطای AI', c.ai_errors) +
    cell('❗ خطای کل', c.errors_total) +
    cell('🧾 چت‌ها', n.chats) +
    cell('📨 تماس باز', n.openContacts) +
    cell('🚩 گزارش باز', n.openReports) +
    cell('🕶 بازدید لینک ناشناس', a.views) +
    cell('🕶 فرستنده ناشناس', a.senders) +
    cell('🕶 دریافتی ناشناس', a.incoming) +
    cell('🕶 ارسالی ناشناس', a.outgoing) +
    `</div>`;
  const sum = $id('spAdminSummary');
  if (sum) sum.textContent = `${adminNum(n.users)} کاربر`;
}

async function loadAdminUsers() {
  const host = $id('adminUsers');
  if (!host) return;
  const q = ($val('adminUserSearch') || '').trim();
  const r = await safeCall('admin', { op: 'users', q, limit: 40 });
  if (!r || r.error) { host.textContent = (r && r.error) || 'بارگذاری نشد'; return; }
  const users = r.users || [];
  if ($id('adminUsersCount')) $id('adminUsersCount').textContent = `${adminNum(r.total)} نفر`;
  if (!users.length) { host.textContent = q ? 'موردی پیدا نشد.' : 'هنوز کسی به بات پیام نداده است.'; return; }
  host.replaceChildren(...users.map((u) => {
    const row = document.createElement('div');
    row.className = 'sp-row';
    row.style.cssText = 'align-items:flex-start;gap:.4rem;flex-wrap:wrap;border-bottom:1px solid var(--md-sys-color-outline-variant);padding:.5rem 0';

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:150px';
    const nm = document.createElement('div');
    nm.style.fontWeight = '600';
    nm.textContent = (u.name || String(u.tgId)) + (u.blocked ? (u.permanent ? ' ⛔' : ' 🚫') : '');
    const meta = document.createElement('div');
    meta.className = 'text-secondary';
    meta.style.fontSize = '.72rem';
    meta.textContent = `${u.tgId}${u.username ? ' · @' + u.username : ''} · ${adminTime(u.lastSeen)}`;
    info.append(nm, meta);
    if (u.lastText) {
      const last = document.createElement('div');
      last.className = 'text-secondary';
      last.style.cssText = 'font-size:.74rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:230px';
      last.textContent = u.lastText;
      info.appendChild(last);
    }
    if (u.blocked) {
      const why = document.createElement('div');
      why.className = 'text-secondary';
      why.style.fontSize = '.72rem';
      why.textContent = `دلیل بلاک: ${u.reason || '—'}`;
      info.appendChild(why);
    }

    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:.25rem;flex-wrap:wrap';
    const mk = (label, cls, fn) => {
      const b = document.createElement('button');
      b.className = 'btn btn-sm ' + (cls || 'btn-outline-secondary');
      b.textContent = label;
      b.onclick = fn;
      return b;
    };
    btns.appendChild(mk('پیام', '', () => adminStartChat(u)));
    btns.appendChild(mk('اخطار', '', () => adminWarn(u.tgId, u.name)));
    if (u.blocked) btns.appendChild(mk('رفع بلاک', '', () => adminUnblock(u.tgId)));
    else btns.appendChild(mk('بلاک', 'btn-outline-danger', () => adminBlock(u.tgId, u.name)));

    row.append(info, btns);
    return row;
  }));
}

function adminStartChat(u) {
  closeSettings();
  const idEl = $id('ncId');
  if (idEl) idEl.value = String(u.tgId);
  openNewChatModal();
  if ($id('ncMsg')) $id('ncMsg').focus();
}

async function adminWarn(tgId, name) {
  const reason = prompt(`دلیل اخطار برای ${name || tgId}:`);
  if (!reason || !reason.trim()) return;
  const r = await safeCall('admin', { op: 'warn', tgId: Number(tgId), reason: reason.trim() });
  if (r && r.ok) showToast(r.sent ? 'اخطار ارسال شد ✅' : 'اخطار ثبت شد (ارسال تلگرام نشد)', r.sent ? 'success' : 'warn', 4000);
  else showToast((r && (r.error || r.description)) || 'خطا', 'error', 4000);
  loadAdminUsers();
}

async function adminBlock(tgId, name) {
  const reason = prompt(`دلیل بلاک ${name || tgId}:`);
  if (reason === null) return;
  const permanent = confirm('بلاک دائمی باشد؟\nتأیید = دائمی · لغو = موقت');
  const r = await safeCall('admin', { op: 'block', tgId: Number(tgId), reason: reason.trim(), permanent });
  if (r && r.ok) showToast(permanent ? 'بلاک دائمی ثبت شد' : 'بلاک موقت ثبت شد', 'success');
  else showToast((r && (r.error || r.description)) || 'خطا', 'error', 4000);
  loadAdminUsers(); loadAdminBlocks();
}

async function adminUnblock(tgId) {
  const r = await safeCall('admin', { op: 'unblock', tgId: Number(tgId) });
  if (r && r.ok) showToast('رفع بلاک شد', 'success'); else showToast((r && r.error) || 'خطا', 'error');
  loadAdminUsers(); loadAdminBlocks();
}

async function loadAdminBlocks() {
  const host = $id('adminBlocks');
  if (!host) return;
  const r = await safeCall('admin', { op: 'blocks' });
  if (!r || r.error) { host.textContent = 'بارگذاری نشد'; return; }
  const list = r.blocks || [];
  if (!list.length) { host.textContent = 'هیچ کاربری بلاک نشده است.'; return; }
  host.replaceChildren(...list.map((b) => {
    const row = document.createElement('div');
    row.className = 'sp-row';
    row.style.cssText = 'gap:.4rem;flex-wrap:wrap;border-bottom:1px solid var(--md-sys-color-outline-variant);padding:.4rem 0';
    const info = document.createElement('div');
    info.style.flex = '1';
    const nm = document.createElement('div');
    nm.style.fontWeight = '600';
    nm.textContent = `${b.name || b.tgId} · ${b.tgId} ${b.permanent ? '(دائمی)' : '(موقت)'}`;
    const why = document.createElement('div');
    why.className = 'text-secondary';
    why.style.fontSize = '.72rem';
    why.textContent = `دلیل: ${b.reason || '—'} · ${adminTime(b.ts)}`;
    info.append(nm, why);
    const b2 = document.createElement('button');
    b2.className = 'btn btn-sm btn-outline-secondary';
    b2.textContent = 'رفع بلاک';
    b2.onclick = () => adminUnblock(b.tgId);
    row.append(info, b2);
    return row;
  }));
}

async function loadAdminReports() {
  const host = $id('adminReports');
  if (!host) return;
  const r = await safeCall('admin', { op: 'reports' });
  if (!r || r.error) { host.textContent = 'بارگذاری نشد'; return; }
  const list = r.reports || [];
  if (!list.length) { host.textContent = 'گزارش بازی وجود ندارد.'; return; }
  host.replaceChildren(...list.map((rep) => {
    const row = document.createElement('div');
    row.className = 'sp-row';
    row.style.cssText = 'gap:.4rem;flex-wrap:wrap;border-bottom:1px solid var(--md-sys-color-outline-variant);padding:.4rem 0';
    const info = document.createElement('div');
    info.style.flex = '1';
    const nm = document.createElement('div');
    nm.style.fontWeight = '600';
    nm.textContent = `#${rep.id} · فرستنده ${rep.senderId}`;
    const why = document.createElement('div');
    why.className = 'text-secondary';
    why.style.fontSize = '.72rem';
    why.textContent = `مالک: ${rep.ownerId} · دلیل: ${rep.reason || '—'} · ${adminTime(rep.ts)}`;
    info.append(nm, why);
    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:.25rem;flex-wrap:wrap';
    const mk = (label, cls, fn) => { const b = document.createElement('button'); b.className = 'btn btn-sm ' + (cls || 'btn-outline-secondary'); b.textContent = label; b.onclick = fn; return b; };
    btns.appendChild(mk('گفتگو', '', () => adminViewReport(rep.id)));
    btns.appendChild(mk('رسیدگی شد', '', async () => {
      const x = await safeCall('admin', { op: 'resolveReport', id: rep.id });
      if (x && x.ok) { showToast('رسیدگی ثبت شد', 'success'); loadAdminReports(); }
      else showToast((x && x.error) || 'خطا', 'error');
    }));
    btns.appendChild(mk('بلاک فرستنده', 'btn-outline-danger', () => adminBlock(rep.senderId, 'فرستنده ناشناس')));
    row.append(info, btns);
    return row;
  }));
}

async function adminViewReport(id) {
  const r = await safeCall('admin', { op: 'report', id: Number(id) });
  if (!r || r.error) { showToast((r && r.error) || 'گزارش پیدا نشد', 'error'); return; }
  const rep = r.report || {};
  const lines = (r.messages || []).map((m) => {
    const who = m.dir === 'in' ? '👤 ناشناس' : '🧑 مالک';
    return `${who}: ${m.text || (m.kind ? '[' + m.kind + ']' : '[بدون متن]')}`;
  }).join('\n');
  const html = `<div class="text-secondary" style="font-size:.8rem;margin-bottom:.5rem">مالک: ${adminEsc(rep.ownerId)} · فرستنده: ${adminEsc(rep.senderId)}<br>دلیل: ${adminEsc(rep.reason || '—')}</div>` +
    `<pre style="white-space:pre-wrap;max-height:55vh;overflow:auto;font-size:.82rem;line-height:1.7">${adminEsc(lines || '(گفتگویی ثبت نشده است.)')}</pre>`;
  openGmodModal(`گزارش ناشناس #${rep.id}`, html, () => {
    bootstrap.Modal.getInstance(document.getElementById('gmodModal')).hide();
  });
}

async function loadAdminContacts() {
  const host = $id('adminContacts');
  if (!host) return;
  const r = await safeCall('admin', { op: 'contacts' });
  if (!r || r.error) { host.textContent = 'بارگذاری نشد'; return; }
  const list = r.contacts || [];
  if (!list.length) { host.textContent = 'درخواست تماس بازی وجود ندارد.'; return; }
  host.replaceChildren(...list.map((c) => {
    const row = document.createElement('div');
    row.className = 'sp-row';
    row.style.cssText = 'gap:.4rem;flex-wrap:wrap;border-bottom:1px solid var(--md-sys-color-outline-variant);padding:.4rem 0';
    const info = document.createElement('div');
    info.style.flex = '1';
    const nm = document.createElement('div');
    nm.style.fontWeight = '600';
    nm.textContent = `${c.kind === 'appeal' ? '📨 اعتراض' : '📨 تماس'} · ${c.name || c.tgId} (${c.tgId})`;
    const why = document.createElement('div');
    why.className = 'text-secondary';
    why.style.fontSize = '.75rem';
    why.style.whiteSpace = 'pre-wrap';
    why.textContent = `${c.text}\n${adminTime(c.ts)}`;
    info.append(nm, why);
    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:.25rem;flex-wrap:wrap';
    const mk = (label, fn) => { const b = document.createElement('button'); b.className = 'btn btn-sm btn-outline-secondary'; b.textContent = label; b.onclick = fn; return b; };
    btns.appendChild(mk('پاسخ', async () => {
      const text = prompt(`پاسخ به ${c.name || c.tgId}:`);
      if (!text || !text.trim()) return;
      const x = await safeCall('admin', { op: 'reply', tgId: c.tgId, text });
      if (x && x.ok) showToast(x.sent ? 'پاسخ ارسال شد' : 'ارسال نشد (ربات را بلاک کرده)', x.sent ? 'success' : 'warn', 4000);
      else showToast((x && x.error) || 'خطا', 'error');
    }));
    btns.appendChild(mk('انجام شد', async () => {
      const x = await safeCall('admin', { op: 'contactDone', id: c.id, handled: true });
      if (x && x.ok) { showToast('علامت خورد', 'success'); loadAdminContacts(); }
      else showToast((x && x.error) || 'خطا', 'error');
    }));
    btns.appendChild(mk('بلاک', () => adminBlock(c.tgId, c.name)));
    row.append(info, btns);
    return row;
  }));
}

// لیست مخاطبین ربات در مودال «چت جدید» (فقط ادمین)
async function loadNcContacts() {
  const host = $id('ncContacts');
  if (!host) return;
  if (!(S.me && S.me.role === 'admin')) { host.textContent = 'این لیست فقط برای ادمین است.'; return; }
  const q = ($val('ncSearch') || '').trim();
  host.textContent = 'در حال بارگذاری…';
  const r = await safeCall('admin', { op: 'users', q, limit: 20 });
  if (!r || r.error) { host.textContent = (r && r.error) || 'بارگذاری نشد'; return; }
  const users = r.users || [];
  if (!users.length) { host.textContent = q ? 'موردی پیدا نشد.' : 'هنوز کسی به بات پیام نداده است.'; return; }
  host.replaceChildren(...users.map((u) => {
    const row = document.createElement('div');
    row.className = 'sp-row';
    row.style.cssText = 'cursor:pointer;padding:.25rem 0;border-bottom:1px solid var(--md-sys-color-outline-variant)';
    row.onclick = () => {
      if ($id('ncId')) $id('ncId').value = String(u.tgId);
      if ($id('ncMsg')) $id('ncMsg').focus();
      showToast(`انتخاب شد: ${u.name || u.tgId}`, 'success', 1500);
    };
    const nm = document.createElement('span');
    nm.textContent = (u.name || String(u.tgId)) + (u.blocked ? ' 🚫' : '');
    const meta = document.createElement('small');
    meta.className = 'text-secondary';
    meta.textContent = `${u.tgId}${u.username ? ' · @' + u.username : ''}`;
    row.append(nm, meta);
    return row;
  }));
}

async function warnCurrentUser() {
  const c = (S.chats || []).find((x) => x.id === curChatId) || {};
  if (c.isGroup) { showToast('برای گروه، از بخش عملیات گروه استفاده کن', 'warn'); return; }
  await adminWarn(c.id || curChatId, c.title);
}

async function blockCurrentUser() {
  const c = (S.chats || []).find((x) => x.id === curChatId) || {};
  if (c.isGroup) { showToast('بلاک گروه معنی ندارد؛ کاربر را از پروفایل انتخاب کن', 'warn'); return; }
  await adminBlock(c.id || curChatId, c.title);
  bootstrap.Modal.getInstance(document.getElementById('profileModal'))?.hide();
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
