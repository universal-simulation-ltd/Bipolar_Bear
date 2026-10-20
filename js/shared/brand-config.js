/**
 * Per-variant brand configuration.
 *
 * Single source of truth for everything that differs between condition
 * variants of the same skeleton (Bipolar Bear, Anxiety Ant, …): app names,
 * mascot, domains, storage prefix, Firestore collection names, copy.
 *
 * Loaded as a shared helper in every page's <head>, BEFORE
 * firebase-config.js — so a future per-variant Firebase config can read
 * brand state if needed.
 *
 * Phase 1 of the multi-variant refactor: this file is additive. Nothing
 * consumes BB_BRAND yet; later phases sweep call sites to read from it
 * instead of using hardcoded literals.
 *
 * @file js/shared/brand-config.js
 */
/**
 * Web app version. Surfaced in the auth/account modal footer (so users can
 * report which version they're on) and as `window._APP_VERSION` for the
 * what's-new popup, fab.js feedback metadata, and any page that needs it
 * without depending on js/index.js loading first.
 */
window._APP_VERSION = '1.44';

window.BB_BRAND = {
  // Slug used by storage prefixes, cache names, and build artefacts.
  id: 'bipolarbear',

  // Bundle context — 'main' for the BipolarBear app, 'anonymous' for the
  // standalone Bipolar Anonymous app. scripts/build-anonymous.js flips
  // this to 'anonymous' in the www-anonymous/ copy of this file. Read
  // through BB.isAnonymousApp() rather than touching this directly:
  // native bundles can't rely on location.hostname, so this flag is the
  // only signal there.
  bundle: 'main',

  // Human-readable condition label, lowercase ("bipolar", "anxiety").
  condition: 'bipolar',

  // App display names.
  appName: 'BipolarBear',
  appNameAnonymous: 'Bipolar Anonymous',

  // Mascot — used in copy ("the Bear", "Bear hug").
  mascot: 'Bear',

  // Public domains. Edge worker maps hostname → landing page.
  domain: 'bipolarbear.app',
  domainAnonymous: 'bipolaranonymous.app',

  // localStorage key namespace. All app keys live under this prefix.
  storagePrefix: 'bb',

  // Firestore collection names for the anonymous community board.
  // Keep collection names per-variant so a shared Firebase project (if
  // ever adopted) wouldn't collide; for the current per-variant Firebase
  // strategy these names can be the same across variants without conflict.
  collections: {
    posts: 'bbAnonPosts',
    monikas: 'bbAnonMonikas',
    reports: 'bbAnonReports',
    // Admin-maintained ban list (Apple UGC guideline 1.2 — "eject the user").
    // Doc id = lowercased monika; presence = banned everywhere.
    banned: 'bbAnonBanned',
    // Announcements suggested by members, awaiting the admin's decision.
    // Only the admin publishes an announcement; this is the queue they
    // publish or refuse from (see visibleSuggestions in js/anonymous.js).
    annSuggestions: 'bbAnonAnnSuggestions',
  },

  // Marketing/manifest copy.
  description: 'Track your bipolar mood, energy, sleep, and medication daily',
  descriptionAnonymous:
    'An anonymous peer community for people living with bipolar disorder',
};

/**
 * Shared `BB` namespace, also populated by platform.js, debug.js, and
 * onboarding.js. brand-config.js loads first among the four shared
 * helpers, so the assign-or-create idiom is safe in either order.
 */
window.BB = window.BB || {};

/**
 * localStorage wrapper that prefixes every key with BB_BRAND.storagePrefix.
 *
 * Use `BB.storage.get('Xxx')` in JS instead of
 * `localStorage.getItem('bbXxx')` so the same source file works across
 * variants that use different prefixes. Inline `<script>` blocks in HTML
 * (the beta-gate, native-PIN-gate, etc.) still use literal keys because
 * they run before this module loads — those are parameterised at build
 * time per variant, not at runtime.
 *
 * Try/catch matches debug.js: localStorage can throw in iOS Safari
 * private mode. We fail open on read (return null) and silently no-op
 * on write — every caller already handles a missing value.
 */
window.BB.storage = {
  get: function (key) {
    try {
      return localStorage.getItem(window.BB_BRAND.storagePrefix + key);
    } catch (_) {
      return null;
    }
  },
  set: function (key, value) {
    try {
      localStorage.setItem(window.BB_BRAND.storagePrefix + key, value);
    } catch (_) {
      // ignore
    }
  },
  remove: function (key) {
    try {
      localStorage.removeItem(window.BB_BRAND.storagePrefix + key);
    } catch (_) {
      // ignore
    }
  },
};

/**
 * The anonymous-board "visit streak" as it should be DISPLAYED right now,
 * accounting for lapse.
 *
 * `Anon_streak` is only the streak as of the last visit (`AnonVisitDate`) —
 * it does not self-expire. The board resets it to 1 on the next visit if a
 * day was skipped (see `_updateAnonStreak` in js/anonymous.js), but until the
 * user opens the board the home page would otherwise keep advertising the
 * stale number (the "2-day streak that wasn't" bug). This returns the live
 * count, or 0 when the streak has lapsed or can't be confirmed as live.
 *
 * Dates use UTC (toISOString) to match how js/anonymous.js records
 * `AnonVisitDate`. Any caller can keep its own "no streak → just the monika"
 * branch by treating a 0 return the same as an absent streak.
 */
/**
 * True when the home page shows the Bipolar Anonymous button: the home buttons
 * are unlocked and Profile → Customise has it on — the same rule as
 * _applyOnboardingGating in js/index.js. The Anonymous streak (💬) on the home
 * card and the home-screen widget only shows while this is true.
 */
window.BB.anonButtonShown = function () {
  try {
    return window.BB.storage.get('FabsUnlocked') === '1' && window.BB.storage.get('AnonBtnEnabled') === '1';
  } catch (_) {
    return false;
  }
};

/**
 * True from 18:00 local time. The journal logs yesterday, because an entry's
 * sleep is the night after its day; in the evening, once yesterday is logged,
 * the home card and journal say when today's entry opens (js/index.js,
 * js/journal.js), since night-time loggers think of their day as "today".
 */
window.BB.isEvening = function () {
  return new Date().getHours() >= 18;
};

window.BB.anonLiveStreak = function () {
  try {
    var streak = parseInt(window.BB.storage.get('Anon_streak') || '0', 10);
    if (!(streak > 0)) return 0;
    var visitDate = window.BB.storage.get('AnonVisitDate') || '';
    // No confirmed visit date → the board would reset to 1 on next open, so
    // we can't honestly claim a live multi-day streak. Show nothing.
    if (!visitDate) return 0;
    var today     = new Date().toISOString().slice(0, 10);
    var yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    return (visitDate === today || visitDate === yesterday) ? streak : 0;
  } catch (_) {
    return 0;
  }
};

/**
 * Posts + replies this member has written on Bipolar Anonymous, all time:
 * the 💬 figure on the home card and in the Your Moniker sheet (James,
 * 2026-10-12). The board sweeps old posts, so it can't simply be counted:
 * js/anonymous.js calls bump() after each post or reply, and the figure
 * lives on the profile as `postCount` (userSettings/{uid}.anonProfile and
 * anonProfiles/{emailHash}). The first time a profile has none, seed()
 * counts what Firestore still holds (the member's posts, plus their replies
 * across every thread via a collection-group query; replies outlive their
 * post) so it starts close to the real figure.
 *
 * `targets` is { uid, hash }: the Bipolar Bear account uid and/or the
 * anonProfiles doc id. Either may be null.
 */
window.BB.anonPostCount = {
  /** The count, or null until it has been seeded on this device. */
  get: function () {
    var S = window.BB.storage;
    if (S.get('Anon_postCountSeeded') !== '1') return null;
    return Math.max(0, parseInt(S.get('Anon_postCount') || '0', 10) || 0);
  },
  /** Take a count from a restored profile (keeps the higher of the two). */
  restore: function (ap) {
    if (!ap || typeof ap.postCount !== 'number' || !ap.postCountSeeded) return;
    var S = window.BB.storage;
    var mine = S.get('Anon_postCountSeeded') === '1' ? (parseInt(S.get('Anon_postCount') || '0', 10) || 0) : 0;
    S.set('Anon_postCount', String(Math.max(mine, ap.postCount)));
    S.set('Anon_postCountSeeded', '1');
  },
  /** One more post or reply. */
  bump: function (db, targets) {
    var S = window.BB.storage;
    S.set('Anon_postCount', String((parseInt(S.get('Anon_postCount') || '0', 10) || 0) + 1));
    if (!db || !targets || typeof firebase === 'undefined') return;
    var inc = firebase.firestore.FieldValue.increment(1);
    if (targets.uid) db.collection('userSettings').doc(targets.uid).set({ anonProfile: { postCount: inc } }, { merge: true }).catch(function () {});
    if (targets.hash) db.collection('anonProfiles').doc(targets.hash).set({ postCount: inc }, { merge: true }).catch(function () {});
  },
  /**
   * Count the member's posts and replies still in Firestore and store that as
   * the count. Resolves to the count, or null if a query failed (it is tried
   * again next time). One run per page load.
   */
  seed: function (db, monika, targets) {
    var self = window.BB.anonPostCount;
    if (self._seeding) return self._seeding;
    if (!db || !monika || self.get() !== null) return Promise.resolve(self.get());
    var posts = window.BB_BRAND && BB_BRAND.collections && BB_BRAND.collections.posts;
    if (!posts) return Promise.resolve(null);
    self._seeding = Promise.all([
      db.collection(posts).where('name', '==', monika).get(),
      db.collectionGroup('comments').where('name', '==', monika).get(),
    ]).then(function (res) {
      var n = res[0].docs.filter(function (d) {
        var p = d.data();
        return !p.isSystem && !p.isTopic && !p.isBot;
      }).length + res[1].size;
      var S = window.BB.storage;
      S.set('Anon_postCount', String(n));
      S.set('Anon_postCountSeeded', '1');
      if (targets && targets.uid) db.collection('userSettings').doc(targets.uid).set({ anonProfile: { postCount: n, postCountSeeded: true } }, { merge: true }).catch(function () {});
      if (targets && targets.hash) db.collection('anonProfiles').doc(targets.hash).set({ postCount: n, postCountSeeded: true }, { merge: true }).catch(function () {});
      return n;
    }).catch(function (e) {
      console.warn('[Anonymous] post count seed failed', e);
      self._seeding = null;
      return null;
    });
    return self._seeding;
  },
};

/**
 * True when the current page is acting as the standalone "Bipolar
 * Anonymous" app — either served from the anonymous web domain or
 * running inside the dedicated Capacitor bundle (where the build script
 * has set BB_BRAND.bundle to 'anonymous').
 *
 * Native shells use a localhost / file: scheme so a hostname-only check
 * misses them. Anything that should differ between the BB-bear app and
 * the anon-only app (e.g. hiding the "← Back to Bipolar Bear" button,
 * skipping a redirect to index.html) should branch on this.
 */
window.BB.isAnonymousApp = function () {
  try {
    if (window.BB_BRAND && window.BB_BRAND.bundle === 'anonymous') return true;
    var d = (window.BB_BRAND && window.BB_BRAND.domainAnonymous) || '';
    if (!d) return false;
    var h = location.hostname;
    return h === d || h === 'www.' + d;
  } catch (_) {
    return false;
  }
};

/**
 * Load jsPDF only when a PDF is being made (privacy round 2026-10-12: it used
 * to load from a CDN on every journal and survival-kit visit). Self-hosted
 * under vendor/, so nothing is fetched from a third party. Resolves
 * window.jspdf; rejects if it can't be loaded.
 */
window.BB.loadJsPdf = function () {
  if (window.jspdf) return Promise.resolve(window.jspdf);
  if (window.BB._jsPdfPromise) return window.BB._jsPdfPromise;
  window.BB._jsPdfPromise = new Promise(function (resolve, reject) {
    var el = document.createElement('script');
    el.src = 'vendor/jspdf/2.5.1/jspdf.umd.min.js';
    el.async = true;
    el.onload = function () { window.jspdf ? resolve(window.jspdf) : reject(new Error('jsPDF missing')); };
    el.onerror = function () { window.BB._jsPdfPromise = null; reject(new Error('jsPDF failed to load')); };
    document.head.appendChild(el);
  });
  return window.BB._jsPdfPromise;
};

/**
 * A typed phone number as tel: digits (2026-10-16). "+44 (0)20 7946 0000"
 * used to become tel:+4402079460000, which doesn't connect: a "(0)" after a
 * country code is dropped, a leading 00 becomes +, and everything but the
 * digits and a leading + goes. Returns '' when nothing dialable is left.
 * Mirrored by telOf() in js/shared/safety-plan.js (kept self-contained).
 */
window.BB.telNumber = function (phone) {
  var s = String(phone || '').trim();
  if (/^(\+|00)/.test(s)) s = s.replace(/\(\s*0\s*\)/g, '');
  s = s.replace(/^00/, '+');
  s = s.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  return /\d{3,}/.test(s) ? s : '';
};

/**
 * Embed a Unicode font in a jsPDF doc and select it (2026-10-16). jsPDF's
 * built-in Helvetica is WinAnsi only, so Polish ą ę ł ś ż and every Chinese
 * character came out garbled. Noto Sans (Latin incl. Extended, ~62 KB a
 * weight) by default; Noto Sans SC (GB2312 subset, ~2.3 MB) when the app is
 * in Chinese or `text` has CJK in it. Both self-hosted under vendor/fonts
 * (SIL OFL 1.1), fetched only when a PDF is made. Registers normal / bold /
 * italic / bolditalic under one family, so the existing
 * `doc.setFont(undefined, 'bold')` calls keep working. Resolves the family
 * name; on failure resolves 'helvetica' so the PDF is still made.
 */
window.BB.loadPdfFont = function (doc, text) {
  var lang = '';
  try { lang = (window.BB.i18n && window.BB.i18n.getLang && window.BB.i18n.getLang()) || ''; } catch (e) {}
  var cjk = lang === 'zh' || /[⺀-鿿豈-﫿＀-￯]/.test(String(text || ''));
  var faces = cjk
    ? { family: 'NotoSansSC', files: { normal: 'NotoSansSC-Regular.ttf', bold: 'NotoSansSC-Regular.ttf', italic: 'NotoSansSC-Regular.ttf', bolditalic: 'NotoSansSC-Regular.ttf' } }
    : { family: 'NotoSans', files: { normal: 'NotoSans-Regular.ttf', bold: 'NotoSans-Bold.ttf', italic: 'NotoSans-Italic.ttf', bolditalic: 'NotoSans-Bold.ttf' } };
  var cache = window.BB._pdfFontFiles = window.BB._pdfFontFiles || {};
  function load(name) {
    if (!cache[name]) {
      cache[name] = fetch('vendor/fonts/' + name).then(function (r) {
        if (!r.ok) throw new Error('font ' + name + ' ' + r.status);
        return r.arrayBuffer();
      }).then(function (buf) {
        // jsPDF's VFS takes a binary string; build it in chunks.
        var bytes = new Uint8Array(buf), out = '', step = 0x8000;
        for (var i = 0; i < bytes.length; i += step) {
          out += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
        }
        return out;
      });
      cache[name].catch(function () { delete cache[name]; });
    }
    return cache[name];
  }
  var styles = Object.keys(faces.files);
  return Promise.all(styles.map(function (s) { return load(faces.files[s]); })).then(function (bins) {
    styles.forEach(function (s, i) {
      var file = faces.files[s];
      if (!doc.existsFileInVFS(file)) doc.addFileToVFS(file, bins[i]);
      doc.addFont(file, faces.family, s);
    });
    doc.setFont(faces.family, 'normal');
    return faces.family;
  }).catch(function (e) {
    console.warn('PDF font unavailable, using Helvetica', e);
    return 'helvetica';
  });
};
