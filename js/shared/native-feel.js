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
 *
 * Stage 3 (James, 2026-10-20: "the navigation design should stay as is but
 * could be rebuilt with the buttons opening drawers"). No tab bar, no pushed
 * screens; the buttons stay where they are and open drawers:
 *  4. Drawers. BB.nf.drawer.open(el, onClose) turns a page section into a
 *     bottom drawer over the page (the survival kit's sections), with a
 *     grabber, ✕, a backdrop, and swipe down to close. In the journal's
 *     Settings each "→" slides the next page up as a new drawer, and a swipe
 *     down goes back one page (its own ← Back) instead of closing Settings.
 *  5. Writing rides the keyboard: a sheet or drawer with a text box in use
 *     sits on top of the keyboard (visualViewport), and a textarea makes it
 *     full height, so the whole sheet is a composer.
 *  6. Undo. A swipe Delete on a list that opts in (rule.undo) hides the row
 *     behind "Deleted · Undo" for 5 s and only then runs the page's own
 *     delete, its confirm answered yes. Undo just shows the row again. The
 *     next touch anywhere else, leaving the page or the app, or another
 *     delete, carries the pending one out first, and that touch is
 *     swallowed, so nothing acts on a list about to redraw.
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
    + 'html.nf .sheet{max-height:90dvh}'
    // 4. Drawers (BB.nf.drawer) and Settings' pages opening as new drawers.
    + '@media (max-width:700px){'
    +   'html.nf .nf-drawer-on{display:block!important;position:fixed!important;left:0!important;right:0!important;top:auto!important;bottom:0!important;'
    +     'margin:0!important;max-height:92dvh;overflow-y:auto;overscroll-behavior:contain;z-index:950;box-sizing:border-box;'
    +     'border-radius:16px 16px 0 0;background:#fff;padding:14px 16px calc(24px + env(safe-area-inset-bottom,0px))!important;'
    +     'box-shadow:0 -6px 30px rgba(0,0,0,.22);animation:nf-up .32s cubic-bezier(.2,.9,.3,1)}'
    +   'html.theme-dark.nf .nf-drawer-on{background:var(--dk-surface,#262019)}'
    + '}'
    + '#nfDrawerBack{position:fixed;inset:0;background:rgba(0,0,0,.42);z-index:949;animation:nf-fade .2s ease-out}'
    + 'html.nf-drawer-lock,html.nf-drawer-lock body{overflow:hidden!important}'
    // The drawer's top row: the grabber in the middle, ✕ on the right, above
    // the section's own heading (which may have its own tick on the right).
    + '.nf-drawer-top{position:sticky;top:-14px;display:grid;grid-template-columns:36px 1fr 36px;align-items:center;margin:-8px -6px 6px;z-index:3}'
    + '.nf-drawer-grab{justify-self:center;width:36px;height:5px;border-radius:3px;background:rgba(128,128,128,.45)}'
    + '.nf-drawer-x{grid-column:3;width:36px;height:36px;border:0;border-radius:50%;background:rgba(127,127,127,.16);color:inherit;font-size:16px;line-height:1;cursor:pointer;-webkit-tap-highlight-color:transparent}'
    + '@keyframes nf-back{from{transform:translateY(-14px);opacity:.3}to{transform:none;opacity:1}}'
    + 'html.nf .nf-back-in{animation:nf-back .24s ease-out}'
    // 5. A sheet riding the keyboard (transform / max-height set inline).
    + 'html.nf .nf-kb{transition:transform .18s ease-out;animation:none!important}'
    + 'html.nf .nf-kb-full{border-radius:14px 14px 0 0!important}'
    // 6. Undo: the row waits hidden; the bar sits above the dock.
    + 'html.nf .nf-gone{display:none!important}'
    + '.nf-silent{visibility:hidden!important}'
    + '@keyframes nf-snack{from{transform:translateY(16px);opacity:0}to{transform:none;opacity:1}}'
    + '.nf-snack{position:fixed;left:12px;right:12px;bottom:calc(84px + env(safe-area-inset-bottom,0px));z-index:10050;display:flex;align-items:center;'
    +   'justify-content:space-between;gap:12px;padding:6px 6px 6px 16px;border-radius:12px;background:#2b2622;color:#fff;'
    +   'font:500 15px/1.3 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.3);animation:nf-snack .22s ease-out;max-width:520px;margin:0 auto}'
    + '.nf-snack-undo{background:none;border:0;color:#ffb366;font:700 15px/1 inherit;font-family:inherit;padding:0 14px;min-height:44px;cursor:pointer;-webkit-tap-highlight-color:transparent}';
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
    var acts;
    if (m.rule.actions) acts = m.rule.actions(m.row) || [];
    else {
      var del = m.rule.del && m.row.querySelector(m.rule.del);
      acts = del ? [{ label: t('common.delete', 'Delete'), kind: 'del', run: function () { del.click(); } }] : [];
    }
    // A list that opts in to undo: its Delete waits behind "Deleted · Undo".
    if (m.rule.undo) {
      acts = acts.map(function (a) {
        if (a.kind !== 'del') return a;
        var commit = typeof m.rule.undo === 'function' ? function () { m.rule.undo(m.row, a.run); } : a.run;
        return { label: a.label, kind: a.kind, run: function () { deferDelete(m.row, commit); } };
      });
    }
    return acts;
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
    // A delete waiting behind Undo: any other touch carries it out, and this
    // touch does nothing (the list is about to redraw under it).
    if (pend && !within(e.target, '.nf-snack')) {
      flushDelete();
      swallowUntil = Date.now() + 450;
      return;
    }
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
    if (e.touches.length !== 1 || pend) return;
    var ov = within(e.target, OPEN_SEL), c;
    if (ov) {
      if (e.target === ov) return;
      c = e.target;
      while (c && c.parentElement !== ov) c = c.parentElement;
      if (!c) return;
    } else {
      // A drawer is its own sheet: it scrolls itself and closes with _nfClose.
      ov = c = within(e.target, '.nf-drawer-on');
      if (!ov) return;
    }
    if (within(e.target, 'input,textarea,select,.bb-switch,[data-nf-nodrag]')) return;
    for (var n = e.target; n && n !== ov; n = n.parentElement) if (n.scrollTop > 0) return;
    if (c === ov && c.scrollTop > 0) return;
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
    // A sheet with pages (Settings): down goes back one page, not out.
    if (S.ov._nfBack && S.ov._nfBack()) { haptic(); springBack(S.c); return; }
    if (S.ov._nfClose) {
      S.c.style.transition = 'transform .2s ease-in';
      S.c.style.transform = 'translateY(' + (S.c.offsetHeight + 40) + 'px)';
      haptic();
      setTimeout(function () { S.ov._nfClose(); S.c.style.transition = ''; S.c.style.transform = ''; }, 190);
      return;
    }
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

  // ── 4. Drawers ───────────────────────────────────────────────────────
  // A page section opened from a button becomes a bottom drawer over the
  // page (phones only, up to 700px). The section stays where it is in the
  // DOM; only its classes change. onClose is the page's own "back" (the
  // survival kit's skShowGrid), called by ✕, the backdrop and a swipe down.
  var drawerBack = null, openDrawer = null;
  function drawerAvailable() {
    try { return !!window.matchMedia && window.matchMedia('(max-width:700px)').matches; } catch (_) { return false; }
  }
  function drawerClose(el) {
    if (!el || !el.classList.contains('nf-drawer-on')) return;
    el.classList.remove('nf-drawer-on');
    if (el._nfTop && el._nfTop.parentNode === el) el.removeChild(el._nfTop);
    el._nfTop = null; el._nfClose = null;
    if (el._nfRole === null) el.removeAttribute('role'); else if (el._nfRole !== undefined) el.setAttribute('role', el._nfRole);
    el.removeAttribute('aria-modal');
    el.style.transform = ''; el.style.transition = '';
    if (openDrawer === el) {
      openDrawer = null;
      if (drawerBack && drawerBack.parentNode) drawerBack.parentNode.removeChild(drawerBack);
      html.classList.remove('nf-drawer-lock');
    }
  }
  function drawerOpen(el, onClose) {
    if (openDrawer && openDrawer !== el) drawerClose(openDrawer);
    if (!drawerBack) {
      drawerBack = document.createElement('div');
      drawerBack.id = 'nfDrawerBack';
      drawerBack.addEventListener('click', function () { if (openDrawer && openDrawer._nfClose) openDrawer._nfClose(); });
    }
    document.body.appendChild(drawerBack);
    openDrawer = el;
    el._nfClose = onClose || function () { drawerClose(el); };
    if (!el._nfTop) {
      var top = document.createElement('div');
      top.className = 'nf-drawer-top';
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'nf-drawer-x';
      x.textContent = '✕';
      x.setAttribute('aria-label', t('common.close', 'Close'));
      x.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); if (el._nfClose) el._nfClose(); });
      var grab = document.createElement('span');
      grab.className = 'nf-drawer-grab';
      grab.setAttribute('aria-hidden', 'true');
      top.appendChild(document.createElement('span'));
      top.appendChild(grab);
      top.appendChild(x);
      el.insertBefore(top, el.firstChild);
      el._nfTop = top;
    }
    el._nfRole = el.hasAttribute('role') ? el.getAttribute('role') : null;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.classList.add('nf-drawer-on');
    el.scrollTop = 0;
    html.classList.add('nf-drawer-lock');
    try { el._nfTop.firstChild.focus({ preventScroll: true }); } catch (_) {}
  }
  api.drawer = { available: drawerAvailable, open: drawerOpen, close: drawerClose };
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && openDrawer && openDrawer._nfClose && !anySheetOpen()) openDrawer._nfClose();
  });

  // Settings (journal): each "→" opens the next page as a new drawer that
  // slides up; going back drops the page in from above. A swipe down on a
  // page past the first presses its ← Back (_nfBack) instead of closing.
  var SET_DEPTH = { settingsMainPanel: 0, settingsMobilePanel: 1, settingsAchievementsPanel: 1, settingsAdvancedPanel: 2,
    settingsAdvancedJournalPanel: 3, settingsAdvancedMorePanel: 4, settingsAdvancedMore2Panel: 5 };
  function settingsPages() {
    var ov = document.getElementById('settingsModal'), host = document.getElementById('settingsContent');
    if (!ov || !host) return;
    var shown = function () {
      for (var id in SET_DEPTH) {
        var el = document.getElementById(id);
        if (el && el.style.display !== 'none') return id;
      }
      return null;
    };
    var cur = shown();
    new MutationObserver(function () {
      var id = shown();
      if (!id || id === cur) return;
      var fwd = SET_DEPTH[id] > (SET_DEPTH[cur] || 0);
      cur = id;
      if (!ov.classList.contains('active')) return;
      if (fwd) {
        // The whole sheet slides up again, like a new drawer opening.
        host.style.animation = 'none'; void host.offsetWidth; host.style.animation = '';
        haptic();
      } else {
        var el = document.getElementById(id);
        el.classList.remove('nf-back-in'); void el.offsetWidth; el.classList.add('nf-back-in');
      }
    }).observe(host, { attributes: true, attributeFilter: ['style'], subtree: true });
    ov._nfBack = function () {
      var id = shown();
      if (!id || !SET_DEPTH[id]) return false;
      var b = document.getElementById(id).querySelector('button[data-i18n="common.back"]');
      if (!b) return false;
      b.click();
      return true;
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', settingsPages); else settingsPages();

  // ── 5. Writing rides the keyboard ────────────────────────────────────
  // iOS lays the keyboard over the page, so a bottom sheet's text box and
  // Send button end up under it. While a text box in a sheet or drawer has
  // focus, the sheet sits on the keyboard (the visual viewport's bottom); a
  // textarea also makes it full height. Android resizes the page itself, so
  // there the gap is 0 and nothing changes.
  var vv = window.visualViewport, kbEl = null;
  var TYPING = 'textarea,[contenteditable="true"],input:not([type]),input[type="text"],input[type="search"],input[type="email"],input[type="tel"],input[type="url"],input[type="number"],input[type="password"]';
  function kbHost(el) {
    var ov = within(el, OPEN_SEL);
    if (ov) { var c = el; while (c && c.parentElement !== ov) c = c.parentElement; return c; }
    return within(el, '.nf-drawer-on');
  }
  function kbClear() {
    if (!kbEl) return;
    kbEl.classList.remove('nf-kb', 'nf-kb-full');
    kbEl.style.removeProperty('max-height'); kbEl.style.height = ''; kbEl.style.transform = '';
    kbEl = null;
  }
  function kbFit() {
    if (!kbEl || !vv) return;
    var gap = window.innerHeight - (vv.offsetTop + vv.height);
    if (gap < 60) { kbClear(); return; }
    var full = kbEl._nfFull;
    kbEl.classList.add('nf-kb');
    kbEl.classList.toggle('nf-kb-full', !!full);
    // !important: the sheet CSS caps max-height with !important.
    kbEl.style.setProperty('max-height', Math.max(160, vv.height - 8) + 'px', 'important');
    kbEl.style.height = full ? Math.max(160, vv.height - 8) + 'px' : '';
    kbEl.style.transform = 'translateY(' + (-gap) + 'px)';
    var f = document.activeElement;
    if (f && kbEl.contains(f)) { try { f.scrollIntoView({ block: 'nearest' }); } catch (_) {} }
  }
  api.kbFit = kbFit;
  document.addEventListener('focusin', function (e) {
    var el = e.target;
    if (!el || !el.matches || !el.matches(TYPING)) return;
    var h = kbHost(el);
    if (!h) return;
    if (kbEl && kbEl !== h) kbClear();
    kbEl = h;
    kbEl._nfFull = el.tagName === 'TEXTAREA' || !!el.isContentEditable;
    kbFit();
    setTimeout(kbFit, 120); setTimeout(kbFit, 400);
  }, true);
  document.addEventListener('focusout', function () {
    setTimeout(function () {
      var a = document.activeElement;
      if (kbEl && !(a && a.matches && a.matches(TYPING) && kbEl.contains(a))) kbClear();
    }, 150);
  }, true);
  if (vv) { vv.addEventListener('resize', kbFit); vv.addEventListener('scroll', kbFit); }

  // ── 6. Undo ──────────────────────────────────────────────────────────
  var pend = null, snackEl = null;
  function snackHide() { if (snackEl && snackEl.parentNode) snackEl.parentNode.removeChild(snackEl); }
  function snackShow(onUndo) {
    if (!snackEl) {
      snackEl = document.createElement('div');
      snackEl.className = 'nf-snack';
      snackEl.setAttribute('role', 'status');
    }
    snackEl.innerHTML = '';
    var sp = document.createElement('span');
    sp.textContent = t('common.deleted', 'Deleted');
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'nf-snack-undo';
    b.textContent = t('common.undo', 'Undo');
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); onUndo(); });
    snackEl.appendChild(sp); snackEl.appendChild(b);
    document.body.appendChild(snackEl);
  }
  function deferDelete(row, commit) {
    flushDelete();
    setRow(row, 0, false);
    if (row._nfL) row._nfL.classList.remove('nf-armed');
    if (openRow === row) openRow = null;
    row.classList.add('nf-gone');
    var P = pend = { row: row, commit: commit };
    P.timer = setTimeout(flushDelete, 5000);
    snackShow(function () {
      if (pend !== P) return;
      clearTimeout(P.timer);
      pend = null;
      row.classList.remove('nf-gone');
      snackHide();
      haptic();
    });
  }
  /** Carry out the delete waiting behind Undo, through the page's own path. */
  function flushDelete() {
    if (!pend) return;
    var P = pend; pend = null;
    clearTimeout(P.timer);
    snackHide();
    var oc = window.confirm;
    window.confirm = function () { return true; };
    try { P.commit(); } catch (e) { try { console.warn('[nf] delete', e); } catch (_) {} }
    finally { window.confirm = oc; }
    // The page redraws the list without it; if it is still there (the delete
    // failed, or this list doesn't redraw), show it again.
    setTimeout(function () { P.row.classList.remove('nf-gone'); }, 1500);
  }
  api.flushDelete = flushDelete;
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushDelete(); });
  window.addEventListener('pagehide', flushDelete);

  // ── Haptics on switches and tick boxes ───────────────────────────────
  document.addEventListener('change', function (e) {
    if (e.target && e.target.matches && e.target.matches('input[type="checkbox"],input[type="radio"]')) haptic();
  }, true);

  // ── Bipolar Bear's lists ─────────────────────────────────────────────
  // (Bipolar Anonymous registers its posts and replies in js/anonymous.js.)
  // Journal entries: the delete is the page's confirm sheet; Undo presses its
  // Delete unseen (.nf-silent) once the 5 s are up.
  api.rows({ row: '#entries .entry', open: '.edit-btn', del: '.delete-btn',
    undo: function (row, run) {
      var m = document.getElementById('confirmModal');
      if (!m || typeof window.confirmDelete !== 'function') { run(); return; }
      m.classList.add('nf-silent');
      run();
      Promise.resolve(window.confirmDelete()).then(function () { m.classList.remove('nf-silent'); }, function () { m.classList.remove('nf-silent'); });
    } });
  api.rows({ row: '#goalsList > div', open: 'button[onclick^="editGoal"]', del: 'button[onclick^="deleteGoal"]', undo: true });
  api.rows({ row: '#medInfoList > div', open: 'button[onclick^="editMedication"]', del: 'button[onclick^="deleteMedication"]', undo: true });
  api.rows({ row: '#gratitudeList > div', open: 'button[onclick^="editGratitudeItem"]', del: 'button[onclick^="deleteGratitudeItem"]', undo: true });
  api.rows({ row: '#survivalGoalsList > div', open: 'button[onclick^="editSurvivalGoal"]', del: 'button[onclick^="deleteSurvivalGoal"]', undo: true });
  api.rows({ row: '#memoriesList > div', open: 'button[onclick^="editMemory"]', del: 'button[onclick^="deleteMemory"]', undo: true });
  api.rows({ row: '#copingStrategiesList > div', open: 'button[onclick^="openEditCopingModal"]', del: 'button[onclick^="deleteCopingStrategy"]', undo: true });
  // Reminders: the header opens and closes the reminder, so a tap keeps doing that.
  api.rows({ row: '#customRemindersContainer .accordion > div:first-child', del: 'button[onclick^="deleteReminder"]', hide: 'button[onclick^="editReminder"]', undo: true,
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
  api.rows({ row: '.meds-cur', open: '.meds-edit', del: '.meds-rm', undo: true });
  api.rows({ row: '.meds-row', del: '.meds-del', undo: true });
  // My safety plan: no edit, so a swipe is the only way to remove an item.
  api.rows({ row: '.bbsp-list > li', del: '.bbsp-rm', undo: true });
})();
