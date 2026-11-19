/**
 * 😴 My usual sleep (2026-11-19, from a member's idea: "everyone sleeps best
 * at a different length; mine is 8–8.5 h, 7 h is already a warning sign, but
 * the bear shows green").
 *
 * One setting, a range of hours, that the whole journal reads its sleep bands
 * from: the colours (wheel, slider, cards, chips, the old form's buttons), the
 * five coarse buttons themselves, the Bear's mood estimate, the mood guessed
 * from Health data, the insights' "after N h sleep" split and the short-sleep
 * early warning.
 *
 *   BB.sleepTarget.get()          → { lo, hi } or null (not set)
 *   BB.sleepTarget.range()        → { lo, hi, personal } (7–9 h when not set)
 *   BB.sleepTarget.set(lo, hi)    → saves (null, null clears it)
 *   BB.sleepTarget.band(h)        → 'veryShort' | 'short' | 'healthy' | 'long' | 'veryLong'
 *   BB.sleepTarget.buckets()      → the five coarse choices [{ val, label, band }]
 *   BB.sleepTarget.bucketOf(h)    → the coarse choice's value for any hours
 *   BB.sleepTarget.labelOf(h)     → "7–9h" for a coarse value, else "7.5h"
 *   BB.sleepTarget.OPTIONS        → the hours the picker offers (6 … 10, halves)
 *
 * Bands, from the range lo–hi:
 *   very short  ≤ max(lo − 2, 5)   (5 h or less is always very short)
 *   short       below lo
 *   healthy     lo … hi            ("Your usual" once set)
 *   long        up to hi + 1
 *   very long   above that
 * With nothing set this is 7–9 h, which gives exactly the bands the app always
 * had (≤5 / 5–7 / 7–9 / 9–10 / 10+), so nobody who leaves it alone sees a
 * change. The picker only offers 6–10 h, so nobody can tell the Bear that a
 * 5-hour night is their normal: short sleep is an early sign of a high.
 *
 * Storage: localStorage `sleepTarget` = "8-8.5", or "" for not set (an empty
 * string rather than a removed key, so clearing it travels through
 * secure-store's pending saves like any other value). On an account it goes
 * up encrypted with the journal's other sensitive settings
 * (js/shared/secure-store.js SETTINGS). Fires `bb:sleeptarget` on change.
 *
 * Strings: the `sleepT` namespace, all ten languages (machine translated).
 * Loaded on journal.html after i18n.js.
 *
 * @file js/shared/sleep-target.js
 */
(function () {
  'use strict';
  var BB = window.BB = window.BB || {};
  var KEY = 'sleepTarget';
  var MIN = 6, MAX = 10;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }

  /** "7.5" stays "7.5", 8 reads "8". */
  function fmt(n) { return String(Math.round(Number(n) * 100) / 100); }
  function half(n) { return Math.round(Number(n) * 2) / 2; }

  function parse(raw) {
    if (!raw || typeof raw !== 'string') return null;
    var m = raw.split('-');
    var lo = half(parseFloat(m[0])), hi = half(parseFloat(m[1] != null ? m[1] : m[0]));
    if (!isFinite(lo) || !isFinite(hi)) return null;
    lo = Math.min(MAX, Math.max(MIN, lo));
    hi = Math.min(MAX, Math.max(lo, hi));
    return { lo: lo, hi: hi };
  }

  function get() { return parse(lsGet(KEY)); }
  function range() {
    var t = get();
    return t ? { lo: t.lo, hi: t.hi, personal: true } : { lo: 7, hi: 9, personal: false };
  }

  function set(lo, hi) {
    var v = '';
    if (lo != null && lo !== '') {
      var t = parse(fmt(lo) + '-' + fmt(hi != null && hi !== '' ? hi : lo));
      if (t) v = fmt(t.lo) + '-' + fmt(t.hi);
    }
    lsSet(KEY, v);
    try {
      if (window.currentUser && window.db && BB.secure) {
        var p = {}; p[KEY] = v;
        BB.secure.saveSettings(window.currentUser.uid, p);
      }
    } catch (_) {}
    try { document.dispatchEvent(new CustomEvent('bb:sleeptarget', { detail: get() })); } catch (_) {}
    return get();
  }

  function band(h) {
    var n = Number(h);
    if (!isFinite(n)) return null;
    var r = range();
    if (n <= Math.max(r.lo - 2, 5)) return 'veryShort';
    if (n < r.lo) return 'short';
    if (n <= r.hi) return 'healthy';
    if (n <= r.hi + 1) return 'long';
    return 'veryLong';
  }

  // The coarse choices with nothing set: the values every older entry carries.
  var LEGACY = [
    { val: 5, label: '≤5h', band: 'veryShort' },
    { val: 6.5, label: '6–7h', band: 'short' },
    { val: 8, label: '7–9h', band: 'healthy' },
    { val: 9.5, label: '9–10h', band: 'long' },
    { val: 11, label: '10+h', band: 'veryLong' },
  ];

  function buckets() {
    var t = get();
    if (!t) return LEGACY.map(function (b) { return Object.assign({}, b); });
    var vs = Math.max(t.lo - 2, 5), lo = t.lo, hi = t.hi;
    return [
      { val: vs, label: '≤' + fmt(vs) + 'h', band: 'veryShort' },
      { val: (vs + lo) / 2, label: fmt(vs) + '–' + fmt(lo) + 'h', band: 'short' },
      { val: (lo + hi) / 2, label: (lo === hi ? fmt(lo) : fmt(lo) + '–' + fmt(hi)) + 'h', band: 'healthy' },
      { val: hi + 0.5, label: fmt(hi) + '–' + fmt(hi + 1) + 'h', band: 'long' },
      { val: hi + 2, label: fmt(hi + 1) + '+h', band: 'veryLong' },
    ];
  }

  function bucketOf(h) {
    var n = Number(h);
    if (!isFinite(n)) return null;
    // Unset: the long-standing rounding (5.5 h still counted as ≤5).
    if (!get()) return n <= 5.5 ? 5 : n < 7 ? 6.5 : n <= 9 ? 8 : n <= 10 ? 9.5 : 11;
    var b = band(n), list = buckets();
    for (var i = 0; i < list.length; i++) if (list[i].band === b) return list[i].val;
    return null;
  }

  /** The coarse label for a saved value (current choices first, then the
   *  long-standing ones older entries carry), else the hours themselves. */
  function labelOf(h) {
    var n = Number(h);
    if (h == null || !isFinite(n)) return null;
    var list = buckets().concat(LEGACY);
    for (var i = 0; i < list.length; i++) if (list[i].val === n) return list[i].label;
    return fmt(n) + 'h';
  }

  var OPTIONS = [];
  for (var x = MIN; x <= MAX; x += 0.5) OPTIONS.push(x);

  BB.sleepTarget = {
    KEY: KEY, OPTIONS: OPTIONS,
    get: get, range: range, set: set, band: band,
    buckets: buckets, bucketOf: bucketOf, labelOf: labelOf, fmt: fmt,
  };

  // ── strings ────────────────────────────────────────────────────────────────
  if (!BB.i18n || !BB.i18n.extend) return;
  var S = {
    en: {
      settingTitle: '😴 My usual sleep',
      settingDesc: 'How many hours feel right for you. The sleep colours and the Bear’s guesses follow it.',
      from: 'From', to: 'to', notSet: 'Not set',
      defaultNote: 'Not set: 7 to 9 hours counts as usual.',
      hint: 'Your last 30 nights: usually {h} h.', useHint: 'Use it',
      usual: 'Your usual',
      moodDetail: 'After {h} h+ sleep: next-day mood avg {hi}  ·  After less than {h} h: {lo}',
    },
    es: {
      settingTitle: '😴 Mi sueño habitual',
      settingDesc: 'Cuántas horas te sientan bien. Los colores del sueño y las sugerencias del Oso se basan en ello.',
      from: 'De', to: 'a', notSet: 'Sin definir',
      defaultNote: 'Sin definir: de 7 a 9 horas cuenta como habitual.',
      hint: 'Tus últimas 30 noches: normalmente {h} h.', useHint: 'Usar',
      usual: 'Tu habitual',
      moodDetail: 'Tras {h} h o más de sueño: ánimo medio al día siguiente {hi}  ·  Tras menos de {h} h: {lo}',
    },
    fr: {
      settingTitle: '😴 Mon sommeil habituel',
      settingDesc: 'Le nombre d’heures qui te convient. Les couleurs du sommeil et les suggestions de l’Ours s’y adaptent.',
      from: 'De', to: 'à', notSet: 'Non défini',
      defaultNote: 'Non défini : de 7 à 9 heures compte comme habituel.',
      hint: 'Tes 30 dernières nuits : en général {h} h.', useHint: 'Utiliser',
      usual: 'Ton habitude',
      moodDetail: 'Après {h} h ou plus de sommeil : humeur moyenne le lendemain {hi}  ·  Après moins de {h} h : {lo}',
    },
    de: {
      settingTitle: '😴 Mein üblicher Schlaf',
      settingDesc: 'Wie viele Stunden sich für dich richtig anfühlen. Die Schlaffarben und die Vorschläge des Bären richten sich danach.',
      from: 'Von', to: 'bis', notSet: 'Nicht festgelegt',
      defaultNote: 'Nicht festgelegt: 7 bis 9 Stunden gelten als üblich.',
      hint: 'Deine letzten 30 Nächte: meist {h} Std.', useHint: 'Übernehmen',
      usual: 'Dein Normalwert',
      moodDetail: 'Nach {h}+ Std. Schlaf: Stimmung am Folgetag Ø {hi}  ·  Nach weniger als {h} Std.: {lo}',
    },
    it: {
      settingTitle: '😴 Il mio sonno abituale',
      settingDesc: 'Quante ore ti fanno sentire bene. I colori del sonno e i suggerimenti dell’Orso si basano su questo.',
      from: 'Da', to: 'a', notSet: 'Non impostato',
      defaultNote: 'Non impostato: da 7 a 9 ore conta come abituale.',
      hint: 'Le tue ultime 30 notti: di solito {h} h.', useHint: 'Usa',
      usual: 'Il tuo solito',
      moodDetail: 'Dopo {h} h o più di sonno: umore medio il giorno dopo {hi}  ·  Dopo meno di {h} h: {lo}',
    },
    pt: {
      settingTitle: '😴 O meu sono habitual',
      settingDesc: 'Quantas horas te fazem sentir bem. As cores do sono e as sugestões do Urso seguem isso.',
      from: 'De', to: 'a', notSet: 'Não definido',
      defaultNote: 'Não definido: 7 a 9 horas conta como habitual.',
      hint: 'As tuas últimas 30 noites: normalmente {h} h.', useHint: 'Usar',
      usual: 'O teu habitual',
      moodDetail: 'Após {h} h ou mais de sono: humor médio no dia seguinte {hi}  ·  Após menos de {h} h: {lo}',
    },
    nl: {
      settingTitle: '😴 Mijn gewone slaap',
      settingDesc: 'Hoeveel uur voor jou goed voelt. De slaapkleuren en de suggesties van de Beer volgen dat.',
      from: 'Van', to: 'tot', notSet: 'Niet ingesteld',
      defaultNote: 'Niet ingesteld: 7 tot 9 uur telt als gewoon.',
      hint: 'Je laatste 30 nachten: meestal {h} u.', useHint: 'Gebruiken',
      usual: 'Jouw gewone',
      moodDetail: 'Na {h}+ u slaap: gem. stemming de dag erna {hi}  ·  Na minder dan {h} u: {lo}',
    },
    pl: {
      settingTitle: '😴 Mój zwykły sen',
      settingDesc: 'Ile godzin snu jest dla ciebie w sam raz. Kolory snu i podpowiedzi Misia dopasują się do tego.',
      from: 'Od', to: 'do', notSet: 'Nie ustawiono',
      defaultNote: 'Nie ustawiono: od 7 do 9 godzin liczy się jako zwykle.',
      hint: 'Twoje ostatnie 30 nocy: zwykle {h} h.', useHint: 'Użyj',
      usual: 'Twoja norma',
      moodDetail: 'Po {h}+ h snu: średni nastrój następnego dnia {hi}  ·  Po mniej niż {h} h: {lo}',
    },
    sv: {
      settingTitle: '😴 Min vanliga sömn',
      settingDesc: 'Hur många timmar som känns rätt för dig. Sömnfärgerna och Björnens förslag följer det.',
      from: 'Från', to: 'till', notSet: 'Inte angivet',
      defaultNote: 'Inte angivet: 7 till 9 timmar räknas som vanligt.',
      hint: 'Dina senaste 30 nätter: oftast {h} h.', useHint: 'Använd',
      usual: 'Ditt vanliga',
      moodDetail: 'Efter {h}+ h sömn: snitthumör dagen efter {hi}  ·  Efter mindre än {h} h: {lo}',
    },
    zh: {
      settingTitle: '😴 我平时的睡眠',
      settingDesc: '你觉得合适的睡眠时长。睡眠颜色和小熊的建议都会据此调整。',
      from: '从', to: '到', notSet: '未设置',
      defaultNote: '未设置：7 到 9 小时算作平常。',
      hint: '你最近 30 晚：通常 {h} 小时。', useHint: '使用',
      usual: '你的平常',
      moodDetail: '睡眠 {h} 小时以上后：次日平均情绪 {hi}  ·  不足 {h} 小时后：{lo}',
    },
  };
  Object.keys(S).forEach(function (code) { BB.i18n.extend(code, { sleepT: S[code] }); });
})();
