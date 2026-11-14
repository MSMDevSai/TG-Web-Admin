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
    const senderMode = (selR && selR.value === 'me') ? 'me' : 'bot';
    const body = { chatId: curChatId, text: txt, senderMode, businessConnectionId: curBizId };
    if (replyTarget) body.replyToMsgId = replyTarget.msgId;
    const res = await apiFetch('/api/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
async function uploadMedia(blob, type, name) {
    const fd = new FormData();
    fd.append('chatId', curChatId); fd.append('type', type); fd.append('file', blob, name);
    const selR = document.querySelector('input[name="sender"]:checked');
    const senderMode = (selR && selR.value === 'me') ? 'me' : 'bot';
    fd.append('senderMode', senderMode);
    if (curBizId) fd.append('businessConnectionId', curBizId);
    if (replyTarget) fd.append('replyToMsgId', replyTarget.msgId);
    const res = await apiFetch('/api/send-media', { method: 'POST', body: fd });
    cancelReply();
    if (res?.error) showToast(res.error, 'error'); else { await fetchHistory(curChatId, false); scrollBot(true); }
}

// ---- voice recording ----
// Real tweb layout: cancel(×) — pill(dot + timer) — send(✓), every control
// live and clickable throughout the recording — not just a "لغو" text link
// with no way to actually send, which is what this replaces.
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
            uploadMedia(blob, 'voice', 'voice.webm');
        }
        mrec = null;
    };
    mrec.stream.getTracks().forEach(t => t.stop());
    mrec.stop();
}

// ---- emoji picker ----
// Real tweb source: assets/emoji_test.js category groupings, condensed to
// the 8 top-level categories the dropdown itself uses.
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

// ---- most-recently/most-used emoji tracking (localStorage) ----
// A "🕐 اخیر" category is prepended, sorted by click count descending —
// the emoji you actually use rise to the top over time.
const EMOJI_FREQ_KEY = 'tg_emoji_freq';
function getEmojiFreq() {
    try { return JSON.parse(localStorage.getItem(EMOJI_FREQ_KEY) || '{}'); } catch (e) { return {}; }
}
function bumpEmojiFreq(em) {
    const f = getEmojiFreq();
    f[em] = (f[em] || 0) + 1;
    localStorage.setItem(EMOJI_FREQ_KEY, JSON.stringify(f));
}
function recentEmojiList() {
    const f = getEmojiFreq();
    return Object.keys(f).sort((a, b) => f[b] - f[a]).slice(0, 40);
}

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
    if (emojiOpen) buildEmojiPicker();   // ~150 emoji: built on open (also refreshes the "recent" tab), not at page load
    document.getElementById('emojiPicker').classList.toggle('show', emojiOpen);
    if (emojiOpen) { document.getElementById('stickerPicker').classList.remove('show'); stickerOpen = false; }
}

// ---- sticker / GIF panel ----
// The Bot API has no "search/browse all stickers" call — only a known
// pack's getStickerSet, plus whatever the admin has actually sent before
// (tracked server-side as "recent"). Clicking a tile resends it by
// file_id (no re-upload needed).
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
        const recent = await apiFetch('/api/recent-media?type=sticker');
        (recent || []).forEach(s => items.push({ file_id: s.file_id, emoji: s.emoji || '🎭', kind: 'sticker' }));
        const gs = await apiFetch('/api/settings');
        const packs = (gs?.sticker_packs || '').split(',').map(s => s.trim()).filter(Boolean);
        for (const packName of packs) {
            const set = await apiFetch('/api/sticker-set?name=' + encodeURIComponent(packName));
            if (set && !set.error) (set.stickers || []).forEach(s => items.push({ file_id: s.file_id, emoji: s.emoji || '🎭', kind: 'sticker' }));
        }
    } else {
        const recent = await apiFetch('/api/recent-media?type=animation');
        (recent || []).forEach(g => items.push({ file_id: g.file_id, kind: 'animation' }));
    }

    grid.innerHTML = '';
    if (!items.length) {
        grid.innerHTML = '<div class="sk-empty">' + (stickerTab === 'sticker'
            ? 'موردی نیست — یا یه استیکر از منوی پیوست بفرست تا اینجا ذخیره بشه، یا توی تنظیمات یه پک استیکر معرفی کن.'
            : 'موردی نیست — یه GIF از منوی پیوست بفرست تا اینجا ذخیره بشه.') + '</div>';
        return;
    }
    items.forEach(it => {
        const tile = document.createElement('div'); tile.className = 'sk-tile';
        if (it.kind === 'sticker') {
            // same byte-sniffing renderer the chat bubbles use — this is
            // what actually makes animated (.tgs) stickers animate in the
            // picker instead of just showing their assigned emoji.
            renderSticker(tile, it.file_id, it.emoji);
        } else {
            const v = document.createElement('video'); v.src = murl(it.file_id);
            v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true;
            tile.appendChild(v);
        }
        tile.onclick = () => sendStickerFromPanel(it.file_id, it.kind, it.emoji);
        grid.appendChild(tile);
    });
}

async function sendStickerFromPanel(fileId, kind, emoji) {
    if (!curChatId) return;
    const selR = document.querySelector('input[name="sender"]:checked');
    const senderMode = (selR && selR.value === 'me') ? 'me' : 'bot';
    const body = { chatId: curChatId, fileId, type: kind, senderMode, businessConnectionId: curBizId, emoji };
    if (replyTarget) body.replyToMsgId = replyTarget.msgId;
    const res = await apiFetch('/api/send-sticker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    cancelReply();
    if (res?.error) showToast(res.error, 'error'); else { await fetchHistory(curChatId, false); scrollBot(true); }
}
