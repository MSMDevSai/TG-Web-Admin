function syncSendMic() {
  const has = document.getElementById('msgIn').value.trim().length > 0;
  document.getElementById('sendBtn').classList.toggle('d-none', !has);
  document.getElementById('micBtn').classList.toggle('d-none', has);
}

async function sendMsg() {
  const ta = document.getElementById('msgIn');
  const txt = ta.value.trim();
  if (!txt || !curChatId) return;
  ta.value = ''; syncSendMic();
  const selR = document.querySelector('input[name="sender"]:checked');
  const mode = (selR && selR.value === 'me') ? 'me' : 'bot';
  const body = { chatId: curChatId, text: txt, mode, businessConnectionId: curBizId };
  if (replyTarget) body.replyToMsgId = replyTarget.msgId;
  const res = await call('send', body);
  cancelReply();
  if (res?.error) showToast(res.error, 'error'); else { await fetchHistory(curChatId, false); scrollBot(true); }
}

function pickFile(acc, type) {
  document.getElementById('attMenu').classList.remove('show');
  const fi = document.getElementById('fileIn');
  fi.accept = acc === '*' ? '' : acc;
  fi.dataset.kind = type; fi.value = ''; fi.click();
}
async function onFilePick(e) {
  const f = e.target.files[0];
  if (!f || !curChatId) return;
  await uploadMedia(f, e.target.dataset.kind, f.name);
}

async function uploadMedia(file, type, name) {
  const reader = new FileReader();
  reader.onload = async function(e) {
    const dataUrl = e.target.result;
    const b64 = dataUrl.split(',')[1];
    const bytes = b64ToU8(b64);
    const CHUNK = 384 * 1024; // 384 KB
    const totalChunks = Math.ceil(bytes.length / CHUNK);
    const chunks = [];
    for (let i = 0; i < bytes.length; i += CHUNK) {
      chunks.push(arrayBufferToB64(bytes.subarray(i, i + CHUNK)));
    }
    const uploadId = 'up_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const selR = document.querySelector('input[name="sender"]:checked');
    const mode = (selR && selR.value === 'me') ? 'me' : 'bot';
    const meta = {
      chatId: curChatId,
      kind: type,
      mode,
      filename: name,
      mime: file.type || 'application/octet-stream',
      caption: name,
      replyToMsgId: replyTarget ? replyTarget.msgId : undefined,
    };
    let lastRes = null;
    for (let i = 0; i < chunks.length; i++) {
      lastRes = await call('upload', {
        uploadId, part: i, parts: totalChunks, b64: chunks[i], meta,
      });
      if (i === chunks.length - 1) break; // last part already sent the message
    }
    cancelReply();
    if (lastRes?.error) showToast(lastRes.error, 'error');
    else { await fetchHistory(curChatId, false); scrollBot(true); }
  };
  reader.readAsDataURL(file);
}

function arrayBufferToB64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function b64ToU8(b) { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

function getSenderMode() {
  const selR = document.querySelector('input[name="sender"]:checked');
  return (selR && selR.value === 'me') ? 'me' : 'bot';
}

// ══════════════════════════════════════════════════════════════
//  Voice recording
// ══════════════════════════════════════════════════════════════
function recTimerText() {
  const mn = Math.floor(recSec / 60), sc = recSec % 60;
  return mn + ':' + String(sc).padStart(2, '0');
}

async function toggleRec() {
  if (mrec && mrec.state === 'recording') { stopRec(true); return; }
  if (!navigator.mediaDevices || !window.MediaRecorder) { showToast('مرورگر از ضبط صدا پشتیبانی نمی‌کند', 'warn'); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    rchunks = [];
    mrec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    mrec.ondataavailable = e => { if (e.data.size > 0) rchunks.push(e.data); };
    mrec.start();
    document.getElementById('inpRow').style.display = 'none';
    document.getElementById('voiceRecPanel').classList.add('show');
    recSec = 0;
    document.getElementById('voiceRecTimer').textContent = recTimerText();
    recInt = setInterval(() => { recSec++; document.getElementById('voiceRecTimer').textContent = recTimerText(); }, 1000);
  } catch (e) {
    showToast('دسترسی به میکروفون رد شد', 'warn');
  }
}
function cancelRec() { stopRec(false); }
function stopRec(send) {
  if (!mrec) return;
  const doSend = send;
  mrec.onstop = () => {
    clearInterval(recInt);
    document.getElementById('voiceRecPanel').classList.remove('show');
    document.getElementById('inpRow').style.display = 'flex';
    if (doSend && rchunks.length) {
      const blob = new Blob(rchunks, { type: 'audio/webm' });
      const reader = new FileReader();
      reader.onload = function(e) {
        const b64 = e.target.result.split(',')[1];
        const bytes = b64ToU8(b64);
        const CHUNK = 384 * 1024;
        const totalChunks = Math.ceil(bytes.length / CHUNK);
        const chunks = [];
        for (let i = 0; i < bytes.length; i += CHUNK) {
          chunks.push(arrayBufferToB64(bytes.subarray(i, i + CHUNK)));
        }
        const uploadId = 'voice_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        const selR = document.querySelector('input[name="sender"]:checked');
        const mode = (selR && selR.value === 'me') ? 'me' : 'bot';
        const meta = {
          chatId: curChatId,
          kind: 'voice',
          mode,
          filename: 'voice.webm',
          mime: 'audio/webm',
          caption: 'voice.webm',
          replyToMsgId: replyTarget ? replyTarget.msgId : undefined,
        };
        (async () => {
          let lastRes = null;
          for (let i = 0; i < chunks.length; i++) {
            lastRes = await call('upload', { uploadId, part: i, parts: totalChunks, b64: chunks[i], meta });
            if (i === chunks.length - 1) break;
          }
          cancelReply();
          if (lastRes?.error) showToast(lastRes.error, 'error');
          else { await fetchHistory(curChatId, false); scrollBot(true); }
        })();
      };
      reader.readAsDataURL(blob);
    }
    mrec = null;
  };
  mrec.stream.getTracks().forEach(t => t.stop());
  mrec.stop();
}

// ══════════════════════════════════════════════════════════════
//  Emoji picker
// ══════════════════════════════════════════════════════════════
const EMOJI_CATS = [
  { icon: "😊", name: "smileys", emojis: ["😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩","😘","😗","☺","😚","😙","🥲","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","🤐","🤨","😐","😑","😶","😏","😒","🙄","😬","🤥","😌","😔","😪","🤤","😴","😷","🤒","🤕","🤢","🤮","🤧","🥵","🥶","🥴","😵","💫","🤯","🤠","🥳","🥸","😎","🤓","🧐","😕","😟","🙁","☹","😮","😯","😲","😳","🥺","😦","😧","😨","😰","😥","😢","😭","😱","😖","😣","😞","😓","😩","😫","🥱","😤","😡","😠","🤬","😈","👿","💀","☠","💩","🤡","👹","👺","👻","👽","👾","🤖","🫨","😵‍💫","🫠","🫡"] },
  { icon: "👋", name: "hands", emojis: ["👋","🤚","🖐","✋","🖖","👌","🤌","🤏","✌","🤞","🤟","🤘","🤙","👈","👉","👆","🖕","👇","☝","👍","👎","✊","👊","🤛","🤜","👏","🙌","👐","🤲","🤝","🙏","✍","💅","🤳","💪","🦾","🦵","🦿","🦶","👂","🦻","👃","🫀","🫁","🧠","🦷","🦴","👀","👁","👅","👄","🫦"] },
  { icon: "🐶", name: "animals", emojis: ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐻‍❄️","🐨","🐯","🦁","🐮","🐷","🐽","🐸","🐵","🙈","🙉","🙊","🐒","🐔","🐧","🐦","🐤","🦆","🦅","🦉","🦇","🐺","🐗","🐴","🦄","🐝","🪱","🐛","🦋","🐌","🐞","🐜","🪲","🦟","🦗","🪳","🕷","🦂","🐢","🐍","🦎","🦖","🦕","🐙","🦑","🦐","🦞","🦀","🐡","🐠","🐟","🐬","🐳","🐋","🦈","🦭","🐊","🐅","🐆","🦓","🦍","🦧","🦣","🐘","🦛","🦏","🐪","🐫","🦒","🦘","🦬","🐃","🐂","🐄","🐎","🐖","🐏","🐑","🦙","🐐","🦌","🐕","🐩","🦮","🐕‍🦺","🐈","🐈‍⬛","🪶","🐓","🦃","🦤","🦚","🦜","🦢","🦩","🕊","🐇","🦝","🦨","🦡","🦫","🦦","🦥","🐁","🐀","🐿","🦔"] },
  { icon: "🍕", name: "food", emojis: ["🍏","🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍈","🍒","🍑","🥭","🍍","🥥","🥝","🍅","🍆","🥑","🥦","🥬","🥒","🌶","🫑","🧄","🧅","🥔","🌽","🥕","🫛","🧇","🥞","🧈","🍳","🥚","🧆","🥙","🧀","🍖","🍗","🥩","🥓","🌮","🌯","🫔","🧆","🥫","🍱","🍘","🍙","🍚","🍛","🍜","🍝","🍠","🍢","🍣","🍤","🍥","🥮","🍡","🥟","🥠","🥡","🦀","🦞","🦐","🦑","🦪","🍦","🍧","🍨","🍩","🍪","🎂","🍰","🧁","🥧","🍫","🍬","🍭","🍮","🍯","🍼","🥛","☕","🫖","🍵","🧃","🥤","🧋","🍶","🍺","🍻","🥂","🍷","🥃","🍸","🍹","🧉","🍾","🍴","🥄"] },
  { icon: "🎮", name: "activities", emojis: ["⚽","🏀","🏈","⚾","🥎","🎾","🏐","🏉","🥏","🎱","🪀","🏓","🏸","🏒","🏑","🥍","🏏","🪃","🥅","⛳","🪁","🏹","🎣","🤿","🥊","🥋","🎽","🛹","🛼","🛷","⛸","🥌","🎿","⛷","🏂","🪂","🏋","🤼","🤸","🤺","🏇","⛹","🤾","🏌","🏄","🚣","🧗","🚵","🚴","🏆","🥇","🥈","🥉","🏅","🎖","🏵","🎗","🎫","🎟","🎪","🤹","🎭","🩰","🎨","🎬","🎤","🎧","🎼","🎹","🥁","🪘","🎷","🎺","🎸","🪕","🎻","🎲","♟","🎯","🎳","🎮","🎰","🧩"] },
  { icon: "🚗", name: "travel", emojis: ["🚗","🚕","🚙","🚌","🚎","🏎","🚓","🚑","🚒","🚐","🛻","🚚","🚛","🚜","🏍","🛵","🛺","🚲","🛴","🛹","🚏","🛣","🛤","⛽","🚦","🚥","🚧","⚓","🛟","⛵","🚤","🛥","🛳","⛴","🚢","✈","🛩","🛫","🛬","🪂","💺","🚁","🚟","🚠","🚡","🛰","🚀","🛸","🪐","💫","⭐","🌟","✨","⚡","☄","🌈","☀","🌤","⛅","🌦","🌧","⛈","🌩","🌨","❄","☃","⛄","🌬","💨","💧","💦","☔","☂","🌊","🌫"] },
  { icon: "💡", name: "objects", emojis: ["⌚","📱","📲","💻","⌨","🖥","🖨","🖱","🖲","🕹","🗜","💽","💾","💿","📀","📼","📷","📸","📹","🎥","📽","🎞","📞","☎","📟","📠","📺","📻","🧭","⏱","⏲","⏰","🕰","⌛","⏳","📡","🔋","🔌","💡","🔦","🕯","🪔","🧯","🛢","💰","💵","💴","💶","💷","💸","💳","🪙","💎","⚖","🪜","🧰","🪛","🔧","🔨","⚒","🛠","⛏","🪚","🔩","🪤","🧲","🔮","🪄","💈","🛒","🎁","🎀","🪅","🎊","🎉","🎎","🎏","🎐","🎑","🎃","🎄","🎆","🎇","🧧","🎈","🎋","🧨","✉","📩","📨","📧","📥","📤","📦","🏷","📪","📫","📬","📭","📮","📯","📜","📃","📄","📑","🧾","📊","📈","📉","🗒","🗓","📆","📅","🗑","📁","📂","🗂","🗃","🗄","🗑"] },
  { icon: "#️⃣", name: "symbols", emojis: ["❤","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣","💕","💞","💓","💗","💖","💘","💝","💟","☮","✝","☪","🕉","☸","✡","🔯","🕎","☯","☦","🛐","⛎","♈","♉","♊","♋","♌","♍","♎","♏","♐","♑","♒","♓","🆔","⚛","🉑","☢","☣","📴","📳","🈶","🈚","🈸","🈺","🈷","✴","🆚","💮","🉐","㊙","㊗","🈴","🈵","🈹","🈲","🅰","🅱","🆎","🆑","🅾","🆘","❌","⭕","🛑","⛔","📛","🚫","💯","💢","♨","🚷","🚯","🚳","🚱","🔞","📵","🚭","❗","❕","❓","❔","‼","⁉","🔅","🔆","〽","⚠","🚸","🔱","⚜","🔰","♻","✅","🈯","💹","❎","🌐","💠","Ⓜ","🌀","💤","🏧","🚾","♿","🅿","🛗","🈳","🈹","🈵","🉐","🈴","🉑","🈶","🈚","🎦","📶","🈸","🏬","🔀","🔁","🔂","▶","⏩","⏭","⏯","◀","⏪","⏮","🔼","⏫","🔽","⏬","⏸","⏹","⏺","⏏","🎵","🎶","➕","➖","➗","✖","♾","💲","💱","™","©","®","〰","➰","➿","🔚","🔙","🔛","🔝","🔜","✔","☑","🔲","🔳","⬛","⬜","◼","◻","◾","◽","▪","▫","🔶","🔷","🔸","🔹","🔺","🔻","💠","🔘","🔵","🟤","⚫","🟣","🟢","🟡","🟠","🔴"] }
];

const EMOJI_FREQ_KEY = 'tg_emoji_freq';
function getEmojiFreq() { try { return JSON.parse(localStorage.getItem(EMOJI_FREQ_KEY) || '{}'); } catch (e) { return {}; } }
function bumpEmojiFreq(em) { const f = getEmojiFreq(); f[em] = (f[em] || 0) + 1; localStorage.setItem(EMOJI_FREQ_KEY, JSON.stringify(f)); }
function recentEmojiList() { const f = getEmojiFreq(); return Object.keys(f).sort((a, b) => f[b] - f[a]).slice(0, 40); }

function buildEmojiPicker() {
  const cats = document.getElementById('emojiCats');
  cats.innerHTML = '';
  const recent = recentEmojiList();
  const allCats = recent.length ? [{ icon: '🕐', name: 'recent', emojis: recent }, ...EMOJI_CATS] : EMOJI_CATS;
  allCats.forEach((c, i) => {
    const span = document.createElement('span');
    span.className = 'ec' + (i === 0 ? ' active' : '');
    span.textContent = c.icon;
    span.onclick = () => switchEmojiCat(i, allCats);
    cats.appendChild(span);
  });
  applyEmojiImages(cats);
  renderEmojiCat(0, allCats);
}
function switchEmojiCat(i, cats) {
  curEmojiCat = i;
  document.querySelectorAll('.ec').forEach((e, j) => e.classList.toggle('active', j === i));
  renderEmojiCat(i, cats || [{ emojis: recentEmojiList() }, ...EMOJI_CATS]);
}
function renderEmojiCat(i, cats) {
  const list = (cats || EMOJI_CATS)[i];
  const grid = document.getElementById('emojiGrid');
  grid.innerHTML = '';
  (list.emojis || []).forEach(em => {
    const s = document.createElement('span');
    s.textContent = em;
    s.onclick = () => {
      bumpEmojiFreq(em);
      const ta = document.getElementById('msgIn');
      ta.value += em; ta.dispatchEvent(new Event('input'));
    };
    grid.appendChild(s);
  });
  applyEmojiImages(grid);
}
function toggleEmojiPicker() {
  emojiOpen = !emojiOpen;
  if (emojiOpen) buildEmojiPicker();
  document.getElementById('emojiPicker').classList.toggle('show', emojiOpen);
  if (emojiOpen) { document.getElementById('stickerPicker').classList.remove('show'); stickerOpen = false; }
}

// ═══════════════════════════════════════════════════════════════
//  Sticker / GIF panel
// ═══════════════════════════════════════════════════════════════
var stickerOpen = false;
var stickerTab = 'sticker';

function toggleStickerPicker() {
  stickerOpen = !stickerOpen;
  document.getElementById('stickerPicker').classList.toggle('show', stickerOpen);
  if (stickerOpen) {
    document.getElementById('emojiPicker').classList.remove('show'); emojiOpen = false;
    loadStickerPanel();
  }
}
function switchStickerTab(tab) {
  stickerTab = tab;
  document.querySelectorAll('.sk-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  loadStickerPanel();
}

async function loadStickerPanel() {
  const grid = document.getElementById('stickerGrid');
  grid.innerHTML = '<div class="sk-empty">در حال بارگذاری...</div>';
  const items = [];

  if (stickerTab === 'sticker') {
    const recent = await call('media', { type: 'sticker' });
    (recent || []).forEach(s => items.push({ mediaKey: s.mediaKey, emoji: s.emoji || '🎭', kind: 'sticker' }));
  } else {
    const recent = await call('media', { type: 'animation' });
    (recent || []).forEach(g => items.push({ mediaKey: g.mediaKey, kind: 'animation' }));
  }

  grid.innerHTML = '';
  if (!items.length) {
    grid.innerHTML = '<div class="sk-empty">' + (stickerTab === 'sticker'
      ? 'موردی نیست — یا یه استیکر از منوی پیوست بفرست تا اینجا ذخیره بشه.'
      : 'موردی نیست — یه GIF از منوی پیوست بفرست تا اینجا ذخیره بشه.') + '</div>';
    return;
  }
  items.forEach(it => {
    const tile = document.createElement('div'); tile.className = 'sk-tile';
    if (it.kind === 'sticker') {
      loadMedia(it.mediaKey).then(r => {
        const mime = r.mime || '';
        tile.innerHTML = mime === 'image/webp'
          ? '<img src="' + r.url + '" class="m stk">'
          : '<video class="m stk" src="' + r.url + '" autoplay loop muted playsinline></video>';
      });
    } else {
      loadMedia(it.mediaKey).then(r => {
        const v = document.createElement('video'); v.src = r.url;
        v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true;
        tile.appendChild(v);
      });
    }
    tile.onclick = () => sendStickerFromPanel(it.mediaKey, it.kind, it.emoji);
    grid.appendChild(tile);
  });
}

async function sendStickerFromPanel(mediaKey, kind, emoji) {
  if (!curChatId) return;
  const res = await call('send', {
    chatId: curChatId,
    text: emoji || '',
    type: kind,
    mediaKey,
    mode: getSenderMode(),
    businessConnectionId: curBizId,
  });
  cancelReply();
  if (res?.error) showToast(res.error, 'error'); else { await fetchHistory(curChatId, false); scrollBot(true); }
}
