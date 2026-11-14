// Avatar colours: flat tonal fills (M3 style) picked from the chat id's hash.
// Mid-lightness + moderate chroma keeps white initials readable.
function avGrad(id) {
    let h = 0; const s = String(id || "");
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const hue = (h % 12) * 30 + 8;
    return `hsl(${hue} 42% 38%)`;
}

async function fetchChats(silent) {
    let chats = await apiFetchCond('/api/chats');
    if (!chats) return;
    const unchanged = !!chats.notModified;       // 304: same list as last time — skip the new-message scan
    if (unchanged) chats = allChats;
    else { if (chats.error) return; allChats = chats; }
    let hasNew = false;
    if (!unchanged) chats.forEach(c => {
        if (firstPoll) {
            lastChatText[c.id] = c.last_text;
        } else if (lastChatText[c.id] !== undefined && lastChatText[c.id] !== c.last_text) {
            const self = ['شما', 'پنل', 'شما (من)', 'شما (ربات)', 'ربات', 'دستیار', 'دستیار (AI)'].includes(c.last_sender);
            if (!self && (c.id !== curChatId || document.hidden)) {
                unreadPer[c.id] = (unreadPer[c.id] || 0) + 1;
                if (!c.muted) hasNew = true;
            }
            lastChatText[c.id] = c.last_text;
        } else {
            lastChatText[c.id] = c.last_text;
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
            if (c?.ai_pending) { sub.textContent = 'در حال آماده‌سازی پاسخ...'; sub.className = 'chat-info-subtitle pend'; }
            else { sub.textContent = 'شناسه: ' + curChatId; sub.className = 'chat-info-subtitle'; }
        }
    }
}

function filterChats() { renderChatList(allChats); }

async function togglePin(id, v) {
    await apiFetch('/api/pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId: id, pinned: v }) });
    lastChatsHash = ''; fetchChats(false);
}
async function toggleMute(id, v) {
    await apiFetch('/api/mute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId: id, muted: v }) });
    lastChatsHash = ''; fetchChats(false);
}
function togglePinCurrent() { if (!curChatId) return; const c = allChats.find(x => x.id === curChatId); togglePin(curChatId, !(c && c.pinned)); }
function toggleMuteCurrent() { if (!curChatId) return; const c = allChats.find(x => x.id === curChatId); toggleMute(curChatId, !(c && c.muted)); }

// Profile-modal versions: update the button's icon/label IMMEDIATELY
// (optimistic) instead of waiting for the next poll — previously you had
// to close and reopen the modal to see the new pin/mute state.
async function profileTogglePin() {
    if (!curChatId) return;
    const c = allChats.find(x => x.id === curChatId);
    const next = !(c && c.pinned);
    const btn = document.getElementById('paPin');
    btn.querySelector('i').className = 'bi ' + (next ? 'bi-pin-angle-fill' : 'bi-pin-angle');
    btn.querySelector('span').textContent = next ? 'لغو پین' : 'پین گفتگو';
    if (c) c.pinned = next; // keep local cache in sync until the next poll confirms it
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

// li.chatlist-chat > .dialog-avatar + .dialog-subtitle-container(.row-title/.row-subtitle)
// — real tweb class names, confirmed against _chatlist.scss.
// Counts CHATS with at least one unread message (not total unread
// messages) in each view, e.g. one user sent 10 unread messages and
// another sent 20 → the badge shows "2" (two chats), not "30".
function updateViewBadges(chats) {
    const botChats = chats.filter(c => !c.business_connection_id || c.has_bot_chat);
    const bizChats = chats.filter(c => c.business_connection_id);
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

    // view filter: "biz" shows chats with a business connection; "bot" shows
    // everything EXCEPT business-only chats (a chat with both a business
    // connection AND a proven direct bot chat legitimately shows in both).
    if (activeView === 'biz') base = base.filter(c => c.business_connection_id);
    else base = base.filter(c => !c.business_connection_id || c.has_bot_chat);

    document.getElementById('cntAll').textContent = base.length;
    document.getElementById('cntUnread').textContent = base.filter(c => (unreadPer[c.id] || 0) > 0).length;
    document.getElementById('cntPinned').textContent = base.filter(c => c.pinned).length;
    document.getElementById('cntGroups').textContent = base.filter(c => c.is_group).length;

    let list = base;
    if (activeTab === 'unread') list = list.filter(c => (unreadPer[c.id] || 0) > 0);
    if (activeTab === 'pinned') list = list.filter(c => c.pinned);
    if (activeTab === 'groups') list = list.filter(c => c.is_group);
    list = [...list].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

    cont.innerHTML = '';
    list.forEach(c => {
        const li = document.createElement('li');
        li.className = 'chatlist-chat' + (curChatId === c.id ? ' active' : '');
        li.onclick = () => selChat(c.id, c.title, c.business_connection_id);

        const av = document.createElement('div');
        av.className = 'dialog-avatar';
        av.style.background = avGrad(c.id);
        const img = document.createElement('img');
        img.src = `/api/user-photo?id=${encodeURIComponent(c.id)}&auth=${encodeURIComponent(PASS)}`;
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
        if (c.business_connection_id) {
            const bi = document.createElement('i');
            bi.className = 'bi bi-briefcase-fill';
            bi.title = 'اتصال بیزینسی';
            bi.style.cssText = 'color:var(--md-sys-color-tertiary);font-size:.9rem';
            title.appendChild(bi);
        }
        if (c.is_group) {
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
        if (c.ai_pending) {
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
        time.textContent = c.time || '';
        meta.appendChild(time);

        row.appendChild(title);
        row.appendChild(meta);

        const sub = document.createElement('div');
        sub.className = 'row-subtitle';
        const subText = document.createElement('span');
        subText.className = 'dialog-subtitle-inner';
        subText.textContent = (c.last_sender ? c.last_sender + ': ' : '') + (c.last_text || '');
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
