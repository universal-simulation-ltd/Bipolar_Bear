/**
 * @file js/shared/tracking-manager.js — BB.trackingManager: the Survival
 * Kit's 📈 Additional tracking section (James, 2026-11-20: "In the survival
 * kit, add a section to manage the additional tracking that's used in
 * Bipolar Bear Journal").
 *
 * The same trackers as the journal's 📊 Track Data, on the same storage, so a
 * change here is what the journal asks next time (and the other way round):
 *   - switch each one on or off (`trackGoals`, `trackBudget`, `trackAnxiety`,
 *     `trackAlcohol`, `trackCustom_<id>`);
 *   - rename one and change its emoji (Alcohol, Added Sugar and every added
 *     tracker; Goals, Budget and Emotions keep their names, 🔒 like Track
 *     Data). Saved as you type; ✕ puts back what was there;
 *   - add a tracker, choosing its answer type (yes / no, no / yes reversed,
 *     or a −2 … +2 scale) — a new tracker has no answers, so any type is safe;
 *   - the ➕ Additional step's own switch, when it is off (`disabledSteps`).
 *
 * Two things need the journal's opened entries, so they hand over to it
 * (journal.html?openTrackData=…, handled in js/journal.js BLOCK 6):
 *   - Delete… → the journal's Stop / Delete-with-its-answers sheet for that
 *     tracker (`openTrackData=<tid>`, tid as in js/journal.js `_trkAll()`);
 *   - changing an existing tracker's answer type, which locks once it has
 *     answers (`openTrackData=1` opens Track Data).
 * The Survival Kit never reads or writes an entry.
 *
 * Storage mirrors js/journal.js exactly (FIELD_PICKER_FIELDS,
 * getCustomFields, syncTrackingPrefsToFirestore): `customTrackingFields`
 * (array of { id, label, emoji, positive?: 'no', scale?: true }, minus the
 * ids in `deletedCustomTrackers`), `_labelOverride_<pref>` ("🍺 Name") for
 * the renameable fixed rows, `bbFieldBlank_<pref>` for a fixed row deleted
 * into an empty slot. Signed in, the same three fields go to
 * userSettings/{uid} (trackingFields, customTrackingFields, labelOverrides),
 * plaintext like the journal writes them; js/survival-kit.js reads them back
 * on sign-in. Keep the two in step if either changes.
 *
 *   BB.trackingManager.render()   draw the section into #skTrackList
 */
(function () {
  'use strict';
  var BB = window.BB = window.BB || {};

  function t(k, v) { try { return BB.t(k, v); } catch (_) { return k; } }
  function T(k, v) { return t('sktrk.' + k, v); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (_) {} }
  function lsJson(k, dflt) { try { var v = JSON.parse(lsGet(k) || 'null'); return v == null ? dflt : v; } catch (_) { return dflt; } }

  // The journal's fixed rows (js/journal.js FIELD_PICKER_FIELDS + _TRK_BUILTINS).
  var FIXED = [
    { pref: 'trackGoals', tid: 'b:goals', label: function () { return t('journal.field.goals'); }, sub: function () { return t('journal.ui.fieldSetUp'); } },
    { pref: 'trackBudget', tid: 'b:budget', label: function () { return t('journal.field.budget'); }, sub: function () { return t('journal.ui.fieldSetUp'); } },
    { pref: 'trackAnxiety', tid: 'b:emotions', legacy: 'trackEmotions', label: function () { return '😰 ' + t('journal.label.emotions'); }, sub: function () { return t('journal.ui.fieldThreeQs'); } },
    { pref: 'trackAlcohol', tid: 'b:alcohol', renameable: true, label: function () { return t('journal.field.alcohol'); }, sub: function () { return t('journal.ui.fieldReverse'); } },
    { pref: 'trackCustom_addedSugar', tid: 'c:addedSugar', renameable: true, label: function () { return '🍫 ' + t('t143.j.addedSugar'); }, sub: function () { return t('journal.ui.fieldReverse'); } },
  ];
  // Switchless built-ins whose names js/journal.js syncs too.
  var OLD_PREFS = ['trackExercise', 'trackOutside', 'trackSmoking', 'trackDrugs'];

  var EMOJI = ['😴', '🧘', '🏃', '🚴', '🏊', '🤸', '🧗', '⚽', '🎾', '🥗', '🍎', '🍵', '💧', '💉', '🩺', '❤️',
    '🧠', '😊', '😢', '😡', '🤒', '🌞', '🌧️', '🌿', '📚', '🎵', '🎨', '🛁', '🐾', '🍫', '💪', '🍺'];

  // ── Reading ──
  function tombstones() { var a = lsJson('deletedCustomTrackers', []); return Array.isArray(a) ? a.filter(function (x) { return typeof x === 'string'; }) : []; }
  /** The stored list as it is (it can hold the Added Sugar default, `builtin`). */
  function rawFields() { var a = lsJson('customTrackingFields', []); return Array.isArray(a) ? a.filter(function (f) { return f && typeof f.id === 'string'; }) : []; }
  /** Added trackers, the way Track Data lists them (no built-ins, none deleted). */
  function ownFields() {
    var dead = tombstones();
    return rawFields().filter(function (f) { return !f.builtin && dead.indexOf(f.id) === -1; });
  }
  /** js/journal.js getCustomFields(): the Added Sugar default (unless deleted or duplicated) + the user's own. */
  function journalCustomFields() {
    var dead = tombstones();
    var user = rawFields().filter(function (f) { return dead.indexOf(f.id) === -1; });
    var deleted = lsJson('deletedDefaultCustomFields', []);
    var sugarLabel = t('t143.j.addedSugar');
    var defs = [];
    var dupe = user.some(function (u) { return u.id === 'addedSugar' || (u.label && String(u.label).toLowerCase() === sugarLabel.toLowerCase()); });
    if (!(Array.isArray(deleted) && deleted.indexOf('addedSugar') !== -1) && !dupe) {
      var d = { id: 'addedSugar', label: sugarLabel, emoji: '🍫', positive: 'no', builtin: true };
      var ov = lsGet('_labelOverride_trackCustom_addedSugar');
      if (ov) { d.label = ov.replace(/^\S+\s*/, ''); d.emoji = ov.split(' ')[0] || d.emoji; }
      defs.push(d);
    }
    return defs.concat(user);
  }
  function isBlank(pref) { return lsGet('bbFieldBlank_' + pref) === '1'; }
  /** On, read the way Track Data reads it (Budget counts as on until set). */
  function fixedOn(f) {
    var v = lsGet(f.pref);
    if (v !== null) return v === 'true';
    if (f.legacy) return lsGet(f.legacy) === 'true';
    return f.pref === 'trackBudget';
  }
  function fixedLabel(f) {
    if (f.renameable && isBlank(f.pref)) return '';
    return (f.renameable && lsGet('_labelOverride_' + f.pref)) || f.label();
  }
  function splitLabel(lbl) { var m = String(lbl || '').match(/^(\S+)\s+(.*)$/); return m && /\p{Extended_Pictographic}/u.test(m[1]) ? { emoji: m[1], name: m[2] } : { emoji: '', name: String(lbl || '') }; }
  function typeOf(f) { return f.scale ? 'scale' : f.positive === 'no' ? 'rev' : 'yn'; }
  function typeSub(f) { var ty = typeOf(f); return ty === 'scale' ? t('journal.ui.cfScaleSub') : ty === 'rev' ? t('journal.ui.fieldReverse') : ''; }
  function stepOff() { var d = lsJson('disabledSteps', []); return Array.isArray(d) && d.indexOf('more_data') !== -1; }

  // ── Writing ──
  function touched() { lsSet('_sk_savedAt', String(Date.now())); } // js/survival-kit.js: don't let a slow settings load overwrite it
  var _syncTimer = null;
  /** js/journal.js syncTrackingPrefsToFirestore(), the same three fields. */
  function syncNow() {
    clearTimeout(_syncTimer);
    var db = window.db, user = window.currentUser;
    if (!db || !user) return;
    var prefs = {};
    FIXED.forEach(function (f) { prefs[f.pref] = lsGet(f.pref) === 'true'; });
    var fields = journalCustomFields();
    fields.forEach(function (f) { prefs['trackCustom_' + f.id] = lsGet('trackCustom_' + f.id) === 'true'; });
    var labels = {};
    FIXED.filter(function (f) { return f.renameable; }).forEach(function (f) { labels[f.pref] = lsGet('_labelOverride_' + f.pref) || null; });
    OLD_PREFS.forEach(function (p) { labels[p] = lsGet('_labelOverride_' + p) || null; });
    var own = {};
    fields.forEach(function (f) { own[f.id] = true; });
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('_labelOverride_trackCustom_') === 0 && !own[k.slice('_labelOverride_trackCustom_'.length)]) labels[k.slice('_labelOverride_'.length)] = lsGet(k);
      }
    } catch (_) {}
    try {
      db.collection('userSettings').doc(user.uid).set({ trackingFields: prefs, customTrackingFields: fields, labelOverrides: labels }, { merge: true }).catch(function () {});
    } catch (_) {}
  }
  function syncSoon() { clearTimeout(_syncTimer); _syncTimer = setTimeout(syncNow, 1500); }

  function setOn(pref, on, legacy) {
    lsSet(pref, on ? 'true' : 'false');
    if (legacy) lsDel(legacy);
    if (pref === 'trackAnxiety') lsDel('trackEmotions');
    touched();
    syncNow();
  }
  function writeOwn(id, patch) {
    var list = rawFields().map(function (f) { if (f.id !== id) return f; var n = {}; for (var k in f) n[k] = f[k]; for (var p in patch) n[p] = patch[p]; return n; });
    lsSet('customTrackingFields', JSON.stringify(list));
    touched();
  }

  // ── State ──
  var _edit = null;     // { kind: 'own'|'fixed', key, snap, pendingOn }
  var _emojiOpen = null; // 'edit' | 'add' | null
  var _addEmoji = '';
  var _addType = 'yn';
  var _status = '';

  function host() { return document.getElementById('skTrackList'); }

  // ── Drawing ──
  function swHtml(key, on, name) {
    return '<label class="bb-switch"><input type="checkbox"' + (on ? ' checked' : '') + ' data-trk-sw="' + esc(key) + '" aria-label="' + esc(name) + '"><span class="bb-slider"></span></label>';
  }
  function editBtn(key, name) {
    return '<button type="button" class="sktrk-ico" data-trk-edit="' + esc(key) + '" aria-label="' + esc(T('edit', { name: name })) + '" title="' + esc(T('edit', { name: name })) + '">✏️</button>';
  }
  function emojiGrid(where) {
    var any = '<input type="text" class="sktrk-anyemoji" data-trk-anyemoji="' + where + '" maxlength="8" inputmode="text" placeholder="' + esc(t('journal.ui.anyEmoji')) + '" aria-label="' + esc(t('journal.ui.anyEmoji')) + '">';
    return '<div class="sktrk-emojis"' + (_emojiOpen === where ? '' : ' hidden') + ' data-trk-grid="' + where + '">' + any +
      EMOJI.map(function (e) { return '<button type="button" data-trk-emoji="' + where + '" data-e="' + esc(e) + '">' + e + '</button>'; }).join('') + '</div>';
  }
  function deleteLink(tid) {
    return '<button type="button" class="sktrk-del" data-trk-del="' + esc(tid) + '">🗑️ ' + esc(t('trk143.deleteBtn')) + '</button>';
  }
  function editPanel(opts) {
    // opts: { key, emoji, name, max, locked, tid, own }
    var lead = opts.locked
      ? '<div class="sktrk-emoji-btn sktrk-locked" aria-hidden="true">' + esc(opts.emoji || '🏷️') + '</div>'
      : '<button type="button" class="sktrk-emoji-btn" data-trk-emojibtn="edit" aria-label="' + esc(t('journal.ui.pickEmoji')) + '" title="' + esc(t('journal.ui.pickEmoji')) + '">' + esc(opts.emoji || '🏷️') + '</button>';
    var field = opts.locked
      ? '<div class="sktrk-name sktrk-locked" role="textbox" aria-readonly="true" aria-label="' + esc(t('journal.ui.nameLocked')) + '" title="' + esc(t('journal.ui.nameLocked')) + '"><span>' + esc(opts.name) + '</span><span aria-hidden="true">🔒</span></div>'
      : '<input type="text" class="sktrk-name" id="sktrkEditInput" value="' + esc(opts.name) + '" maxlength="' + opts.max + '" placeholder="' + esc(t('journal.ui.addName')) + '" aria-label="' + esc(t('journal.ui.renameField')) + '">';
    var close = '<button type="button" class="sktrk-x" data-trk-cancel aria-label="' + esc(t('common.cancel')) + '" title="' + esc(t('common.cancel')) + '">✕</button>';
    var notes = '';
    if (opts.own) notes += '<p class="sktrk-note">' + esc(T('typeLabel')) + ': <strong>' + esc(T(opts.type === 'scale' ? 'typeScale' : opts.type === 'rev' ? 'typeRev' : 'typeYn')) + '</strong>. ' + esc(T('typeNote')) + '</p>';
    return '<div class="sktrk-edit" data-trk-row="' + esc(opts.key) + '">' +
      '<div class="sktrk-edit-line">' + lead + field + close + '</div>' +
      (opts.locked ? '' : emojiGrid('edit')) + notes +
      '<div class="sktrk-edit-foot">' + deleteLink(opts.tid) + '<button type="button" class="sktrk-btn" data-trk-done>' + esc(t('journal.mods.done')) + '</button></div>' +
      '<p class="sktrk-note sktrk-delnote">' + esc(T('deleteNote')) + '</p>' +
      '</div>';
  }
  function row(key, on, name, sub, nameHtml) {
    return '<div class="sktrk-row" data-trk-row="' + esc(key) + '">' +
      editBtn(key, name) +
      '<div class="sktrk-label" data-trk-tap="' + esc(key) + '"><div class="sktrk-title">' + (nameHtml || esc(name)) + '</div>' +
      (sub ? '<div class="sktrk-sub">' + esc(sub) + '</div>' : '') + '</div>' +
      swHtml(key, on, name) + '</div>';
  }

  function render() {
    var el = host();
    if (!el) return;
    var keepFocus = document.activeElement && el.contains(document.activeElement) ? (document.activeElement.id || document.activeElement.getAttribute('data-trk-sw') || document.activeElement.getAttribute('data-trk-edit')) : null;
    var html = '';
    if (stepOff()) {
      html += '<div class="sktrk-stepoff" role="status"><span>' + esc(T('stepOff')) + '</span><button type="button" class="sktrk-btn" data-trk-stepon>' + esc(T('stepOn')) + '</button></div>';
    }
    html += '<div class="sktrk-list" role="list" aria-label="' + esc(T('listLabel')) + '">';
    FIXED.forEach(function (f) {
      var lbl = fixedLabel(f);
      var parts = splitLabel(lbl || f.label());
      if (_edit && _edit.kind === 'fixed' && _edit.key === f.pref) {
        html += editPanel({ key: f.pref, emoji: _edit.emoji != null ? _edit.emoji : parts.emoji, name: lbl ? parts.name : '', max: 20, locked: !f.renameable, tid: f.tid });
        return;
      }
      var blankHtml = lbl ? null : '<span class="sktrk-blank">[' + esc(t('journal.ui.addName')) + ']</span>';
      var nameHtml = blankHtml || (f.renameable ? null : esc(lbl) + ' <span class="sktrk-lock" title="' + esc(t('journal.ui.nameLocked')) + '" aria-label="' + esc(t('journal.ui.nameLocked')) + '">🔒</span>');
      html += row(f.pref, fixedOn(f), lbl || t('journal.ui.addName'), f.sub(), nameHtml);
    });
    ownFields().forEach(function (f) {
      var key = 'trackCustom_' + f.id;
      var name = (f.emoji ? f.emoji + ' ' : '') + (f.label || '');
      if (_edit && _edit.kind === 'own' && _edit.key === f.id) {
        html += editPanel({ key: key, emoji: _edit.emoji != null ? _edit.emoji : (f.emoji || ''), name: f.label || '', max: 15, tid: 'c:' + f.id, own: true, type: typeOf(f) });
        return;
      }
      html += row(key, lsGet(key) === 'true', name, typeSub(f));
    });
    html += '</div>';

    // Add a tracker
    var types = [['yn', 'typeYn'], ['rev', 'typeRev'], ['scale', 'typeScale']];
    var help = _addType === 'scale' ? t('journal.ui.cfScaleSub') : _addType === 'rev' ? t('journal.ui.fieldReverse') : T('typeYnHelp');
    html += '<div class="sktrk-add">' +
      '<h3 class="sktrk-add-title">' + esc(T('addTitle')) + '</h3>' +
      '<div class="sktrk-edit-line">' +
        '<button type="button" class="sktrk-emoji-btn" data-trk-emojibtn="add" aria-label="' + esc(t('journal.ui.pickEmoji')) + '" title="' + esc(t('journal.ui.pickEmoji')) + '">' + esc(_addEmoji || '🏷️') + '</button>' +
        '<input type="text" class="sktrk-name" id="sktrkAddInput" maxlength="15" placeholder="' + esc(t('journal.ui.newFieldName')) + '" aria-label="' + esc(t('journal.ui.newFieldName')) + '">' +
        '<button type="button" class="sktrk-btn sktrk-btn-main" data-trk-add>' + esc(T('add')) + '</button>' +
      '</div>' + emojiGrid('add') +
      '<div class="sktrk-types" role="radiogroup" aria-label="' + esc(T('typeLabel')) + '">' +
        types.map(function (ty) { var on = _addType === ty[0]; return '<button type="button" role="radio" aria-checked="' + on + '" class="sktrk-type' + (on ? ' on' : '') + '" data-trk-type="' + ty[0] + '">' + esc(T(ty[1])) + '</button>'; }).join('') +
      '</div>' +
      '<p class="sktrk-note sktrk-typehelp">' + esc(help) + '</p>' +
      '<p class="sktrk-status" role="status" aria-live="polite">' + esc(_status) + '</p>' +
    '</div>';
    html += '<button type="button" class="sktrk-journal" data-trk-journal>📊 ' + esc(T('openJournal')) + ' →</button>';

    // Keep what's being typed in the add box across a re-draw.
    var addNow = document.getElementById('sktrkAddInput');
    var addVal = addNow ? addNow.value : '';
    el.innerHTML = html;
    if (addVal) { var a = document.getElementById('sktrkAddInput'); if (a) a.value = addVal; }
    if (keepFocus) {
      var back = document.getElementById(keepFocus) || el.querySelector('[data-trk-sw="' + keepFocus + '"],[data-trk-edit="' + keepFocus + '"]');
      if (back) { try { back.focus({ preventScroll: true }); } catch (_) {} }
    }
  }

  // ── Editing a name (saved as you type, like Track Data since v422) ──
  function openEdit(key) {
    finishEdit();
    _emojiOpen = null;
    if (key.indexOf('trackCustom_') === 0 && key !== 'trackCustom_addedSugar') {
      var id = key.slice('trackCustom_'.length);
      var f = ownFields().filter(function (x) { return x.id === id; })[0];
      if (!f) return;
      _edit = { kind: 'own', key: id, emoji: f.emoji || '', snap: JSON.parse(JSON.stringify(f)) };
    } else {
      var fx = FIXED.filter(function (x) { return x.pref === key; })[0];
      if (!fx) return;
      var lbl = fixedLabel(fx);
      _edit = { kind: 'fixed', key: key, emoji: splitLabel(lbl || fx.label()).emoji, snap: lsGet('_labelOverride_' + key), blank: isBlank(key) };
    }
    render();
    var inp = document.getElementById('sktrkEditInput');
    if (inp) { try { inp.focus({ preventScroll: true }); var n = inp.value.length; inp.setSelectionRange(n, n); } catch (_) {} }
  }
  /** Write what's in the open edit row now, without closing it. */
  function live() {
    if (!_edit) return;
    var inp = document.getElementById('sktrkEditInput');
    if (!inp) return;
    var name = inp.value.trim();
    if (_edit.kind === 'own') {
      writeOwn(_edit.key, { label: name || _edit.snap.label, emoji: _edit.emoji || '' });
    } else {
      if (name) lsSet('_labelOverride_' + _edit.key, (_edit.emoji ? _edit.emoji + ' ' : '') + name);
      else if (_edit.snap != null) lsSet('_labelOverride_' + _edit.key, _edit.snap);
      else lsDel('_labelOverride_' + _edit.key);
      touched();
    }
    syncSoon();
  }
  /** Close the open edit row, keeping what's in it. */
  function finishEdit() {
    if (!_edit) return;
    var e = _edit;
    var inp = document.getElementById('sktrkEditInput');
    var name = inp ? inp.value.trim() : '';
    if (inp) live();
    if (e.kind === 'fixed' && inp) {
      if (name) {
        lsDel('bbFieldBlank_' + e.key);
        if (e.pendingOn) lsSet(e.key, 'true');
      } else if (e.blank) {
        lsDel('_labelOverride_' + e.key); // still an empty slot
      }
    }
    _edit = null;
    _emojiOpen = null;
    if (inp) syncNow();
  }
  /** ✕: put the name and emoji back as they were. */
  function cancelEdit() {
    if (!_edit) return;
    var e = _edit;
    if (e.kind === 'own') {
      if (rawFields().some(function (f) { return f.id === e.key; })) writeOwn(e.key, { label: e.snap.label, emoji: e.snap.emoji || '' });
    } else if (FIXED.some(function (f) { return f.pref === e.key && f.renameable; })) {
      if (e.snap != null) lsSet('_labelOverride_' + e.key, e.snap); else lsDel('_labelOverride_' + e.key);
    }
    _edit = null;
    _emojiOpen = null;
    syncNow();
    render();
  }
  function pickEmoji(where, emoji) {
    if (where === 'edit' && _edit) {
      _edit.emoji = emoji;
      _emojiOpen = null;
      var inp = document.getElementById('sktrkEditInput');
      var val = inp ? inp.value : null;
      live();
      render();
      var again = document.getElementById('sktrkEditInput');
      if (again && val != null) again.value = val;
    } else if (where === 'add') {
      _addEmoji = emoji;
      _emojiOpen = null;
      render();
    }
  }

  // ── Adding ──
  function add() {
    var inp = document.getElementById('sktrkAddInput');
    var label = inp ? inp.value.trim() : '';
    if (!label) { if (inp) inp.focus(); return; }
    finishEdit();
    var id = 'custom_' + Date.now();
    var f = { id: id, label: label, emoji: _addEmoji || '' };
    if (_addType === 'rev') f.positive = 'no';
    if (_addType === 'scale') f.scale = true;
    var list = rawFields();
    list.push(f);
    lsSet('customTrackingFields', JSON.stringify(list));
    lsSet('trackCustom_' + id, 'true');
    touched();
    syncNow();
    _addEmoji = '';
    _addType = 'yn';
    _status = T('added', { name: (f.emoji ? f.emoji + ' ' : '') + label });
    if (inp) inp.value = '';
    render();
  }

  // ── Handing over to the journal ──
  function toJournal(arg) {
    finishEdit();
    location.href = 'journal.html?openTrackData=' + encodeURIComponent(arg || '1');
  }

  // ── Events (delegated; ids never sit in onclick) ──
  function onClick(e) {
    var el = host();
    if (!el || !el.contains(e.target)) return;
    var b = e.target.closest('button,[data-trk-tap]');
    if (!b) return;
    var v;
    if ((v = b.getAttribute('data-trk-edit'))) { if (_edit && (_edit.kind === 'own' ? 'trackCustom_' + _edit.key : _edit.key) === v) { finishEdit(); render(); } else openEdit(v); return; }
    if ((v = b.getAttribute('data-trk-tap'))) { var sw = el.querySelector('[data-trk-sw="' + v + '"]'); if (sw) { sw.checked = !sw.checked; toggle(v, sw.checked); } return; }
    if (b.hasAttribute('data-trk-cancel')) { cancelEdit(); return; }
    if (b.hasAttribute('data-trk-done')) { var was = _edit ? (_edit.kind === 'own' ? 'trackCustom_' + _edit.key : _edit.key) : null; finishEdit(); render(); var eb = was && el.querySelector('[data-trk-edit="' + was + '"]'); if (eb) { try { eb.focus({ preventScroll: true }); } catch (_) {} } return; }
    if ((v = b.getAttribute('data-trk-emojibtn'))) {
      if (v === 'add') finishEdit();
      _emojiOpen = _emojiOpen === v ? null : v;
      var keep = document.getElementById('sktrkEditInput');
      var kv = keep ? keep.value : null;
      render();
      var k2 = document.getElementById('sktrkEditInput');
      if (k2 && kv != null) k2.value = kv;
      return;
    }
    if ((v = b.getAttribute('data-trk-emoji'))) { pickEmoji(v, b.getAttribute('data-e')); return; }
    if ((v = b.getAttribute('data-trk-type'))) { _addType = v; render(); var ai = document.getElementById('sktrkAddInput'); var tb = el.querySelector('[data-trk-type="' + v + '"]'); if (tb) tb.focus({ preventScroll: true }); else if (ai) ai.focus(); return; }
    if (b.hasAttribute('data-trk-add')) { add(); return; }
    if ((v = b.getAttribute('data-trk-del'))) { toJournal(v); return; }
    if (b.hasAttribute('data-trk-journal')) { toJournal('1'); return; }
    if (b.hasAttribute('data-trk-stepon')) {
      var dis = lsJson('disabledSteps', []);
      dis = (Array.isArray(dis) ? dis : []).filter(function (x) { return x !== 'more_data'; });
      lsSet('disabledSteps', JSON.stringify(dis));
      touched();
      try { if (window.db && window.currentUser) window.db.collection('userSettings').doc(window.currentUser.uid).set({ disabledSteps: dis }, { merge: true }).catch(function () {}); } catch (_) {}
      render();
    }
  }
  function toggle(key, on) {
    var fx = FIXED.filter(function (f) { return f.pref === key; })[0];
    // An empty slot (deleted Alcohol / Added Sugar) needs a name before it goes on.
    if (fx && fx.renameable && on && isBlank(key)) {
      openEdit(key);
      if (_edit) _edit.pendingOn = true;
      return;
    }
    finishEdit();
    setOn(key, on, fx && fx.legacy);
    render();
  }
  function onChange(e) {
    var el = host();
    if (!el || !el.contains(e.target)) return;
    var key = e.target.getAttribute && e.target.getAttribute('data-trk-sw');
    if (key) toggle(key, !!e.target.checked);
  }
  function onInput(e) {
    var el = host();
    if (!el || !el.contains(e.target)) return;
    if (e.target.id === 'sktrkEditInput') { live(); return; }
    var where = e.target.getAttribute && e.target.getAttribute('data-trk-anyemoji');
    if (where) {
      var m = String(e.target.value || '').match(/\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*/u);
      if (m) pickEmoji(where, m[0]);
    }
  }
  function onKey(e) {
    var el = host();
    if (!el || !el.contains(e.target)) return;
    if (e.key !== 'Enter') return;
    if (e.target.id === 'sktrkEditInput') { e.preventDefault(); finishEdit(); render(); }
    else if (e.target.id === 'sktrkAddInput') { e.preventDefault(); add(); }
  }

  function init() {
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('input', onInput);
    document.addEventListener('keydown', onKey);
    document.addEventListener('bb:languagechange', render);
    // Another tab (the journal open beside it on the web) changed a tracker.
    window.addEventListener('storage', function (e) {
      if (!e.key || /^(track|customTrackingFields|_labelOverride_|bbFieldBlank_|deletedCustomTrackers|deletedDefaultCustomFields|disabledSteps)/.test(e.key)) { if (!_edit) render(); }
    });
    // Leaving the page with a name half typed: it's already saved; send it now.
    window.addEventListener('pagehide', function () { if (_edit) finishEdit(); else if (_syncTimer) syncNow(); });
    render();
  }

  BB.trackingManager = { render: render, sync: syncNow };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
