// Shared mutable state. Every static/js/*.js file (and the remaining inline
// script in index.html) reads/writes these as plain globals — this file is
// the single place they're declared, so later phases just add to it instead
// of each file guessing its own copy.
var PASS = localStorage.getItem("TG_PASS") || "";
var curChatId = null, curBizId = null, allChats = [], pollerID = null, pollMs = 3000;
var lastHistHash = "", unreadCnt = 0, unreadPer = {}, lastChatText = {}, firstPoll = true, lastChatsHash = "";
var replyTarget = null, activeTab = "all", activeView = "bot";
var mrec = null, rchunks = [], recInt = null, recSec = 0;
var isGroup = false;
var gmodOpen = false;
var emojiOpen = false;
var gmodChatId = null;
var curEmojiCat = 0;

// Apple devices already render their own (good) native emoji — the ask was
// specifically "Telegram/iPhone style, not some other ugly pack", so on
// Apple platforms we leave native rendering alone entirely and only swap
// in Twemoji images on platforms whose native emoji font looks worse
// (Windows, and especially Samsung's own Android font, which was the
// original complaint).
var IS_APPLE_PLATFORM = /Mac|iPhone|iPod|iPad/.test(navigator.platform || navigator.userAgent || '');
function applyEmojiImages(el) {
    if (IS_APPLE_PLATFORM || !window.twemoji) return;
    twemoji.parse(el, { folder: 'svg', ext: '.svg', attributes: () => ({ loading: 'lazy', decoding: 'async' }) });
}

// M3 snackbar — replaces every alert() in the app. type is 'error', 'warn' or
// 'success'; auto-closes after 2s or on clicking the × button, whichever is first.
function showToast(msg, type, ms) {
    const host = document.getElementById('toastHost');
    if (!host) { console.log(msg); return; }
    const t = document.createElement('div');
    t.className = 'snackbar ' + (type || 'error');
    const span = document.createElement('span'); span.className = 'sb-msg'; span.textContent = msg;
    const close = document.createElement('button'); close.className = 'sb-close'; close.innerHTML = '<i class="bi bi-x-lg"></i>';
    t.append(span, close);
    host.appendChild(t);
    let done = false;
    const dismiss = () => {
        if (done) return; done = true;
        t.classList.remove('in'); t.classList.add('out');
        setTimeout(() => t.remove(), 160);
    };
    close.onclick = dismiss;
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(dismiss, ms || 2000);
}

// Shorthand for the extremely common "if (res.success) toast success else
// toast res.error" pattern that most API calls in this app follow.
function toastResult(res, successMsg) {
    if (res && res.success) showToast(successMsg, 'success');
    else showToast((res && res.error) || 'خطا', 'error');
}
