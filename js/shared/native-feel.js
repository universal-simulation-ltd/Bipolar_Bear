/**
 * Native feel (test version, branch native-feel — James, 2026-10-19).
 *
 * Makes the web pages behave more like a phone app, on phones only (inside
 * the Capacitor app, or a touch screen at phone width). Loaded in <head>
 * right after platform.js (which sets html.is-native) on every page of
 * Bipolar Bear and Bipolar Anonymous. Three things, all driven from here so
 * the page scripts barely change:
 *
 *  1. List rows. Tap a row to open it; swipe it left to reveal its actions
 *     (Delete, More…); swipe all the way to delete. The page's own ✏️ / × /
 *     → / ⋯ buttons stay in the DOM, visually hidden but still there for
 *     VoiceOver, and the actions simply click them — so every confirm, undo
 *     and save path is the page's own. Pages register rows with BB.nf.rows().
 *  2. Pop-ups become bottom sheets with a grabber that slide up, and swipe
 *     down to close. Closing goes through the overlay's own tap-outside
 *     handler (a synthetic click on the backdrop); a sheet that doesn't
 *     close that way springs back, so nothing is dismissed that couldn't be.
 *  3. Swipe from the left edge to go back, with the page following the
 *     finger. Pages say what "back" is with BB.nf.setBack(fn, canFn).
 *     iOS / web only: Android has its own back gesture.
 *
 * Plus haptics on switches and on the gestures above. localStorage
 * bbNativeFeel = '0' / '1' forces it off / on (for testing on a desktop).
 */
(function () {
  'use strict';
  var BB = window.BB = window.BB || {};
  var html = document.documentElement;

  function haptic(kind) {
    try {
      var H = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics;
      if (H && H.impact) { H.impact({ style: kind === 'medium' ? 'MEDIUM' : 'LIGHT' }); return; }
    } catch (_) {}
    try { if (navigator.vibrate) navigator.vibrate(kind === 'medium' ? 15 : 8); } catch (_) {}
  }

  var forced = null;
  try { forced = localStorage.getItem('bbNativeFeel'); } catch (_) {}
  var coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  var phone = Math.min(screen.width || 9999, window.innerWidth || 9999) <= 600;
  var on = forced === '1' || (forced !== '0' && (html.classList.contains('is-native') || (coarse && phone)));

  var api = BB.nf = { on: on, haptic: haptic, rows: function () {}, setBack: function () {} };
  if (!on) return;
  html.classList.add('nf');

  function t(key, fallback) {
    try { var v = BB.t ? BB.t(key) : null; if (v && v !== key) return v; } catch (_) {}
    return fallback;
  }

  // ── CSS ──────────────────────────────────────────────────────────────
  var SR = 'position:absolute!important;width:1px!important;height:1px!important;padding:0!important;'
    + 'margin:-1px!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;white-space:nowrap!important;border:0!important;';
  // Overlay → its sheet. Open selector, content selector (a direct child).
  var SHEETS = [
    ['.confirm-modal.active', '.confirm-content'],
    ['.overlay-modal.active', '.modal-box'],
    ['.steps-modal.active', '.steps-modal-content'],
    ['.bb-feedback-modal.open', '.bb-feedback-content'],
    ['.bb-auth-overlay.active', '.bb-auth-box'],
    ['.bb-account-overlay.active', '.bb-account-box'],
    ['.bb-fab-modal.open', 'div'],
    ['.overlay:not(.hidden)', '.sheet'],
  ];
  var OPEN_SEL = SHEETS.map(function (s) { return s[0]; }).join(',');
  var BOTTOM = SHEETS.slice(0, 7); // the anonymous board's sheets already sit at the bottom
  var css = ''
    + '@keyframes nf-up{from{transform:translateY(100%)}to{transform:none}}'
    + '@keyframes nf-fade{from{opacity:0}to{opacity:1}}'
    + 'html.nf .nf-acts{position:absolute;top:0;bottom:0;left:100%;display:flex;gap:6px;padding-left:6px;box-sizing:border-box;z-index:2}'
    + 'html.nf .nf-act{flex:1 0 auto;min-width:78px;border:0;border-radius:12px;margin:0;padding:0 14px;'
    +   'font:600 15px/1.2 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:#fff;cursor:pointer;'
    +   '-webkit-tap-highlight-color:transparent;transition:min-width .15s,padding .15s,opacity .15s}'
    + 'html.nf .nf-act.nf-del{background:#e5383b}'
    + 'html.nf .nf-act.nf-more{background:#8e8e93}'
    + 'html.nf .nf-act.nf-warn{background:#ff9500}'
    + 'html.nf .nf-acts.nf-armed .nf-act:not(.nf-del){min-width:0;padding:0;opacity:0;flex:0 0 0;overflow:hidden}'
    + 'html.nf .nf-row-tap{cursor:pointer}'
    // Sheets: bottom-anchored on phones, centred again from tablet width.
    + '@media (max-width:700px){'
    +   BOTTOM.map(function (s) { return 'html.nf ' + s[0].split('.').slice(0, 2).join('.'); }).join(',')
    +     '{align-items:flex-end!important;justify-content:center!important;padding:0!important}'
    +   BOTTOM.map(function (s) { return 'html.nf ' + s[0] + '>' + s[1]; }).join(',')
    +     '{width:100%!important;max-width:none!important;margin:0!important;border-radius:16px 16px 0 0!important;'
    +     'max-height:92dvh!important;overflow-y:auto;box-sizing:border-box;position:relative;'
    +     'padding-bottom:calc(24px + env(safe-area-inset-bottom,0px))!important;'
    +     'animation:nf-up .32s cubic-bezier(.2,.9,.3,1)}'
    + '}'
    + SHEETS.map(function (s) { return 'html.nf ' + s[0]; }).join(',') + '{animation:nf-fade .2s ease-out}'
    + 'html.nf .overlay:not(.hidden)>.sheet{animation:nf-up .32s cubic-bezier(.2,.9,.3,1)}'
    + SHEETS.map(function (s) { return 'html.nf ' + s[0] + '>' + s[1] + '::before'; }).join(',')
    +   '{content:"";display:block;flex:none;width:36px;height:5px;border-radius:3px;'
    +   'background:rgba(128,128,128,.45);margin:-12px auto 14px}'
    + '@media (prefers-reduced-motion:reduce){html.nf *{animation:none!important}}'
    // Press feedback on a row that opens (set by the touch code below).
    + 'html.nf .nf-press{filter:brightness(.92)}html.theme-dark.nf .nf-press{filter:brightness(1.25)}'
    // "← Home" as a plain back control in the top bar, not a filled pill.
    + 'html.nf .home-link-journal.home-link-journal,html.nf .home-link-btn.home-link-btn,html.nf .board-back-btn.board-back-btn{background:none!important;border:0!important;'
    +   'box-shadow:none!important;padding:10px 6px!important;min-height:44px;display:inline-flex;align-items:center;'
    +   'color:var(--brand-ink,#b35c00)!important;font-weight:700;font-size:1.02em}'
    + 'html.theme-dark.nf .home-link-journal,html.theme-dark.nf .home-link-btn{color:var(--brand-primary,#ff9500)!important}'
    // Journal settings: each setting a grouped row, like a phone's Settings.
    + 'html.nf #settingsContent details,html.nf #guestPinRow,html.nf #appLockRow,html.nf #bioUnlockRow,'
    +   'html.nf #settingsContent div:has(> label.bb-switch),html.nf #settingsContent div:has(> input[type="time"]){background:rgba(127,127,127,.10);border-radius:12px;'
    +   'padding:12px 14px!important;margin:0 0 8px!important;box-sizing:border-box}'
    + 'html.nf #settingsContent details > summary{padding:2px 0!important;min-height:40px}'
    // Small tap targets on the board (Apple's minimum is 44pt).
    + 'html.nf .thread-close-btn{min-width:44px;min-height:44px}'
    + 'html.nf .like-btn,html.nf .comment-btn{min-height:40px}'
    // Sheets measure against the visible viewport, so the keyboard can't hide a Send button.
    + 'html.nf .sheet{max-height:90dvh}';
  var styleEl = document.createElement('style');
  styleEl.id = 'nf-style';
  styleEl.textContent = css;
  (document.head || html).appendChild(styleEl);

  var EDGE = 24;
  var swallowUntil = 0;
  function within(el, sel) { return el && el.closest ? el.closest(sel) : null; }
  function isOpen(ov) { return ov.matches(OPEN_SEL) && getComputedStyle(ov).display !== 'none'; }
  function anySheetOpen() {
    var list = document.querySelectorAll(OPEN_SEL);
    for (var i = 0; i < list.length; i++) if (getComputedStyle(list[i]).display !== 'none') return true;
    return false;
  }

  // ── 1. List rows ─────────────────────────────────────────────────────
  // rule: { row: selector, open?: selector | fn(row), del?: selector,
  //         actions?: fn(row) → [{ label, kind: 'del'|'more'|'warn', run }],
  //         hide?: selector of more buttons to hide visually }
  var RULES = [];
  api.rows = function (rule) {
    RULES.push(rule);
    var hide = [rule.open, rule.del, rule.hide].filter(function (s) { return typeof s === 'string'; });
    var extra = hide.map(function (s) {
      return s.split(',').map(function (part) { return 'html.nf ' + rule.row + ' ' + part.trim(); }).join(',');
    }).join(',');
    if (extra) styleEl.textContent += extra + '{' + SR + '}';
    if (rule.open) styleEl.textContent += 'html.nf ' + rule.row + '{cursor:pointer}';
  };
  function match(el) {
    for (var i = 0; i < RULES.length; i++) {
      var r = within(el, RULES[i].row);
      if (r) return { rule: RULES[i], row: r };
    }
    return null;
  }
  function actionsFor(m) {
    if (m.rule.actions) return m.rule.actions(m.row) || [];
    var del = m.rule.del && m.row.querySelector(m.rule.del);
    return del ? [{ label: t('common.delete', 'Delete'), kind: 'del', run: function () { del.click(); } }] : [];
  }
  function layerFor(m) {
    var row = m.row;
    if (row._nfL && row._nfL.parentNode === row) return row._nfL;
    var acts = actionsFor(m);
    if (!acts.length) return null;
    var L = document.createElement('div');
    L.className = 'nf-acts';
    L.setAttribute('aria-hidden', 'true'); // the page's own buttons stay for VoiceOver
    acts.forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.className = 'nf-act nf-' + (a.kind || 'more');
      b.textContent = a.label;
      b.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        haptic();
        closeRow(row);
        setTimeout(a.run, 160);
      });
      L.appendChild(b);
    });
    if (getComputedStyle(row).position === 'static') row.style.position = 'relative';
    var p = row.parentElement;
    if (p && !p._nfClip) {
      p._nfClip = true;
      p.style.overflowX = 'clip';
      if (getComputedStyle(p).overflowX !== 'clip') p.style.overflowX = 'hidden';
    }
    row.appendChild(L);
    row._nfL = L;
    row._nfActs = acts;
    return L;
  }
  var openRow = null, g = null;
  function setRow(row, x, animate) {
    row.style.transition = animate ? 'transform .28s cubic-bezier(.2,.9,.3,1)' : 'none';
    row.style.transform = x ? 'translateX(' + x + 'px)' : '';
    if (row._nfL) {
      row._nfL.style.transition = animate ? 'width .28s cubic-bezier(.2,.9,.3,1)' : 'none';
      row._nfL.style.width = x < 0 ? Math.max(-x, row._nfW || 0) + 'px' : '';
    }
  }
  function closeRow(row) {
    if (!row) return;
    setRow(row, 0, true);
    if (row._nfL) row._nfL.classList.remove('nf-armed');
    if (openRow === row) openRow = null;
  }

  document.addEventListener('touchstart', function (e) {
    g = null;
    if (e.touches.length !== 1) return;
    var tt = e.touches[0];
    if (openRow && !openRow.isConnected) openRow = null;
    if (openRow && !openRow.contains(e.target)) {
      // Like iOS: a touch anywhere else just closes the open row.
      closeRow(openRow);
      swallowUntil = Date.now() + 450;
      return;
    }
    if (tt.clientX < EDGE) return; // the edge belongs to swipe-back
    if (within(e.target, 'input,textarea,select,.bb-switch,[contenteditable="true"],.nf-acts')) return;
    var m = match(e.target);
    if (!m) return;
    g = { m: m, row: m.row, x0: tt.clientX, y0: tt.clientY, base: m.row === openRow ? -(m.row._nfW || 0) : 0, lock: null, off: 0, armed: false };
    // Highlight a row that opens once the finger has rested on it a moment
    // (not straight away, so a scroll doesn't flash every row it passes).
    if (m.rule.open && m.row !== openRow && !within(e.target, 'button,a,[onclick]')) {
      var row = m.row;
      pressX = tt.clientX; pressY = tt.clientY;
      pressTimer = setTimeout(function () { row.classList.add('nf-press'); pressed = row; }, 90);
    }
  }, { passive: true, capture: true });
  var pressTimer = null, pressed = null, pressX = 0, pressY = 0;
  function unpress() {
    clearTimeout(pressTimer); pressTimer = null;
    if (pressed) { var p = pressed; pressed = null; setTimeout(function () { p.classList.remove('nf-press'); }, 120); }
  }
  document.addEventListener('touchmove', function (e) {
    if (!pressTimer && !pressed) return;
    var tt = e.touches[0];
    if (Math.abs(tt.clientX - pressX) < 8 && Math.abs(tt.clientY - pressY) < 8) return;
    if (pressTimer || pressed) { clearTimeout(pressTimer); pressTimer = null; if (pressed) { pressed.classList.remove('nf-press'); pressed = null; } }
  }, { passive: true, capture: true });
  document.addEventListener('touchend', unpress, { passive: true, capture: true });
  document.addEventListener('touchcancel', unpress, { passive: true, capture: true });

  document.addEventListener('touchmove', function (e) {
    if (!g) return;
    var tt = e.touches[0], dx = tt.clientX - g.x0, dy = tt.clientY - g.y0;
    if (!g.lock) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dx) > Math.abs(dy) * 1.2 && (dx < 0 || g.base < 0)) {
        var L = layerFor(g.m);
        if (!L) { g = null; return; }
        g.row.style.transition = 'none';
        g.W = g.row._nfW = L.scrollWidth;
        g.rw = g.row.offsetWidth;
        g.del = g.row._nfActs.filter(function (a) { return a.kind === 'del'; })[0];
        g.lock = 'x';
      } else { g = null; return; }
    }
    e.preventDefault();
    var off = g.base + dx;
    if (off > 0) off *= 0.25;
    if (off < -g.W && !g.del) off = -g.W + (off + g.W) * 0.3;
    var armed = !!g.del && off < -Math.max(g.rw * 0.6, g.W + 48);
    if (armed !== g.armed) {
      g.armed = armed;
      g.row._nfL.classList.toggle('nf-armed', armed);
      haptic(armed ? 'medium' : 'light');
    }
    g.off = off;
    setRow(g.row, off, false);
  }, { passive: false, capture: true });

  function endRow() {
    if (!g) return;
    var G = g; g = null;
    if (G.lock !== 'x') return;
    if (G.armed) {
      setRow(G.row, -G.rw, true);
      openRow = null;
      setTimeout(function () {
        G.del.run();
        // A confirm the user cancels leaves the row on the page: put it back.
        setTimeout(function () { if (G.row.isConnected) closeRow(G.row); }, 300);
      }, 220);
      return;
    }
    if (G.off < -G.W / 2) { setRow(G.row, -G.W, true); openRow = G.row; }
    else closeRow(G.row);
  }
  document.addEventListener('touchend', endRow, { passive: true, capture: true });
  document.addEventListener('touchcancel', endRow, { passive: true, capture: true });
  window.addEventListener('scroll', function () { if (openRow && !g) closeRow(openRow); }, { passive: true, capture: true });

  document.addEventListener('click', function (e) {
    if (e.isTrusted && Date.now() < swallowUntil) { e.preventDefault(); e.stopPropagation(); return; }
    if (within(e.target, '.nf-acts')) return;
    var m = match(e.target);
    if (!m) return;
    if (m.row === openRow) { e.preventDefault(); e.stopPropagation(); closeRow(m.row); return; }
    if (!m.rule.open) return;
    // A real control inside the row keeps doing its own thing.
    var ctl = within(e.target, 'button,a,input,label,select,textarea,summary,[role="button"],[onclick]');
    if (ctl && ctl !== m.row && m.row.contains(ctl)) return;
    e.preventDefault(); e.stopPropagation();
    haptic();
    if (typeof m.rule.open === 'function') m.rule.open(m.row);
    else { var b = m.row.querySelector(m.rule.open); if (b) b.click(); }
  }, true);

  // ── 2. Sheets: swipe down to close ───────────────────────────────────
  var s = null;
  document.addEventListener('touchstart', function (e) {
    s = null;
    // A row inside a sheet can start either: rows take sideways moves only, sheets downward ones.
    if (e.touches.length !== 1) return;
    var ov = within(e.target, OPEN_SEL);
    if (!ov || e.target === ov) return;
    var c = e.target;
    while (c && c.parentElement !== ov) c = c.parentElement;
    if (!c) return;
    if (within(e.target, 'input[type="range"],textarea,select,.bb-switch,[data-nf-nodrag]')) return;
    for (var n = e.target; n && n !== ov; n = n.parentElement) if (n.scrollTop > 0) return;
    var tt = e.touches[0];
    s = { ov: ov, c: c, x0: tt.clientX, y0: tt.clientY, t0: Date.now(), lock: null, dy: 0 };
  }, { passive: true, capture: true });
  document.addEventListener('touchmove', function (e) {
    if (!s) return;
    var tt = e.touches[0], dx = tt.clientX - s.x0, dy = tt.clientY - s.y0;
    if (!s.lock) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (dy > 0 && dy > Math.abs(dx) * 1.2) {
        s.lock = 'y';
        s.c.style.transition = 'none';
        // Finish the slide-up if it's still running, rather than switching the
        // animation off: turning it back on afterwards restarted it, so the
        // sheet dropped and slid up again after snapping back (James, video
        // 2026-10-20).
        try { s.c.getAnimations().forEach(function (a) { a.finish(); }); } catch (_) {}
      }
      else { s = null; return; }
    }
    e.preventDefault();
    s.dy = Math.max(0, dy);
    s.c.style.transform = 'translateY(' + s.dy + 'px)';
  }, { passive: false, capture: true });
  function springBack(c) {
    c.style.transition = 'transform .3s cubic-bezier(.2,.9,.3,1)';
    c.style.transform = '';
    setTimeout(function () { c.style.transition = ''; }, 320);
  }
  function endSheet() {
    if (!s) return;
    var S = s; s = null;
    if (S.lock !== 'y') return;
    var v = S.dy / Math.max(1, Date.now() - S.t0);
    if (S.dy < 110 && v < 0.6) { springBack(S.c); return; }
    S.c.style.transition = 'transform .2s ease-in';
    S.c.style.transform = 'translateY(' + (S.c.offsetHeight + 40) + 'px)';
    haptic();
    var done = function () { S.c.style.transition = ''; S.c.style.transform = ''; };
    setTimeout(function () {
      S.ov.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      setTimeout(function () {
        if (!isOpen(S.ov)) return done();
        // No tap-outside handler: use the sheet's own Cancel / Close / ✕.
        var btn = closeButton(S.c);
        if (btn) btn.click();
        setTimeout(function () { if (isOpen(S.ov)) springBack(S.c); else done(); }, 60);
      }, 60);
    }, 190);
  }
  function closeButton(c) {
    var words = [t('common.cancel', 'Cancel'), t('common.close', 'Close'), 'Cancel', 'Close', '✕', '×', '✖'];
    var list = c.querySelectorAll('button');
    for (var i = 0; i < list.length; i++) {
      var txt = (list[i].textContent || '').trim();
      if (words.indexOf(txt) !== -1 && list[i].getClientRects().length) return list[i];
    }
    return c.querySelector('.steps-modal-close, .thread-close-btn, [data-nf-close]');
  }
  document.addEventListener('touchend', endSheet, { passive: true, capture: true });
  document.addEventListener('touchcancel', function () { if (s && s.lock === 'y') springBack(s.c); s = null; }, { passive: true, capture: true });

  // ── 3. Swipe from the left edge to go back ───────────────────────────
  var backFn = null, canBack = null, b = null;
  api.setBack = function (fn, can) { backFn = fn; canBack = can || null; };
  function page() { return document.getElementById('app-shell') || document.body; }
  document.addEventListener('touchstart', function (e) {
    b = null;
    if (!backFn || e.touches.length !== 1 || html.classList.contains('is-android')) return;
    var tt = e.touches[0];
    if (tt.clientX > EDGE || anySheetOpen()) return;
    if (canBack && !canBack()) return;
    b = { x0: tt.clientX, y0: tt.clientY, t0: Date.now(), lock: null, dx: 0 };
  }, { passive: true, capture: true });
  document.addEventListener('touchmove', function (e) {
    if (!b) return;
    var tt = e.touches[0], dx = tt.clientX - b.x0, dy = tt.clientY - b.y0;
    if (!b.lock) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      if (dx > 0 && dx > Math.abs(dy)) {
        b.lock = 'x';
        var p = page();
        p.style.transition = 'none';
        p.style.boxShadow = '-10px 0 30px rgba(0,0,0,.25)';
      } else { b = null; return; }
    }
    e.preventDefault();
    b.dx = Math.max(0, dx);
    page().style.transform = 'translateX(' + b.dx + 'px)';
  }, { passive: false, capture: true });
  function settle(p) {
    setTimeout(function () { p.style.transition = ''; p.style.transform = ''; p.style.boxShadow = ''; p.style.opacity = ''; }, 300);
  }
  function endBack() {
    if (!b) return;
    var B = b; b = null;
    if (B.lock !== 'x') return;
    var p = page();
    var go = B.dx > window.innerWidth * 0.33 || B.dx / Math.max(1, Date.now() - B.t0) > 0.5;
    if (!go) {
      p.style.transition = 'transform .25s cubic-bezier(.2,.9,.3,1)';
      p.style.transform = '';
      settle(p);
      return;
    }
    p.style.transition = 'transform .2s ease-out';
    p.style.transform = 'translateX(100%)';
    haptic();
    setTimeout(function () {
      var leaving = false;
      try { leaving = backFn() === true; } catch (_) {}
      if (leaving) return; // a new page is loading; leave this one slid away
      // Back within the page (e.g. a section to its grid): slide the result in.
      p.style.transition = 'none';
      p.style.transform = 'translateX(-30%)';
      p.style.opacity = '0.6';
      void p.offsetWidth;
      p.style.transition = 'transform .28s cubic-bezier(.2,.9,.3,1), opacity .28s';
      p.style.transform = '';
      p.style.opacity = '';
      settle(p);
    }, 200);
  }
  document.addEventListener('touchend', endBack, { passive: true, capture: true });
  document.addEventListener('touchcancel', function () { if (b && b.lock === 'x') { var p = page(); p.style.transform = ''; settle(p); } b = null; }, { passive: true, capture: true });
  // A page restored from the back/forward cache must not come back slid away.
  window.addEventListener('pageshow', function () { var p = page(); if (p) { p.style.transform = ''; p.style.opacity = ''; p.style.boxShadow = ''; } });

  // ── Haptics on switches and tick boxes ───────────────────────────────
  document.addEventListener('change', function (e) {
    if (e.target && e.target.matches && e.target.matches('input[type="checkbox"],input[type="radio"]')) haptic();
  }, true);

  // ── Bipolar Bear's lists ─────────────────────────────────────────────
  // (Bipolar Anonymous registers its posts and replies in js/anonymous.js.)
  api.rows({ row: '#entries .entry', open: '.edit-btn', del: '.delete-btn' });
  api.rows({ row: '#goalsList > div', open: 'button[onclick^="editGoal"]', del: 'button[onclick^="deleteGoal"]' });
  api.rows({ row: '#medInfoList > div', open: 'button[onclick^="editMedication"]', del: 'button[onclick^="deleteMedication"]' });
  api.rows({ row: '#gratitudeList > div', open: 'button[onclick^="editGratitudeItem"]', del: 'button[onclick^="deleteGratitudeItem"]' });
  api.rows({ row: '#survivalGoalsList > div', open: 'button[onclick^="editSurvivalGoal"]', del: 'button[onclick^="deleteSurvivalGoal"]' });
  api.rows({ row: '#memoriesList > div', open: 'button[onclick^="editMemory"]', del: 'button[onclick^="deleteMemory"]' });
  api.rows({ row: '#copingStrategiesList > div', open: 'button[onclick^="openEditCopingModal"]', del: 'button[onclick^="deleteCopingStrategy"]' });
  // Reminders: the header opens and closes the reminder, so a tap keeps doing that.
  api.rows({ row: '#customRemindersContainer .accordion > div:first-child', del: 'button[onclick^="deleteReminder"]', hide: 'button[onclick^="editReminder"]',
    actions: function (row) {
      var ed = row.querySelector('button[onclick^="editReminder"]'), del = row.querySelector('button[onclick^="deleteReminder"]');
      var a = [];
      if (ed) a.push({ label: t('common.edit', 'Edit'), kind: 'more', run: function () { ed.click(); } });
      if (del) a.push({ label: t('common.delete', 'Delete'), kind: 'del', run: function () { del.click(); } });
      return a;
    } });
  // 💊 My medicines (js/journal-meds.js). Your medicines first (tap to change
  // the name or dose, swipe to remove), then side effects, blood levels and
  // past changes (swipe to delete). Rules match in order, so .meds-cur wins.
  api.rows({ row: '.meds-cur', open: '.meds-edit', del: '.meds-rm' });
  api.rows({ row: '.meds-row', del: '.meds-del' });
  // My safety plan: no edit, so a swipe is the only way to remove an item.
  api.rows({ row: '.bbsp-list > li', del: '.bbsp-rm' });
})();
