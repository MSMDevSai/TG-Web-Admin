function murl(fid) { return `/api/media?file_id=${encodeURIComponent(fid)}&auth=${encodeURIComponent(PASS)}`; }

function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
}

// A custom, glass-styled player shared by voice messages and videos —
// replaces the native <audio controls>/<video controls> widgets, which
// render as a plain OS-themed bar that clashes with the rest of the UI.
function mkPlayer(fileId, kind) {
    const el = document.createElement(kind === 'video' ? 'video' : 'audio');
    el.src = murl(fileId);
    el.preload = 'none';   // don't hit the network for every voice/video row just to learn its length
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
    dl.onclick = e => { e.stopPropagation(); downloadFile(fileId, kind + (kind === 'video' ? '.mp4' : '.ogg')); };

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
        // video: the <video> itself (no native controls) sits above a
        // custom control strip; a big center play icon shows while paused.
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

// Stickers can be static WEBP/PNG, animated TGS (gzip-compressed Lottie
// JSON), or video WEBM — and a plain <img src> with an onerror fallback
// turned out not to reliably detect "this isn't a static image" for all
// of those. This fetches the raw bytes up front and sniffs the actual
// file signature instead, so which renderer to use is a direct decision,
// not something inferred from whether/when <img> happens to fail.
async function renderSticker(container, fileId, fallbackEmoji) {
    container.innerHTML = '<div class="sticker-fallback"><div class="spinner-border spinner-border-sm" style="color:var(--md-sys-color-primary)"></div></div>';
    try {
        const res = await fetch(murl(fileId));
        if (!res.ok) throw new Error('fetch failed: ' + res.status);
        const buf = await res.arrayBuffer();
        const b = new Uint8Array(buf);
        container.innerHTML = '';

        if (b[0] === 0x1f && b[1] === 0x8b) { // gzip → .tgs (Lottie JSON)
            if (typeof pako === 'undefined' || typeof lottie === 'undefined') throw new Error('lottie libs not loaded');
            const animationData = JSON.parse(pako.inflate(b, { to: 'string' }));
            lottie.loadAnimation({ container, renderer: 'svg', loop: true, autoplay: true, animationData });
            return;
        }
        const isWebp = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46; // "RIFF"
        const isPng = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47; // \x89PNG
        if (isWebp || isPng) {
            const img = document.createElement('img');
            img.src = URL.createObjectURL(new Blob([b], { type: isWebp ? 'image/webp' : 'image/png' }));
            container.appendChild(img);
            return;
        }
        if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) { // EBML → .webm video sticker
            const v = document.createElement('video');
            v.src = URL.createObjectURL(new Blob([b], { type: 'video/webm' }));
            v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true;
            container.appendChild(v);
            return;
        }
        throw new Error('unrecognized sticker format');
    } catch (e) {
        container.innerHTML = '<div class="sticker-fallback"><span class="emo">' + (fallbackEmoji || '🎭') + '</span><span class="lbl">نمایش این استیکر پشتیبانی نمی‌شود</span></div>';
    }
}

// Runs `fn` when `el` first comes within ~200px of the viewport (immediately
// if IntersectionObserver is missing). Stickers/GIFs below the fold cost nothing.
const _lazyIO = ('IntersectionObserver' in window) ? new IntersectionObserver(entries => {
    entries.forEach(en => {
        if (!en.isIntersecting) return;
        _lazyIO.unobserve(en.target);
        const fn = en.target._lazy; en.target._lazy = null; if (fn) fn();
    });
}, { rootMargin: '200px' }) : null;
function lazyRender(el, fn) { if (!_lazyIO) { fn(); return; } el._lazy = fn; _lazyIO.observe(el); }

function mkMedia(m) {
    if (!m.type || !m.file_id) return null;
    const w = document.createElement('div');
    if (m.type === 'photo') {
        w.className = 'msg-media';
        const i = document.createElement('img');
        i.loading = 'lazy'; i.decoding = 'async';
        i.src = murl(m.file_id);
        i.onclick = () => viewMedia(m.file_id, 'photo');
        const dlBtn = document.createElement('button'); dlBtn.type = 'button'; dlBtn.className = 'media-dl-overlay';
        dlBtn.innerHTML = '<i class="bi bi-download"></i>';
        dlBtn.onclick = e => { e.stopPropagation(); downloadFile(m.file_id, 'photo.jpg'); };
        w.append(i, dlBtn);
    } else if (m.type === 'video') {
        w.appendChild(mkPlayer(m.file_id, 'video'));
    } else if (m.type === 'voice') {
        w.appendChild(mkPlayer(m.file_id, 'voice'));
    } else if (m.type === 'animation') {
        // Telegram GIFs are actually silent looping MP4s under the Bot API —
        // <video> with autoplay/loop/muted reproduces a real GIF exactly.
        w.className = 'msg-media';
        const v = document.createElement('video');
        v.preload = 'none';
        v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true;
        w.appendChild(v);
        lazyRender(w, () => { v.src = murl(m.file_id); });
    } else if (m.type === 'sticker') {
        w.className = 'msg-sticker';
        lazyRender(w, () => renderSticker(w, m.file_id, m.text));   // fetch + Lottie only once it is on (or near) screen
    } else if (m.type === 'document') {
        w.className = 'msg-doc';
        const a = document.createElement('a');
        a.href = '#'; a.className = 'text-white text-decoration-none';
        a.innerHTML = '<i class="bi bi-file-earmark-arrow-down"></i> دانلود فایل';
        a.onclick = e => { e.preventDefault(); downloadFile(m.file_id, m.text || 'file'); };
        w.appendChild(a);
    } else return null;
    return w;
}

// Fetches the file as a blob and triggers a same-page download via a
// temporary object URL — replaces the old <a href=... target="_blank">,
// which on an installed PWA navigates the whole app shell to the raw file
// URL; pressing back afterward then exits the app entirely instead of
// returning to the chat.
async function downloadFile(fileId, filename) {
    try {
        const res = await fetch(murl(fileId));
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename || 'file';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {
        showToast('دانلود فایل با خطا مواجه شد.', 'error');
    }
}

// Same reasoning for photos: window.open(..., '_blank') also kicks the
// PWA out to the system browser. A lightweight in-app lightbox avoids any
// navigation at all.
function viewMedia(fileId, type) {
    const img = document.getElementById('mvImg');
    const vid = document.getElementById('mvVideo');
    if (type === 'video') {
        img.classList.add('d-none'); vid.classList.remove('d-none');
        vid.src = murl(fileId);
    } else {
        vid.classList.add('d-none'); img.classList.remove('d-none');
        img.src = murl(fileId);
    }
    pushUiState({ level: 'overlay', chatId: curChatId || null });
    new bootstrap.Modal(document.getElementById('mediaViewerModal')).show();
    document.getElementById('mediaViewerModal').addEventListener('hidden.bs.modal', () => {
        vid.pause(); vid.src = ''; img.src = '';
    }, { once: true });
}

// ---- reactions ----
// Most-used reactions bubble toward the front of both the quick row and
// the full grid — tracked locally (localStorage), independent of QUICK_REACT
// /ALL_REACT's original static order.
const REACT_FREQ_KEY = 'tg_reaction_freq';
function getReactFreq() {
    try { return JSON.parse(localStorage.getItem(REACT_FREQ_KEY) || '{}'); } catch (e) { return {}; }
}
function bumpReactFreq(em) {
    if (!em) return;
    const f = getReactFreq();
    f[em] = (f[em] || 0) + 1;
    localStorage.setItem(REACT_FREQ_KEY, JSON.stringify(f));
}
function sortByFreq(list) {
    const f = getReactFreq();
    return [...list].sort((a, b) => (f[b] || 0) - (f[a] || 0));
}

async function doReact(chatId, msgId, emoji) {
    const res = await apiFetch('/api/react', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId, msgId, emoji }) });
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
        if (c.mine) { chip.title = 'برای حذف کلیک کن'; chip.onclick = () => doReact(curChatId, m.msg_id, null); }
        row.appendChild(chip);
    });
    return row;
}

function setReply(msgId, prev) {
    replyTarget = { msgId, prev };
    document.getElementById('rstripTxt').textContent = prev;
    document.getElementById('rstrip').classList.add('show');
    document.getElementById('msgIn').focus();
}
function cancelReply() { replyTarget = null; document.getElementById('rstrip').classList.remove('show'); }

// ---- topbar + chat selection ----
async function selChat(id, title, biz) {
    curChatId = id; unreadCnt = 0; lastHistHash = ''; cancelReply(); unreadPer[id] = 0; updGlobalUnread();
    if (window.innerWidth <= 768) document.getElementById('sidebar').classList.add('mh');
    document.getElementById('noChat').classList.add('d-none');
    document.getElementById('chatBox').classList.remove('d-none');
    document.getElementById('chatBox').classList.add('d-flex');
    document.getElementById('hdrTitle').innerText = title || id;

    const av = document.getElementById('hdrAv');
    av.innerHTML = ''; av.style.background = avGrad(id);
    const img = document.createElement('img');
    img.src = `/api/user-photo?id=${encodeURIComponent(id)}&auth=${encodeURIComponent(PASS)}`;
    img.onerror = () => { av.textContent = title ? title[0].toUpperCase() : '?'; };
    av.appendChild(img);
    document.getElementById('hdrSub').textContent = 'شناسه: ' + id;

    // resolve real capabilities from the chat-list item (falls back to the
    // `biz` argument for a chat just started this session, not yet polled)
    pushUiState({ level: 'chat', chatId: id });

    const chatObj = allChats.find(x => x.id === id) || {};
    isGroup = chatObj.is_group || false;
    curBizId = chatObj.business_connection_id || biz || null;
    const hasBiz = !!curBizId;
    const hasBotDirect = chatObj.has_bot_chat !== undefined ? !!chatObj.has_bot_chat : !hasBiz;

    // show/hide the shield icon that opens the group-info modal (Phase 5:
    // the old separate topbar toolbar is gone — showProfileModal() now
    // renders group info + management when isGroup is true)
    document.getElementById('gmodToggleBtn').style.display = isGroup ? 'flex' : 'none';
    gmodChatId = isGroup ? id : null;

    // sender selector: only offer a real choice when BOTH "بات" and "من" are
    // actually usable for this chat; otherwise pick the one valid mode
    // silently so a message can never be sent through a channel that has
    // no real conversation behind it (that mismatch is what used to throw
    // Telegram's "can't initiate conversation with a user" error).
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
//  Unified back-stack: chat list → chat → profile modal → AI panel
//  (and the context menu, parallel to profile/AI, opened from the chat).
//  One history entry per level, so the device/OS back button, a laptop's
//  mouse back button, and every screen's own back control all go through
//  the SAME popstate path and agree on what "back" means — previously
//  each screen (chat, profile, AI panel) handled "back" independently, so
//  e.g. closing the AI panel never actually returned to the profile modal
//  like it was supposed to.
// ══════════════════════════════════════════════════════════════
var isApplyingHistoryState = false;

function pushUiState(state) {
    if (isApplyingHistoryState) return;
    if (history.state && history.state.level === state.level && history.state.chatId === state.chatId) return;
    history.pushState(state, '', '#' + state.level);
}

// DOM-only — no history side effects — so it's safe to call both when
// replaying a popstate and as a plain helper elsewhere.
function backList() {
    document.getElementById('sidebar').classList.remove('mh');
    document.getElementById('chatBox').classList.add('d-none');
    document.getElementById('chatBox').classList.remove('d-flex');
    document.getElementById('noChat').classList.remove('d-none');
    curChatId = null;
}

// Makes the DOM match a given history state exactly: closes every overlay
// first, then reopens whatever that state calls for. Used both when the
// user actually navigates back/forward AND internally whenever a screen
// needs to "go back" itself (it just calls history.back() and lets this
// function do the actual work when popstate fires).
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
        // chat view DOM is already correct — we never tear it down for
        // shallower overlays, only for leaving the chat entirely.
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

// Every screen's own back control (arrow icon, X, Escape, backdrop click)
// routes through here instead of closing itself directly — that keeps the
// browser history in sync with whatever's actually on screen so a later
// real back-button press doesn't replay a stale state.
function goBackOneLevel() {
    if (history.state && history.state.level) history.back();
    else backList();
}
function handleBackButton() { goBackOneLevel(); }

window.addEventListener('popstate', e => applyUiState(e.state));

// Bootstrap modals can be dismissed in ways that don't call our own
// functions (Escape key, clicking the backdrop) — 'hidden.bs.modal' fires
// regardless of how it closed, so hook history syncing there once per
// modal instead of duplicating it on every close path.
function wireModalBackStack(modalId, level) {
    document.getElementById(modalId).addEventListener('hidden.bs.modal', () => {
        if (!isApplyingHistoryState && history.state && history.state.level === level) history.back();
    });
}

// Groups history by real calendar day using the message's `ts` (epoch ms,
// added server-side). Previously this was a single hardcoded "امروز"
// label regardless of the actual date — every day looked like today.
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

// A message "belongs to the same visual group" as its neighbour when it's
// the same role+sender, and neither one is a reply/forward (those always
// start a fresh bubble in the real client too).
function sameGroup(a, b) {
    return !!a && !!b && a.role === b.role && a.sender === b.sender && !b.reply_to_preview && !b.forwarded_from;
}

// ══════════════════════════════════════════════════════════════
//  History is now paginated (PAGE_SIZE at a time) instead of fetching
//  and fully re-rendering the ENTIRE chat on every single poll. On a
//  long chat that full rebuild was slow enough to look like the panel
//  "stopped loading", and re-running scrollBot() over thousands of
//  freshly-built DOM nodes is exactly what produced the "scrolling in
//  from way above" jump — there was never a real animation, just the
//  browser catching up on a huge layout each time.
// ══════════════════════════════════════════════════════════════
const PAGE_SIZE = 100;
var loadedMsgs = [];      // oldest→newest, currently rendered for curChatId
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
    // Color is no longer split by sender_mode ("me" vs "bot") within a
    // panel-sent message — ANY message sent from the panel (role=admin,
    // whichever identity it went out as) is the panel's own voice, so it's
    // always green, labeled "(پنل)". Blue is reserved for role=owner only
    // — a message Telegram itself reports as coming directly from the
    // connected account holder, not something the panel sent.
    let bc = 'b-user';
    if (m.role === 'owner') bc = 'b-me';
    else if (m.role === 'admin' || m.role === 'bot_auto' || m.role === 'model') bc = 'b-bot';
    bub.className = 'bubble ' + bc;
    if (contPrev) bub.classList.add('cont-prev');
    // whether THIS bubble gets a tail depends on whether the NEXT one
    // continues its group — fixed up in fixGroupTail() after the full
    // list (or the newly appended tail) is known, since at render time
    // we don't always have the next message yet (e.g. appending one at
    // a time during polling).
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
        const rs = document.createElement('span'); rs.textContent = m.reply_to_preview;       // text, not HTML: the preview carries another person's words
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

    if (m.msg_id) {
        const bar = document.createElement('div'); bar.className = 'msg-bar';
        // The reaction picker is ~85 elements. Building it for every message
        // made 93 of each row's 100 DOM nodes (and, on non-Apple phones, ~80
        // emoji <img> per message) — so it is created on first click instead.
        const rbBtn = document.createElement('span'); rbBtn.className = 'tbb'; rbBtn.innerHTML = '<i class="bi bi-emoji-smile"></i>';
        let rb = null;
        rbBtn.onclick = e => {
            e.stopPropagation();
            if (!rb) { const made = mkReactBar(curChatId, m.msg_id, m.my_reaction); rb = made.bar; bar.appendChild(made.wrap); }
            document.querySelectorAll('.react-bar.show').forEach(x => { if (x !== rb) x.classList.remove('show'); });
            rb.classList.toggle('show');
        };
        bar.appendChild(rbBtn);

        const replyBtn = document.createElement('span'); replyBtn.className = 'tbb'; replyBtn.innerHTML = '<i class="bi bi-reply"></i>'; replyBtn.title = 'ریپلای';
        replyBtn.onclick = () => setReply(m.msg_id, (m.sender || '') + ': ' + (m.text || '[رسانه]'));
        bar.appendChild(replyBtn);

        if (m.role === 'admin' || m.role === 'owner' || m.role === 'bot_auto' || m.role === 'model') {
            const eb = document.createElement('span'); eb.className = 'tbb'; eb.innerHTML = '<i class="bi bi-pencil"></i>'; eb.title = 'ویرایش';
            eb.onclick = () => editMsg(m.id, m.msg_id || '', m.text);
            bar.appendChild(eb);
        }
        row.appendChild(bar);
    }

    frag.appendChild(row);
    return frag;
}

// A bubble only gets a tail if the NEXT message doesn't continue its
// group — walk the currently-loaded list once and fix up the two
// bubbles around any seam (used after appending/prepending, where a
// row was built without knowing its new neighbour yet).
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
        f.querySelectorAll('.msg-row').forEach(r => r.classList.add('msg-enter'));   // live arrivals animate; the first render stays instant
        cont.appendChild(f); prev = m;
    }
    if (prevLast) fixGroupTail(prevLast.id);
}

async function fetchHistory(chatId, silent) {
    if (!chatId) return;
    if (!silent) {
        loadedMsgs = []; oldestLoadedId = null; hasMoreOlder = true; lastHistHash = '';
        delete _etags[`/api/chat?id=${encodeURIComponent(chatId)}&limit=${PAGE_SIZE}`];
        const hist = await apiFetchCond(`/api/chat?id=${encodeURIComponent(chatId)}&limit=${PAGE_SIZE}`);
        if (!hist) return;
        loadedMsgs = hist;
        oldestLoadedId = hist.length ? hist[0].id : null;
        lastHistHash = JSON.stringify(hist);
        renderFullList(loadedMsgs);
        scrollBot(false);
        return;
    }

    // polling: fetch just the latest page and diff against what's rendered
    const hist = await apiFetchCond(`/api/chat?id=${encodeURIComponent(chatId)}&limit=${PAGE_SIZE}`);
    if (!hist || hist.notModified) return;     // 304: nothing changed
    if (hist.error) return;
    const hs = JSON.stringify(hist);
    if (hs === lastHistHash) return;
    lastHistHash = hs;
    const wasBot = atBot();

    const oldIds = loadedMsgs.map(m => m.id);
    const newIds = hist.map(m => m.id);
    const sameLength = oldIds.length === newIds.length;
    let commonPrefix = 0;
    while (commonPrefix < oldIds.length && commonPrefix < newIds.length && oldIds[commonPrefix] === newIds[commonPrefix]) commonPrefix++;

    if (commonPrefix === oldIds.length && newIds.length > oldIds.length) {
        // the common case: nothing changed, just new messages at the end —
        // append only those instead of rebuilding the whole list.
        const added = hist.slice(commonPrefix);
        loadedMsgs = hist;
        appendRows(added);
        if (wasBot) scrollBot(true);
        else { unreadCnt += added.length; updUBadge(); document.getElementById('scrollBtn').classList.remove('d-none'); }
        return;
    }
    if (sameLength && commonPrefix === oldIds.length) return; // identical, nothing to do

    // anything else (edit, reaction, deletion, pagination overlap) — fall
    // back to a full rebuild of just this latest page, not the whole
    // multi-thousand-message history.
    loadedMsgs = hist;
    oldestLoadedId = hist.length ? hist[0].id : oldestLoadedId;
    renderFullList(loadedMsgs);
    if (!wasBot) {
        // can't know exactly how many are "new" after a reshuffle — just
        // surface the scroll-down affordance rather than guessing a count.
        document.getElementById('scrollBtn').classList.remove('d-none');
    } else {
        scrollBot(true);
    }
}

async function loadOlderMessages() {
    if (!hasMoreOlder || !oldestLoadedId || !curChatId) return;
    const btn = document.getElementById('loadOlderBtn');
    if (btn) btn.textContent = 'در حال بارگذاری...';
    const older = await apiFetch(`/api/chat?id=${encodeURIComponent(curChatId)}&limit=${PAGE_SIZE}&before_id=${encodeURIComponent(oldestLoadedId)}`);
    if (!older || !older.length) {
        hasMoreOlder = false;
        if (btn) btn.remove();
        return;
    }
    const cont = document.getElementById('msgs');
    const anchor = cont.firstElementChild;
    const prevScrollHeight = cont.scrollHeight, prevScrollTop = cont.scrollTop;

    loadedMsgs = older.concat(loadedMsgs);
    oldestLoadedId = older[0].id;
    lastDateKeyRendered = null;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < older.length; i++) frag.appendChild(buildMsgRow(older[i], older[i - 1]));
    applyEmojiImages(frag);
    if (anchor) cont.insertBefore(frag, anchor); else cont.appendChild(frag);
    fixGroupTail(older[older.length - 1].id);
    // keep the viewport pinned to what the user was looking at — prepending
    // content above the fold would otherwise yank the scroll position.
    cont.scrollTop = prevScrollTop + (cont.scrollHeight - prevScrollHeight);
    if (btn) btn.textContent = 'بارگذاری پیام‌های قدیمی‌تر';
    if (older.length < PAGE_SIZE) { hasMoreOlder = false; if (btn) btn.remove(); }
}

// ══════════════════════════════════════════════════════════════
//  Phase 4 — message context menu (right-click / long-press)
//  and swipe-to-reply.
// ══════════════════════════════════════════════════════════════

let _gesturesReady = false;
// Click on a reply preview → scroll to the message it quotes and flash it. If that message is older than
// what's loaded, keep paging back until it turns up (or history runs out).
let _jumping = false;
async function jumpToReplied(m) {
    if (_jumping) return;
    _jumping = true;
    try {
        // Server preview format is "<telegram first name>: <text or caption or [رسانه]>" cut to 120 chars, so a
        // text fallback (only for old rows saved without reply_to_msg_id) compares just the part after the first
        // colon, as a prefix, and only against messages written BEFORE the reply — nearest one wins.
        const ptxt = (m.reply_to_preview || '').replace(/^[^:]*:\s*/, '');
        const find = () => {
            if (m.reply_to_msg_id != null) {
                return loadedMsgs.find(x => x.msg_id != null && String(x.msg_id) === String(m.reply_to_msg_id)) || null;
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

// Right-click, long-press and swipe-to-reply — attached once to the list and
// resolved through event delegation (it used to be six listeners and an extra
// icon element on every single row).
function initMsgGestures() {
    if (_gesturesReady) return; _gesturesReady = true;
    const box = document.getElementById('msgs');
    const rowOf = t => (t && t.closest) ? t.closest('.msg-row') : null;
    const open = (row, x, y) => {
        const m = msgById(row.dataset.mid);
        if (m && m.msg_id) openMsgContextMenu(x, y, m, row.classList.contains('out'));
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
            if (m && m.msg_id) setReply(m.msg_id, (m.sender || '') + ': ' + (m.text || '[رسانه]'));
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
        s.onclick = () => { doReact(curChatId, m.msg_id, em === m.my_reaction ? null : em); closeMsgContextMenu(); };
        reactBox.appendChild(s);
    });
    applyEmojiImages(reactBox);

    const items = [];
    items.push({ icon: 'bi-reply', label: 'ریپلای', fn: () => setReply(m.msg_id, (m.sender || '') + ': ' + (m.text || '[رسانه]')) });
    if (m.role === 'admin' || m.role === 'owner' || m.role === 'bot_auto' || m.role === 'model') {
        items.push({ icon: 'bi-pencil', label: 'ویرایش', fn: () => editMsg(m.id, m.msg_id || '', m.text) });
    }
    if (m.text) items.push({ icon: 'bi-clipboard', label: 'کپی متن', fn: () => { navigator.clipboard?.writeText(m.text); } });
    if ((m.type === 'sticker' || m.type === 'animation') && m.file_id) {
        items.push({
            icon: 'bi-stickies', label: 'افزودن به پنل استیکر/گیف', fn: () => addToStickerPanel(m.file_id, m.type, m.text),
        });
    }
    items.push({ icon: 'bi-forward', label: 'فوروارد', fn: () => forwardMsg(m.msg_id) });
    if (curIsGroupForCtx()) items.push({ icon: 'bi-pin-angle', label: 'پین پیام', fn: () => pinMsgById(m.msg_id) });
    items.push({ icon: 'bi-trash3', label: 'حذف', danger: true, fn: () => deleteMsgById(m.msg_id) });

    itemsBox.innerHTML = '';
    items.forEach(it => {
        const d = document.createElement('div'); d.className = 'mcm-item' + (it.danger ? ' danger' : '');
        d.innerHTML = `<i class="bi ${it.icon}"></i><span>${it.label}</span>`;
        d.onclick = () => { it.fn(); closeMsgContextMenu(); };
        itemsBox.appendChild(d);
    });

    menu.classList.add('show');
    // keep on-screen
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

async function addToStickerPanel(fileId, type, emoji) {
    const res = await apiFetch('/api/add-recent-media', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId, type, emoji }),
    });
    if (res?.error) showToast(res.error, 'error');
    else showToast(type === 'sticker' ? 'استیکر به پنل اضافه شد' : 'GIF به پنل اضافه شد', 'success');
}

async function forwardMsg(msgId) {
    const to = prompt('آیدی عددی چت مقصد برای فوروارد:');
    if (!to) return;
    const res = await apiFetch('/api/forward', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromChatId: curChatId, toChatId: to, msgId, businessConnectionId: curBizId }),
    });
    if (res?.error) showToast(res.error, 'error'); else showToast('فوروارد شد', 'success');
}

async function pinMsgById(msgId) {
    const res = await apiFetch('/api/pin-message', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: curChatId, msgId, businessConnectionId: curBizId }),
    });
    if (res?.error) showToast(res.error, 'error'); else fetchHistory(curChatId, false);
}

async function deleteMsgById(msgId) {
    if (!confirm('این پیام حذف بشه؟')) return;
    const res = await apiFetch('/api/delete-message', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: curChatId, msgId }),
    });
    if (res?.error) showToast(res.error, 'error'); else fetchHistory(curChatId, false);
}

// wire the unified back-stack onto the two modals that participate in it
// (profile ⇄ AI panel); done here, synchronously, since this script tag
// loads after their HTML is already in the DOM.
wireModalBackStack('profileModal', 'profile');
wireModalBackStack('chatSP', 'ai');
wireModalBackStack('newChatModal', 'overlay');
wireModalBackStack('gmodModal', 'overlay');
wireModalBackStack('mediaViewerModal', 'overlay');
