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
window._APP_VERSION = '1.40';

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
