/**
 * Starter trackers (2026-11-20, James: "for new users, have an existing
 * additional data that's called My Confidence and uses the scale option. It
 * shouldn't be locked so that they can change it or delete it.")
 *
 * A new user starts with one additional tracker already on the form:
 * 💪 My Confidence, a scale (−2 … +2 around their usual). It is written as an
 * ordinary user tracker in `customTrackingFields`, NOT as a built-in
 * (DEFAULT_CUSTOM_FIELDS in js/journal.js are the locked kind), so Track Data
 * lets them rename it, change its emoji or type (until it has answers, like
 * any tracker), switch it off or delete it.
 *
 * Seeded once, only when ALL of these hold:
 *   - this device hasn't seeded before (`bbStarterTrackers`), so a deleted
 *     My Confidence never comes back;
 *   - it's a new user: onboarding not finished and no entries yet (the same
 *     test as the New features sheet's bearFreshInstall);
 *   - the device has never had a tracker list (`customTrackingFields` absent)
 *     and the id isn't tombstoned (`deletedCustomTrackers`).
 * Signing in to an account that already has a tracker list replaces the local
 * one (journal.js settings load), so existing accounts don't gain it.
 * The name is written in the app language at the time; after that it is the
 * user's own text. Reset (deleteAllEntries) clears the flag, so a reset device
 * starts like a new one.
 *
 * Loaded on index.html and journal.html after i18n.js (before journal.js).
 *
 * @file js/shared/starter-trackers.js
 */
(function () {
  'use strict';
  var BB = window.BB = window.BB || {};
  var FLAG = 'bbStarterTrackers';
  var ID = 'custom_confidence';

  var NAMES = {
    en: 'My Confidence', es: 'Mi confianza', fr: 'Ma confiance',
    de: 'Mein Selbstvertrauen', it: 'La mia sicurezza', pt: 'A minha confiança',
    nl: 'Mijn zelfvertrouwen', pl: 'Moja pewność siebie', sv: 'Mitt självförtroende',
    zh: '我的自信',
  };

  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }

  function isNewUser() {
    var step = 0, has = false;
    try { step = BB.onboarding && BB.onboarding.getStep ? BB.onboarding.getStep() : 0; } catch (_) {}
    try { has = !!(BB.storage && BB.storage.get('HasEntries') === '1'); } catch (_) {}
    if (step >= 12 || has) return false;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        if (String(localStorage.key(i)).indexOf('entry:') === 0) return false;
      }
    } catch (_) {}
    return true;
  }

  function lang() {
    try { return (BB.i18n && BB.i18n.getLang && BB.i18n.getLang()) || 'en'; } catch (_) { return 'en'; }
  }

  function seed() {
    if (lsGet(FLAG)) return false;
    if (!isNewUser()) { lsSet(FLAG, 'skipped'); return false; }
    if (lsGet('customTrackingFields') !== null) { lsSet(FLAG, 'skipped'); return false; }
    var dead = [];
    try { dead = JSON.parse(lsGet('deletedCustomTrackers') || '[]') || []; } catch (_) {}
    if (dead.indexOf(ID) !== -1) { lsSet(FLAG, 'skipped'); return false; }
    var field = { id: ID, label: NAMES[lang()] || NAMES.en, emoji: '💪', scale: true };
    lsSet('customTrackingFields', JSON.stringify([field]));
    lsSet('trackCustom_' + ID, 'true');
    lsSet(FLAG, 'seeded');
    return true;
  }

  BB.starterTrackers = { seed: seed, ID: ID, NAMES: NAMES };
  seed();
})();
