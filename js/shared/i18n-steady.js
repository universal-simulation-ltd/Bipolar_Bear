/**
 * Strings for the older Personalised feedback cards, scored by distance from
 * stable (2026-11-26): sleep → next-day mood, medication, steps, exercise and
 * getting outside now say "closer to stable", never "higher", so an elevated
 * day is never good news; plus the new 🛏️ sleep quality card. computeInsights
 * in js/journal.js (DOCS.md §2.36). All ten languages (machine translated).
 * Added with BB.i18n.extend under the `steady` namespace. Loaded on journal.html.
 *
 * {d} is a difference in points on the 1–5 mood scale, measured as distance
 * from stable (3). {a} / {b} are day counts. Polish avoids gendered past-tense
 * verbs, as the other journal strings do.
 *
 * @file js/shared/i18n-steady.js
 */
(function () {
  'use strict';
  if (!window.BB || !BB.i18n || !BB.i18n.extend) return;

  var S = {
    en: {
      sleepMoodSteady: 'A {strength} relationship (r = {r}): after more sleep, your mood the next day tends to be closer to stable.',
      sleepMoodUnsteady: 'A {strength} relationship (r = {r}): after more sleep, your mood the next day tends to be further from stable — worth watching.',
      medSteady: 'On days you took your medication, your mood was {d} pts closer to stable on average ({a} days taken, {b} not taken).',
      medUnsteady: 'On days medication was missed, your mood was {d} pts closer to stable on average ({a} days taken, {b} not taken) — worth mentioning to your doctor.',
      medSame: 'Your mood was about as close to stable whether or not medication was taken (difference: {d} pts). Longer-term consistency may matter more.',
      stepsSteady: 'A {strength} relationship (r = {r}): on days with more steps, your mood tends to be closer to stable.',
      exerciseSteady: 'On days you exercised, your mood was {d} pts closer to stable on average ({a} exercise days, {b} without).',
      outsideSteady: 'On days you got outside, your mood was {d} pts closer to stable on average ({a} days outside, {b} in).',
      sqTitle: 'Sleep Quality & Mood',
      sqText: 'After a night you rated poor, your mood was {d} pts further from stable on average than after a good night ({a} poor nights, {b} good).',
      note: 'Closer to stable is the goal here: an elevated day counts as far from stable, just like a low one.',
    },
    es: {
      sleepMoodSteady: 'Una relación {strength} (r = {r}): después de dormir más, tu estado de ánimo del día siguiente tiende a estar más cerca de estable.',
      sleepMoodUnsteady: 'Una relación {strength} (r = {r}): después de dormir más, tu estado de ánimo del día siguiente tiende a estar más lejos de estable; conviene vigilarlo.',
      medSteady: 'Los días que tomaste tu medicación, tu estado de ánimo estuvo de media {d} pts más cerca de estable ({a} días tomada, {b} sin tomar).',
      medUnsteady: 'Los días que no tomaste la medicación, tu estado de ánimo estuvo de media {d} pts más cerca de estable ({a} días tomada, {b} sin tomar); conviene comentarlo con tu médico.',
      medSame: 'Tu estado de ánimo estuvo igual de cerca de estable tomaras o no la medicación (diferencia: {d} pts). La constancia a largo plazo puede importar más.',
      stepsSteady: 'Una relación {strength} (r = {r}): los días con más pasos, tu estado de ánimo tiende a estar más cerca de estable.',
      exerciseSteady: 'Los días que hiciste ejercicio, tu estado de ánimo estuvo de media {d} pts más cerca de estable ({a} días con ejercicio, {b} sin él).',
      outsideSteady: 'Los días que saliste al aire libre, tu estado de ánimo estuvo de media {d} pts más cerca de estable ({a} días fuera, {b} dentro).',
      sqTitle: 'Calidad del sueño y estado de ánimo',
      sqText: 'Después de una noche que valoraste como mala, tu estado de ánimo estuvo de media {d} pts más lejos de estable que después de una buena noche ({a} noches malas, {b} buenas).',
      note: 'Aquí el objetivo es estar más cerca de estable: un día eufórico cuenta como lejos de estable, igual que uno bajo.',
    },
    fr: {
      sleepMoodSteady: 'Une relation {strength} (r = {r}) : après plus de sommeil, ton humeur du lendemain a tendance à être plus proche de stable.',
      sleepMoodUnsteady: 'Une relation {strength} (r = {r}) : après plus de sommeil, ton humeur du lendemain a tendance à être plus éloignée de stable — à surveiller.',
      medSteady: 'Les jours où tu as pris ton traitement, ton humeur était en moyenne {d} pts plus proche de stable ({a} jours pris, {b} non pris).',
      medUnsteady: 'Les jours où le traitement a été oublié, ton humeur était en moyenne {d} pts plus proche de stable ({a} jours pris, {b} non pris) — à mentionner à ton médecin.',
      medSame: 'Ton humeur était à peu près aussi proche de stable, que le traitement ait été pris ou non (écart : {d} pts). La régularité sur le long terme compte peut-être davantage.',
      stepsSteady: 'Une relation {strength} (r = {r}) : les jours avec plus de pas, ton humeur a tendance à être plus proche de stable.',
      exerciseSteady: 'Les jours où tu as fait du sport, ton humeur était en moyenne {d} pts plus proche de stable ({a} jours de sport, {b} sans).',
      outsideSteady: 'Les jours où tu es sorti·e dehors, ton humeur était en moyenne {d} pts plus proche de stable ({a} jours dehors, {b} à l’intérieur).',
      sqTitle: 'Qualité du sommeil et humeur',
      sqText: 'Après une nuit que tu as jugée mauvaise, ton humeur était en moyenne {d} pts plus éloignée de stable qu’après une bonne nuit ({a} mauvaises nuits, {b} bonnes).',
      note: 'Ici, le but est d’être plus proche de stable : un jour exalté compte comme éloigné de stable, tout comme un jour bas.',
    },
    de: {
      sleepMoodSteady: 'Zusammenhang ({strength}, r = {r}): Nach mehr Schlaf ist deine Stimmung am nächsten Tag meist näher an stabil.',
      sleepMoodUnsteady: 'Zusammenhang ({strength}, r = {r}): Nach mehr Schlaf ist deine Stimmung am nächsten Tag meist weiter von stabil entfernt – im Blick behalten.',
      medSteady: 'An Tagen, an denen du deine Medikamente genommen hast, war deine Stimmung im Schnitt {d} Pkt. näher an stabil ({a} Tage genommen, {b} nicht genommen).',
      medUnsteady: 'An Tagen ohne Medikamente war deine Stimmung im Schnitt {d} Pkt. näher an stabil ({a} Tage genommen, {b} nicht genommen) – sprich das bei deiner Ärztin oder deinem Arzt an.',
      medSame: 'Deine Stimmung war etwa gleich nah an stabil, ob die Medikamente genommen wurden oder nicht (Unterschied: {d} Pkt.). Langfristige Regelmäßigkeit zählt vielleicht mehr.',
      stepsSteady: 'Zusammenhang ({strength}, r = {r}): An Tagen mit mehr Schritten ist deine Stimmung meist näher an stabil.',
      exerciseSteady: 'An Tagen mit Sport war deine Stimmung im Schnitt {d} Pkt. näher an stabil ({a} Tage mit Sport, {b} ohne).',
      outsideSteady: 'An Tagen, an denen du draußen warst, war deine Stimmung im Schnitt {d} Pkt. näher an stabil ({a} Tage draußen, {b} drinnen).',
      sqTitle: 'Schlafqualität & Stimmung',
      sqText: 'Nach einer Nacht, die du als schlecht bewertet hast, war deine Stimmung im Schnitt {d} Pkt. weiter von stabil entfernt als nach einer guten Nacht ({a} schlechte Nächte, {b} gute).',
      note: 'Ziel ist hier, näher an stabil zu sein: Ein gehobener Tag zählt als weit von stabil entfernt, genau wie ein niedergeschlagener.',
    },
    it: {
      sleepMoodSteady: 'Una relazione {strength} (r = {r}): dopo aver dormito di più, il tuo umore del giorno dopo tende a essere più vicino a stabile.',
      sleepMoodUnsteady: 'Una relazione {strength} (r = {r}): dopo aver dormito di più, il tuo umore del giorno dopo tende a essere più lontano da stabile: da tenere d’occhio.',
      medSteady: 'Nei giorni in cui hai preso i farmaci, il tuo umore è stato in media {d} pt più vicino a stabile ({a} giorni presi, {b} non presi).',
      medUnsteady: 'Nei giorni in cui i farmaci sono stati saltati, il tuo umore è stato in media {d} pt più vicino a stabile ({a} giorni presi, {b} non presi): vale la pena parlarne con il medico.',
      medSame: 'Il tuo umore è stato vicino a stabile più o meno allo stesso modo, che i farmaci fossero presi o no (differenza: {d} pt). La costanza nel lungo periodo può contare di più.',
      stepsSteady: 'Una relazione {strength} (r = {r}): nei giorni con più passi, il tuo umore tende a essere più vicino a stabile.',
      exerciseSteady: 'Nei giorni in cui hai fatto esercizio, il tuo umore è stato in media {d} pt più vicino a stabile ({a} giorni con esercizio, {b} senza).',
      outsideSteady: 'Nei giorni in cui sei uscito all’aperto, il tuo umore è stato in media {d} pt più vicino a stabile ({a} giorni fuori, {b} dentro).',
      sqTitle: 'Qualità del sonno e umore',
      sqText: 'Dopo una notte che hai valutato scarsa, il tuo umore è stato in media {d} pt più lontano da stabile rispetto a dopo una buona notte ({a} notti scarse, {b} buone).',
      note: 'Qui l’obiettivo è essere più vicino a stabile: un giorno euforico conta come lontano da stabile, proprio come uno giù.',
    },
    pt: {
      sleepMoodSteady: 'Uma relação {strength} (r = {r}): depois de dormir mais, o teu humor no dia seguinte tende a ficar mais perto de estável.',
      sleepMoodUnsteady: 'Uma relação {strength} (r = {r}): depois de dormir mais, o teu humor no dia seguinte tende a ficar mais longe de estável — vale a pena observar.',
      medSteady: 'Nos dias em que tomaste a medicação, o teu humor esteve em média {d} pts mais perto de estável ({a} dias tomada, {b} não tomada).',
      medUnsteady: 'Nos dias em que a medicação falhou, o teu humor esteve em média {d} pts mais perto de estável ({a} dias tomada, {b} não tomada) — vale a pena falar disso com o teu médico.',
      medSame: 'O teu humor esteve quase tão perto de estável com ou sem a medicação (diferença: {d} pts). A regularidade a longo prazo pode contar mais.',
      stepsSteady: 'Uma relação {strength} (r = {r}): nos dias com mais passos, o teu humor tende a ficar mais perto de estável.',
      exerciseSteady: 'Nos dias em que fizeste exercício, o teu humor esteve em média {d} pts mais perto de estável ({a} dias com exercício, {b} sem).',
      outsideSteady: 'Nos dias em que saíste ao ar livre, o teu humor esteve em média {d} pts mais perto de estável ({a} dias fora, {b} dentro).',
      sqTitle: 'Qualidade do sono e humor',
      sqText: 'Depois de uma noite que avaliaste como má, o teu humor esteve em média {d} pts mais longe de estável do que depois de uma boa noite ({a} noites más, {b} boas).',
      note: 'Aqui o objetivo é ficar mais perto de estável: um dia eufórico conta como longe de estável, tal como um dia em baixo.',
    },
    nl: {
      sleepMoodSteady: 'Verband ({strength}, r = {r}): na meer slaap ligt je stemming de volgende dag meestal dichter bij stabiel.',
      sleepMoodUnsteady: 'Verband ({strength}, r = {r}): na meer slaap ligt je stemming de volgende dag meestal verder van stabiel — goed om in de gaten te houden.',
      medSteady: 'Op dagen dat je je medicatie nam, lag je stemming gemiddeld {d} ptn dichter bij stabiel ({a} dagen genomen, {b} niet genomen).',
      medUnsteady: 'Op dagen dat je medicatie oversloeg, lag je stemming gemiddeld {d} ptn dichter bij stabiel ({a} dagen genomen, {b} niet genomen) — goed om met je arts te bespreken.',
      medSame: 'Je stemming lag ongeveer even dicht bij stabiel, of je medicatie nu nam of niet (verschil: {d} ptn). Regelmaat op de lange termijn telt misschien meer.',
      stepsSteady: 'Verband ({strength}, r = {r}): op dagen met meer stappen ligt je stemming meestal dichter bij stabiel.',
      exerciseSteady: 'Op dagen dat je sportte, lag je stemming gemiddeld {d} ptn dichter bij stabiel ({a} sportdagen, {b} zonder).',
      outsideSteady: 'Op dagen dat je buiten kwam, lag je stemming gemiddeld {d} ptn dichter bij stabiel ({a} dagen buiten, {b} binnen).',
      sqTitle: 'Slaapkwaliteit & stemming',
      sqText: 'Na een nacht die je slecht vond, lag je stemming gemiddeld {d} ptn verder van stabiel dan na een goede nacht ({a} slechte nachten, {b} goede).',
      note: 'Dichter bij stabiel is hier het doel: een opgetogen dag telt als ver van stabiel, net als een sombere.',
    },
    pl: {
      sleepMoodSteady: 'Związek ({strength}, r = {r}): po dłuższym śnie nastrój następnego dnia jest zwykle bliżej stabilnego.',
      sleepMoodUnsteady: 'Związek ({strength}, r = {r}): po dłuższym śnie nastrój następnego dnia jest zwykle dalej od stabilnego — warto to obserwować.',
      medSteady: 'W dni z przyjętymi lekami nastrój był średnio o {d} pkt bliżej stabilnego ({a} dni z lekami, {b} bez).',
      medUnsteady: 'W dni bez leków nastrój był średnio o {d} pkt bliżej stabilnego ({a} dni z lekami, {b} bez) — warto powiedzieć o tym lekarzowi.',
      medSame: 'Nastrój był mniej więcej tak samo blisko stabilnego z lekami i bez nich (różnica: {d} pkt). Regularność w dłuższym czasie może mieć większe znaczenie.',
      stepsSteady: 'Związek ({strength}, r = {r}): w dni z większą liczbą kroków nastrój jest zwykle bliżej stabilnego.',
      exerciseSteady: 'W dni z ćwiczeniami nastrój był średnio o {d} pkt bliżej stabilnego ({a} dni z ćwiczeniami, {b} bez).',
      outsideSteady: 'W dni spędzone częściowo na zewnątrz nastrój był średnio o {d} pkt bliżej stabilnego ({a} dni na zewnątrz, {b} w domu).',
      sqTitle: 'Jakość snu i nastrój',
      sqText: 'Po nocy ocenionej jako słaba nastrój był średnio o {d} pkt dalej od stabilnego niż po dobrej nocy ({a} słabe noce, {b} dobre).',
      note: 'Celem jest tu nastrój bliżej stabilnego: dzień podwyższonego nastroju liczy się jako daleki od stabilnego, tak samo jak dzień obniżonego.',
    },
    sv: {
      sleepMoodSteady: 'Ett {strength} samband (r = {r}): efter mer sömn brukar ditt humör nästa dag ligga närmare stabilt.',
      sleepMoodUnsteady: 'Ett {strength} samband (r = {r}): efter mer sömn brukar ditt humör nästa dag ligga längre från stabilt – värt att hålla koll på.',
      medSteady: 'De dagar du tog din medicin låg ditt humör i snitt {d} p närmare stabilt ({a} dagar tagen, {b} inte tagen).',
      medUnsteady: 'De dagar medicinen missades låg ditt humör i snitt {d} p närmare stabilt ({a} dagar tagen, {b} inte tagen) – värt att ta upp med din läkare.',
      medSame: 'Ditt humör låg ungefär lika nära stabilt oavsett om medicinen togs eller inte (skillnad: {d} p). Regelbundenhet på längre sikt kan betyda mer.',
      stepsSteady: 'Ett {strength} samband (r = {r}): dagar med fler steg brukar ditt humör ligga närmare stabilt.',
      exerciseSteady: 'De dagar du tränade låg ditt humör i snitt {d} p närmare stabilt ({a} träningsdagar, {b} utan).',
      outsideSteady: 'De dagar du kom ut låg ditt humör i snitt {d} p närmare stabilt ({a} dagar ute, {b} inne).',
      sqTitle: 'Sömnkvalitet & humör',
      sqText: 'Efter en natt du bedömde som dålig låg ditt humör i snitt {d} p längre från stabilt än efter en bra natt ({a} dåliga nätter, {b} bra).',
      note: 'Målet här är att ligga närmare stabilt: en uppvarvad dag räknas som långt från stabilt, precis som en nedstämd.',
    },
    zh: {
      sleepMoodSteady: '{strength}相关（r = {r}）：睡得更多之后，你第二天的情绪往往更接近稳定。',
      sleepMoodUnsteady: '{strength}相关（r = {r}）：睡得更多之后，你第二天的情绪往往更偏离稳定——值得留意。',
      medSteady: '服药的日子里，你的情绪平均更接近稳定 {d} 分（服药 {a} 天，未服药 {b} 天）。',
      medUnsteady: '漏服药物的日子里，你的情绪平均更接近稳定 {d} 分（服药 {a} 天，未服药 {b} 天）——值得告诉你的医生。',
      medSame: '无论是否服药，你的情绪与稳定的距离都差不多（差异：{d} 分）。长期的规律可能更重要。',
      stepsSteady: '{strength}相关（r = {r}）：步数更多的日子里，你的情绪往往更接近稳定。',
      exerciseSteady: '运动的日子里，你的情绪平均更接近稳定 {d} 分（运动 {a} 天，未运动 {b} 天）。',
      outsideSteady: '外出的日子里，你的情绪平均更接近稳定 {d} 分（外出 {a} 天，待在室内 {b} 天）。',
      sqTitle: '睡眠质量与情绪',
      sqText: '在你评为睡得差的夜晚之后，你的情绪平均比睡得好之后更偏离稳定 {d} 分（睡得差 {a} 晚，睡得好 {b} 晚）。',
      note: '这里的目标是更接近稳定：情绪高涨的日子和低落的日子一样，都算偏离稳定。',
    },
  };
  Object.keys(S).forEach(function (code) { BB.i18n.extend(code, { steady: S[code] }); });
})();
