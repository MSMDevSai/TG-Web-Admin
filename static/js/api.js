async function apiFetch(ep, opts = {}) {
    opts.headers = opts.headers || {};
    opts.headers["Authorization"] = PASS;
    try {
        const r = await fetch(ep, opts);
        if (r.status === 401) {
            // session revoked/expired (e.g. the account was suspended or its
            // password was reset while logged in) — back to the login screen
            if (PASS) { localStorage.removeItem("TG_PASS"); localStorage.removeItem("TG_IS_OWNER"); PASS = ""; location.reload(); }
            return { error: true };
        }
        return await r.json();
    } catch (e) {
        return null;
    }
}

// Polling fetch: remembers each URL's ETag and answers {notModified:true} on
// a 304, so an unchanged chat/list costs no download, parse or diff.
const _etags = {};
async function apiFetchCond(ep) {
    const headers = { Authorization: PASS };
    if (_etags[ep]) headers["If-None-Match"] = _etags[ep];
    try {
        const r = await fetch(ep, { headers });
        if (r.status === 304) return { notModified: true };
        if (r.status === 401) {
            if (PASS) { localStorage.removeItem("TG_PASS"); localStorage.removeItem("TG_IS_OWNER"); PASS = ""; location.reload(); }
            return { error: true };
        }
        const et = r.headers.get("ETag");
        if (et) _etags[ep] = et; else delete _etags[ep];
        return await r.json();
    } catch (e) {
        return null;
    }
}
