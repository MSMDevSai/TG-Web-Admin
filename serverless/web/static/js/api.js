// ═══════════════════════════════════════════════════════════════
//  دو گانه API caller:
//    1. call(name, input) → Serverless.call (داخل تلگرام) یا fetch با توکن (خارج)
//    2. callCond(name, input) → polling با ETag-like vis client-side hash
// ══════════════════════════════════════════════════════════════
var SESSION = localStorage.getItem('TG_SESSION') || '';
var IS_TELEGRAM = !!(window.Telegram && window.Telegram.WebApp &&
  ((window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) || window.Telegram.WebApp.initData));

// داخل تلگرام: Serverless.call (initData توسط پلتفرم تأیید می‌شود)
function callTg(name, input) {
  return new Promise((resolve, reject) => {
    const tg = window.Telegram && window.Telegram.WebApp;
    if (!tg || !tg.Serverless) {
      return reject({ type: 'UNAUTHORIZED', message: 'این پنل باید داخل تلگرام باز شود.' });
    }
    tg.Serverless.call(name, input || {}, (err, result) => {
      if (err) {
        reject({ message: err && (err.message || err.type), type: err && err.type, parameters: err && err.parameters });
      } else {
        resolve(result);
      }
    });
  });
}

// خارج تلگرام: fetch عادی به /api/<name> با Authorization: <SESSION>
// (پلتفرم پاسخ را در {ok, result} می‌پیچد؛ همان result را برمی‌گردانیم تا شکل
//  پاسخ با مسیر Serverless.call یکسان باشد.)
async function fetchWeb(path, opts = {}) {
  opts.headers = opts.headers || {};
  opts.headers['Authorization'] = SESSION;
  try {
    const r = await fetch('/api/' + path, opts);
    if (r.status === 401) {
      // The platform rejects every /api/* call that does not carry signed Telegram
      // init data — the endpoint code never runs, so a browser password login can
      // never succeed in this edition. Hand control back to the sign-in card with a
      // message the caller can show (no reload loop).
      localStorage.removeItem('TG_SESSION');
      SESSION = '';
      const msg = (typeof window !== 'undefined' && window.__WEB_BRIDGE__)
        ? 'نشست منقضی شده است؛ لطفاً دوباره وارد شوید.'
        : IS_TELEGRAM
          ? 'نشست منقضی شده است؛ لطفاً پنل را دوباره از تلگرام باز کنید.'
          : 'ورود از مرورگر ممکن نیست: پلتفرم فقط درخواست‌های امضاشدهٔ تلگرام را می‌پذیرد (۴۰۱). پنل را از داخل تلگرام باز کنید.';
      if (!IS_TELEGRAM) {
        const app = document.getElementById('app'); if (app) app.classList.add('d-none');
        if (typeof finishSplash === 'function') finishSplash(true);
        else { const box = document.getElementById('authBox'); if (box) box.classList.remove('d-none'); }
        if (typeof showAuthMode === 'function') showAuthMode('login');
      }
      return { error: msg, unauthorized: true };
    }
    let j = null;
    try { j = await r.json(); } catch (e) { j = null; }
    if (!r.ok) {
      // Platform errors: {ok:false, description, parameters} (EndpointError → 400).
      const description = (j && (j.description || j.message || (j.error && (j.error.message || j.error.description)))) || ('خطای سرور (' + r.status + ')');
      return { error: description, code: (j && (j.code || j.type || (j.error && j.error.code))) || null, parameters: (j && (j.parameters || (j.error && j.error.parameters))) || null };
    }
    if (j && typeof j === 'object' && j.ok === true && 'result' in j) return j.result;
    return j;
  } catch (e) {
    return null;
  }
}

// Wrapper isTelegram-aware: داخل تلگرام از Serverless.call استفاده می‌کند؛ خارج از fetch
async function call(name, input) {
  if (IS_TELEGRAM) return await callTg(name, input);
  return await fetchWeb(name, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input || {}),
  });
}

// Conditional fetch with ETag-like behaviour (polling)
const _etags = {};
async function callCond(name, input) {
  const key = name + ':' + JSON.stringify(input || {});
  try {
    const res = await call(name, input);
    if (!res) return null;
    const hash = JSON.stringify(res);
    if (_etags[key] === hash) return { notModified: true };
    _etags[key] = hash;
    return res;
  } catch (e) {
    return null;
  }
}
