// Material Design 3 touch ripple.
// One delegated pointer listener for the whole app: on press it drops an expanding
// circle (from the touch point) inside a clipped wrapper in the pressed element and
// fades it on release. The hover/focus/press "state layer" is pure CSS (base.css).
(function () {
    const HOSTS = [
        '.icon-btn', '.btn', '.fab', '.chatlist-chat', '.view-btn', '.ftab', '.sp-list-row', '.mcm-item', '.att-menu .opt', '.pa-btn',
        '.u-btn', '.tbb', '.pm-tab', '.pm-media-row', '.ec', '.load-older-btn', '.send-btn', '.scroll-btn', '.voice-rec-cancel',
        '.voice-rec-send', '.react-expand', '.sk-tile', '.gi-member', '.chat-info-container', '.auth-link', '.btn-close', '.mp-play'
    ].join(',');
    const MAX_ACTIVE = 4;   // never stack unbounded ripples on a slow phone

    function start(e) {
        if (e.button > 0) return;                                   // primary button / touch only
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const host = e.target.closest && e.target.closest(HOSTS);
        if (!host || host.disabled || host.classList.contains('disabled')) return;

        let wrap = host.querySelector(':scope > .md-ripple-wrap');
        if (!wrap) {
            if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
            wrap = document.createElement('span');
            wrap.className = 'md-ripple-wrap';
            host.appendChild(wrap);
        }
        if (wrap.childElementCount >= MAX_ACTIVE) return;

        const r = host.getBoundingClientRect();
        const centered = host.classList.contains('icon-btn') || host.classList.contains('fab') || host.classList.contains('send-btn') ||
                         host.classList.contains('scroll-btn') || host.classList.contains('tbb') || host.classList.contains('btn-close');
        const x = centered ? r.width / 2 : e.clientX - r.left;
        const y = centered ? r.height / 2 : e.clientY - r.top;
        const d = 2 * Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y));   // reaches the farthest corner

        const rip = document.createElement('span');
        rip.className = 'md-ripple';
        rip.style.cssText = `width:${d}px;height:${d}px;left:${x - d / 2}px;top:${y - d / 2}px`;
        wrap.appendChild(rip);

        let released = false, grown = false;
        const fade = () => {
            if (!released || !grown) return;
            rip.classList.add('release');
            setTimeout(() => rip.remove(), 340);
        };
        rip.addEventListener('animationend', () => { grown = true; fade(); });
        const up = () => {
            released = true; fade();
            window.removeEventListener('pointerup', up, true);
            window.removeEventListener('pointercancel', up, true);
            window.removeEventListener('pointerleave', up, true);
        };
        window.addEventListener('pointerup', up, true);
        window.addEventListener('pointercancel', up, true);
        window.addEventListener('pointerleave', up, true);
        setTimeout(up, 1500);                                       // safety: never leave a ripple stuck
    }
    document.addEventListener('pointerdown', start, { passive: true });
})();
