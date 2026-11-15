// ══════════════════════════════════════════════════════════════
//  Live updates over WebSocket (server side: class Realtime + /ws in app.py).
//
//  The socket carries *hints only* ("chat list changed", "chat X changed").
//  On a hint we re-fetch through the normal ETag-cached REST calls, so there
//  is one source of truth and a dropped socket can never leave the UI wrong.
//  While the socket is healthy the old poller drops to a slow safety net
//  (see startPoller in index.html); when it isn't, polling carries on as before.
//
//  Also drives the Telegram-style connection bar:
//    connecting  → socket opening        waiting → device has no network
//    updating    → connected, catching up on what was missed
// ══════════════════════════════════════════════════════════════
var wsLive = false;                       // true while an authenticated socket is open

(function () {
    const STR = {
        fa: { connecting: 'در حال اتصال…', waiting: 'منتظر اتصال به شبکه…', updating: 'در حال به‌روزرسانی…' },
        en: { connecting: 'Connecting…', waiting: 'Waiting for network…', updating: 'Updating…' },
        ru: { connecting: 'Подключение…', waiting: 'Ожидание сети…', updating: 'Обновление…' }
    };
    let sock = null, tries = 0, retryTimer = null, watchdog = null, lastRx = 0, wanted = false, state = '';

    function setState(s) {
        if (s === state) return;
        state = s;
        const bar = document.getElementById('connStatus');
        if (!bar) return;
        const txt = (STR[document.documentElement.lang] || STR.fa)[s];
        if (txt) document.getElementById('connText').textContent = txt;
        bar.classList.toggle('show', !!txt);
    }

    function url() { return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'; }

    function scheduleRetry() {
        clearTimeout(retryTimer);
        if (!wanted) return;
        const base = Math.min(15000, 800 * Math.pow(2, tries++));
        retryTimer = setTimeout(open, base + Math.random() * 400);
    }

    // Abandon the current socket without waiting for its close handshake — after a network
    // drop a half-open socket can sit in OPEN/CLOSING for a minute and would block reconnecting.
    function drop() {
        const s = sock; sock = null; wsLive = false;
        if (s) { s.onopen = s.onmessage = s.onclose = s.onerror = null; try { s.close(); } catch (e) {} }
    }

    function lost() {
        wsLive = false;
        clearInterval(watchdog);
        setState(navigator.onLine === false ? 'waiting' : 'connecting');
        scheduleRetry();
    }

    async function catchUp() {
        // anything that happened while we were disconnected
        setState('updating');
        try {
            await Promise.all([fetchChats(true), curChatId ? fetchHistory(curChatId, true) : null]);
        } catch (e) { /* the poller will retry */ }
        if (wsLive) setState('');
    }

    function open() {
        if (!wanted || !PASS) return;
        if (sock && (sock.readyState === 0 || sock.readyState === 1)) return;
        if (navigator.onLine === false) { setState('waiting'); return; }
        setState('connecting');
        let s;
        try { s = new WebSocket(url()); } catch (e) { return scheduleRetry(); }
        sock = s;
        s.onopen = () => s.send(JSON.stringify({ t: 'auth', token: PASS }));
        s.onmessage = ev => {
            lastRx = Date.now();
            let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
            if (m.t === 'hello') {
                tries = 0; wsLive = true;
                clearInterval(watchdog);
                watchdog = setInterval(() => { if (Date.now() - lastRx > 70000) try { s.close(); } catch (e) {} }, 10000);
                catchUp();
            } else if (m.t === 'dirty') {
                fetchChats(true);
                if (curChatId && (m.chat || []).includes(String(curChatId))) fetchHistory(curChatId, true);
            } else if (m.t === 'ping') {
                try { s.send('{"t":"pong"}'); } catch (e) {}
            } else if (m.t === 'unauthorized') {
                wanted = false;               // session is gone: stop retrying, REST 401 handling signs the user out
                wsLive = false; setState('');
            }
        };
        s.onclose = () => { if (sock === s) { sock = null; lost(); } };
        s.onerror = () => { try { s.close(); } catch (e) {} };
    }

    // called once the user is signed in (startPoller)
    window.wsConnect = function () { wanted = true; open(); };

    window.addEventListener('online', () => { if (!wanted) return; drop(); clearTimeout(retryTimer); tries = 0; open(); });
    window.addEventListener('offline', () => { if (!wanted) return; drop(); clearInterval(watchdog); clearTimeout(retryTimer); setState('waiting'); });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden || !wanted) return;
        if (wsLive) catchUp();                // coming back to the app: make sure nothing was missed
        else { drop(); clearTimeout(retryTimer); tries = 0; open(); }
    });
})();
