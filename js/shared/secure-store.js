/**
 * Encrypted storage for personal details and the sensitive settings
 * (privacy round, 2026-10-12). Loaded by index, journal, survival-kit and
 * anonymous, after brand-config.js and before the page script.
 *
 *   BB.secure.settings(uid, d)       → Promise<{view, status}>
 *   BB.secure.saveSettings(uid, patch) → Promise<'saved'|'pending'|'error'>
 *   BB.secure.personal(uid)          → Promise<object|null>
 *   BB.secure.savePersonal(uid, patch) → Promise<'saved'|'pending'|'error'>
 *   BB.secure.clearPending()         — logout / reset
 *
 * What and why
 * ------------
 * personalDetails/{uid} (name, date of birth, NHS / medical number, diagnosis,
 * address, mobile, email, emergency contact, notes) and these userSettings
 * fields used to sit in Firestore in plaintext:
 *   currentMedList, moodDefinitions, moodMemories, copingStrategies,
 *   myCommitments, customReminders, survivalGratitude, rememberThis
 * (plus medHistory, v343, the per-medicine logs medSideEffects,
 * medBloodLevels and medPastChanges, 1.44, and medBloodPlans (each test's next
 * due date and the person's own range, v358), which were never anything but
 * encrypted)
 * They are now one AES-GCM blob each — personalDetails/{uid}.secureEnc and
 * userSettings/{uid}.secureEnc — under the journal's data key, the same key
 * and the same Standard / Private model as the journal entries and the safety
 * plan (DOCS.md §2.18): Standard accounts can open it on any signed-in device,
 * Private ones only with the journal password.
 *
 * The device copy stays in localStorage under the same keys as before, so the
 * pages keep reading and rendering from there. This module only changes what
 * goes to (and comes from) the account.
 *
 * The key: sessionStorage `bb_user_key` (put there by js/journal.js), or, for
 * a Standard account, unwrapped here through the journalWrapKey Cloud Function.
 * It never touches SecureStorage — the journal reads the Keychain once per
 * session and a second caller could take that attempt away. A Private account
 * that hasn't opened its journal this session has no key on the other pages:
 * then a save stays on the device, marked pending, and goes up encrypted as
 * soon as a key is in hand. Nothing sensitive is ever written in plaintext.
 *
 * Migration: the first sync with a key folds any plaintext fields into the
 * blob and deletes them, in one transaction. Older app builds still write
 * plaintext (the Firestore rules allow that while legacyClients() is true):
 *   personal details — an older build only writes them when the person saves
 *     the form, so plaintext found next to a blob is newer and wins;
 *   settings — older builds also re-upload their device copy whenever the
 *     account lacks a field (guest-data.js), so plaintext next to a blob is
 *     usually stale: the blob wins, plaintext only fills fields it lacks.
 */
(function () {
  'use strict';
  var root = window;

  var SETTINGS = ['currentMedList', 'moodDefinitions', 'moodMemories', 'copingStrategies',
    'myCommitments', 'customReminders', 'survivalGratitude', 'rememberThis', 'medHistory',
    'medSideEffects', 'medBloodLevels', 'medPastChanges', 'medBloodPlans'];
  // Merged rather than replaced when this device has something to add.
  var UNION_FIELDS = {
    medHistory: function (a, b) { return mergeHistory(a, b); },
    medSideEffects: function (a, b) { return mergeById(a, b); },
    medBloodLevels: function (a, b) { return mergeById(a, b); },
    medPastChanges: function (a, b) { return mergeById(a, b); },
    medBloodPlans: function (a, b) { return mergeById(a, b); },
  };
  var STRING_FIELDS = { rememberThis: true };
  var PERSONAL = ['personalName', 'personalDOB', 'personalMedicalNum', 'personalDiagnosis',
    'personalDiagnosisDate', 'personalAddress', 'personalMobile', 'personalEmail',
    'personalEmergencyContact', 'personalNotes'];
  var PENDING_KEY = 'bbSecurePending'; // {uid, settings: [..], personal: [..]}
  var REGION = 'europe-west1';

  // ── tiny helpers ───────────────────────────────────────────────────────────
  function _b64(buf) {
    var bytes = new Uint8Array(buf), s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function _unb64(s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (_) {} }
  function warn(m, e) { try { console.warn('[secure] ' + m, e && (e.message || e)); } catch (_) {} }
  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }

  function fb() { return root.firebase && firebase.apps && firebase.apps.length ? firebase : null; }
  function fs() { var f = fb(); return f ? f.firestore() : null; }
  function del() { return firebase.firestore.FieldValue.delete(); }
  function currentUser() {
    try { var f = fb(); var u = f && f.auth().currentUser; return u && !u.isAnonymous ? u : null; }
    catch (_) { return null; }
  }

  // Device copy ↔ value. Settings are JSON except the string ones; personal
  // details are plain strings.
  function readLocal(kind, f) {
    var raw = lsGet(f);
    if (raw == null) return undefined;
    if (kind === 'personal' || STRING_FIELDS[f]) return raw;
    try { return JSON.parse(raw); } catch (_) { return undefined; }
  }
  function writeLocal(kind, f, v) {
    if (v === undefined) return;
    if (v === null) { lsDel(f); return; }
    if (kind === 'personal' || STRING_FIELDS[f]) lsSet(f, String(v));
    else lsSet(f, JSON.stringify(v));
  }
  function hasContent(v) {
    if (v == null) return false;
    if (typeof v === 'string') return v.trim() !== '';
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') {
      return Object.keys(v).some(function (k) { return hasContent(v[k]); });
    }
    return true;
  }

  // ── pending saves (made while no key was in hand) ─────────────────────────
  function pending(uid) {
    try {
      var p = JSON.parse(lsGet(PENDING_KEY) || 'null');
      if (p && p.uid === uid) return { uid: uid, settings: p.settings || [], personal: p.personal || [] };
    } catch (_) {}
    return { uid: uid, settings: [], personal: [] };
  }
  function addPending(uid, kind, fields) {
    var p = pending(uid);
    fields.forEach(function (f) { if (p[kind].indexOf(f) < 0) p[kind].push(f); });
    lsSet(PENDING_KEY, JSON.stringify(p));
  }
  function clearPendingKind(uid, kind) {
    var p = pending(uid);
    p[kind] = [];
    if (!p.settings.length && !p.personal.length) lsDel(PENDING_KEY);
    else lsSet(PENDING_KEY, JSON.stringify(p));
  }

  // ── the key ────────────────────────────────────────────────────────────────
  var _keyFor = null, _keyPromise = null;
  function _importRaw(raw) {
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  }
  function _fromSession() {
    var b64 = null;
    try { b64 = sessionStorage.getItem('bb_user_key'); } catch (_) {}
    if (!b64) return Promise.resolve(null);
    return _importRaw(_unb64(b64)).catch(function () { return null; });
  }
  // A Standard account's data key, through the server wrap (js/journal.js
  // _resolveUserKey does the same). Never mints a key: that is the journal's.
  function _fromStandardWrap(uid) {
    var f = fb();
    if (!f || typeof f.app().functions !== 'function') return Promise.resolve(null);
    return fs().collection('userSettings').doc(uid).get().then(function (doc) {
      var d = doc.exists ? doc.data() : null;
      if (!d || !d.stdWrappedKey || !d.stdWrappedKeyIv) return null;
      return f.app().functions(REGION).httpsCallable('journalWrapKey')({}).then(function (res) {
        return crypto.subtle.importKey('raw', _unb64(res.data.key), { name: 'AES-GCM' }, false, ['decrypt']);
      }).then(function (wrapKey) {
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: _unb64(d.stdWrappedKeyIv) }, wrapKey, _unb64(d.stdWrappedKey));
      }).then(function (raw) {
        try { sessionStorage.setItem('bb_user_key', _b64(raw)); } catch (_) {}
        return _importRaw(raw);
      });
    }).catch(function (e) { warn('standard key unavailable', e); return null; });
  }
  /** The journal data key for `uid`, or null (Private and not unlocked yet, offline, guest). */
  function key(uid) {
    if (!uid || !root.crypto || !crypto.subtle) return Promise.resolve(null);
    if (_keyFor !== uid) { _keyFor = uid; _keyPromise = null; }
    if (_keyPromise) return _keyPromise;
    var p = _fromSession().then(function (k) { return k || _fromStandardWrap(uid); });
    _keyPromise = p;
    // Don't remember a miss: the journal may put the key in place later.
    p.then(function (k) { if (!k && _keyPromise === p) _keyPromise = null; });
    return p;
  }

  function encrypt(k, obj) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, new TextEncoder().encode(JSON.stringify(obj)))
      .then(function (c) { return { _enc: _b64(c), _iv: _b64(iv), v: 1, updatedAt: Date.now() }; });
  }
  function decrypt(k, enc) {
    if (!enc || !enc._enc || !enc._iv) return Promise.resolve({});
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: _unb64(enc._iv) }, k, _unb64(enc._enc))
      .then(function (p) { var o = JSON.parse(new TextDecoder().decode(p)); return o && typeof o === 'object' ? o : {}; });
  }

  // ── one transaction for both documents ────────────────────────────────────
  // kind: 'settings' (userSettings/{uid}) | 'personal' (personalDetails/{uid}).
  // patch: fields to set now (explicit saves). Resolves the merged plaintext
  // view, or throws 'bad-key' when the blob doesn't open with this key (never
  // overwrite what we can't read).
  function syncDoc(uid, kind, k, patch) {
    var db = fs();
    var fields = kind === 'personal' ? PERSONAL : SETTINGS;
    var ref = db.collection(kind === 'personal' ? 'personalDetails' : 'userSettings').doc(uid);
    var pend = pending(uid)[kind];
    return db.runTransaction(function (tx) {
      return tx.get(ref).then(function (snap) {
        var d = snap.exists ? snap.data() : {};
        return decrypt(k, d.secureEnc).catch(function () { throw new Error('bad-key'); }).then(function (blob) {
          var write = {}, changed = false;
          fields.forEach(function (f) {
            var U = kind === 'settings' && UNION_FIELDS[f];
            if (has(patch, f)) {
              blob[f] = U ? U(blob[f], patch[f]) : patch[f]; changed = true;
            } else if (pend.indexOf(f) >= 0) {
              var lv = readLocal(kind, f);
              if (lv !== undefined) { blob[f] = U ? U(blob[f], lv) : lv; changed = true; }
            } else if (has(d, f)) {
              // Plaintext: unmigrated, or written by an older app build.
              if (kind === 'personal' || !has(blob, f)) { blob[f] = d[f]; changed = true; }
            } else if (kind === 'settings' && !has(blob, f)) {
              // Guest data the account has never had (guest-data.js rule:
              // only ever adds, never overwrites).
              var gv = readLocal(kind, f);
              if (hasContent(gv)) { blob[f] = gv; changed = true; }
            }
            if (has(d, f)) { write[f] = del(); changed = true; }
          });
          if (!changed) return blob;
          return encrypt(k, blob).then(function (enc) {
            write.secureEnc = enc;
            if (kind === 'personal') write.updatedAt = enc.updatedAt;
            tx.set(ref, write, { merge: true });
            return blob;
          });
        });
      });
    }).then(function (blob) {
      fields.forEach(function (f) { if (has(blob, f)) writeLocal(kind, f, blob[f]); });
      clearPendingKind(uid, kind);
      return blob;
    });
  }

  function plainView(d, kind, uid) {
    var fields = kind === 'personal' ? PERSONAL : SETTINGS;
    var pend = pending(uid)[kind];
    var out = {};
    fields.forEach(function (f) { if (d && has(d, f) && pend.indexOf(f) < 0) out[f] = d[f]; });
    return out;
  }

  /**
   * The sensitive settings for `uid`, decrypted, after folding in plaintext and
   * pending saves. `d` is the userSettings data the caller already read (used
   * when there is no key). view = only the fields known — apply each one that
   * is present, keep the device copy for the rest.
   */
  function settings(uid, d, opts) {
    if (!uid || !fs()) return Promise.resolve({ view: {}, status: 'no-user' });
    var work = _settings(uid, d);
    var ms = opts && opts.timeoutMs;
    if (!ms) return work;
    // A slow key fetch mustn't hold a page's settings up: answer with what is
    // known now; the sync carries on and still updates the device copy.
    return Promise.race([work, new Promise(function (r) {
      setTimeout(function () { r({ view: plainView(d, 'settings', uid), status: 'timeout' }); }, ms);
    })]);
  }
  function _settings(uid, d) {
    return key(uid).then(function (k) {
      if (!k) return { view: plainView(d, 'settings', uid), status: 'no-key' };
      return syncDoc(uid, 'settings', k, null).then(function (blob) {
        // The account's history is on the device now: start one if it has none.
        if (ensureBaseline()) save(uid, 'settings', { medHistory: historyGet() });
        return { view: blob, status: 'ok' };
      });
    }).catch(function (e) {
      warn('settings sync', e);
      return { view: e && e.message === 'bad-key' ? {} : plainView(d, 'settings', uid), status: 'error' };
    });
  }

  function save(uid, kind, patch) {
    // A new medication list always travels with its history.
    if (kind === 'settings' && patch && has(patch, 'currentMedList') && !has(patch, 'medHistory')) {
      var h = readLocal('settings', 'medHistory');
      if (Array.isArray(h) && h.length) { patch = Object.assign({}, patch); patch.medHistory = h; }
    }
    var fields = Object.keys(patch || {});
    if (!uid || !fields.length || !fs()) return Promise.resolve('error');
    return key(uid).then(function (k) {
      if (!k) { addPending(uid, kind, fields); return 'pending'; }
      return syncDoc(uid, kind, k, patch).then(function () { return 'saved'; });
    }).catch(function (e) {
      warn(kind + ' save', e);
      addPending(uid, kind, fields);
      return 'pending';
    });
  }

  /** Save sensitive settings (the device copy must already hold them). */
  function saveSettings(uid, patch) { return save(uid, 'settings', patch); }
  /** Save personal details (the device copy must already hold them). */
  function savePersonal(uid, patch) { return save(uid, 'personal', patch); }

  /**
   * Personal details for `uid`, decrypted (and migrated). Writes the device
   * copy for every field it knows. Resolves the fields object, or null.
   */
  function personal(uid) {
    if (!uid || !fs()) return Promise.resolve(null);
    return key(uid).then(function (k) {
      if (k) return syncDoc(uid, 'personal', k, null);
      // No key: an unmigrated account can still show its plaintext.
      return fs().collection('personalDetails').doc(uid).get().then(function (doc) {
        if (!doc.exists) return null;
        var v = plainView(doc.data(), 'personal', uid);
        PERSONAL.forEach(function (f) { if (has(v, f)) writeLocal('personal', f, v[f]); });
        return Object.keys(v).length ? v : null;
      });
    }).catch(function (e) { warn('personal details', e); return null; });
  }

  /** userSettings fields for a reset: blob gone, plaintext gone. */
  function resetPatch() {
    var out = { secureEnc: null };
    SETTINGS.forEach(function (f) { out[f] = del(); });
    return out;
  }

  function clearPending() { lsDel(PENDING_KEY); }

  /**
   * `d` (a userSettings document's data) with its sensitive fields replaced by
   * `view` from settings(): a field the view doesn't know comes out undefined,
   * so the page keeps its device copy.
   */
  function mergeView(d, view) {
    var out = {};
    Object.keys(d || {}).forEach(function (k) { if (SETTINGS.indexOf(k) < 0) out[k] = d[k]; });
    Object.keys(view || {}).forEach(function (k) { if (SETTINGS.indexOf(k) >= 0) out[k] = view[k]; });
    return out;
  }

  // ── Medication history (v343) ──────────────────────────────────────────────
  // localStorage `medHistory`: a dated log of every change to the medication
  // list (currentMedList), the groundwork for comparing moods before / after a
  // change. Events: {at: ISO date-time, type: 'baseline'|'add'|'stop'|'dose'|
  // 'rename', name, from?, to?, source?: 'user'|'import'} — `from`/`to` are
  // dosages, except for a rename, where they are the old / new name. Sensitive
  // like the list itself: a device copy plus the encrypted secureEnc blob,
  // never plaintext in Firestore. Devices merge by union on (at, type, name).
  var MED_TYPES = { baseline: 1, add: 1, stop: 1, dose: 1, rename: 1 };
  function _medNorm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  function _medDose(m) { return String((m && m.dosage) == null ? '' : m.dosage).trim(); }
  function _medList(v) {
    return Array.isArray(v) ? v.filter(function (m) { return m && typeof m === 'object' && String(m.name == null ? '' : m.name).trim(); }) : [];
  }
  function _validEvent(e) {
    return !!e && typeof e === 'object' && typeof e.at === 'string' && !!MED_TYPES[e.type] && typeof e.name === 'string';
  }
  function _evKey(e) { return e.at + '|' + e.type + '|' + _medNorm(e.name); }
  /** a ∪ b on (at, type, name), oldest first. */
  function mergeHistory(a, b) {
    var seen = {}, out = [];
    [].concat(Array.isArray(a) ? a : [], Array.isArray(b) ? b : []).forEach(function (e) {
      if (!_validEvent(e)) return;
      var k = _evKey(e);
      if (seen[k]) return;
      seen[k] = 1; out.push(e);
    });
    out.sort(function (x, y) { return x.at < y.at ? -1 : x.at > y.at ? 1 : 0; });
    return out;
  }
  function historyGet() {
    var v = readLocal('settings', 'medHistory');
    return Array.isArray(v) ? v.filter(_validEvent) : [];
  }
  function _ev(at, type, name, extra) {
    var e = { at: at, type: type, name: String(name).trim() };
    Object.keys(extra || {}).forEach(function (k) { if (extra[k] !== undefined) e[k] = extra[k]; });
    return e;
  }
  function _baselineFor(list, at) {
    return _medList(list).map(function (m) { var d = _medDose(m); return _ev(at, 'baseline', m.name, d ? { to: d } : null); });
  }
  /**
   * First run after the update: no history yet but a list → one 'baseline'
   * per medicine, dated now (the person was on them from at least today).
   * True when it wrote one.
   */
  function ensureBaseline() {
    if (historyGet().length) return false;
    var list = readLocal('settings', 'currentMedList');
    if (!_medList(list).length) return false;
    lsSet('medHistory', JSON.stringify(_baselineFor(list, new Date().toISOString())));
    return true;
  }
  /**
   * Record the change from `prev` to `next` (both [{name, dosage}]) in the
   * device history. Call it before the new list is saved; the save that
   * follows (saveSettings with currentMedList) carries the history up.
   * opts.source: 'user' (default) | 'import'. opts.rename: {from, to} when an
   * edit changed a medicine's name. Same name (case aside), other dosage =
   * 'dose'. Returns the events written.
   */
  function record(prev, next, opts) {
    opts = opts || {};
    var source = opts.source === 'import' ? 'import' : 'user';
    var before = _medList(prev).map(function (m) { return { name: String(m.name).trim(), dosage: _medDose(m) }; });
    var after = _medList(next).map(function (m) { return { name: String(m.name).trim(), dosage: _medDose(m) }; });
    var hist = historyGet();
    var at = new Date().toISOString();
    var out = hist.length ? [] : _baselineFor(before, at);
    var rn = opts.rename;
    if (rn && String(rn.from || '').trim() && String(rn.to || '').trim() && _medNorm(rn.from) !== _medNorm(rn.to)) {
      for (var i = 0; i < before.length; i++) {
        if (_medNorm(before[i].name) === _medNorm(rn.from)) {
          out.push(_ev(at, 'rename', rn.to, { from: before[i].name, to: String(rn.to).trim(), source: source }));
          before[i] = { name: String(rn.to).trim(), dosage: before[i].dosage };
          break;
        }
      }
    }
    var used = before.map(function () { return false; });
    after.forEach(function (m) {
      for (var j = 0; j < before.length; j++) {
        if (used[j] || _medNorm(before[j].name) !== _medNorm(m.name)) continue;
        used[j] = true;
        if (before[j].dosage !== m.dosage) out.push(_ev(at, 'dose', m.name, { from: before[j].dosage, to: m.dosage, source: source }));
        return;
      }
      out.push(_ev(at, 'add', m.name, { to: m.dosage || undefined, source: source }));
    });
    before.forEach(function (m, j) {
      if (!used[j]) out.push(_ev(at, 'stop', m.name, { from: m.dosage || undefined, source: source }));
    });
    var changes = out.filter(function (e) { return e.type !== 'baseline'; });
    if (!changes.length) return [];
    lsSet('medHistory', JSON.stringify(mergeHistory(hist, out)));
    return out;
  }
  /** Fold events from elsewhere (a backup) into the device history. Returns the merged list. */
  function mergeIn(events) {
    var merged = mergeHistory(historyGet(), events);
    if (merged.length) lsSet('medHistory', JSON.stringify(merged));
    return merged;
  }

  // ── Medicine logs (1.44) ───────────────────────────────────────────────────
  // Three lists kept like medHistory (device copy + the encrypted secureEnc
  // blob, never plaintext in Firestore), one record per item with an `id`:
  //   medSideEffects  {id, date:'YYYY-MM-DD', med, text}
  //   medBloodLevels  {id, date, test, value:number, unit, note?}
  //   medPastChanges  {id, date, type:'add'|'stop'|'dose', name, from?, to?}
  //                   — a change from before the dated history began, typed
  //                   in so it can be compared (medHistory starts at v343).
  //   medBloodPlans   {id:'t:<test, lower case>', test, due?:'YYYY-MM-DD',
  //                   low?:number, high?:number, dismissed?:'YYYY-MM-DD'}
  //                   — one per test (v358): the next test's due date, the
  //                   range the person's prescriber gave them (never a
  //                   default), and the due date whose "had your test?" card
  //                   they dismissed. No `date`: these aren't dated records.
  // Each record also carries `updatedAt` (ms). Deleting leaves a tombstone
  // {id, deleted:true, updatedAt} with nothing else in it, so a copy on
  // another device can't bring the item back. Devices merge by id: the newer
  // updatedAt wins (mergeById).
  var LOG_FIELDS = { sideEffects: 'medSideEffects', bloodLevels: 'medBloodLevels', pastChanges: 'medPastChanges', bloodPlans: 'medBloodPlans' };
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  function _str(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }
  function _isItem(x) { return !!x && typeof x === 'object' && typeof x.id === 'string' && x.id !== ''; }
  function _itemDate(x) { return typeof x.date === 'string' ? x.date : ''; }
  /** a ∪ b by id; for the same id the later updatedAt wins (b on a tie). Oldest date first. */
  function mergeById(a, b) {
    var by = {}, order = [];
    [].concat(Array.isArray(a) ? a : [], Array.isArray(b) ? b : []).forEach(function (x) {
      if (!_isItem(x)) return;
      var p = by[x.id];
      if (!p) { by[x.id] = x; order.push(x.id); return; }
      if ((Number(x.updatedAt) || 0) >= (Number(p.updatedAt) || 0)) by[x.id] = x;
    });
    return order.map(function (id) { return by[id]; }).sort(function (x, y) {
      var dx = _itemDate(x), dy = _itemDate(y);
      if (dx !== dy) return dx < dy ? -1 : 1;
      return (Number(x.updatedAt) || 0) - (Number(y.updatedAt) || 0);
    });
  }
  /** A clean copy of a new / edited record, or null when it isn't valid. */
  function _num(v) {
    if (v == null || String(v).trim() === '') return null;
    var n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
    return isFinite(n) ? n : null;
  }
  /** One test's plan: its id is the test's name in lower case. */
  function _cleanPlan(x) {
    var test = _str(x.test, 60);
    if (!test) return null;
    var out = { id: 't:' + test.toLowerCase().replace(/\s+/g, ' '), test: test };
    if (DATE_RE.test(String(x.due || ''))) out.due = x.due;
    var lo = _num(x.low), hi = _num(x.high);
    if (lo != null && hi != null && lo > hi) return null;
    if (lo != null) out.low = lo;
    if (hi != null) out.high = hi;
    if (DATE_RE.test(String(x.dismissed || ''))) out.dismissed = x.dismissed;
    return out;
  }
  function _cleanItem(kind, x) {
    if (kind === 'bloodPlans') return x && typeof x === 'object' ? _cleanPlan(x) : null;
    if (!x || typeof x !== 'object' || !DATE_RE.test(String(x.date || ''))) return null;
    var out = { id: _str(x.id, 64), date: x.date };
    if (kind === 'sideEffects') {
      out.text = _str(x.text, 500);
      if (!out.text) return null;
      out.med = _str(x.med, 120);
    } else if (kind === 'bloodLevels') {
      var v = typeof x.value === 'number' ? x.value : Number(String(x.value == null ? '' : x.value).replace(',', '.'));
      out.test = _str(x.test, 60);
      if (!out.test || !isFinite(v) || String(x.value).trim() === '') return null;
      out.value = v;
      out.unit = _str(x.unit, 20);
      var n = _str(x.note, 200);
      if (n) out.note = n;
    } else if (kind === 'pastChanges') {
      if (['add', 'stop', 'dose'].indexOf(x.type) < 0) return null;
      out.type = x.type;
      out.name = _str(x.name, 120);
      if (!out.name) return null;
      var f = _str(x.from, 60), t = _str(x.to, 60);
      if (f) out.from = f;
      if (t) out.to = t;
    } else return null;
    return out;
  }
  function _newId() {
    var b = crypto.getRandomValues(new Uint8Array(9)), s = '';
    for (var i = 0; i < b.length; i++) s += ('0' + b[i].toString(16)).slice(-2);
    return s;
  }
  function logAll(kind) {
    var f = LOG_FIELDS[kind];
    var v = f ? readLocal('settings', f) : null;
    return Array.isArray(v) ? v.filter(_isItem) : [];
  }
  /** The live records (no tombstones), oldest date first. */
  function logList(kind) { return logAll(kind).filter(function (x) { return !x.deleted; }); }
  function _logWrite(kind, list) {
    lsSet(LOG_FIELDS[kind], JSON.stringify(list));
    // An account gets it encrypted; a guest keeps it on the device only.
    var u = currentUser();
    if (u && fs()) {
      var patch = {}; patch[LOG_FIELDS[kind]] = list;
      return save(u.uid, 'settings', patch);
    }
    return Promise.resolve('device');
  }
  /** Add or replace a record. Resolves {item, status} or null (invalid). */
  function logPut(kind, item) {
    var c = _cleanItem(kind, item);
    if (!c) return Promise.resolve(null);
    if (!c.id) c.id = _newId();
    c.updatedAt = Date.now();
    var list = mergeById(logAll(kind), [c]);
    return _logWrite(kind, list).then(function (st) { return { item: c, status: st }; });
  }
  function logRemove(kind, id) {
    if (!id) return Promise.resolve(null);
    var list = mergeById(logAll(kind), [{ id: String(id), deleted: true, updatedAt: Date.now() }]);
    return _logWrite(kind, list);
  }
  /** Fold records from a backup in (never replaces). Returns the merged list. */
  function logMergeIn(kind, items) {
    if (!LOG_FIELDS[kind] || !Array.isArray(items)) return logAll(kind);
    var clean = items.map(function (x) {
      if (_isItem(x) && x.deleted) return { id: x.id, deleted: true, updatedAt: Number(x.updatedAt) || 0 };
      var c = _cleanItem(kind, x);
      if (!c || !c.id) return null;
      c.updatedAt = Number(x.updatedAt) || 0;
      return c;
    }).filter(Boolean);
    var merged = mergeById(logAll(kind), clean);
    lsSet(LOG_FIELDS[kind], JSON.stringify(merged));
    return merged;
  }

  // Pending saves go up as soon as a key turns up (the journal puts it in
  // sessionStorage during its own auth listener), so keep trying for a while
  // after sign-in. Fires 'bb:secure-sync' with the views when anything synced.
  function _flush(uid) {
    var p = pending(uid);
    if (!p.settings.length && !p.personal.length) return Promise.resolve('none');
    return key(uid).then(function (k) {
      if (!k) return 'no-key';
      var jobs = [];
      if (p.settings.length) jobs.push(syncDoc(uid, 'settings', k, null).then(function (v) { return ['settings', v]; }));
      if (p.personal.length) jobs.push(syncDoc(uid, 'personal', k, null).then(function (v) { return ['personal', v]; }));
      return Promise.all(jobs).then(function (rs) {
        var detail = {};
        rs.forEach(function (r) { detail[r[0]] = r[1]; });
        try { root.dispatchEvent(new CustomEvent('bb:secure-sync', { detail: detail })); } catch (_) {}
        return 'flushed';
      });
    }).catch(function (e) { warn('flush', e); return 'error'; });
  }
  function _watchAuth() {
    try {
      var f = fb();
      if (!f) return;
      f.auth().onAuthStateChanged(function (u) {
        // A guest's history lives on the device only: start it now. Accounts
        // start theirs once the encrypted copy has been read (_settings).
        if (!u || u.isAnonymous) { try { ensureBaseline(); } catch (_) {} return; }
        var tries = 0;
        (function attempt() {
          _flush(u.uid).then(function (r) {
            if (r === 'no-key' && ++tries < 12) setTimeout(attempt, 2500);
          });
        })();
      });
    } catch (_) {}
  }
  root.addEventListener('load', _watchAuth);

  root.BB = root.BB || {};
  root.BB.medHistory = {
    get: historyGet,
    record: record,
    ensureBaseline: ensureBaseline,
    merge: mergeHistory,
    mergeIn: mergeIn,
  };
  root.BB.medLog = {
    FIELDS: Object.assign({}, LOG_FIELDS),
    all: logAll,
    list: logList,
    put: logPut,
    remove: logRemove,
    mergeIn: logMergeIn,
    merge: mergeById,
  };
  // "Show blood results on my charts" (journal ⚙️ Settings and the New
  // features sheet, v358). Unticked by default; this device only.
  var BLOOD_CHARTS_KEY = 'bbBloodOnCharts';
  root.BB.bloodCharts = {
    KEY: BLOOD_CHARTS_KEY,
    isOn: function () { return lsGet(BLOOD_CHARTS_KEY) === '1'; },
    set: function (on) {
      if (on) lsSet(BLOOD_CHARTS_KEY, '1'); else lsDel(BLOOD_CHARTS_KEY);
      try { root.dispatchEvent(new CustomEvent('bb:bloodcharts', { detail: { on: !!on } })); } catch (_) {}
      return true;
    },
  };
  root.BB.secure = {
    SETTINGS: SETTINGS.slice(),
    PERSONAL: PERSONAL.slice(),
    key: key,
    settings: settings,
    saveSettings: saveSettings,
    personal: personal,
    savePersonal: savePersonal,
    resetPatch: resetPatch,
    mergeView: mergeView,
    clearPending: clearPending,
    flush: function () { var u = currentUser(); return u ? _flush(u.uid) : Promise.resolve('no-user'); },
    _hasContent: hasContent,
  };
})();
