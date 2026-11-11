/**
 * Strings for "Several days missing" (James, 2026-11-03): opening the journal
 * with the current day AND at least one more day not logged asks whether to
 * ✨ auto-fill them all or ✍️ fill them in one at a time, and after each day
 * filled by hand asks whether to carry on with the next. After a quick
 * check-in (home bears / widget) the same question comes once its entry is
 * saved (`saved*`, 2026-11-11). js/journal.js (_mmMaybeAsk / _mmAfterSave). All ten languages (machine translated). Added
 * with BB.i18n.extend under the `missingDays` namespace. Loaded on
 * journal.html.
 *
 * @file js/shared/i18n-missing.js
 */
(function () {
  'use strict';
  if (!window.BB || !BB.i18n || !BB.i18n.extend) return;
  var S = {
    en: {
      "title": "{count} entries missing",
      "body": "You haven't logged {count} days, the latest {date}. Fill them all in at once, or one day at a time?",
      "auto": "✨ Auto-fill all",
      "autoSub": "Sleep and steps from your phone's health app where it has them, your typical day where it doesn't. You check every day before anything is saved.",
      "manual": "✍️ Fill them in myself",
      "manualSub": "One day at a time, starting with {date}.",
      "later": "Not now",
      "nextTitle": "Saved. {count} more to go",
      "nextOne": "Saved. 1 more to go",
      "nextBody": "Carry on with {date}, or stop there? The rest stay under Missing entries.",
      "next": "✍️ Continue with {date}",
      "stop": "Stop there",
      "savedTitle": "Saved. {count} earlier days are missing",
      "savedOne": "Saved. 1 earlier day is missing",
      "savedBody": "The latest is {date}. Fill them all in at once, or one day at a time?",
      "savedBodyOne": "{date} isn't logged yet. Fill it in now?"
    },
    es: {
      "title": "Faltan {count} entradas",
      "body": "No has registrado {count} días, el más reciente {date}. ¿Los rellenas todos a la vez o día a día?",
      "auto": "✨ Rellenar todos automáticamente",
      "autoSub": "El sueño y los pasos de la app de salud de tu móvil cuando los tiene, y tu día habitual cuando no. Revisas cada día antes de guardar nada.",
      "manual": "✍️ Rellenarlos yo",
      "manualSub": "Un día cada vez, empezando por {date}.",
      "later": "Ahora no",
      "nextTitle": "Guardado. Faltan {count}",
      "nextOne": "Guardado. Falta 1",
      "nextBody": "¿Sigues con {date} o lo dejas aquí? Los demás siguen en Entradas que faltan.",
      "next": "✍️ Seguir con {date}",
      "stop": "Dejarlo aquí",
      "savedTitle": "Guardado. Faltan {count} días anteriores",
      "savedOne": "Guardado. Falta 1 día anterior",
      "savedBody": "El más reciente es {date}. ¿Los rellenas todos a la vez o día a día?",
      "savedBodyOne": "{date} aún no está registrado. ¿Lo rellenas ahora?"
    },
    fr: {
      "title": "{count} entrées manquantes",
      "body": "Vous n'avez rien noté pendant {count} jours, le plus récent {date}. Tout remplir d'un coup, ou un jour à la fois ?",
      "auto": "✨ Tout remplir automatiquement",
      "autoSub": "Le sommeil et les pas de l'app santé de votre téléphone quand elle les a, votre journée habituelle sinon. Vous vérifiez chaque jour avant tout enregistrement.",
      "manual": "✍️ Les remplir moi-même",
      "manualSub": "Un jour à la fois, en commençant par {date}.",
      "later": "Pas maintenant",
      "nextTitle": "Enregistré. Encore {count}",
      "nextOne": "Enregistré. Encore 1",
      "nextBody": "Continuer avec {date}, ou s'arrêter là ? Les autres restent dans Entrées manquantes.",
      "next": "✍️ Continuer avec {date}",
      "stop": "M'arrêter là",
      "savedTitle": "Enregistré. {count} jours précédents manquent",
      "savedOne": "Enregistré. 1 jour précédent manque",
      "savedBody": "Le plus récent est {date}. Tout remplir d'un coup, ou un jour à la fois ?",
      "savedBodyOne": "{date} n'est pas encore noté. Le remplir maintenant ?"
    },
    de: {
      "title": "{count} Einträge fehlen",
      "body": "Du hast {count} Tage nicht eingetragen, zuletzt {date}. Alle auf einmal ausfüllen oder Tag für Tag?",
      "auto": "✨ Alle automatisch ausfüllen",
      "autoSub": "Schlaf und Schritte aus der Gesundheits-App deines Handys, wo vorhanden, sonst dein typischer Tag. Du prüfst jeden Tag, bevor etwas gespeichert wird.",
      "manual": "✍️ Selbst ausfüllen",
      "manualSub": "Tag für Tag, beginnend mit {date}.",
      "later": "Nicht jetzt",
      "nextTitle": "Gespeichert. Noch {count}",
      "nextOne": "Gespeichert. Noch 1",
      "nextBody": "Mit {date} weitermachen oder hier aufhören? Die übrigen bleiben unter Fehlende Einträge.",
      "next": "✍️ Weiter mit {date}",
      "stop": "Hier aufhören",
      "savedTitle": "Gespeichert. {count} frühere Tage fehlen",
      "savedOne": "Gespeichert. 1 früherer Tag fehlt",
      "savedBody": "Zuletzt {date}. Alle auf einmal ausfüllen oder Tag für Tag?",
      "savedBodyOne": "{date} ist noch nicht eingetragen. Jetzt ausfüllen?"
    },
    it: {
      "title": "Mancano {count} voci",
      "body": "Non hai registrato {count} giorni, il più recente {date}. Li compili tutti insieme o un giorno alla volta?",
      "auto": "✨ Compila tutti automaticamente",
      "autoSub": "Sonno e passi dall'app salute del telefono quando li ha, la tua giornata tipica quando no. Controlli ogni giorno prima che venga salvato qualcosa.",
      "manual": "✍️ Li compilo io",
      "manualSub": "Un giorno alla volta, a partire da {date}.",
      "later": "Non ora",
      "nextTitle": "Salvato. Ne mancano {count}",
      "nextOne": "Salvato. Ne manca 1",
      "nextBody": "Continui con {date} o ti fermi qui? Gli altri restano in Voci mancanti.",
      "next": "✍️ Continua con {date}",
      "stop": "Fermati qui",
      "savedTitle": "Salvato. Mancano {count} giorni precedenti",
      "savedOne": "Salvato. Manca 1 giorno precedente",
      "savedBody": "Il più recente è {date}. Li compili tutti insieme o un giorno alla volta?",
      "savedBodyOne": "{date} non è ancora registrato. Lo compili ora?"
    },
    pt: {
      "title": "Faltam {count} registos",
      "body": "Não registaste {count} dias, o mais recente {date}. Preenches todos de uma vez ou um dia de cada vez?",
      "auto": "✨ Preencher todos automaticamente",
      "autoSub": "O sono e os passos da app de saúde do telemóvel quando os tem, o teu dia habitual quando não. Revês cada dia antes de algo ser guardado.",
      "manual": "✍️ Preenchê-los eu",
      "manualSub": "Um dia de cada vez, a começar por {date}.",
      "later": "Agora não",
      "nextTitle": "Guardado. Faltam {count}",
      "nextOne": "Guardado. Falta 1",
      "nextBody": "Continuar com {date} ou parar aqui? Os outros ficam em Registos em falta.",
      "next": "✍️ Continuar com {date}",
      "stop": "Parar aqui",
      "savedTitle": "Guardado. Faltam {count} dias anteriores",
      "savedOne": "Guardado. Falta 1 dia anterior",
      "savedBody": "O mais recente é {date}. Preenches todos de uma vez ou um dia de cada vez?",
      "savedBodyOne": "{date} ainda não está registado. Preenches agora?"
    },
    nl: {
      "title": "{count} invoeren ontbreken",
      "body": "Je hebt {count} dagen niets ingevuld, de laatste {date}. Alles in één keer invullen of dag voor dag?",
      "auto": "✨ Alles automatisch invullen",
      "autoSub": "Slaap en stappen uit de gezondheidsapp van je telefoon waar die ze heeft, anders je gewone dag. Je controleert elke dag voordat er iets wordt opgeslagen.",
      "manual": "✍️ Zelf invullen",
      "manualSub": "Dag voor dag, te beginnen met {date}.",
      "later": "Niet nu",
      "nextTitle": "Opgeslagen. Nog {count}",
      "nextOne": "Opgeslagen. Nog 1",
      "nextBody": "Doorgaan met {date} of hier stoppen? De rest blijft onder Ontbrekende invoeren.",
      "next": "✍️ Verder met {date}",
      "stop": "Hier stoppen",
      "savedTitle": "Opgeslagen. {count} eerdere dagen ontbreken",
      "savedOne": "Opgeslagen. 1 eerdere dag ontbreekt",
      "savedBody": "De laatste is {date}. Alles in één keer invullen of dag voor dag?",
      "savedBodyOne": "{date} is nog niet ingevuld. Nu invullen?"
    },
    pl: {
      "title": "Brakuje {count} wpisów",
      "body": "Nie masz wpisów z {count} dni, ostatnio {date}. Uzupełnić wszystkie naraz czy dzień po dniu?",
      "auto": "✨ Uzupełnij wszystkie automatycznie",
      "autoSub": "Sen i kroki z aplikacji zdrowia w telefonie, jeśli je ma, a jeśli nie, Twój typowy dzień. Sprawdzasz każdy dzień, zanim cokolwiek zostanie zapisane.",
      "manual": "✍️ Uzupełnię sam(a)",
      "manualSub": "Dzień po dniu, zaczynając od {date}.",
      "later": "Nie teraz",
      "nextTitle": "Zapisano. Zostało {count}",
      "nextOne": "Zapisano. Został 1",
      "nextBody": "Kontynuować z {date} czy na tym skończyć? Pozostałe zostaną w Brakujących wpisach.",
      "next": "✍️ Dalej: {date}",
      "stop": "Na tym skończę",
      "savedTitle": "Zapisano. Brakuje {count} wcześniejszych dni",
      "savedOne": "Zapisano. Brakuje 1 wcześniejszego dnia",
      "savedBody": "Ostatnio {date}. Uzupełnić wszystkie naraz czy dzień po dniu?",
      "savedBodyOne": "Brak wpisu z {date}. Uzupełnić teraz?"
    },
    sv: {
      "title": "{count} anteckningar saknas",
      "body": "Du har inte loggat {count} dagar, senast {date}. Fyll i alla på en gång eller en dag i taget?",
      "auto": "✨ Fyll i alla automatiskt",
      "autoSub": "Sömn och steg från telefonens hälsoapp där den har dem, annars din vanliga dag. Du kontrollerar varje dag innan något sparas.",
      "manual": "✍️ Fyll i dem själv",
      "manualSub": "En dag i taget, med början {date}.",
      "later": "Inte nu",
      "nextTitle": "Sparat. {count} kvar",
      "nextOne": "Sparat. 1 kvar",
      "nextBody": "Fortsätta med {date} eller sluta här? Resten finns kvar under Saknade anteckningar.",
      "next": "✍️ Fortsätt med {date}",
      "stop": "Sluta här",
      "savedTitle": "Sparat. {count} tidigare dagar saknas",
      "savedOne": "Sparat. 1 tidigare dag saknas",
      "savedBody": "Senast {date}. Fyll i alla på en gång eller en dag i taget?",
      "savedBodyOne": "{date} är inte loggad än. Fyll i nu?"
    },
    zh: {
      "title": "缺少 {count} 条记录",
      "body": "你有 {count} 天没有记录，最近的是 {date}。一次全部填写，还是一天一天来？",
      "auto": "✨ 全部自动填写",
      "autoSub": "睡眠和步数取自手机的健康应用（如有），否则使用你的典型一天。保存前你会逐天检查。",
      "manual": "✍️ 我自己填写",
      "manualSub": "一天一天来，从 {date} 开始。",
      "later": "以后再说",
      "nextTitle": "已保存。还剩 {count} 天",
      "nextOne": "已保存。还剩 1 天",
      "nextBody": "继续填写 {date}，还是到此为止？其余的会留在「缺失的记录」中。",
      "next": "✍️ 继续填写 {date}",
      "stop": "到此为止",
      "savedTitle": "已保存。之前还有 {count} 天没有记录",
      "savedOne": "已保存。之前还有 1 天没有记录",
      "savedBody": "最近的是 {date}。一次全部填写，还是一天一天来？",
      "savedBodyOne": "{date} 还没有记录。现在填写吗？"
    }
  };
  Object.keys(S).forEach(function (code) { BB.i18n.extend(code, { missingDays: S[code] }); });
})();
