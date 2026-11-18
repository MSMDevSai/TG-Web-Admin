// Shared mutable state. Every static/js/*.js file (and the remaining inline
// script in index.html) reads/writes these as plain globals.
var S = {
  me: null,            // { id, role, name, notify }
  settings: null,      // panel settings (from boot endpoint)
  view: 'list',
  chats: [],
  cats: [],
  tab: 'all',
  q: '',
  chat: null,
  msgs: new Map(),
  hasMoreOlder: false,
  hasMoreNewer: false,
  filter: '',
  mode: localStorage.getItem('mode') || 'bot',
  reply: null,
  poll: null,
  sig: '',
  rec: null,
  sel: null,
  around: false,
  loading: false,
  pinned: null,
  searchOpen: false,
};

var curChatId = null, curBizId = null, allChats = [], pollerID = null, pollMs = 3000;
var lastHistHash = "", unreadCnt = 0, unreadPer = {}, lastChatText = {}, firstPoll = true, lastChatsHash = "";
var replyTarget = null, activeTab = "all", activeView = "bot";
var mrec = null, rchunks = [], recInt = null, recSec = 0;
var isGroup = false;
var gmodOpen = false;
var emojiOpen = false;
var gmodChatId = null;
var curEmojiCat = 0;

// M3 snackbar — replaces every alert()
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

function toastResult(res, successMsg) {
  if (res && (res.ok || res.success)) showToast(successMsg, 'success');
  else showToast((res && (res.error || res.message)) || 'خطا', 'error');
}

// `call` rejects on EndpointError/transport failures. For user actions we want a
// toast instead of an unhandled rejection, plus the {error} shape the call sites
// already test for.
async function safeCall(name, input) {
  try { return await call(name, input); }
  catch (e) {
    const msg = (e && (e.message || e.error)) || 'خطا';
    showToast(msg, 'error');
    return { error: msg };
  }
}
