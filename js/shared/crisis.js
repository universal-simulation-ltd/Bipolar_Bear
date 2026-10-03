/**
 * Crisis lines for the country the phone is in.
 *
 * Every "need help now" surface in the app (the 🆘 FAB sheet, the journal's
 * "You matter" card, the Survival Kit crisis box, the board's 🛟 Help sheet
 * and the PIN lock screen) was written for the UK: Samaritans 116 123, NHS
 * 111, 999. Those numbers do nothing in most of the countries whose languages
 * the app speaks, so a French or American member in crisis was shown a number
 * that would not connect. This module picks the right lines for where the
 * phone is.
 *
 * The UK markup in each page is left exactly as written — on a UK phone none
 * of this changes anything. Elsewhere the pages swap their rows for
 * BB.crisis.get()'s lines.
 *
 * Country: the device time zone first (it follows where the phone physically
 * is, which is what matters for a phone number), then the region in the
 * browser's language tags (en-US, fr-BE…). A recognised time zone in a country
 * listed below wins; a time zone somewhere not listed gets the generic
 * "find a helpline" (findahelpline.com, by ThroughLine) rather than a UK
 * number that won't work; a zone that says nothing (UTC) falls back to the
 * language region and then to the UK, as before.
 *
 * Numbers were checked against each service's own site or the national
 * health ministry on 2026-10-04 (all 24/7). "free" is only claimed where the
 * service says so. Re-check before adding a country; findahelpline.com covers
 * the rest. Test any country with localStorage.bbCrisisCountry = 'FR'.
 *
 * Exposes window.BB.crisis:
 *   country()   → 'GB' | 'FR' | … | null (null = not a listed country)
 *   get()       → { cc, uk, emergency, lines:[{name, number, href, sub, icon}], findUrl }
 *   dangerSub() → the "if you are in danger, call N…" line for here
 *
 * Loaded after js/shared/i18n.js. Strings live under `crisis.*` there.
 *
 * @file js/shared/crisis.js
 */
(function () {
  'use strict';

  var FIND_URL = 'https://findahelpline.com';

  // kind → i18n key for the subtitle. {n} = number as shown, {kw} = keyword.
  //   callFree / call / callOrTextFree / textFree / text / callOption
  var COUNTRIES = {
    GB: { emergency: '999', lines: [
      { name: 'Samaritans', tel: '116123', n: '116 123', kind: 'callFree' },
      { name: 'Shout', sms: '85258', body: 'SHOUT', n: '85258', kw: 'SHOUT', kind: 'textFree' },
    ] },
    IE: { emergency: '112', lines: [
      { name: 'Samaritans', tel: '116123', n: '116 123', kind: 'callFree' },
      { name: 'Text About It', sms: '50808', body: 'HELLO', n: '50808', kw: 'HELLO', kind: 'textFree' },
    ] },
    US: { emergency: '911', lines: [
      { name: '988 Suicide & Crisis Lifeline', tel: '988', sms: '988', n: '988', kind: 'callOrTextFree' },
    ] },
    CA: { emergency: '911', lines: [
      { name: '988 Suicide Crisis Helpline', tel: '988', sms: '988', n: '988', kind: 'callOrTextFree' },
    ] },
    AU: { emergency: '000', lines: [
      { name: 'Lifeline', tel: '131114', n: '13 11 14', kind: 'call' },
      { name: 'Lifeline', sms: '0477131114', n: '0477 13 11 14', kind: 'text' },
    ] },
    NZ: { emergency: '111', lines: [
      { name: '1737 Need to talk?', tel: '1737', sms: '1737', n: '1737', kind: 'callOrTextFree' },
    ] },
    ES: { emergency: '112', lines: [
      { name: 'Línea 024', tel: '024', n: '024', kind: 'callFree' },
    ] },
    FR: { emergency: '112', lines: [
      { name: '3114 · Prévention du suicide', tel: '3114', n: '3114', kind: 'callFree' },
    ] },
    BE: { emergency: '112', lines: [
      { name: 'Zelfmoordlijn 1813', tel: '1813', n: '1813', kind: 'callFree' },
      { name: 'Centre de Prévention du Suicide', tel: '080032123', n: '0800 32 123', kind: 'callFree' },
    ] },
    DE: { emergency: '112', lines: [
      { name: 'TelefonSeelsorge', tel: '08001110111', n: '0800 111 0 111', kind: 'callFree' },
    ] },
    AT: { emergency: '112', lines: [
      { name: 'TelefonSeelsorge', tel: '142', n: '142', kind: 'callFree' },
    ] },
    CH: { emergency: '112', lines: [
      { name: 'Tel 143 · Die Dargebotene Hand', tel: '143', n: '143', kind: 'callFree' },
    ] },
    IT: { emergency: '112', lines: [
      { name: 'Telefono Amico Italia', tel: '0223272327', n: '02 2327 2327', kind: 'call' },
    ] },
    PT: { emergency: '112', lines: [
      { name: 'SNS 24 · Aconselhamento psicológico', tel: '808242424', n: '808 24 24 24', o: '4', kind: 'callOption' },
    ] },
    NL: { emergency: '112', lines: [
      { name: '113 Zelfmoordpreventie', tel: '113', n: '113', kind: 'callFree' },
    ] },
    PL: { emergency: '112', lines: [
      { name: 'Centrum Wsparcia', tel: '800702222', n: '800 70 2222', kind: 'callFree' },
    ] },
    SE: { emergency: '112', lines: [
      { name: 'Mind Självmordslinjen', tel: '90101', n: '90101', kind: 'call' },
    ] },
  };
  COUNTRIES.LI = COUNTRIES.CH; // Tel 143 covers Liechtenstein too.

  // IANA time zone → country, for the countries above.
  var TZ = {
    'Europe/London': 'GB', 'Europe/Belfast': 'GB', 'Europe/Guernsey': 'GB',
    'Europe/Jersey': 'GB', 'Europe/Isle_of_Man': 'GB', 'GB': 'GB',
    'Europe/Dublin': 'IE', 'Eire': 'IE',
    'Europe/Madrid': 'ES', 'Atlantic/Canary': 'ES', 'Africa/Ceuta': 'ES',
    'Europe/Paris': 'FR',
    'Europe/Brussels': 'BE',
    'Europe/Berlin': 'DE', 'Europe/Busingen': 'DE',
    'Europe/Vienna': 'AT',
    'Europe/Zurich': 'CH', 'Europe/Vaduz': 'LI',
    'Europe/Rome': 'IT',
    'Europe/Lisbon': 'PT', 'Atlantic/Madeira': 'PT', 'Atlantic/Azores': 'PT', 'Portugal': 'PT',
    'Europe/Amsterdam': 'NL',
    'Europe/Warsaw': 'PL', 'Poland': 'PL',
    'Europe/Stockholm': 'SE',
    'Pacific/Auckland': 'NZ', 'Pacific/Chatham': 'NZ', 'NZ': 'NZ',
  };
  var CA_TZ = /^(America\/(Toronto|Montreal|Vancouver|Edmonton|Winnipeg|Regina|Swift_Current|Halifax|Glace_Bay|Moncton|Goose_Bay|St_Johns|Whitehorse|Dawson|Dawson_Creek|Fort_Nelson|Creston|Yellowknife|Inuvik|Iqaluit|Rankin_Inlet|Resolute|Cambridge_Bay|Atikokan|Thunder_Bay|Nipigon|Rainy_River|Blanc-Sablon|Coral_Harbour)|Canada\/.*)$/;
  var US_TZ = /^(America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Juneau|Sitka|Metlakatla|Yakutat|Nome|Adak|Boise|Detroit|Menominee|Indiana\/.*|Kentucky\/.*|North_Dakota\/.*|Indianapolis|Louisville|Puerto_Rico)|Pacific\/Honolulu|US\/.*)$/;

  function _fromTz(tz) {
    if (!tz) return undefined;
    if (TZ[tz]) return TZ[tz];
    if (/^Australia\//.test(tz)) return 'AU';
    if (CA_TZ.test(tz)) return 'CA';
    if (US_TZ.test(tz)) return 'US';
    // A real place we have no list for → generic. UTC / Etc/* say nothing.
    if (tz.indexOf('/') > 0 && !/^Etc\//.test(tz)) return null;
    return undefined;
  }

  var _cc; // cached per page load

  function country() {
    if (_cc !== undefined) return _cc;
    try {
      var o = localStorage.getItem('bbCrisisCountry');
      if (o && COUNTRIES[o.toUpperCase()]) return (_cc = o.toUpperCase());
    } catch (_) {}
    var tz = null;
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (_) {}
    var c = _fromTz(tz);
    if (c !== undefined) return (_cc = c);
    var tags = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || ''];
    for (var i = 0; i < tags.length; i++) {
      var m = /^[a-z]{2,3}[-_]([A-Za-z]{2})\b/.exec(tags[i] || '');
      if (m) {
        var r = m[1].toUpperCase();
        if (r === 'UK') r = 'GB';
        return (_cc = COUNTRIES[r] ? r : null);
      }
    }
    return (_cc = 'GB');
  }

  function _t(key, vars) {
    return (window.BB && typeof BB.t === 'function') ? BB.t('crisis.' + key, vars) : key;
  }

  function _line(l) {
    var href = l.tel ? 'tel:' + l.tel
      : 'sms:' + l.sms + (l.body ? '?&body=' + encodeURIComponent(l.body) : '');
    return {
      name: l.name,
      number: l.n,
      href: href,
      icon: l.tel ? '📞' : '💬',
      sub: _t(l.kind, { n: l.n, kw: l.kw || '', o: l.o || '' }),
    };
  }

  function get() {
    var cc = country();
    var c = cc && COUNTRIES[cc];
    if (!c) {
      return {
        cc: null, uk: false, emergency: null, findUrl: FIND_URL,
        lines: [{ name: _t('find'), href: FIND_URL, icon: '🌍', sub: _t('findSub'), external: true }],
      };
    }
    return {
      cc: cc, uk: cc === 'GB', emergency: c.emergency, findUrl: FIND_URL,
      lines: c.lines.map(_line),
    };
  }

  function dangerSub() {
    var g = get();
    return g.emergency ? _t('dangerSub', { n: g.emergency }) : _t('dangerSubLocal');
  }

  /**
   * Build one row: <a class=rowClass href><span icon/><span><span name/><span sub/></span></a>.
   * Class names are the caller's so each page keeps its own look.
   */
  function row(line, cls) {
    cls = cls || {};
    var a = document.createElement('a');
    if (cls.row) a.className = cls.row;
    if (cls.rowStyle) a.style.cssText = cls.rowStyle;
    a.href = line.href;
    if (line.external) { a.target = '_blank'; a.rel = 'noopener'; }
    var ico = document.createElement('span');
    if (cls.ico) ico.className = cls.ico;
    if (cls.icoStyle) ico.style.cssText = cls.icoStyle;
    ico.setAttribute('aria-hidden', 'true');
    ico.textContent = line.icon;
    var txt = document.createElement(cls.textTag || 'span');
    if (cls.textStyle) txt.style.cssText = cls.textStyle;
    var nm = document.createElement(cls.textTag || 'span');
    if (cls.name) nm.className = cls.name;
    if (cls.nameStyle) nm.style.cssText = cls.nameStyle;
    nm.textContent = line.name;
    var sb = document.createElement(cls.textTag || 'span');
    if (cls.sub) sb.className = cls.sub;
    if (cls.subStyle) sb.style.cssText = cls.subStyle;
    sb.textContent = line.sub;
    txt.appendChild(nm); txt.appendChild(sb);
    a.appendChild(ico); a.appendChild(txt);
    return a;
  }

  window.BB = window.BB || {};
  window.BB.crisis = { country: country, get: get, dangerSub: dangerSub, row: row, FIND_URL: FIND_URL };
})();
