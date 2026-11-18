// ═══════════════════════════════════════════════════════════════
//  دو گانه API caller:
//    1. call(name, input) → Serverless.call (داخل تلگرام) یا fetch با توکن (خارج)
//    2. callCond(name, input) → polling با ETag-like vis client-side hash
// ══════════════════════════════════════════════════════════════
var SESSION = localStorage.getItem('TG_SESSION') || '';
var IS_TELEGRAM = !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user);

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
async function fetchWeb(path, opts = {}) {
  opts.headers = opts.headers || {};
  opts.headers['Authorization'] = SESSION;
  try {
    const r = await fetch('/api/' + path, opts);
    if (r.status === 401) {
      localStorage.removeItem('TG_SESSION');
      SESSION = '';
      location.reload();
      return { error: true };
    }
    return await r.json();
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
