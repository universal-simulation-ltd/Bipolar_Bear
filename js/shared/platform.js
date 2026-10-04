/**
 * Capacitor / native platform detection helpers shared by every page.
 *
 * Replaces the long `window.Capacitor && window.Capacitor.isNativePlatform &&
 * window.Capacitor.isNativePlatform()` chain that was duplicated 10+ times
 * across the inline scripts. Existing call sites use `isNative()`, `isIOS()`
 * and `isAndroid()` as bare globals, so we expose both `window.BB.platform.*`
 * (the canonical namespace) and `window.isNative` etc. (legacy aliases).
 *
 * Loading order: include this script in `<head>` before any inline `<script>`
 * that calls `isNative()`. It has no external dependencies and is safe to
 * load synchronously.
 *
 * @file js/shared/platform.js
 */
(function () {
  /**
   * Internal: returns the current Capacitor global if present.
   * @returns {object|undefined} `window.Capacitor` or undefined when running on the web.
   */
  function _cap() {
    return window.Capacitor;
  }

  /**
   * True when the page is running inside a Capacitor native shell
   * (iOS or Android), false in any browser context.
   * @returns {boolean}
   */
  function isNative() {
    var c = _cap();
    return !!(c && c.isNativePlatform && c.isNativePlatform());
  }

  /**
   * True when running inside the Capacitor iOS shell.
   * @returns {boolean}
   */
  function isIOS() {
    return isNative() && _cap().getPlatform() === 'ios';
  }

  /**
   * True when running inside the Capacitor Android shell.
   * @returns {boolean}
   */
  function isAndroid() {
    return isNative() && _cap().getPlatform() === 'android';
  }

  // Tag the document for native builds so CSS can suppress the desktop
  // iPhone/iPad device-frame mockup (the ≥520/≥920px media queries) and
  // render the app full-screen on real devices — critical on iPad, which is
  // wide enough to otherwise trigger the frame. Set on <html> (always present
  // at head-parse time, before <body> exists) so every page picks it up; the
  // home page also mirrors it onto <body> in js/index.js, which is harmless.
  if (isNative()) {
    document.documentElement.classList.add('is-native');
    // Per-platform hook for CSS — e.g. the Android-only edge-to-edge bottom
    // insets on the dock (fab.js) and home version label (css/index.css).
    document.documentElement.classList.add(isIOS() ? 'is-ios' : 'is-android');
  }

  /**
   * Hands the home-screen widget the same last-7-days mood dots the home
   * page draws (BLOCK 3c of js/index.js). The source is the device-only
   * `bb_recentMoods` map ({"YYYY-MM-DD": mood}) the journal leaves behind,
   * under the same rules: nothing is sent — and the widget's copy is
   * cleared — with incognito mode on or an app / guest PIN set, because the
   * widget sits on the phone's home screen outside the app's PIN gate.
   * Called after every write / removal of that map, and on each home load
   * as a catch-all for the clear-lists that remove it directly.
   */
  function syncWidgetMoods() {
    if (!isNative()) return;
    var map = {};
    try {
      var s = window.BB && window.BB.storage;
      var blocked = localStorage.getItem('incognitoMode') === 'true'
        || !s || s.get('NativePinEnabled') === '1' || !!s.get('GuestPinSalt');
      var cached = blocked ? null : JSON.parse(s.get('_recentMoods') || 'null');
      if (cached && typeof cached === 'object') map = cached;
    } catch (_) {}
    var payload = { recentMoods: JSON.stringify(map) };
    // The Bipolar Anonymous visit streak and the UTC day it was last counted
    // (js/anonymous.js _updateAnonStreak). The widget applies the same lapse
    // rule as BB.anonLiveStreak(), so it stops showing a broken streak at
    // midnight without the app being opened. Sent like the journal streak,
    // which the widget shows whatever the PIN setting.
    try {
      payload.anonStreak = parseInt((window.BB.storage.get('Anon_streak') || '0'), 10) || 0;
      payload.anonVisitDate = window.BB.storage.get('AnonVisitDate') || '';
    } catch (_) {}
    try {
      var wk = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.setSharedData;
      if (wk) { wk.postMessage(payload); return; }
      var plugin = _cap() && _cap().Plugins && _cap().Plugins.BipolarBearWidget;
      if (plugin && plugin.setSharedData) plugin.setSharedData(payload);
    } catch (_) {}
  }

  // Canonical namespace.
  window.BB = window.BB || {};
  window.BB.platform = { isNative: isNative, isIOS: isIOS, isAndroid: isAndroid, syncWidgetMoods: syncWidgetMoods };

  // Legacy globals — keep existing inline call sites working.
  window.isNative = isNative;
  window.isIOS = isIOS;
  window.isAndroid = isAndroid;
})();
