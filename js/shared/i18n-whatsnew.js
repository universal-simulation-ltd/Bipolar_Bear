/**
 * Strings for the New features sheet (js/shared/whats-new.js, v358) and
 * Bipolar Bear's 1.44 entry, in all ten languages. Added with
 * BB.i18n.extend under the `whatsnew` namespace. Loaded on index.html and
 * journal.html. The Face ID row reuses bio144.* (i18n.js).
 *
 * @file js/shared/i18n-whatsnew.js
 */
(function () {
  'use strict';
  if (!window.BB || !BB.i18n || !BB.i18n.extend) return;
  var S = {
    en: {"title": "New features", "newIn": "New in {v}", "changeLater": "You can change these any time in Settings.", "done": "Done", "b144BloodTitle": "Blood results on my charts", "b144BloodBody": "Show your blood test results on your mood charts.", "b144MoodTitle": "Mood buttons on the reminder", "b144MoodBody": "Tap a mood on the daily reminder to log it without opening the app."},
    es: {"title": "Novedades", "newIn": "Nuevo en la {v}", "changeLater": "Puedes cambiar esto cuando quieras en Ajustes.", "done": "Hecho", "b144BloodTitle": "Análisis de sangre en mis gráficos", "b144BloodBody": "Muestra los resultados de tus análisis de sangre en tus gráficos de ánimo.", "b144MoodTitle": "Botones de ánimo en el recordatorio", "b144MoodBody": "Toca un ánimo en el recordatorio diario para registrarlo sin abrir la app."},
    fr: {"title": "Nouveautés", "newIn": "Nouveau dans la {v}", "changeLater": "Tu peux changer ça à tout moment dans les Réglages.", "done": "Terminé", "b144BloodTitle": "Analyses de sang sur mes graphiques", "b144BloodBody": "Affiche les résultats de tes analyses de sang sur tes graphiques d’humeur.", "b144MoodTitle": "Boutons d’humeur sur le rappel", "b144MoodBody": "Touche une humeur sur le rappel du jour pour l’enregistrer sans ouvrir l’app."},
    de: {"title": "Neue Funktionen", "newIn": "Neu in {v}", "changeLater": "Du kannst das jederzeit in den Einstellungen ändern.", "done": "Fertig", "b144BloodTitle": "Blutwerte in meinen Diagrammen", "b144BloodBody": "Zeig deine Blutwerte in deinen Stimmungsdiagrammen.", "b144MoodTitle": "Stimmungstasten an der Erinnerung", "b144MoodBody": "Tippe auf eine Stimmung in der täglichen Erinnerung, um sie einzutragen, ohne die App zu öffnen."},
    it: {"title": "Novità", "newIn": "Novità della {v}", "changeLater": "Puoi cambiarle quando vuoi nelle Impostazioni.", "done": "Fatto", "b144BloodTitle": "Esami del sangue nei miei grafici", "b144BloodBody": "Mostra i risultati dei tuoi esami del sangue nei grafici dell’umore.", "b144MoodTitle": "Pulsanti dell’umore nel promemoria", "b144MoodBody": "Tocca un umore nel promemoria giornaliero per registrarlo senza aprire l’app."},
    pt: {"title": "Novidades", "newIn": "Novo na {v}", "changeLater": "Podes mudar isto quando quiseres nas Definições.", "done": "Concluído", "b144BloodTitle": "Análises ao sangue nos meus gráficos", "b144BloodBody": "Mostra os resultados das tuas análises ao sangue nos teus gráficos de humor.", "b144MoodTitle": "Botões de humor no lembrete", "b144MoodBody": "Toca num humor no lembrete diário para o registar sem abrir a app."},
    nl: {"title": "Nieuwe functies", "newIn": "Nieuw in {v}", "changeLater": "Je kunt dit altijd wijzigen in Instellingen.", "done": "Klaar", "b144BloodTitle": "Bloeduitslagen in mijn grafieken", "b144BloodBody": "Toon je bloeduitslagen in je stemmingsgrafieken.", "b144MoodTitle": "Stemmingsknoppen op de herinnering", "b144MoodBody": "Tik op een stemming in de dagelijkse herinnering om die vast te leggen zonder de app te openen."},
    pl: {"title": "Nowe funkcje", "newIn": "Nowość w {v}", "changeLater": "Możesz to zmienić w każdej chwili w Ustawieniach.", "done": "Gotowe", "b144BloodTitle": "Wyniki krwi na moich wykresach", "b144BloodBody": "Pokazuj wyniki badań krwi na wykresach nastroju.", "b144MoodTitle": "Przyciski nastroju w przypomnieniu", "b144MoodBody": "Stuknij nastrój w codziennym przypomnieniu, by go zapisać bez otwierania aplikacji."},
    sv: {"title": "Nya funktioner", "newIn": "Nytt i {v}", "changeLater": "Du kan ändra detta när du vill i Inställningar.", "done": "Klar", "b144BloodTitle": "Blodprover i mina diagram", "b144BloodBody": "Visa dina blodprovsresultat i dina humördiagram.", "b144MoodTitle": "Humörknappar på påminnelsen", "b144MoodBody": "Tryck på ett humör i den dagliga påminnelsen för att logga det utan att öppna appen."},
    zh: {"title": "新功能", "newIn": "{v} 版新增", "changeLater": "你随时可以在设置中更改这些。", "done": "完成", "b144BloodTitle": "在图表上显示验血结果", "b144BloodBody": "在心情图表上显示你的验血结果。", "b144MoodTitle": "提醒中的心情按钮", "b144MoodBody": "在每日提醒中点一个心情即可记录，无需打开应用。"},
  };
  Object.keys(S).forEach(function (code) { BB.i18n.extend(code, { whatsnew: S[code] }); });
})();
