// Conversation list. The serverless `chats` endpoint returns camelCase rows:
//   { id, title, kind, isGroup, business, direct, muted, pinned, aiMode,
//     lastText, lastSender, lastTs, unread, aiPending, cats }
// (see tgcloud/endpoints/chats.js) — the list renders straight from those.

// Avatar colours: flat tonal fills (M3 style) picked from the chat id's hash.
function avGrad(id) {
  let h = 0; const s = String(id || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = (h % 12) * 30 + 8;
  return `hsl(${hue} 42% 38%)`;
}

// List timestamp: time of day for today, short date for older chats.
function fmtChatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) {
    try { return d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }
  try { return d.toLocaleDateString('fa-IR', { month: 'short', day: 'numeric' }); } catch (e) { return d.toLocaleDateString(); }
}

async function fetchChats(silent) {
  let res = await callCond('chats', {});
  if (!res) return;
  const unchanged = !!res.notModified;
  let chats = res.chats || [];
  if (unchanged) chats = allChats;
  else { if (res.error) return; allChats = chats; if (res.categories) S.cats = res.categories; }

  let hasNew = false;
  if (!unchanged) chats.forEach(c => {
    // Unread counters are computed per member by the endpoint — trust them.
    unreadPer[c.id] = Number(c.unread) || 0;
    if (firstPoll) {
      lastChatText[c.id] = c.lastText;
    } else if (lastChatText[c.id] !== undefined && lastChatText[c.id] !== c.lastText) {
      const self = ['شما', 'پنل', 'شما (من)', 'شما (ربات)', 'ربات', 'دستیار', 'دستیار (AI)'].includes(c.lastSender);
      if (!self && !c.muted && (c.id !== curChatId || document.hidden)) hasNew = true;
      lastChatText[c.id] = c.lastText;
    } else {
      lastChatText[c.id] = c.lastText;
    }
  });
  if (firstPoll) firstPoll = false;
  if (hasNew && typeof notify === 'function') notify();
  if (typeof updGlobalUnread === 'function') updGlobalUnread();

  const nh = JSON.stringify(chats) + '|' + JSON.stringify(unreadPer) + '|' + activeTab + '|' + activeView;
  if (nh === lastChatsHash) return;
  lastChatsHash = nh;
  renderChatList(chats);

  if (curChatId) {
    const c = allChats.find(x => x.id === curChatId);
    const sub = document.getElementById('hdrSub');
    if (sub) {
      if (c && c.aiPending) { sub.textContent = 'در حال آماده‌سازی پاسخ...'; sub.className = 'chat-info-subtitle pend'; }
      else { sub.textContent = 'شناسه: ' + curChatId; sub.className = 'chat-info-subtitle'; }
    }
  }
}

function filterChats() { renderChatList(allChats); }

// Pin / mute are per-chat preferences (any member) → chatPrefs endpoint.
async function togglePin(id, v) {
  try {
    const res = await call('chatPrefs', { chatId: id, pinned: !!v });
    if (res && res.error) { showToast(res.error, 'error'); return; }
    lastChatsHash = ''; await fetchChats(false);
  } catch (e) { showToast((e && e.message) || 'پین انجام نشد', 'error'); }
}
async function toggleMute(id, v) {
  try {
    const res = await call('chatPrefs', { chatId: id, muted: !!v });
    if (res && res.error) { showToast(res.error, 'error'); return; }
    lastChatsHash = ''; await fetchChats(false);
  } catch (e) { showToast((e && e.message) || 'بی‌صدا انجام نشد', 'error'); }
}
function togglePinCurrent() { if (!curChatId) return; const c = allChats.find(x => x.id === curChatId); togglePin(curChatId, !(c && c.pinned)); }
function toggleMuteCurrent() { if (!curChatId) return; const c = allChats.find(x => x.id === curChatId); toggleMute(curChatId, !(c && c.muted)); }

// Profile-modal versions: update the button's icon/label IMMEDIATELY
async function profileTogglePin() {
  if (!curChatId) return;
  const c = allChats.find(x => x.id === curChatId);
  const next = !(c && c.pinned);
  const btn = document.getElementById('paPin');
  btn.querySelector('i').className = 'bi ' + (next ? 'bi-pin-angle-fill' : 'bi-pin-angle');
  btn.querySelector('span').textContent = next ? 'لغو پین' : 'پین گفتگو';
  if (c) c.pinned = next;
  await togglePin(curChatId, next);
}
async function profileToggleMute() {
  if (!curChatId) return;
  const c = allChats.find(x => x.id === curChatId);
  const next = !(c && c.muted);
  const btn = document.getElementById('paMute');
  btn.querySelector('i').className = 'bi ' + (next ? 'bi-bell-slash-fill' : 'bi-bell');
  btn.querySelector('span').textContent = next ? 'لغو بی‌صدا' : 'بی‌صدا کردن';
  if (c) c.muted = next;
  await toggleMute(curChatId, next);
}

// Counts CHATS with at least one unread message in each view
function updateViewBadges(chats) {
  const botChats = chats.filter(c => !c.business || c.direct);
  const bizChats = chats.filter(c => c.business);
  const botUnread = botChats.filter(c => (unreadPer[c.id] || 0) > 0).length;
  const bizUnread = bizChats.filter(c => (unreadPer[c.id] || 0) > 0).length;
  const botBadge = document.getElementById('vbBotCount');
  const bizBadge = document.getElementById('vbBizCount');
  botBadge.textContent = botUnread > 99 ? '99+' : botUnread;
  botBadge.classList.toggle('d-none', botUnread === 0);
  bizBadge.textContent = bizUnread > 99 ? '99+' : bizUnread;
  bizBadge.classList.toggle('d-none', bizUnread === 0);
}

function renderChatList(chats) {
  updateViewBadges(chats);
  const cont = document.getElementById('chatList');
  const term = (document.getElementById('searchInput').value || '').toLowerCase();
  let base = chats.filter(c => (c.title || '').toLowerCase().includes(term));

  if (activeView === 'biz') base = base.filter(c => c.business);
  else base = base.filter(c => !c.business || c.direct);

  document.getElementById('cntAll').textContent = base.length;
  document.getElementById('cntUnread').textContent = base.filter(c => (unreadPer[c.id] || 0) > 0).length;
  document.getElementById('cntPinned').textContent = base.filter(c => c.pinned).length;
  document.getElementById('cntGroups').textContent = base.filter(c => c.isGroup).length;

  let list = base;
  if (activeTab === 'unread') list = list.filter(c => (unreadPer[c.id] || 0) > 0);
  if (activeTab === 'pinned') list = list.filter(c => c.pinned);
  if (activeTab === 'groups') list = list.filter(c => c.isGroup);
  list = [...list].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  cont.innerHTML = '';
  list.forEach(c => {
    const li = document.createElement('li');
    li.className = 'chatlist-chat' + (curChatId === c.id ? ' active' : '');
    li.onclick = () => selChat(c.id, c.title, c.business);

    const av = document.createElement('div');
    av.className = 'dialog-avatar';
    av.style.background = avGrad(c.id);
    const img = document.createElement('img');
    img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="24" font-family="Vazirmatn">' + (c.title ? c.title[0] : '?') + '</text></svg>');
    img.onerror = () => { av.textContent = c.title ? c.title[0].toUpperCase() : '?'; };
    av.appendChild(img);

    const info = document.createElement('div');
    info.className = 'dialog-subtitle-container';

    const row = document.createElement('div');
    row.className = 'dialog-row';
    const title = document.createElement('div');
    title.className = 'row-title';
    const strong = document.createElement('strong');
    strong.textContent = c.title || '';
    title.appendChild(strong);
    if (c.business) {
      const bi = document.createElement('i');
      bi.className = 'bi bi-briefcase-fill';
      bi.title = 'اتصال بیزینسی';
      bi.style.cssText = 'color:var(--md-sys-color-tertiary);font-size:.9rem';
      title.appendChild(bi);
    }
    if (c.isGroup) {
      const gi = document.createElement('i');
      gi.className = 'bi bi-people-fill';
      gi.style.cssText = 'color:var(--md-sys-color-on-surface-variant);font-size:.9rem';
      title.appendChild(gi);
    }
    if (c.muted) {
      const mi = document.createElement('i');
      mi.className = 'bi bi-bell-slash';
      mi.style.cssText = 'color:var(--md-sys-color-on-surface-variant);font-size:1rem';
      title.appendChild(mi);
    }
    if (c.aiPending) {
      const dot = document.createElement('span');
      dot.className = 'ai-dot';
      dot.title = 'در حال آماده‌سازی پاسخ';
      title.appendChild(dot);
    }

    const meta = document.createElement('div');
    meta.className = 'dialog-meta';
    const pt = document.createElement('i');
    pt.className = 'bi ' + (c.pinned ? 'bi-pin-angle-fill' : 'bi-pin-angle') + ' dialog-pin';
    pt.onclick = e => { e.stopPropagation(); togglePin(c.id, !c.pinned); };
    meta.appendChild(pt);
    const time = document.createElement('span');
    time.className = 'dialog-time';
    time.textContent = fmtChatTime(c.lastTs);
    meta.appendChild(time);

    row.appendChild(title);
    row.appendChild(meta);

    const sub = document.createElement('div');
    sub.className = 'row-subtitle';
    const subText = document.createElement('span');
    subText.className = 'dialog-subtitle-inner';
    subText.textContent = (c.lastSender ? c.lastSender + ': ' : '') + (c.lastText || '');
    sub.appendChild(subText);
    const ur = unreadPer[c.id] || 0;
    if (ur > 0) {
      const badge = document.createElement('span');
      badge.className = 'badge dialog-subtitle-badge' + (c.muted ? ' muted' : '');
      badge.textContent = ur > 99 ? '99+' : ur;
      sub.appendChild(badge);
    } else if (c.pinned) {
      const pi = document.createElement('i');
      pi.className = 'bi bi-pin-angle-fill';
      pi.style.cssText = 'color:var(--md-sys-color-on-surface-variant);font-size:1rem';
      sub.appendChild(pi);
    }

    info.appendChild(row);
    info.appendChild(sub);
    li.appendChild(av);
    li.appendChild(info);
    cont.appendChild(li);
  });
}
