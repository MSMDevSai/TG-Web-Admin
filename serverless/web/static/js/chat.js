// ══════════════════════════════════════════════════════════════
//  Media loading for serverless: files come as base64 chunks
//  via the 'media' endpoint (384 KB chunks). Reassemble into
//  an object URL for <img>/<video>/<audio>.
// ══════════════════════════════════════════════════════════════
const mediaCache = new Map();
function loadMedia(key) {
  if (mediaCache.has(key)) return mediaCache.get(key);
  const p = (async () => {
    let part = 0, parts = 1, mime = '', chunks = [];
    while (part < parts) {
      const r = await call('media', { key, part });
      parts = r.parts; mime = r.mime; chunks.push(b64ToU8(r.b64)); part++;
    }
    return { url: URL.createObjectURL(new Blob(chunks, { type: mime })), mime };
  })();
  mediaCache.set(key, p); p.catch(() => mediaCache.delete(key));
  return p;
}
function b64ToU8(b) { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}

// Custom glass-styled player for voice/video
function mkPlayer(fileKey, kind) {
  const el = document.createElement(kind === 'video' ? 'video' : 'audio');
  el.preload = 'none';
  if (kind === 'video') el.playsInline = true;

  const wrap = document.createElement('div'); wrap.className = 'mp mp-' + kind;
  const playBtn = document.createElement('button'); playBtn.type = 'button'; playBtn.className = 'mp-play';
  playBtn.innerHTML = '<i class="bi bi-play-fill"></i>';

  const bar = document.createElement('div'); bar.className = 'mp-bar';
  const barFill = document.createElement('div'); barFill.className = 'mp-bar-fill';
  bar.appendChild(barFill);

  const time = document.createElement('span'); time.className = 'mp-time'; time.textContent = '0:00';
  const dl = document.createElement('button'); dl.type = 'button'; dl.className = 'mp-dl'; dl.title = 'دانلود';
  dl.innerHTML = '<i class="bi bi-download"></i>';
  dl.onclick = e => { e.stopPropagation(); downloadMedia(fileKey, kind + (kind === 'video' ? '.mp4' : '.ogg')); };

  const toggle = () => { if (el.paused) el.play(); else el.pause(); };
  playBtn.onclick = toggle;
  el.addEventListener('play', () => playBtn.innerHTML = '<i class="bi bi-pause-fill"></i>');
  el.addEventListener('pause', () => playBtn.innerHTML = '<i class="bi bi-play-fill"></i>');
  el.addEventListener('timeupdate', () => {
    const pct = el.duration ? (el.currentTime / el.duration) * 100 : 0;
    barFill.style.width = pct + '%';
    time.textContent = fmtTime(el.duration ? el.duration - el.currentTime : el.currentTime);
  });
  el.addEventListener('loadedmetadata', () => { time.textContent = fmtTime(el.duration); });
  el.addEventListener('ended', () => { playBtn.innerHTML = '<i class="bi bi-play-fill"></i>'; });
  bar.addEventListener('click', e => {
    const r = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    if (el.duration) el.currentTime = ratio * el.duration;
  });

  if (kind === 'voice') {
    wrap.append(playBtn, bar, time, dl);
    wrap.appendChild(el);
  } else {
    const frame = document.createElement('div'); frame.className = 'mp-video-frame';
    const centerPlay = document.createElement('div'); centerPlay.className = 'mp-center-play';
    centerPlay.innerHTML = '<i class="bi bi-play-fill"></i>';
    centerPlay.onclick = toggle;
    el.addEventListener('play', () => centerPlay.classList.add('d-none'));
    el.addEventListener('pause', () => centerPlay.classList.remove('d-none'));
    frame.append(el, centerPlay);
    const strip = document.createElement('div'); strip.className = 'mp-strip';
    strip.append(playBtn, bar, time, dl);
    wrap.append(frame, strip);
  }
  return wrap;
}

async function downloadMedia(fileKey, filename) {
  try {
    const { url } = await loadMedia(fileKey);
    const a = document.createElement('a');
    a.href = url; a.download = filename || 'file';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) {
    showToast('دانلود فایل با خطا مواجه شد.', 'error');
  }
}

function viewMedia(fileKey, type) {
  const img = document.getElementById('mvImg');
  const vid = document.getElementById('mvVideo');
  if (type === 'video') {
    img.classList.add('d-none'); vid.classList.remove('d-none');
    loadMedia(fileKey).then(r => { vid.src = r.url; });
  } else {
    vid.classList.add('d-none'); img.classList.remove('d-none');
    loadMedia(fileKey).then(r => { img.src = r.url; });
  }
  pushUiState({ level: 'overlay', chatId: curChatId || null });
  new bootstrap.Modal(document.getElementById('mediaViewerModal')).show();
  document.getElementById('mediaViewerModal').addEventListener('hidden.bs.modal', () => {
    vid.pause(); vid.src = ''; img.src = '';
  }, { once: true });
}

// ══════════════════════════════════════════════════════════════
//  Reactions
// ══════════════════════════════════════════════════════════════
const REACT_FREQ_KEY = 'tg_reaction_freq';
function getReactFreq() { try { return JSON.parse(localStorage.getItem(REACT_FREQ_KEY) || '{}'); } catch (e) { return {}; } }
function bumpReactFreq(em) { if (!em) return; const f = getReactFreq(); f[em] = (f[em] || 0) + 1; localStorage.setItem(REACT_FREQ_KEY, JSON.stringify(f)); }
function sortByFreq(list) { const f = getReactFreq(); return [...list].sort((a, b) => (f[b] || 0) - (f[a] || 0)); }

async function doReact(chatId, msgId, emoji) {
  const res = await call('react', { chatId, msgId, emoji });
  if (res?.error) showToast(res.error, 'error'); else { bumpReactFreq(emoji); fetchHistory(chatId, false); }
}

function mkReactBar(chatId, msgId, mine) {
  const wrap = document.createElement('div'); wrap.className = 'react-bar-wrap';
  const bar = document.createElement('div'); bar.className = 'react-bar';

  const quick = document.createElement('div'); quick.className = 'react-quick';
  sortByFreq(QUICK_REACT).forEach(em => {
    const s = document.createElement('span'); s.textContent = em;
    if (em === mine) s.classList.add('used');
    s.onclick = e => { e.stopPropagation(); const next = em === mine ? null : em; doReact(chatId, msgId, next); bar.classList.remove('show'); };
    quick.appendChild(s);
  });

  const exp = document.createElement('div'); exp.className = 'react-expand';
  exp.innerHTML = '<i class="bi bi-chevron-down"></i><span style="font-size:.75rem">همه</span>';
  let gridOpen = false;
  const grid = document.createElement('div'); grid.className = 'react-grid';
  sortByFreq(ALL_REACT).forEach(em => {
    const s = document.createElement('span'); s.textContent = em;
    if (em === mine) s.classList.add('used');
    s.onclick = e => { e.stopPropagation(); const next = em === mine ? null : em; doReact(chatId, msgId, next); bar.classList.remove('show'); };
    grid.appendChild(s);
  });
  exp.onclick = e => { e.stopPropagation(); gridOpen = !gridOpen; grid.classList.toggle('open', gridOpen); exp.querySelector('i').style.transform = gridOpen ? 'rotate(180deg)' : ''; };

  bar.appendChild(quick); bar.appendChild(exp); bar.appendChild(grid);
  wrap.appendChild(bar);
  applyEmojiImages(bar);
  return { wrap, bar };
}

function mkReactionChips(m, isOut) {
  const chips = [];
  if (m.their_reaction) chips.push({ emoji: m.their_reaction, mine: false, label: 'کاربر' });
  if (m.my_reaction) chips.push({ emoji: m.my_reaction, mine: true, label: 'من' });
  if (!chips.length) return null;
  const row = document.createElement('div'); row.className = 'reaction-row' + (isOut ? ' out' : '');
  chips.forEach(c => {
    const chip = document.createElement('span'); chip.className = 'rchip' + (c.mine ? ' mine' : '');
    chip.innerHTML = c.emoji + ' <span class="rl">' + c.label + '</span>';
    if (c.mine) { chip.title = 'برای حذف کلیک کن'; chip.onclick = () => doReact(curChatId, m.id, null); }
    row.appendChild(chip);
  });
  return row;
}

// ══════════════════════════════════════════════════════════════
//  Reply strip
// ══════════════════════════════════════════════════════════════
function setReply(msgId, prev) {
  replyTarget = { msgId, prev };
  document.getElementById('rstripTxt').textContent = prev;
  document.getElementById('rstrip').classList.add('show');
  document.getElementById('msgIn').focus();
}
function cancelReply() { replyTarget = null; document.getElementById('rstrip').classList.remove('show'); }

// ══════════════════════════════════════════════════════════════
//  Topbar + chat selection
// ══════════════════════════════════════════════════════════════
async function selChat(id, title, biz) {
  curChatId = id; unreadCnt = 0; lastHistHash = ''; cancelReply(); unreadPer[id] = 0; updGlobalUnread();
  if (window.innerWidth <= 768) document.getElementById('sidebar').classList.add('mh');
  document.getElementById('noChat').classList.add('d-none');
  document.getElementById('chatBox').classList.remove('d-none');
  document.getElementById('chatBox').classList.add('d-flex');
  document.getElementById('hdrTitle').innerText = title || id;

  const av = document.getElementById('hdrAv');
  av.innerHTML = ''; av.style.background = avGrad(id);
  const img = document.createElement('div');
  img.textContent = (title ? title[0] : '?').toUpperCase();
  av.appendChild(img);
  document.getElementById('hdrSub').textContent = 'شناسه: ' + id;

  pushUiState({ level: 'chat', chatId: id });

  const chatObj = allChats.find(x => x.id === id) || {};
  isGroup = chatObj.is_group || false;
  curBizId = chatObj.business_connection_id || biz || null;
  const hasBiz = !!curBizId;
  const hasBotDirect = chatObj.has_bot_chat !== undefined ? !!chatObj.has_bot_chat : !hasBiz;

  const ss = document.getElementById('senderSelector');
  const rBot = document.querySelector('input[name="sender"][value="bot"]');
  const rMe = document.querySelector('input[name="sender"][value="me"]');
  if (hasBiz && hasBotDirect) { ss.style.display = 'flex'; }
  else if (hasBiz) { ss.style.display = 'none'; if (rMe) rMe.checked = true; }
  else { ss.style.display = 'none'; if (rBot) rBot.checked = true; }

  lastChatsHash = ''; renderChatList(allChats);
  await fetchHistory(id, false);
  await loadChatSP(id);
  scrollBot(false);
}

// ══════════════════════════════════════════════════════════════
//  Unified back-stack
// ══════════════════════════════════════════════════════════════
var isApplyingHistoryState = false;

function pushUiState(state) {
  if (isApplyingHistoryState) return;
  if (history.state && history.state.level === state.level && history.state.chatId === state.chatId) return;
  history.pushState(state, '', '#' + state.level);
}

function backList() {
  document.getElementById('sidebar').classList.remove('mh');
  document.getElementById('chatBox').classList.add('d-none');
  document.getElementById('chatBox').classList.remove('d-flex');
  document.getElementById('noChat').classList.remove('d-none');
  curChatId = null;
}

function applyUiState(state) {
  isApplyingHistoryState = true;
  document.querySelectorAll('.modal.show').forEach(m => { const inst = bootstrap.Modal.getInstance(m); if (inst) inst.hide(); });
  closeMsgContextMenu();
  const level = state && state.level;
  if (level !== 'settings' && level !== 'settings-sub') {
    document.getElementById('settingsPage').classList.remove('show');
  }
  if (!level) {
    if (curChatId) backList();
  } else if (level === 'chat') {
    // chat view DOM is already correct
  } else if (level === 'profile') {
    new bootstrap.Modal(document.getElementById('profileModal')).show();
  } else if (level === 'ai') {
    new bootstrap.Modal(document.getElementById('chatSP')).show();
  } else if (level === 'settings') {
    document.getElementById('settingsPage').classList.add('show');
    showSettingsMain();
  } else if (level === 'settings-sub') {
    document.getElementById('settingsPage').classList.add('show');
    showSettingsSub(state.sub);
  }
  setTimeout(() => { isApplyingHistoryState = false; }, 30);
}

function goBackOneLevel() {
  if (history.state && history.state.level) history.back();
  else backList();
}
function handleBackButton() { goBackOneLevel(); }

window.addEventListener('popstate', e => applyUiState(e.state));

function wireModalBackStack(modalId, level) {
  document.getElementById(modalId).addEventListener('hidden.bs.modal', () => {
    if (!isApplyingHistoryState && history.state && history.state.level === level) history.back();
  });
}

// ══════════════════════════════════════════════════════════════
//  Date grouping + message grouping
// ══════════════════════════════════════════════════════════════
function dateLabel(ts) {
  const d = new Date(ts);
  const now = new Date();
  const startOfDay = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays === 0) return 'امروز';
  if (diffDays === 1) return 'دیروز';
  try { return d.toLocaleDateString('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch (e) { return d.toLocaleDateString(); }
}

function sameGroup(a, b) {
  return !!a && !!b && a.role === b.role && a.sender === b.sender && !b.reply_to_preview && !b.forwarded_from;
}

// ══════════════════════════════════════════════════════════════
//  Paginated history
// ══════════════════════════════════════════════════════════════
const PAGE_SIZE = 100;
var loadedMsgs = [];
var oldestLoadedId = null;
var hasMoreOlder = true;
var lastDateKeyRendered = null;

function buildMsgRow(m, prevM) {
  const isOut = m.role === 'admin' || m.role === 'model' || m.role === 'owner' || m.role === 'bot_auto';
  const contPrev = sameGroup(prevM, m);

  const frag = document.createDocumentFragment();
  if (m.ts) {
    const dayKey = new Date(m.ts).toDateString();
    if (dayKey !== lastDateKeyRendered) {
      const sep = document.createElement('div'); sep.className = 'date-sep'; sep.textContent = dateLabel(m.ts);
      frag.appendChild(sep);
      lastDateKeyRendered = dayKey;
    }
  }

  const row = document.createElement('div');
  row.className = 'msg-row ' + (isOut ? 'out' : 'in') + (contPrev ? ' grp' : '');
  row.dataset.mid = m.id;

  if (m.forwarded_from) {
    const fl = document.createElement('div'); fl.className = 'fwd-lbl';
    fl.innerHTML = '<i class="bi bi-arrow-90deg-left"></i> فوروارد از ' + m.forwarded_from;
    row.appendChild(fl);
  }

  const bub = document.createElement('div');
  let bc = 'b-user';
  if (m.role === 'owner') bc = 'b-me';
  else if (m.role === 'admin' || m.role === 'bot_auto' || m.role === 'model') bc = 'b-bot';
  bub.className = 'bubble ' + bc;
  if (contPrev) bub.classList.add('cont-prev');
  bub.classList.add('has-tail');

  if (!contPrev) {
    const sn = document.createElement('div'); sn.className = 'msg-sender';
    let lbl = m.sender || '';
    if (m.role === 'owner') lbl = '🧑 (من)';
    else if (m.role === 'admin') lbl = '🖥 (پنل)';
    else if (m.role === 'model') lbl = '🤖 (هوش مصنوعی)';
    else if (m.role === 'bot_auto') lbl = '🤖 (ربات خودکار)';
    sn.textContent = lbl; bub.appendChild(sn);
  }
  if (m.reply_to_preview) {
    const rq = document.createElement('div'); rq.className = 'rq';
    rq.setAttribute('role', 'button'); rq.tabIndex = 0; rq.title = 'رفتن به پیام اصلی';
    const ri = document.createElement('i'); ri.className = 'bi bi-reply-fill'; ri.style.flexShrink = '0';
    const rs = document.createElement('span'); rs.textContent = m.reply_to_preview;
    rq.append(ri, rs);
    const goOriginal = ev => { ev.stopPropagation(); jumpToReplied(m); };
    rq.addEventListener('click', goOriginal);
    rq.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); goOriginal(ev); } });
    bub.appendChild(rq);
  }
  if (String(m.text || '').startsWith('/')) {
    const cb = document.createElement('div'); cb.className = 'cmd-badge'; cb.textContent = 'دستور';
    bub.appendChild(cb);
  }
  const med = mkMedia(m); if (med) bub.appendChild(med);

  const foot = document.createElement('div'); foot.className = 'msg-foot';
  if (m.text) { const td = document.createElement('div'); td.style.whiteSpace = 'pre-wrap'; td.textContent = m.text; foot.appendChild(td); }
  const ts = document.createElement('span'); ts.className = 'msg-time'; ts.textContent = m.time || '';
  foot.appendChild(ts);
  bub.appendChild(foot);

  row.appendChild(bub);

  const rc = mkReactionChips(m, isOut);
  if (rc) row.appendChild(rc);

  if (m.msgId) {
    const bar = document.createElement('div'); bar.className = 'msg-bar';
    const rbBtn = document.createElement('span'); rbBtn.className = 'tbb'; rbBtn.innerHTML = '<i class="bi bi-emoji-smile"></i>';
    let rb = null;
    rbBtn.onclick = e => {
      e.stopPropagation();
      if (!rb) { const made = mkReactBar(curChatId, m.id, m.myReaction); rb = made.bar; bar.appendChild(made.wrap); }
      document.querySelectorAll('.react-bar.show').forEach(x => { if (x !== rb) x.classList.remove('show'); });
      rb.classList.toggle('show');
    };
    bar.appendChild(rbBtn);

    const replyBtn = document.createElement('span'); replyBtn.className = 'tbb'; replyBtn.innerHTML = '<i class="bi bi-reply"></i>'; replyBtn.title = 'ریپلای';
    replyBtn.onclick = () => setReply(m.id, (m.sender || '') + ': ' + (m.text || '[رسانه]'));
    bar.appendChild(replyBtn);

    if (m.role === 'admin' || m.role === 'owner' || m.role === 'bot_auto' || m.role === 'model') {
      const eb = document.createElement('span'); eb.className = 'tbb'; eb.innerHTML = '<i class="bi bi-pencil"></i>'; eb.title = 'ویرایش';
      eb.onclick = () => editMsg(m.id, m.msgId || '', m.text);
      bar.appendChild(eb);
    }
    row.appendChild(bar);
  }

  frag.appendChild(row);
  return frag;
}

function fixGroupTail(aroundId) {
  const cont = document.getElementById('msgs');
  for (let i = 0; i < loadedMsgs.length; i++) {
    if (aroundId !== undefined && loadedMsgs[i].id !== aroundId) continue;
    const m = loadedMsgs[i], nextM = loadedMsgs[i + 1];
    const row = cont.querySelector(`.msg-row[data-mid="${CSS.escape(String(m.id))}"]`);
    const bub = row && row.querySelector('.bubble');
    if (!bub) continue;
    const contNext = sameGroup(m, nextM);
    bub.classList.toggle('cont-next', contNext);
    bub.classList.toggle('has-tail', !contNext);
  }
}

function renderFullList(list) {
  const cont = document.getElementById('msgs');
  cont.innerHTML = '';
  if (hasMoreOlder && list.length >= PAGE_SIZE) {
    const btn = document.createElement('div'); btn.id = 'loadOlderBtn'; btn.className = 'load-older-btn';
    btn.textContent = 'بارگذاری پیام‌های قدیمی‌تر';
    btn.onclick = loadOlderMessages;
    cont.appendChild(btn);
  }
  lastDateKeyRendered = null;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < list.length; i++) frag.appendChild(buildMsgRow(list[i], list[i - 1]));
  applyEmojiImages(frag);
  cont.appendChild(frag);
  initMsgGestures();
}

function appendRows(newItems) {
  const cont = document.getElementById('msgs');
  const prevLast = loadedMsgs.length ? loadedMsgs[loadedMsgs.length - 1] : null;
  let prev = prevLast;
  for (const m of newItems) {
    const f = buildMsgRow(m, prev); applyEmojiImages(f);
    f.querySelectorAll('.msg-row').forEach(r => r.classList.add('msg-enter'));
    cont.appendChild(f); prev = m;
  }
  if (prevLast) fixGroupTail(prevLast.id);
}

async function fetchHistory(chatId, silent) {
  if (!chatId) return;
  if (!silent) {
    loadedMsgs = []; oldestLoadedId = null; hasMoreOlder = true; lastHistHash = '';
    const hist = await callCond('messages', { chatId, limit: PAGE_SIZE });
    if (!hist) return;
    loadedMsgs = hist.messages || hist;
    oldestLoadedId = loadedMsgs.length ? loadedMsgs[0].id : null;
    lastHistHash = JSON.stringify(loadedMsgs);
    renderFullList(loadedMsgs);
    scrollBot(false);
    return;
  }

  const hist = await callCond('messages', { chatId, limit: PAGE_SIZE });
  if (!hist || hist.notModified) return;
  if (hist.error) return;
  const hs = JSON.stringify(hist.messages || hist);
  if (hs === lastHistHash) return;
  lastHistHash = hs;
  const wasBot = atBot();

  const oldIds = loadedMsgs.map(m => m.id);
  const newIds = (hist.messages || hist).map(m => m.id);
  const sameLength = oldIds.length === newIds.length;
  let commonPrefix = 0;
  while (commonPrefix < oldIds.length && commonPrefix < newIds.length && oldIds[commonPrefix] === newIds[commonPrefix]) commonPrefix++;

  if (commonPrefix === oldIds.length && newIds.length > oldIds.length) {
    const added = (hist.messages || hist).slice(commonPrefix);
    loadedMsgs = hist.messages || hist;
    appendRows(added);
    if (wasBot) scrollBot(true);
    else { unreadCnt += added.length; updUBadge(); document.getElementById('scrollBtn').classList.remove('d-none'); }
    return;
  }
  if (sameLength && commonPrefix === oldIds.length) return;

  loadedMsgs = hist.messages || hist;
  oldestLoadedId = loadedMsgs.length ? loadedMsgs[0].id : oldestLoadedId;
  renderFullList(loadedMsgs);
  if (!wasBot) {
    document.getElementById('scrollBtn').classList.remove('d-none');
  } else {
    scrollBot(true);
  }
}

async function loadOlderMessages() {
  if (!hasMoreOlder || !oldestLoadedId || !curChatId) return;
  const btn = document.getElementById('loadOlderBtn');
  if (btn) btn.textContent = 'در حال بارگذاری...';
  const older = await call('messages', { chatId: curChatId, limit: PAGE_SIZE, beforeId: oldestLoadedId });
  if (!older || !older.messages || !older.messages.length) {
    hasMoreOlder = false;
    if (btn) btn.remove();
    return;
  }
  const cont = document.getElementById('msgs');
  const anchor = cont.firstElementChild;
  const prevScrollHeight = cont.scrollHeight, prevScrollTop = cont.scrollTop;

  loadedMsgs = older.messages.concat(loadedMsgs);
  oldestLoadedId = older.messages[0].id;
  lastDateKeyRendered = null;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < older.messages.length; i++) frag.appendChild(buildMsgRow(older.messages[i], older.messages[i - 1]));
  applyEmojiImages(frag);
  if (anchor) cont.insertBefore(frag, anchor); else cont.appendChild(frag);
  fixGroupTail(older.messages[older.messages.length - 1].id);
  cont.scrollTop = prevScrollTop + (cont.scrollHeight - prevScrollHeight);
  if (btn) btn.textContent = 'بارگذاری پیام‌های قدیمی‌تر';
  if (older.messages.length < PAGE_SIZE) { hasMoreOlder = false; if (btn) btn.remove(); }
}

// ══════════════════════════════════════════════════════════════
//  Media rendering
// ══════════════════════════════════════════════════════════════
function mkMedia(m) {
  if (!m.type || !m.mediaKey) return null;
  const w = document.createElement('div');
  if (m.type === 'photo') {
    w.className = 'msg-media';
    const i = document.createElement('img');
    i.loading = 'lazy'; i.decoding = 'async';
    loadMedia(m.mediaKey).then(r => { i.src = r.url; });
    i.onclick = () => viewMedia(m.mediaKey, 'photo');
    const dlBtn = document.createElement('button'); dlBtn.type = 'button'; dlBtn.className = 'media-dl-overlay';
    dlBtn.innerHTML = '<i class="bi bi-download"></i>';
    dlBtn.onclick = e => { e.stopPropagation(); downloadMedia(m.mediaKey, 'photo.jpg'); };
    w.append(i, dlBtn);
  } else if (m.type === 'video') {
    w.appendChild(mkPlayer(m.mediaKey, 'video'));
    loadMedia(m.mediaKey).then(r => { w.querySelector('video').src = r.url; });
  } else if (m.type === 'voice') {
    w.appendChild(mkPlayer(m.mediaKey, 'voice'));
    loadMedia(m.mediaKey).then(r => { w.querySelector('audio').src = r.url; });
  } else if (m.type === 'animation') {
    w.className = 'msg-media';
    const v = document.createElement('video');
    v.preload = 'none';
    v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true;
    w.appendChild(v);
    loadMedia(m.mediaKey).then(r => { v.src = r.url; });
  } else if (m.type === 'sticker') {
    w.className = 'msg-sticker';
    loadMedia(m.mediaKey).then(r => {
      const mime = r.mime || '';
      if (mime === 'image/webp') {
        w.innerHTML = '<img src="' + r.url + '" class="m stk">';
      } else if (mime === 'video/webm') {
        w.innerHTML = '<video class="m stk" src="' + r.url + '" autoplay loop muted playsinline></video>';
      } else {
        w.textContent = m.text || '🎭';
      }
    });
  } else if (m.type === 'document') {
    w.className = 'msg-doc';
    const a = document.createElement('a');
    a.href = '#'; a.className = 'text-white text-decoration-none';
    a.innerHTML = '<i class="bi bi-file-earmark-arrow-down"></i> دانلود فایل';
    a.onclick = e => { e.preventDefault(); downloadMedia(m.mediaKey, m.text || 'file'); };
    w.appendChild(a);
  } else return null;
  return w;
}

// ══════════════════════════════════════════════════════════════
//  Message context menu (right-click / long-press)
// ══════════════════════════════════════════════════════════════
let _gesturesReady = false;

let _jumping = false;
async function jumpToReplied(m) {
  if (_jumping) return;
  _jumping = true;
  try {
    const ptxt = (m.replyPreview || '').replace(/^[^:]*:\s*/, '');
    const find = () => {
      if (m.replyTo != null) {
        return loadedMsgs.find(x => x.msgId != null && String(x.msgId) === String(m.replyTo)) || null;
      }
      if (!ptxt) return null;
      for (let i = loadedMsgs.indexOf(m) - 1; i >= 0; i--) {
        if (((loadedMsgs[i].text || '[رسانه]')).startsWith(ptxt)) return loadedMsgs[i];
      }
      return null;
    };
    let target = find(), guard = 0;
    while (!target && hasMoreOlder && guard++ < 60) { await loadOlderMessages(); target = find(); }
    const row = target && document.querySelector('#msgs .msg-row[data-mid="' + CSS.escape(String(target.id)) + '"]');
    if (!row) { showToast('پیام اصلی پیدا نشد (ممکن است حذف شده باشد)', 'warn'); return; }
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.remove('msg-flash'); void row.offsetWidth; row.classList.add('msg-flash');
    setTimeout(() => row.classList.remove('msg-flash'), 1800);
  } finally { _jumping = false; }
}

function msgById(id) { return loadedMsgs.find(m => String(m.id) === String(id)); }

function initMsgGestures() {
  if (_gesturesReady) return; _gesturesReady = true;
  const box = document.getElementById('msgs');
  const rowOf = t => (t && t.closest) ? t.closest('.msg-row') : null;
  const open = (row, x, y) => {
    const m = msgById(row.dataset.mid);
    if (m && m.msgId) openMsgContextMenu(x, y, m, row.classList.contains('out'));
  };
  box.addEventListener('contextmenu', e => {
    const row = rowOf(e.target); if (!row) return;
    e.preventDefault(); open(row, e.clientX, e.clientY);
  });
  let st = null;
  box.addEventListener('touchstart', e => {
    const row = rowOf(e.target); if (!row) { st = null; return; }
    const t = e.touches[0];
    st = { row, x: t.clientX, y: t.clientY, dx: 0, moved: false, swiping: false, icon: null };
    st.timer = setTimeout(() => { if (st && !st.moved) open(st.row, st.x, st.y); }, 450);
  }, { passive: true });
  box.addEventListener('touchmove', e => {
    if (!st) return;
    const t = e.touches[0], dx = t.clientX - st.x, dy = t.clientY - st.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) { st.moved = true; clearTimeout(st.timer); }
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      st.swiping = true; st.dx = dx;
      const c = Math.max(-80, Math.min(80, dx));
      st.row.style.transform = `translateX(${c}px)`;
      if (!st.icon) {
        st.row.style.position = 'relative';
        st.icon = document.createElement('i'); st.icon.className = 'bi bi-reply-fill swipe-reply-icon';
        st.row.appendChild(st.icon);
      }
      st.icon.style.opacity = Math.min(1, Math.abs(c) / 60);
    }
  }, { passive: true });
  const end = () => {
    if (!st) return;
    clearTimeout(st.timer);
    if (st.swiping && Math.abs(st.dx) > 60) {
      const m = msgById(st.row.dataset.mid);
      if (m && m.msgId) setReply(m.msgId, (m.sender || '') + ': ' + (m.text || '[رسانه]'));
    }
    st.row.style.transform = ''; if (st.icon) st.icon.remove();
    st = null;
  };
  box.addEventListener('touchend', end, { passive: true });
  box.addEventListener('touchcancel', end, { passive: true });
}

function closeMsgContextMenu() {
  const menu = document.getElementById('msgCtxMenu');
  if (!menu.classList.contains('show')) return;
  menu.classList.remove('show');
  if (!isApplyingHistoryState && history.state && history.state.level === 'ctx') history.back();
}

function openMsgContextMenu(x, y, m, isOut) {
  pushUiState({ level: 'ctx', chatId: curChatId });
  const menu = document.getElementById('msgCtxMenu');
  const reactBox = document.getElementById('mcmReact');
  const itemsBox = document.getElementById('mcmItems');

  reactBox.innerHTML = '';
  sortByFreq(QUICK_REACT).forEach(em => {
    const s = document.createElement('span'); s.textContent = em;
    s.onclick = () => { doReact(curChatId, m.id, em === m.myReaction ? null : em); closeMsgContextMenu(); };
    reactBox.appendChild(s);
  });
  applyEmojiImages(reactBox);

  const items = [];
  items.push({ icon: 'bi-reply', label: 'ریپلای', fn: () => setReply(m.id, (m.sender || '') + ': ' + (m.text || '[رسانه]')) });
  if (m.role === 'admin' || m.role === 'owner' || m.role === 'bot_auto' || m.role === 'model') {
    items.push({ icon: 'bi-pencil', label: 'ویرایش', fn: () => editMsg(m.id, m.msgId || '', m.text) });
  }
  if (m.text) items.push({ icon: 'bi-clipboard', label: 'کپی متن', fn: () => { navigator.clipboard?.writeText(m.text); } });
  items.push({ icon: 'bi-forward', label: 'فوروارد', fn: () => forwardMsg(m.id) });
  if (curIsGroupForCtx()) items.push({ icon: 'bi-pin-angle', label: 'پین پیام', fn: () => pinMsgById(m.id) });
  items.push({ icon: 'bi-trash3', label: 'حذف', danger: true, fn: () => deleteMsgById(m.id) });

  itemsBox.innerHTML = '';
  items.forEach(it => {
    const d = document.createElement('div'); d.className = 'mcm-item' + (it.danger ? ' danger' : '');
    d.innerHTML = `<i class="bi ${it.icon}"></i><span>${it.label}</span>`;
    d.onclick = () => { it.fn(); closeMsgContextMenu(); };
    itemsBox.appendChild(d);
  });

  menu.classList.add('show');
  const mw = 260, mh = menu.offsetHeight || 320;
  let left = x, top = y;
  if (left + mw > window.innerWidth) left = window.innerWidth - mw - 10;
  if (top + mh > window.innerHeight) top = window.innerHeight - mh - 10;
  menu.style.left = Math.max(10, left) + 'px';
  menu.style.top = Math.max(10, top) + 'px';
}

function curIsGroupForCtx() { return !!isGroup; }

document.addEventListener('click', e => {
  if (!e.target.closest('#msgCtxMenu')) closeMsgContextMenu();
});

async function forwardMsg(msgId) {
  const to = prompt('آیدی عددی چت مقصد برای فوروارد:');
  if (!to) return;
  const selR = document.querySelector('input[name="sender"]:checked');
  const mode = (selR && selR.value === 'me') ? 'me' : 'bot';
  const res = await call('forward', { chatId: curChatId, msgId, targets: [{ chatId: Number(to), mode }] });
  if (res?.error) showToast(res.error, 'error'); else showToast('فوروارد شد', 'success');
}

async function pinMsgById(msgId) {
  const res = await call('pinMessage', { chatId: curChatId, msgId, businessConnectionId: curBizId });
  if (res?.error) showToast(res.error, 'error'); else fetchHistory(curChatId, false);
}

async function deleteMsgById(msgId) {
  if (!confirm('این پیام حذف بشه؟')) return;
  const res = await call('deleteMessage', { chatId: curChatId, msgId });
  if (res?.error) showToast(res.error, 'error'); else fetchHistory(curChatId, false);
}

// Edit message
async function editMsg(iid, mid, old) {
  const nt = prompt('ویرایش پیام:', old);
  if (!nt || nt === old) return;
  const res = await call('editMessage', { chatId: curChatId, msgId: mid, text: nt });
  if (res?.ok) fetchHistory(curChatId, false);
  else showToast(res?.error || 'خطا', 'error');
}

// Delete message
async function deleteMsgById(msgId) {
  if (!confirm('این پیام حذف بشه؟')) return;
  const res = await call('deleteMessage', { chatId: curChatId, msgId });
  if (res?.error) showToast(res.error, 'error'); else fetchHistory(curChatId, false);
}

// Delete chat from panel (UI only — serverless has no dedicated endpoint;
  // content stays in the archive and the chat reappears on new message)
async function deleteCurrentChat() {
  if (!curChatId) return;
  if (!confirm('این گفتگو از لیست پنل حذف شود؟ (محتوا در آرشیو می‌ماند)')) return;
  // Just leave the chat view; no server-side "hide chat" endpoint exists yet
  backList(); lastChatsHash = ''; fetchChats(false);
}

// ══════════════════════════════════════════════════════════════
//  Chat AI settings
// ══════════════════════════════════════════════════════════════
async function loadChatSP(id) {
  const chat = allChats.find(c => c.id === id);
  const on = chat ? (chat.aiMode !== undefined ? chat.aiMode === 'on' : true) : true;
  document.getElementById('csAi').checked = on;
  document.getElementById('csPrompt').value = chat?.prompt || '';
  updateCsStatus();
}
function updateCsStatus() {
  const on = document.getElementById('csAi').checked;
  const el = document.getElementById('csStatus');
  el.textContent = on ? 'فعال' : 'غیرفعال'; el.className = 'pa-sub ' + (on ? 'on' : 'off');
  const paEl = document.getElementById('paAiStatus');
  if (paEl) { paEl.textContent = on ? 'فعال' : 'غیرفعال'; paEl.className = 'pa-sub ' + (on ? 'on' : 'off'); }
}
async function saveChatSettings() {
  if (!curChatId) return;
  const res = await call('chatPrefs', { chatId: curChatId, aiMode: document.getElementById('csAi').checked ? 'on' : 'off', prompt: document.getElementById('csPrompt').value });
  if (res?.success) { bootstrap.Modal.getInstance(document.getElementById('chatSP')).hide(); }
  else showToast(res?.error || 'خطا', 'error');
}

function openChatSettingsFromProfile() {
  pushUiState({ level: 'ai', chatId: curChatId });
  bootstrap.Modal.getInstance(document.getElementById('profileModal'))?.hide();
  new bootstrap.Modal(document.getElementById('chatSP')).show();
}

// Wire modal back-stack
wireModalBackStack('profileModal', 'profile');
wireModalBackStack('chatSP', 'ai');
wireModalBackStack('newChatModal', 'overlay');
wireModalBackStack('gmodModal', 'overlay');
wireModalBackStack('mediaViewerModal', 'overlay');
