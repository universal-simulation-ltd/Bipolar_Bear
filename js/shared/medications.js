/**
 * Shared medication reference data used by survival-kit.html and the
 * anonymous-board Wiki tab. Pure data + a substring matcher; each page
 * supplies its own renderer because the theme/CSS differs (orange vs.
 * yellow).
 *
 * Loaded via <script src> before the page script.
 *   window.BB.medications.list
 *   window.BB.medications.match(name)
 */
(function () {
  'use strict';

  var LIST = [
    {
      keys: ['lithium'],
      title: 'Lithium (Mood Stabiliser)',
      body: 'One of the most effective long-term treatments for bipolar disorder. Helps reduce the frequency and severity of mood episodes and lowers suicide risk. Requires regular blood tests to monitor levels and kidney/thyroid function. Common side effects include thirst, tremor, and increased urination.',
      nhs: 'https://www.nhs.uk/medicines/lithium/'
    },
    {
      keys: ['lamotrigine', 'lamictal'],
      title: 'Lamotrigine / Lamictal (Mood Stabiliser)',
      body: 'Particularly effective for preventing depressive episodes in bipolar disorder. Must be started at a low dose and increased slowly to avoid a rare but serious skin rash (Stevens-Johnson syndrome). Generally well tolerated. Less effective for mania prevention.',
      nhs: 'https://www.nhs.uk/medicines/lamotrigine/'
    },
    {
      keys: ['quetiapine', 'seroquel'],
      title: 'Quetiapine / Seroquel (Antipsychotic)',
      body: 'Used for both manic and depressive episodes, and as a maintenance treatment. Often causes sedation, which can be useful at night. Common side effects include weight gain, dry mouth, and dizziness. One of the most commonly prescribed medications for bipolar disorder.',
      nhs: 'https://www.nhs.uk/medicines/quetiapine/'
    },
    {
      keys: ['valproate', 'sodium valproate', 'depakote', 'epilim'],
      title: 'Valproate / Sodium Valproate (Mood Stabiliser)',
      body: 'Effective for mania and as a long-term mood stabiliser, particularly for rapid cycling. Requires blood tests to monitor levels and liver function. Not recommended during pregnancy. Side effects can include weight gain, hair loss, and sedation.',
      nhs: 'https://www.nhs.uk/medicines/sodium-valproate/'
    },
    {
      keys: ['olanzapine', 'zyprexa'],
      title: 'Olanzapine / Zyprexa (Antipsychotic)',
      body: 'Effective for acute mania and as a maintenance treatment. Can cause significant weight gain and metabolic changes (raised blood sugar, cholesterol). Often combined with lithium or valproate. Sedating, which can help with sleep during episodes.',
      nhs: 'https://www.nhs.uk/medicines/olanzapine/'
    },
    {
      keys: ['aripiprazole', 'abilify'],
      title: 'Aripiprazole / Abilify (Antipsychotic)',
      body: 'Used for mania and as a maintenance treatment. Less likely to cause weight gain or sedation than other antipsychotics. Side effects can include restlessness (akathisia), nausea, and insomnia. Also available as a long-acting injection (monthly or every 6 weeks).',
      nhs: 'https://www.nhs.uk/medicines/aripiprazole/'
    },
    {
      keys: ['risperidone', 'risperdal'],
      title: 'Risperidone / Risperdal (Antipsychotic)',
      body: 'Effective for acute manic and mixed episodes. Can cause movement-related side effects (extrapyramidal symptoms), weight gain, and raised prolactin levels. Available as a long-acting injection for maintenance treatment.',
      nhs: 'https://www.nhs.uk/medicines/risperidone/'
    },
    {
      keys: ['antidepressant', 'sertraline', 'fluoxetine', 'escitalopram', 'venlafaxine', 'duloxetine', 'citalopram', 'mirtazapine', 'paroxetine'],
      title: 'Antidepressants — use with caution',
      body: 'Antidepressants (SSRIs, SNRIs) are generally used cautiously in bipolar disorder as they can trigger mania or rapid cycling, especially without a mood stabiliser. When used, they are usually prescribed alongside a mood stabiliser. Always discuss the risks with your psychiatrist.',
      nhs: 'https://www.nhs.uk/conditions/antidepressants/'
    }
  ];

  function match(name) {
    if (!name) return null;
    var lower = String(name).toLowerCase();
    for (var i = 0; i < LIST.length; i++) {
      var m = LIST[i];
      for (var j = 0; j < m.keys.length; j++) {
        if (lower.indexOf(m.keys[j]) !== -1) return m;
      }
    }
    return null;
  }

  // What people read (title + body) in the current language. The
  // translations are the Wiki tab's (anon.wiki.a.<slug>_<field> in
  // js/shared/i18n.js, same slug as _wikiSlug() in js/anonymous.js); drug and
  // brand names inside them stay as written. Falls back to the English above
  // when there is no translation or i18n hasn't loaded.
  function slug(t) {
    return String(t).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  }
  function text(m, field) {
    if (!m || !m[field]) return (m && m[field]) || '';
    var k = 'anon.wiki.a.' + slug(m.title) + '_' + field;
    var v = (window.BB && typeof window.BB.t === 'function') ? window.BB.t(k) : k;
    return (typeof v === 'string' && v && v !== k) ? v : m[field];
  }

  window.BB = window.BB || {};
  window.BB.medications = { list: LIST, match: match, text: text };
})();
