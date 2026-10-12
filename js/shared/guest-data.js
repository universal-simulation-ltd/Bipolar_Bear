/**
 * Guest-data claim helper. Loaded via <script src> before the page script on
 * index / journal / survival-kit.
 *
 *   window.BB.claimGuestData(db, user, doc)
 *
 * Why this exists
 * ---------------
 * Data entered before creating an account (during the tutorial, as a guest)
 * lives ONLY in localStorage — the Firestore write paths are all gated on
 * `currentUser`, which is null for a guest. The auth listeners then sync
 * one-way: they pull settings DOWN from the account into localStorage but
 * never push local guest data UP. So anything authored as a guest was never
 * backed up and vanished the moment localStorage was cleared (app reinstall,
 * storage eviction, switching device, web<->native). This is the medication
 * data-loss bug, generalised to every guest-owned field.
 *
 * `claimGuestData` backs local guest data UP to userSettings/{uid} on
 * sign-in/sign-up. It is:
 *   - idempotent      — once the account has a value, it stops uploading it;
 *   - non-destructive — it only ever ADDS data the account is missing, it
 *                       never overwrites an existing account value;
 *   - new-account safe — callers run it even when the settings doc doesn't
 *                       exist yet, so a freshly created account is covered.
 *
 * Call it from the userSettings .get().then(doc => ...) handler, passing the
 * fetched doc (existing or not).
 */
(function () {
  'use strict';

  // [ localStorage key, Firestore field, kind ]
  // kind: 'array' | 'map' | 'string'. localStorage key === Firestore field for
  // every entry today, but both are listed so they can diverge if ever needed.
  //
  // Only the non-sensitive fields are claimed here. Medications, coping
  // strategies, mood definitions, mood memories, reminders, commitments,
  // gratitude and "remember this" are claimed by js/shared/secure-store.js,
  // which uploads them only encrypted (privacy round, 2026-10-12) — never add
  // them back to this list.
  var FIELDS = [
    ['dailyGoals',        'dailyGoals',        'array'],
    ['dailyBudget',       'dailyBudget',       'string']
  ];

  // A map (mood -> string, or mood -> array) counts as "having content" when at
  // least one value is a non-empty string or a non-empty array.
  function mapHasContent(obj) {
    if (!obj || typeof obj !== 'object') return false;
    return Object.keys(obj).some(function (k) {
      var v = obj[k];
      if (Array.isArray(v)) return v.length > 0;
      return v !== undefined && v !== null && String(v).trim() !== '';
    });
  }

  function claimGuestData(db, user, doc) {
    if (!db || !user || !user.uid) return;
    var d = (doc && doc.exists) ? doc.data() : {};
    var patch = {};

    FIELDS.forEach(function (f) {
      var lsKey = f[0], fsField = f[1], kind = f[2];
      var raw = localStorage.getItem(lsKey);
      if (raw == null) return;
      var remote = d[fsField];
      try {
        if (kind === 'string') {
          if (!raw.trim()) return;                                  // local empty
          if (remote !== undefined && remote !== null && remote !== '') return; // account already has one
          patch[fsField] = raw;
        } else {
          var local = JSON.parse(raw);
          if (kind === 'array') {
            if (!Array.isArray(local) || local.length === 0) return;
            if (Array.isArray(remote) && remote.length > 0) return;
            patch[fsField] = local;
          } else { // map
            if (!mapHasContent(local)) return;
            if (mapHasContent(remote)) return;
            patch[fsField] = local;
          }
        }
      } catch (e) { /* malformed localStorage value — skip */ }
    });

    if (Object.keys(patch).length) {
      db.collection('userSettings').doc(user.uid).set(patch, { merge: true }).catch(function () {});
    }
  }

  window.BB = window.BB || {};
  window.BB.claimGuestData = claimGuestData;
})();
