/**
 * Strings for 💊 each medicine on its own (2026-11-25): the per-medicine cards
 * in the journal's Personalised feedback (js/journal-medlink.js, DOCS.md
 * §2.35). All ten languages (machine translated). Added with BB.i18n.extend
 * under the `medLink` namespace. Loaded on journal.html.
 *
 * The yes / no sentences share one shape per language: `what` (the outcome)
 * put into `c0` (on the day) or `c1` (on the day after). Counts are always
 * "x of n", so no plural forms are needed. Polish avoids gendered past-tense
 * verbs, as the other journal strings do. {med} and {others} are the person's
 * own medicine names, put in by the module after translating.
 *
 * @file js/shared/i18n-medlink.js
 */
(function () {
  'use strict';
  if (!window.BB || !BB.i18n || !BB.i18n.extend) return;

  var IDS = ['up', 'down', 'stable', 'anxiety', 'stress', 'irrit'];
  function build(L) {
    var out = {};
    Object.keys(L).forEach(function (k) { if (k !== 'what' && k !== 'c0' && k !== 'c1') out[k] = L[k]; });
    IDS.forEach(function (id) {
      out[id + '0'] = L.c0.split('{what}').join(L.what[id]);
      out[id + '1'] = L.c1.split('{what}').join(L.what[id]);
    });
    return out;
  }

  var S = {
    en: {
      title: '{med}: days taken and not taken',
      basis: 'Based on {n} days you didn’t take it and {m} days you did.',
      none: 'No clear difference yet between the days you took it and the days you didn’t.',
      together: 'On most of those days you also didn’t take {others}, so these days can’t tell the medicines apart.',
      caution: 'This is a pattern in your journal, not proof that one leads to the other. Talk to your prescriber before changing how you take any medicine.',
      what: { up: 'Your mood was elevated or manic', down: 'Your mood was low or depressed', stable: 'Your mood was stable', anxiety: 'Your anxiety was high', stress: 'Your stress was high', irrit: 'You felt irritable' },
      c0: '{what} on {x} of {n} days you didn’t take it, and on {y} of {m} days you did.',
      c1: '{what} on {x} of {n} days after a day you didn’t take it, and on {y} of {m} days after a day you did.',
      sleep1: 'You slept about {a} the night after a day you didn’t take it, and about {b} after a day you did.',
      quality1: 'You rated your sleep bad on {x} of {n} nights after a day you didn’t take it, and on {y} of {m} nights after a day you did.',
      energy0: 'Your energy averaged {a} out of 10 on days you didn’t take it, and {b} on days you did.',
      energy1: 'Your energy averaged {a} out of 10 on days after a day you didn’t take it, and {b} after a day you did.',
      h: '{h}h', hm: '{h}h {m}m',
    },
    es: {
      title: '{med}: días en que lo tomaste y en que no',
      basis: 'Basado en {n} días en que no lo tomaste y {m} días en que sí.',
      none: 'Todavía no hay una diferencia clara entre los días en que lo tomaste y los días en que no.',
      together: 'La mayoría de esos días tampoco tomaste {others}, así que estos días no permiten distinguir entre los medicamentos.',
      caution: 'Es un patrón en tu diario, no una prueba de que una cosa lleve a la otra. Habla con quien te lo receta antes de cambiar cómo tomas cualquier medicamento.',
      what: { up: 'Tu estado de ánimo estuvo elevado o maníaco', down: 'Tu estado de ánimo estuvo bajo o deprimido', stable: 'Tu estado de ánimo estuvo estable', anxiety: 'Tu ansiedad fue alta', stress: 'Tu estrés fue alto', irrit: 'Te sentiste irritable' },
      c0: '{what} {x} de {n} días en que no lo tomaste, y {y} de {m} días en que sí.',
      c1: '{what} {x} de {n} días después de un día sin tomarlo, y {y} de {m} días después de un día en que lo tomaste.',
      sleep1: 'Dormiste unas {a} la noche después de un día sin tomarlo, y unas {b} después de un día en que lo tomaste.',
      quality1: 'Calificaste tu sueño como malo {x} de {n} noches después de un día sin tomarlo, y {y} de {m} noches después de un día en que lo tomaste.',
      energy0: 'Tu energía fue de {a} sobre 10 de media los días en que no lo tomaste, y de {b} los días en que sí.',
      energy1: 'Tu energía fue de {a} sobre 10 de media los días después de un día sin tomarlo, y de {b} después de un día en que lo tomaste.',
      h: '{h} h', hm: '{h} h {m} min',
    },
    fr: {
      title: '{med} : jours pris et non pris',
      basis: 'D’après {n} jours où tu ne l’as pas pris et {m} jours où tu l’as pris.',
      none: 'Pas encore de différence nette entre les jours où tu l’as pris et ceux où tu ne l’as pas pris.',
      together: 'La plupart de ces jours, tu n’as pas pris non plus {others} : ces jours ne permettent donc pas de distinguer les médicaments.',
      caution: 'C’est une tendance dans ton journal, pas la preuve que l’un entraîne l’autre. Parle à ton prescripteur avant de changer ta façon de prendre un médicament.',
      what: { up: 'Ton humeur était élevée ou maniaque', down: 'Ton humeur était basse ou dépressive', stable: 'Ton humeur était stable', anxiety: 'Ton anxiété était forte', stress: 'Ton stress était élevé', irrit: 'Tu te sentais irritable' },
      c0: '{what} {x} jours sur {n} où tu ne l’as pas pris, et {y} jours sur {m} où tu l’as pris.',
      c1: '{what} {x} jours sur {n} après un jour sans le prendre, et {y} jours sur {m} après un jour où tu l’as pris.',
      sleep1: 'Tu as dormi environ {a} la nuit suivant un jour sans le prendre, et environ {b} après un jour où tu l’as pris.',
      quality1: 'Tu as jugé ton sommeil mauvais {x} nuits sur {n} après un jour sans le prendre, et {y} nuits sur {m} après un jour où tu l’as pris.',
      energy0: 'Ton énergie était en moyenne de {a} sur 10 les jours où tu ne l’as pas pris, et de {b} les jours où tu l’as pris.',
      energy1: 'Ton énergie était en moyenne de {a} sur 10 les jours suivant un jour sans le prendre, et de {b} après un jour où tu l’as pris.',
      h: '{h} h', hm: '{h} h {m}',
    },
    de: {
      title: '{med}: Tage mit und ohne Einnahme',
      basis: 'Grundlage: {n} Tage ohne und {m} Tage mit Einnahme.',
      none: 'Noch kein klarer Unterschied zwischen Tagen mit und ohne Einnahme.',
      together: 'An den meisten dieser Tage hast du auch {others} nicht genommen, daher lassen sich die Medikamente hier nicht auseinanderhalten.',
      caution: 'Das ist ein Muster in deinem Tagebuch, kein Beweis, dass das eine zum anderen führt. Sprich mit der Person, die es dir verschreibt, bevor du etwas an der Einnahme eines Medikaments änderst.',
      what: { up: 'Gehobene oder manische Stimmung', down: 'Gedrückte oder depressive Stimmung', stable: 'Stabile Stimmung', anxiety: 'Starke Angst', stress: 'Hoher Stress', irrit: 'Gereiztheit' },
      c0: '{what} an {x} von {n} Tagen ohne Einnahme und an {y} von {m} Tagen mit Einnahme.',
      c1: '{what} an {x} von {n} Tagen nach einem Tag ohne Einnahme und an {y} von {m} Tagen nach einem Tag mit Einnahme.',
      sleep1: 'In der Nacht nach einem Tag ohne Einnahme hast du etwa {a} geschlafen, nach einem Tag mit Einnahme etwa {b}.',
      quality1: 'Schlecht geschlafen in {x} von {n} Nächten nach einem Tag ohne Einnahme und in {y} von {m} Nächten nach einem Tag mit Einnahme.',
      energy0: 'Deine Energie lag an Tagen ohne Einnahme im Schnitt bei {a} von 10, an Tagen mit Einnahme bei {b}.',
      energy1: 'Deine Energie lag an Tagen nach einem Tag ohne Einnahme im Schnitt bei {a} von 10, nach einem Tag mit Einnahme bei {b}.',
      h: '{h} h', hm: '{h} h {m} min',
    },
    it: {
      title: '{med}: giorni in cui l’hai preso e no',
      basis: 'In base a {n} giorni in cui non l’hai preso e {m} giorni in cui l’hai preso.',
      none: 'Ancora nessuna differenza chiara tra i giorni in cui l’hai preso e quelli in cui no.',
      together: 'Nella maggior parte di quei giorni non hai preso neanche {others}, quindi questi giorni non permettono di distinguere i farmaci.',
      caution: 'È un andamento nel tuo diario, non la prova che una cosa porti all’altra. Parla con chi te lo prescrive prima di cambiare il modo in cui prendi un farmaco.',
      what: { up: 'Umore elevato o maniacale', down: 'Umore basso o depresso', stable: 'Umore stabile', anxiety: 'Ansia alta', stress: 'Stress alto', irrit: 'Irritabilità' },
      c0: '{what} in {x} giorni su {n} senza prenderlo e in {y} giorni su {m} prendendolo.',
      c1: '{what} in {x} giorni su {n} dopo un giorno senza prenderlo e in {y} giorni su {m} dopo un giorno in cui l’hai preso.',
      sleep1: 'Hai dormito circa {a} la notte dopo un giorno senza prenderlo e circa {b} dopo un giorno in cui l’hai preso.',
      quality1: 'Hai valutato il sonno cattivo in {x} notti su {n} dopo un giorno senza prenderlo e in {y} notti su {m} dopo un giorno in cui l’hai preso.',
      energy0: 'La tua energia è stata in media {a} su 10 nei giorni senza prenderlo e {b} nei giorni in cui l’hai preso.',
      energy1: 'La tua energia è stata in media {a} su 10 nei giorni dopo un giorno senza prenderlo e {b} dopo un giorno in cui l’hai preso.',
      h: '{h} h', hm: '{h} h {m} min',
    },
    pt: {
      title: '{med}: dias em que tomaste e em que não',
      basis: 'Com base em {n} dias em que não o tomaste e {m} dias em que o tomaste.',
      none: 'Ainda não há uma diferença clara entre os dias em que o tomaste e os dias em que não.',
      together: 'Na maioria desses dias também não tomaste {others}, por isso estes dias não permitem distinguir os medicamentos.',
      caution: 'É um padrão no teu diário, não uma prova de que uma coisa leva à outra. Fala com quem to receita antes de mudares a forma como tomas qualquer medicamento.',
      what: { up: 'O teu humor esteve elevado ou maníaco', down: 'O teu humor esteve em baixo ou deprimido', stable: 'O teu humor esteve estável', anxiety: 'A tua ansiedade foi alta', stress: 'O teu stress foi alto', irrit: 'Sentiste-te irritável' },
      c0: '{what} em {x} de {n} dias em que não o tomaste, e em {y} de {m} dias em que o tomaste.',
      c1: '{what} em {x} de {n} dias a seguir a um dia sem o tomar, e em {y} de {m} dias a seguir a um dia em que o tomaste.',
      sleep1: 'Dormiste cerca de {a} na noite a seguir a um dia sem o tomar, e cerca de {b} a seguir a um dia em que o tomaste.',
      quality1: 'Classificaste o teu sono como mau em {x} de {n} noites a seguir a um dia sem o tomar, e em {y} de {m} noites a seguir a um dia em que o tomaste.',
      energy0: 'A tua energia foi em média {a} em 10 nos dias em que não o tomaste, e {b} nos dias em que o tomaste.',
      energy1: 'A tua energia foi em média {a} em 10 nos dias a seguir a um dia sem o tomar, e {b} a seguir a um dia em que o tomaste.',
      h: '{h} h', hm: '{h} h {m} min',
    },
    nl: {
      title: '{med}: dagen wel en niet ingenomen',
      basis: 'Op basis van {n} dagen dat je het niet nam en {m} dagen dat je het wel nam.',
      none: 'Nog geen duidelijk verschil tussen de dagen dat je het nam en de dagen dat je het niet nam.',
      together: 'Op de meeste van die dagen nam je ook {others} niet, dus deze dagen kunnen de medicijnen niet uit elkaar houden.',
      caution: 'Dit is een patroon in je dagboek, geen bewijs dat het een tot het ander leidt. Praat met je voorschrijver voordat je iets verandert aan hoe je een medicijn inneemt.',
      what: { up: 'Je stemming was verhoogd of manisch', down: 'Je stemming was somber of depressief', stable: 'Je stemming was stabiel', anxiety: 'Je angst was hoog', stress: 'Je stress was hoog', irrit: 'Je voelde je prikkelbaar' },
      c0: '{what} op {x} van de {n} dagen dat je het niet nam, en op {y} van de {m} dagen dat je het wel nam.',
      c1: '{what} op {x} van de {n} dagen na een dag zonder, en op {y} van de {m} dagen na een dag dat je het wel nam.',
      sleep1: 'Je sliep ongeveer {a} in de nacht na een dag zonder, en ongeveer {b} na een dag dat je het wel nam.',
      quality1: 'Je beoordeelde je slaap als slecht in {x} van de {n} nachten na een dag zonder, en in {y} van de {m} nachten na een dag dat je het wel nam.',
      energy0: 'Je energie was gemiddeld {a} op 10 op dagen dat je het niet nam, en {b} op dagen dat je het wel nam.',
      energy1: 'Je energie was gemiddeld {a} op 10 op dagen na een dag zonder, en {b} na een dag dat je het wel nam.',
      h: '{h} u', hm: '{h} u {m} min',
    },
    pl: {
      title: '{med}: dni z lekiem i bez',
      basis: 'Na podstawie {n} dni bez tego leku i {m} dni z nim.',
      none: 'Na razie brak wyraźnej różnicy między dniami z tym lekiem i bez niego.',
      together: 'W większość tych dni nie przyjęto też: {others}, więc te dni nie pozwalają odróżnić leków.',
      caution: 'To wzorzec w Twoim dzienniku, a nie dowód, że jedno prowadzi do drugiego. Porozmawiaj z lekarzem prowadzącym, zanim zmienisz sposób przyjmowania jakiegokolwiek leku.',
      what: { up: 'Nastrój podwyższony lub maniakalny', down: 'Nastrój obniżony lub depresyjny', stable: 'Nastrój stabilny', anxiety: 'Wysoki lęk', stress: 'Wysoki stres', irrit: 'Drażliwość' },
      c0: '{what}: {x} z {n} dni bez tego leku i {y} z {m} dni z nim.',
      c1: '{what}: {x} z {n} dni po dniu bez tego leku i {y} z {m} dni po dniu z nim.',
      sleep1: 'Sen w noc po dniu bez tego leku trwał około {a}, a po dniu z nim około {b}.',
      quality1: 'Sen oceniony jako zły: {x} z {n} nocy po dniu bez tego leku i {y} z {m} nocy po dniu z nim.',
      energy0: 'Energia średnio {a} na 10 w dni bez tego leku i {b} w dni z nim.',
      energy1: 'Energia średnio {a} na 10 w dni po dniu bez tego leku i {b} po dniu z nim.',
      h: '{h} godz.', hm: '{h} godz. {m} min',
    },
    sv: {
      title: '{med}: dagar med och utan',
      basis: 'Utifrån {n} dagar du inte tog den och {m} dagar du tog den.',
      none: 'Ingen tydlig skillnad än mellan dagarna du tog den och dagarna du inte gjorde det.',
      together: 'De flesta av de dagarna tog du inte heller {others}, så de här dagarna kan inte skilja medicinerna åt.',
      caution: 'Det här är ett mönster i din dagbok, inte ett bevis för att det ena leder till det andra. Prata med den som skriver ut medicinen innan du ändrar hur du tar någon medicin.',
      what: { up: 'Ditt humör var förhöjt eller maniskt', down: 'Ditt humör var lågt eller deprimerat', stable: 'Ditt humör var stabilt', anxiety: 'Din ångest var hög', stress: 'Din stress var hög', irrit: 'Du kände dig irriterad' },
      c0: '{what} {x} av {n} dagar du inte tog den, och {y} av {m} dagar du tog den.',
      c1: '{what} {x} av {n} dagar efter en dag utan den, och {y} av {m} dagar efter en dag du tog den.',
      sleep1: 'Du sov ungefär {a} natten efter en dag utan den, och ungefär {b} efter en dag du tog den.',
      quality1: 'Du bedömde din sömn som dålig {x} av {n} nätter efter en dag utan den, och {y} av {m} nätter efter en dag du tog den.',
      energy0: 'På dagar du inte tog den låg din energi i snitt på {a} av 10, och på dagar du tog den på {b}.',
      energy1: 'Dagar efter en dag utan den låg din energi i snitt på {a} av 10, och efter en dag du tog den på {b}.',
      h: '{h} h', hm: '{h} h {m} min',
    },
    zh: {
      title: '{med}：服用与未服用的日子',
      basis: '依据：未服用的 {n} 天和服用的 {m} 天。',
      none: '目前在服用和未服用的日子之间还看不出明显差异。',
      together: '在这些日子里，你大多也没有服用{others}，所以这些日子无法区分是哪种药物。',
      caution: '这是你日记中的一种规律，并不能证明两者之间有因果关系。在改变任何药物的服用方式之前，请先与开药的医生沟通。',
      what: { up: '情绪高涨或躁狂', down: '情绪低落或抑郁', stable: '情绪稳定', anxiety: '焦虑程度高', stress: '压力大', irrit: '感到易怒' },
      c0: '{what}：未服用的 {n} 天中有 {x} 天，服用的 {m} 天中有 {y} 天。',
      c1: '{what}：未服用后的第二天，{n} 天中有 {x} 天；服用后的第二天，{m} 天中有 {y} 天。',
      sleep1: '未服用那天之后的夜里，你大约睡了 {a}；服用那天之后大约睡了 {b}。',
      quality1: '睡眠评价为差：未服用之后的 {n} 个夜晚中有 {x} 个，服用之后的 {m} 个夜晚中有 {y} 个。',
      energy0: '未服用的日子里，你的精力平均为 {a}/10；服用的日子里为 {b}。',
      energy1: '未服用后的第二天，你的精力平均为 {a}/10；服用后的第二天为 {b}。',
      h: '{h} 小时', hm: '{h} 小时 {m} 分钟',
    },
  };
  Object.keys(S).forEach(function (code) { BB.i18n.extend(code, { medLink: build(S[code]) }); });
})();
