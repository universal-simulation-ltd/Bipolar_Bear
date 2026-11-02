/**
 * @file js/shared/awareness.js — BB.awareness: awareness days on the home page
 * and the board (James, 2026-11-02: "a theme for the day (from -5 days with a
 * countdown)", World Bipolar Day and any others).
 *
 * From LEAD days before a day, a card counts down to it ("3 days to go",
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
 */
(function (root) {
  'use strict';
  var LEAD = 5;
  var HIDE_KEY = 'bbAwareHidden'; // JSON array of '<id>:<year>'

  var DAYS = [
    { id: 'wbd',  emoji: '🌻', month: 3,  day: 30, theme: true },
    { id: 'wmhd', emoji: '💚', month: 10, day: 10, theme: true },
    { id: 'ttt',  emoji: '💬', month: 2,  nth: 1, weekday: 4, region: 'GB', theme: false },
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
        if (left < 0 || left > LEAD) return;
        if (hidden.indexOf(d.id + ':' + y) !== -1) return;
        if (!best || left < best.daysLeft) best = { id: d.id, day: d, date: date, daysLeft: left, year: y };
      });
    });
    return best;
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { current: current, dateOf: dateOf, DAYS: DAYS, LEAD: LEAD };
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
  function currentHere() { return current(now(), { inRegion: inRegion, hidden: hiddenList() }); }

  var CSS =
    '.bbaw-card{position:relative;display:flex;gap:12px;align-items:flex-start;text-align:left;margin:0 0 14px;padding:12px 40px 12px 14px;' +
      'border-radius:16px;background:rgba(255,255,255,.94);color:#3b2a1a;box-shadow:0 4px 14px rgba(0,0,0,.12);font-size:.88em;line-height:1.4}' +
    '.bbaw-emoji{font-size:1.9em;line-height:1;flex:none}' +
    '.bbaw-when{display:inline-block;font-size:.78em;font-weight:800;letter-spacing:.03em;text-transform:uppercase;padding:2px 8px;border-radius:999px;background:#fff3bf;color:#7a4a00;margin-bottom:3px}' +
    '.bbaw-today .bbaw-when{background:#1f3c88;color:#fff}' +
    '.bbaw-name{font-weight:800;font-size:1.06em}' +
    '.bbaw-about{margin-top:2px;opacity:.85}' +
    '.bbaw-x{position:absolute;top:6px;right:6px;width:32px;height:32px;border:0;border-radius:50%;background:transparent;color:inherit;opacity:.55;font-size:1.05em;cursor:pointer}' +
    '.bbaw-x:focus-visible{outline:2px solid currentColor;opacity:1}' +
    'html.theme-dark .bbaw-card{background:#2a221b;color:#f3e9dc;box-shadow:none;border:1px solid #4a3d31}' +
    'html.theme-dark .bbaw-when{background:#3d2a12;color:#ffc078}' +
    'html.theme-dark .bbaw-today .bbaw-when{background:#364fc7;color:#fff}' +
    // The day's colours, on Bipolar Bear's home only (mountHome adds the class).
    // Light colours only: the home's brown greeting and see-through buttons
    // need a light background (a dark blue was tried and failed on both).
    'html.bb-aware-wbd:not(.theme-dark) body{background:linear-gradient(165deg,#ffe066 0%,#fcc419 40%,#f59f00 100%)}' +
    'html.bb-aware-wmhd:not(.theme-dark) body{background:linear-gradient(165deg,#d3f9d8 0%,#8ce99a 55%,#51cf66 100%)}' +
    // …and the day's emoji tucked on the logo's corner, light and dark.
    'html.bb-aware-day .logo-bounce-wrapper{position:relative}' +
    'html.bb-aware-day .logo-bounce-wrapper::after{content:attr(data-aware-emoji);position:absolute;right:-14px;top:-10px;font-size:40px;line-height:1;' +
      'transform:rotate(14deg);filter:drop-shadow(0 2px 3px rgba(0,0,0,.25));pointer-events:none}';
  function ensureCss() {
    if (document.getElementById('bbaw-css')) return;
    var s = document.createElement('style');
    s.id = 'bbaw-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function cardHtml(ev) {
    if (!ev) return '';
    var when = ev.daysLeft === 0 ? t('today') : ev.daysLeft === 1 ? t('tomorrow') : t('daysToGo', { n: ev.daysLeft });
    return '<div class="bbaw-card' + (ev.daysLeft === 0 ? ' bbaw-today' : '') + '" data-aware="' + esc(ev.id + ':' + ev.year) + '">' +
      '<div class="bbaw-emoji" aria-hidden="true">' + ev.day.emoji + '</div>' +
      '<div><span class="bbaw-when">' + esc(when) + '</span>' +
      '<div class="bbaw-name">' + esc(t(ev.id + 'Name')) + '</div>' +
      '<div class="bbaw-about">' + esc(t(ev.id + 'About')) + '</div></div>' +
      '<button type="button" class="bbaw-x" data-aware-hide aria-label="' + esc(t('hideAria')) + '">✕</button>' +
    '</div>';
  }

  function hide(key) {
    var list = hiddenList();
    if (list.indexOf(key) === -1) list.push(key);
    lsSet(HIDE_KEY, JSON.stringify(list.slice(-20)));
    clearTheme();
    document.querySelectorAll('.bbaw-card').forEach(function (el) { el.remove(); });
  }
  function clearTheme() {
    var cl = document.documentElement.classList;
    cl.remove('bb-aware-day');
    DAYS.forEach(function (d) { cl.remove('bb-aware-' + d.id); });
  }
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('[data-aware-hide]');
    if (!b) return;
    var card = b.closest('.bbaw-card');
    if (card) hide(card.getAttribute('data-aware'));
  });

  /** Bipolar Bear's home: the card in `slot`, and the day's colours on the day. */
  function mountHome(slot) {
    var ev = currentHere();
    clearTheme();
    if (!slot) return;
    if (!ev) { slot.innerHTML = ''; return; }
    ensureCss();
    slot.innerHTML = cardHtml(ev);
    if (ev.daysLeft === 0 && ev.day.theme) {
      document.documentElement.classList.add('bb-aware-day', 'bb-aware-' + ev.id);
      var logo = document.querySelector('.logo-bounce-wrapper');
      if (logo) logo.setAttribute('data-aware-emoji', ev.day.emoji);
    }
  }
  /** The board: the card's markup (empty when no day is near). */
  function boardHtml() {
    var ev = currentHere();
    if (!ev) return '';
    ensureCss();
    return cardHtml(ev);
  }

  BB.awareness = { current: currentHere, cardHtml: cardHtml, mountHome: mountHome, boardHtml: boardHtml, DAYS: DAYS };
})(typeof window !== 'undefined' ? window : this);
