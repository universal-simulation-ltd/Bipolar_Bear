/**
 * Automatic translation of member-written text.
 *
 * The anonymous board is one community reading in ten languages, so a post
 * written in Portuguese is unreadable to most of it. This module translates
 * that text into whatever language the reader has the app set to, and keeps
 * the original one tap away — nothing is ever replaced without saying so.
 *
 * It is deliberately a post-render DOM pass rather than something the render
 * functions call: any element carrying `data-tt` is translated, wherever it
 * came from, so a new kind of card gets translation by adding one attribute.
 *
 * Exposes:
 *   BB.translate.init({callable, ensureAuth})  — wire up the Cloud Function
 *   BB.translate.scan(rootEl)                  — translate [data-tt] inside rootEl
 *   BB.translate.isOn() / setOn(bool)          — the reader's auto-translate switch
 *   BB.translate.isAvailable()                 — false once the backend says it isn't
 *   BB.translate.reset()                       — drop per-language state (language change)
 *
 * The heavy lifting is the `translateAnonTexts` callable (functions/index.js),
 * which auto-detects each text's language, caches every translation in
 * Firestore for the whole board, and reports `unavailable` when the Cloud
 * Translation API isn't enabled. This module then simply does nothing, and
 * every post reads exactly as it was written.
 *
 * localStorage keys: `bbAnon_autoTranslate` (the switch), `bbAnonXlateCache`
 * (a local copy of translations already seen, so a re-render never flickers).
 *
 * @file js/shared/translate.js
 */
(function () {
  'use strict';

  var STORE_ON    = 'Anon_autoTranslate';
  var STORE_CACHE = 'AnonXlateCache';
  var CACHE_MAX   = 400;   // entries kept locally; oldest dropped first
  var BATCH_MS    = 60;    // collect a render's texts before calling out
  var BATCH_ITEMS = 30;    // per call — the function's own cap is 40
  var BATCH_CHARS = 10000; // per call — the function's own cap is 16000

  var _callable   = null;  // firebase httpsCallable('translateAnonTexts')
  var _ensureAuth = null;  // () => Promise, sign-in the callable requires
  var _available  = true;  // flipped off when the backend says so
  var _mem        = new Map();   // cacheKey → {t, s, same}
  var _showOrig   = new Set();   // cacheKey → reader asked for the original
  var _pending    = [];          // {el, text, key} awaiting a call
  var _timer      = null;
  var _inflight   = new Set();   // keys already sent, not yet answered
  var _saveTimer  = null;
  var _waitTries  = 0;    // flushes spent waiting for init() to wire the backend
  var _downAt     = 0;    // when the backend last said it can't translate
  var _retryTimer = null;
  var _retries    = 0;    // failed calls in a row, for the back-off below

  // A failed call is tried again on its own — waiting for the next re-render
  // left a post untranslated for good on a quiet board (James, 2026-10-26).
  // After the last step it waits for the network, the app coming back to the
  // foreground, or the next render.
  var RETRY_MS     = [3000, 10000, 30000, 90000];
  // "Unavailable" (the API off, billing, a bad moment at Google) and the daily
  // budget are asked about again after this long, not never again this
  // session — a phone keeps one session open for days.
  var DOWN_RETRY_MS = 10 * 60 * 1000;

  function _log() {
    if (window.BB && window.BB.log) window.BB.log.apply(null, arguments);
  }

  function _t(key, vars) {
    return (window.BB && window.BB.t) ? window.BB.t(key, vars) : key;
  }

  function _target() {
    return (window.BB && window.BB.i18n && window.BB.i18n.getLang) ? window.BB.i18n.getLang() : 'en';
  }

  // The source language named in the READER's language ("Englisch" for a
  // German reader), so the label reads as one sentence. Falls back to the
  // language's own name where Intl.DisplayNames is missing.
  function _langName(code) {
    try {
      var reader = _target() === 'zh' ? 'zh-Hans' : _target();
      var dn = new Intl.DisplayNames([reader], { type: 'language' });
      var n = dn.of(String(code || '').split('-')[0].toLowerCase());
      if (n && n.toLowerCase() !== String(code || '').toLowerCase()) return n;
    } catch (_) {}
    if (window.BB && window.BB.i18n && window.BB.i18n.languageName) {
      return window.BB.i18n.languageName(code);
    }
    return String(code || '').toUpperCase();
  }

  // ── Storage ───────────────────────────────────────────────────────────────

  function _store() {
    return (window.BB && window.BB.storage) ? window.BB.storage : null;
  }

  function isOn() {
    var s = _store();
    // On by default: a board nobody can read is worse than one occasionally
    // translated when it didn't need to be (an already-readable post costs
    // nothing — the backend reports it as unchanged and nothing is shown).
    return !s || s.get(STORE_ON) !== 'false';
  }

  function setOn(on) {
    var s = _store();
    if (s) s.set(STORE_ON, on ? 'true' : 'false');
    if (on) {
      scan(document);
    } else {
      // Put every visible post back to the language it was written in.
      var els = document.querySelectorAll('[data-tt]');
      for (var i = 0; i < els.length; i++) _restore(els[i]);
    }
  }

  function isAvailable() {
    if (!_available && Date.now() - _downAt > DOWN_RETRY_MS) _available = true;
    return _available;
  }

  function _down() {
    _available = false;
    _downAt = Date.now();
  }

  /** Hash used for local cache keys — FNV-1a, enough to key a few hundred texts. */
  function _hash(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(36) + '-' + str.length.toString(36);
  }

  function _key(lang, text) { return lang + ':' + _hash(text); }

  function _loadCache() {
    var s = _store();
    if (!s) return;
    try {
      var raw = JSON.parse(s.get(STORE_CACHE) || '{}');
      Object.keys(raw).forEach(function (k) {
        var v = raw[k];
        if (Array.isArray(v)) _mem.set(k, { t: v[0], s: v[1] || '', same: !!v[2] });
      });
    } catch (_) { /* corrupt cache is not worth a broken board */ }
  }

  function _saveCache() {
    if (_saveTimer) return;
    _saveTimer = setTimeout(function () {
      _saveTimer = null;
      var s = _store();
      if (!s) return;
      try {
        var keys = Array.from(_mem.keys());
        if (keys.length > CACHE_MAX) {
          // Map preserves insertion order, so the front of the list is the
          // oldest — drop it and forget those entries locally too.
          keys.slice(0, keys.length - CACHE_MAX).forEach(function (k) { _mem.delete(k); });
          keys = Array.from(_mem.keys());
        }
        var out = {};
        keys.forEach(function (k) {
          var v = _mem.get(k);
          out[k] = [v.t, v.s, v.same ? 1 : 0];
        });
        s.set(STORE_CACHE, JSON.stringify(out));
      } catch (_) { /* quota — the in-memory cache still works this session */ }
    }, 1500);
  }

  // ── Rendering the translation and its toggle ──────────────────────────────

  /** The control line under a translated post: what happened, and the way back. */
  function _bar(el, hit, showingOriginal) {
    var bar = el.nextElementSibling;
    if (!bar || !bar.classList || !bar.classList.contains('tt-bar')) {
      bar = document.createElement('div');
      bar.className = 'tt-bar';
      bar.innerHTML = '<span class="tt-note"></span><button type="button" class="tt-toggle"></button>';
      el.insertAdjacentElement('afterend', bar);
      bar.querySelector('.tt-toggle').addEventListener('click', function (e) {
        e.stopPropagation();
        var key = el.getAttribute('data-tt-key');
        if (!key) return;
        if (_showOrig.has(key)) _showOrig.delete(key);
        else                    _showOrig.add(key);
        // Every copy of this text on screen follows the same choice.
        var all = document.querySelectorAll('[data-tt-key="' + key + '"]');
        for (var i = 0; i < all.length; i++) _apply(all[i], _mem.get(key));
      });
    }
    var name = _langName(hit.s);
    bar.querySelector('.tt-note').textContent = showingOriginal
      ? _t('anon.xlate.original', { lang: name })
      : _t('anon.xlate.from',     { lang: name });
    bar.querySelector('.tt-toggle').textContent = showingOriginal
      ? _t('anon.xlate.showTranslation')
      : _t('anon.xlate.showOriginal');
  }

  /**
   * Replace a post's text. Anything laid over it (the medicine links of
   * js/shared/med-links.js) goes with the old text, so say so — they listen
   * for bb:ttchange and lay themselves on again.
   */
  function _setText(el, text) {
    el.textContent = text;
    try { el.dispatchEvent(new CustomEvent('bb:ttchange', { bubbles: true })); } catch (_) {}
  }

  /** Put the element back to the text as written, and drop its control line. */
  function _restore(el) {
    var orig = el.getAttribute('data-tt-orig');
    if (orig != null && el.textContent !== orig) _setText(el, orig);
    var bar = el.nextElementSibling;
    if (bar && bar.classList && bar.classList.contains('tt-bar')) bar.remove();
  }

  function _apply(el, hit) {
    if (!hit) return;
    // Already in the reader's language — say nothing and change nothing.
    if (hit.same) { _restore(el); return; }
    var orig = el.getAttribute('data-tt-orig');
    if (orig == null) return;
    var showingOriginal = _showOrig.has(el.getAttribute('data-tt-key'));
    var want = showingOriginal ? orig : hit.t;
    if (el.textContent !== want) _setText(el, want);
    _bar(el, hit, showingOriginal);
  }

  // ── Batching ──────────────────────────────────────────────────────────────

  function _flush() {
    _timer = null;
    var batch = _pending;
    _pending = [];
    if (!batch.length) return;
    if (!isAvailable() || !isOn()) return;
    if (!_callable) {
      // Rendered before init() wired the backend up (a slow Firebase SDK, say).
      // Hold what we have rather than dropping it on the floor — but give up
      // after ten seconds, because a page with no Firebase at all never will.
      if (++_waitTries > 20) { _waitTries = 0; return; }
      _pending = batch.concat(_pending);
      _timer = setTimeout(_flush, 500);
      return;
    }
    _waitTries = 0;

    var target = _target();
    // One entry per distinct text; every element showing it is updated together.
    var byKey = new Map();
    batch.forEach(function (item) {
      if (item.lang !== target) return;          // language changed mid-flight
      if (_mem.has(item.key)) { _apply(item.el, _mem.get(item.key)); return; }
      if (!byKey.has(item.key)) byKey.set(item.key, { text: item.text, els: [] });
      byKey.get(item.key).els.push(item.el);
    });
    if (!byKey.size) return;

    // Split into calls that stay inside the function's per-call limits.
    var chunks = [];
    var chunk  = [];
    var chars  = 0;
    byKey.forEach(function (v, k) {
      if (chunk.length >= BATCH_ITEMS || chars + v.text.length > BATCH_CHARS) {
        if (chunk.length) chunks.push(chunk);
        chunk = []; chars = 0;
      }
      chunk.push({ key: k, text: v.text, els: v.els });
      chars += v.text.length;
    });
    if (chunk.length) chunks.push(chunk);

    chunks.forEach(function (items) { _send(items, target); });
  }

  function _send(items, target) {
    items.forEach(function (it) { _inflight.add(it.key); });
    var done = function () { items.forEach(function (it) { _inflight.delete(it.key); }); };

    Promise.resolve(_ensureAuth ? _ensureAuth() : null)
      .then(function () {
        return _callable({ target: target, texts: items.map(function (i) { return i.text; }) });
      })
      .then(function (res) {
        var data = (res && res.data) || {};
        if (data.unavailable) {
          // The Cloud Translation API isn't enabled (or billing is off, or it
          // failed just now). Stop asking for a while; the board reads
          // untranslated meanwhile.
          _down();
          _log('[translate] backend unavailable — leaving posts as written');
          done();
          return;
        }
        if (data.budgetReached) { _down(); done(); return; }
        var results = data.results || [];
        _retries = 0;
        items.forEach(function (it, i) {
          var r = results[i];
          if (!r || typeof r.text !== 'string') return;
          var hit = { t: r.text, s: r.src || '', same: !!r.same };
          _mem.set(it.key, hit);
          // Every element on screen showing this text in this language — not
          // just the ones that asked. The board re-renders while a call is out
          // (the listener's cached snapshot, then the server's, on every open
          // and resume); the fresh card is skipped as "already asked for", so
          // applying only to it.els left it in the language it was written in.
          var all = document.querySelectorAll('[data-tt-key="' + it.key + '"]');
          for (var j = 0; j < all.length; j++) _apply(all[j], hit);
        });
        _saveCache();
        done();
      })
      .catch(function (e) {
        // Offline, rules, a cold function, a phone that has only just woken —
        // leave the originals up, never show the reader an error, and try
        // again shortly (_retryLater).
        _log('[translate] call failed', e);
        done();
        _retryLater();
      });
  }

  /** Look again for untranslated text after a failed call, backing off. */
  function _retryLater() {
    if (_retryTimer || _retries >= RETRY_MS.length) return;
    var wait = RETRY_MS[_retries++];
    _retryTimer = setTimeout(function () {
      _retryTimer = null;
      scan(document);
    }, wait);
  }

  /** The network is back, or the app is in front again: try what's still untranslated. */
  function _wake() {
    if (document.visibilityState === 'hidden') return;
    _retries = 0;
    if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
    if (_callable) scan(document);
  }

  // ── Public entry point ────────────────────────────────────────────────────

  /**
   * Translate every `[data-tt]` element inside `root` (default: the document).
   * Safe to call on every render — cached texts are applied synchronously, and
   * only genuinely new ones reach the network.
   */
  function scan(root) {
    root = root || document;
    var els = root.querySelectorAll ? root.querySelectorAll('[data-tt]') : [];
    if (!els.length) return;
    var target = _target();
    var on     = isOn();
    var avail  = isAvailable();

    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      // First sight of this element: whatever is in it is the original. A
      // re-render hands us fresh elements, so this is the text as written.
      var orig = el.getAttribute('data-tt-orig');
      if (orig == null) {
        orig = (el.textContent || '').trim();
        if (!orig) continue;
        el.setAttribute('data-tt-orig', orig);
      }
      var key = _key(target, orig);
      el.setAttribute('data-tt-key', key);

      if (!on || !avail)      { _restore(el); continue; }
      if (_mem.has(key))      { _apply(el, _mem.get(key)); continue; }
      if (_inflight.has(key)) continue;   // already asked for, answer pending
      _pending.push({ el: el, text: orig, key: key, lang: target });
    }

    if (_pending.length && !_timer) _timer = setTimeout(_flush, BATCH_MS);
  }

  /**
   * Forget which language everything was translated into. Called when the
   * reader changes the app language — the cache is keyed by language, so the
   * next scan simply looks up (or fetches) the new one.
   */
  function reset() {
    _showOrig.clear();
    var els = document.querySelectorAll('[data-tt]');
    for (var i = 0; i < els.length; i++) {
      // Put the text as written back first — otherwise clearing data-tt-orig
      // would leave the old language's translation looking like the original,
      // and the next scan would translate a translation.
      _restore(els[i]);
      els[i].removeAttribute('data-tt-orig');
      els[i].removeAttribute('data-tt-key');
    }
  }

  /**
   * Wire up the backend. Until this is called nothing is translated, so a page
   * with no Firebase (offline, or the SDK failed to load) degrades to the
   * board exactly as it was written.
   *
   * @param {{callable: Function, ensureAuth?: Function}} opts
   */
  function init(opts) {
    if (!opts || typeof opts.callable !== 'function') return;
    _callable   = opts.callable;
    _ensureAuth = typeof opts.ensureAuth === 'function' ? opts.ensureAuth : null;
    scan(document);
  }

  _loadCache();

  // A language change invalidates every translation on screen: the cache is
  // keyed by target language, so everything is put back to the text as written
  // and translated again into the new one.
  document.addEventListener('bb:languagechange', function () {
    reset();
    scan(document);
  });

  window.addEventListener('online', _wake);
  document.addEventListener('visibilitychange', _wake);

  window.BB = window.BB || {};
  window.BB.translate = {
    init: init,
    scan: scan,
    reset: reset,
    isOn: isOn,
    setOn: setOn,
    isAvailable: isAvailable,
  };

})();
