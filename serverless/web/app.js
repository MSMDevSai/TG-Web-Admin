'use strict';
/* پنل Mini App — بدون build. هویت از initData تلگرام می‌آید؛ هیچ رمزی وجود ندارد. */
const tg = window.Telegram && window.Telegram.WebApp;
if (tg) { try { tg.ready(); tg.expand(); if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); } catch (e) {} }

// ───────── ابزارها ─────────
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(2)) { if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return e;
}
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(2).filter((k) => k != null && k !== false));
const call = (name, input) => new Promise((res, rej) => {
  if (!tg || !tg.Serverless) return rej({ type: 'UNAUTHORIZED', message: 'این پنل باید داخل تلگرام باز شود.' });
  tg.Serverless.call(name, input || {}, (err, r) => (err ? rej(err) : res(r)));
});
let toastT;
function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
const errText = (e) => (e && (e.message || e.type)) || 'خطای نامشخص';
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
const fmtDay = (ts) => new Date(ts).toLocaleDateString('fa-IR', { dateStyle: 'medium' });
const initial = (s) => (String(s || '?').trim()[0] || '?').toUpperCase();

function u8ToB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function b64ToU8(b) { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

// ───────── وضعیت ─────────
const S = { me: null, settings: null, view: 'list', chats: [], cats: [], tab: 'all', q: '', chat: null, msgs: new Map(), hasMoreOlder: false, hasMoreNewer: false,
  filter: '', mode: localStorage.getItem('mode') || 'bot', reply: null, poll: null, sig: '', rec: null, sel: null, around: false, loading: false, pinned: null, searchOpen: false };
const app = document.getElementById('app');

// ───────── رسانه ─────────
const mediaCache = new Map();
function loadMedia(key) {
  if (mediaCache.has(key)) return mediaCache.get(key);
  const p = (async () => {
    let part = 0, parts = 1, mime = '', chunks = [];
    while (part < parts) { const r = await call('media', { key, part }); parts = r.parts; mime = r.mime; chunks.push(b64ToU8(r.b64)); part++; }
    return { url: URL.createObjectURL(new Blob(chunks, { type: mime })), mime };
  })();
  mediaCache.set(key, p); p.catch(() => mediaCache.delete(key));
  return p;
}
function mediaEl(m) {
  const box = h('div', { class: 'ph' }, 'در حال بارگذاری…');
  if (!m.mediaKey) { box.textContent = m.text; return box; }
  const ph = (t) => { box.className = 'ph'; box.textContent = t; };
  const fill = (el) => { box.replaceWith(el); };
  const go = async () => {
    try {
      const { url, mime } = await loadMedia(m.mediaKey);
      if (m.type === 'photo') fill(h('img', { class: 'm', src: url }));
      else if (m.type === 'sticker') { if (mime === 'image/webp') fill(h('img', { class: 'm stk', src: url })); else if (mime === 'video/webm') fill(h('video', { class: 'm stk', src: url, autoplay: true, loop: true, muted: true, playsinline: true })); else ph(m.text || '🎭'); }
      else if (m.type === 'video' || m.type === 'video_note') fill(h('video', { class: 'm', src: url, controls: true, playsinline: true, preload: 'metadata' }));
      else if (m.type === 'animation') fill(h('video', { class: 'm', src: url, autoplay: true, loop: true, muted: true, playsinline: true }));
      else if (m.type === 'voice' || m.type === 'audio') fill(h('audio', { src: url, controls: true, preload: 'metadata' }));
      else fill(h('a', { href: url, download: (m.text || 'file').replace(/^\[فایل\]\s*/, '') || 'file', class: 'ph' }, '📎 ' + (m.text || 'دانلود فایل')));
    } catch (e) { ph('⚠️ ' + errText(e)); }
  };
  if ('IntersectionObserver' in window) { const io = new IntersectionObserver((en) => { if (en[0].isIntersecting) { io.disconnect(); go(); } }, { rootMargin: '300px' }); io.observe(box); }
  else go();
  return box;
}

// ───────── اجزا ─────────
function sheet(title, ...content) {
  const close = () => ov.remove();
  const ov = h('div', { class: 'ov', onclick: (e) => { if (e.target === ov) close(); } },
    h('div', { class: 'sheet' }, h('h2', {}, h('span', {}, title), h('button', { class: 'ib', onclick: close }, '✕')), content));
  document.body.append(ov);
  return close;
}
const toggle = (on, fn) => { const el = h('button', { class: 'sw' + (on ? ' on' : ''), onclick: () => { on = !on; el.classList.toggle('on', on); fn(on); } }); return el; };

// ───────── جستجو (مشترک بین جستجوی چت و جستجوی سراسری) ─────────
function hl(text, q) {
  const out = []; const lt = String(text).toLowerCase(), lq = q.toLowerCase(); let i = 0;
  for (;;) {
    const j = lq ? lt.indexOf(lq, i) : -1;
    if (j < 0) { out.push(String(text).slice(i)); break; }
    out.push(String(text).slice(i, j), h('mark', {}, String(text).slice(j, j + q.length))); i = j + q.length;
  }
  return out;
}
function searchBox({ chatId, onPick, initial }) {
  const res = h('div', { class: 'sres' });
  const inp = h('input', { type: 'search', placeholder: chatId != null ? 'جستجو در این چت…' : 'جستجو در متن همه‌ی پیام‌ها…', value: initial || '' });
  let timer, last = [], more = false, q = '', busy = false;
  const item = (r) => h('div', { class: 'sr', onclick: () => onPick(r) },
    h('div', { class: 'sr-t' }, h('b', {}, chatId != null ? (r.sender || '') : (r.chatTitle || '')), r.deleted && h('span', { class: 'del' }, '🗑 حذف‌شده'), h('small', {}, fmtDay(r.ts) + ' ' + fmtTime(r.ts))),
    h('div', { class: 'sr-s' }, hl(r.snippet, q)));
  const draw = () => fill(res,
    ...(last.length ? last.map(item) : [h('div', { class: 'empty' }, busy ? 'در حال جستجو…' : (q.length < 2 ? 'حداقل ۲ حرف بنویس.' : 'نتیجه‌ای پیدا نشد.'))]),
    more && h('button', { class: 'more', onclick: () => run(true) }, 'بیشتر…'));
  const run = async (append) => {
    q = inp.value.trim();
    if (q.length < 2) { last = []; more = false; busy = false; return draw(); }
    busy = !append; if (busy) draw();
    try {
      const r = await call('search', { q, chatId, beforeId: append && last.length ? last[last.length - 1].id : undefined });
      last = append ? last.concat(r.results) : r.results; more = r.more; busy = false; draw();
    } catch (e) { busy = false; toast(errText(e)); }
  };
  inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => run(false), 350); });
  draw(); if (initial) run(false);
  return { el: h('div', {}, h('div', { class: 'search' }, inp), res), input: inp };
}
function openGlobalSearch(initial) {
  S.view = 'search';
  const sb = searchBox({ initial, onPick: (r) => openChat(r.chatId, r.id) });
  app.replaceChildren(h('div', { class: 'top' }, h('button', { class: 'ib', onclick: goBack }, '→'), h('h1', {}, '🔎 جستجو در همه‌ی پیام‌ها')), sb.el);
  if (tg) { tg.BackButton.show(); tg.BackButton.offClick(goBack); tg.BackButton.onClick(goBack); }
  setTimeout(() => sb.input.focus(), 50);
}

// ───────── لیست چت‌ها ─────────
async function loadChats() {
  try { const r = await call('chats'); S.chats = r.chats; S.cats = r.categories || []; if (S.view === 'list') updateList(); } catch (e) { toast(errText(e)); }
}
const tabOk = (c) => {
  const t = S.tab;
  if (t === 'all') return true; if (t === 'unread') return c.unread > 0; if (t === 'groups') return c.isGroup; if (t === 'private') return !c.isGroup;
  return t.startsWith('cat:') ? (c.cats || []).includes(Number(t.slice(4))) : true;
};
function renderList() {
  S.view = 'list'; S.chat = null;
  const isAdmin = S.me.role === 'admin';
  const search = h('input', { id: 'lsearch', type: 'search', placeholder: 'جستجوی چت‌ها…', value: S.q, oninput: (e) => { S.q = e.target.value; updateList(); } });
  app.replaceChildren(
    h('div', { class: 'top' }, h('h1', {}, 'پیام‌ها', h('div', { class: 'sub' }, `${S.me.name} · ${isAdmin ? 'ادمین' : 'کاربر'}`)),
      h('button', { class: 'ib', title: 'جستجو در متن پیام‌ها', onclick: () => openGlobalSearch(S.q.trim().length >= 2 ? S.q.trim() : '') }, '🔍'),
      h('button', { class: 'ib', title: 'اعلان‌ها', onclick: openMyPrefs }, S.me.notify && S.notifyEnabled !== false ? '🔔' : '🔕'),
      h('button', { class: 'ib', title: 'بیشتر', onclick: openMenu }, '⋮')),
    h('div', { class: 'search' }, search), h('div', { class: 'tabs', id: 'tabs' }), h('div', { class: 'list', id: 'listbox' }));
  if (tg) tg.BackButton.hide();
  updateList();
}
function updateList() {
  const tabsEl = document.getElementById('tabs'), box = document.getElementById('listbox'); if (!tabsEl || !box) return;
  const q = S.q.trim().toLowerCase();
  const cnt = (f) => S.chats.filter((c) => f(c) && c.unread > 0).length;
  const tabs = [['all', 'همه', 0], ['unread', 'نخوانده', cnt(() => true)], ['private', 'خصوصی', cnt((c) => !c.isGroup)], ['groups', 'گروه‌ها', cnt((c) => c.isGroup)],
    ...S.cats.map((k) => ['cat:' + k.id, (k.emoji ? k.emoji + ' ' : '') + k.name, cnt((c) => (c.cats || []).includes(k.id))])];
  if (!tabs.some((t) => t[0] === S.tab)) S.tab = 'all';
  const sl = tabsEl.scrollLeft;
  tabsEl.replaceChildren(...tabs.map(([id, label, n]) => h('button', { class: 'chip' + (S.tab === id ? ' on' : ''), onclick: () => { S.tab = id; updateList(); } }, label, n > 0 && h('span', { class: 'cn' }, n))));
  tabsEl.scrollLeft = sl;
  const items = S.chats.filter((c) => tabOk(c) && (!q || c.title.toLowerCase().includes(q) || (c.lastText || '').toLowerCase().includes(q)));
  const kids = [];
  if (q.length >= 2) kids.push(h('button', { class: 'act', onclick: () => openGlobalSearch(S.q.trim()) }, `🔎 جستجوی «${S.q.trim()}» در متن همه‌ی پیام‌ها`));
  if (!items.length) kids.push(h('div', { class: 'empty' }, S.chats.length ? 'چتی در این بخش نیست.' : 'هنوز چتی ثبت نشده.'));
  for (const c of items) kids.push(chatRow(c));
  const st = box.scrollTop; box.replaceChildren(...kids); box.scrollTop = st;
}
function chatRow(c) {
  let timer = null, fired = false;
  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const catTags = (c.cats || []).map((id) => S.cats.find((k) => k.id === id)).filter(Boolean).map((k) => h('span', { class: 'tag' }, (k.emoji || '') + ' ' + k.name));
  return h('div', { class: 'chat', 'data-chat': c.id,
    onclick: () => { if (fired) { fired = false; return; } openChat(c.id); },
    oncontextmenu: (e) => { e.preventDefault(); chatQuick(c); },
    ontouchstart: () => { fired = false; clear(); timer = setTimeout(() => { fired = true; timer = null; chatQuick(c); }, 550); },
    ontouchend: clear, ontouchmove: clear },
  h('div', { class: 'av' }, initial(c.title)),
  h('div', { class: 'mid' },
    h('div', { class: 't' }, h('b', {}, (c.isGroup ? '👥 ' : '') + c.title), c.pinned && '📌', c.muted && '🔕', c.aiPending && '✨', h('small', {}, c.lastTs ? fmtTime(c.lastTs) : '')),
    h('div', { class: 't' }, h('div', { class: 'p', style: 'flex:1' }, (c.lastSender ? c.lastSender + ': ' : '') + (c.lastText || '')), c.unread > 0 && h('span', { class: 'badge' }, c.unread)),
    catTags.length > 0 && h('div', { class: 'tags' }, catTags)),
  h('button', { class: 'ib qa', title: 'اقدام‌های سریع', onclick: (e) => { e.stopPropagation(); chatQuick(c); } }, '⋯'));
}
function chatInfo(id) { return S.chats.find((c) => c.id === id) || { id, title: (S.chat && S.chat.title) || '', cats: [], pinned: false, muted: false }; }
function chatQuick(c) {
  const act = async (patch) => { try { await call('chatPrefs', { chatId: c.id, ...patch }); Object.assign(c, patch); loadChats(); } catch (e) { toast(errText(e)); } };
  const close = sheet(c.title,
    h('div', { class: 'row' }, h('div', { class: 'grow' }, '📌 سنجاق چت در لیست'), toggle(!!c.pinned, (v) => act({ pinned: v }))),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, '🔕 بستن اعلان این چت'), toggle(!!c.muted, (v) => act({ muted: v }))),
    h('button', { class: 'act', onclick: () => { close(); catAssign(c); } }, '🗂 دسته‌بندی چت…'),
    h('button', { class: 'act', onclick: () => { close(); openChat(c.id); } }, '💬 باز کردن چت'));
}

// ───────── دسته‌بندی چت‌ها ─────────
function catAssign(c) {
  const body = h('div', {});
  const draw = () => fill(body,
    ...(S.cats.length ? S.cats.map((k) => h('div', { class: 'row' }, h('div', { class: 'grow' }, (k.emoji ? k.emoji + ' ' : '') + k.name),
      toggle((c.cats || []).includes(k.id), async (v) => {
        const next = v ? [...(c.cats || []), k.id] : (c.cats || []).filter((x) => x !== k.id);
        try { const r = await call('categories', { op: 'assign', chatId: c.id, categoryIds: next }); c.cats = r.categoryIds; loadChats(); }
        catch (e) { toast(errText(e)); draw(); }
      }))) : [h('div', { class: 'empty' }, 'هنوز دسته‌ای ساخته نشده.')]),
    S.me.role === 'admin' && h('button', { class: 'act', onclick: () => { close(); openCategories(); } }, '⚙️ مدیریت دسته‌ها'));
  const close = sheet('🗂 دسته‌بندی چت', body); draw();
}
function openCategories() {
  const body = h('div', {}); const close = sheet('🗂 مدیریت دسته‌ها', body);
  const act = async (input) => { try { const r = await call('categories', input); S.cats = r.categories; draw(); loadChats(); } catch (e) { toast(errText(e)); } };
  const move = (i, d) => { const ids = S.cats.map((k) => k.id); [ids[i], ids[i + d]] = [ids[i + d], ids[i]]; act({ op: 'reorder', ids }); };
  const draw = () => {
    const name = h('input', { type: 'text', placeholder: 'نام دسته (مثلاً مشتری‌ها)', maxlength: '30' });
    const emo = h('input', { type: 'text', placeholder: '🙂', style: 'width:64px', maxlength: '4' });
    body.replaceChildren(
      ...S.cats.map((k, i) => h('div', { class: 'row', 'data-cat': k.id },
        h('input', { type: 'text', value: k.emoji, style: 'width:56px', maxlength: '4', onchange: (e) => act({ op: 'update', id: k.id, emoji: e.target.value }) }),
        h('input', { type: 'text', value: k.name, maxlength: '30', onchange: (e) => act({ op: 'update', id: k.id, name: e.target.value }) }),
        h('button', { class: 'ib', disabled: i === 0, onclick: () => move(i, -1) }, '▲'), h('button', { class: 'ib', disabled: i === S.cats.length - 1, onclick: () => move(i, 1) }, '▼'),
        h('button', { class: 'ib', onclick: () => confirm(`دسته‌ی «${k.name}» حذف شود؟ (چت‌ها پاک نمی‌شوند)`) && act({ op: 'delete', id: k.id }) }, '🗑'))),
      h('label', { class: 'f' }, 'دسته‌ی جدید'), h('div', { class: 'row' }, emo, name),
      h('button', { class: 'btn', onclick: () => act({ op: 'create', name: name.value, emoji: emo.value }) }, 'افزودن'));
  };
  draw();
}

// ───────── منوی اصلی و پیام ناشناس ─────────
function openMenu() {
  const admin = S.me.role === 'admin'; let close;
  const item = (label, fn) => h('button', { class: 'act', onclick: () => { close(); fn(); } }, label);
  close = sheet('منو', item('🕶 پیام ناشناس', openAnon), admin && item('🗂 دسته‌بندی چت‌ها', openCategories), admin && item('👥 اعضا', openMembers), admin && item('⚙️ تنظیمات', openSettings));
}
async function openAnon() {
  const admin = S.me.role === 'admin';
  const body = h('div', {}, h('p', { class: 'hint' },
    'هر کسی می‌تواند در پیوی ربات /anon بزند و یک لینک خصوصی بگیرد. هر کس روی آن لینک بزند، می‌تواند ناشناس برایش پیام بفرستد. صاحب لینک با Reply روی پیام ناشناس جواب می‌دهد و می‌تواند فرستنده را بلاک یا گزارش کند. این پیام‌ها هرگز وارد چت‌های پنل نمی‌شوند و متن‌شان ذخیره نمی‌شود.'));
  const close = sheet('🕶 پیام ناشناس', body);
  if (!admin) return;
  const draw = (o) => {
    const v = { anon_enabled: S.settings.anon_enabled, anon_rate_per_hour: S.settings.anon_rate_per_hour, anon_retention_days: S.settings.anon_retention_days };
    const idIn = h('input', { type: 'number', placeholder: 'آیدی عددی فرستنده', inputmode: 'numeric' });
    body.replaceChildren(h('p', { class: 'hint' }, body.dataset.hint),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, 'لینک‌ها', h('small', {}, `${o.activeLinks} فعال از ${o.links}`)), h('div', {}, `پیام ۲۴ ساعت اخیر: ${o.messages24h}`)),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, 'بلاک‌های شخصی مالک‌ها'), h('div', {}, o.ownerBlocks)),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, 'قابلیت پیام ناشناس (کلی)'), toggle(!!v.anon_enabled, (x) => { v.anon_enabled = x; })),
      h('label', { class: 'f' }, 'سقف پیام هر فرستنده در ساعت'), h('input', { type: 'number', value: v.anon_rate_per_hour, oninput: (e) => { v.anon_rate_per_hour = Number(e.target.value); } }),
      h('label', { class: 'f' }, 'نگهداری مسیریابی پاسخ‌ها (روز)'), h('input', { type: 'number', value: v.anon_retention_days, oninput: (e) => { v.anon_retention_days = Number(e.target.value); } }),
      h('button', { class: 'btn', onclick: async () => { try { const r = await call('settings', { op: 'save', values: v }); S.settings = r.settings; toast('ذخیره شد ✅'); } catch (e) { toast(errText(e)); } } }, 'ذخیره‌ی تنظیمات'),
      h('label', { class: 'f' }, `بلاک‌های سراسری (${o.globalBlocks.length})`),
      ...o.globalBlocks.map((b) => h('div', { class: 'row' }, h('div', { class: 'grow' }, String(b.senderId), h('small', {}, b.by || '')), h('button', { class: 'btn sm', onclick: () => act({ op: 'unblock', senderId: b.senderId }) }, 'رفع بلاک'))),
      h('div', { class: 'row' }, idIn, h('button', { class: 'btn sm', onclick: () => act({ op: 'block', senderId: Number(idIn.value) }) }, 'بلاک')));
  };
  const act = async (input) => { try { draw(await call('anonAdmin', input)); } catch (e) { toast(errText(e)); } };
  body.dataset.hint = body.firstChild.textContent;
  await act({ op: 'overview' });
}

// ───────── صفحه‌ی چت ─────────
async function openChat(id, focusId) {
  S.view = 'chat'; S.chat = { id, title: chatInfo(id).title }; S.msgs = new Map(); S.hasMoreOlder = false; S.hasMoreNewer = false; S.filter = ''; S.reply = null;
  S.sig = ''; S.sel = null; S.pinned = null; S.searchOpen = false; S.around = !!focusId; S.loading = true;
  renderChat();
  await fetchMsgs(focusId ? { around: focusId, reset: true, focus: focusId } : { scroll: true });
}
async function fetchMsgs(o = {}) {
  try {
    const r = await call('messages', { chatId: S.chat.id, limit: 80, filter: S.filter || undefined, beforeId: o.before, aroundId: o.around });
    if (S.view !== 'chat') return;
    S.chat = { ...S.chat, ...r.chat }; S.pinned = r.pinned; S.loading = false;
    if (o.before) S.hasMoreOlder = r.hasMore;
    else if (o.around) { if (o.reset) S.hasMoreOlder = r.hasMore; S.hasMoreNewer = r.hasMoreNewer; }
    else if (S.msgs.size === 0) S.hasMoreOlder = r.hasMore;
    for (const m of r.messages) S.msgs.set(m.id, m);
    const sig = JSON.stringify([...S.msgs.values()]) + [S.chat.aiPending, S.chat.muted, S.chat.pinned, S.hasMoreOlder, S.hasMoreNewer, S.loading, JSON.stringify(S.pinned)].join();
    if (sig !== S.sig || o.focus) { S.sig = sig; renderMsgs(o.scroll, o.focus); renderHeader(); renderPinned(); renderFab(); }
  } catch (e) { S.loading = false; toast(errText(e)); }
}
function sorted() { return [...S.msgs.values()].sort((a, b) => a.id - b.id); }

function whoLabel(m) {
  if (m.role === 'user') return m.sender;
  if (m.role === 'owner') return 'شما';
  if (m.role === 'model') return '✨ دستیار (AI)';
  if (m.role === 'bot_auto') return '🤖 ربات';
  return `${m.sender || 'پنل'} ${m.mode === 'me' ? '(به‌جای شما)' : '(ربات)'}`;
}
function bubble(m) {
  const out = m.role !== 'user';
  const selecting = !!S.sel; const picked = selecting && S.sel.has(m.msgId);
  const body = [];
  if (selecting && m.msgId) body.push(h('div', { class: 'ck' }, picked ? '☑' : '☐'));
  body.push(h('div', { class: 'who' }, whoLabel(m)));
  if (m.fwd) body.push(h('div', { class: 'fw' }, '↪ فوروارد از ' + m.fwd));
  if (m.replyPreview) body.push(h('div', { class: 'rp' }, m.replyPreview));
  if (m.type) body.push(mediaEl(m));
  const showText = m.text && !(m.type && /^\[.*\]/.test(m.text) && m.type !== 'document') && m.type !== 'sticker';
  if (showText) body.push(h('div', { class: 'txt' }, m.text));
  body.push(h('div', { class: 'meta' },
    m.pinnedAt && h('span', {}, '📌'), m.theirReaction && h('span', { class: 'react' }, m.theirReaction), m.myReaction && h('span', { class: 'react' }, m.myReaction),
    m.deletedAt && h('span', { class: 'del' }, '🗑 حذف‌شده'), m.editedAt && h('span', {}, 'ویرایش‌شده'), fmtTime(m.ts)));
  let timer = null, fired = false; const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
  return h('div', { class: 'msg' + (out ? ' out' : '') + (m.deletedAt ? ' deleted' : '') + (picked ? ' sel' : ''), 'data-id': m.id,
    onclick: () => { if (fired) { fired = false; return; } if (S.sel) toggleSel(m); else msgMenu(m); },
    ontouchstart: () => { fired = false; clear(); if (!S.sel && m.msgId) timer = setTimeout(() => { fired = true; timer = null; startSel(m); }, 550); },
    ontouchend: clear, ontouchmove: clear }, body);
}
function renderMsgs(scroll, focusId) {
  const box = document.getElementById('msgs'); if (!box) return;
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const prevH = box.scrollHeight;
  const kids = []; let day = '';
  if (S.loading) kids.push(h('div', { class: 'empty' }, 'در حال بارگذاری…'));
  else {
    if (S.hasMoreOlder) kids.push(h('button', { class: 'more', onclick: () => fetchMsgs({ before: sorted()[0].id }) }, 'پیام‌های قدیمی‌تر…'));
    const list = sorted();
    if (!list.length) kids.push(h('div', { class: 'empty' }, S.filter ? 'موردی نیست.' : 'پیامی نیست.'));
    for (const m of list) { const d = fmtDay(m.ts); if (d !== day) { day = d; kids.push(h('div', { class: 'day' }, d)); } kids.push(bubble(m)); }
    if (S.hasMoreNewer) kids.push(h('button', { class: 'more', onclick: () => { const l = sorted(); fetchMsgs({ around: l[l.length - 1].id }); } }, 'پیام‌های جدیدتر…'));
  }
  box.replaceChildren(...kids);
  if (focusId) {
    const el = box.querySelector(`[data-id="${focusId}"]`);
    if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); }
  } else if (scroll || (near && !S.around)) box.scrollTop = box.scrollHeight;
  else box.scrollTop = box.scrollTop + (box.scrollHeight - prevH);
}
function renderHeader() {
  const el = document.getElementById('chead'); if (!el) return;
  const c = S.chat;
  el.replaceChildren(h('button', { class: 'ib', onclick: goBack }, '→'),
    h('h1', {}, c.title || '…', h('div', { class: 'sub' }, c.aiPending ? '✨ دستیار در حال آماده‌سازی پاسخ…' : (c.isGroup ? 'گروه' : c.business ? 'چت بیزینس' : 'پیام مستقیم به ربات'))),
    h('button', { class: 'ib', title: 'جستجو در چت', onclick: () => { S.searchOpen = !S.searchOpen; renderSearchBar(); } }, '🔍'),
    h('button', { class: 'ib', title: 'تنظیمات چت', onclick: chatSettings }, '⋮'));
}
function renderPinned() {
  const el = document.getElementById('pinbar'); if (!el) return;
  if (!S.pinned || S.filter) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.replaceChildren(h('span', { class: 'pt' }, '📌 ' + (S.pinned.sender ? S.pinned.sender + ': ' : '') + (S.pinned.text || '[رسانه]')));
  el.onclick = () => jumpTo(S.pinned.id);
}
function renderFab() { const el = document.getElementById('fab'); if (el) el.style.display = S.around ? '' : 'none'; }
function renderSearchBar() {
  const el = document.getElementById('csearch'); if (!el) return;
  if (!S.searchOpen) { el.style.display = 'none'; el.replaceChildren(); return; }
  el.style.display = '';
  const sb = searchBox({ chatId: S.chat.id, onPick: (r) => { S.searchOpen = false; renderSearchBar(); jumpTo(r.id); } });
  el.replaceChildren(h('div', { class: 'row' }, h('div', { class: 'grow' }, sb.el), h('button', { class: 'ib', onclick: () => { S.searchOpen = false; renderSearchBar(); } }, '✕')));
  sb.input.focus();
}
function renderChat() {
  const mk = (id, label) => h('button', { class: 'chip' + (S.filter === id ? ' on' : ''), onclick: () => { S.filter = id; S.msgs = new Map(); S.sig = ''; S.hasMoreOlder = false; S.hasMoreNewer = false; S.around = false; S.loading = true; renderChat(); fetchMsgs({ scroll: true }); } }, label);
  app.replaceChildren(
    h('div', { class: 'top', id: 'chead' }),
    h('div', { class: 'chips' }, mk('', 'همه'), mk('media', '🖼 رسانه‌ها'), mk('deleted', '🗑 حذف‌شده‌ها')),
    h('div', { class: 'pinbar', id: 'pinbar', style: 'display:none' }),
    h('div', { class: 'csearch', id: 'csearch', style: 'display:none' }),
    h('div', { class: 'msgs', id: 'msgs' }),
    h('button', { class: 'fab', id: 'fab', style: 'display:none', onclick: backToLatest }, '⬇ آخرین پیام‌ها'),
    h('div', { id: 'bottom' }));
  renderHeader(); renderPinned(); renderFab(); renderSearchBar(); renderBottom(); renderMsgs(false);
  if (tg) { tg.BackButton.show(); tg.BackButton.offClick(goBack); tg.BackButton.onClick(goBack); }
}
function renderBottom() {
  const el = document.getElementById('bottom'); if (!el) return;
  const typed = (document.getElementById('inp') || {}).value || '';
  if (S.sel) {
    el.replaceChildren(h('div', { class: 'selbar' }, h('span', { class: 'grow' }, `${S.sel.size} پیام انتخاب شده`),
      h('button', { class: 'btn sm', onclick: () => S.sel.size && forwardDialog([...S.sel]) }, '↪ فوروارد'),
      S.me.role === 'admin' && h('button', { class: 'btn sm danger', onclick: delSel }, '🗑 حذف'),
      h('button', { class: 'ib', onclick: () => { S.sel = null; renderBottom(); renderMsgs(false); } }, '✕')));
    return;
  }
  const ta = h('textarea', { id: 'inp', rows: 1, placeholder: 'پیام…', oninput: (e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px'; } });
  const file = h('input', { type: 'file', style: 'display:none', onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) uploadFile(f); } });
  fill(el,
    S.reply && h('div', { class: 'replybar' }, h('span', {}, '↩ ' + S.reply.preview), h('button', { class: 'ib', onclick: () => { S.reply = null; renderBottom(); } }, '✕')),
    h('div', { class: 'composer', id: 'comp' },
      h('button', { class: 'ib', onclick: () => file.click() }, '📎'), file, ta,
      h('button', { class: 'mode', onclick: () => { S.mode = S.mode === 'me' ? 'bot' : 'me'; localStorage.setItem('mode', S.mode); renderBottom(); } }, S.mode === 'me' ? '👤 من' : '🤖 ربات'),
      h('button', { class: 'ib', id: 'mic', onclick: toggleRec }, '🎙'),
      h('button', { class: 'ib send', onclick: sendText }, '➤')));
  if (typed) document.getElementById('inp').value = typed;
}
function goBack() { stopRec(true); S.sel = null; S.searchOpen = false; renderList(); loadChats(); }
function jumpTo(rowId) {
  S.filter = ''; S.around = true; S.msgs = new Map(); S.sig = ''; S.loading = true; S.hasMoreOlder = false; S.hasMoreNewer = false;
  renderChat(); fetchMsgs({ around: rowId, reset: true, focus: rowId });
}
function backToLatest() { S.around = false; S.msgs = new Map(); S.sig = ''; S.loading = true; S.hasMoreNewer = false; renderFab(); renderMsgs(false); fetchMsgs({ scroll: true }); }

// ───────── انتخاب چندتایی ─────────
function startSel(m) { S.sel = new Set(); if (m && m.msgId) S.sel.add(m.msgId); renderBottom(); renderMsgs(false); }
function toggleSel(m) { if (!m.msgId) return; if (S.sel.has(m.msgId)) S.sel.delete(m.msgId); else S.sel.add(m.msgId); if (!S.sel.size) S.sel = null; renderBottom(); renderMsgs(false); }
async function delSel() {
  const ids = [...S.sel]; if (!ids.length) return;
  if (!confirm(`${ids.length} پیام در تلگرام حذف شود؟ (در پنل محفوظ می‌ماند)`)) return;
  try { const r = await call('deleteMessages', { chatId: S.chat.id, msgIds: ids }); toast(`${r.deleted} پیام حذف شد`); S.sel = null; renderBottom(); await fetchMsgs({}); renderMsgs(false); }
  catch (e) { toast(errText(e)); }
}

// ───────── فوروارد ─────────
function forwardDialog(msgIds) {
  const picked = new Map(); let fmode = S.mode; let origin = true;
  const listEl = h('div', { class: 'fwlist' });
  const q = h('input', { type: 'search', placeholder: 'جستجوی چت مقصد…', oninput: () => draw() });
  const send = h('button', { class: 'btn', disabled: true, onclick: () => go() }, 'ارسال');
  const info = (c) => (c.isGroup ? 'گروه' : c.business ? 'چت بیزینس' : 'پیام مستقیم');
  function draw() {
    const t = q.value.trim().toLowerCase();
    listEl.replaceChildren(...S.chats.filter((c) => !t || c.title.toLowerCase().includes(t)).slice(0, 100).map((c) =>
      h('div', { class: 'row', 'data-fw': c.id, onclick: () => { if (picked.has(c.id)) picked.delete(c.id); else picked.set(c.id, c); draw(); } },
        h('div', { class: 'av sm' }, initial(c.title)), h('div', { class: 'grow' }, c.title, h('small', {}, info(c))), picked.has(c.id) ? '☑' : '☐')));
    send.textContent = picked.size ? `ارسال به ${picked.size} چت` : 'ارسال'; if (picked.size) send.removeAttribute('disabled'); else send.setAttribute('disabled', '');
  }
  async function go() {
    const targets = [...picked.values()].map((c) => ({ chatId: c.id, mode: fmode === 'me' && c.business && !c.isGroup ? 'me' : 'bot' }));
    send.setAttribute('disabled', ''); send.textContent = 'در حال ارسال…';
    try {
      const r = await call('forward', { chatId: S.chat.id, msgIds, targets, showOrigin: origin });
      const bad = r.results.filter((x) => !x.ok);
      close(); S.sel = null; renderBottom(); renderMsgs(false);
      toast(bad.length ? `⚠️ ${bad.length} چت ناموفق: ${bad[0].error || ''}` : `فوروارد شد ✅ (${r.results.length} چت)`);
      loadChats();
    } catch (e) { toast(errText(e)); draw(); }
  }
  const modeBtn = h('button', { class: 'mode', onclick: () => { fmode = fmode === 'me' ? 'bot' : 'me'; modeBtn.textContent = fmode === 'me' ? '👤 به‌جای من (چت‌های بیزینس)' : '🤖 از طرف ربات'; } }, fmode === 'me' ? '👤 به‌جای من (چت‌های بیزینس)' : '🤖 از طرف ربات');
  const close = sheet(`↪ فوروارد ${msgIds.length} پیام`, q,
    h('div', { class: 'row' }, h('div', { class: 'grow' }, 'نمایش «فوروارد از …» بالای پیام'), toggle(true, (v) => { origin = v; })),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, 'ارسال'), modeBtn), listEl, send);
  draw();
}

// ───────── مدیریت گروه ─────────
const MOD_LABEL = { ban: '🚫 بن', kick: '🚪 اخراج', unban: '♻️ رفع بن', mute: '🔇 میوت', unmute: '🔊 رفع میوت', delete_user: '🗑 حذف پیام‌ها' };
function modUserDialog(m) {
  const name = m.sender || String(m.senderId); let revoke = false;
  const act = async (input, okMsg) => { try { const r = await call('groupMod', { chatId: S.chat.id, userId: m.senderId, name, ...input }); toast(okMsg + (r.deleted != null ? ` (${r.deleted} پیام)` : '')); fetchMsgs({}); } catch (e) { toast(errText(e)); } };
  const ask = (msg, fn) => () => { if (confirm(msg)) { close(); fn(); } };
  const mute = (minutes, label) => h('button', { class: 'chip', onclick: ask(`«${name}» برای ${label} میوت شود؟`, () => act({ op: 'mute', minutes }, '🔇 میوت شد')) }, label);
  const close = sheet(`🛡 ${name}`, h('p', { class: 'hint' }, `آیدی: ${m.senderId}`),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, 'همراه بن، پیام‌های او هم حذف شود'), toggle(false, (v) => { revoke = v; })),
    h('button', { class: 'act danger', onclick: ask(`«${name}» از گروه بن شود؟`, () => act({ op: 'ban', revoke }, '🚫 بن شد')) }, '🚫 بن'),
    h('button', { class: 'act danger', onclick: ask(`«${name}» از گروه اخراج شود؟ (می‌تواند دوباره برگردد)`, () => act({ op: 'kick' }, '🚪 اخراج شد')) }, '🚪 اخراج (بن + رفع بن)'),
    h('label', { class: 'f' }, '🔇 میوت'), h('div', { class: 'chips' }, mute(60, '۱ ساعت'), mute(1440, '۱ روز'), mute(10080, '۷ روز'), mute(0, 'همیشه')),
    h('button', { class: 'act', onclick: ask(`میوت «${name}» برداشته شود؟`, () => act({ op: 'unmute' }, '🔊 رفع میوت شد')) }, '🔊 رفع میوت'),
    h('button', { class: 'act', onclick: ask(`بن «${name}» برداشته شود؟`, () => act({ op: 'unban' }, '♻️ بن برداشته شد')) }, '♻️ رفع بن'),
    h('button', { class: 'act danger', onclick: ask(`همه‌ی پیام‌های اخیر «${name}» در این گروه حذف شود؟ (در پنل محفوظ می‌ماند)`, () => act({ op: 'deleteUser' }, '🗑 حذف شد')) }, '🗑 حذف همه‌ی پیام‌های این کاربر'));
}
async function modLogDialog() {
  const body = h('div', {}); const close = sheet('🛡 گزارش اقدام‌های گروه', body);
  const draw = async () => {
    try {
      const r = await call('groupMod', { chatId: S.chat.id, op: 'log' });
      body.replaceChildren(...(r.log.length ? r.log.map((l) => h('div', { class: 'row' },
        h('div', { class: 'grow' }, `${MOD_LABEL[l.action] || l.action} · ${l.targetName || l.targetId || ''}`,
          h('small', {}, `${l.by || ''} · ${fmtDay(l.ts)} ${fmtTime(l.ts)}${l.untilTs ? ' · تا ' + fmtDay(l.untilTs) + ' ' + fmtTime(l.untilTs) : ''}${l.count ? ' · ' + l.count + ' پیام' : ''}`)),
        (l.action === 'ban' || l.action === 'mute') && l.targetId && h('button', { class: 'btn sm', onclick: async () => {
          try { await call('groupMod', { chatId: S.chat.id, op: l.action === 'ban' ? 'unban' : 'unmute', userId: l.targetId, name: l.targetName }); toast('انجام شد ✅'); draw(); } catch (e) { toast(errText(e)); } } }, 'بازگردانی'))) : [h('div', { class: 'empty' }, 'هنوز اقدامی ثبت نشده.')]));
    } catch (e) { close(); toast(errText(e)); }
  };
  draw();
}

// ───────── منوی پیام ─────────
const EMOJIS = ['👍', '❤️', '😂', '🔥', '😮', '😢', '🙏'];
function msgMenu(m) {
  const admin = S.me.role === 'admin';
  const box = h('div', {});
  const close = sheet('پیام', box);
  const item = (label, fn, cls) => h('button', { class: 'act' + (cls ? ' ' + cls : ''), onclick: () => { close(); fn(); } }, label);
  if (m.msgId) {
    box.append(h('div', { class: 'emojis' }, EMOJIS.map((e) => h('button', { onclick: async () => { close(); try { await call('react', { chatId: S.chat.id, msgId: m.msgId, emoji: m.myReaction === e ? '' : e }); fetchMsgs({}); } catch (x) { toast(errText(x)); } } }, e))));
    box.append(item('↩ پاسخ', () => { S.reply = { msgId: m.msgId, preview: (m.text || '').slice(0, 60) }; renderBottom(); }));
    box.append(item('↪ فوروارد', () => forwardDialog([m.msgId])));
    box.append(item(m.pinnedAt ? '📌 برداشتن سنجاق' : '📌 سنجاق در چت', async () => {
      try { const r = await call('pinMessage', { chatId: S.chat.id, msgId: m.msgId, pin: !m.pinnedAt }); toast(r.tgError ? `در پنل ${m.pinnedAt ? 'برداشته' : 'سنجاق'} شد؛ تلگرام: ${r.tgError}` : (m.pinnedAt ? 'سنجاق برداشته شد' : 'سنجاق شد ✅')); fetchMsgs({}); }
      catch (e) { toast(errText(e)); } }));
    box.append(item('☑ انتخاب چندتایی', () => startSel(m)));
  }
  if (m.text) box.append(item('📋 کپی متن', () => { (navigator.clipboard ? navigator.clipboard.writeText(m.text) : Promise.reject()).then(() => toast('کپی شد'), () => toast('کپی نشد')); }));
  if (m.role !== 'user' && m.msgId && !m.deletedAt && m.role !== 'bot_auto') box.append(item('✏️ ویرایش', () => editDialog(m)));
  if (m.editedAt && m.msgId) box.append(item('🕘 تاریخچه‌ی ویرایش', () => historyDialog(m)));
  if (admin && S.chat.isGroup && m.role === 'user' && m.senderId) box.append(item('🛡 مدیریت این کاربر در گروه…', () => modUserDialog(m)));
  if (admin && m.msgId && !m.deletedAt) box.append(h('button', { class: 'act danger', onclick: async () => { if (!confirm('پیام در تلگرام حذف می‌شود (در پنل محفوظ می‌ماند). ادامه؟')) return; close(); try { await call('deleteMessage', { chatId: S.chat.id, msgId: m.msgId }); fetchMsgs({}); } catch (x) { toast(errText(x)); } } }, '🗑 حذف از تلگرام'));
}

// ───────── تنظیمات چت ─────────
function chatSettings() {
  const c = S.chat, admin = S.me.role === 'admin';
  const box = h('div', {});
  const save = async (patch) => { try { await call('chatPrefs', { chatId: c.id, ...patch }); Object.assign(S.chat, patch); S.sig = ''; fetchMsgs({}); } catch (e) { toast(errText(e)); } };
  box.append(h('div', { class: 'row' }, h('div', { class: 'grow' }, '📌 سنجاق چت در لیست'), toggle(!!c.pinned, (v) => save({ pinned: v }))));
  box.append(h('div', { class: 'row' }, h('div', { class: 'grow' }, '🔕 بستن اعلان این چت', h('small', {}, 'اعلان تلگرامی این چت برای همه‌ی اعضا ارسال نمی‌شود')), toggle(!!c.muted, (v) => save({ muted: v }))));
  box.append(h('button', { class: 'act', onclick: () => { close(); const ci = chatInfo(c.id); catAssign(ci); } }, '🗂 دسته‌بندی چت…'));
  if (admin && c.isGroup) box.append(h('button', { class: 'act', onclick: () => { close(); modLogDialog(); } }, '🛡 گزارش اقدام‌های مدیریت گروه'));
  if (admin) {
    const sel = h('select', {}, h('option', { value: '' }, 'طبق تنظیم کلی'), h('option', { value: 'on' }, 'همیشه روشن'), h('option', { value: 'off' }, 'خاموش'));
    sel.value = c.aiMode || '';
    const ta = h('textarea', { rows: 6, placeholder: 'خالی = از پرامپت کلی استفاده می‌شود', value: c.prompt || '' });
    box.append(h('label', { class: 'f' }, '✨ هوش مصنوعی در این چت'), sel, h('label', { class: 'f' }, 'پرامپت اختصاصی این چت'), ta,
      h('button', { class: 'btn', onclick: async () => { await save({ aiMode: sel.value || null, prompt: ta.value }); close(); toast('ذخیره شد ✅'); } }, 'ذخیره‌ی تنظیمات هوش مصنوعی'));
  }
  const close = sheet('تنظیمات چت', box);
}

async function sendText() {
  const ta = document.getElementById('inp'); const text = ta.value.trim(); if (!text) return;
  ta.value = ''; ta.style.height = 'auto';
  const rep = S.reply; S.reply = null; if (rep) renderBottom();
  try { await call('send', { chatId: S.chat.id, text, mode: S.mode, replyToMsgId: rep && rep.msgId, replyPreview: rep && rep.preview }); await fetchMsgs({ scroll: true }); }
  catch (e) { toast(errText(e)); const t = document.getElementById('inp'); if (t) t.value = text; }
}
const kindOf = (mime) => mime.startsWith('image/') ? (mime === 'image/gif' ? 'animation' : 'photo') : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'document';
async function uploadFile(file, kind, extra) {
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const CH = 393216, parts = Math.max(1, Math.ceil(buf.length / CH));
    const uploadId = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const caption = (document.getElementById('inp') || {}).value || '';
    const meta = { chatId: S.chat.id, kind: kind || kindOf(file.type || ''), filename: file.name || 'file', mime: file.type || 'application/octet-stream', caption: (extra && extra.noCaption) ? '' : caption, mode: S.mode, replyToMsgId: S.reply && S.reply.msgId };
    for (let i = 0; i < parts; i++) {
      toast(`در حال ارسال… ${Math.round(((i + 1) / parts) * 100)}٪`);
      await call('upload', { uploadId, part: i, parts, b64: u8ToB64(buf.subarray(i * CH, (i + 1) * CH)), meta: i === parts - 1 ? meta : undefined });
    }
    const ta = document.getElementById('inp'); if (ta && !(extra && extra.noCaption)) ta.value = '';
    S.reply = null; renderBottom(); toast('ارسال شد ✅'); await fetchMsgs({ scroll: true });
  } catch (e) { toast(errText(e)); }
}

// ───────── ضبط ویس ─────────
async function toggleRec() {
  if (S.rec) return stopRec(false);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const type = ['audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm;codecs=opus'].find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined); const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => { stream.getTracks().forEach((t) => t.stop()); const cancel = S.recCancel; S.rec = null; S.recCancel = false; const mic = document.getElementById('mic'); if (mic) { mic.textContent = '🎙'; mic.classList.remove('rec'); }
      if (cancel || !chunks.length) return;
      const mime = (rec.mimeType || type || 'audio/webm').split(';')[0]; const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm';
      uploadFile(new File(chunks, 'voice.' + ext, { type: mime }), 'voice', { noCaption: true }); };
    rec.start(); S.rec = rec; const mic = document.getElementById('mic'); mic.textContent = '⏹'; mic.classList.add('rec'); toast('در حال ضبط… دوباره بزن تا ارسال شود');
  } catch (e) { toast('دسترسی میکروفون ممکن نیست: ' + errText(e)); }
}
function stopRec(cancel) { if (S.rec) { S.recCancel = !!cancel; try { S.rec.stop(); } catch (e) {} } }

function editDialog(m) {
  const ta = h('textarea', { rows: 4, value: m.text }); const close = sheet('ویرایش پیام', ta,
    h('button', { class: 'btn', onclick: async () => { try { await call('editMessage', { chatId: S.chat.id, msgId: m.msgId, text: ta.value }); close(); fetchMsgs({}); } catch (e) { toast(errText(e)); } } }, 'ذخیره'));
}
async function historyDialog(m) {
  try {
    const r = await call('editHistory', { chatId: S.chat.id, msgId: m.msgId });
    sheet('نسخه‌های قبلی', r.edits.length ? r.edits.map((x) => h('div', { class: 'row' }, h('div', { class: 'grow' }, x.text, h('small', {}, fmtDay(x.ts) + ' ' + fmtTime(x.ts))))) : h('div', { class: 'empty' }, 'سابقه‌ای نیست.'));
  } catch (e) { toast(errText(e)); }
}

// ───────── تنظیمات کلی (ادمین) ─────────
async function openSettings() {
  let st;
  try { st = (await call('settings', { op: 'get' })).settings; } catch (e) { return toast(errText(e)); }
  const v = { ...st };
  const sw = (label, key, hint) => h('div', { class: 'row' }, h('div', { class: 'grow' }, label, hint && h('small', {}, hint)), toggle(!!v[key], (x) => { v[key] = x; }));
  const inp = (label, key, type, ph) => [h('label', { class: 'f' }, label), h('input', { type: type || 'text', value: v[key] ?? '', placeholder: ph || '', oninput: (e) => { v[key] = type === 'number' ? Number(e.target.value) : e.target.value; } })];
  const key = h('input', { type: 'password', placeholder: st.has_key ? '•••••• (ثبت شده؛ برای تغییر کلید جدید بنویس)' : 'کلید API', oninput: (e) => { v.gemini_api_key = e.target.value; } });
  const prompt = h('textarea', { rows: 9, value: v.system_prompt || '', oninput: (e) => { v.system_prompt = e.target.value; } });
  const body = h('div', {},
    sw('✨ هوش مصنوعی (چت‌های خصوصی)', 'ai_mode'),
    h('label', { class: 'f' }, 'کلید Gemini'), key,
    inp('مدل', 'gemini_model'), inp('ثانیه‌ی سکوت قبل از پاسخ', 'ai_delay_seconds', 'number'), inp('تعداد پیام تاریخچه برای مدل', 'ai_history_limit', 'number'),
    inp('برچسب ابتدای پاسخ AI (خالی = بدون برچسب)', 'assistant_label'),
    h('label', { class: 'f' }, 'پرامپت کلی'), prompt,
    sw('🔔 اعلان‌های تلگرامی (کلی)', 'notify_enabled'), sw('🗑 اعلان وقتی مخاطب پیام پاک کرد', 'notify_deleted'),
    inp('آیدی گروه ادمین (اختیاری، مقصد /send_msg)', 'admin_group_id', 'text', '-100…'),
    sw('💾 ذخیره‌ی فایل رسانه‌ها (آرشیو)', 'archive_media'), inp('سقف حجم هر فایل (مگابایت، حداکثر ۲۰)', 'archive_max_mb', 'number'),
    sw('ذخیره‌ی بایت ویدیو مسیج', 'archive_video_note'),
    h('button', { class: 'btn', onclick: async () => {
      const values = { ...v }; delete values.has_key;
      try { const r = await call('settings', { op: 'save', values }); S.settings = r.settings; S.notifyEnabled = r.settings.notify_enabled; close(); toast('ذخیره شد ✅'); } catch (e) { toast(errText(e)); } } }, 'ذخیره'),
    st.has_key && h('button', { class: 'act danger', onclick: async () => { if (!confirm('کلید Gemini پاک شود؟')) return; try { await call('settings', { op: 'save', values: { clear_gemini_key: true } }); close(); toast('کلید پاک شد'); } catch (e) { toast(errText(e)); } } }, 'پاک کردن کلید Gemini'));
  const close = sheet('⚙️ تنظیمات', body);
}

// ───────── اعضا (ادمین) ─────────
async function openMembers() {
  const body = h('div', {});
  const close = sheet('👥 اعضای مجاز', body);
  const draw = (list) => {
    const idIn = h('input', { type: 'number', placeholder: 'آیدی عددی تلگرام', inputmode: 'numeric' });
    const nameIn = h('input', { type: 'text', placeholder: 'نام (اختیاری)' });
    const roleIn = h('select', {}, h('option', { value: 'user' }, 'کاربر'), h('option', { value: 'admin' }, 'ادمین'));
    const act = async (input) => { try { draw((await call('members', input)).members); } catch (e) { toast(errText(e)); } };
    body.replaceChildren(
      ...list.map((m) => h('div', { class: 'row' },
        h('div', { class: 'grow' }, m.name || m.tgId, h('small', {}, `${m.tgId}${m.fixed ? ' · ادمین اصلی' : ''}`)),
        m.fixed ? h('span', {}, 'ادمین') : h('select', { style: 'width:auto', onchange: (e) => act({ op: 'role', tgId: m.tgId, role: e.target.value }) },
          h('option', { value: 'user', selected: m.role === 'user' }, 'کاربر'), h('option', { value: 'admin', selected: m.role === 'admin' }, 'ادمین')),
        !m.fixed && h('button', { class: 'ib', onclick: () => confirm('حذف این عضو؟') && act({ op: 'remove', tgId: m.tgId }) }, '🗑'))),
      h('label', { class: 'f' }, 'افزودن عضو'), idIn, nameIn, roleIn,
      h('button', { class: 'btn', onclick: () => act({ op: 'add', tgId: Number(idIn.value), role: roleIn.value, name: nameIn.value }) }, 'افزودن'),
      h('p', { class: 'sub', style: 'color:var(--hint);font-size:12px' }, 'ادمین: همه‌ی بخش‌ها · کاربر: دیدن چت‌ها و ارسال پیام. هر نفر باید یک‌بار به ربات /start بزند تا اعلان تلگرامی بگیرد.'));
  };
  try { draw((await call('members', { op: 'list' })).members); } catch (e) { close(); toast(errText(e)); }
}

// ───────── اعلان‌های شخصی ─────────
function openMyPrefs() {
  const box = h('div', {}, h('div', { class: 'row' }, h('div', { class: 'grow' }, '🔔 اعلان تلگرامی پیام‌های جدید', h('small', {}, S.notifyEnabled === false ? 'توسط ادمین به‌طور کلی خاموش شده' : 'ربات پیام جدید رو توی پیوی برات می‌فرسته')),
    toggle(!!S.me.notify, async (v) => { try { await call('prefs', { notify: v }); S.me.notify = v; renderList(); } catch (e) { toast(errText(e)); } })));
  sheet('اعلان‌ها', box);
}

// ───────── polling و راه‌اندازی ─────────
function startPoll() {
  clearInterval(S.poll);
  S.poll = setInterval(() => { if (document.hidden) return; if (S.view === 'list') loadChats(); else if (S.view === 'chat' && !S.around) fetchMsgs({}); }, 3500);
}
function fatal(e) {
  const forbidden = e && e.parameters && e.parameters.code === 'FORBIDDEN';
  const uid = tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id;
  app.replaceChildren(h('div', { class: 'fatal' }, h('h2', {}, forbidden ? '⛔ دسترسی نداری' : '⚠️ خطا'), h('p', {}, errText(e)),
    uid && h('p', {}, 'آیدی عددی تو: ', h('code', {}, String(uid)), h('br'), 'این عدد رو به ادمین بده تا اضافه‌ات کنه.')));
}
(async function boot() {
  app.replaceChildren(h('div', { class: 'empty' }, 'در حال بارگذاری…'));
  try {
    const b = await call('boot');
    S.me = b.me; S.notifyEnabled = b.notifyEnabled; S.settings = b.settings || null;
    const r = await call('chats'); S.chats = r.chats; S.cats = r.categories || [];
    const deep = Number(new URLSearchParams(location.search).get('chat'));
    if (deep) openChat(deep); else renderList();
    startPoll();
  } catch (e) { fatal(e); }
})();
