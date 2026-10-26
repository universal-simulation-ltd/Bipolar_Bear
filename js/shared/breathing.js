/**
 * @file js/shared/breathing.js — BB.breathing: guided breathing exercises
 * (James, 2026-10-26: "a breathing section to the Survival Kit of different
 * breathing techniques … X in and X out with an accompanying noise /
 * animation … allow them to select their favourite. Then in the journal ask
 * if they'd like to do a breathing exercise if they responded anything but
 * stable (5)"). DOCS.md §2.31 is the reference.
 *
 *   BB.breathing.list()            the techniques, the favourite first
 *   BB.breathing.get(id)           one technique { id, icon, phases }
 *   BB.breathing.favourite()       the starred id, or null
 *   BB.breathing.setFavourite(id)  star one (null / the same id unstars)
 *   BB.breathing.open({ id })      the player sheet, on `id` or the favourite
 *   BB.breathing.close()
 *   BB.breathing.isOpen()
 *   BB.breathing.promptsOn()       the journal's "Breathing prompts" switch
 *   BB.breathing.setPrompts(on)    writes it here and to userSettings
 *   BB.breathing.renderList(host)  the Survival Kit section's cards
 *
 * The player: a circle that grows as you breathe in and shrinks as you
 * breathe out, the step and a countdown, a soft breath sound made with Web
 * Audio (no files) and a light tap on phones at each step. 1, 3 or 5 minutes;
 * it always finishes the round it is on. Nothing here is saved anywhere but
 * the device, apart from the prompts switch (userSettings.breathPromptsEnabled,
 * like the journal's other switches).
 *
 * localStorage: bbBreathFav (technique id), bbBreathMins ('1' | '3' | '5'),
 * bbBreathMute ('1' = no sound), breathPromptsEnabled ('1' = on; off until
 * someone turns it on).
 */
(function () {
  'use strict';
  var BB = window.BB = window.BB || {};

  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) {} }
  function tr(k, v) {
    var key = 'breathe.' + k;
    try { var s = BB.t(key, v); if (s && s !== key) return s; } catch (_) {}
    return k;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Phases: in = breathe in, in2 = a second short breath in on top, hold,
  // out = breathe out. Seconds each.
  var TECHNIQUES = [
    { id: 'longout', icon: '🌬️', phases: [['in', 4], ['out', 6]] },
    { id: 'box', icon: '🟦', phases: [['in', 4], ['hold', 4], ['out', 4], ['hold', 4]] },
    { id: 'even', icon: '🌊', phases: [['in', 5], ['out', 5]] },
    { id: '478', icon: '🌙', phases: [['in', 4], ['hold', 7], ['out', 8]] },
    { id: 'sigh', icon: '😮‍💨', phases: [['in', 2], ['in2', 1], ['out', 6]] },
  ];
  var MINS = [1, 3, 5];

  function get(id) {
    for (var i = 0; i < TECHNIQUES.length; i++) if (TECHNIQUES[i].id === id) return TECHNIQUES[i];
    return null;
  }
  function favourite() { var f = lsGet('bbBreathFav'); return get(f) ? f : null; }
  function setFavourite(id) {
    lsSet('bbBreathFav', id && get(id) && id !== favourite() ? id : null);
    try { document.dispatchEvent(new CustomEvent('bb:breathfav')); } catch (_) {}
  }
  function list() {
    var f = favourite();
    if (!f) return TECHNIQUES.slice();
    return [get(f)].concat(TECHNIQUES.filter(function (x) { return x.id !== f; }));
  }
  function mins() { var m = Number(lsGet('bbBreathMins')); return MINS.indexOf(m) >= 0 ? m : 1; }
  function muted() { return lsGet('bbBreathMute') === '1'; }
  function name(tq) { return tr('t.' + tq.id + '.name'); }
  /** "In 4 · Hold 4 · Out 4 · Hold 4" */
  function pattern(tq) {
    var key = { in: 'patIn', in2: 'patIn2', hold: 'patHold', out: 'patOut' };
    return tq.phases.map(function (p) { return tr(key[p[0]], { n: p[1] }); }).join(' · ');
  }

  // ── The journal's prompts switch ──────────────────────────────────────
  function promptsOn() { return lsGet('breathPromptsEnabled') === '1'; }
  function setPrompts(on) {
    lsSet('breathPromptsEnabled', on ? '1' : '0');
    try {
      if (window.db && window.currentUser) {
        window.db.collection('userSettings').doc(window.currentUser.uid)
          .set({ breathPromptsEnabled: !!on }, { merge: true }).catch(function () {});
      }
    } catch (_) {}
    try { document.dispatchEvent(new CustomEvent('bb:breathprompts', { detail: { on: !!on } })); } catch (_) {}
    return true;
  }

  // ── Sound (Web Audio, made on the fly) ───────────────────────────────
  // A soft rush of filtered noise that swells as you breathe in and fades as
  // you breathe out, and a quiet bell at each step. Built on the Start tap
  // (browsers only allow sound after one).
  var AC = null;
  function audioCtx() {
    if (!AC) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      try { AC = new C(); } catch (_) { return null; }
    }
    try { if (AC.state === 'suspended') AC.resume(); } catch (_) {}
    return AC;
  }
  function audioStart() {
    var ac = audioCtx();
    if (!ac) return null;
    try {
      var len = ac.sampleRate * 2, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0), last = 0;
      for (var i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
      var src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
      var filter = ac.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 300; filter.Q.value = 0.7;
      var gain = ac.createGain(); gain.gain.value = 0;
      var master = ac.createGain(); master.gain.value = muted() ? 0 : 1;
      src.connect(filter); filter.connect(gain); gain.connect(master); master.connect(ac.destination);
      src.start();
      return { ac: ac, src: src, filter: filter, gain: gain, master: master };
    } catch (_) { return null; }
  }
  function ramp(param, to, t0, secs, exp) {
    try {
      param.cancelScheduledValues(t0);
      param.setValueAtTime(param.value, t0);
      if (exp) param.exponentialRampToValueAtTime(Math.max(0.0001, to), t0 + secs);
      else param.linearRampToValueAtTime(to, t0 + secs);
    } catch (_) {}
  }
  function bell(a, freq) {
    try {
      var t = a.ac.currentTime, o = a.ac.createOscillator(), g = a.ac.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      o.connect(g); g.connect(a.master);
      o.start(t); o.stop(t + 1.5);
    } catch (_) {}
  }
  function audioPhase(a, kind, secs) {
    if (!a) return;
    var t = a.ac.currentTime;
    if (kind === 'in' || kind === 'in2') {
      ramp(a.gain.gain, kind === 'in2' ? 0.3 : 0.22, t, secs);
      ramp(a.filter.frequency, kind === 'in2' ? 1500 : 1200, t, secs, true);
      bell(a, kind === 'in2' ? 784 : 660);
    } else if (kind === 'out') {
      ramp(a.gain.gain, 0, t, secs);
      ramp(a.filter.frequency, 250, t, secs, true);
      bell(a, 440);
    } else {
      ramp(a.gain.gain, 0, t, 0.4);
      bell(a, 523);
    }
  }
  function audioStop(a) {
    if (!a) return;
    try {
      var t = a.ac.currentTime;
      ramp(a.gain.gain, 0, t, 0.3);
      a.src.stop(t + 0.4);
    } catch (_) {}
  }

  // ── The player sheet ──────────────────────────────────────────────────
  var STYLE =
    '.bbbr-back{position:fixed;inset:0;z-index:3100;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px 12px;}' +
    '@media (max-width:700px){.bbbr-back{align-items:flex-end;padding:0}.bbbr-sheet{border-radius:20px 20px 0 0!important;max-width:none!important;padding-bottom:calc(18px + env(safe-area-inset-bottom,0px))!important}}' +
    '.bbbr-sheet{position:relative;background:#fff;color:#212529;width:100%;max-width:420px;max-height:92dvh;overflow-y:auto;border-radius:20px;padding:18px 18px 18px;box-sizing:border-box;box-shadow:0 10px 40px rgba(0,0,0,.25);font-family:inherit;animation:bbbrUp .25s ease;text-align:center}' +
    '@keyframes bbbrUp{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}' +
    '.bbbr-top{display:grid;grid-template-columns:44px 1fr 44px;align-items:center;margin-bottom:8px}' +
    '.bbbr-h{grid-column:2;margin:0;font-size:1.15em;font-weight:800}' +
    '.bbbr-x{grid-column:3;width:44px;height:44px;border:none;background:none;font-size:1.2em;color:#6c5f52;cursor:pointer;border-radius:50%;font-family:inherit}' +
    '.bbbr-chips{display:flex;gap:6px;overflow-x:auto;padding:2px 2px 8px;margin:0 -4px;scrollbar-width:none;-webkit-mask-image:linear-gradient(90deg,#000 88%,transparent);mask-image:linear-gradient(90deg,#000 88%,transparent)}' +
    '.bbbr-chips::-webkit-scrollbar{display:none}' +
    '.bbbr-chip{flex:0 0 auto;min-height:40px;padding:8px 14px;border-radius:20px;border:1.5px solid #e6dccd;background:#fff;color:inherit;font:inherit;font-size:.86em;font-weight:700;cursor:pointer;white-space:nowrap}' +
    '.bbbr-chip[aria-checked="true"]{background:#0b7285;border-color:#0b7285;color:#fff}' +
    '.bbbr-desc{font-size:.84em;color:#5c534a;line-height:1.45;margin:4px 4px 0;min-height:2.9em}' +
    '.bbbr-pat{font-size:.8em;font-weight:700;color:#0b7285;margin-top:4px}' +
    '.bbbr-stage{position:relative;height:230px;display:flex;align-items:center;justify-content:center;margin:6px 0 2px}' +
    '.bbbr-ring{position:absolute;width:210px;height:210px;border-radius:50%;border:2px dashed rgba(11,114,133,.25)}' +
    '.bbbr-orb{position:absolute;width:200px;height:200px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#99e9f2,#3bc9db 55%,#1098ad);box-shadow:0 0 40px rgba(16,152,173,.35);transform:scale(.5);opacity:.75;transition-property:transform,opacity;transition-timing-function:ease-in-out;will-change:transform}' +
    '@media (prefers-reduced-motion: reduce){.bbbr-orb{transform:scale(.8)!important}.bbbr-sheet{animation:none}}' +
    '.bbbr-mid{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;color:#0b3d47;text-shadow:0 1px 2px rgba(255,255,255,.6);pointer-events:none}' +
    '.bbbr-phase{font-weight:800;font-size:1.08em;max-width:170px;line-height:1.25}' +
    '.bbbr-count{font-size:2em;font-weight:800;line-height:1.1;min-height:1.1em;font-variant-numeric:tabular-nums}' +
    '.bbbr-left{font-size:.8em;color:#6c5f52;min-height:1.3em;font-variant-numeric:tabular-nums}' +
    '.bbbr-opts{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;align-items:center;margin:10px 0 12px}' +
    '.bbbr-seg{display:inline-flex;border:1.5px solid #e6dccd;border-radius:20px;overflow:hidden}' +
    '.bbbr-seg button{border:none;background:none;min-height:40px;padding:6px 12px;font:inherit;font-size:.82em;font-weight:700;color:inherit;cursor:pointer}' +
    '.bbbr-seg button[aria-checked="true"]{background:#e3fafc;color:#0b7285}' +
    '.bbbr-tog{min-height:40px;padding:6px 12px;border-radius:20px;border:1.5px solid #e6dccd;background:none;font:inherit;font-size:.82em;font-weight:700;color:inherit;cursor:pointer}' +
    '.bbbr-tog[aria-pressed="true"]{background:#fff4e6;border-color:#f59f00;color:#a35200}' +
    '.bbbr-go{width:100%;min-height:50px;padding:13px;border:none;border-radius:14px;background:#0b7285;color:#fff;font:inherit;font-weight:800;font-size:1.02em;cursor:pointer}' +
    '.bbbr-safe{font-size:.74em;color:#6c5f52;margin:10px 4px 0;line-height:1.4}' +
    '.bbbr-sheet button:focus-visible{outline:3px solid #f59f00;outline-offset:2px}' +
    // Survival Kit cards (renderList)
    '.bbbr-list{display:grid;gap:10px}' +
    '.bbbr-card{display:flex;align-items:center;gap:12px;padding:12px 12px 12px 14px;border:1.5px solid #e9ecef;border-radius:14px;background:#fff;text-align:left}' +
    '.bbbr-card.fav{border-color:#f59f00;background:#fffaf0}' +
    '.bbbr-card-ico{font-size:1.6em;line-height:1;flex:0 0 auto}' +
    '.bbbr-card-txt{flex:1 1 auto;min-width:0}' +
    '.bbbr-card-name{font-weight:800;font-size:.95em}' +
    '.bbbr-card-badge{display:inline-block;margin-left:6px;font-size:.72em;font-weight:700;color:#a35200;background:#fff4e6;border-radius:8px;padding:1px 6px;vertical-align:1px}' +
    '.bbbr-card-pat{font-size:.78em;font-weight:700;color:#0b7285;margin-top:2px}' +
    '.bbbr-card-desc{font-size:.8em;color:#5c534a;line-height:1.4;margin-top:2px}' +
    '.bbbr-card-btns{display:flex;flex-direction:column;gap:6px;flex:0 0 auto;align-items:stretch}' +
    '.bbbr-star{min-width:44px;min-height:40px;border:1.5px solid #e6dccd;border-radius:12px;background:none;font-size:1.15em;cursor:pointer;color:#c7b9a6;line-height:1}' +
    '.bbbr-star[aria-pressed="true"]{color:#f59f00;border-color:#f59f00}' +
    '.bbbr-play{min-height:40px;padding:6px 12px;border:none;border-radius:12px;background:#0b7285;color:#fff;font:inherit;font-weight:800;font-size:.85em;cursor:pointer;white-space:nowrap}' +
    '.bbbr-card button:focus-visible{outline:3px solid #f59f00;outline-offset:2px}' +
    // Dark
    'html.theme-dark .bbbr-sheet,html.theme-dark .bbbr-card{background:#2a221b;color:#f3e9dc}' +
    'html.theme-dark .bbbr-card{border-color:#4a3d31}html.theme-dark .bbbr-card.fav{border-color:#f59f00;background:#33281c}' +
    'html.theme-dark .bbbr-chip{background:#2a221b;border-color:#4a3d31}html.theme-dark .bbbr-chip[aria-checked="true"]{background:#0c8599;border-color:#0c8599}' +
    'html.theme-dark .bbbr-seg,html.theme-dark .bbbr-tog,html.theme-dark .bbbr-star{border-color:#4a3d31}' +
    'html.theme-dark .bbbr-seg button[aria-checked="true"]{background:#0b3d47;color:#99e9f2}' +
    'html.theme-dark .bbbr-tog[aria-pressed="true"]{background:#3d2a12;color:#ffc078;border-color:#f59f00}' +
    'html.theme-dark .bbbr-star[aria-pressed="true"]{color:#ffc078;border-color:#f59f00}' +
    'html.theme-dark .bbbr-desc,html.theme-dark .bbbr-card-desc{color:#d8c9b6}html.theme-dark .bbbr-left,html.theme-dark .bbbr-safe,html.theme-dark .bbbr-x{color:#c9b8a5}' +
    'html.theme-dark .bbbr-pat,html.theme-dark .bbbr-card-pat{color:#66d9e8}' +
    'html.theme-dark .bbbr-card-badge{background:#3d2a12;color:#ffc078}' +
    'html.theme-dark .bbbr-go,html.theme-dark .bbbr-play{background:#0c8599}';
  function injectStyle() {
    if (document.getElementById('bbbrStyle')) return;
    var st = document.createElement('style');
    st.id = 'bbbrStyle';
    st.textContent = STYLE;
    document.head.appendChild(st);
  }
  var reduced = false;
  try { reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) {}
  function haptic() { try { if (BB.nf && BB.nf.on && BB.nf.haptic) BB.nf.haptic('light'); } catch (_) {} }
  function fmt(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  var P = null; // the open player
  function el(sel) { return P && P.back.querySelector(sel); }

  function render() {
    if (!P) return;
    var tq = get(P.id);
    var chips = list().map(function (x) {
      return '<button type="button" class="bbbr-chip" role="radio" data-id="' + esc(x.id) + '" aria-checked="' + (x.id === P.id) + '">' +
        (x.id === favourite() ? '★ ' : '') + esc(name(x)) + '</button>';
    }).join('');
    var seg = MINS.map(function (m) {
      return '<button type="button" role="radio" data-m="' + m + '" aria-checked="' + (m === P.mins) + '">' + esc(tr('mins', { n: m })) + '</button>';
    }).join('');
    var isFav = favourite() === P.id;
    P.back.querySelector('.bbbr-sheet').innerHTML =
      '<div class="bbbr-top"><h2 class="bbbr-h" id="bbbrTitle" tabindex="-1">🌬️ ' + esc(tr('title')) + '</h2>' +
      '<button type="button" class="bbbr-x" data-nf-close aria-label="' + esc(tr('close')) + '">✕</button></div>' +
      '<div class="bbbr-chips" role="radiogroup" aria-label="' + esc(tr('techniques')) + '" data-nf-nodrag>' + chips + '</div>' +
      '<div class="bbbr-pat">' + esc(pattern(tq)) + '</div>' +
      '<p class="bbbr-desc">' + esc(tr('t.' + tq.id + '.desc')) + '</p>' +
      '<div class="bbbr-stage"><div class="bbbr-ring" aria-hidden="true"></div><div class="bbbr-orb" aria-hidden="true"></div>' +
      '<div class="bbbr-mid"><div class="bbbr-phase" role="status" aria-live="polite">' + esc(tr('ready')) + '</div>' +
      '<div class="bbbr-count" aria-hidden="true"></div></div></div>' +
      '<div class="bbbr-left" aria-hidden="true">' + esc(tr('left', { t: fmt(P.mins * 60000) })) + '</div>' +
      '<div class="bbbr-opts"><span class="bbbr-seg" role="radiogroup" aria-label="' + esc(tr('length')) + '">' + seg + '</span>' +
      '<button type="button" class="bbbr-tog" data-act="mute" aria-pressed="' + muted() + '">🔇 ' + esc(tr('mute')) + '</button>' +
      '<button type="button" class="bbbr-tog" data-act="fav" aria-pressed="' + isFav + '">' + (isFav ? '★ ' : '☆ ') + esc(tr('fav')) + '</button></div>' +
      '<button type="button" class="bbbr-go">' + esc(tr('start')) + '</button>' +
      '<p class="bbbr-safe">' + esc(tr('safety')) + '</p>';
  }

  function stop(label) {
    if (!P) return;
    clearTimeout(P.timer); clearInterval(P.tick);
    P.running = false;
    audioStop(P.audio); P.audio = null;
    var orb = el('.bbbr-orb');
    if (orb) { orb.style.transitionDuration = '1s'; orb.style.transform = ''; orb.style.opacity = ''; }
    var ph = el('.bbbr-phase'); if (ph) ph.textContent = label || tr('ready');
    var c = el('.bbbr-count'); if (c) c.textContent = '';
    var go = el('.bbbr-go'); if (go) go.textContent = tr(label ? 'again' : 'start');
    var left = el('.bbbr-left'); if (left) left.textContent = label ? '' : tr('left', { t: fmt(P.mins * 60000) });
  }
  function step() {
    if (!P || !P.running) return;
    var tq = get(P.id);
    clearInterval(P.tick);
    P.idx = (P.idx + 1) % tq.phases.length;
    // The time is checked at the start of a round, so a round is never cut short.
    if (P.idx === 0 && P.rounds > 0 && Date.now() >= P.endAt) {
      if (P.audio) bell(P.audio, 523);
      stop(tr('done'));
      if (typeof P.onDone === 'function') { try { P.onDone(P.id); } catch (_) {} }
      return;
    }
    if (P.idx === 0) P.rounds++;
    var kind = tq.phases[P.idx][0], secs = tq.phases[P.idx][1];
    var orb = el('.bbbr-orb');
    if (orb) {
      orb.style.transitionDuration = secs + 's';
      if (kind === 'in') { orb.style.transform = 'scale(1)'; orb.style.opacity = '1'; }
      else if (kind === 'in2') { orb.style.transform = 'scale(1.08)'; orb.style.opacity = '1'; }
      else if (kind === 'out') { orb.style.transform = 'scale(.5)'; orb.style.opacity = reduced ? '.4' : '.75'; }
    }
    el('.bbbr-phase').textContent = tr('ph.' + kind);
    var left = secs, c = el('.bbbr-count'), lf = el('.bbbr-left');
    c.textContent = left;
    lf.textContent = tr('left', { t: fmt(P.endAt - Date.now()) });
    P.tick = setInterval(function () {
      left--;
      if (left > 0) c.textContent = left;
      lf.textContent = tr('left', { t: fmt(P.endAt - Date.now()) });
    }, 1000);
    audioPhase(P.audio, kind, secs);
    haptic();
    P.timer = setTimeout(step, secs * 1000);
  }
  function start() {
    if (!P) return;
    stop();
    P.running = true; P.idx = -1; P.rounds = 0;
    P.startedAt = Date.now();
    P.endAt = P.startedAt + P.mins * 60000;
    P.audio = audioStart();
    el('.bbbr-go').textContent = tr('stop');
    // A short pause so the first breath in starts from the small circle.
    var orb = el('.bbbr-orb');
    if (orb) void orb.offsetWidth;
    step();
  }

  function onClick(e) {
    if (!P) return;
    var b = e.target.closest ? e.target.closest('button') : null;
    if (e.target === P.back) { close(); return; }
    if (!b) return;
    if (b.classList.contains('bbbr-x')) { close(); return; }
    if (b.classList.contains('bbbr-go')) { if (P.running) stop(); else start(); return; }
    if (b.classList.contains('bbbr-chip')) {
      var id = b.getAttribute('data-id');
      if (id === P.id) return;
      stop(); P.id = id; render(); focusSel('.bbbr-chip[data-id="' + id + '"]');
      return;
    }
    if (b.hasAttribute('data-m')) {
      P.mins = Number(b.getAttribute('data-m'));
      lsSet('bbBreathMins', String(P.mins));
      Array.prototype.forEach.call(P.back.querySelectorAll('[data-m]'), function (x) { x.setAttribute('aria-checked', String(x === b)); });
      if (P.running) P.endAt = P.startedAt + P.mins * 60000;
      else el('.bbbr-left').textContent = tr('left', { t: fmt(P.mins * 60000) });
      return;
    }
    var act = b.getAttribute('data-act');
    if (act === 'mute') {
      var m = !muted();
      lsSet('bbBreathMute', m ? '1' : null);
      b.setAttribute('aria-pressed', String(m));
      if (P.audio) ramp(P.audio.master.gain, m ? 0 : 1, P.audio.ac.currentTime, 0.2);
      return;
    }
    if (act === 'fav') {
      setFavourite(P.id);
      var on = favourite() === P.id;
      b.setAttribute('aria-pressed', String(on));
      b.textContent = (on ? '★ ' : '☆ ') + tr('fav');
      Array.prototype.forEach.call(P.back.querySelectorAll('.bbbr-chip'), function (x) {
        x.textContent = (x.getAttribute('data-id') === favourite() ? '★ ' : '') + name(get(x.getAttribute('data-id')));
      });
    }
  }
  function focusSel(sel) { try { var f = el(sel); if (f) f.focus(); } catch (_) {} }
  function onKey(e) {
    if (!P) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    var f = P.back.querySelectorAll('button');
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function onHide() { if (P && P.running && document.visibilityState === 'hidden') stop(); }

  function open(o) {
    o = o || {};
    if (P) close();
    injectStyle();
    var back = document.createElement('div');
    back.className = 'bbbr-back';
    back.innerHTML = '<div class="bbbr-sheet" role="dialog" aria-modal="true" aria-labelledby="bbbrTitle"></div>';
    P = { back: back, id: get(o.id) ? o.id : (favourite() || TECHNIQUES[0].id), mins: mins(), running: false,
      opener: document.activeElement, onClose: o.onClose, onDone: o.onDone };
    render();
    back.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('visibilitychange', onHide);
    document.body.appendChild(back);
    focusSel('#bbbrTitle');
    return back;
  }
  function close() {
    if (!P) return;
    var p = P;
    stop();
    P = null;
    p.back.remove();
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('visibilitychange', onHide);
    try { if (p.opener && p.opener.focus && document.contains(p.opener)) p.opener.focus(); } catch (_) {}
    if (typeof p.onClose === 'function') { try { p.onClose(); } catch (_) {} }
  }

  document.addEventListener('bb:languagechange', function () { if (P && !P.running) render(); });

  // ── Survival Kit: the list of exercises ───────────────────────────────
  function renderList(host) {
    if (!host) return;
    injectStyle();
    var f = favourite();
    host.innerHTML = '<div class="bbbr-list">' + list().map(function (x) {
      var n = name(x), isFav = x.id === f;
      return '<div class="bbbr-card' + (isFav ? ' fav' : '') + '">' +
        '<span class="bbbr-card-ico" aria-hidden="true">' + esc(x.icon) + '</span>' +
        '<div class="bbbr-card-txt"><div class="bbbr-card-name">' + esc(n) +
        (isFav ? '<span class="bbbr-card-badge">' + esc(tr('favBadge')) + '</span>' : '') + '</div>' +
        '<div class="bbbr-card-pat">' + esc(pattern(x)) + '</div>' +
        '<div class="bbbr-card-desc">' + esc(tr('t.' + x.id + '.desc')) + '</div></div>' +
        '<div class="bbbr-card-btns">' +
        '<button type="button" class="bbbr-play" data-play="' + esc(x.id) + '" aria-label="' + esc(tr('startAria', { name: n })) + '">▶ ' + esc(tr('start')) + '</button>' +
        '<button type="button" class="bbbr-star" data-star="' + esc(x.id) + '" aria-pressed="' + isFav + '" aria-label="' + esc(tr('favAria', { name: n })) + '">' + (isFav ? '★' : '☆') + '</button>' +
        '</div></div>';
    }).join('') + '</div>';
    if (!host._bbbr) {
      host._bbbr = true;
      host.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b) return;
        if (b.hasAttribute('data-play')) open({ id: b.getAttribute('data-play') });
        else if (b.hasAttribute('data-star')) {
          var id = b.getAttribute('data-star');
          setFavourite(id);
          renderList(host);
          var again = host.querySelector('[data-star="' + id + '"]');
          if (again) again.focus();
        }
      });
      document.addEventListener('bb:breathfav', function () { if (!host.contains(document.activeElement)) renderList(host); });
      document.addEventListener('bb:languagechange', function () { renderList(host); });
    }
  }

  BB.breathing = {
    TECHNIQUES: TECHNIQUES,
    list: list, get: get, pattern: pattern,
    favourite: favourite, setFavourite: setFavourite,
    open: open, close: close, isOpen: function () { return !!P; },
    promptsOn: promptsOn, setPrompts: setPrompts,
    renderList: renderList,
  };
})();
