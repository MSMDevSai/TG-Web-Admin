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
const S = { me: null, settings: null, view: 'list', chats: [], q: '', chat: null, msgs: new Map(), hasMore: false,
  filter: '', mode: localStorage.getItem('mode') || 'bot', reply: null, poll: null, sig: '', rec: null };
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

// ───────── لیست چت‌ها ─────────
async function loadChats() {
  try { S.chats = (await call('chats')).chats; if (S.view === 'list') renderList(); } catch (e) { toast(errText(e)); }
}
function renderList() {
  const q = S.q.trim().toLowerCase();
  const items = S.chats.filter((c) => !q || c.title.toLowerCase().includes(q) || (c.lastText || '').toLowerCase().includes(q));
  const list = h('div', { class: 'list' }, items.length ? items.map((c) =>
    h('div', { class: 'chat', onclick: () => openChat(c.id) },
      h('div', { class: 'av' }, initial(c.title)),
      h('div', { class: 'mid' },
        h('div', { class: 't' }, h('b', {}, c.title), c.pinned && '📌', c.muted && '🔕', c.aiPending && '✨', h('small', {}, c.lastTs ? fmtTime(c.lastTs) : '')),
        h('div', { class: 't' }, h('div', { class: 'p', style: 'flex:1' }, (c.lastSender ? c.lastSender + ': ' : '') + (c.lastText || '')), c.unread > 0 && h('span', { class: 'badge' }, c.unread)))
  )) : h('div', { class: 'empty' }, 'هنوز چتی ثبت نشده.'));
  const isAdmin = S.me.role === 'admin';
  const search = h('input', { type: 'search', placeholder: 'جستجو…', value: S.q, oninput: (e) => { S.q = e.target.value; renderList(); } });
  app.replaceChildren(
    h('div', { class: 'top' }, h('h1', {}, 'پیام‌ها', h('div', { class: 'sub' }, `${S.me.name} · ${isAdmin ? 'ادمین' : 'کاربر'}`)),
      h('button', { class: 'ib', title: 'اعلان‌ها', onclick: openMyPrefs }, S.me.notify && S.notifyEnabled !== false ? '🔔' : '🔕'),
      isAdmin && h('button', { class: 'ib', title: 'اعضا', onclick: openMembers }, '👥'),
      isAdmin && h('button', { class: 'ib', title: 'تنظیمات', onclick: openSettings }, '⚙️')),
    h('div', { class: 'search' }, search), list);
  if (S.q) { const i = app.querySelector('input[type=search]'); i.focus(); i.setSelectionRange(S.q.length, S.q.length); }
  if (tg) tg.BackButton.hide();
}

// ───────── صفحه‌ی چت ─────────
async function openChat(id) {
  S.view = 'chat'; S.chat = { id }; S.msgs = new Map(); S.hasMore = false; S.filter = ''; S.reply = null; S.sig = '';
  renderChat(true); await fetchMsgs(true);
}
async function fetchMsgs(scroll, before) {
  try {
    const r = await call('messages', { chatId: S.chat.id, limit: 80, filter: S.filter || undefined, beforeId: before });
    if (S.view !== 'chat') return;
    S.chat = { ...S.chat, ...r.chat };
    if (before) { S.hasMoreOlder = r.hasMore; } else if (S.msgs.size === 0) S.hasMoreOlder = r.hasMore;
    for (const m of r.messages) S.msgs.set(m.id, m);
    const sig = JSON.stringify([...S.msgs.values()]) + S.chat.aiPending + S.chat.muted + S.chat.pinned;
    if (sig !== S.sig) { S.sig = sig; renderMsgs(scroll); renderHeader(); }
  } catch (e) { toast(errText(e)); }
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
  const body = [];
  body.push(h('div', { class: 'who' }, whoLabel(m)));
  if (m.fwd) body.push(h('div', { class: 'fw' }, '↪ فوروارد از ' + m.fwd));
  if (m.replyPreview) body.push(h('div', { class: 'rp' }, m.replyPreview));
  if (m.type) body.push(mediaEl(m));
  const showText = m.text && !(m.type && /^\[.*\]/.test(m.text) && m.type !== 'document') && m.type !== 'sticker';
  if (showText) body.push(h('div', { class: 'txt' }, m.text));
  body.push(h('div', { class: 'meta' },
    m.theirReaction && h('span', { class: 'react' }, m.theirReaction), m.myReaction && h('span', { class: 'react' }, m.myReaction),
    m.deletedAt && h('span', { class: 'del' }, '🗑 حذف‌شده'),
    m.editedAt && h('span', {}, 'ویرایش‌شده'), fmtTime(m.ts)));
  return h('div', { class: 'msg' + (out ? ' out' : '') + (m.deletedAt ? ' deleted' : ''), onclick: () => msgMenu(m) }, body);
}
function renderMsgs(scroll) {
  const box = document.getElementById('msgs'); if (!box) return;
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const prevH = box.scrollHeight;
  const kids = []; let day = '';
  if (S.hasMoreOlder) kids.push(h('button', { class: 'more', onclick: async () => { await fetchMsgs(false, sorted()[0].id); } }, 'پیام‌های قدیمی‌تر…'));
  const list = sorted();
  if (!list.length) kids.push(h('div', { class: 'empty' }, S.filter ? 'موردی نیست.' : 'پیامی نیست.'));
  for (const m of list) { const d = fmtDay(m.ts); if (d !== day) { day = d; kids.push(h('div', { class: 'day' }, d)); } kids.push(bubble(m)); }
  box.replaceChildren(...kids);
  if (scroll || near) box.scrollTop = box.scrollHeight; else box.scrollTop = box.scrollTop + (box.scrollHeight - prevH);
}
function renderHeader() {
  const el = document.getElementById('chead'); if (!el) return;
  const c = S.chat;
  el.replaceChildren(h('h1', {}, c.title || '…', h('div', { class: 'sub' }, c.aiPending ? '✨ دستیار در حال آماده‌سازی پاسخ…' : (c.isGroup ? 'گروه' : c.business ? 'چت بیزینس' : 'پیام مستقیم به ربات'))),
    h('button', { class: 'ib', onclick: chatSettings }, '⋮'));
}
function renderChat(first) {
  const typed = (document.getElementById('inp') || {}).value || '';
  const mk = (id, label) => h('button', { class: 'chip' + (S.filter === id ? ' on' : ''), onclick: () => { S.filter = id; S.msgs = new Map(); S.sig = ''; S.hasMoreOlder = false; renderChat(); fetchMsgs(true); } }, label);
  const ta = h('textarea', { id: 'inp', rows: 1, placeholder: 'پیام…', oninput: (e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px'; } });
  const file = h('input', { type: 'file', style: 'display:none', onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) uploadFile(f); } });
  const canMe = S.chat && S.chat.business !== false;
  app.replaceChildren(
    h('div', { class: 'top', id: 'chead' }),
    h('div', { class: 'chips' }, mk('', 'همه'), mk('media', '🖼 رسانه‌ها'), mk('deleted', '🗑 حذف‌شده‌ها')),
    h('div', { class: 'msgs', id: 'msgs' }),
    S.reply && h('div', { class: 'replybar' }, h('span', {}, '↩ ' + S.reply.preview), h('button', { class: 'ib', onclick: () => { S.reply = null; renderChat(); } }, '✕')),
    h('div', { class: 'composer', id: 'comp' },
      h('button', { class: 'ib', onclick: () => file.click() }, '📎'), file, ta,
      h('button', { class: 'mode', onclick: () => { S.mode = S.mode === 'me' ? 'bot' : 'me'; localStorage.setItem('mode', S.mode); renderChat(); } }, S.mode === 'me' ? '👤 من' : '🤖 ربات'),
      h('button', { class: 'ib', id: 'mic', onclick: toggleRec }, '🎙'),
      h('button', { class: 'ib send', onclick: sendText }, '➤')));
  const t2 = document.getElementById('inp'); if (t2 && typed) t2.value = typed;
  renderHeader(); if (!first) renderMsgs(true);
  if (tg) { tg.BackButton.show(); tg.BackButton.offClick(goBack); tg.BackButton.onClick(goBack); }
}
function goBack() { stopRec(true); S.view = 'list'; S.chat = null; renderList(); loadChats(); }

async function sendText() {
  const ta = document.getElementById('inp'); const text = ta.value.trim(); if (!text) return;
  ta.value = ''; ta.style.height = 'auto';
  const rep = S.reply; S.reply = null; if (rep) renderChat();
  try { await call('send', { chatId: S.chat.id, text, mode: S.mode, replyToMsgId: rep && rep.msgId, replyPreview: rep && rep.preview }); await fetchMsgs(true); }
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
    S.reply = null; renderChat(); toast('ارسال شد ✅'); await fetchMsgs(true);
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

// ───────── منوی پیام ─────────
const EMOJIS = ['👍', '❤️', '😂', '🔥', '😮', '😢', '🙏'];
function msgMenu(m) {
  const c2 = sheet('پیام', (() => {
    const box = h('div', {});
    if (m.msgId) {
      box.append(h('div', { class: 'emojis' }, EMOJIS.map((e) => h('button', { onclick: async () => { c2(); try { await call('react', { chatId: S.chat.id, msgId: m.msgId, emoji: m.myReaction === e ? '' : e }); fetchMsgs(false); } catch (x) { toast(errText(x)); } } }, e))));
      box.append(h('button', { class: 'act', onclick: () => { c2(); S.reply = { msgId: m.msgId, preview: (m.text || '').slice(0, 60) }; renderChat(); } }, '↩ پاسخ'));
    }
    if (m.text) box.append(h('button', { class: 'act', onclick: () => { c2(); (navigator.clipboard ? navigator.clipboard.writeText(m.text) : Promise.reject()).then(() => toast('کپی شد'), () => toast('کپی نشد')); } }, '📋 کپی متن'));
    if (m.role !== 'user' && m.msgId && !m.deletedAt && m.role !== 'bot_auto') box.append(h('button', { class: 'act', onclick: () => { c2(); editDialog(m); } }, '✏️ ویرایش'));
    if (m.editedAt && m.msgId) box.append(h('button', { class: 'act', onclick: () => { c2(); historyDialog(m); } }, '🕘 تاریخچه‌ی ویرایش'));
    if (S.me.role === 'admin' && m.msgId && !m.deletedAt) box.append(h('button', { class: 'act danger', onclick: async () => { if (!confirm('پیام در تلگرام حذف می‌شود (در پنل محفوظ می‌ماند). ادامه؟')) return; c2(); try { await call('deleteMessage', { chatId: S.chat.id, msgId: m.msgId }); fetchMsgs(false); } catch (x) { toast(errText(x)); } } }, '🗑 حذف از تلگرام'));
    return box;
  })());
}
function editDialog(m) {
  const ta = h('textarea', { rows: 4, value: m.text }); const close = sheet('ویرایش پیام', ta,
    h('button', { class: 'btn', onclick: async () => { try { await call('editMessage', { chatId: S.chat.id, msgId: m.msgId, text: ta.value }); close(); fetchMsgs(false); } catch (e) { toast(errText(e)); } } }, 'ذخیره'));
}
async function historyDialog(m) {
  try {
    const r = await call('editHistory', { chatId: S.chat.id, msgId: m.msgId });
    sheet('نسخه‌های قبلی', r.edits.length ? r.edits.map((x) => h('div', { class: 'row' }, h('div', { class: 'grow' }, x.text, h('small', {}, fmtDay(x.ts) + ' ' + fmtTime(x.ts))))) : h('div', { class: 'empty' }, 'سابقه‌ای نیست.'));
  } catch (e) { toast(errText(e)); }
}

// ───────── تنظیمات چت ─────────
function chatSettings() {
  const c = S.chat, admin = S.me.role === 'admin';
  const box = h('div', {});
  const save = async (patch) => { try { await call('chatPrefs', { chatId: c.id, ...patch }); Object.assign(S.chat, patch); S.sig = ''; fetchMsgs(false); } catch (e) { toast(errText(e)); } };
  box.append(h('div', { class: 'row' }, h('div', { class: 'grow' }, '📌 سنجاق در لیست'), toggle(!!c.pinned, (v) => save({ pinned: v }))));
  box.append(h('div', { class: 'row' }, h('div', { class: 'grow' }, '🔕 بستن اعلان این چت', h('small', {}, 'اعلان تلگرامی این چت برای همه‌ی اعضا ارسال نمی‌شود')), toggle(!!c.muted, (v) => save({ muted: v }))));
  if (admin) {
    const sel = h('select', {}, h('option', { value: '' }, 'طبق تنظیم کلی'), h('option', { value: 'on' }, 'همیشه روشن'), h('option', { value: 'off' }, 'خاموش'));
    sel.value = c.aiMode || '';
    const ta = h('textarea', { rows: 6, placeholder: 'خالی = از پرامپت کلی استفاده می‌شود', value: c.prompt || '' });
    box.append(h('label', { class: 'f' }, '✨ هوش مصنوعی در این چت'), sel, h('label', { class: 'f' }, 'پرامپت اختصاصی این چت'), ta,
      h('button', { class: 'btn', onclick: async () => { await save({ aiMode: sel.value || null, prompt: ta.value }); close(); toast('ذخیره شد ✅'); } }, 'ذخیره‌ی تنظیمات هوش مصنوعی'));
  }
  const close = sheet('تنظیمات چت', box);
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
  S.poll = setInterval(() => { if (document.hidden) return; if (S.view === 'list') loadChats(); else if (S.view === 'chat') fetchMsgs(false); }, 3500);
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
    S.chats = (await call('chats')).chats;
    const deep = Number(new URLSearchParams(location.search).get('chat'));
    if (deep) openChat(deep); else renderList();
    startPoll();
  } catch (e) { fatal(e); }
})();
