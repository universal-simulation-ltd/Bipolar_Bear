/**
 * @file js/shared/awareness.js — BB.awareness: awareness days on the home page
 * and the board (James, 2026-11-02: "a theme for the day (from -5 days with a
 * countdown)", World Bipolar Day and any others).
 *
 * From LEAD days (or the day's own `lead`) before a day, a card counts down to it ("3 days to go",
 * "Tomorrow"); on the day itself the card says "Today" and, where the page
 * asks for it, <html> gets `bb-aware-day bb-aware-<id>` so the page wears the day's colours
 * (Bipolar Bear's home only; the board keeps its yellow). "Hide" hides the
 * card, and the colours, until the same day next year.
 *
 * The days (add one = one entry in DAYS, plus its name / about strings in
 * js/shared/i18n-awareness.js):
 *   wbd   World Bipolar Day, 30 March (Vincent van Gogh's birthday). Everywhere.
 *         There is no separate UK bipolar day: the UK marks this one.
 *   wmhd  World Mental Health Day, 10 October. Everywhere.
 *   ttt   Time to Talk Day, the first Thursday of February. UK only (a UK
 *         campaign): a device on Europe/London time or with an -GB language.
 * And the holidays (James, 2026-11-02: "themes for Christmas, Halloween etc"),
 * with gentle words, since holidays are hard for many people with bipolar:
 *   hal   Halloween, 31 October (🎃, lavender to pumpkin).
 *   xmas  Christmas Day, 25 December (🎄, snowy blue). A longer festive
 *         period (James, 2026-11-02: "from 5 December"): the countdown and the
 *         colours both run from 5 December.
 *         Its card also asks "Feeling lonely this Christmas?" (James,
 *         2026-11-02) with two buttons: someone to talk to (the 🆘 sheet on
 *         the home page, the 🛟 Help sheet on the board, both with the lines
 *         for the phone's country) and Bipolar Anonymous (on the board itself:
 *         write a post).
 *   ny    New Year's Day, 1 January (🎉, champagne gold). Its countdown starts
 *         on 26 December, the day after Christmas Day.
 * A day can set its own `lead` (countdown days, default LEAD) and
 * `themeEarly: true` (wear the colours for the whole countdown, not just on
 * the day).
 * Left out on purpose: World Suicide Prevention Day (10 Sept), since a
 * countdown and party colours are wrong for it; and Mental Health Awareness
 * Week, whose dates move each year.
 *
 *   BB.awareness.current(now?)   → { id, day, date, daysLeft, year } or null
 *   BB.awareness.cardHtml(ev, { page: 'home' | 'board' })  the card's markup
 *   BB.awareness.mountHome(slot) Bipolar Bear's home: card in `slot` + theme
 *   BB.awareness.boardHtml()     the board: card markup for the top of General
 *
 * Testing: localStorage.bbAwareToday = '2027-03-27' (or ?awareDate=2027-03-27
 * on the page) pretends it is that date; `node scripts/test-awareness.mjs`.
 *
 * Admin preview (James, 2026-11-02: "an option (linked to my account only) to
 * view the theme for each event"): BB.awareness.openPreview() shows a sheet
 * with every day and three buttons each (first countdown day / Tomorrow /
 * Today). It stores `bbAwarePreview` = {id, left, until}, which beats the
 * real date, the region rule and the ✕ list, on the home page and the board,
 * for 24 hours or until "Back to today". The card shows a "Preview" pill;
 * dismissing it hides the card for the preview only (never the real day).
 * Only the admin's account sees the button (js/index.js, `_isAwareAdmin`).
 *
 * Reminders without the card (James, 2026-11-02: "allow the user to swipe the
 * notification away … lots of flower emojis coming out of the bottom bar so
 * you're reminded of the day even without the notification card"):
 *   - the card swipes away sideways (or ✕). That hides the CARD only, until
 *     next year; the colours, the logo emoji and the burst stay.
 *   - the day's emoji sits on the logo's corner for the whole countdown, not
 *     just on the day.
 *   - on the day (and through a themeEarly period) a burst of the day's emoji
 *     floats up from the bottom bar when the home opens, at most once every
 *     5 minutes (sessionStorage), never with reduced motion.
 */
(function (root) {
  'use strict';
  var LEAD = 5;
  var HIDE_KEY = 'bbAwareHidden'; // JSON array of '<id>:<year>'
  var PREVIEW_KEY = 'bbAwarePreview'; // admin only: {id, left, until}
  var PREVIEW_MS = 24 * 3600 * 1000;
  var BURST_KEY = 'bbAwareBurstAt'; // sessionStorage: last burst time
  var BURST_GAP = 5 * 60 * 1000;

  var DAYS = [
    { id: 'wbd',  emoji: '🌻', month: 3,  day: 30, theme: true },
    { id: 'wmhd', emoji: '💚', month: 10, day: 10, theme: true },
    { id: 'ttt',  emoji: '💬', month: 2,  nth: 1, weekday: 4, region: 'GB', theme: false },
    { id: 'hal',  emoji: '🎃', month: 10, day: 31, theme: true },
    { id: 'xmas', emoji: '🎄', month: 12, day: 25, theme: true, lead: 20, themeEarly: true, lonely: true },
    { id: 'ny',   emoji: '🎉', month: 1,  day: 1,  theme: true, lead: 6 },
  ];

  /** Local midnight of the rule's date in `year`. */
  function dateOf(d, year) {
    if (d.nth) {
      var first = new Date(year, d.month - 1, 1);
      var offset = (d.weekday - first.getDay() + 7) % 7;
      return new Date(year, d.month - 1, 1 + offset + (d.nth - 1) * 7);
    }
    return new Date(year, d.month - 1, d.day);
  }
  function midnight(t) { return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
  function daysBetween(a, b) { return Math.round((b - a) / 86400000); }

  /** The day showing on `now` (a countdown day or the day itself), or null. */
  function current(now, opts) {
    opts = opts || {};
    var today = midnight(now || new Date());
    var inRegion = opts.inRegion || function () { return true; };
    var hidden = opts.hidden || [];
    var best = null;
    DAYS.forEach(function (d) {
      if (d.region && !inRegion(d.region)) return;
      [today.getFullYear(), today.getFullYear() + 1].forEach(function (y) {
        var date = dateOf(d, y);
        var left = daysBetween(today, date);
        if (left < 0 || left > (d.lead || LEAD)) return;
        if (hidden.indexOf(d.id + ':' + y) !== -1) return;
        if (!best || left < best.daysLeft) best = { id: d.id, day: d, date: date, daysLeft: left, year: y };
      });
    });
    return best;
  }

  /** Whether the page wears the day's colours today. */
  function themed(ev) { return !!(ev && ev.day.theme && (ev.daysLeft === 0 || ev.day.themeEarly)); }

  if (typeof module === 'object' && module.exports) {
    module.exports = { current: current, dateOf: dateOf, DAYS: DAYS, LEAD: LEAD, themed: themed };
    return;
  }

  var BB = root.BB = root.BB || {};
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function t(key, vars) { return (BB.t ? BB.t('aware.' + key, vars) : key); }

  function hiddenList() {
    try { var a = JSON.parse(lsGet(HIDE_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; }
  }
  function inRegion(region) {
    if (region !== 'GB') return false;
    try { if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'Europe/London') return true; } catch (_) {}
    var langs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || ''];
    return langs.some(function (l) { return /-GB$/i.test(l || ''); });
  }
  /** Today, or the test date from ?awareDate= / localStorage.bbAwareToday. */
  function now() {
    var m = /[?&]awareDate=(\d{4}-\d\d-\d\d)/.exec(location.search || '');
    var s = (m && m[1]) || lsGet('bbAwareToday');
    if (s && /^\d{4}-\d\d-\d\d$/.test(s)) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
    return new Date();
  }
  /** The admin's preview, if one is set and not yet expired: { id, left }. */
  function previewGet() {
    try {
      var p = JSON.parse(lsGet(PREVIEW_KEY) || 'null');
      if (!p || !(p.until > Date.now())) return null;
      for (var i = 0; i < DAYS.length; i++) if (DAYS[i].id === p.id) return { id: p.id, left: Math.max(0, +p.left || 0), day: DAYS[i], cardHidden: !!p.cardHidden, until: p.until };
    } catch (_) {}
    return null;
  }
  function previewSet(id, left) { lsSet(PREVIEW_KEY, JSON.stringify({ id: id, left: left, until: Date.now() + PREVIEW_MS })); }
  function previewHideCard() {
    var p = previewGet();
    if (p) lsSet(PREVIEW_KEY, JSON.stringify({ id: p.id, left: p.left, until: p.until, cardHidden: true }));
  }
  function previewClear() { try { localStorage.removeItem(PREVIEW_KEY); } catch (_) {} }
  function currentHere() {
    var p = previewGet();
    if (p) {
      var today = midnight(new Date());
      var date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + p.left);
      return { id: p.id, day: p.day, date: date, daysLeft: p.left, year: date.getFullYear(), preview: true, cardHidden: p.cardHidden };
    }
    // The ✕ list no longer hides the day itself, only its card (cardHidden).
    var ev = current(now(), { inRegion: inRegion });
    if (ev) ev.cardHidden = hiddenList().indexOf(ev.id + ':' + ev.year) !== -1;
    return ev;
  }

  // Halloween's decorations (James, 2026-11-02: "a bigger theme like xmas
  // [snow], maybe some pumpkins or spider web"): a spider web in each top
  // corner and a loose scatter of pumpkins and bats, as SVG layers over the
  // gradient (the snow's approach).
  function svgUrl(svg) { return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")'; }
  function webSvg(flip) {
    var R = 150, spokes = 7, rings = [26, 52, 80, 110, 142], parts = [];
    var ang = function (k) { return (Math.PI / 2) * k / (spokes - 1); };
    for (var k = 0; k < spokes; k++) parts.push('M0 0L' + (R * Math.cos(ang(k))).toFixed(1) + ' ' + (R * Math.sin(ang(k))).toFixed(1));
    rings.forEach(function (r) {
      var d = '';
      for (var k = 0; k < spokes; k++) {
        var x = r * Math.cos(ang(k)), y = r * Math.sin(ang(k));
        if (!k) { d += 'M' + x.toFixed(1) + ' ' + y.toFixed(1); continue; }
        var m = (ang(k) + ang(k - 1)) / 2, rs = r * 0.86; // each thread sags towards the centre
        d += 'Q' + (rs * Math.cos(m)).toFixed(1) + ' ' + (rs * Math.sin(m)).toFixed(1) + ' ' + x.toFixed(1) + ' ' + y.toFixed(1);
      }
      parts.push(d);
    });
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + R + '" height="' + R + '" viewBox="0 0 ' + R + ' ' + R + '">' +
      '<g' + (flip ? ' transform="translate(' + R + ' 0) scale(-1 1)"' : '') + ' fill="none" stroke="rgba(60,30,70,.55)" stroke-width="1.3" stroke-linecap="round">' +
      '<path d="' + parts.join('') + '"/></g>' +
      // and a little spider hanging off it
      (flip ? '' : '<line x1="96" y1="58" x2="96" y2="92" stroke="rgba(60,30,70,.6)" stroke-width="1"/><text x="96" y="104" font-size="16" text-anchor="middle">🕷️</text>') +
      '</svg>';
  }
  var HAL_SCATTER = '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="260" viewBox="0 0 220 260" opacity=".55">' +
    '<text x="30" y="70" font-size="26">🎃</text><text x="150" y="40" font-size="18">🦇</text>' +
    '<text x="140" y="170" font-size="22">🎃</text><text x="40" y="215" font-size="16">🦇</text></svg>';

  var CSS =
    '.bbaw-card{position:relative;display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;text-align:left;margin:0 0 14px;padding:12px 40px 12px 14px;' +
      'border-radius:16px;background:rgba(255,255,255,.94);color:#3b2a1a;box-shadow:0 4px 14px rgba(0,0,0,.12);font-size:.88em;line-height:1.4}' +
    '.bbaw-emoji{font-size:1.9em;line-height:1;flex:none}' +
    '.bbaw-emoji+div{flex:1;min-width:0}' +
    '.bbaw-when{display:inline-block;font-size:.78em;font-weight:800;letter-spacing:.03em;text-transform:uppercase;padding:2px 8px;border-radius:999px;background:#fff3bf;color:#7a4a00;margin-bottom:3px}' +
    '.bbaw-today .bbaw-when{background:#1f3c88;color:#fff}' +
    '.bbaw-name{font-weight:800;font-size:1.06em}' +
    '.bbaw-about{margin-top:2px;opacity:.85}' +
    '.bbaw-x{position:absolute;top:6px;right:6px;width:32px;height:32px;border:0;border-radius:50%;background:transparent;color:inherit;opacity:.55;font-size:1.05em;cursor:pointer}' +
    '.bbaw-lonely{flex-basis:100%;margin:-2px -26px 0 0;padding-top:9px;border-top:1px solid rgba(0,0,0,.08);text-align:center}' +
    '.bbaw-lonely-q{font-weight:700}' +
    '.bbaw-lonely-btns{display:flex;gap:8px;margin-top:7px}' +
    '.bbaw-btn{flex:1 1 0;min-width:0;min-height:40px;padding:8px 8px;line-height:1.25;border-radius:999px;border:1px solid #d9c7b0;background:#fff8ef;color:#3b2a1a;font:inherit;font-weight:700;font-size:.92em;cursor:pointer}' +
    '.bbaw-btn:focus-visible{outline:2px solid currentColor}' +
    'html.theme-dark .bbaw-lonely{border-top-color:#4a3d31}' +
    'html.theme-dark .bbaw-btn{background:#3a2e24;border-color:#5a4a3b;color:#f3e9dc}' +
    '.bbaw-x:focus-visible{outline:2px solid currentColor;opacity:1}' +
    '.bbaw-card{touch-action:pan-y;-webkit-user-select:none;user-select:none}' +
    '.bbaw-burst{position:fixed;z-index:9990;pointer-events:none;font-size:30px;line-height:1;will-change:transform,opacity}' +
    '.bbaw-prev{display:inline-block;margin-left:6px;font-size:.78em;font-weight:800;padding:2px 8px;border-radius:999px;background:#e03131;color:#fff}' +
    // The admin's preview sheet.
    '.bbaw-sheet-bg{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center}' +
    '.bbaw-sheet{width:100%;max-width:480px;max-height:85vh;overflow:auto;box-sizing:border-box;padding:18px 16px calc(18px + env(safe-area-inset-bottom));border-radius:18px 18px 0 0;background:#fff;color:#3b2a1a;font-size:15px}' +
    '.bbaw-sheet h3{margin:0 0 4px;text-align:center}' +
    '.bbaw-sheet-note{margin:0 0 12px;text-align:center;font-size:.82em;opacity:.75}' +
    '.bbaw-row{padding:10px 0;border-top:1px solid rgba(0,0,0,.08)}' +
    '.bbaw-row-name{font-weight:700;margin-bottom:6px}' +
    '.bbaw-row-btns{display:flex;gap:6px}' +
    '.bbaw-row-btns .bbaw-btn{font-size:.82em;min-height:38px}' +
    '.bbaw-row-btns .bbaw-btn.on{background:#1f3c88;border-color:#1f3c88;color:#fff}' +
    '.bbaw-sheet-foot{display:flex;gap:8px;margin-top:12px}' +
    'html.theme-dark .bbaw-sheet{background:#2a221b;color:#f3e9dc}' +
    'html.theme-dark .bbaw-row{border-top-color:#4a3d31}' +
    'html.theme-dark .bbaw-card{background:#2a221b;color:#f3e9dc;box-shadow:none;border:1px solid #4a3d31}' +
    'html.theme-dark .bbaw-when{background:#3d2a12;color:#ffc078}' +
    'html.theme-dark .bbaw-today .bbaw-when{background:#364fc7;color:#fff}' +
    // The day's colours, on Bipolar Bear's home only (mountHome adds the class).
    // Light colours only: the home's brown greeting and see-through buttons
    // need a light background (a dark blue was tried and failed on both).
    'html.bb-aware-wbd:not(.theme-dark) body{background:linear-gradient(165deg,#ffe066 0%,#fcc419 40%,#f59f00 100%)}' +
    'html.bb-aware-wmhd:not(.theme-dark) body{background:linear-gradient(165deg,#d3f9d8 0%,#8ce99a 55%,#51cf66 100%)}' +
    'html.bb-aware-hal:not(.theme-dark) body{background:' +
      svgUrl(webSvg(false)) + ' 0 0/150px 150px no-repeat,' +
      svgUrl(webSvg(true)) + ' 100% 0/150px 150px no-repeat,' +
      svgUrl(HAL_SCATTER) + ' 0 0/220px 260px,' +
      'linear-gradient(165deg,#eebefa 0%,#ffc078 55%,#ff922b 100%)}' +
    // Snow and sparkle: two repeating layers of dots over the gradient.
    'html.bb-aware-xmas:not(.theme-dark) body{background:' +
      'radial-gradient(circle at 20% 30%,rgba(255,255,255,.95) 0 3px,transparent 4px) 0 0/120px 140px,' +
      'radial-gradient(circle at 70% 70%,rgba(255,255,255,.85) 0 2px,transparent 3px) 0 0/90px 110px,' +
      'linear-gradient(165deg,#e7f5ff 0%,#a5d8ff 60%,#74c0fc 100%)}' +
    'html.bb-aware-ny:not(.theme-dark) body{background:' +
      'radial-gradient(circle at 25% 20%,rgba(255,255,255,.95) 0 2.5px,transparent 3.5px) 0 0/130px 150px,' +
      'radial-gradient(circle at 75% 65%,rgba(255,255,255,.8) 0 1.5px,transparent 2.5px) 0 0/85px 105px,' +
      'linear-gradient(165deg,#fff9db 0%,#ffe066 55%,#fab005 100%)}' +
    // …and the day's emoji tucked on the logo's corner, light and dark.
    'html.bb-aware-near .logo-bounce-wrapper{position:relative}' +
    'html.bb-aware-near .logo-bounce-wrapper::after{content:attr(data-aware-emoji);position:absolute;right:-14px;top:-10px;font-size:40px;line-height:1;' +
      'transform:rotate(14deg);filter:drop-shadow(0 2px 3px rgba(0,0,0,.25));pointer-events:none}';
  function ensureCss() {
    if (document.getElementById('bbaw-css')) return;
    var s = document.createElement('style');
    s.id = 'bbaw-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /** "Feeling lonely this Christmas?" and its two buttons. */
  function lonelyHtml(page) {
    return '<div class="bbaw-lonely"><div class="bbaw-lonely-q">' + esc(t('lonelyQ')) + '</div>' +
      '<div class="bbaw-lonely-btns">' +
        '<button type="button" class="bbaw-btn" data-aware-go="help">' + esc(t('lonelyHelp')) + '</button>' +
        '<button type="button" class="bbaw-btn" data-aware-go="anon">' + esc(t(page === 'board' ? 'lonelyPost' : 'lonelyAnon')) + '</button>' +
      '</div></div>';
  }

  function cardHtml(ev, opts) {
    if (!ev) return '';
    var page = (opts && opts.page) || 'home';
    var when = ev.daysLeft === 0 ? t('today') : ev.daysLeft === 1 ? t('tomorrow') : t('daysToGo', { n: ev.daysLeft });
    return '<div class="bbaw-card' + (ev.daysLeft === 0 ? ' bbaw-today' : '') + '" data-aware="' + esc(ev.id + ':' + ev.year) + '">' +
      '<div class="bbaw-emoji" aria-hidden="true">' + ev.day.emoji + '</div>' +
      '<div><span class="bbaw-when">' + esc(when) + '</span>' +
      (ev.preview ? '<span class="bbaw-prev">Preview</span>' : '') +
      '<div class="bbaw-name">' + esc(t(ev.id + 'Name')) + '</div>' +
      '<div class="bbaw-about">' + esc(t(ev.id + 'About')) + '</div></div>' +
      (ev.day.lonely ? lonelyHtml(page) : '') +
      '<button type="button" class="bbaw-x" data-aware-hide aria-label="' + esc(t('hideAria')) + '">✕</button>' +
    '</div>';
  }

  /** Hide the card (only the card: the colours, logo emoji and burst stay). */
  function hide(key) {
    if (previewGet()) previewHideCard();
    else {
      var list = hiddenList();
      if (list.indexOf(key) === -1) list.push(key);
      lsSet(HIDE_KEY, JSON.stringify(list.slice(-20)));
    }
    document.querySelectorAll('.bbaw-card').forEach(function (el) { el.remove(); });
  }
  function clearTheme() {
    var cl = document.documentElement.classList;
    cl.remove('bb-aware-day', 'bb-aware-near');
    DAYS.forEach(function (d) { cl.remove('bb-aware-' + d.id); });
  }
  /** The lonely buttons: help → the crisis sheet; anon → the board (or, on it, a new post). */
  function go(where) {
    function tap(id) { var el = document.getElementById(id); if (el) { el.click(); return true; } return false; }
    if (where === 'help') {
      if (tap('board-help-btn')) return;
      if (typeof window.openChatModal === 'function') window.openChatModal();
      return;
    }
    if (tap('fab-compose')) return;
    if (tap('anonymousBtn')) return;
    location.href = 'anonymous.html';
  }
  document.addEventListener('click', function (e) {
    var g = e.target && e.target.closest && e.target.closest('[data-aware-go]');
    if (g) { go(g.getAttribute('data-aware-go')); return; }
    var b = e.target && e.target.closest && e.target.closest('[data-aware-hide]');
    if (!b) return;
    var card = b.closest('.bbaw-card');
    if (card) hide(card.getAttribute('data-aware'));
  });

  // Swipe the card away sideways (touch or mouse). Vertical scrolling is left
  // to the page (touch-action: pan-y); past a third of its width, or a flick,
  // it slides off and hides like ✕; otherwise it springs back.
  var drag = null;
  document.addEventListener('pointerdown', function (e) {
    var card = e.target && e.target.closest && e.target.closest('.bbaw-card');
    if (!card || (e.target.closest('button'))) return;
    drag = { card: card, x: e.clientX, y: e.clientY, t: Date.now(), dx: 0, on: false, id: e.pointerId };
  });
  document.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.on) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
      if (Math.abs(dx) < 8) return;
      drag.on = true;
      drag.card.style.transition = 'none';
      try { drag.card.setPointerCapture(e.pointerId); } catch (_) {}
    }
    drag.dx = dx;
    drag.card.style.transform = 'translateX(' + dx + 'px)';
    drag.card.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / (drag.card.offsetWidth || 300)));
  });
  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    var d = drag; drag = null;
    if (!d.on) return;
    var w = d.card.offsetWidth || 300;
    var fast = Math.abs(d.dx) / Math.max(1, Date.now() - d.t) > 0.8;
    d.card.style.transition = 'transform .22s ease-out, opacity .22s ease-out';
    if (Math.abs(d.dx) > w / 3 || (fast && Math.abs(d.dx) > 60)) {
      d.card.style.transform = 'translateX(' + (d.dx > 0 ? w * 1.2 : -w * 1.2) + 'px)';
      d.card.style.opacity = '0';
      var key = d.card.getAttribute('data-aware');
      setTimeout(function () { hide(key); }, 220);
    } else {
      d.card.style.transform = '';
      d.card.style.opacity = '';
    }
  }
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);

  /** The day's emoji floating up from the bottom bar (on the day / a themed period). */
  function burst(emoji, force) {
    try { if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch (_) {}
    if (!force) {
      var last = 0;
      try { last = +sessionStorage.getItem(BURST_KEY) || 0; } catch (_) {}
      if (Date.now() - last < BURST_GAP) return;
    }
    try { sessionStorage.setItem(BURST_KEY, String(Date.now())); } catch (_) {}
    var bar = document.querySelector('.fab-footer');
    var r = bar && bar.getBoundingClientRect();
    var vw = window.innerWidth, vh = window.innerHeight;
    var left = r && r.width ? r.left : 0, width = r && r.width ? r.width : vw;
    var top = r && r.height ? r.top + r.height / 2 : vh - 40;
    var N = 18;
    for (var i = 0; i < N; i++) (function (i) {
      var el = document.createElement('div');
      el.className = 'bbaw-burst';
      el.setAttribute('aria-hidden', 'true');
      el.textContent = emoji;
      var x = left + width * (0.06 + 0.88 * Math.random());
      var size = 22 + Math.random() * 18;
      el.style.left = (x - size / 2) + 'px';
      el.style.top = (top - size / 2) + 'px';
      el.style.fontSize = size + 'px';
      el.style.opacity = '0';
      document.body.appendChild(el);
      var rise = vh * (0.35 + Math.random() * 0.35);
      var drift = (Math.random() - 0.5) * 120;
      var spin = (Math.random() - 0.5) * 120;
      var dur = 2600 + Math.random() * 1400;
      var delay = i * 70 + Math.random() * 300;
      if (!el.animate) { el.remove(); return; }
      var a = el.animate([
        { transform: 'translate(0,0) scale(.6) rotate(0deg)', opacity: 0 },
        { transform: 'translate(' + drift * 0.3 + 'px,' + (-rise * 0.2) + 'px) scale(1) rotate(' + spin * 0.3 + 'deg)', opacity: 1, offset: 0.15 },
        { transform: 'translate(' + drift + 'px,' + (-rise) + 'px) scale(.9) rotate(' + spin + 'deg)', opacity: 0 }
      ], { duration: dur, delay: delay, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'both' });
      a.onfinish = function () { el.remove(); };
    })(i);
  }

  /** Bipolar Bear's home: the card in `slot`, the emoji on the logo, and the
   *  day's colours + the burst on the day (or through a themeEarly period). */
  function mountHome(slot, opts) {
    var ev = currentHere();
    clearTheme();
    if (!slot) return;
    if (!ev) { slot.innerHTML = ''; return; }
    ensureCss();
    slot.innerHTML = ev.cardHidden ? '' : cardHtml(ev);
    document.documentElement.classList.add('bb-aware-near');
    var logo = document.querySelector('.logo-bounce-wrapper');
    if (logo) logo.setAttribute('data-aware-emoji', ev.day.emoji);
    if (themed(ev)) document.documentElement.classList.add('bb-aware-day', 'bb-aware-' + ev.id);
    if ((themed(ev) || ev.daysLeft === 0) && !(opts && opts.quiet)) {
      // After the page settles, so the bar is in place.
      setTimeout(function () { if (!document.hidden) burst(ev.day.emoji, opts && opts.force); }, 600);
    }
  }
  /** The board: the card's markup (empty when no day is near). */
  function boardHtml() {
    var ev = currentHere();
    if (!ev || ev.cardHidden) return '';
    ensureCss();
    return cardHtml(ev, { page: 'board' });
  }

  /** Show the current state again: the home's slot, or (the board) a reload. */
  function refresh() {
    var slot = document.getElementById('awarenessSlot');
    if (slot) { mountHome(slot, { force: true }); return; }
    document.querySelectorAll('.bbaw-card').forEach(function (el) { el.remove(); });
    if (document.getElementById('fab-compose')) location.reload();
  }

  /** The admin's sheet: every day, each as its first countdown day, Tomorrow and Today. */
  function openPreview() {
    ensureCss();
    var old = document.getElementById('bbaw-sheet');
    if (old) old.remove();
    var p = previewGet();
    var bg = document.createElement('div');
    bg.id = 'bbaw-sheet';
    bg.className = 'bbaw-sheet-bg';
    function btn(id, left, label) {
      var on = p && p.id === id && p.left === left;
      return '<button type="button" class="bbaw-btn' + (on ? ' on' : '') + '" data-prev-id="' + esc(id) + '" data-prev-left="' + left + '">' + esc(label) + '</button>';
    }
    var rows = DAYS.map(function (d) {
      var lead = d.lead || LEAD;
      var date = dateOf(d, new Date().getFullYear());
      var dateStr = '';
      try { dateStr = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); } catch (_) {}
      var tags = [];
      if (d.region) tags.push(d.region + ' only');
      if (!d.theme) tags.push('card only, no colours');
      if (d.themeEarly) tags.push('colours all countdown');
      return '<div class="bbaw-row"><div class="bbaw-row-name">' + d.emoji + ' ' + esc(t(d.id + 'Name')) +
        ' <span style="font-weight:400;opacity:.7">· ' + esc(dateStr) + (tags.length ? ' · ' + esc(tags.join(', ')) : '') + '</span></div>' +
        '<div class="bbaw-row-btns">' + btn(d.id, lead, lead + ' days before') + btn(d.id, 1, 'Tomorrow') + btn(d.id, 0, 'On the day') + '</div></div>';
    }).join('');
    var dark = document.documentElement.classList.contains('theme-dark');
    bg.innerHTML = '<div class="bbaw-sheet" role="dialog" aria-modal="true" aria-label="Preview event themes">' +
      '<h3>🎨 Preview event themes</h3>' +
      '<p class="bbaw-sheet-note">Admin only. Shows on this phone for 24 hours (home and board), or until Back to today. Swiping the card away hides it for the preview only.' +
        (dark ? ' <strong>Dark mode is on: the colours only show in light mode.</strong>' : '') + '</p>' +
      rows +
      '<div class="bbaw-sheet-foot">' +
        '<button type="button" class="bbaw-btn" data-prev-clear>↩︎ Back to today</button>' +
        '<button type="button" class="bbaw-btn" data-prev-close>Close</button>' +
      '</div></div>';
    bg.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button');
      if (e.target === bg || (b && b.hasAttribute('data-prev-close'))) { bg.remove(); return; }
      if (!b) return;
      if (b.hasAttribute('data-prev-clear')) { previewClear(); bg.remove(); refresh(); return; }
      if (b.hasAttribute('data-prev-id')) {
        previewSet(b.getAttribute('data-prev-id'), +b.getAttribute('data-prev-left'));
        bg.remove();
        refresh();
        // Bring the card into view so the change is seen at once.
        var c = document.querySelector('.bbaw-card');
        if (c && c.scrollIntoView) c.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });
    document.body.appendChild(bg);
  }

  BB.awareness = { current: currentHere, cardHtml: cardHtml, mountHome: mountHome, boardHtml: boardHtml, DAYS: DAYS, burst: burst,
    openPreview: openPreview, clearPreview: function () { previewClear(); refresh(); } };
})(typeof window !== 'undefined' ? window : this);
