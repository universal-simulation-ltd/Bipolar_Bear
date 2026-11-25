/**
 * Strings for the "leave a review" links (2026-11-25, James: more store reviews,
 * from a quiet link people choose to tap; the automatic ask stays as it was).
 * In all ten languages, under the `rate` namespace (BB.i18n.extend):
 *   bearLink        the line in Bipolar Bear's Send Feedback sheet (fab.js), which
 *                   opens the existing review card (fab.review.*)
 *   anonTitle/anonBody/appStore/googlePlay   the block in Bipolar Anonymous's About sheet
 * Both show only inside the phone apps (a store review means nothing on the web).
 * Loaded on index.html, journal.html and anonymous.html.
 *
 * @file js/shared/i18n-rate.js
 */
(function () {
  'use strict';
  if (!window.BB || !BB.i18n || !BB.i18n.extend) return;
  var S = {
    en: { bearLink: '⭐ Enjoying Bipolar Bear? Leave a review', anonTitle: 'Enjoying Bipolar Anonymous?', anonBody: 'A review helps other people living with bipolar find this space. It only takes a moment.', appStore: '⭐ Review on the App Store', googlePlay: '⭐ Review on Google Play' },
    es: { bearLink: '⭐ ¿Te gusta Bipolar Bear? Deja una reseña', anonTitle: '¿Te gusta Bipolar Anonymous?', anonBody: 'Una reseña ayuda a que otras personas que viven con bipolaridad encuentren este espacio. Solo lleva un momento.', appStore: '⭐ Reseña en el App Store', googlePlay: '⭐ Reseña en Google Play' },
    fr: { bearLink: '⭐ Bipolar Bear te plaît ? Laisse un avis', anonTitle: 'Bipolar Anonymous te plaît ?', anonBody: 'Un avis aide d’autres personnes qui vivent avec un trouble bipolaire à trouver cet espace. Cela ne prend qu’un instant.', appStore: '⭐ Donner un avis sur l’App Store', googlePlay: '⭐ Donner un avis sur Google Play' },
    de: { bearLink: '⭐ Gefällt dir Bipolar Bear? Schreib eine Bewertung', anonTitle: 'Gefällt dir Bipolar Anonymous?', anonBody: 'Eine Bewertung hilft anderen Menschen mit Bipolar, diesen Ort zu finden. Es dauert nur einen Moment.', appStore: '⭐ Im App Store bewerten', googlePlay: '⭐ Bei Google Play bewerten' },
    it: { bearLink: '⭐ Ti piace Bipolar Bear? Lascia una recensione', anonTitle: 'Ti piace Bipolar Anonymous?', anonBody: 'Una recensione aiuta altre persone che vivono con il disturbo bipolare a trovare questo spazio. Ci vuole solo un momento.', appStore: '⭐ Recensisci su App Store', googlePlay: '⭐ Recensisci su Google Play' },
    pt: { bearLink: '⭐ Gostas do Bipolar Bear? Deixa uma avaliação', anonTitle: 'Gostas do Bipolar Anonymous?', anonBody: 'Uma avaliação ajuda outras pessoas que vivem com perturbação bipolar a encontrar este espaço. Só demora um momento.', appStore: '⭐ Avaliar na App Store', googlePlay: '⭐ Avaliar no Google Play' },
    nl: { bearLink: '⭐ Vind je Bipolar Bear fijn? Schrijf een review', anonTitle: 'Vind je Bipolar Anonymous fijn?', anonBody: 'Een review helpt andere mensen met een bipolaire stoornis deze plek te vinden. Het kost maar even.', appStore: '⭐ Review in de App Store', googlePlay: '⭐ Review in Google Play' },
    pl: { bearLink: '⭐ Podoba ci się Bipolar Bear? Napisz opinię', anonTitle: 'Podoba ci się Bipolar Anonymous?', anonBody: 'Opinia pomaga innym osobom z chorobą dwubiegunową znaleźć to miejsce. To zajmie tylko chwilę.', appStore: '⭐ Oceń w App Store', googlePlay: '⭐ Oceń w Google Play' },
    sv: { bearLink: '⭐ Gillar du Bipolar Bear? Skriv ett omdöme', anonTitle: 'Gillar du Bipolar Anonymous?', anonBody: 'Ett omdöme hjälper andra som lever med bipolaritet att hitta hit. Det tar bara en stund.', appStore: '⭐ Betygsätt i App Store', googlePlay: '⭐ Betygsätt på Google Play' },
    zh: { bearLink: '⭐ 喜欢 Bipolar Bear 吗？写一条评价', anonTitle: '喜欢 Bipolar Anonymous 吗？', anonBody: '一条评价能帮助其他双相情感障碍患者找到这个空间。只需片刻。', appStore: '⭐ 在 App Store 评价', googlePlay: '⭐ 在 Google Play 评价' },
  };
  Object.keys(S).forEach(function (code) { BB.i18n.extend(code, { rate: S[code] }); });
})();
