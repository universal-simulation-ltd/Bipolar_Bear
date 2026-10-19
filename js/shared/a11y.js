/**
 * Accessibility helpers shared by every page (window.BB.a11y).
 *
 * Loaded synchronously in <head>, straight after js/shared/platform.js (it
 * reads html.is-ios) and js/shared/i18n.js. Four jobs, all generic so the
 * page scripts don't each need their own copy:
 *
 * 1. Larger Text (iOS Dynamic Type). WKWebView doesn't scale web text with
 *    the system text size on its own; it only exposes it through the
 *    `-apple-system-body` font keyword (17px at the default size, up to 53px
 *    at the largest accessibility size). The pages size their text in em off
 *    the root, so we read that keyword's size once and set the root font to
 *    16px × (size ÷ 17): exactly 16px — today's look — at the default size,
 *    and proportionally bigger (or smaller) when the person has changed it.
 *    Re-read when the app comes back to the front, since the setting can
 *    change while it's in the background. Native iOS only; browsers and
 *    Android keep their own text-zoom.
 *
 * 2. Clickable things that aren't buttons. Markup with onclick on a <div> or
 *    <span> gets role="button" and tabindex="0", and Enter / Space activate
 *    it, so VoiceOver, Voice Control and a keyboard can all reach it. Skipped
 *    for backdrops (`if(event.target===this)…`) and for anything wrapping
 *    real controls of its own.
 *
 * 3. Dialogs. Every page has its own modal patterns (.confirm-modal.active,
 *    .overlay:not(.hidden), .bb-fab-modal.open, display:flex overlays …).
 *    Rather than touch each opener, a MutationObserver watches the known
 *    dialog containers; when one appears it gets role="dialog" +
 *    aria-modal="true" + a label from its heading, focus moves to that
 *    heading (VoiceOver reads it), Tab is kept inside, Escape closes it the
 *    way a backdrop tap would, and focus returns to whatever opened it when
 *    it closes.
 *
 * 4. Reduced motion: BB.a11y.reducedMotion() for script-driven animation
 *    (confetti, smooth scrolling, wheel momentum). The CSS side lives in
 *    css/theme.css.
 *
 * Also BB.a11y.announce(text) — speaks a short status through a polite live
 * region (e.g. "Saved").
 *
 * @file js/shared/a11y.js
 */
(function () {
  'use strict';
  var root = window.BB = window.BB || {};
  var html = document.documentElement;

  // ── 1. Dynamic Type ────────────────────────────────────────────────────────
  function applyDynamicType() {
    if (!html.classList.contains('is-ios')) return;
    // An iPad app running on a Mac reports the desktop body size (13px), not a
    // Dynamic Type choice; only touch devices follow it.
    if (!(navigator.maxTouchPoints > 0)) return;
    try {
      // Only WebKit knows the keyword; anywhere else keep the default size.
      if (!(window.CSS && CSS.supports && CSS.supports('font', '-apple-system-body'))) return;
      var prev = html.style.font;
      html.style.fontSize = '';
      html.style.font = '-apple-system-body';
      var px = parseFloat(getComputedStyle(html).fontSize);
      html.style.font = prev;
      if (!px || !isFinite(px)) return;
      // 17px is the system body size at the default setting ("Large").
      var scale = Math.max(0.82, Math.min(px / 17, 3.2));
      html.style.fontSize = (16 * scale).toFixed(2) + 'px';
      html.classList.toggle('bb-text-large', scale >= 1.3);
      html.classList.toggle('bb-text-xlarge', scale >= 1.8);
      root.a11y && (root.a11y.textScale = scale);
    } catch (_) { /* keep the default size */ }
  }

  function reducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) { return false; }
  }

  function tr(key, fallback) {
    try { if (root.t) { var v = root.t(key); if (v && v !== key) return v; } } catch (_) {}
    return fallback;
  }

  // ── 4. Live announcements ─────────────────────────────────────────────────
  var live = null;
  function announce(text) {
    if (!text) return;
    if (!live) {
      live = document.createElement('div');
      live.className = 'sr-only';
      live.setAttribute('aria-live', 'polite');
      live.setAttribute('role', 'status');
      (document.body || html).appendChild(live);
    }
    live.textContent = '';
    setTimeout(function () { live.textContent = String(text); }, 60);
  }

  root.a11y = {
    reducedMotion: reducedMotion,
    announce: announce,
    applyDynamicType: applyDynamicType,
    textScale: 1,
    // Dialog containers handled automatically (see 3 above). Pages may add more.
    dialogSelector: [
      '.confirm-modal', '.overlay-modal', '.bb-fab-modal', '.bb-feedback-modal',
      '.bb-auth-overlay', '.bb-account-overlay', '.wa-modal', '.steps-modal',
      '#guestPinOverlay', '#pinOverlay', '#guestPinSetupOverlay', '#pinE2eeModal',
      '#bbWelcomeModal', '#bbLangPicker', '.overlay', '.bbm-back', '#bbPinReauth',
      '#bbJournalKeyOverlay', '#tutorialCompleteModal', '#skWelcomeModal', '[data-a11y-dialog]'
    ].join(','),
    // Lock screens and must-answer prompts: never closed by Escape.
    lockSelector: '#guestPinOverlay, #pinOverlay, #guestPinSetupOverlay, #bbLangPicker, #bbPinReauth, #bbJournalKeyOverlay, [data-a11y-noescape]'
  };

  // Reduce Motion: the scripts ask for smooth scrolling in ~30 places
  // (scrollTo / scrollIntoView with behavior:'smooth'). Rather than touch each
  // one, smooth becomes an instant jump while the setting is on.
  (function () {
    function plain(o) {
      if (o && typeof o === 'object' && o.behavior === 'smooth' && reducedMotion()) {
        var c = {}; for (var k in o) c[k] = o[k]; c.behavior = 'auto'; return c;
      }
      return o;
    }
    function wrap(obj, name) {
      var orig = obj && obj[name];
      if (typeof orig !== 'function') return;
      obj[name] = function (a) {
        if (arguments.length === 1) return orig.call(this, plain(a));
        return orig.apply(this, arguments);
      };
    }
    try {
      wrap(window, 'scrollTo'); wrap(window, 'scrollBy');
      wrap(Element.prototype, 'scrollTo'); wrap(Element.prototype, 'scrollBy');
      wrap(Element.prototype, 'scrollIntoView');
    } catch (_) {}
  })();

  // Keyboard or pointer? (Lets scripts choose where focus goes after a
  // re-render: a control for keyboard users, a heading for VoiceOver.)
  // html.bb-kbd lets css/theme.css ring text fields only for keyboard users
  // (browsers count every focused text field as :focus-visible, even a tap).
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Tab' || /^Arrow/.test(e.key) || e.key === 'Enter' || e.key === ' ') {
      root.a11y.keyboardMode = true;
      if (e.key === 'Tab') html.classList.add('bb-kbd');
    }
  }, true);
  document.addEventListener('pointerdown', function () { root.a11y.keyboardMode = false; html.classList.remove('bb-kbd'); }, true);

  applyDynamicType();
  document.addEventListener('visibilitychange', function () { if (!document.hidden) applyDynamicType(); });

  // ── 2. onclick divs → buttons ─────────────────────────────────────────────
  var NATIVE = /^(BUTTON|A|INPUT|SELECT|TEXTAREA|LABEL|SUMMARY|OPTION|DETAILS|IMG|VIDEO|AUDIO|IFRAME|BODY|HTML)$/;
  function fixClickable(el) {
    if (!el || el.nodeType !== 1 || NATIVE.test(el.tagName)) return;
    if (el.hasAttribute('role') || el.hasAttribute('data-a11y-skip')) return;
    var oc = el.getAttribute('onclick') || '';
    if (/event\.target\s*===?\s*this/.test(oc) || /stopPropagation\(\)\s*;?\s*$/.test(oc)) return;
    if (el.querySelector('button, a[href], input, select, textarea, [role="button"]')) return;
    el.setAttribute('role', 'button');
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
  }
  // Icon-only controls (📣, ✏️, ×, 🗑️ …) that carry a tooltip: VoiceOver reads
  // the emoji's own name ("megaphone") rather than the tooltip, so the tooltip
  // becomes the accessible name. Kept in sync when the language changes the
  // title (data-i18n-title).
  var HAS_WORD = /[A-Za-z0-9\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u3040-\u30FF\u4E00-\u9FFF]/;
  function nameFromTitle(el) {
    if (!el || el.nodeType !== 1) return;
    var t = el.getAttribute('title');
    if (!t) return;
    if (el.hasAttribute('aria-labelledby')) return;
    if (el.hasAttribute('aria-label') && !el.hasAttribute('data-a11y-title')) return;
    if (HAS_WORD.test(el.textContent || '')) return;
    el.setAttribute('aria-label', t);
    el.setAttribute('data-a11y-title', '1');
  }
  function scanClickables(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.hasAttribute('onclick')) fixClickable(node);
    var list = node.querySelectorAll('[onclick]');
    for (var i = 0; i < list.length; i++) fixClickable(list[i]);
    if (node.matches('button[title], a[title], [role="button"][title]')) nameFromTitle(node);
    var titled = node.querySelectorAll('button[title], a[title], [role="button"][title]');
    for (var j = 0; j < titled.length; j++) nameFromTitle(titled[j]);
    // Pictures with no alt text are decoration (bear art, mood icons next to
    // their written name): VoiceOver would otherwise read the file name.
    if (node.tagName === 'IMG' && !node.hasAttribute('alt')) node.setAttribute('alt', '');
    var imgs = node.querySelectorAll('img:not([alt])');
    for (var k = 0; k < imgs.length; k++) imgs[k].setAttribute('alt', '');
  }
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    var el = e.target;
    if (!el || el.nodeType !== 1 || NATIVE.test(el.tagName)) return;
    var role = el.getAttribute('role');
    if (!/^(button|tab|switch|checkbox|radio|menuitem|option|link)$/.test(role || '')) return;
    if (el.isContentEditable) return;
    e.preventDefault();
    el.click();
  });

  // ── 3. Dialogs ─────────────────────────────────────────────────────────────
  var open = []; // [{ el, back }]
  var FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  function visible(el) {
    if (!el.isConnected) return false;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0 && cs.pointerEvents === 'none') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function focusables(d) {
    return Array.prototype.filter.call(d.querySelectorAll(FOCUSABLE), function (x) {
      if (x.closest('[aria-hidden="true"]')) return false;
      var r = x.getBoundingClientRect(); var cs = getComputedStyle(x);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden';
    });
  }
  function heading(d) {
    var h = d.querySelector('h1, h2, h3, h4, [role="heading"], .sheet-title, .bb-fb-title, [id$="Title"], [class*="title"]');
    if (!h) return null;
    var r = h.getBoundingClientRect();
    return (r.width > 0 && r.height > 0) ? h : null;
  }
  function onOpen(d) {
    if (!d.hasAttribute('role')) d.setAttribute('role', 'dialog');
    d.setAttribute('aria-modal', 'true');
    if (d.hasAttribute('data-a11y-autolabel')) { d.removeAttribute('aria-label'); d.removeAttribute('aria-labelledby'); }
    var h = heading(d);
    if (h && !d.hasAttribute('aria-label') && !d.hasAttribute('aria-labelledby')) {
      if (!h.id) h.id = 'bbA11yH' + Math.random().toString(36).slice(2, 8);
      d.setAttribute('aria-labelledby', h.id);
      d.setAttribute('data-a11y-autolabel', '1');
    } else if (!h && !d.hasAttribute('aria-label') && !d.hasAttribute('aria-labelledby')) {
      // No heading: name it after its first line of text (e.g. the day sheet's date).
      var first = (d.innerText || '').split('\n').map(function (x) { return x.trim(); }).filter(function (x) { return HAS_WORD.test(x); })[0];
      if (first) { d.setAttribute('aria-label', first.slice(0, 80)); d.setAttribute('data-a11y-autolabel', '1'); }
    }
    var back = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    open.push({ el: d, back: back });
    // Move focus in (after the opener's own rendering settles).
    setTimeout(function () {
      if (!visible(d) || d.contains(document.activeElement)) return;
      // The heading if there is one (VoiceOver reads the title first); with no
      // heading, the first control for a keyboard user, else the dialog itself
      // (it has a name, and a tap user sees no ring jump onto a button).
      var target = heading(d);
      if (target) { if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1'); }
      else if (root.a11y.keyboardMode) target = focusables(d)[0];
      if (!target) { if (!d.hasAttribute('tabindex')) d.setAttribute('tabindex', '-1'); target = d; }
      try { target.focus({ preventScroll: true }); } catch (_) {}
    }, 80);
  }
  function onClose(i) {
    var rec = open.splice(i, 1)[0];
    var b = rec.back;
    if (b && b.isConnected && visible(b)) {
      setTimeout(function () { try { b.focus({ preventScroll: true }); } catch (_) {} }, 30);
    }
  }
  var scanQueued = false;
  function scanDialogs() {
    scanQueued = false;
    for (var i = open.length - 1; i >= 0; i--) if (!visible(open[i].el)) onClose(i);
    var all = document.querySelectorAll(root.a11y.dialogSelector);
    for (var j = 0; j < all.length; j++) {
      var d = all[j];
      if (open.some(function (o) { return o.el === d; })) continue;
      if (visible(d)) onOpen(d);
    }
  }
  function queueScan() { if (!scanQueued) { scanQueued = true; requestAnimationFrame(scanDialogs); } }
  function topDialog() { for (var i = open.length - 1; i >= 0; i--) if (visible(open[i].el)) return open[i].el; return null; }

  document.addEventListener('keydown', function (e) {
    var d = topDialog();
    if (!d) return;
    if (e.key === 'Tab') {
      var f = focusables(d);
      if (!f.length) { e.preventDefault(); return; }
      var first = f[0], last = f[f.length - 1], a = document.activeElement;
      if (!d.contains(a)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && (a === first || a === d)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
    } else if (e.key === 'Escape' && !d.matches(root.a11y.lockSelector)) {
      closeDialog(d);
    }
  }, true);

  // Close it the way a tap on the backdrop would; failing that, its own
  // close / cancel button.
  function closeDialog(d) {
    d.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    setTimeout(function () {
      if (!visible(d)) return;
      var c = d.querySelector('[data-a11y-close], .close-btn, .thread-close-btn, .steps-modal-close, .confirm-btn-no, [aria-label="' + tr('a11y.close', 'Close') + '"]');
      if (c) c.click();
    }, 30);
  }
  // For Android's back button (js/anonymous.js): close the top dialog as
  // Escape would. True when a dialog was open, closed or not (a lock screen
  // or a must-answer prompt stays, and the back press is used up on it).
  root.a11y.closeTop = function () {
    scanDialogs();
    var d = topDialog();
    if (!d) return false;
    if (!d.matches(root.a11y.lockSelector)) closeDialog(d);
    return true;
  };

  function start() {
    scanClickables(document.body);
    scanDialogs();
    var mo = new MutationObserver(function (records) {
      var dialogs = false;
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (r.type === 'childList') {
          for (var k = 0; k < r.addedNodes.length; k++) {
            var n = r.addedNodes[k];
            if (n.nodeType !== 1) continue;
            scanClickables(n);
            if (!dialogs && (n.matches(root.a11y.dialogSelector) || n.querySelector(root.a11y.dialogSelector))) dialogs = true;
          }
          if (!dialogs && r.removedNodes.length && open.length) dialogs = true;
        } else if (!dialogs && r.target.nodeType === 1 && r.target.matches(root.a11y.dialogSelector)) {
          dialogs = true;
        } else if (r.attributeName === 'onclick') {
          fixClickable(r.target);
        } else if (r.attributeName === 'title') {
          nameFromTitle(r.target);
        }
      }
      if (dialogs) queueScan();
    });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'onclick', 'title'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
