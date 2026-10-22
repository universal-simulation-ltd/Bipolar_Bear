/**
 * Strings for Settings → Account → Change journal password (js/journal.js
 * _changeJournalPassword, 1.45), in all ten languages (machine translated).
 * Added with BB.i18n.extend under the `jpw145` namespace. Loaded on
 * journal.html only (the only page that can re-wrap the journal key). The
 * password boxes' other words reuse journalKey.* (i18n.js).
 *
 * @file js/shared/i18n-journalpw.js
 */
(function () {
  'use strict';
  if (!window.BB || !BB.i18n || !BB.i18n.extend) return;
  var S = {
    en: {
      "btn": "🔑 Change journal password",
      "title": "🔑 Change journal password",
      "body": "This is the password that opens your journal, not the one you sign in with. Type the one you use now, then the new one. Your entries stay exactly as they are.",
      "current": "Current journal password",
      "noteStandard": "Your journal is Standard, so it still opens on your signed-in devices without this password.",
      "same": "The new password is the same as the current one.",
      "changedElsewhere": "Your journal password was just changed on another device. Close this and try again.",
      "offline": "Couldn't change it. Check your connection and try again. Nothing was changed.",
      "done": "✅ Journal password changed. Use the new one from now on, on every device.",
      "save": "Change password"
    },
    es: {
      "btn": "🔑 Cambiar la contraseña del diario",
      "title": "🔑 Cambiar la contraseña del diario",
      "body": "Es la contraseña que abre tu diario, no la que usas para iniciar sesión. Escribe la que usas ahora y luego la nueva. Tus entradas se quedan exactamente igual.",
      "current": "Contraseña actual del diario",
      "noteStandard": "Tu diario es Estándar, así que se sigue abriendo en tus dispositivos con sesión iniciada sin esta contraseña.",
      "same": "La contraseña nueva es igual que la actual.",
      "changedElsewhere": "La contraseña del diario se acaba de cambiar en otro dispositivo. Cierra esto y vuelve a intentarlo.",
      "offline": "No se ha podido cambiar. Comprueba la conexión y vuelve a intentarlo. No se ha cambiado nada.",
      "done": "✅ Contraseña del diario cambiada. Usa la nueva a partir de ahora, en todos tus dispositivos.",
      "save": "Cambiar contraseña"
    },
    fr: {
      "btn": "🔑 Changer le mot de passe du journal",
      "title": "🔑 Changer le mot de passe du journal",
      "body": "C'est le mot de passe qui ouvre ton journal, pas celui de ta connexion. Tape celui que tu utilises maintenant, puis le nouveau. Tes entrées restent exactement comme elles sont.",
      "current": "Mot de passe actuel du journal",
      "noteStandard": "Ton journal est Standard : il s'ouvre toujours sur tes appareils connectés sans ce mot de passe.",
      "same": "Le nouveau mot de passe est le même que l'actuel.",
      "changedElsewhere": "Le mot de passe du journal vient d'être changé sur un autre appareil. Ferme cette fenêtre et réessaie.",
      "offline": "Impossible de le changer. Vérifie ta connexion et réessaie. Rien n'a été modifié.",
      "done": "✅ Mot de passe du journal changé. Utilise le nouveau désormais, sur tous tes appareils.",
      "save": "Changer le mot de passe"
    },
    de: {
      "btn": "🔑 Tagebuch-Passwort ändern",
      "title": "🔑 Tagebuch-Passwort ändern",
      "body": "Das ist das Passwort, das dein Tagebuch öffnet, nicht das zum Anmelden. Gib das jetzige ein, dann das neue. Deine Einträge bleiben genau, wie sie sind.",
      "current": "Jetziges Tagebuch-Passwort",
      "noteStandard": "Dein Tagebuch ist Standard: Es öffnet sich auf deinen angemeldeten Geräten weiterhin ohne dieses Passwort.",
      "same": "Das neue Passwort ist dasselbe wie das jetzige.",
      "changedElsewhere": "Dein Tagebuch-Passwort wurde gerade auf einem anderen Gerät geändert. Schließe dies und versuche es erneut.",
      "offline": "Ändern hat nicht geklappt. Prüfe deine Verbindung und versuche es erneut. Es wurde nichts geändert.",
      "done": "✅ Tagebuch-Passwort geändert. Nutze ab jetzt das neue, auf jedem Gerät.",
      "save": "Passwort ändern"
    },
    it: {
      "btn": "🔑 Cambia la password del diario",
      "title": "🔑 Cambia la password del diario",
      "body": "È la password che apre il tuo diario, non quella con cui accedi. Scrivi quella che usi ora, poi la nuova. Le tue voci restano esattamente come sono.",
      "current": "Password attuale del diario",
      "noteStandard": "Il tuo diario è Standard, quindi si apre comunque sui dispositivi in cui hai effettuato l'accesso, senza questa password.",
      "same": "La nuova password è uguale a quella attuale.",
      "changedElsewhere": "La password del diario è appena stata cambiata su un altro dispositivo. Chiudi e riprova.",
      "offline": "Impossibile cambiarla. Controlla la connessione e riprova. Non è stato cambiato nulla.",
      "done": "✅ Password del diario cambiata. D'ora in poi usa quella nuova, su ogni dispositivo.",
      "save": "Cambia password"
    },
    pt: {
      "btn": "🔑 Alterar a palavra-passe do diário",
      "title": "🔑 Alterar a palavra-passe do diário",
      "body": "É a palavra-passe que abre o teu diário, não a que usas para iniciar sessão. Escreve a que usas agora e depois a nova. As tuas entradas ficam exatamente como estão.",
      "current": "Palavra-passe atual do diário",
      "noteStandard": "O teu diário é Padrão, por isso continua a abrir nos teus dispositivos com sessão iniciada sem esta palavra-passe.",
      "same": "A nova palavra-passe é igual à atual.",
      "changedElsewhere": "A palavra-passe do diário acabou de ser alterada noutro dispositivo. Fecha isto e tenta novamente.",
      "offline": "Não foi possível alterá-la. Verifica a ligação e tenta novamente. Nada foi alterado.",
      "done": "✅ Palavra-passe do diário alterada. Usa a nova a partir de agora, em todos os dispositivos.",
      "save": "Alterar palavra-passe"
    },
    nl: {
      "btn": "🔑 Dagboekwachtwoord wijzigen",
      "title": "🔑 Dagboekwachtwoord wijzigen",
      "body": "Dit is het wachtwoord dat je dagboek opent, niet het wachtwoord waarmee je inlogt. Typ het huidige en daarna het nieuwe. Je notities blijven precies zoals ze zijn.",
      "current": "Huidig dagboekwachtwoord",
      "noteStandard": "Je dagboek is Standaard, dus het opent nog steeds op je ingelogde apparaten zonder dit wachtwoord.",
      "same": "Het nieuwe wachtwoord is hetzelfde als het huidige.",
      "changedElsewhere": "Je dagboekwachtwoord is net op een ander apparaat gewijzigd. Sluit dit en probeer het opnieuw.",
      "offline": "Wijzigen lukte niet. Controleer je verbinding en probeer het opnieuw. Er is niets gewijzigd.",
      "done": "✅ Dagboekwachtwoord gewijzigd. Gebruik vanaf nu het nieuwe, op elk apparaat.",
      "save": "Wachtwoord wijzigen"
    },
    pl: {
      "btn": "🔑 Zmień hasło dziennika",
      "title": "🔑 Zmień hasło dziennika",
      "body": "To hasło otwiera twój dziennik, to nie jest hasło do logowania. Wpisz obecne, a potem nowe. Twoje wpisy zostaną dokładnie takie, jakie są.",
      "current": "Obecne hasło dziennika",
      "noteStandard": "Twój dziennik jest Standardowy, więc nadal otwiera się na urządzeniach, na których jesteś zalogowany, bez tego hasła.",
      "same": "Nowe hasło jest takie samo jak obecne.",
      "changedElsewhere": "Hasło dziennika zostało właśnie zmienione na innym urządzeniu. Zamknij to okno i spróbuj ponownie.",
      "offline": "Nie udało się go zmienić. Sprawdź połączenie i spróbuj ponownie. Nic nie zostało zmienione.",
      "done": "✅ Hasło dziennika zmienione. Od teraz używaj nowego, na każdym urządzeniu.",
      "save": "Zmień hasło"
    },
    sv: {
      "btn": "🔑 Byt dagbokslösenord",
      "title": "🔑 Byt dagbokslösenord",
      "body": "Det här är lösenordet som öppnar din dagbok, inte det du loggar in med. Skriv det du använder nu och sedan det nya. Dina anteckningar förblir precis som de är.",
      "current": "Nuvarande dagbokslösenord",
      "noteStandard": "Din dagbok är Standard, så den öppnas fortfarande på dina inloggade enheter utan det här lösenordet.",
      "same": "Det nya lösenordet är samma som det nuvarande.",
      "changedElsewhere": "Ditt dagbokslösenord ändrades nyss på en annan enhet. Stäng det här och försök igen.",
      "offline": "Det gick inte att byta. Kontrollera anslutningen och försök igen. Inget har ändrats.",
      "done": "✅ Dagbokslösenordet är bytt. Använd det nya från och med nu, på alla enheter.",
      "save": "Byt lösenord"
    },
    zh: {
      "btn": "🔑 更改日记密码",
      "title": "🔑 更改日记密码",
      "body": "这是打开你日记的密码，不是登录密码。先输入现在的密码，再输入新密码。你的记录会保持原样。",
      "current": "当前日记密码",
      "noteStandard": "你的日记是标准模式，所以在已登录的设备上不需要这个密码也能打开。",
      "same": "新密码与当前密码相同。",
      "changedElsewhere": "你的日记密码刚刚在另一台设备上被更改。请关闭此窗口后重试。",
      "offline": "无法更改。请检查网络连接后重试。没有任何更改。",
      "done": "✅ 日记密码已更改。从现在起，请在所有设备上使用新密码。",
      "save": "更改密码"
    }
  };
  Object.keys(S).forEach(function (code) { BB.i18n.extend(code, { jpw145: S[code] }); });
})();
