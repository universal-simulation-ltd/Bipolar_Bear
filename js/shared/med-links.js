/**
 * Medicine names in board posts open their wiki page.
 *
 * James, 2026-10-25: "if someone mentions a medication then provide a link to
 * the wiki to learn more about that medication." When a member's post or reply
 * is shown (and again whenever js/shared/translate.js swaps in a translation or
 * the original), the FIRST mention of each medicine page in it becomes a quiet
 * link — dotted underline and a small 💊 drawn by CSS — that opens that page of
 * the board's own Wiki tab (js/anonymous.js openWikiMedFromPost), inside the
 * app.
 *
 * Render-time only: the stored post is never touched, and the author's words
 * are never rewritten — the link is built from DOM nodes around the exact text
 * that was already on screen (no innerHTML anywhere near member text). The 💊
 * is a CSS ::after, so it is not part of textContent and never leaks into a
 * translation request, the "⋯" preview or a report.
 *
 * Which text is eligible is decided by the renderer, which marks it with
 * `data-medlink`: member posts, replies and saved posts — never announcements,
 * suggested announcements, daily topics, admin posts, or the crisis bear. On
 * top of that, nothing is linked in text that reads like someone in crisis
 * (the same patterns as functions/crisis-bot.js) or inside anything marked
 * `data-medlink-skip` (a thread the crisis bear has answered).
 *
 * Only medicines that HAVE a page in js/shared/medications.js are linked; the
 * dictionary below maps generic names, brand names (UK and the other
 * languages' markets), local spellings and common misspellings onto those
 * pages. Matching is case-insensitive, whole-word only (Latin names: no letter
 * or digit either side, optional plural "s"); Chinese names have no word
 * breaks to respect, so they are matched as written but kept specific
 * (碳酸锂, never a bare 锂 — 锂电池 is a battery).
 *
 * The reader can switch it off: "Don't link medicine names" in the board's
 * Your Medication sheet (unticked by default — localStorage.bbAnonMedLinksOff,
 * per device, outside the bbAnon_* prefix so signing out keeps the choice).
 *
 * Exposes window.BB.medLinks:
 *   scan(root)           link every [data-medlink] inside root (and root itself)
 *   link(el) / unlink(el)
 *   find(text)           [{page, index, length, text}] — first mention per page
 *   pages()              {page: {entry, slug, names}} for pages that exist
 *   isOff() / setOff(b)
 *   looksLikeCrisis(t)
 *   onOpen               set by the page: fn(page, linkEl) when a link is tapped
 *
 * @file js/shared/med-links.js
 */
(function () {
  'use strict';

  var OFF_KEY = 'bbAnonMedLinksOff';

  // page (the first key of a js/shared/medications.js entry) → every name
  // that means it. Lower-case; accents as they are spelled locally.
  var DICT = {
    lithium: [
      'lithium', 'lithium carbonate', 'lithium citrate', 'lithiumcarbonat', 'lithiumcarbonaat',
      'litio', 'carbonato de litio', 'carbonato di litio', 'lítio', 'carbonato de lítio',
      'litium', 'litiumkarbonat', 'litu', 'węglan litu',
      'lithum', 'lithuim', 'lithim', 'lithiun',
      'priadel', 'camcolit', 'liskonum', 'li-liquid', 'lithobid', 'eskalith',
      'quilonum', 'hypnorex', 'téralithe', 'teralithe', 'plenur', 'carbolithium', 'lithionit',
      '碳酸锂', '锂盐', '锂剂',
    ],
    lamotrigine: [
      'lamotrigine', 'lamotrigin', 'lamotrigina', 'lamotrygina',
      'lamotragine', 'lamotrigene', 'lamotrogine', 'lamotrigen', 'lamatrigine', 'lamotragene',
      'lamictal', 'lamictol', 'lamitrin',
      '拉莫三嗪', '利必通',
    ],
    quetiapine: [
      'quetiapine', 'quétiapine', 'quetiapin', 'quetiapina', 'kwetiapina',
      'quetiapene', 'quetapine', 'quietiapine', 'quetiepine', 'quetiapne', 'qetiapine',
      'seroquel', 'seroquel xl', 'seroquel xr', 'seroquel prolong', 'seroquil', 'seraquel', 'seroquell', 'seroqel',
      'biquelle', 'atrolak', 'sondate', 'ketipinor', 'ketrel',
      '喹硫平', '思瑞康',
    ],
    valproate: [
      'valproate', 'sodium valproate', 'semisodium valproate', 'valproic acid', 'divalproex', 'divalproex sodium',
      'valproat', 'natriumvalproat', 'valproinsäure', 'valproinezuur', 'valproïnezuur', 'natriumvalproaat',
      'valproato', 'valproato de sodio', 'valproato sódico', 'ácido valproico', 'acido valproico', 'valproato di sodio',
      'valproato de sódio', 'ácido valproico', 'acide valproïque', 'valproate de sodium',
      'walproinian', 'walproinian sodu', 'kwas walproinowy', 'valproinsyra',
      'valporate', 'valproat', 'valproite',
      'depakote', 'depakot', 'epilim', 'epilim chrono', 'depakine', 'depakine chrono', 'depakin', 'deprakine',
      'episenta', 'dyzantil', 'convulex', 'ergenyl', 'orfiril', 'absenor',
      '丙戊酸', '丙戊酸钠', '德巴金',
    ],
    olanzapine: [
      'olanzapine', 'olanzapin', 'olanzapina',
      'olanzepine', 'olanzipine', 'olanzapene', 'olanzepene',
      'zyprexa', 'zyprexa velotab', 'zypadhera', 'zalasta',
      '奥氮平', '再普乐',
    ],
    aripiprazole: [
      'aripiprazole', 'aripiprazol', 'aripiprazolo', 'arypiprazol',
      'aripriprazole', 'aripiprizole', 'aripiperazole', 'arapiprazole', 'aripiprazone',
      'abilify', 'abilify maintena', 'abilify mycite', 'abilfy',
      '阿立哌唑', '安律凡',
    ],
    risperidone: [
      'risperidone', 'rispéridone', 'risperidon', 'risperidona',
      'resperidone', 'risperidome', 'risperdione', 'risperadone',
      'risperdal', 'risperdal consta', 'risperidal',
      '利培酮', '维思通',
    ],
    // The wiki has one page for antidepressants as a group (its keys list
    // these generics), so every one of them opens that page.
    antidepressant: [
      'antidepressant', 'anti-depressant', 'antidepressants', 'anti-depressants',
      'antidepresivo', 'antidepresivos', 'antidepressivo', 'antidepressivi', 'antidepressivos',
      'antidépresseur', 'antidépresseurs', 'antidepresseur',
      'antidepressivum', 'antidepressiva', 'antidepressivum', 'antydepresant', 'antydepresanty', 'antydepresantów',
      'ssri', 'ssris', 'snri', 'snris',
      'sertraline', 'sertralin', 'sertralina', 'sertaline', 'setraline', 'zoloft', 'lustral',
      'fluoxetine', 'fluoxetin', 'fluoxetina', 'fluoksetyna', 'fluoxitine', 'fluoxatine', 'prozac', 'fluctine',
      'escitalopram', 'lexapro', 'cipralex', 'seroplex',
      'citalopram', 'celexa', 'cipramil', 'seropram',
      'venlafaxine', 'venlafaxin', 'venlafaxina', 'wenlafaksyna', 'venlafexine', 'effexor', 'efexor', 'trevilor',
      'duloxetine', 'duloxetin', 'duloxetina', 'duloksetyna', 'cymbalta',
      'mirtazapine', 'mirtazapin', 'mirtazapina', 'mirtazepine', 'mirtazipine', 'remeron', 'zispin', 'norset',
      'paroxetine', 'paroxetin', 'paroxetina', 'paroksetyna', 'paxil', 'seroxat', 'deroxat',
      '抗抑郁药', '舍曲林', '氟西汀', '艾司西酞普兰', '西酞普兰', '文拉法辛', '度洛西汀', '米氮平', '帕罗西汀',
      '左洛复', '百忧解', '来士普', '怡诺思', '欣百达', '瑞美隆', '赛乐特',
    ],
  };

  // ── Crisis text — mirrors functions/crisis-bot.js (EN + OTHER) ─────────────
  // Kept identical on purpose: scripts/test-med-links.mjs checks both agree on
  // a list of sentences. A post that reads like someone in crisis is no place
  // for a link to a medicine page.
  var CRISIS_EN = [
    /\bsuicid(e|al)\b/,
    /\bkill(ing)? my ?self\b/,
    /\bend(ing)? (it all|my life|my own life|everything)\b/,
    /\btake my (own )?life\b/,
    /\b(want|wanted|wanting) to die\b/,
    /\bwanna die\b/,
    /\bwish i (was|were) dead\b/,
    /\bbetter off (dead|without me)\b/,
    /\bdon'?t want to (be here|be alive|live|wake up)( any ?more)?\b/,
    /\bno (reason|point) (to|in) (live|living|going on)\b/,
    /\bnot worth living\b/,
    /\bcan'?t (go on|cope|take (it|this) any ?more|do this any ?more)\b/,
    /\b(hurt|hurting|harm|harming|cut|cutting) my ?self\b/,
    /\bself[- ]?harm/,
    /\boverdos(e|ed|ing)\b/,
    /\bin crisis\b/,
    /\bneed (to talk|to speak|someone to talk) to (someone|somebody|anyone)\b/,
    /\bneed (to talk|to speak) to (someone|somebody|anyone)? ?(asap|now|urgently|right now)\b/,
    /\bneed help (asap|now|urgently|right now)\b/,
  ];
  var CRISIS_OTHER = [
    'suicid', 'suïcid',
    'quiero morir', 'matarme', 'quitarme la vida', 'no puedo más', 'no quiero vivir',
    'voglio morire', 'farla finita', 'uccidermi', 'togliermi la vita', 'non ce la faccio più',
    'ho bisogno di parlare con qualcuno',
    'je veux mourir', 'me tuer', "envie d'en finir", 'envie de mourir', "j'ai besoin de parler à quelqu'un",
    'ich will sterben', 'mich umbringen', 'selbstmord', 'suizid', 'nicht mehr leben',
    'quero morrer', 'me matar', 'acabar com tudo', 'não quero viver',
    'ik wil dood', 'zelfmoord', 'wil niet meer leven',
    'chcę umrzeć', 'samobój', 'zabić się', 'nie chcę żyć',
    'vill dö', 'självmord', 'ta livet av mig',
    '想死', '自杀', '自殺', '不想活',
  ];
  function looksLikeCrisis(text) {
    var t = String(text || '').toLowerCase().replace(/[‘’ʼ`´]/g, "'").replace(/\s+/g, ' ');
    if (!t) return false;
    for (var i = 0; i < CRISIS_EN.length; i++) if (CRISIS_EN[i].test(t)) return true;
    for (var j = 0; j < CRISIS_OTHER.length; j++) if (t.indexOf(CRISIS_OTHER[j]) !== -1) return true;
    return false;
  }

  // ── Strings (all ten languages) ────────────────────────────────────────────
  var S = {
    en: { title: 'About {name} in the wiki', note: "ℹ️ You opened this from a post. It's information, not advice: talk to your doctor or pharmacist before you change or stop any medicine.", back: '← Back to the post', offLabel: "Don't link medicine names", offSub: 'Medicine names in posts open their wiki page. Tick this to show them as plain text.' },
    es: { title: 'Sobre {name} en la wiki', note: 'ℹ️ Has abierto esto desde una publicación. Es información, no un consejo: habla con tu médico o farmacéutico antes de cambiar o dejar cualquier medicamento.', back: '← Volver a la publicación', offLabel: 'No enlazar nombres de medicamentos', offSub: 'Los nombres de medicamentos en las publicaciones abren su página de la wiki. Marca esto para mostrarlos como texto normal.' },
    fr: { title: 'À propos de {name} dans le wiki', note: "ℹ️ Tu as ouvert ceci depuis une publication. C'est une information, pas un conseil : parle à ton médecin ou à ton pharmacien avant de modifier ou d'arrêter un médicament.", back: '← Retour à la publication', offLabel: 'Ne pas lier les noms de médicaments', offSub: 'Les noms de médicaments dans les publications ouvrent leur page du wiki. Coche ceci pour les afficher en texte simple.' },
    de: { title: 'Über {name} im Wiki', note: 'ℹ️ Du hast dies aus einem Beitrag geöffnet. Das ist eine Information, kein Rat: Sprich mit deiner Ärztin, deinem Arzt oder in der Apotheke, bevor du ein Medikament änderst oder absetzt.', back: '← Zurück zum Beitrag', offLabel: 'Medikamentennamen nicht verlinken', offSub: 'Medikamentennamen in Beiträgen öffnen ihre Wiki-Seite. Setze hier ein Häkchen, um sie als normalen Text zu zeigen.' },
    it: { title: 'Su {name} nella wiki', note: "ℹ️ L'hai aperto da un post. È un'informazione, non un consiglio: parla con il tuo medico o farmacista prima di cambiare o sospendere qualsiasi farmaco.", back: '← Torna al post', offLabel: 'Non collegare i nomi dei farmaci', offSub: 'I nomi dei farmaci nei post aprono la loro pagina della wiki. Spunta qui per mostrarli come testo semplice.' },
    pt: { title: 'Sobre {name} na wiki', note: 'ℹ️ Abriste isto a partir de uma publicação. É informação, não um conselho: fala com o teu médico ou farmacêutico antes de alterares ou deixares qualquer medicamento.', back: '← Voltar à publicação', offLabel: 'Não ligar nomes de medicamentos', offSub: 'Os nomes de medicamentos nas publicações abrem a respetiva página da wiki. Assinala isto para os mostrar como texto simples.' },
    nl: { title: 'Over {name} in de wiki', note: 'ℹ️ Je hebt dit vanuit een bericht geopend. Het is informatie, geen advies: overleg met je arts of apotheker voordat je een medicijn verandert of ermee stopt.', back: '← Terug naar het bericht', offLabel: 'Medicijnnamen niet linken', offSub: 'Medicijnnamen in berichten openen hun wikipagina. Vink dit aan om ze als gewone tekst te tonen.' },
    pl: { title: '{name} w wiki', note: 'ℹ️ Otwarto to z posta. To informacja, nie porada: porozmawiaj z lekarzem lub farmaceutą, zanim zmienisz lub odstawisz jakikolwiek lek.', back: '← Wróć do posta', offLabel: 'Nie linkuj nazw leków', offSub: 'Nazwy leków w postach otwierają ich stronę w wiki. Zaznacz, aby pokazywać je jako zwykły tekst.' },
    sv: { title: 'Om {name} i wikin', note: 'ℹ️ Du öppnade detta från ett inlägg. Det är information, inte råd: prata med din läkare eller farmaceut innan du ändrar eller slutar med något läkemedel.', back: '← Tillbaka till inlägget', offLabel: 'Länka inte läkemedelsnamn', offSub: 'Läkemedelsnamn i inlägg öppnar sin wikisida. Kryssa i detta för att visa dem som vanlig text.' },
    zh: { title: '在百科中了解{name}', note: 'ℹ️ 你是从一条帖子打开这里的。这是信息，不是建议：更改或停用任何药物之前，请先咨询你的医生或药剂师。', back: '← 返回帖子', offLabel: '不要链接药物名称', offSub: '帖子中的药物名称会打开对应的百科页面。勾选此项即可显示为普通文字。' },
  };
  if (window.BB && BB.i18n && BB.i18n.extend) {
    Object.keys(S).forEach(function (code) { BB.i18n.extend(code, { medlink: S[code] }); });
  }
  function _t(key, vars) {
    return (window.BB && typeof window.BB.t === 'function') ? window.BB.t(key, vars) : key;
  }

  // ── Dictionary → one matcher ──────────────────────────────────────────────
  var _pages = null;    // page → {entry, slug, names}
  var _byName = null;   // lower-case name → page
  var _re = null;       // every name, longest first
  var WORD = /[\p{L}\p{N}_]/u;
  // Chinese (and other unspaced scripts) run straight into Latin brand names —
  // 我在吃Seroquel — so they don't count as part of a Latin word.
  var CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
  var LATIN = /[a-z]/;
  function _isWord(c) { return !!c && WORD.test(c) && !CJK.test(c); }

  function _slug(t) {
    return String(t).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  }
  function _escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function _build() {
    if (_re) return true;
    var list = (window.BB && BB.medications && BB.medications.list) || [];
    if (!list.length) return false;
    _pages = {}; _byName = {};
    var names = [];
    Object.keys(DICT).forEach(function (page) {
      var entry = null;
      for (var i = 0; i < list.length; i++) if (list[i].keys && list[i].keys[0] === page) { entry = list[i]; break; }
      if (!entry) return;   // no wiki page → never linked
      var all = DICT[page].concat(entry.keys || []);
      var mine = [];
      all.forEach(function (n) {
        n = String(n).toLowerCase();
        if (!n || _byName[n]) return;
        _byName[n] = page; names.push(n); mine.push(n);
      });
      _pages[page] = { entry: entry, slug: _slug(entry.title), names: mine };
    });
    names.sort(function (a, b) { return b.length - a.length; });
    _re = new RegExp(names.map(_escRe).join('|'), 'giu');
    return true;
  }

  /**
   * The first mention of each page in `text`: [{page, index, length, text}],
   * in reading order. `seen` (optional) carries pages already linked earlier
   * in the same post.
   */
  function find(text, seen) {
    if (!_build() || !text) return [];
    seen = seen || {};
    var out = [];
    var s = String(text);
    _re.lastIndex = 0;
    var m;
    while ((m = _re.exec(s))) {
      var start = m.index, end = start + m[0].length;
      var name = m[0].toLowerCase();
      var page = _byName[name];
      if (LATIN.test(name)) {
        // Plural: lithiums, SSRIs, antidepressants (when not listed already).
        if (/^es/i.test(s.slice(end, end + 2)) && !_isWord(s.charAt(end + 2))) end += 2;
        else if (/^s/i.test(s.charAt(end)) && !_isWord(s.charAt(end + 1))) end += 1;
        if (_isWord(s.charAt(start - 1)) || _isWord(s.charAt(end))) { _re.lastIndex = start + 1; continue; }
      }
      if (page && !seen[page]) {
        seen[page] = true;
        out.push({ page: page, index: start, length: end - start, text: s.slice(start, end) });
      }
      _re.lastIndex = end;
    }
    return out;
  }

  // ── DOM ───────────────────────────────────────────────────────────────────
  function isOff() {
    try { return localStorage.getItem(OFF_KEY) === 'true'; } catch (_) { return false; }
  }
  function setOff(off) {
    try {
      if (off) localStorage.setItem(OFF_KEY, 'true');
      else localStorage.removeItem(OFF_KEY);
    } catch (_) {}
    scan(document);
  }

  /** Put the element back to plain text (the words never changed). */
  function unlink(el) {
    if (!el || !el.querySelectorAll) return;
    var links = el.querySelectorAll('a.med-link');
    if (!links.length) return;
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      a.parentNode.replaceChild(document.createTextNode(a.textContent), a);
    }
    el.normalize();
  }

  function _eligible(el) {
    if (!el || !el.hasAttribute || !el.hasAttribute('data-medlink')) return false;
    if (el.closest && el.closest('[data-medlink-skip]')) return false;
    if (isOff()) return false;
    if (looksLikeCrisis(el.textContent)) return false;
    var orig = el.getAttribute('data-tt-orig');
    if (orig && looksLikeCrisis(orig)) return false;
    return true;
  }

  function link(el) {
    if (!el || !el.querySelectorAll) return;
    unlink(el);
    if (!_eligible(el) || !_build()) return;
    var seen = {};
    // Text nodes in reading order; the hits are collected first so splitting
    // nodes doesn't disturb the walk.
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var jobs = [];
    var node;
    while ((node = walker.nextNode())) {
      var hits = find(node.nodeValue, seen);
      if (hits.length) jobs.push({ node: node, hits: hits });
    }
    jobs.forEach(function (job) {
      var text = job.node.nodeValue;
      var frag = document.createDocumentFragment();
      var pos = 0;
      job.hits.forEach(function (h) {
        if (h.index > pos) frag.appendChild(document.createTextNode(text.slice(pos, h.index)));
        var info = _pages[h.page];
        var a = document.createElement('a');
        a.className = 'med-link';
        a.href = '#wiki-' + info.slug;
        a.setAttribute('data-med', h.page);
        a.title = _t('medlink.title', { name: h.text });
        a.textContent = h.text;
        frag.appendChild(a);
        pos = h.index + h.length;
      });
      if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
      job.node.parentNode.replaceChild(frag, job.node);
    });
  }

  function scan(root) {
    root = root || document;
    if (!root.querySelectorAll) return;
    if (root.hasAttribute && root.hasAttribute('data-medlink')) link(root);
    var els = root.querySelectorAll('[data-medlink]');
    for (var i = 0; i < els.length; i++) link(els[i]);
  }

  function pages() { _build(); return _pages || {}; }

  // translate.js tells us whenever it rewrites a post's text (translation in,
  // original back) — the links have to be laid on again.
  document.addEventListener('bb:ttchange', function (e) {
    if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-medlink')) link(e.target);
  });

  // One capture-phase listener: the tap must not also open the card's thread,
  // start a swipe-to-reply, or follow the #hash.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a.med-link');
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    var api = window.BB && window.BB.medLinks;
    if (api && typeof api.onOpen === 'function') api.onOpen(a.getAttribute('data-med'), a);
  }, true);

  window.BB = window.BB || {};
  window.BB.medLinks = {
    scan: scan,
    link: link,
    unlink: unlink,
    find: find,
    pages: pages,
    isOff: isOff,
    setOff: setOff,
    looksLikeCrisis: looksLikeCrisis,
    onOpen: null,
    DICT: DICT,
  };
})();
