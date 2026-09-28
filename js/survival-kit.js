/**
 * Bipolar Survival Kit page logic (extracted from inline <script> blocks
 * in survival-kit.html). Loads after the Firebase compat SDK and after the
 * shared helpers in <head> (platform.js, debug.js, firebase-config.js).
 *
 * High-level structure (block markers below mirror the original inline
 * <script> boundaries — keep them in source order to preserve any
 * top-level ordering dependencies):
 *
 *   Block 1: section/accordion toggling, mood-cycle hint, page-load init.
 *   Block 2: medication list (with escMed escape helper for that section).
 *   Block 3: Firebase init + people-helped counter.
 *   Block 4: status bar + system colour bridges (Capacitor only).
 *   Block 5: navigation handlers and onboarding-step advances.
 *   Block 6: cross-page helpers (logo variant, focus mode, etc.).
 *
 * @file js/survival-kit.js
 */

/**
 * Escape HTML-significant characters in user-typed content before splicing
 * into innerHTML. Use for any free-text user data (goal titles, memory
 * notes, coping strategies, custom reminders, etc.).
 *
 * @param {string} s
 * @returns {string}
 */
function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Guarded translation helper. Returns the translated string for `k`
 * (with optional {var} interpolation via `v`), falling back to the key
 * itself if the i18n module hasn't loaded yet.
 *
 * @param {string} k  dot-notation i18n key (e.g. 'sk.memories.recordTitle')
 * @param {Object} [v] interpolation vars, e.g. { mood: '🚀 Manic' }
 * @returns {string}
 */
function _skt(k, v) {
  return (window.BB && window.BB.t) ? window.BB.t(k, v) : k;
}

/**
 * Mood-label lookup that respects the active language. The storage keys
 * stay stable ('manic', 'elevated', 'good', 'low', 'depressed', 'hypomanic',
 * 'stable') — only the displayed text is translated.
 *
 * @param {string} moodKey
 * @returns {string}
 */
function _sktMood(moodKey) {
  var map = {
    manic: 'sk.moodLabels.manic',
    elevated: 'sk.moodLabels.elevated',
    hypomanic: 'sk.moodLabels.elevated',
    good: 'sk.moodLabels.good',
    stable: 'sk.moodLabels.good',
    low: 'sk.moodLabels.low',
    depressed: 'sk.moodLabels.depressed',
  };
  return map[moodKey] ? _skt(map[moodKey]) : moodKey;
}

// ── BLOCK 1: section/accordion toggling, page-load init ──
// ── SECTION COLLAPSE ──
    function toggleSection(headerEl) {
      const section = headerEl.closest('.section');
      // In the focused view the open section's header is just a title — tapping
      // it must not collapse the only thing on screen. (All sections are shown
      // one at a time from the overview grid now.)
      if (section.classList.contains('sk-open')) return;
      section.classList.toggle('collapsed');
    }

    // ── REMEMBER THIS ──
    (function() {
      const saved = localStorage.getItem('rememberThis');
      if (saved) {
        const el = document.getElementById('rememberText');
        if (el) el.value = saved;
      }
    })();
    document.addEventListener('input', function(e) {
      if (e.target && e.target.id === 'rememberText') {
        localStorage.setItem('rememberThis', e.target.value);
        syncRememberToFirestore(e.target.value);
        _skUpdateTicks();
      }
    });
    function toggleRemember() {
      const overlay = document.getElementById('rememberOverlay');
      const btn = document.getElementById('rememberToggleBtn');
      const isHidden = overlay.style.display === 'block';
      overlay.style.display = isHidden ? 'none' : 'block';
      btn.textContent = isHidden ? _skt('sk.mindGames.hide') : _skt('sk.mindGames.show');
      _skUpdateTicks();
    }

    // ── OVERVIEW GRID / FOCUSED SECTION VIEW ──
    // The page opens on a grid of section tiles (#skOverview). Tapping a tile
    // (or a tab in the sticky nav, or arriving with #<section-id> in the URL,
    // e.g. fab.js's "survival-kit.html#goals") shows just that section with a
    // Back bar. The crisis box (#help) stays visible in both views. This is
    // presentation only: section markup, ids and data are unchanged.
    const _SK_SECTION_IDS = ['mood-scale', 'coping-strategies', 'medications', 'gratitude',
      'goals', 'mind', 'books', 'media', 'memories', 'faq', 'steps', 'spiritual'];
    let _skOpenId = null;

    function _skNavOffset() {
      const nav = document.querySelector('.sticky-nav');
      return (nav ? nav.offsetHeight : 60) + 8;
    }
    // Scrolls `el` to just under the sticky nav. Works for both the window
    // (phones) and the #scroll-view container of the desktop iPhone frame.
    function _skScrollTo(el, smooth) {
      if (!el) return;
      el.style.scrollMarginTop = _skNavOffset() + 'px';
      el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
    }

    function updateActiveNav() {
      const current = _skOpenId || 'all';
      document.querySelectorAll('.sk-tab[data-sk-tab]').forEach(link => {
        const on = link.getAttribute('data-sk-tab') === current;
        link.classList.toggle('active', on);
        if (on) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
        if (on) {
          const row = link.parentElement;
          if (row && row.scrollWidth > row.clientWidth) {
            row.scrollTo({ left: link.offsetLeft - (row.clientWidth - link.offsetWidth) / 2, behavior: 'smooth' });
          }
        }
      });
    }

    function _skSetHash(id) {
      try {
        const url = location.pathname + location.search + (id ? '#' + id : '');
        history.replaceState(history.state, '', url);
      } catch (_) {}
    }

    function skOpenSection(id, opts) {
      opts = opts || {};
      const section = document.getElementById(id);
      const container = document.getElementById('skContainer');
      if (!section || !container || _SK_SECTION_IDS.indexOf(id) === -1) return;
      document.querySelectorAll('.section.sk-open').forEach(s => s.classList.remove('sk-open'));
      section.classList.add('sk-open');
      section.classList.remove('collapsed');
      container.classList.add('sk-focused');
      _skOpenId = id;
      if (opts.hash !== false) _skSetHash(id);
      updateActiveNav();
      if (opts.scroll !== false) _skScrollTo(document.getElementById('skBackBar'), false);
    }
    window.skOpenSection = skOpenSection;

    function skShowGrid(opts) {
      opts = opts || {};
      const container = document.getElementById('skContainer');
      if (!container) return;
      const wasOpen = _skOpenId;
      document.querySelectorAll('.section.sk-open').forEach(s => s.classList.remove('sk-open'));
      container.classList.remove('sk-focused');
      _skOpenId = null;
      if (opts.hash !== false) _skSetHash('');
      updateActiveNav();
      if (opts.scroll === false) return;
      // Return to the tile the user came from so they don't lose their place.
      const tile = wasOpen && document.querySelector('.sk-tile[data-sk-open="' + wasOpen + '"]');
      if (tile) {
        const r = tile.getBoundingClientRect();
        if (r.top < _skNavOffset() || r.bottom > window.innerHeight) {
          tile.scrollIntoView({ behavior: 'auto', block: 'center' });
        }
        try { tile.focus({ preventScroll: true }); } catch (_) {}
      } else {
        _skScrollTo(document.getElementById('skOverview'), false);
      }
    }
    window.skShowGrid = skShowGrid;

    // SOS banner → the existing "Need Help Right Now?" crisis box.
    function skGoToHelp() {
      const help = document.getElementById('help');
      if (!help) return;
      _skScrollTo(help, true);
      const box = help.querySelector('.crisis-box');
      if (box) {
        box.classList.remove('sk-pulse');
        void box.offsetWidth; // restart the animation on repeat taps
        box.classList.add('sk-pulse');
      }
    }
    window.skGoToHelp = skGoToHelp;

    // Route a "#id" to the right view. Returns true if it was handled.
    function _skRouteHash(hash, fromLoad) {
      const id = String(hash || '').replace(/^#/, '');
      if (_SK_SECTION_IDS.indexOf(id) !== -1) { skOpenSection(id, { hash: false }); return true; }
      if (id === 'help') { skGoToHelp(); return true; }
      if (id === 'all' || (!id && !fromLoad)) { skShowGrid({ hash: false, scroll: !fromLoad }); return true; }
      return false;
    }

    // Tile taps (event delegation — tiles are static markup).
    document.addEventListener('click', e => {
      const tile = e.target.closest && e.target.closest('.sk-tile[data-sk-open]');
      if (tile) { skOpenSection(tile.getAttribute('data-sk-open')); return; }
      // In-page "#…" links: the nav tabs, the Help tab, and any other link on
      // this page that points at a section (e.g. fab.js's goals link).
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href') || '';
      const m = href.match(/^(?:survival-kit\.html)?#([\w-]+)$/);
      if (!m) return;
      if (m[1] === 'all') { e.preventDefault(); skShowGrid(); return; }
      if (_SK_SECTION_IDS.indexOf(m[1]) !== -1 || m[1] === 'help') {
        e.preventDefault();
        _skRouteHash('#' + m[1]);
      }
    });
    window.addEventListener('hashchange', () => { _skRouteHash(location.hash); });

    // Initial view: a deep link opens its section, otherwise the grid.
    if (!_skRouteHash(location.hash, true)) updateActiveNav();

    // Tab / tile accessible names (data-i18n only sets textContent, so the
    // aria-labels are rebuilt here after translations apply).
    function _skApplyGridA11y() {
      const row = document.getElementById('skTabRow');
      if (row) row.setAttribute('aria-label', _skt('sk.grid.tabsLabel'));
      document.querySelectorAll('.sk-tab[data-sk-tab]').forEach(link => {
        const id = link.getAttribute('data-sk-tab');
        const tile = document.querySelector('.sk-tile[data-sk-open="' + id + '"] .sk-tile-name');
        const lbl = link.querySelector('.sk-tab-lbl');
        link.setAttribute('aria-label', (tile ? tile.textContent : (lbl ? lbl.textContent : id)).trim());
      });
      document.querySelectorAll('.sk-tile[data-sk-open]').forEach(tile => {
        const name = (tile.querySelector('.sk-tile-name') || {}).textContent || '';
        const state = tile.classList.contains('done') ? _skt('sk.grid.done') : _skt('sk.grid.todo');
        tile.setAttribute('aria-label', name.trim() + ', ' + state);
      });
    }
    document.addEventListener('DOMContentLoaded', _skApplyGridA11y);
    document.addEventListener('bb:languagechange', () => { _skApplyGridA11y(); _skUpdateTicks(); });

    // ── ACCORDION ──
    function toggleAccordion(el) {
      // el can be either the .accordion-header button or the .accordion div itself
      const accordion = el.classList.contains('accordion') ? el : el.closest('.accordion');
      const body   = accordion.querySelector('.accordion-body');
      const header = accordion.querySelector('.accordion-header');
      const isOpen = body.classList.contains('open');
      document.querySelectorAll('.accordion-body').forEach(b => b.classList.remove('open'));
      document.querySelectorAll('.accordion-header').forEach(b => b.classList.remove('open'));
      if (!isOpen) { body.classList.add('open'); header.classList.add('open'); }
    }

    // ── MOOD ICONS ──
    let _moodScrolled = false;
    function showMoodDetail(mood) {
      // Stop cycling when user makes a deliberate selection
      if (_moodCycleInterval) { clearInterval(_moodCycleInterval); _moodCycleInterval = null; }
      _moodUserSelected = true;
      document.querySelectorAll('.mood-detail-panel').forEach(p => p.classList.remove('visible'));
      document.querySelectorAll('#mood-scale .mood-icon-btn').forEach(b => b.classList.remove('selected'));
      document.getElementById('moodDetail-' + mood).classList.add('visible');
      event.currentTarget.classList.add('selected');
      const tip = document.getElementById('moodScaleTip');
      if (tip) tip.style.display = 'none';
      if (!_moodScrolled) {
        _moodScrolled = true;
        const _ms = document.getElementById('mood-scale');
        if (_ms) {
          const _r = _ms.getBoundingClientRect();
          // Only scroll if the mood scale panel is not fully visible
          if (_r.bottom > window.innerHeight) {
            _ms.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      }
    }

    function _showMoodDefHint(mood) {
      const _ov = document.getElementById('bbSkOverlay');
      if (_ov) _ov.style.display = '';
      // Reset any previously elevated moodDefArea, then elevate only the current one
      document.querySelectorAll('[id^="moodDefArea-"]').forEach(el => { el.style.position = ''; el.style.zIndex = ''; });
      const _area = document.getElementById('moodDefArea-' + mood);
      if (_area) { _area.style.position = 'relative'; _area.style.zIndex = '120'; }
      _renderMoodDefHint(mood);
    }
    function _renderMoodDefHint(mood) {
      document.getElementById('moodDefHintEl')?.remove();
      const area = document.getElementById('moodDefArea-' + mood);
      if (!area) return;
      const hint = document.createElement('div');
      hint.id = 'moodDefHintEl';
      hint.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;pointer-events:none;animation:hintFade 2.4s ease-in-out infinite;margin-bottom:6px;';
      hint.innerHTML = '<span style="font-size:0.78em;font-weight:700;font-style:italic;color:rgba(255,255,255,0.9);font-family:\'Georgia\',serif;letter-spacing:0.01em;white-space:nowrap;text-shadow:0 1px 4px rgba(0,0,0,0.5);">' + _esc(_skt('sk.moodDef.hint')) + '</span><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><line x1="8" y1="1" x2="8" y2="12" stroke="rgba(255,255,255,0.85)" stroke-width="2" stroke-linecap="round"/><polyline points="3,7 8,13 13,7" stroke="rgba(255,255,255,0.85)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      area.insertBefore(hint, area.firstChild);
    }

    // ── MOOD CYCLING ON PAGE LOAD ──
    let _moodCycleInterval = null;
    let _moodCycleIndex = 2; // start at 'stable' (index 2)
    let _moodUserSelected = false;
    const _cycleMoods = ['manic', 'hypomanic', 'stable', 'low', 'depressed'];

    function _startMoodCycle() {
      // During cycling only highlight icons — panels stay hidden until user clicks
      document.querySelector('.mood-icon-btn.' + _cycleMoods[_moodCycleIndex]).classList.add('selected');
      _moodCycleInterval = setInterval(() => {
        _moodCycleIndex = (_moodCycleIndex + 1) % _cycleMoods.length;
        const mood = _cycleMoods[_moodCycleIndex];
        document.querySelectorAll('#mood-scale .mood-icon-btn').forEach(b => b.classList.remove('selected'));
        document.querySelector('.mood-icon-btn.' + mood).classList.add('selected');
      }, 3000);
    }

    window.addEventListener('DOMContentLoaded', () => {
      _startMoodCycle();
      _startMemoryCycle();

      // Initialise spirit quote card
      showSpiritQuote();
      // Initialise famous person card
      showCeleb();
      // Update section completion ticks
      _skUpdateTicks();

      // First-ever visit: show welcome popup instead of blocking mood-selector hint
      if (BB.storage.get('SurvivalKitVisited') !== '1') {
        sessionStorage.removeItem('_bbSkipScroll');
        setTimeout(() => {
          if (document.getElementById('skWelcomeModal')) return;
          const _modal = document.createElement('div');
          _modal.id = 'skWelcomeModal';
          _modal.innerHTML = `<div style="background:linear-gradient(135deg,var(--brand-primary-mid),var(--brand-primary-light));border-radius:20px;padding:28px 32px;text-align:center;max-width:300px;width:calc(100vw - 64px);box-shadow:0 12px 48px rgba(255,107,0,0.55);">
            <div style="font-size:2.6em;margin-bottom:10px;">🧰</div>
            <div style="font-weight:800;font-size:1.1em;color:white;margin-bottom:10px;">${_skt('sk.welcome.title')}</div>
            <div style="font-size:0.88em;color:rgba(255,255,255,0.9);line-height:1.5;margin-bottom:16px;">${_skt('sk.welcome.body')}</div>
            <div style="font-size:0.78em;color:rgba(255,255,255,0.65);">${_skt('sk.welcome.dismiss')}</div>
          </div>`;
          Object.assign(_modal.style, {
            position:'fixed', inset:'0', display:'flex', alignItems:'center', justifyContent:'center',
            background:'rgba(0,0,0,0.55)', zIndex:'9999', cursor:'pointer',
          });
          _modal.addEventListener('click', () => {
            _modal.remove();
            BB.storage.set('SurvivalKitVisited', '1');
            BB.storage.set('MoodDefHintDone', '1');
            _applySkOnboardingGating();
          });
          document.body.appendChild(_modal);
          _modal.style.opacity = '0';
          _modal.style.transition = 'opacity 0.3s ease';
          requestAnimationFrame(() => { _modal.style.opacity = '1'; });
        }, 300);
        return;
      }

      // Smooth scroll to just above the guide title on load (custom 1.2s ease)
      // Skip when arriving via the index slide-in animation (already at top)
      if (sessionStorage.getItem('_bbSkipScroll') === '1') { sessionStorage.removeItem('_bbSkipScroll'); return; }
      // Deep-linked straight into a section (e.g. #goals): keep it in view
      // instead of gliding up to the title.
      if (_skOpenId) { requestAnimationFrame(() => _skScrollTo(document.getElementById('skBackBar'), false)); return; }
      requestAnimationFrame(() => {
        const title = document.getElementById('survivalGuideTitle');
        if (!title) return;
        const nav = document.querySelector('.sticky-nav');
        const navH = nav ? nav.offsetHeight : 60;
        const target = title.getBoundingClientRect().top + window.scrollY - navH - 8;
        const start = window.scrollY;
        const distance = target - start;
        const duration = 1200;
        let startTime = null;
        function easeInOutCubic(t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2; }
        function step(ts) {
          if (!startTime) startTime = ts;
          const elapsed = Math.min((ts - startTime) / duration, 1);
          window.scrollTo(0, start + distance * easeInOutCubic(elapsed));
          if (elapsed < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      });
    });

    function _applyGuideTitle(fullName) {
      const el = document.getElementById('survivalGuideTitle');
      if (!el) return;
      const firstName = (fullName || '').trim().split(/\s+/)[0] || '';
      if (firstName) {
        const possessive = firstName.endsWith('s') ? `${firstName}'` : `${firstName}'s`;
        // English uses a possessive ("James's …") via {possessive}; languages
        // like French use the plain name ("… de {name}"). Both vars are passed
        // so each locale string can pick whichever placeholder it needs.
        el.innerHTML = _skt('sk.guideTitle.possessive', { possessive: _esc(possessive), name: _esc(firstName) });
      } else {
        el.textContent = _skt('sk.guideTitle.plain');
      }
    }
    // Apply from localStorage immediately (before Firestore loads)
    _applyGuideTitle(localStorage.getItem('personalName') || '');

    // ── SPIRIT QUOTES ──
    const SPIRIT_QUOTES = [
      // ── Benjamin Franklin (Poor Richard's Almanack unless noted) ──
      { group: 'franklin', emoji: '🪬', text: 'Well done is better than well said.', source: 'Benjamin Franklin — Poor Richard\'s Almanack' },
      { group: 'franklin', emoji: '🪬', text: 'Early to bed and early to rise makes a man healthy, wealthy, and wise.', source: 'Benjamin Franklin — Poor Richard\'s Almanack' },
      { group: 'franklin', emoji: '🪬', text: 'Lost time is never found again.', source: 'Benjamin Franklin — Poor Richard\'s Almanack' },
      { group: 'franklin', emoji: '🪬', text: 'Dost thou love life? Then do not squander time, for that\'s the stuff life is made of.', source: 'Benjamin Franklin — Poor Richard\'s Almanack' },
      { group: 'franklin', emoji: '🪬', text: 'The doors of wisdom are never shut.', source: 'Benjamin Franklin — Poor Richard\'s Almanack' },
      { group: 'franklin', emoji: '🪬', text: 'Be at war with your vices, at peace with your neighbours, and let every new year find you a better man.', source: 'Benjamin Franklin — Poor Richard\'s Almanack' },
      { group: 'franklin', emoji: '🪬', text: 'Diligence is the mother of good luck.', source: 'Benjamin Franklin — Poor Richard\'s Almanack' },
      { group: 'franklin', emoji: '🪬', text: 'Three may keep a secret, if two of them are dead.', source: 'Benjamin Franklin — Poor Richard\'s Almanack' },
      { group: 'franklin', emoji: '🪬', text: 'In this world nothing can be said to be certain, except death and taxes.', source: 'Benjamin Franklin — Letter to Jean-Baptiste Leroy, 1789' },
      { group: 'franklin', emoji: '🪬', text: 'An investment in knowledge pays the best interest.', source: 'Attributed to Benjamin Franklin' },
      // ── Bible (NIV) ──
      { group: 'bible', emoji: '🕊️', text: 'For I know the plans I have for you — plans to prosper you and not to harm you, plans to give you hope and a future.', source: 'Jeremiah 29:11' },
      { group: 'bible', emoji: '🕊️', text: 'I can do all things through Christ who strengthens me.', source: 'Philippians 4:13' },
      { group: 'bible', emoji: '🕊️', text: 'Cast all your anxiety on him because he cares for you.', source: '1 Peter 5:7' },
      { group: 'bible', emoji: '🕊️', text: 'Be still, and know that I am God.', source: 'Psalm 46:10' },
      { group: 'bible', emoji: '🕊️', text: 'Love is patient, love is kind. It does not envy, it does not boast, it is not proud.', source: '1 Corinthians 13:4' },
      { group: 'bible', emoji: '🕊️', text: 'The Lord is my shepherd; I shall not want.', source: 'Psalm 23:1' },
      { group: 'bible', emoji: '🕊️', text: 'Do not be anxious about anything, but in every situation, with thanksgiving, present your requests to God.', source: 'Philippians 4:6' },
      { group: 'bible', emoji: '🕊️', text: 'Come to me, all you who are weary and burdened, and I will give you rest.', source: 'Matthew 11:28' },
      { group: 'bible', emoji: '🕊️', text: 'For God has not given us a spirit of fear, but of power and of love and of a sound mind.', source: '2 Timothy 1:7' },
      { group: 'bible', emoji: '🕊️', text: 'The Lord is close to the brokenhearted and saves those who are crushed in spirit.', source: 'Psalm 34:18' },
      // ── Quran ──
      { group: 'quran', emoji: '🕋', text: 'Verily, with hardship comes ease.', source: 'Quran 94:5' },
      { group: 'quran', emoji: '🕋', text: 'Allah does not burden a soul beyond that it can bear.', source: 'Quran 2:286' },
      { group: 'quran', emoji: '🕋', text: 'And whoever relies upon Allah — then He is sufficient for him.', source: 'Quran 65:3' },
      { group: 'quran', emoji: '🕋', text: 'And He found you lost and guided you.', source: 'Quran 93:7' },
      { group: 'quran', emoji: '🕋', text: 'So remember Me; I will remember you.', source: 'Quran 2:152' },
      { group: 'quran', emoji: '🕋', text: 'Do not despair of the mercy of Allah. Indeed, Allah forgives all sins.', source: 'Quran 39:53' },
      { group: 'quran', emoji: '🕋', text: 'And when My servants ask you about Me — indeed I am near.', source: 'Quran 2:186' },
      { group: 'quran', emoji: '🕋', text: 'Whoever saves one life, it is as if he has saved all mankind.', source: 'Quran 5:32' },
      { group: 'quran', emoji: '🕋', text: 'Verily, in the remembrance of Allah do hearts find rest.', source: 'Quran 13:28' },
      { group: 'quran', emoji: '🕋', text: 'Allah intends for you ease and does not intend for you hardship.', source: 'Quran 2:185' },
      // ── Buddhist (Dhammapada references confirmed from Pali Canon; others attributed) ──
      { group: 'buddhist', emoji: '☸️', text: 'Mind is the forerunner of all actions. All deeds are led by mind, created by mind.', source: 'Dhammapada 1:1' },
      { group: 'buddhist', emoji: '☸️', text: 'Better than a thousand hollow words is one word that brings peace.', source: 'Dhammapada 8:100' },
      { group: 'buddhist', emoji: '☸️', text: 'Hatred is never appeased by hatred in this world; it is appeased by love. This is an eternal law.', source: 'Dhammapada 1:5' },
      { group: 'buddhist', emoji: '☸️', text: 'Conquer anger with non-anger, conquer evil with good, conquer the miser with generosity, conquer the liar with truth.', source: 'Dhammapada 17:223' },
      { group: 'buddhist', emoji: '☸️', text: 'A good friend who points out our mistakes is to be respected as a revealer of hidden treasure.', source: 'Dhammapada 6:76' },
      { group: 'buddhist', emoji: '☸️', text: 'Three things cannot be long hidden: the sun, the moon, and the truth.', source: 'Attributed to the Buddha' },
      { group: 'buddhist', emoji: '☸️', text: 'Peace comes from within. Do not seek it without.', source: 'Attributed to the Buddha' },
      { group: 'buddhist', emoji: '☸️', text: 'The mind is everything. What you think, you become.', source: 'Attributed to the Buddha' },
      { group: 'buddhist', emoji: '☸️', text: 'Thousands of candles can be lit from a single candle — happiness never decreases by being shared.', source: 'Attributed to the Buddha' },
      { group: 'buddhist', emoji: '☸️', text: 'In separateness lies the world\'s greatest misery; in compassion lies the world\'s true strength.', source: 'Attributed to the Buddha' },
      // ── Stoic / Philosophy ──
      { group: 'stoic', emoji: '✨', text: 'You have power over your mind, not outside events. Realise this and you will find strength.', source: 'Marcus Aurelius — Meditations' },
      { group: 'stoic', emoji: '✨', text: 'The happiness of your life depends upon the quality of your thoughts.', source: 'Marcus Aurelius — Meditations' },
      { group: 'stoic', emoji: '✨', text: 'Very little is needed to make a happy life; it is all within yourself, in your way of thinking.', source: 'Marcus Aurelius — Meditations' },
      { group: 'stoic', emoji: '✨', text: 'Waste no more time arguing about what a good man should be. Be one.', source: 'Marcus Aurelius — Meditations' },
      { group: 'stoic', emoji: '✨', text: 'If it is not right, do not do it; if it is not true, do not say it.', source: 'Marcus Aurelius — Meditations' },
      { group: 'stoic', emoji: '✨', text: 'The best revenge is to be unlike him who performed the injury.', source: 'Marcus Aurelius — Meditations' },
      { group: 'stoic', emoji: '✨', text: 'Make the best use of what is in your power, and take the rest as it happens.', source: 'Epictetus — Enchiridion' },
      { group: 'stoic', emoji: '✨', text: 'Men are disturbed not by things, but by their opinions about things.', source: 'Epictetus — Enchiridion' },
      { group: 'stoic', emoji: '✨', text: 'We suffer more often in imagination than in reality.', source: 'Seneca — Letters to Lucilius' },
      { group: 'stoic', emoji: '✨', text: 'He who has a why to live for can bear almost any how.', source: 'Friedrich Nietzsche — Twilight of the Idols' },
    ];

    let _spiritIdx = Math.floor(Math.random() * SPIRIT_QUOTES.length);
    let _spiritHistory = [];

    function showSpiritQuote() {
      const q = SPIRIT_QUOTES[_spiritIdx];
      document.getElementById('spiritQuoteEmoji').textContent  = q.emoji;
      document.getElementById('spiritQuoteText').textContent   = '\u201C' + q.text + '\u201D';
      document.getElementById('spiritQuoteSource').textContent = '\u2014 ' + q.source;
      const backBtn = document.getElementById('spiritBackBtn');
      if (backBtn) {
        const hasHistory = _spiritHistory.length > 0;
        backBtn.style.opacity = hasHistory ? '1' : '0.35';
        backBtn.style.pointerEvents = hasHistory ? '' : 'none';
      }
    }

    function nextSpiritQuote() {
      _spiritHistory.push(_spiritIdx);
      const currentGroup = SPIRIT_QUOTES[_spiritIdx].group;
      const candidates = SPIRIT_QUOTES.map((q, i) => i).filter(i => SPIRIT_QUOTES[i].group !== currentGroup);
      _spiritIdx = candidates[Math.floor(Math.random() * candidates.length)];
      showSpiritQuote();
    }

    function prevSpiritQuote() {
      if (!_spiritHistory.length) return;
      _spiritIdx = _spiritHistory.pop();
      showSpiritQuote();
    }
    window.prevSpiritQuote = prevSpiritQuote;

    // ── SECTION COMPLETION TICKS ──
    function _skUpdateTicks() {
      const _check = (key, parse) => {
        try { const v = localStorage.getItem(key); return v && (!parse || parse(v)); } catch(e) { return false; }
      };
      const sections = [
        { id: 'medications',       done: () => { try { const m = JSON.parse(localStorage.getItem('currentMedList')||'[]'); return Array.isArray(m) && m.length > 0; } catch(e){return false;} } },
        { id: 'goals',             done: () => { try { const g = JSON.parse(localStorage.getItem('dailyGoals')||'[]'); return Array.isArray(g) && g.length > 0; } catch(e){return false;} } },
        { id: 'gratitude',         done: () => { try { const gr = JSON.parse(localStorage.getItem('survivalGratitude')||'[]'); return Array.isArray(gr) && gr.length > 0; } catch(e){return false;} } },
        { id: 'mind',              done: () => { const v = localStorage.getItem('rememberThis'); return !!(v && v.trim()); } },
        { id: 'coping-strategies', done: () => { try { const cs = JSON.parse(localStorage.getItem('copingStrategies')||'{}'); return Object.values(cs).some(a => Array.isArray(a) && a.length > 0); } catch(e){return false;} } },
        { id: 'memories',          done: () => { try { const mm = JSON.parse(localStorage.getItem('moodMemories')||'{}'); return Object.values(mm).some(a => Array.isArray(a) && a.length > 0); } catch(e){return false;} } },
        { id: 'steps',             done: () => { try { const sc = JSON.parse(localStorage.getItem('myCommitments')||'[]'); return Array.isArray(sc) && sc.length > 0; } catch(e){return false;} } },
        { id: 'faq',               done: () => { try { const cr = JSON.parse(localStorage.getItem('customReminders')||'[]'); return Array.isArray(cr) && cr.length > 0; } catch(e){return false;} } },
        // Info-only sections — always complete
        { id: 'mood-scale', done: () => true },
        { id: 'books',      done: () => true },
        { id: 'media',      done: () => true },
        { id: 'spiritual',  done: () => true },
      ];
      let _doneCount = 0;
      sections.forEach(({ id, done }) => {
        const isDone = !!done();
        if (isDone) _doneCount++;
        const el = document.getElementById(`tick_${id}`);
        if (el) el.textContent = isDone ? '✅' : '⬜';
        // Overview grid tile for the same section — same done() test.
        const tile = document.querySelector(`.sk-tile[data-sk-open="${id}"]`);
        if (tile) {
          tile.classList.toggle('done', isDone);
          const name = (tile.querySelector('.sk-tile-name') || {}).textContent || '';
          tile.setAttribute('aria-label', name.trim() + ', ' + _skt(isDone ? 'sk.grid.done' : 'sk.grid.todo'));
        }
      });
      // Grid progress line — same count and wording as the home screen's
      // survival-progress badge (js/index.js _updateSurvivalProgress).
      const _gp = document.getElementById('skGridProgress');
      if (_gp) {
        _gp.textContent = _doneCount >= sections.length
          ? _skt('home.survivalAllDone')
          : _skt('home.survivalProgress', { c: _doneCount });
      }
      const _gf = document.getElementById('skGridProgressFill');
      if (_gf) _gf.style.width = Math.round(_doneCount / sections.length * 100) + '%';
      // Hide tap hints for filled sections
      const _copingFilled = sections.find(s => s.id === 'coping-strategies').done();
      const _memoriesFilled = sections.find(s => s.id === 'memories').done();
      const cTip = document.getElementById('copingStrategiesTip');
      if (cTip) cTip.style.display = _copingFilled ? 'none' : '';
      const mTip = document.getElementById('memoriesTip');
      if (mTip) mTip.style.display = _memoriesFilled ? 'none' : '';
    }
    window._skUpdateTicks = _skUpdateTicks;


    // ── FAMOUS PEOPLE WITH BIPOLAR ──
    const BIPOLAR_CELEBS = [
      { name: 'Mariah Carey',          field: 'Singer',                      wiki: 'Mariah_Carey' },
      { name: 'Kanye West',            field: 'Musician & Artist',            wiki: 'Kanye_West' },
      { name: 'Demi Lovato',           field: 'Singer & Actress',             wiki: 'Demi_Lovato' },
      { name: 'Stephen Fry',           field: 'Actor & Author',               wiki: 'Stephen_Fry' },
      { name: 'Carrie Fisher',         field: 'Actress & Author',             wiki: 'Carrie_Fisher' },
      { name: 'Catherine Zeta-Jones',  field: 'Actress',                      wiki: 'Catherine_Zeta-Jones' },
      { name: 'Pete Davidson',         field: 'Comedian & Actor',             wiki: 'Pete_Davidson' },
      { name: 'Brian Wilson',          field: 'Musician — The Beach Boys',    wiki: 'Brian_Wilson_(musician)' },
      { name: 'Ted Turner',            field: 'Media Mogul, Founder of CNN',  wiki: 'Ted_Turner' },
      { name: 'Mike Tyson',            field: 'Professional Boxer',           wiki: 'Mike_Tyson' },
      { name: 'Mel Gibson',            field: 'Actor & Director',             wiki: 'Mel_Gibson' },
      { name: 'Chris Brown',           field: 'Singer & Performer',           wiki: 'Chris_Brown' },
      { name: 'Ray Davies',            field: 'Musician — The Kinks',         wiki: 'Ray_Davies' },
      { name: 'Alvin Ailey',           field: 'Choreographer',                wiki: 'Alvin_Ailey' },
      { name: 'Taylor Tomlinson',      field: 'Comedian',                     wiki: 'Taylor_Tomlinson' },
      { name: 'Maria Bamford',         field: 'Comedian & Actress',           wiki: 'Maria_Bamford' },
      { name: 'Robbie Williams',       field: 'Singer',                       wiki: 'Robbie_Williams' },
      { name: 'Jane Pauley',           field: 'TV Journalist',                wiki: 'Jane_Pauley' },
      { name: 'Ben Stiller',           field: 'Actor & Director',             wiki: 'Ben_Stiller' },
      { name: 'Linda Hamilton',        field: 'Actress',                      wiki: 'Linda_Hamilton' },
      { name: 'Sinéad O\'Connor',      field: 'Singer',                       wiki: 'Sinéad_O\'Connor' },
      { name: 'Maurice Benard',        field: 'Actor',                        wiki: 'Maurice_Benard' },
      { name: 'Margaret Trudeau',      field: 'Mental Health Advocate',       wiki: 'Margaret_Trudeau' },
      { name: 'Bebe Rexha',            field: 'Singer',                       wiki: 'Bebe_Rexha' },
      { name: 'Halsey',                field: 'Singer',                       wiki: 'Halsey_(singer)' },
      { name: 'Patty Duke',            field: 'Actress & Bipolar Advocate',   wiki: 'Patty_Duke' },
      { name: 'Richard Dreyfuss',      field: 'Actor',                        wiki: 'Richard_Dreyfuss' },
      { name: 'Jean-Claude Van Damme', field: 'Actor & Martial Artist',       wiki: 'Jean-Claude_Van_Damme' },
      { name: 'Vivien Leigh',          field: 'Actress',                      wiki: 'Vivien_Leigh' },
      { name: 'Virginia Woolf',        field: 'Author',                       wiki: 'Virginia_Woolf' },
      { name: 'Adam Ant',              field: 'Singer',                       wiki: 'Adam_Ant' },
      { name: 'Lil Wayne',             field: 'Rapper',                       wiki: 'Lil_Wayne' },
      { name: 'Buzz Aldrin',           field: 'Astronaut',                    wiki: 'Buzz_Aldrin' },
      { name: 'Kay Redfield Jamison',  field: 'Psychiatrist & Author',        wiki: 'Kay_Redfield_Jamison' },
      { name: 'Devin Townsend',        field: 'Musician',                     wiki: 'Devin_Townsend' },
      { name: 'Max Bemis',             field: 'Musician — Say Anything',      wiki: 'Max_Bemis' },
      { name: 'Syd Barrett',           field: 'Musician — Pink Floyd',        wiki: 'Syd_Barrett' },
      { name: 'Vincent van Gogh',      field: 'Artist',                       wiki: 'Vincent_van_Gogh' },
      { name: 'Ernest Hemingway',      field: 'Author',                       wiki: 'Ernest_Hemingway' },
      { name: 'F. Scott Fitzgerald',   field: 'Author',                       wiki: 'F._Scott_Fitzgerald' },
      { name: 'Axl Rose',              field: 'Musician — Guns N\' Roses',    wiki: 'Axl_Rose' },
      { name: 'Trisha Goddard',        field: 'TV Presenter',                 wiki: 'Trisha_Goddard' },
      { name: 'Patricia Cornwell',     field: 'Author',                       wiki: 'Patricia_Cornwell' },
      { name: 'Nick Cannon',           field: 'Actor & TV Host',              wiki: 'Nick_Cannon' },
      { name: 'Robert Lowell',         field: 'Poet',                         wiki: 'Robert_Lowell' },
      { name: 'Maria Bello',           field: 'Actress & Producer',           wiki: 'Maria_Bello' },
    ];

    const _celebImgCache = {};

    function _getCelebQueue() {
      try {
        const q = JSON.parse(BB.storage.get('CelebQueue') || '[]');
        if (Array.isArray(q) && q.length > 0) return q;
      } catch(e) {}
      // Build a fresh shuffled queue
      const indices = BIPOLAR_CELEBS.map((_, i) => i);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      return indices;
    }

    function _getCelebIdx() {
      let queue = _getCelebQueue();
      const idx = queue.shift();
      BB.storage.set('CelebQueue', JSON.stringify(queue));
      return idx;
    }

    let _celebIdx = _getCelebIdx();

    async function showCeleb() {
      const c = BIPOLAR_CELEBS[_celebIdx];
      document.getElementById('celebName').textContent = c.name;
      document.getElementById('celebField').textContent = c.field;
      document.getElementById('celebWikiLink').href = 'https://en.wikipedia.org/wiki/' + c.wiki;

      const imgEl = document.getElementById('celebPhoto');
      const fallbackEl = document.getElementById('celebPhotoFallback');
      imgEl.style.display = 'none';
      fallbackEl.style.display = '';

      if (!_celebImgCache.hasOwnProperty(c.wiki)) {
        try {
          const title = c.wiki.replace(/_/g, ' ');
          const apiUrl = 'https://en.wikipedia.org/w/api.php?action=query&titles=' + encodeURIComponent(title) + '&prop=pageimages&format=json&pithumbsize=120&origin=*';
          const res = await fetch(apiUrl);
          const data = await res.json();
          const pages = data.query.pages;
          const page = pages[Object.keys(pages)[0]];
          _celebImgCache[c.wiki] = (page && page.thumbnail) ? page.thumbnail.source : null;
        } catch(e) {
          _celebImgCache[c.wiki] = null;
        }
      }

      const imgSrc = _celebImgCache[c.wiki];
      if (imgSrc) {
        imgEl.onload  = () => { imgEl.style.display = ''; fallbackEl.style.display = 'none'; };
        imgEl.onerror = () => { imgEl.style.display = 'none'; fallbackEl.style.display = ''; };
        imgEl.src = imgSrc;
        imgEl.alt = c.name;
      }
    }

    let _celebHistory = [];
    function nextCeleb() {
      _celebHistory.push(_celebIdx);
      _celebIdx = _getCelebIdx();
      showCeleb();
    }
    function prevCeleb() {
      if (!_celebHistory.length) return;
      _celebIdx = _celebHistory.pop();
      showCeleb();
    }
    window.nextCeleb = nextCeleb;
    window.prevCeleb = prevCeleb;

    // ── iOS body-scroll lock (prevents document scrolling when keyboard opens inside a modal) ──
    let _bodyScrollY = 0;
    function _lockBodyScroll() {
      _bodyScrollY = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${_bodyScrollY}px`;
      document.body.style.width = '100%';
    }
    function _unlockBodyScroll() {
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      // Defer by one frame so the browser commits the layout change before we scroll
      requestAnimationFrame(() => window.scrollTo(0, _bodyScrollY));
    }

    // ── FIRESTORE SYNC HELPERS ──
    function syncGoalsToFirestore(goals) {
      localStorage.setItem('_sk_savedAt', String(Date.now()));
      if (!window.db || !window.currentUser) return;
      window.db.collection('userSettings').doc(window.currentUser.uid).set(
        { dailyGoals: goals }, { merge: true }
      ).catch(e => console.warn('syncGoalsToFirestore error:', e));
    }

    function syncBudgetToFirestore(value) {
      localStorage.setItem('_sk_savedAt', String(Date.now()));
      if (!window.db || !window.currentUser) return;
      window.db.collection('userSettings').doc(window.currentUser.uid).set(
        { dailyBudget: value || '' }, { merge: true }
      ).catch(e => console.warn('syncBudgetToFirestore error:', e));
    }

    let rememberDebounce;
    function syncRememberToFirestore(text) {
      if (!window.db || !window.currentUser) return;
      clearTimeout(rememberDebounce);
      rememberDebounce = setTimeout(() => {
        window.db.collection('userSettings').doc(window.currentUser.uid).set(
          { rememberThis: text }, { merge: true }
        ).catch(() => {});
      }, 1000);
    }

    // ── MEDICATION ACCORDION DATA ──
    // Source of truth lives in js/shared/medications.js (also consumed by
    // the anonymous-board Wiki tab). Falls back to [] defensively.
    const KNOWN_MEDS = (window.BB && window.BB.medications && window.BB.medications.list) || [];

    function buildAccordionHTML(med) {
      return `<div class="accordion">
        <button class="accordion-header" onclick="toggleAccordion(this)">${med.title}<span class="chevron">▼</span></button>
        <div class="accordion-body">
          <p>${med.body}</p>
          <a href="${med.nhs}" target="_blank" class="link-btn secondary" style="font-size:0.82em; padding:6px 12px; margin-top:8px;">${_skt('anon.wiki.nhsInfo')}</a>
        </div>
      </div>`;
    }

    function matchMedToKnown(name) {
      return (window.BB && window.BB.medications && window.BB.medications.match(name)) || null;
    }

    function updateMedicationAccordions() {
      const primary = document.getElementById('primaryMedsContainer');
      const more = document.getElementById('moreMedsContainer');
      const moreBtn = document.getElementById('moreMedicationsBtn');
      if (!primary || !more) return;

      const userMeds = JSON.parse(localStorage.getItem('currentMedList') || '[]');

      if (userMeds.length === 0) {
        // Default: show Lithium, Lamotrigine, Quetiapine; rest in More
        primary.innerHTML = KNOWN_MEDS.slice(0, 3).map(buildAccordionHTML).join('');
        more.innerHTML = KNOWN_MEDS.slice(3).map(buildAccordionHTML).join('');
        if (moreBtn) moreBtn.style.display = '';
      } else {
        // Show user's medications first (matched to known, or basic display)
        const matched = new Set();
        let primaryHTML = '';
        userMeds.forEach(med => {
          const known = matchMedToKnown(med.name);
          if (known) {
            const key = known.keys[0];
            if (!matched.has(key)) {
              matched.add(key);
              primaryHTML += buildAccordionHTML(known);
            }
          } else {
            // Unknown med: show simple accordion with just the name/dosage
            primaryHTML += `<div class="accordion">
              <button class="accordion-header" onclick="toggleAccordion(this)">${med.name}${med.dosage ? ' (' + med.dosage + ')' : ''}<span class="chevron">▼</span></button>
              <div class="accordion-body"><p>${_skt('sk.meds.unknownBody')}</p></div>
            </div>`;
          }
        });
        primary.innerHTML = primaryHTML;

        // More section: all known meds not already shown
        const remainingKnown = KNOWN_MEDS.filter(m => !matched.has(m.keys[0]));
        if (remainingKnown.length > 0) {
          more.innerHTML = remainingKnown.map(buildAccordionHTML).join('');
          if (moreBtn) moreBtn.style.display = '';
        } else {
          if (moreBtn) moreBtn.style.display = 'none';
        }
      }
    }
    window.updateMedicationAccordions = updateMedicationAccordions;
    // Run on load
    updateMedicationAccordions();

    // ── MORE MEDICATIONS TOGGLE ──
    function toggleMoreMedications() {
      const section = document.getElementById('moreMedicationsSection');
      const btn = document.getElementById('moreMedicationsBtn');
      const visible = section.style.display !== 'none';
      section.style.display = visible ? 'none' : 'block';
      btn.textContent = visible ? _skt('sk.meds.more') : _skt('sk.meds.less');
    }
    window.toggleMoreMedications = toggleMoreMedications;

    // ── MEDICATION INFO ──
    function escMed(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function getMedList() {
      return JSON.parse(localStorage.getItem('currentMedList') || '[]');
    }

    function saveMedList(list) {
      localStorage.setItem('currentMedList', JSON.stringify(list));
      localStorage.setItem('_sk_savedAt', String(Date.now()));
      if (window.db && window.currentUser) {
        window.db.collection('userSettings').doc(window.currentUser.uid).set(
          { currentMedList: list }, { merge: true }
        ).catch(e => console.warn('saveMedList error:', e));
      }
      loadMedInfo();
      if (typeof updateMedicationAccordions === 'function') updateMedicationAccordions();
      checkSurvivalKitAchievement('first_medication');
      _skUpdateTicks();
    }

    function loadMedInfo() {
      const list = getMedList();
      const display = document.getElementById('currentMedDisplay');
      if (!display) return;
      if (list.length === 0) {
        display.innerHTML = '<em>' + _esc(_skt('sk.meds.currentEmpty')) + '</em>';
      } else {
        display.innerHTML = list.map(m =>
          `<div>• <strong>${escMed(m.name)}</strong>${m.dosage ? ' — ' + escMed(m.dosage) : ''}</div>`
        ).join('');
      }
    }

    function renderMedList() {
      const list = getMedList();
      const el = document.getElementById('medInfoList');
      if (!el) return;
      if (list.length === 0) {
        el.innerHTML = '<p style="text-align:center; color:#adb5bd; font-style:italic; font-size:0.9em; margin:8px 0 0;">' + _esc(_skt('sk.meds.emptyList')) + '</p>';
      } else {
        el.innerHTML = list.map((m, i) => `
          <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; background:#f8f9fa; border-radius:10px; margin-bottom:8px;">
            <div>
              <div style="font-weight:600; color:#2d2d2d; font-size:0.95em;">${escMed(m.name)}</div>
              ${m.dosage ? `<div style="font-size:0.82em; color:#6c757d;">${escMed(m.dosage)}</div>` : ''}
            </div>
            <div style="display:flex; gap:4px;">
              <button onclick="editMedication(${i})" style="background:none; border:none; cursor:pointer; color:#6c757d; font-size:1em; padding:4px 8px; line-height:1;">✏️</button>
              <button onclick="deleteMedication(${i})" style="background:none; border:none; cursor:pointer; color:#ff6b6b; font-size:1em; padding:4px 8px; line-height:1;">✕</button>
            </div>
          </div>`).join('');
      }
    }

    function editMedication(index) {
      const list = getMedList();
      const med = list[index];
      document.getElementById('medNameInput').value = med.name;
      document.getElementById('medDosageInput').value = med.dosage || '';
      const addBtn = document.querySelector('#medInfoModal .modal-btn-primary');
      if (!addBtn) return;
      const originalHTML = addBtn.innerHTML;
      const originalOnclick = addBtn.getAttribute('onclick');
      addBtn.innerHTML = _skt('sk.meds.saveChanges');
      addBtn.onclick = () => {
        const name = document.getElementById('medNameInput').value.trim();
        const dosage = document.getElementById('medDosageInput').value.trim();
        if (!name) return;
        list[index] = { ...med, name, dosage };
        saveMedList(list);
        renderMedList();
        document.getElementById('medNameInput').value = '';
        document.getElementById('medDosageInput').value = '';
        addBtn.innerHTML = originalHTML;
        addBtn.setAttribute('onclick', originalOnclick);
        addBtn.onclick = null;
        addBtn.setAttribute('onclick', 'addMedication()');
      };
    }
    window.editMedication = editMedication;

    async function openMedInfoModal() {
      // Fetch latest from Firestore so cross-page changes show immediately
      if (window.db && window.currentUser) {
        try {
          const doc = await window.db.collection('userSettings').doc(window.currentUser.uid).get();
          if (doc.exists) {
            const d = doc.data();
            if (d.currentMedList !== undefined) {
              localStorage.setItem('currentMedList', JSON.stringify(d.currentMedList));
              loadMedInfo();
              if (typeof updateMedicationAccordions === 'function') updateMedicationAccordions();
            }
          }
        } catch(e) {}
      }
      renderMedList();
      document.getElementById('medNameInput').value = '';
      document.getElementById('medDosageInput').value = '';
      _lockBodyScroll();
      document.getElementById('medInfoModal').classList.add('active');
    }
    window.openMedInfoModal = openMedInfoModal;

    function closeMedInfoModal() {
      document.getElementById('medInfoModal').classList.remove('active');
      _unlockBodyScroll();
    }
    window.closeMedInfoModal = closeMedInfoModal;

    function addMedication() {
      const name = document.getElementById('medNameInput').value.trim();
      if (!name) return;
      const dosage = document.getElementById('medDosageInput').value.trim();
      const list = getMedList();
      list.push({ name, dosage });
      saveMedList(list);
      renderMedList();
      document.getElementById('medNameInput').value = '';
      document.getElementById('medDosageInput').value = '';
    }
    window.addMedication = addMedication;

    /**
     * Quick-add chip handler. Fills the medication name input and moves
     * focus to the dosage field so the user can finish in one tap.
     * Wired to the .med-chip buttons in survival-kit.html.
     */
    function _fillMedName(name) {
      const nameInput = document.getElementById('medNameInput');
      if (!nameInput) return;
      nameInput.value = name;
      const dosageInput = document.getElementById('medDosageInput');
      if (dosageInput) dosageInput.focus();
    }
    window._fillMedName = _fillMedName;

    function deleteMedication(index) {
      const list = getMedList();
      list.splice(index, 1);
      saveMedList(list);
      renderMedList();
    }
    window.deleteMedication = deleteMedication;

    // ── GRATITUDE ──
    let _editingGratitudeIndex = null;

    function loadGratitude() {
      try { return JSON.parse(localStorage.getItem('survivalGratitude') || '[]'); } catch(e) { return []; }
    }

    function saveGratitudeList(list) {
      localStorage.setItem('survivalGratitude', JSON.stringify(list));
      localStorage.setItem('_sk_savedAt', String(Date.now()));
      if (window.db && window.currentUser) {
        window.db.collection('userSettings').doc(window.currentUser.uid)
          .set({ survivalGratitude: list }, { merge: true }).catch(e => console.warn('saveGratitude error:', e));
      }
    }

    function renderGratitude() {
      const list = loadGratitude();
      const el = document.getElementById('gratitudeList');
      if (!el) return;
      if (list.length === 0) {
        el.innerHTML = '<p style="color:var(--text-light,#6c757d);font-style:italic;font-size:0.9em;">' + _esc(_skt('sk.gratitude.empty')) + '</p>';
        return;
      }
      // `g` is user-typed gratitude text — escape before splicing into innerHTML.
      el.innerHTML = list.map((g, i) => `
        <div style="display:flex;align-items:center;gap:8px;padding:8px;background:#f8f9fa;border-radius:8px;margin-bottom:6px;">
          <span style="flex:1;font-weight:600;">🙏 ${_esc(g)}</span>
          <button onclick="editGratitudeItem(${i})" style="background:none;border:none;cursor:pointer;font-size:1em;padding:2px 6px;-webkit-tap-highlight-color:transparent;">✏️</button>
          <button onclick="deleteGratitudeItem(${i})" style="background:none;border:none;cursor:pointer;font-size:1em;padding:2px 6px;color:#ff6b6b;-webkit-tap-highlight-color:transparent;">✕</button>
        </div>`).join('');
    }

    function openAddGratitudeModal() {
      _editingGratitudeIndex = null;
      document.getElementById('gratitudeModalTitle').textContent = _skt('sk.gratitude.addTitle');
      document.getElementById('gratitudeSaveBtn').textContent = _skt('sk.gratitude.addSaveBtn');
      document.getElementById('gratitudeInput').value = '';
      document.getElementById('addGratitudeModal').style.display = 'flex';
      setTimeout(() => document.getElementById('gratitudeInput').focus(), 100);
    }

    function closeAddGratitudeModal() {
      document.getElementById('addGratitudeModal').style.display = 'none';
    }

    function saveGratitudeItem() {
      const text = document.getElementById('gratitudeInput').value.trim();
      if (!text) return;
      const list = loadGratitude();
      if (_editingGratitudeIndex !== null) {
        list[_editingGratitudeIndex] = text;
      } else {
        list.push(text);
      }
      saveGratitudeList(list);
      closeAddGratitudeModal();
      renderGratitude();
      _skUpdateTicks();
    }

    function editGratitudeItem(i) {
      const list = loadGratitude();
      _editingGratitudeIndex = i;
      document.getElementById('gratitudeModalTitle').textContent = _skt('sk.gratitude.editTitle');
      document.getElementById('gratitudeSaveBtn').textContent = _skt('sk.gratitude.editSaveBtn');
      document.getElementById('gratitudeInput').value = list[i];
      document.getElementById('addGratitudeModal').style.display = 'flex';
      setTimeout(() => document.getElementById('gratitudeInput').focus(), 100);
    }

    function deleteGratitudeItem(i) {
      if (!confirm(_skt('sk.gratitude.confirmRemove'))) return;
      const list = loadGratitude();
      list.splice(i, 1);
      saveGratitudeList(list);
      renderGratitude();
      _skUpdateTicks();
    }

    window.openAddGratitudeModal = openAddGratitudeModal;
    window.closeAddGratitudeModal = closeAddGratitudeModal;
    window.saveGratitudeItem = saveGratitudeItem;
    window.editGratitudeItem = editGratitudeItem;
    window.deleteGratitudeItem = deleteGratitudeItem;

    // ── GOALS ──
    function loadSurvivalGoals() {
      const goals = JSON.parse(localStorage.getItem('dailyGoals') || '[]');
      const el = document.getElementById('survivalGoalsList');
      if (!el) return;
      if (goals.length === 0) {
        el.innerHTML = '<p style="color:var(--text-light,#6c757d); font-style:italic; font-size:0.9em;">' + _esc(_skt('sk.goals.empty')) + '</p>';
        return;
      }
      // `g` is user-typed goal text — escape before splicing into innerHTML.
      el.innerHTML = goals.map((g, i) => `
        <div style="display:flex; align-items:center; gap:8px; padding:8px; background:#f8f9fa; border-radius:8px; margin-bottom:6px;">
          <span style="flex:1; font-weight:600;">🎯 ${_esc(g)}</span>
          <button onclick="editSurvivalGoal(${i})" style="background:none; border:none; cursor:pointer; font-size:1em; -webkit-tap-highlight-color:transparent;">✏️</button>
          <button onclick="deleteSurvivalGoal(${i})" style="background:none; border:none; cursor:pointer; font-size:1em; color:#ff6b6b; -webkit-tap-highlight-color:transparent;">✕</button>
        </div>
      `).join('');
    }

    function updateWallTrackerUI() {
      const goals = JSON.parse(localStorage.getItem('dailyGoals') || '[]');
      const link = document.getElementById('wallTrackerPdfLink');
      const btn = document.getElementById('wallTrackerPdfBtn');
      if (!link || !btn) return;
      if (goals.length > 0) {
        link.style.display = 'none';
        btn.style.display = '';
      } else {
        link.style.display = '';
        btn.style.display = 'none';
      }
    }

    async function generateWallTrackerPDF() {
      const goals = JSON.parse(localStorage.getItem('dailyGoals') || '[]');
      if (!goals.length) return;

      const MOTIVATIONAL_QUOTES = [
        "A goal without a plan is just a wish. — Antoine de Saint-Exupéry",
        "The secret of getting ahead is getting started. — Mark Twain",
        "It always seems impossible until it's done. — Nelson Mandela",
        "Believe you can and you're halfway there. — Theodore Roosevelt",
        "Success is the sum of small efforts, repeated day in and day out. — Robert Collier",
        "You don't have to be great to start, but you have to start to be great. — Zig Ziglar",
        "Dream big. Start small. Act now. — Robin Sharma",
        "Progress, not perfection. — Unknown",
        "Every day is a chance to be better than yesterday.",
        "The future belongs to those who believe in the beauty of their dreams. — Eleanor Roosevelt"
      ];
      const quote = MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)];

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageW = 297, pageH = 210;
      const margin = 14;

      // Orange header bar
      doc.setFillColor(255, 149, 0);
      doc.rect(0, 0, pageW, 28, 'F');

      // Logo text (no image available in PDF context)
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.text(_skt('sk.goals.pdfHeader'), pageW / 2, 18, { align: 'center' });

      // Goals header row
      const tableTop = 34;
      const colCount = goals.length;
      const tableWidth = pageW - margin * 2;
      const colW = tableWidth / colCount;
      const labelColW = 32;
      const dataColW = (tableWidth - labelColW) / colCount;

      // Header: goals
      doc.setFillColor(255, 240, 210);
      doc.rect(margin + labelColW, tableTop, tableWidth - labelColW, 10, 'F');
      doc.setTextColor(50, 50, 50);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      goals.forEach((g, i) => {
        const x = margin + labelColW + i * dataColW + dataColW / 2;
        doc.text(g.length > 22 ? g.substring(0, 20) + '…' : g, x, tableTop + 6.5, { align: 'center' });
      });

      // Month rows (12 months from current)
      const now = new Date();
      const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const rowH = 13;
      for (let r = 0; r < 12; r++) {
        const rowY = tableTop + 10 + r * rowH;
        const monthIdx = (now.getMonth() + r) % 12;
        const year = now.getFullYear() + Math.floor((now.getMonth() + r) / 12);
        const monthLabel = monthNames[monthIdx] + ' ' + year;

        // Alternating row background
        if (r % 2 === 0) {
          doc.setFillColor(252, 252, 252);
          doc.rect(margin, rowY, tableWidth, rowH, 'F');
        }

        // Month label
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(80, 80, 80);
        doc.text(monthLabel, margin + 2, rowY + 8);

        // Goal columns (empty checkboxes)
        goals.forEach((_, i) => {
          const cx = margin + labelColW + i * dataColW + dataColW / 2;
          doc.setDrawColor(200, 200, 200);
          doc.setLineWidth(0.3);
          doc.rect(cx - 4, rowY + 3, 8, 7);
        });

        // Row border
        doc.setDrawColor(220, 220, 220);
        doc.setLineWidth(0.2);
        doc.line(margin, rowY + rowH, margin + tableWidth, rowY + rowH);
      }

      // Outer table border
      doc.setDrawColor(180, 180, 180);
      doc.setLineWidth(0.4);
      doc.rect(margin, tableTop, tableWidth, 10 + 12 * rowH);

      // Vertical divider after label column
      doc.line(margin + labelColW, tableTop, margin + labelColW, tableTop + 10 + 12 * rowH);

      // Column dividers
      for (let i = 1; i < goals.length; i++) {
        const lx = margin + labelColW + i * dataColW;
        doc.line(lx, tableTop, lx, tableTop + 10 + 12 * rowH);
      }

      // Motivational quote at bottom
      const quoteY = tableTop + 10 + 12 * rowH + 10;
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(150, 100, 30);
      doc.text('"' + quote + '"', pageW / 2, quoteY, { align: 'center', maxWidth: tableWidth });

      const _scrollY = window.scrollY;
      const filename = 'bipolar-bear-wall-tracker.pdf';
      const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();

      if (isNative) {
        try {
          const Filesystem = window.Capacitor.Plugins.Filesystem;
          const Share = window.Capacitor.Plugins.Share;
          if (Filesystem) {
            const pdfData = doc.output('datauristring').split(',')[1];
            const result = await Filesystem.writeFile({ path: filename, data: pdfData, directory: 'DOCUMENTS' });
            if (Share) {
              await Share.share({ title: _skt('sk.goals.pdfShareTitle'), url: result.uri, dialogTitle: _skt('sk.goals.pdfShareDialog') });
            } else {
              alert(_skt('sk.goals.pdfSaved', { filename: filename }));
            }
          } else {
            alert(_skt('sk.goals.pdfNoFilesystem'));
          }
        } catch (e) {
          console.error('Native PDF error:', e);
          alert(_skt('sk.goals.pdfError', { error: e.message }));
        }
      } else {
        doc.save(filename);
        requestAnimationFrame(() => window.scrollTo({ top: _scrollY, behavior: 'instant' }));
      }
    }
    window.generateWallTrackerPDF = generateWallTrackerPDF;

    function openAddGoalModal() {
      const input = document.getElementById('survivalNewGoal');
      if (input) input.value = '';
      const modal = document.getElementById('addGoalModal');
      if (modal) { _lockBodyScroll(); modal.style.display = 'flex'; setTimeout(() => input && input.focus(), 50); }
    }

    function closeAddGoalModal() {
      const modal = document.getElementById('addGoalModal');
      if (modal) modal.style.display = 'none';
      _unlockBodyScroll();
    }

    window.openAddGoalModal = openAddGoalModal;
    window.closeAddGoalModal = closeAddGoalModal;

    function addSurvivalGoal() {
      const input = document.getElementById('survivalNewGoal');
      const text = input.value.trim();
      if (!text) return;
      const goals = JSON.parse(localStorage.getItem('dailyGoals') || '[]');
      goals.push(text);
      localStorage.setItem('dailyGoals', JSON.stringify(goals));
      syncGoalsToFirestore(goals);
      input.value = '';
      closeAddGoalModal();
      loadSurvivalGoals();
      updateWallTrackerUI();
      checkSurvivalKitAchievement('first_goal');
      _skUpdateTicks();
    }

    function deleteSurvivalGoal(index) {
      if (!confirm(_skt('sk.goals.confirmRemove'))) return;
      const goals = JSON.parse(localStorage.getItem('dailyGoals') || '[]');
      goals.splice(index, 1);
      localStorage.setItem('dailyGoals', JSON.stringify(goals));
      syncGoalsToFirestore(goals);
      loadSurvivalGoals();
      updateWallTrackerUI();
      _skUpdateTicks();
    }

    function editSurvivalGoal(index) {
      const goals = JSON.parse(localStorage.getItem('dailyGoals') || '[]');
      const newText = prompt(_skt('sk.goals.editPrompt'), goals[index]);
      if (newText === null || newText.trim() === '') return;
      goals[index] = newText.trim();
      localStorage.setItem('dailyGoals', JSON.stringify(goals));
      syncGoalsToFirestore(goals);
      loadSurvivalGoals();
      _skUpdateTicks();
    }

    // ── BUDGET ──
    function loadSurvivalBudget() {
      const val = localStorage.getItem('dailyBudget') || '';
      const el = document.getElementById('survivalBudgetDisplay');
      const input = document.getElementById('survivalBudgetInput');
      if (el) el.innerHTML = val
        ? _skt('sk.goals.budgetCurrent', { value: _esc(val) })
        : `<em style="color:#adb5bd;">${_esc(_skt('sk.goals.budgetNone'))}</em>`;
      if (input) input.value = val;
    }

    function saveSurvivalBudget() {
      const input = document.getElementById('survivalBudgetInput');
      const val = (input ? input.value : '').trim();
      if (val) localStorage.setItem('dailyBudget', val);
      else localStorage.removeItem('dailyBudget');
      syncBudgetToFirestore(val);
      loadSurvivalBudget();
    }

    // Track visits and show hint on 2nd+ visit
    (function() {
      const _vc = parseInt(BB.storage.get('SkVisitCount') || '0', 10) + 1;
      BB.storage.set('SkVisitCount', String(_vc));
      if (_vc >= 2 && !BB.storage.get('SkHelperHintDone')) {
        const _hint = document.getElementById('skHelperHint');
        if (_hint) _hint.style.display = 'flex';
      }
    })();

    // Load goals and med info on page load
    document.addEventListener('DOMContentLoaded', () => {
      loadSurvivalGoals();
      updateWallTrackerUI();
      loadSurvivalBudget();
      loadMedInfo();
      renderGratitude();
      // No auto-selection — content stays hidden until user taps a mood
      renderEmergencyContact();
    });

    // ── CUSTOM REMINDERS ──
    function loadCustomReminders() {
      try { return JSON.parse(localStorage.getItem('customReminders') || '[]'); } catch(e) { return []; }
    }

    function saveCustomReminders(list) {
      localStorage.setItem('customReminders', JSON.stringify(list));
      localStorage.setItem('_sk_savedAt', String(Date.now()));
      if (window.db && window.currentUser) {
        window.db.collection('userSettings').doc(window.currentUser.uid)
          .set({ customReminders: list }, { merge: true }).catch(e => console.warn('saveCustomReminders error:', e));
      }
    }

    function renderCustomReminders() {
      const container = document.getElementById('customRemindersContainer');
      if (!container) return;
      const list = loadCustomReminders();
      if (list.length === 0) { container.innerHTML = ''; return; }
      // `r.title` and `r.message` are user-typed reminder content — escape both.
      container.innerHTML = list.map((r, i) => `
        <div class="accordion">
          <div style="display:flex;align-items:center;">
            <button class="accordion-header" onclick="toggleAccordion(this.closest('.accordion'))" style="flex:1;min-width:0;padding-right:8px;text-align:left;">
              ${_esc(r.title)} <span class="chevron">▼</span>
            </button>
            <div style="display:flex;gap:2px;flex-shrink:0;padding-right:4px;">
              <button onclick="editReminder(${i})" style="background:none;border:none;cursor:pointer;font-size:1.05em;color:var(--brand-primary);padding:6px 4px;line-height:1;-webkit-tap-highlight-color:transparent;" title="${_esc(_skt('sk.moodDef.edit'))}">✏️</button>
              <button onclick="deleteReminder(${i})" style="background:none;border:none;cursor:pointer;font-size:1.1em;color:#ff6b6b;padding:6px 4px;line-height:1;-webkit-tap-highlight-color:transparent;">✕</button>
            </div>
          </div>
          <div class="accordion-body">
            <p style="white-space:pre-wrap;">${_esc(r.message)}</p>
          </div>
        </div>
      `).join('');
    }

    function editReminder(index) {
      const list = loadCustomReminders();
      const r = list[index];
      if (!r) return;
      document.getElementById('reminderTitleInput').value = r.title;
      document.getElementById('reminderMessageInput').value = r.message;
      // Switch save button to update mode
      const saveBtn = document.querySelector('#addReminderModal button[onclick="saveReminder()"]');
      if (saveBtn) {
        saveBtn.textContent = _skt('sk.faq.saveChanges');
        saveBtn.onclick = function() {
          const title = document.getElementById('reminderTitleInput').value.trim();
          const message = document.getElementById('reminderMessageInput').value.trim();
          if (!title || !message) return;
          list[index] = { title, message };
          saveCustomReminders(list);
          closeAddReminderModal();
          renderCustomReminders();
          // Reset button
          saveBtn.textContent = _skt('sk.faq.save');
          saveBtn.onclick = saveReminder;
        };
      }
      _lockBodyScroll();
      document.getElementById('addReminderModal').style.display = 'flex';
      setTimeout(() => document.getElementById('reminderTitleInput').focus(), 100);
    }
    window.editReminder = editReminder;

    function openAddReminderModal() {
      document.getElementById('reminderTitleInput').value = '';
      document.getElementById('reminderMessageInput').value = '';
      _lockBodyScroll();
      document.getElementById('addReminderModal').style.display = 'flex';
      setTimeout(() => document.getElementById('reminderTitleInput').focus(), 100);
    }

    function closeAddReminderModal() {
      document.getElementById('addReminderModal').style.display = 'none';
      _unlockBodyScroll();
    }

    function saveReminder() {
      const title = document.getElementById('reminderTitleInput').value.trim();
      const message = document.getElementById('reminderMessageInput').value.trim();
      if (!title || !message) return;
      const list = loadCustomReminders();
      list.push({ title, message });
      saveCustomReminders(list);
      closeAddReminderModal();
      renderCustomReminders();
      _skUpdateTicks();
    }

    function deleteReminder(index) {
      if (!confirm(_skt('sk.faq.confirmRemove'))) return;
      const list = loadCustomReminders();
      list.splice(index, 1);
      saveCustomReminders(list);
      renderCustomReminders();
    }

    window.openAddReminderModal = openAddReminderModal;
    window.closeAddReminderModal = closeAddReminderModal;
    window.saveReminder = saveReminder;
    window.deleteReminder = deleteReminder;

    renderCustomReminders();

    // ── MEMORIES ──
    let _memoryMood = null;
    const MEMORY_MOOD_LABELS = {
      manic: '🚀 Manic', elevated: '😄 Elevated', good: '😊 Good',
      low: '😔 Low', depressed: '😞 Depressed',
    };

    function loadMemories() {
      try { return JSON.parse(localStorage.getItem('moodMemories') || '{}'); } catch(e) { return {}; }
    }

    function saveMemories(data) {
      localStorage.setItem('moodMemories', JSON.stringify(data));
      if (window.db && window.currentUser) {
        window.db.collection('userSettings').doc(window.currentUser.uid)
          .set({ moodMemories: data }, { merge: true }).catch(() => {});
      }
      _skUpdateTicks();
    }

    // ── MEMORIES CYCLING ──
    let _memoryCycleInterval = null;
    let _memoryCycleIndex = 0;
    let _memoryCycleMaxHeight = 0;
    const _cycleMemoryMoods = ['manic', 'elevated', 'good', 'low', 'depressed'];

    function _startMemoryCycle() {
      selectMemoryMood(_cycleMemoryMoods[0], true);
      _memoryCycleInterval = setInterval(() => {
        _memoryCycleIndex = (_memoryCycleIndex + 1) % _cycleMemoryMoods.length;
        selectMemoryMood(_cycleMemoryMoods[_memoryCycleIndex], true);
        // Track tallest height to pin min-height
        requestAnimationFrame(() => {
          const box = document.getElementById('memoriesBox');
          if (!box) return;
          const h = box.scrollHeight;
          if (h > _memoryCycleMaxHeight) {
            _memoryCycleMaxHeight = h;
            box.style.minHeight = _memoryCycleMaxHeight + 'px';
          }
        });
      }, 3000);
    }

    function selectMemoryMood(mood, fromCycle) {
      // Stop cycling when user deliberately picks a mood
      if (!fromCycle && _memoryCycleInterval) {
        clearInterval(_memoryCycleInterval);
        _memoryCycleInterval = null;
        const box = document.getElementById('memoriesBox');
        if (box) box.style.minHeight = '';
        const tip = document.getElementById('memoriesTip');
        if (tip) tip.style.display = 'none';
      }
      _memoryMood = mood;
      const cssClass = mood === 'elevated' ? 'hypomanic' : mood === 'good' ? 'stable' : mood;
      document.querySelectorAll('#memories .mood-icon-btn').forEach(b => b.classList.remove('active-mood'));
      const btn = document.querySelector(`#memories .mood-icon-btn.${cssClass}`);
      if (btn) btn.classList.add('active-mood');
      if (!fromCycle) {
        document.getElementById('memoriesBox').style.display = '';
        document.getElementById('memoriesMoodLabel').textContent = _sktMood(mood) || mood;
        renderMemoryList();
      }
    }

    let _editingMemoryIndex = null;

    function renderMemoryList() {
      if (!_memoryMood) return;
      const data = loadMemories();
      const list = data[_memoryMood] || [];
      const el = document.getElementById('memoriesList');
      if (!el) return;
      if (list.length === 0) {
        el.innerHTML = '<p style="color:#6c757d;font-style:italic;font-size:0.9em;">' + _esc(_skt('sk.memories.empty')) + '</p>';
        return;
      }
      // `text` is user-typed memory content; `date` is also user-set.
      // Escape both before splicing into innerHTML.
      el.innerHTML = list.map((s, i) => {
        const text = typeof s === 'object' ? s.text : s;
        const date = typeof s === 'object' && s.date ? s.date : null;
        return `
          <div style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;background:#f8f9fa;border-radius:8px;margin-bottom:6px;">
            <div style="flex:1;min-width:0;">
              ${date ? `<div style="font-size:0.75em;color:#adb5bd;margin-bottom:2px;">${_esc(date)}</div>` : ''}
              <span style="font-size:0.92em;line-height:1.45;">${_esc(text)}</span>
            </div>
            <button onclick="editMemory(${i})" style="background:none;border:none;cursor:pointer;font-size:1em;color:#adb5bd;flex-shrink:0;padding:0 4px;line-height:1;-webkit-tap-highlight-color:transparent;" title="${_esc(_skt('sk.moodDef.edit'))}">✏️</button>
            <button onclick="deleteMemory(${i})" style="background:none;border:none;cursor:pointer;font-size:1.1em;color:#ff6b6b;flex-shrink:0;padding:0 2px;line-height:1;-webkit-tap-highlight-color:transparent;">✕</button>
          </div>`;
      }).join('');
    }

    function openAddMemoryModal() {
      if (!_memoryMood) return;
      _editingMemoryIndex = null;
      document.getElementById('addMemoryModalTitle').textContent = _skt('sk.memories.recordTitle', { mood: _sktMood(_memoryMood) });
      document.getElementById('memoryInput').value = '';
      document.getElementById('memoryDateInput').value = '';
      _lockBodyScroll();
      document.getElementById('addMemoryModal').style.display = 'flex';
      setTimeout(() => document.getElementById('memoryInput').focus(), 100);
    }

    function editMemory(index) {
      if (!_memoryMood) return;
      const data = loadMemories();
      const list = data[_memoryMood] || [];
      const entry = list[index];
      if (!entry) return;
      _editingMemoryIndex = index;
      document.getElementById('addMemoryModalTitle').textContent = _skt('sk.memories.editTitle', { mood: _sktMood(_memoryMood) });
      document.getElementById('memoryInput').value = typeof entry === 'object' ? entry.text : entry;
      document.getElementById('memoryDateInput').value = typeof entry === 'object' && entry.date ? entry.date : '';
      _lockBodyScroll();
      document.getElementById('addMemoryModal').style.display = 'flex';
      setTimeout(() => document.getElementById('memoryInput').focus(), 100);
    }

    function closeAddMemoryModal() {
      document.getElementById('addMemoryModal').style.display = 'none';
      _editingMemoryIndex = null;
      _unlockBodyScroll();
    }

    function addMemory() {
      const text = document.getElementById('memoryInput').value.trim();
      const date = document.getElementById('memoryDateInput').value.trim();
      if (!text || !_memoryMood) return;
      const data = loadMemories();
      if (!data[_memoryMood]) data[_memoryMood] = [];
      const newEntry = date ? { text, date } : text;
      if (_editingMemoryIndex !== null) {
        data[_memoryMood][_editingMemoryIndex] = newEntry;
      } else {
        data[_memoryMood].push(newEntry);
        checkSurvivalKitAchievement('first_memory');
      }
      saveMemories(data);
      closeAddMemoryModal();
      renderMemoryList();
    }

    function deleteMemory(index) {
      if (!_memoryMood) return;
      if (!confirm(_skt('sk.memories.confirmRemove'))) return;
      const data = loadMemories();
      if (data[_memoryMood]) { data[_memoryMood].splice(index, 1); }
      saveMemories(data);
      renderMemoryList();
    }

    window.selectMemoryMood = selectMemoryMood;
    window.openAddMemoryModal = openAddMemoryModal;
    window.editMemory = editMemory;
    window.closeAddMemoryModal = closeAddMemoryModal;
    window.addMemory = addMemory;
    window.deleteMemory = deleteMemory;

    // ── COPING STRATEGIES ──
    let _copingMood = null;
    const COPING_MOOD_LABELS = {
      manic: '🚀 Manic', elevated: '😄 Elevated', good: '😊 Good',
      low: '😔 Low', depressed: '😞 Depressed',
    };

    function loadCopingStrategies() {
      try { return JSON.parse(localStorage.getItem('copingStrategies') || '{}'); } catch(e) { return {}; }
    }

    function saveCopingStrategies(data) {
      localStorage.setItem('copingStrategies', JSON.stringify(data));
      localStorage.setItem('_sk_savedAt', String(Date.now()));
      if (window.db && window.currentUser) {
        window.db.collection('userSettings').doc(window.currentUser.uid)
          .set({ copingStrategies: data }, { merge: true }).catch(e => console.warn('saveCopingStrategies error:', e));
      }
      _skUpdateTicks();
    }

    function selectCopingMood(mood) {
      _copingMood = mood;
      // Map storage key → CSS class on the button
      const cssClass = mood === 'elevated' ? 'hypomanic' : mood === 'good' ? 'stable' : mood;
      document.querySelectorAll('#coping-strategies .mood-icon-btn').forEach(b => b.classList.remove('active-mood'));
      const btn = document.querySelector(`#coping-strategies .mood-icon-btn.${cssClass}`);
      if (btn) btn.classList.add('active-mood');
      document.getElementById('copingStrategiesBox').style.display = '';
      document.getElementById('copingMoodLabel').textContent = _sktMood(mood) || mood;
      renderCopingList();
    }

    function renderCopingList() {
      if (!_copingMood) return;
      const data = loadCopingStrategies();
      const list = data[_copingMood] || [];
      const el = document.getElementById('copingStrategiesList');
      if (!el) return;
      if (list.length === 0) {
        el.innerHTML = '<p style="color:#6c757d;font-style:italic;font-size:0.9em;">' + _esc(_skt('sk.strategies.empty')) + '</p>';
        return;
      }
      // `s` is user-typed coping strategy — escape before splicing into innerHTML.
      el.innerHTML = list.map((s, i) => `
        <div style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;background:#f8f9fa;border-radius:8px;margin-bottom:6px;">
          <span style="flex:1;font-size:0.92em;line-height:1.45;">${_esc(s)}</span>
          <button onclick="openEditCopingModal(${i})" style="background:none;border:none;cursor:pointer;font-size:1em;color:var(--brand-primary);flex-shrink:0;padding:0 2px;line-height:1;-webkit-tap-highlight-color:transparent;">✏️</button>
          <button onclick="deleteCopingStrategy(${i})" style="background:none;border:none;cursor:pointer;font-size:1.1em;color:#ff6b6b;flex-shrink:0;padding:0 2px;line-height:1;-webkit-tap-highlight-color:transparent;">✕</button>
        </div>
      `).join('');
    }

    let _editingCopingIndex = null;

    function openAddCopingModal() {
      if (!_copingMood) return;
      _editingCopingIndex = null;
      document.getElementById('addCopingModalTitle').textContent = _skt('sk.strategies.addTitle', { mood: _sktMood(_copingMood) });
      document.getElementById('copingStrategyInput').value = '';
      _lockBodyScroll();
      document.getElementById('addCopingModal').style.display = 'flex';
      setTimeout(() => document.getElementById('copingStrategyInput').focus(), 100);
    }

    function openEditCopingModal(index) {
      if (!_copingMood) return;
      _editingCopingIndex = index;
      const data = loadCopingStrategies();
      document.getElementById('addCopingModalTitle').textContent = _skt('sk.strategies.editTitle', { mood: _sktMood(_copingMood) });
      document.getElementById('copingStrategyInput').value = (data[_copingMood] || [])[index] || '';
      _lockBodyScroll();
      document.getElementById('addCopingModal').style.display = 'flex';
      setTimeout(() => document.getElementById('copingStrategyInput').focus(), 100);
    }

    function closeAddCopingModal() {
      document.getElementById('addCopingModal').style.display = 'none';
      _editingCopingIndex = null;
      _unlockBodyScroll();
    }

    function addCopingStrategy() {
      const text = document.getElementById('copingStrategyInput').value.trim();
      if (!text || !_copingMood) return;
      const data = loadCopingStrategies();
      if (!data[_copingMood]) data[_copingMood] = [];
      if (_editingCopingIndex !== null) {
        data[_copingMood][_editingCopingIndex] = text;
      } else {
        data[_copingMood].push(text);
      }
      _editingCopingIndex = null;
      saveCopingStrategies(data);
      closeAddCopingModal();
      renderCopingList();
      checkSurvivalKitAchievement('first_coping');
    }

    function deleteCopingStrategy(index) {
      if (!_copingMood) return;
      if (!confirm(_skt('sk.strategies.confirmRemove'))) return;
      const data = loadCopingStrategies();
      if (data[_copingMood]) { data[_copingMood].splice(index, 1); }
      saveCopingStrategies(data);
      renderCopingList();
    }

    window.selectCopingMood = selectCopingMood;
    window.openAddCopingModal = openAddCopingModal;
    window.openEditCopingModal = openEditCopingModal;
    window.closeAddCopingModal = closeAddCopingModal;
    window.addCopingStrategy = addCopingStrategy;
    window.deleteCopingStrategy = deleteCopingStrategy;

    // ── MOOD DEFINITIONS ──
    const MOOD_DEF_LABELS = {
      manic: '🚀 Manic', hypomanic: '😄 Elevated', stable: '😊 Good', low: '😔 Low', depressed: '🌧️ Depressed'
    };
    let _moodDefEditing = null; // which mood is currently being edited

    function loadMoodDefinitions() {
      try { return JSON.parse(localStorage.getItem('moodDefinitions') || '{}'); } catch(e) { return {}; }
    }

    function saveMoodDefinitions(data) {
      localStorage.setItem('moodDefinitions', JSON.stringify(data));
      localStorage.setItem('_sk_savedAt', String(Date.now()));
      if (window.db && window.currentUser) {
        window.db.collection('userSettings').doc(window.currentUser.uid)
          .set({ moodDefinitions: data }, { merge: true })
          .catch(e => console.warn('saveMoodDefinitions Firestore error:', e));
      }
    }

    function renderMoodDefinition(mood) {
      const el = document.getElementById('moodDefArea-' + mood);
      const defWrap = document.getElementById('bipolarDef-' + mood);
      if (!el) return;
      const data = loadMoodDefinitions();
      const text = data[mood] || '';
      if (text) {
        // Show custom definition prominently
        el.innerHTML = `
          <div style="background:rgba(255,149,0,0.08);border:1.5px solid rgba(255,149,0,0.3);border-radius:10px;padding:12px 14px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
              <span style="font-size:0.75em;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--brand-primary);">${_esc(_skt('sk.moodDef.myDefinition'))}</span>
              <div style="display:flex;gap:8px;">
                <button onclick="openMoodDefModal('${mood}')" style="background:none;border:none;cursor:pointer;font-size:0.8em;color:var(--brand-primary);font-weight:600;padding:0;-webkit-tap-highlight-color:transparent;">${_esc(_skt('sk.moodDef.edit'))}</button>
                <button onclick="deleteMoodDefinition('${mood}')" style="background:none;border:none;cursor:pointer;font-size:0.8em;color:#ff6b6b;font-weight:600;padding:0;-webkit-tap-highlight-color:transparent;">${_esc(_skt('sk.moodDef.remove'))}</button>
              </div>
            </div>
            <div style="font-size:0.9em;color:#495057;line-height:1.5;font-style:italic;">"${text}"</div>
          </div>
          <button onclick="_toggleBipolarDef('${mood}',this)" style="background:none;border:none;cursor:pointer;font-size:0.8em;color:#adb5bd;font-weight:600;padding:4px 0;margin-top:4px;-webkit-tap-highlight-color:transparent;" id="bipolarDefToggle-${mood}">${_esc(_skt('sk.moodDef.bipolarUkClosed'))}</button>`;
        // Collapse the bipolar def
        if (defWrap) { defWrap.style.display = 'none'; }
      } else {
        el.innerHTML = `
          <button onclick="openMoodDefModal('${mood}')" style="width:100%;padding:10px;background:none;border:2px dashed var(--brand-primary);border-radius:10px;color:var(--brand-primary);font-weight:600;font-size:0.9em;cursor:pointer;margin-top:4px;-webkit-tap-highlight-color:transparent;">${_esc(_skt('sk.moodDef.addBtn'))}</button>`;
        // Show bipolar def expanded when no custom def
        if (defWrap) { defWrap.style.display = ''; }
      }
    }

    function _toggleBipolarDef(mood, btn) {
      const defWrap = document.getElementById('bipolarDef-' + mood);
      if (!defWrap) return;
      const isHidden = defWrap.style.display === 'none';
      defWrap.style.display = isHidden ? '' : 'none';
      btn.textContent = isHidden ? _skt('sk.moodDef.bipolarUkOpen') : _skt('sk.moodDef.bipolarUkClosed');
    }
    window._toggleBipolarDef = _toggleBipolarDef;

    function renderAllMoodDefinitions() {
      ['manic','hypomanic','stable','low','depressed'].forEach(renderMoodDefinition);
    }

    function openMoodDefModal(mood) {
      _moodDefEditing = mood;
      const data = loadMoodDefinitions();
      document.getElementById('moodDefModalTitle').textContent = _skt('sk.moodDef.modalTitleMood', { mood: _sktMood(mood) });
      document.getElementById('moodDefInput').value = data[mood] || '';
      _lockBodyScroll();
      document.getElementById('moodDefModal').style.display = 'flex';
      setTimeout(() => document.getElementById('moodDefInput').focus(), 100);
    }

    function closeMoodDefModal() {
      document.getElementById('moodDefModal').style.display = 'none';
      _unlockBodyScroll();
      _moodDefEditing = null;
    }

    function saveMoodDefinition() {
      const text = document.getElementById('moodDefInput').value.trim();
      if (!text || !_moodDefEditing) { closeMoodDefModal(); return; }
      const data = loadMoodDefinitions();
      data[_moodDefEditing] = text;
      saveMoodDefinitions(data);
      renderMoodDefinition(_moodDefEditing);
      closeMoodDefModal();
      checkSurvivalKitAchievement('first_definition');
    }

    function deleteMoodDefinition(mood) {
      if (!confirm(_skt('sk.moodDef.confirmRemove'))) return;
      const data = loadMoodDefinitions();
      delete data[mood];
      saveMoodDefinitions(data);
      renderMoodDefinition(mood);
    }

    // ── Survival Kit achievement check ──
    const _KIT_ACHIEVEMENTS = [
      { id: 'first_definition', emoji: '📖', titleKey: 'sk.ach.firstDefinition', check: () => { const d = JSON.parse(localStorage.getItem('moodDefinitions') || '{}'); return Object.values(d).some(v => v && String(v).trim()); } },
      { id: 'first_coping',     emoji: '🛡️', titleKey: 'sk.ach.firstCoping', check: () => { const s = JSON.parse(localStorage.getItem('copingStrategies') || '{}'); return Object.values(s).some(a => Array.isArray(a) && a.length > 0); } },
      { id: 'first_medication', emoji: '💊', titleKey: 'sk.ach.firstMedication', check: () => { const m = JSON.parse(localStorage.getItem('currentMedList') || '[]'); return Array.isArray(m) && m.length > 0; } },
      { id: 'first_goal',       emoji: '🎯', titleKey: 'sk.ach.firstGoal', check: () => { const g = JSON.parse(localStorage.getItem('dailyGoals') || '[]'); return Array.isArray(g) && g.length > 0; } },
      { id: 'first_memory',     emoji: '💭', titleKey: 'sk.ach.firstMemory', check: () => { const m = JSON.parse(localStorage.getItem('moodMemories') || '{}'); return Object.values(m).some(a => Array.isArray(a) && a.length > 0); } },
      { id: 'first_commitment', emoji: '🤝', titleKey: 'sk.ach.firstCommitment', check: () => { const c = JSON.parse(localStorage.getItem('myCommitments') || '[]'); return Array.isArray(c) && c.length > 0; } },
      { id: 'survival_kit',     emoji: '🧰', titleKey: 'sk.ach.survivalKit', check: () => {
        const d = JSON.parse(localStorage.getItem('moodDefinitions') || '{}');
        const s = JSON.parse(localStorage.getItem('copingStrategies') || '{}');
        const m = JSON.parse(localStorage.getItem('currentMedList') || '[]');
        const g = JSON.parse(localStorage.getItem('dailyGoals') || '[]');
        return Object.values(d).some(v => v && String(v).trim()) &&
               Object.values(s).some(a => Array.isArray(a) && a.length > 0) &&
               Array.isArray(m) && m.length > 0 && Array.isArray(g) && g.length > 0;
      }},
    ];

    function _showAchievementToast(emoji, title) {
      const toastsEnabled = localStorage.getItem('achievementToastsEnabled') !== 'false';
      if (!toastsEnabled) return;
      const existing = document.getElementById('achievementToast');
      if (existing) existing.remove();
      const toast = document.createElement('div');
      toast.id = 'achievementToast';
      toast.innerHTML = `<div style="font-size:2em;margin-bottom:4px;">${emoji}</div><div style="font-weight:700;font-size:0.95em;margin-bottom:2px;">${_esc(_skt('sk.ach.unlocked'))}</div><div style="font-weight:600;font-size:0.88em;">${_esc(title)}</div><div style="font-size:0.75em;color:rgba(255,255,255,0.8);margin-top:4px;">${_esc(_skt('sk.ach.tapDismiss'))}</div>`;
      Object.assign(toast.style, {
        position:'fixed', bottom:'80px', left:'50%', transform:'translateX(-50%) translateY(20px)',
        background:'linear-gradient(135deg,var(--brand-primary-mid),var(--brand-primary-light))', color:'white',
        borderRadius:'16px', padding:'14px 20px', boxShadow:'0 8px 32px rgba(255,107,0,0.45)',
        zIndex:'9999', textAlign:'center', maxWidth:'280px', width:'90%',
        cursor:'pointer', transition:'transform 0.35s cubic-bezier(.34,1.56,.64,1), opacity 0.35s ease',
        opacity:'0', fontSize:'0.9em', lineHeight:'1.4',
      });
      document.body.appendChild(toast);
      requestAnimationFrame(() => { toast.style.transform = 'translateX(-50%) translateY(0)'; toast.style.opacity = '1'; });
      const dismiss = () => { toast.style.transform = 'translateX(-50%) translateY(20px)'; toast.style.opacity = '0'; setTimeout(() => toast.remove(), 350); };
      toast.addEventListener('click', dismiss);
      setTimeout(dismiss, 4000);
    }

    function checkSurvivalKitAchievement(triggerId) {
      try {
        const stored = JSON.parse(localStorage.getItem('unlockedAchievements') || '[]');
        const newlyUnlocked = [];
        for (const ach of _KIT_ACHIEVEMENTS) {
          if (!stored.includes(ach.id) && ach.check()) {
            stored.push(ach.id);
            newlyUnlocked.push(ach);
          }
        }
        localStorage.setItem('unlockedAchievements', JSON.stringify(stored));
        if (newlyUnlocked.length > 0) {
          // Prefer showing the achievement that matches what triggered this check
          const toastAch = newlyUnlocked.find(a => a.id === triggerId) || newlyUnlocked[0];
          _showAchievementToast(toastAch.emoji, _skt(toastAch.titleKey));
        }
      } catch(e) {}
    }

    window.openMoodDefModal = openMoodDefModal;
    window.closeMoodDefModal = closeMoodDefModal;
    window.saveMoodDefinition = saveMoodDefinition;
    window.deleteMoodDefinition = deleteMoodDefinition;

    // Render on load
    renderAllMoodDefinitions();

        // ── STEPS MODAL ──
    const stepsData = {
      steps1: {
        title: 'Steps 1–3 · I am powerless over my condition',
        items: [
          'I admitted I was powerless over my condition — <strong>my life had become unmanageable</strong>.',
          'I came to believe that <strong>a Power greater than myself could restore me to sanity</strong>.',
          'I made a decision to <strong>turn my will and my life over</strong> to the care of a higher power.'
        ]
      },
      steps2: {
        title: 'Steps 4–10 · Making amends for past actions',
        items: [
          'I made a searching and fearless <strong>moral inventory of myself</strong> and my actions.',
          'I <strong>admitted to my higher power, to myself</strong> and to another human being the exact nature of my wrongs.',
          'I\'m <strong>entirely ready to have my higher power remove</strong> all these defects of character.',
          'I <strong>humbly asked my higher power</strong> to remove my shortcomings.',
          'I made a <strong>list of all persons I had harmed</strong>, and became willing to make amends to them all.',
          'I made <strong>direct amends</strong> wherever possible, except when to do so would injure them or others.',
          'I continued to <strong>take personal inventory</strong> and when I was wrong I promptly admitted it.'
        ]
      },
      steps3: {
        title: 'Steps 11–12 · Carrying hope to others',
        items: [
          'I sought <strong>through prayer and meditation</strong> to improve my conscious contact with my higher power, praying only for knowledge of their will for me.',
          'I had a <strong>spiritual awakening as the result of these steps</strong> and tried to carry this message to others learning to live with bipolar.'
        ]
      }
    };

    // ── Step-by-step cycling card ──
    const ALL_STEPS = [
      { label: 'Step 1', text: 'I admitted I was powerless over my condition — <strong>my life had become unmanageable</strong>.' },
      { label: 'Step 2', text: 'I came to believe that <strong>a Power greater than myself could restore me to sanity</strong>.' },
      { label: 'Step 3', text: 'I made a decision to <strong>turn my will and my life over</strong> to the care of a higher power.' },
      { label: 'Step 4', text: 'I made a searching and fearless <strong>moral inventory of myself</strong> and my actions.' },
      { label: 'Step 5', text: 'I <strong>admitted to my higher power, to myself</strong> and to another human being the exact nature of my wrongs.' },
      { label: 'Step 6', text: 'I\'m <strong>entirely ready to have my higher power remove</strong> all these defects of character.' },
      { label: 'Step 7', text: 'I <strong>humbly asked my higher power</strong> to remove my shortcomings.' },
      { label: 'Step 8', text: 'I made a <strong>list of all persons I had harmed</strong>, and became willing to make amends to them all.' },
      { label: 'Step 9', text: 'I made <strong>direct amends</strong> wherever possible, except when to do so would injure them or others.' },
      { label: 'Step 10', text: 'I continued to <strong>take personal inventory</strong> and when I was wrong I promptly admitted it.' },
      { label: 'Step 11', text: 'I sought <strong>through prayer and meditation</strong> to improve my conscious contact with my higher power, praying only for knowledge of their will for me.' },
      { label: 'Step 12', text: 'I had a <strong>spiritual awakening as the result of these steps</strong> and tried to carry this message to others learning to live with bipolar.' },
    ];
    let _stepIndex = 0;

    function _renderStep() {
      const n = _stepIndex + 1;
      document.getElementById('stepCounter').textContent = _skt('sk.steps.counterDynamic', { n: n, total: ALL_STEPS.length });
      document.getElementById('stepLabel').textContent = _skt('sk.steps.labels.s' + n);
      document.getElementById('stepText').innerHTML = _skt('sk.steps.text.s' + n);
      document.getElementById('stepPrevBtn').style.opacity = _stepIndex === 0 ? '0.35' : '1';
      document.getElementById('stepNextBtn').textContent = _stepIndex === ALL_STEPS.length - 1 ? _skt('sk.steps.startOver') : _skt('sk.steps.next');
    }

    function nextStep() {
      _stepIndex = (_stepIndex + 1) % ALL_STEPS.length;
      _renderStep();
    }

    function prevStep() {
      if (_stepIndex === 0) return;
      _stepIndex--;
      _renderStep();
    }

    window.nextStep = nextStep;
    window.prevStep = prevStep;
    _renderStep();

    // ── YOUR COMMITMENTS ──
    let _commitmentIndex = 0;
    let _editingCommitment = false;

    function loadCommitments() {
      try { return JSON.parse(localStorage.getItem('myCommitments') || '[]'); } catch(e) { return []; }
    }

    function saveCommitmentsData(list) {
      localStorage.setItem('myCommitments', JSON.stringify(list));
      localStorage.setItem('_sk_savedAt', String(Date.now()));
      if (window.db && window.currentUser) {
        window.db.collection('userSettings').doc(window.currentUser.uid)
          .set({ myCommitments: list }, { merge: true }).catch(e => console.warn('saveCommitmentsData error:', e));
      }
      _skUpdateTicks();
    }

    function renderCommitments() {
      const list = loadCommitments();
      const empty = document.getElementById('commitmentEmpty');
      const viewer = document.getElementById('commitmentViewer');
      if (list.length === 0) {
        if (empty) empty.style.display = '';
        if (viewer) viewer.style.display = 'none';
        return;
      }
      if (_commitmentIndex >= list.length) _commitmentIndex = list.length - 1;
      if (empty) empty.style.display = 'none';
      if (viewer) viewer.style.display = '';
      document.getElementById('commitmentCounter').textContent = _skt('sk.steps.commitmentCounter', { n: _commitmentIndex + 1, total: list.length });
      document.getElementById('commitmentText').textContent = list[_commitmentIndex];
      document.getElementById('commitPrevBtn').style.opacity = _commitmentIndex === 0 ? '0.35' : '1';
      document.getElementById('commitNextBtn').textContent = _commitmentIndex === list.length - 1 ? _skt('sk.steps.startOver') : _skt('sk.steps.next');
    }

    function nextCommitment() {
      const list = loadCommitments();
      _commitmentIndex = (_commitmentIndex + 1) % list.length;
      renderCommitments();
    }

    function prevCommitment() {
      if (_commitmentIndex === 0) return;
      _commitmentIndex--;
      renderCommitments();
    }

    function openAddCommitmentModal() {
      _editingCommitment = false;
      document.getElementById('commitmentModalTitle').textContent = _skt('sk.steps.addCommitmentTitle');
      document.getElementById('commitmentInput').value = '';
      _lockBodyScroll();
      document.getElementById('commitmentModal').style.display = 'flex';
      setTimeout(() => document.getElementById('commitmentInput').focus(), 100);
    }

    function openEditCommitmentModal() {
      const list = loadCommitments();
      _editingCommitment = true;
      document.getElementById('commitmentModalTitle').textContent = _skt('sk.steps.editCommitmentTitle');
      document.getElementById('commitmentInput').value = list[_commitmentIndex] || '';
      _lockBodyScroll();
      document.getElementById('commitmentModal').style.display = 'flex';
      setTimeout(() => document.getElementById('commitmentInput').focus(), 100);
    }

    function closeCommitmentModal() {
      document.getElementById('commitmentModal').style.display = 'none';
      _unlockBodyScroll();
    }

    function saveCommitment() {
      const text = document.getElementById('commitmentInput').value.trim();
      if (!text) return;
      const list = loadCommitments();
      if (_editingCommitment) {
        list[_commitmentIndex] = text;
      } else {
        list.push(text);
        _commitmentIndex = list.length - 1;
      }
      saveCommitmentsData(list);
      closeCommitmentModal();
      renderCommitments();
      if (!_editingCommitment) checkSurvivalKitAchievement('first_commitment');
    }

    function deleteCommitment() {
      if (!confirm(_skt('sk.steps.confirmRemoveCommitment'))) return;
      const list = loadCommitments();
      list.splice(_commitmentIndex, 1);
      if (_commitmentIndex > 0) _commitmentIndex--;
      saveCommitmentsData(list);
      renderCommitments();
    }

    window.nextCommitment = nextCommitment;
    window.prevCommitment = prevCommitment;
    window.openAddCommitmentModal = openAddCommitmentModal;
    window.openEditCommitmentModal = openEditCommitmentModal;
    window.closeCommitmentModal = closeCommitmentModal;
    window.saveCommitment = saveCommitment;
    window.deleteCommitment = deleteCommitment;

    renderCommitments();

    function openStepsModal(key) {
      // key is 'steps1' | 'steps2' | 'steps3'. Titles and step ranges come
      // from the i18n catalogue so the modal follows the active language.
      const groups = {
        steps1: { titleKey: 'sk.steps.modal.group1Title', from: 1, to: 3 },
        steps2: { titleKey: 'sk.steps.modal.group2Title', from: 4, to: 10 },
        steps3: { titleKey: 'sk.steps.modal.group3Title', from: 11, to: 12 },
      };
      const g = groups[key];
      if (!g) return;
      document.getElementById('stepsModalTitle').textContent = _skt(g.titleKey);
      let items = '';
      for (let n = g.from; n <= g.to; n++) items += `<li>${_skt('sk.steps.text.s' + n)}</li>`;
      document.getElementById('stepsModalBody').innerHTML = '<ul>' + items + '</ul>';
      document.getElementById('stepsModal').classList.add('active');
    }

    function closeStepsModal() {
      document.getElementById('stepsModal').classList.remove('active');
    }

    function closeStepsModalOutside(e) {
      if (e.target === document.getElementById('stepsModal')) closeStepsModal();
    }

    window.openStepsModal = openStepsModal;
    window.closeStepsModal = closeStepsModal;
    window.closeStepsModalOutside = closeStepsModalOutside;

// ── BLOCK 2 ──
// Register service worker for offline functionality
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js')
        .then(registration => {
          console.log('✅ Service Worker registered successfully:', registration.scope);
        })
        .catch(err => {
          console.log('❌ Service Worker registration failed:', err);
        });
    }

// ── BLOCK 3 ──
    // ── Firebase init ──
    // Config lives in js/shared/firebase-config.js so every page reads the
    // same source of truth.
    const firebaseConfig = window.BB_FIREBASE_CONFIG;
    let auth;
    var db = null, currentUser = null; // var so window.db / window.currentUser work across script blocks
    try {
      firebase.initializeApp(firebaseConfig);
      auth = firebase.auth();
      db = firebase.firestore();
      db.enablePersistence({ synchronizeTabs: false }).catch(() => {});

      // Release IndexedDB lock on navigation so the next page acquires it instantly
      window.addEventListener('pagehide', () => { try { db.terminate(); } catch(e) {} });
      // If browser restores this page from bfcache, force a clean reload
      window.addEventListener('pageshow', e => { if (e.persisted) location.reload(); });

      // Ensure user has auth (anonymous if not signed in) for Firestore access
      async function ensureAuth() {
        if (!auth.currentUser) {
          try { await auth.signInAnonymously(); }
          catch(e) { console.error('Anonymous sign-in failed:', e); }
        }
      }

      // Single unified counter for all platforms, seeded at 1
      const counterDocId = () => 'helpedCount';
      const counterSeed  = () => 1;

      // Adjust counter using FieldValue.increment (atomic, no transaction needed)
      async function adjustCounter(delta) {
        const ref = db.collection('counters').doc(counterDocId());
        await ref.set(
          { count: firebase.firestore.FieldValue.increment(delta) },
          { merge: true }
        );
      }

      // Animate the count number rolling in from a direction
      function animateCount(newText, direction) {
        const el = document.getElementById('helpedCount');
        el.style.animation = 'none';
        void el.offsetWidth;
        el.textContent = newText;
        el.style.animation = direction === 'up'
          ? 'rollInUp 0.38s cubic-bezier(.25,.46,.45,.94) forwards'
          : 'rollInDown 0.38s cubic-bezier(.25,.46,.45,.94) forwards';
      }

      // Check voted state — Firestore for signed-in users, localStorage for guests
      async function getVotedState() {
        if (currentUser && db) {
          try {
            const doc = await db.collection('userSettings').doc(currentUser.uid).get();
            if (doc.exists && doc.data().helpedVoted) return true;
          } catch(e) {}
        }
        return !!localStorage.getItem('bipolarHelpedVoted');
      }

      // Persist voted state — Firestore for signed-in users + localStorage always
      async function setVotedState(voted) {
        if (voted) localStorage.setItem('bipolarHelpedVoted', '1');
        else localStorage.removeItem('bipolarHelpedVoted');
        if (currentUser && db) {
          try {
            await db.collection('userSettings').doc(currentUser.uid).set(
              { helpedVoted: voted }, { merge: true }
            );
          } catch(e) { console.error('Vote state sync failed:', e); }
        }
      }

      // Format count consistently regardless of device locale
      function fmtCount(n) { return Number(n).toLocaleString('en-US'); }

      // Load real people-helped count from Firestore and restore vote button state
      async function loadHelpedCount() {
        try {
          await ensureAuth();
          const seed = counterSeed();
          const doc = await db.collection('counters').doc(counterDocId()).get({ source: 'server' });
          if (!doc.exists) {
            await db.collection('counters').doc(counterDocId()).set({ count: seed });
            document.getElementById('helpedCount').textContent = fmtCount(seed);
          } else {
            document.getElementById('helpedCount').textContent = fmtCount(doc.data().count || seed);
          }
        } catch(e) {
          console.error('loadHelpedCount failed:', e);
          document.getElementById('helpedCount').textContent = fmtCount(counterSeed());
        }
        // Hide spinner, reveal count
        const spinner = document.getElementById('helpedCountSpinner');
        if (spinner) spinner.style.display = 'none';
        const countEl = document.getElementById('helpedCount');
        if (countEl) countEl.style.display = '';
        // Restore voted state from Firestore (or localStorage fallback)
        const voted = await getVotedState();
        const btn = document.getElementById('helpedPlusBtn');
        if (btn) {
          btn.classList.toggle('voted', voted);
          btn.style.display = '';
        }
      }
      window.toggleHelped = async function() {
        // Dismiss helper hint
        BB.storage.set('SkHelperHintDone', '1');
        const _hh = document.getElementById('skHelperHint');
        if (_hh) _hh.style.display = 'none';
        const alreadyVoted = await getVotedState();
        const btn = document.getElementById('helpedPlusBtn');
        // Read current displayed number for optimistic update — strip all non-digits (locale-safe)
        // Use isNaN check (not ||) so that a displayed value of 0 doesn't fall through to the seed
        const _parsed = parseInt(document.getElementById('helpedCount').textContent.replace(/[^0-9]/g, ''), 10);
        const current = isNaN(_parsed) ? counterSeed() : _parsed;

        if (!alreadyVoted) {
          // Optimistic update — show immediately, sync in background
          btn.classList.add('voted');
          btn.style.animation = 'none';
          void btn.offsetWidth;
          btn.style.animation = 'votePop 0.35s ease forwards';
          animateCount(fmtCount(current + 1), 'up');
          await setVotedState(true);
          try {
            await ensureAuth();
            await adjustCounter(1);
          } catch(e) { console.error('Counter increment failed:', e); }
        } else {
          // Optimistic update — show immediately, sync in background
          btn.classList.remove('voted');
          animateCount(fmtCount(current - 1), 'down');
          await setVotedState(false);
          try {
            await ensureAuth();
            await adjustCounter(-1);
          } catch(e) { console.error('Counter decrement failed:', e); }
        }
      };

      let _helpedCountLoaded = false;
      let _presenceStarted   = false;  // live-now heartbeat wired (see below)
      auth.onAuthStateChanged(user => {
        currentUser = user && !user.isAnonymous ? user : null;
        const signinBtn = document.getElementById('signinBtn');
        const userInfo = document.getElementById('userInfo');
        const userEmail = document.getElementById('userEmail');
        // Load counter once per page, now that auth state is known (avoids premature signInAnonymously)
        if (!_helpedCountLoaded) { _helpedCountLoaded = true; loadHelpedCount(); }
        // Report this session to the home screen's "(N live)" figure — reading
        // your survival kit is using the app. No callback: nothing here shows a
        // count, so this only heartbeats. Once per page, for the same reason
        // loadHelpedCount is.
        if (!_presenceStarted && window.BB && BB.userCount) {
          _presenceStarted = true;
          BB.userCount.startPresence(db, 'app');
        }
        if (user && !user.isAnonymous) {
          if (signinBtn) signinBtn.style.display = 'none';
          if (userInfo) { userInfo.style.display = 'flex'; }
          if (userEmail) userEmail.textContent = user.email;
          // Load user settings from Firestore
          // Skip overwriting if the user saved locally within the last 60 seconds (prevents race condition)
          const _skSavedAt = parseInt(localStorage.getItem('_sk_savedAt') || '0', 10);
          const _skSkipOverwrite = Date.now() - _skSavedAt < 60000;
          db.collection('userSettings').doc(user.uid).get().then(doc => {
            // Back guest-entered data (meds, goals, coping strategies, mood
            // definitions, memories, reminders, commitments, …) up to the
            // account. The tutorial saves these only to localStorage; creating
            // an account never uploaded them, so they vanished once localStorage
            // was cleared. Runs before the !doc.exists return so a brand-new
            // account is covered, and independently of _skSkipOverwrite because
            // it only ever *adds* missing data, never overwrites.
            if (window.BB && BB.claimGuestData) BB.claimGuestData(db, user, doc);
            if (!doc.exists) return;
            const d = doc.data();
            if (d.logoVariant !== undefined) {
              const idx = d.logoVariant;
              localStorage.setItem('logoVariant', idx);
              applyLogoVariant(idx);
            }
            if (!_skSkipOverwrite) {
            if (d.dailyGoals !== undefined) {
              localStorage.setItem('dailyGoals', JSON.stringify(d.dailyGoals));
              loadSurvivalGoals();
              updateWallTrackerUI();
            }
            if (d.dailyBudget !== undefined) {
              if (d.dailyBudget) localStorage.setItem('dailyBudget', d.dailyBudget);
              else localStorage.removeItem('dailyBudget');
              loadSurvivalBudget();
            }
            if (d.copingStrategies !== undefined) {
              localStorage.setItem('copingStrategies', JSON.stringify(d.copingStrategies));
              if (_copingMood) renderCopingList();
            }
            if (d.moodMemories !== undefined) {
              localStorage.setItem('moodMemories', JSON.stringify(d.moodMemories));
              if (_memoryMood) renderMemoryList();
            }
            if (d.customReminders !== undefined) {
              localStorage.setItem('customReminders', JSON.stringify(d.customReminders));
              renderCustomReminders();
            }
            if (d.myCommitments !== undefined) {
              localStorage.setItem('myCommitments', JSON.stringify(d.myCommitments));
              renderCommitments();
            }
            if (d.moodDefinitions !== undefined) {
              localStorage.setItem('moodDefinitions', JSON.stringify(d.moodDefinitions));
              renderAllMoodDefinitions();
            }
            if (d.rememberThis !== undefined) {
              localStorage.setItem('rememberThis', d.rememberThis);
              const el = document.getElementById('rememberText');
              if (el) el.value = d.rememberThis;
            }
            if (d.currentMedList !== undefined) {
              localStorage.setItem('currentMedList', JSON.stringify(d.currentMedList));
              loadMedInfo();
              if (typeof updateMedicationAccordions === 'function') updateMedicationAccordions();
            }
            if (d.survivalGratitude !== undefined) {
              localStorage.setItem('survivalGratitude', JSON.stringify(d.survivalGratitude));
              renderGratitude();
            }
            } // end !_skSkipOverwrite
            // The section ticks were computed at page load, when localStorage was
            // still empty on a freshly signed-in device — so every section read as
            // incomplete even though the data was in the account. Recompute now
            // that the cloud copy has landed. (Editing an entry used to be the only
            // way to refresh them, via the save → render path.)
            if (typeof _skUpdateTicks === 'function') _skUpdateTicks();
            // Sync vote state from Firestore
            const voted = !!d.helpedVoted;
            if (voted) localStorage.setItem('bipolarHelpedVoted', '1');
            else localStorage.removeItem('bipolarHelpedVoted');
            const btn = document.getElementById('helpedPlusBtn');
            if (btn) btn.classList.toggle('voted', voted);
          }).catch(() => {});
          // Also load name + emergency contact from personalDetails
          db.collection('personalDetails').doc(user.uid).get().then(doc => {
            if (doc.exists) {
              const data = doc.data();
              const ec = data.personalEmergencyContact;
              if (ec) {
                localStorage.setItem('personalEmergencyContact', ec);
                renderEmergencyContact();
              }
              const name = data.personalName || '';
              if (name) localStorage.setItem('personalName', name);
              _applyGuideTitle(name);
            }
          }).catch(() => {});
          window._fabOpenAuth = window.showAccountModal;
        } else {
          if (signinBtn) signinBtn.style.display = '';
          if (userInfo) userInfo.style.display = 'none';
          window._fabOpenAuth = window.showAuthModal;
        }
        renderEmergencyContact();
        if (typeof window._applyFabDock === 'function') window._applyFabDock();
      });
    } catch(e) { console.warn('Firebase init failed on survival-kit.html', e); }

    function logout() {
      [
        'moodMemories', 'customReminders', 'myCommitments',
        'personalEmergencyContact', 'personalName',
        'personalDOB', 'personalMedicalNum', 'personalDiagnosis',
        'personalDiagnosisDate', 'personalAddress', 'personalMobile',
        'personalEmail', 'personalEmergencyContact', 'personalNotes',
        'currentMedList', 'copingStrategies', 'moodDefinitions',
        'survivalGratitude',
        'bbFirstName', 'bipolarHelpedVoted', 'skAchievementUnlocked',
        // "Already counted in counters/{userCount,anonUserCount}" mirrors —
        // account-specific, so the next account on this device still counts.
        'bbUserCounted', 'bbAnon_counted',
      ].forEach(k => localStorage.removeItem(k));
      if (auth) auth.signOut();
    }

    // ── Emergency Contact ──
    function renderEmergencyContact() {
      const area = document.getElementById('emergencyContactArea');
      if (!area) return;
      const contact = localStorage.getItem('personalEmergencyContact') || '';
      if (contact) {
        // Try to extract a phone number from the contact string
        const phoneMatch = contact.match(/[\d\s\+\-\(\)]{7,}/);
        const phoneHref = phoneMatch ? `tel:${phoneMatch[0].replace(/\s/g,'')}` : null;
        area.innerHTML = `
          <div style="font-size:0.88em;color:rgba(255,255,255,0.85);margin-bottom:8px;font-weight:600;">${_esc(_skt('sk.crisis.ecLabel'))}</div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:center;">
            ${phoneHref
              ? `<a href="${phoneHref}" class="crisis-btn" style="font-size:0.95em;padding:10px 20px;">${_esc(contact)}</a>`
              : `<span style="color:white;font-weight:600;">${_esc(contact)}</span>`}
            <button type="button" onclick="openEmergencyContactForm()" style="background:rgba(255,255,255,0.15);color:white;border:1.5px solid rgba(255,255,255,0.4);border-radius:8px;padding:8px 14px;font-size:0.82em;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;">${_esc(_skt('sk.crisis.ecEdit'))}</button>
          </div>`;
      } else {
        area.innerHTML = `
          <button type="button" onclick="openEmergencyContactForm()" style="background:rgba(255,255,255,0.15);color:white;border:1.5px solid rgba(255,255,255,0.4);border-radius:10px;padding:10px 20px;font-size:0.9em;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;">${_esc(_skt('sk.crisis.ecAdd'))}</button>`;
      }
    }

    function openEmergencyContactForm() {
      const input = document.getElementById('ecInput');
      if (input) input.value = localStorage.getItem('personalEmergencyContact') || '';
      _lockBodyScroll();
      document.getElementById('ecModal').classList.add('active');
      setTimeout(() => { if (input) input.focus(); }, 300);
    }

    function closeEcModal() {
      document.getElementById('ecModal').classList.remove('active');
      _unlockBodyScroll();
    }

    async function saveEmergencyContact() {
      const input = document.getElementById('ecInput');
      if (!input) return;
      const value = input.value.trim();
      localStorage.setItem('personalEmergencyContact', value);
      if (currentUser && db) {
        try {
          await db.collection('personalDetails').doc(currentUser.uid).set(
            { personalEmergencyContact: value }, { merge: true }
          );
        } catch(e) { console.error('Failed to sync emergency contact:', e); }
      }
      closeEcModal();
      renderEmergencyContact();
    }

    window.openEmergencyContactForm = openEmergencyContactForm;
    window.closeEcModal = closeEcModal;
    window.saveEmergencyContact = saveEmergencyContact;

    // ── Personal Details ──
    const _pdFields = ['personalName','personalDOB','personalMedicalNum','personalDiagnosis','personalDiagnosisDate','personalAddress','personalMobile','personalEmail','personalEmergencyContact','personalNotes'];
    const _pdIds    = ['pdName','pdDOB','pdMedicalNum','pdDiagnosis','pdDiagnosisDate','pdAddress','pdMobile','pdEmail','pdEmergencyContact','pdNotes'];
    async function showPersonalDetailsModal() {
      if (window.db && window.currentUser) {
        try {
          const doc = await window.db.collection('personalDetails').doc(window.currentUser.uid).get();
          if (doc.exists) {
            const d = doc.data();
            _pdFields.forEach(k => { if (d[k] !== undefined) localStorage.setItem(k, d[k]); });
          }
        } catch(e) {}
      }
      _pdIds.forEach((id, i) => {
        const el = document.getElementById(id);
        if (el) el.value = localStorage.getItem(_pdFields[i]) || '';
      });
      _lockBodyScroll();
      document.getElementById('skPersonalDetailsModal').classList.add('active');
    }
    function closePersonalDetailsModal() {
      document.getElementById('skPersonalDetailsModal').classList.remove('active');
      _unlockBodyScroll();
    }
    async function savePersonalDetails() {
      const data = {};
      _pdIds.forEach((id, i) => {
        const val = document.getElementById(id)?.value || '';
        localStorage.setItem(_pdFields[i], val);
        data[_pdFields[i]] = val;
      });
      if (window.db && window.currentUser) {
        try { await window.db.collection('personalDetails').doc(window.currentUser.uid).set(data, { merge: true }); } catch(e) {}
      }
      alert(_skt('sk.pd.saved'));
      closePersonalDetailsModal();
    }
    window.showPersonalDetailsModal = showPersonalDetailsModal;
    window.closePersonalDetailsModal = closePersonalDetailsModal;
    window.savePersonalDetails = savePersonalDetails;
    window.renderEmergencyContact = renderEmergencyContact;

    // ── Auth hooks (modals now in shared fab.js) ──
    window._fabOnSignOut = logout;
    // _fabOpenAuth is set dynamically by onAuthStateChanged below

    // ── Logo easter egg with persistence ──
    const logoImg = document.getElementById('survivalLogo');
    const srcs = ['images/logos/good_logo.png', 'images/logos/elevated_logo.png', 'images/logos/sad_logo.png'];
    let currentIndex = parseInt(localStorage.getItem('logoVariant') || '0');
    let clickCount = 0;
    let resetTimer = null;

    function applyLogoVariant(idx) {
      currentIndex = idx;
      logoImg.src = srcs[idx];
    }

    function saveLogoVariant(idx) {
      localStorage.setItem('logoVariant', idx);
      if (currentUser && db) {
        db.collection('userSettings').doc(currentUser.uid).set({ logoVariant: idx }, { merge: true }).catch(() => {});
      }
      if (window.webkit?.messageHandlers?.setSharedData) {
        window.webkit.messageHandlers.setSharedData.postMessage({ logoVariant: idx });
      } else if (window.Capacitor?.getPlatform?.() === 'android') {
        window.Capacitor?.Plugins?.BipolarBearWidget?.setSharedData({ logoVariant: idx });
      }
    }

    // Restore on load
    applyLogoVariant(currentIndex);

    logoImg.addEventListener('click', () => {
      clearTimeout(resetTimer);
      clickCount++;

      logoImg.style.transition = 'transform 0.1s ease';
      logoImg.style.transform = 'scale(1.15) rotate(5deg)';
      setTimeout(() => { logoImg.style.transform = ''; }, 120);

      if (clickCount === 5) {
        clickCount = 0;
        currentIndex = (currentIndex + 1) % srcs.length;
        saveLogoVariant(currentIndex);

        // Sync app icon with logo variant (native only)
        try {
          if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.setAppIcon) {
            const iconNames = [null, 'AppIcon_Happy', 'AppIcon_Sad'];
            window.webkit.messageHandlers.setAppIcon.postMessage({ name: iconNames[currentIndex] || null });
          }
        } catch(e) {}

        logoImg.style.transition = 'transform 0.4s ease, opacity 0.3s ease';
        logoImg.style.transform = 'scale(0) rotate(180deg)';
        logoImg.style.opacity = '0';
        setTimeout(() => {
          logoImg.src = srcs[currentIndex];
          logoImg.style.transform = 'scale(1.1) rotate(-5deg)';
          logoImg.style.opacity = '1';
          setTimeout(() => {
            logoImg.style.transition = '';
            logoImg.style.transform = '';
          }, 200);
        }, 300);
      } else {
        resetTimer = setTimeout(() => { clickCount = 0; }, 1500);
      }
    });

// ── BLOCK 4 ──
// ── Onboarding step 7 gating ──
    function _resolvePointerPosition(ptr, hintEls) {
      const vw = window.innerWidth, vh = window.innerHeight;
      const sz = 72, pad = 16;
      const candidates = [
        { left: vw / 2, top: vh / 2 },
        { left: vw / 2, top: vh * 0.25 },
        { left: vw / 2, top: vh * 0.75 },
        { left: vw * 0.25, top: vh / 2 },
        { left: vw * 0.75, top: vh / 2 },
      ];
      function overlaps(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) {
        return ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1;
      }
      for (const c of candidates) {
        const px1 = c.left - sz / 2 - pad, py1 = c.top - sz / 2 - pad;
        const px2 = c.left + sz / 2 + pad, py2 = c.top + sz / 2 + pad;
        const hit = hintEls.some(el => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return overlaps(px1, py1, px2, py2, r.left, r.top, r.right, r.bottom);
        });
        if (!hit) {
          ptr.style.left = c.left + 'px';
          ptr.style.top = c.top + 'px';
          ptr.style.transform = 'translate(-50%,-50%)';
          return;
        }
      }
      ptr.style.display = 'none';
    }
    function _showSkHintPointer(targetEl) {
      document.getElementById('_bbSkHintPointer')?.remove();
      const rect = targetEl.getBoundingClientRect();
      const tx = rect.left + rect.width / 2;
      const ty = rect.top + rect.height / 2;
      const ptr = document.createElement('div');
      ptr.id = '_bbSkHintPointer';
      ptr.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:125;pointer-events:none;animation:hintFade 1.8s ease-in-out infinite;';
      ptr.innerHTML = `<div style="position:relative;width:72px;height:72px;display:flex;align-items:center;justify-content:center;"><svg width="72" height="72" viewBox="0 0 72 72" fill="none" style="position:absolute;inset:0;"><circle cx="36" cy="36" r="34" stroke="rgba(255,255,255,0.55)" stroke-width="2"/></svg><svg width="52" height="52" viewBox="0 0 52 52" fill="none" style="transform:rotate(0deg);filter:drop-shadow(0 2px 6px rgba(0,0,0,0.4));"><line x1="26" y1="44" x2="26" y2="10" stroke="white" stroke-width="4" stroke-linecap="round"/><polyline points="14,22 26,10 38,22" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></div>`;
      document.body.appendChild(ptr);
      _resolvePointerPosition(ptr, Array.from(document.querySelectorAll('.sk-hint-elevated')));
      // Recalculate angle from final pointer position (may have moved from centre)
      const fcx = parseFloat(ptr.style.left);
      const fcy = parseFloat(ptr.style.top);
      const _arrowSvg = ptr.querySelectorAll('svg')[1];
      if (_arrowSvg && !isNaN(fcx) && !isNaN(fcy)) {
        _arrowSvg.style.transform = `rotate(${Math.atan2(ty - fcy, tx - fcx) * 180 / Math.PI + 90}deg)`;
      }
    }
    function _hideSkHintPointer() {
      document.getElementById('_bbSkHintPointer')?.remove();
    }

    function _applySkOnboardingGating() {
      // No blocking onboarding steps on survival kit — users explore freely
    }
    _applySkOnboardingGating();

    function _skGoToJournal() {
      location.replace('journal.html');
    }
    window._skGoToJournal = _skGoToJournal;

// ── BLOCK 5 ──
// ── Native status bar (orange, light text) ──
    document.addEventListener('DOMContentLoaded', async () => {
      if (!window.Capacitor || !window.Capacitor.isNativePlatform || !window.Capacitor.isNativePlatform()) return;
      try {
        const StatusBar = window.Capacitor.Plugins.StatusBar;
        if (StatusBar) {
          await StatusBar.setStyle({ style: 'LIGHT' });
          await StatusBar.setBackgroundColor({ color: 'var(--brand-primary-dark)' });
        }
      } catch (e) { /* ignore */ }
    });

    // ── Android back button: close an open modal, otherwise go to the home
    //    screen rather than exiting/minimising the app. ──
    document.addEventListener('DOMContentLoaded', () => {
      const App = window.Capacitor?.Plugins?.App;
      const isAndroid = window.Capacitor?.getPlatform?.() === 'android';
      if (!App || !isAndroid) return;
      App.addListener('backButton', () => {
        const openModal = document.querySelector('.overlay-modal.active, .steps-modal.active');
        if (openModal) {
          openModal.classList.remove('active');
        } else if (_skOpenId) {
          // A section is open: back returns to the overview grid first.
          skShowGrid();
        } else {
          location.replace('index.html');
        }
      });
    });

// ── BLOCK 6 ──
// ── Guest inactivity relock (5 min) ──
    if (BB.storage.get('GuestPinSalt')) {
      let _idleTimer;
      function _resetIdleTimer() {
        clearTimeout(_idleTimer);
        _idleTimer = setTimeout(() => {
          sessionStorage.removeItem('bbPinUnlocked');
          sessionStorage.removeItem('bb_guest_key');
          location.replace('index.html');
        }, 5 * 60 * 1000);
      }
      ['touchstart', 'mousedown', 'keydown', 'scroll'].forEach(ev =>
        document.addEventListener(ev, _resetIdleTimer, { passive: true })
      );
      _resetIdleTimer();
    }
