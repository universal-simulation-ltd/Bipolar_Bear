# BipolarBear Changelog

> Note: releases 1.26 – 1.31 shipped without an entry here. The service-worker
> `CACHE_NAME` notes in `service-worker.js` (v179 – v199) are the record for
> that stretch.

## Next — after v1.40 (build 45)
- 🐻 **The bear checks in first on Bipolar Anonymous.** Each day starts with one check-in already there: the bear, with a random mood. So the first person to check in on a quiet day sees they aren't the only one. When the third real person checks in, the bear quietly leaves the totals; the count stays at 3 and doesn't drop. The bear's mood is kept apart from the real counts, so they stay true. (`CACHE_NAME` v274)
- 🆘 **Crisis help from the very first screen.** The dock, and the 🆘 Crisis Support button in it, stays hidden until the first journal entry, so someone arriving unwell had no way to a crisis line from home. Until the dock unlocks, home now shows the PIN lock screen's "🆘 Need help now?" pill under "Get started", opening the same sheet. The Bipolar Anonymous sign-up card gets "🛟 Need help now?" too, opening the board's Help sheet, which was only reachable from inside the board. (`CACHE_NAME` v272)
- 👋 **First-run copy says what the app is and what you need.** The welcome popup now reads "A private mood journal and survival kit for living with bipolar. You don't need an account: what you log stays on this device. Let's start with how yesterday went." The sign-in sheet says what an account adds ("Optional and free… backs up your journal, end-to-end encrypted… Anything you've logged so far comes with you."). The guest PIN screen says to pick a PIN you'll remember, because a forgotten one can't be recovered, "not even by us". All 10 languages. (`CACHE_NAME` v272)
- 🌐 **The guest PIN screen is translated all the way through.** Opening it, the confirm step ("Confirm your PIN") and the mismatch message were hardcoded English, so a French or German newcomer's first save switched to English halfway through. The Set PIN mismatch message is translated too. (`CACHE_NAME` v272)
- 💬 **The Anonymous sign-up card explains itself.** It said only "Verify your email to join the community". It now says what the board is ("A moderated peer-support community for people living with bipolar"), what anonymous means ("You post under a name you make up: no real name needed"), and what to do first ("enter your email and we'll send you a 6-digit code. Your email is never shown or shared."). All 10 languages. (`CACHE_NAME` v272)
- 🐻 **The mood wheel keeps your first swipe.** When health data arrived a second or so after the mood step opened, the step redrew and the wheel snapped back to the "best guess", so the first swipe was lost and the selector seemed to jump. It now stays wherever you'd swiped to. (`CACHE_NAME` v269)
- 🔐 **No more surprise PIN when your account is slow to reconnect.** On a slow connection, opening the app could take more than 4 seconds to restore your account, and the journal then treated you as signed out: saving asked for a new guest PIN and kept the entry on this phone only, so it never reached your account and the home streak didn't count it. The journal now waits up to 20 seconds for the account, a save made while it's still reconnecting waits for it, and if it still isn't back you're asked to try again rather than being given a guest PIN. Unchanged for real guests. All languages fall back to the English message for now. (`CACHE_NAME` v269)
- ✅ **The home "logged" tick stays ticked.** Its online check read each entry's date, which is inside the encrypted part of the entry, so every encrypted entry looked missing and the tick was cleared even though the journal showed the day as logged. It now reads the entry's plaintext timestamp. (`CACHE_NAME` v269)

## v1.40 — everything below until v1.39 (iOS submitted 2026-10-04)
- 📅 **Choose where your stats start.** Your Journey's last range button is now a custom range: "📅 All", or "📅 Jan 25" once a start date is picked. Choosing it shows "Start from [date] · Show all" under the range buttons, so someone can leave out a manic episode (or anything before a diagnosis) without deleting a thing. The tiles read "(since Jan 2025)", and the life chart and PDF follow. It's the same synced setting as Journal settings → All-Time Stats Start Date. All 10 languages. (`CACHE_NAME` v268, native build 45)
- ↔️ **The life chart shows it scrolls.** On a long range, an edge fade and a ‹ / › button appear on whichever side has more chart, and disappear at either end. The buttons step most of a screen at a time. (`CACHE_NAME` v268, native build 45)
- ⚖️ **Stability on Your Journey.** The first tile is now "71% Stability (3M)": the share of days in the range you logged as Stable, each day counted once by its latest entry. It replaces "Total Days", which counted entries rather than days (372/365 on 1Y when a day had two entries) and counted today, which someone logging yesterday can't log yet (89/90 with no gaps). A spectrum mood (0–10, e.g. "Stable (5)") counts by its band via `_moodCat`, as Most Common does (v267 fix: the first cut compared the raw value, so numeric Stable days counted as not stable). Tapping it still opens the tracked-days detail. All 10 languages. (`CACHE_NAME` v267, native build 44)
- 💬 **Your Bipolar Anonymous streak beside the journal streak.** The home card's "Last 7 days" line and the home-screen widget show "🔥 797  💬 63": the journal streak, then the Anonymous board visit streak (live only; it disappears the day after a missed visit, as `BB.anonLiveStreak()` decides), and only while the Bipolar Anonymous button is on the home page (`BB.anonButtonShown()`: home buttons unlocked and Profile → Customise has it on); switching the button off removes it from both at once. The widget gets it from `syncWidgetMoods` (`anonStreak`, `anonVisitDate`). (`CACHE_NAME` v265, native build 42)
- 🌐 **The widget speaks the phone's language.** It had no English localization, so a phone with German anywhere in its language list showed "LETZTE 7 TAGE" and German weekday letters beside English text. English is now a real localization, and the main widget's own lines ("✓ Yesterday is logged", "… needs logging", "N day streak") are translated into all 10 languages. (native build 42)
- Version bump: `_APP_VERSION` 1.40, iOS (app + widget) and Android build 40, `service-worker.js` `CACHE_NAME` v263, `version.json` web 1.40 / app 1.39 (1.39 is live; app → 1.40 once 1.40 is). iOS What's New in all 11 languages; new App Store name "Bipolar Bear: Mood Tracker", keywords, description and an app preview video on the version. Android not built for 1.40 yet.
- 🛟 **My safety plan.** A new plan in the Survival Kit (the "My safety plan" banner under "Struggling right now?") that you write while you feel OK, in the Stanley-Brown format the NHS-backed Staying Safe plan uses: warning signs, things I can do on my own, people and places that take my mind off things, people I can ask for help, professionals and services, making where I am safer, and my reasons for living. People and services have tap-to-call numbers, and the plan ends with the crisis lines for the country you're in. It's kept on your phone and, if you're signed in, end-to-end encrypted to your account with the same key as your journal, so nobody else can read it. **Opt-in:** "Show my safety plan on the lock screen" adds a 🛟 button beside "Need help now?" on both PIN screens. All 10 languages. (`CACHE_NAME` v262)
- 💙 **A gentle check-in after several hard days.** When 3 or more of your last 5 logged days were Depressed (and the latest is still low), the home page and journal show a calm card, "It looks like things have been hard lately", with your own people from the safety plan and the crisis lines for your country. It never pops up or sends a notification, shows at most once every 4 days, and you can close it, or turn it off in Journal → Settings → Journal Options ("Don't suggest support when I've had low days", unticked by default) or with "Don't suggest this again" on the card. Worked out on your phone only; auto-filled days don't count. (`CACHE_NAME` v262)
- 📱 **"Call for support" widget** (needs the 1.40 app build): call the one person you choose in your safety plan with a tap from the home screen, or your country's crisis line if you haven't chosen anyone. iPhone (small and medium) and Android.
- 🆘 **Crisis lines for the country you're in.** Every "need help now" place (the 🆘 sheet, the journal's "You matter" card, the Survival Kit crisis box and the board's 🛟 Help) only had UK numbers — Samaritans 116 123, NHS 111, 999 — which don't connect in most of the countries whose languages the app speaks. New `js/shared/crisis.js` picks lines by the phone's time zone (then the language's region): Ireland, the US, Canada, Australia, New Zealand, Spain, France, Belgium, Germany, Austria, Switzerland/Liechtenstein, Italy, Portugal, the Netherlands, Poland and Sweden each get their national crisis line and emergency number (checked against each service's own site or health ministry, 2026-10-04, all 24/7; "free" only where the service says so), and anywhere else gets findahelpline.com instead of a UK number. UK phones see exactly what they did. Test any country with `localStorage.bbCrisisCountry = 'FR'`. (`CACHE_NAME` v261)
- 🔒 **Help from the PIN lock screen.** Both lock screens (home and journal) get a "🆘 Need help now?" button beside "Forgot PIN?" that opens the crisis sheet above the lock — someone locked out of their own app can still reach a crisis line. The lock screen now scrolls on short phones instead of clipping its top and bottom. (`CACHE_NAME` v261)
- 📞 **Samaritans in the Survival Kit crisis box** — it had Bipolar UK, 111 and 999 but no crisis line. (`CACHE_NAME` v261)
- 🇵🇹 Portuguese crisis sheet: "precisa" → "precisas" (one você slip left after the tu pass).
- 📴 **The app opens offline again.** Cloudflare redirects `/journal.html` to `/journal`, so the service worker had stored redirected copies of the journal, Survival Kit and board, which the browser refuses for a page load — offline, all three showed the browser's "no internet" page (checked headless against bipolarbear.app). Copies are now stored clean and found under both spellings, a page whose network request stalls on a bad signal is served from the offline copy after 5 s, and home and the board register the service worker too (only the journal and Survival Kit did, so someone who only used home or the board had no offline copy at all). Web only; the store apps bundle their files. (`CACHE_NAME` v261)
- 🟠 **The home-screen widgets look like the app.** Both widgets now use the home page's cream check-in card (dark brown in dark mode) instead of a plain orange block, and on iPhone they show the same **Last 7 days** mood dots as the home page, with the weekday under each — so your streak is visible at a glance. Moods stay off the widget with incognito mode or a PIN on, and clear when you log out. Needs the 1.40 app build; Android gets the new look but not the dots yet. (`CACHE_NAME` v260)
- ✉️ **One contact address.** The privacy policy (every language) and the Anonymous board's report and contact links now say inbox@unisim.co.uk instead of bipolar@unisim.co.uk. (`CACHE_NAME` v259)
- 🤝 **The board's daily check-in shows who feels the same, not a scoreboard.** A member said the check-in made them feel everyone else was doing better than them. After you check in, the card now says how many others picked your mood today ("7 others picked **Depressed** today too. You're not alone in it.", or a thank-you when you're the first), and the whole-board bar is behind "See the whole board" (closed again on each visit). The "You: Depressed" line under the bar is gone; a "✓ Checked in" fades out beside the heading instead. All 10 languages; Polish uses its few/many plural forms. (`CACHE_NAME` v258)
- 🌙 **Dark mode for the PIN setup screen** ("Protect your data — choose a 4-digit PIN", shown to guests on their first save) — it stayed bright orange. The Set PIN dialog's dots and key presses follow dark mode too. (`CACHE_NAME` v255)
- **Missing entries popup:** "No missing entries in the last 30 days!" was black on the dark card; the dates list is in the app's language instead of US English, and "(Today)" is translated.
- 🇫🇷 **French speaks tu everywhere.** The app mixed vous and tu ("Votre Parcours" beside "Connecte-toi"); both apps' store listings already use tu, so all 427 vous-form strings in `js/shared/i18n.js` (journal, home, Survival Kit, board, wiki, privacy policy) now use tu, as do the board's push notifications (`functions/index.js`, deployed) and the home-screen widget (native). Kept formal on purpose: a quotation, "Tenez-moi informé" (the user addressing the team), and one plural "you and your loved one". (`CACHE_NAME` v256)
- 🌍 **Every language speaks to you one way**, the way its store listing already does. German now uses du (329 strings, was a Sie/du mix), Dutch je (178, was u/je), Portuguese European-Portuguese tu (563, a você/tu mix with Brazilian words such as tela, salvar and usuário, now ecrã, guardar and utilizador), the Spanish privacy policy tú (29) and Chinese 你 (185 × 您). Brazilian Portuguese users share the pt-PT text, as before. Every privacy policy now names the Moniker screen by its real title (it said Pseudonym, bijnaam, nickname and so on), and German's "Deine Moniker" is "Dein Moniker". Board notifications (de/pt) are deployed; the widget (de/nl/pt/zh) is in the native repo; the Anonymous screenshot maps (`store-assets/screens-i18n/anon_*.json`, fr/de/nl/pt/zh) are updated but the store screenshots are not re-rendered. (`CACHE_NAME` v257)
- 🤖 **Android back swipe goes home instead of closing the app** (Survival Kit and journal). The back handlers were already written, but `@capacitor/app` was never installed in `bipolarbear-native`, so they never registered — native change, needs the 1.40 build. The widget's `bipolarbear://journal` deep link (same plugin) starts working with it.

## v1.39 — everything below until v1.38 (submitted to both stores 2026-09-30)
- Version bump: `_APP_VERSION` 1.39, iOS (app + widget) and Android build 39 for both apps (Bipolar Anonymous 1.39 (39)), `service-worker.js` `CACHE_NAME` v254, `version.json` web 1.39 / app 1.38 (1.38 is live; app → 1.39 once 1.39 is). Store What's New in all 11 languages for both apps.
- 🗓️ **30 Sep 2026 batch** (`CACHE_NAME` v244; web live on push, the store apps with 1.39).
  - **Quick check-in widget (opt-in).** Profile → Customise → 🐻 Quick check-in (`bbHomeQuickCheckin`, synced as `homeQuickCheckinEnabled`, default off). When on, the five-bear card *replaces* the Mood Journal button: it gains a "📔 Mood Journal ›" header that opens the journal, and the streak line and last-7-days strip sit under it only when Show stats is on. Before this the bears showed for everyone under the button.
  - **The check-in fits one screen.** On phones (<920px) the focused check-in is exactly the viewport minus the safe areas: the card starts 12px below the notch / Dynamic Island and stops 18px above the home indicator, so its mood-tinted surface reads as a card against the orange page. Nothing scrolls the page; on the review step the answer list takes the leftover height and scrolls inside itself so Clear / Save stay on screen; short phones (≤760pt tall) get smaller heroes. Checked in WebKit at 393×852 (59/34 insets) and 375×667, plain and wheel mode.
  - **Summary chips on every step, live.** The chip row shows from the first page (steps not reached yet as faint 🛌 ⚡ 💊 📝 placeholders), and the current step's chip follows the wheel as it spins (preview only — nothing commits until a tap).
  - **🔔 Medication reminder** (native apps). A pill on the medication step opens a small sheet (on/off + time). New `js/shared/meds-reminder.js` (`BB.medsReminder`, loaded by index + journal): a reminder at that time daily, then hourly — up to 6 more, never past midnight — until ✅ Taken (a notification action, or the in-app prompt a reminder opens to). One-off notifications (ids 3000+) planned 7 days ahead and re-planned on every app open; device-only, nothing synced. Cleared by delete-all. Web browsers don't get the pill.
  - **Personalised Feedback ranges.** 1M / 3M / 6M / 1Y / All at the top of the popup (the life chart's control), opening on the stats page's period and working from the whole entry list.
  - **"Being built by James Markey MBE"** moved off the home screen to under the version in Profile (now a "· Changelog" link) and the foot of the changelog. The home footer keeps the community count (`#homeFooter`).
  - **Changelog:** a v1.39 block in the in-app changelog.
  - **Lighter home buttons** (`CACHE_NAME` v245): Mood Journal, Survival Kit and Bipolar Anonymous wear the quick check-in card's cream `#fff8ef` with `#5a2a00` text (≈11.6:1) instead of the burnt-orange fill; dark mode uses the card's dark surface.
  - **Softer secondary buttons** (v246): Survival Kit and Bipolar Anonymous use the locked button's see-through cream with a solid pale outline, so Mood Journal (or the Quick check-in) is the one solid button.
  - **Journal landing in one style** (v251): "View yesterday's entry" and "Open Journal" share one width (up to 300px), corner radius, font and size. The streak and "No missing entries ✓" are plain `#5a2a00` text like home's stats instead of see-through pills; only something you can act on (missing entries to fill, log the other day) is a pill, small and solid cream. The row no longer runs past the buttons' edges. **v252:** they (and the missing-entries pill) take home's Bipolar Anonymous look, see-through cream with a pale outline and no shadow, since solid cream was too much; dark mode uses home's faint neutral fill and hairline. **v253:** "View yesterday's entry" isn't highlighted at all (no fill, outline or shadow, dark text like the stats, still tappable); Open Journal keeps the see-through button.
  - **One time range for the journal** (v250): 1M / 3M / 6M / 1Y / All tabs under "Your Journey", in the Calendar / Life chart switch's look, replace the "Showing 30d ≡" dropdown (30 / 60 / 90 / custom) and the life chart's own 1M–1Y buttons. The one range drives the stat cards, the calendar (All = year grid), the life chart's zoom (pinch / ctrl-wheel step it too) and the Personalised Feedback popup's opening range. Stats now count the range's days back from today (like the life chart), not the last N entries; a range with nothing logged says so. Tap the range already showing to make it the default (`bbJournalRange`, per device, ★); a settings reset clears it and `bbJournalView`.
  - **Consistent journal buttons** (v250): Export PDF, Backup data and Import take the "See individual entries" cream (no more orange / green / blue outlines); page numbers and the feedback popup's range tabs use the switch look; the Personalised Feedback link is burnt orange `#a8430a` (≈6:1) instead of `#ff9500`.
  - **Journal buttons in the home look** (v249): the Mood Journal's burnt-orange buttons (Home, Open/Close Journal, Next, Save, Sign In, Change/Edit, the current page, the entry pills) wear the home buttons' cream `#fff8ef` with `#5a2a00` text — a thin warm ring inside the cards — and the dark surface with the orange ring in dark mode. Scoped to the journal via `--brand-btn` / `--brand-btn-text` in css/journal.css; mood-coloured buttons keep their colours. The status pills (streak, "no missing entries") take Survival Kit's soft see-through cream.
  - **"See individual entries"** (v249): the entry-by-entry log, its pages and Backup / Import fold away under the Personalised Feedback bear; Export PDF stays out. Collapsed on each visit.
  - **Calendar / Life chart switch** (v249): one view at a time under the stats; tap the view already showing to make it the default (`bbJournalView`, per device, ★ marks it). Hidden (calendar shown) until there are two logged moods.
  - **Greeting on home** (v249): the board's time-of-day line ("Hope your afternoon is going well. / You're doing great. 💛") sits above the Mood Journal button (or the Quick check-in); both it and the board break after the first sentence.
  - **Board check-in placeholder** (v249): the check-in holds its place while `anonMoodCheckin` answers — the tally shape when this device already knows today's mood, otherwise the five bears dimmed — so the feed no longer jumps; it gives up after 12 s.
  - **Last-7-days dots always show on the Quick check-in** (v248): Show stats now only governs the text lines under the buttons.
  - **Dark-mode hierarchy** (v247): the orange outline now belongs to Mood Journal / the Quick check-in card (on the lighter dark surface); Survival Kit and Anonymous get a neutral hairline, and the locked dashes are fainter — the orange outline had made the secondary buttons look more prominent than the journal.
  - **Bipolar Anonymous:** the 🫂 🙋 💪 reactions are gone (💛 stays; `reactAnonPost` left deployed so a cached client fails quietly). The greeting card is light yellow → yellow instead of fading to dark olive, and the check-in sits on its own white panel. The check-in now uses **Bipolar Bear's five moods** and bears (`images/moods/sm/*`, ~20 KB thumbnails, also in the anon bundle); `anonMoodCheckin` accepts them, folds the old Low/Flat/Okay/Racing totals in, and takes `source: 'journal'`. **A linked account is checked in by its journal:** saving a hand-logged entry for today or yesterday (signed in, with a board moniker) sends that entry's mood category; the board can also do it from `bb_recentMoods` inside Bipolar Bear. Your Moniker gains "How are you today?" show/hide (`bbAnon_moodAsk`) and "Check in from my journal" (`bbAnon_journalCheckin`, synced as `anonProfile.journalCheckin`), and the 🔥 / 🧘 / 🎂 figures moved there from the header. Privacy §2 `s2li10` rewritten in all ten languages to say what the journal check-in sends.
- ♿ **The last low-contrast buttons.** The check-in's Next / Save (and the spectrum's Continue) now use a darker shade of the mood's colour, so white text is ≥5:1 on every mood (green was 2.1:1). The journal's "View yesterday's entry", streak and "0 missing" pills get a dark fill instead of translucent white (about 1.6:1 → 5:1). (`CACHE_NAME` v242)
- 🐻 **Bipolar Bear follow-ups to the UX pass.**
  - **Last 7 days for signed-in users.** The home strip now works when you're signed in. After it loads your decrypted entries (and after every save, edit or delete), the journal leaves a small map on this device only, `bb_recentMoods`. It holds one mood word per day for the last 8 days and nothing else: no notes, sleep or other fields. It is never synced to Firestore. It isn't written, and any existing copy is removed, while incognito mode is on or an app or guest PIN is set, because the home screen shows before the PIN unlock. It is cleared on sign-in, sign-out and delete-all. The privacy policy needed no change.
  - **Readable orange buttons.** The remaining white-on-light-orange buttons now use the home buttons' burnt orange, a new `--brand-btn` token in `css/theme.css` with a deeper dark-mode version in `css/dark.css`. White text on them went from about 1.6–2.2:1 to about 4.9–6.1:1. They include the journal's Open/Close Journal toggle, ← Home and "missing entry" pills, the check-in's Next and Save when no mood colour applies, the classic form's Save, the Survival Kit's ← Home, +1 and link buttons, and the primary buttons in the home, Survival Kit and FAB-dock modals (sign in, Got it, Close, Send, Save and others).
  - **The mood survives the PIN.** Tapping a home or widget bear while the app is locked no longer drops the mood. The journal's PIN gate now passes `?mood=` on to the home screen, and after a correct PIN (guest or app PIN) home opens `journal.html?mood=…`. Home always removes the parameter from its own URL, and without a PIN gate it is simply ignored (`CACHE_NAME` v241).
- 🌙 **Bipolar Bear dark mode.** A warm dark theme (deep brown surfaces, cream text, orange kept for buttons and accents) across home, the check-in, entries, stats (Your Journey tiles, the mood calendar, the life chart), the early-warning card, Settings, the Survival Kit grid, its sections and crisis block, the FAB dock and its modals, the PIN screens and `privacy.html`. Mood colours are unchanged, the bear logo keeps its own orange tile, and the check-in's mood tint is a quieter wash on dark. It follows the phone by default; journal **Settings → Appearance** switches between automatic, light and dark. Stored per device in `localStorage.bbTheme` (not synced, and kept through sign-out), applied before first paint by a new inline `<head>` one-liner on each page, and kept in step afterwards by `BB.theme` in `fab.js`. Reuses the board's `anon.ux.theme*` strings, so it's already in all ten languages. New `css/dark.css`; touches `index.html`, `journal.html`, `js/journal.js`, `survival-kit.html`, `js/survival-kit.js`, `fab.js`, `privacy.html` (`CACHE_NAME` v240).
- ✨ **Bipolar Bear UX pass.**
  - **Check in from home.** The five mood bears sit on the home screen under the Mood Journal button. Tapping one opens the journal with that mood already chosen, on step 2. Under them, a **last 7 days** strip of coloured dots. It reads only moods already on the device (guest entries), so signed-in users don't see it yet. The row appears once the first-run steps are done and goes quiet once the day is logged. The home buttons and the small text under them now pass WCAG AA contrast (they were about 2:1).
  - **`journal.html?mood=<manic|elevated|stable|low|depressed>`** preselects the mood exactly as a tap does and advances to step 2. The parameter is removed from the URL as soon as it's read, so a reload doesn't repeat it. A day that is already logged ignores it. The home bears and the new native **Quick check-in** widgets (iOS and Android, `bipolarbear://checkin?mood=X`) use it.
  - **Livelier check-in.** Bigger step-1 bears that pop with a light haptic when chosen, and the page takes on a gentle tint of the chosen mood's colour. The card sits higher on the screen, and its buttons and labels now use Nunito instead of the system font. Motion is off under reduced-motion.
  - **Survival Kit tile grid.** A grid of 12 tiles, each with its ✅ status, replaces the ~4,000px list of headings. A **Struggling right now?** banner at the top goes to the crisis block, and the top tabs now have text labels. The Definition moved into Bipolar Moods. Mind Games is now 🧩 and 12 Steps 👣, so no two tiles share an icon. `#goals`-style links and the home screen's x/12 count work as before.
  - **Life chart** in the journal stats. Mood above and below the "stable" line, sleep underneath, and missed or unsure meds marked, with 1M / 3M / 6M / 1Y. It is also drawn in the clinician PDF.
  - **Early-warning nudges** (opt-in, off by default, Journal Options → Advanced). They look for three patterns: short sleep on 3 of the last 4 nights, a run of elevated or low days, and a sharp swing. The card uses calm wording, a history line only when your own data supports it, and a link to your strategies and support contacts. It is worked out on the device only. New setting `earlyWarnEnabled`, synced like the others.
  - New `home.quick.*`, `sk.grid.*`, `journal.lifeChart.*` and `journal.earlyWarn.*` strings in all ten languages. New `js/journal-insights.js` (`CACHE_NAME` v239).
- ✨ **Bipolar Anonymous UX pass.** The web board has all of this now; the phones get it with the next store build (which also brings in haptics).
  - **⋯ on every post and reply.** The feed used to show 🆘 🚨 🙈 (plus the admin tools) under every post. They now sit behind one ⋯ button, and pressing and holding a post opens the same sheet. The sheet shows the post's first lines so it's clear which one you're acting on. The original buttons are still rendered, hidden, and the sheet clicks them, so the SOS, report, mute and moderation paths haven't changed.
  - **Saved posts 🔖.** Save from ⋯, and find them again under Your Moniker → Saved posts. It's a snapshot on this device only, so a saved reply stays after the post leaves the board at 7 days. It's cleared on sign-out with the rest of `bbAnon_*`.
  - **Pull to refresh** re-opens the feed listeners. Grey **skeleton cards** replace "Loading posts…".
  - **Author chips.** `🔥 12d 🧘 40d 🎂 2y 💊 Lithium` moves off the name line into small chips, and each one says what it means when tapped.
  - **Dark mode.** It follows the phone by default, and Your Moniker → Appearance switches between automatic, light and dark. It's set before first paint by a new inline `<head>` script and stored in `localStorage.bbAnonTheme`, which is outside `bbAnon_*` so signing out keeps it. The greeting card drops to amber at night.
  - **🛟 Help button in the header.** It opens tap-to-call and tap-to-text links for Samaritans (116 123), Shout (text SHOUT to 85258), NHS 111 (mental health option) and 999, plus findahelpline.com for anyone outside the UK. The numbers are UK services, so they're left as they are in every language.
  - **Swipe a reply to the right to answer it.** The composer gets `@Name`. ⋯ on a reply also has Reply.
  - **The bear on empty screens** (no posts, no replies, no wiki results, nothing saved), a coloured banner and accent for each **wiki section**, and **haptics** on likes, sends, the ⋯ menu, pull to refresh and the swipe threshold. Haptics use `@capacitor/haptics` in both native shells (added in `bipolarbear-native` and `bipolaranonymous-native`) and fall back to `navigator.vibrate` on Android web.
  - The report, SOS, mute and delete sheets now stack above the comment thread. Before, they had the same z-index as the thread and could open hidden behind it.
  - New `anon.ux.*` strings in all ten languages. Touches `anonymous.html`, `css/anonymous.css`, `js/anonymous.js`, `js/shared/i18n.js`, `icons/anon-bear-256.png` (new) (`CACHE_NAME` v238).
- 🫂 **Bipolar Anonymous: gentle reactions, polls and a daily mood check-in** (29 Sep 2026, `CACHE_NAME` v243).
  - **Reactions.** Beside 💛, the ☺+ button offers 🫂 Sending a hug, 🙋 Same here and 💪 You've got this. The counts sit on their own line above the actions, and you can't react to your own post. `likes` is untouched, so the first-post gate still reads it.
  - **Polls.** Compose on General has 📊 Add a poll, with 2–4 options. Before you vote you see buttons; after, bars with percentages and your pick ticked, and you can change your vote.
  - **Mood check-in.** The greeting card asks "How are you today?" (😔 Low · 😐 Flat · 🙂 Okay · ⚡ Racing), once per UK day, then shows the whole board's mix for the day.
  - **How it's stored.** Everything goes through new callable Cloud Functions (`reactAnonPost`, `createAnonPoll`, `voteAnonPoll`, `anonMoodCheckin`, plus the nightly `sweepAnonMoodSeen`), deployed to `bipolarbear-app`, so no Firestore rules change is needed. As with likes, only totals are stored. Your reactions and votes are remembered on the device. The check-in keeps a "this session checked in today" marker with no mood in it, and deletes it after two days. An admin's poll keeps the shared "Bipolar Bear Admin" identity, taken from the sign-in token.
  - **Privacy policy.** §2 gains `s2li10`, saying so in all ten languages. Touches `functions/index.js`, `anonymous.html`, `css/anonymous.css`, `js/anonymous.js`, `js/shared/i18n.js`, `privacy.html`.

## v1.38
- Version bump: `_APP_VERSION` 1.38, iOS (app + widget) and Android build 38 for both apps (Bipolar Anonymous 1.38 (38)), `service-worker.js` `CACHE_NAME` v237. In-app changelog: a v1.38 block; no What's New popup, as there is nothing new to point at. Store What's New in all 11 languages.
- 📊 **The suite counter knows web from phone.** The beat to `app_presence_beat` now sends `p_platform` — `ios` / `android` inside the Capacitor shells, `web` on bipolarbear.app — so both apps' users count in the suite's "web · native" split (Supabase migration 0187). Before this they sent the old two-argument call and sat in neither column. Still only a random install id and the app's name besides; nothing about the person. The web side is live on push; the store apps get it with build 38. Touches `js/shared/user-count.js` (`CACHE_NAME` v235).
- 👆 **On the web, a visit counts once you do something.** The suite counter's first beat waits for a tap, key press, touch, wheel or scroll, as every other suite app has since @unisim/sdk 0.158 — so somebody who lands and leaves is not a user. The apps are unchanged: opening one is the interaction. The two app-own Firestore counters are untouched (`CACHE_NAME` v236).
- 🔒 **Privacy policy §6 says so.** The UNI·SIM line now reads "a randomly generated install ID and whether it is the web, iPhone or Android app, and nothing else", in all ten languages (`privacy.s6li2`, and `privacy.html`'s English fallback).

## v1.37
- 🚀 **Live on the App Store and Google Play, both apps (build 37)** — Google Play 19 Sep 2026, App Store 22 Sep 2026; confirmed 28 Sep 2026. `version.json` `app` channel 1.36 → 1.37.
- 🙏 **The Bipolar Anonymous 12 Steps are in the wiki.** The twelve steps the main app carries in the Survival Kit now have their own page on the board, under a new **🙏 12 Steps** wiki pill — our version of the twelve-step tradition, rewritten for living with bipolar rather than with addiction. They’re grouped the way the Survival Kit groups them (1–3 *I am powerless over my condition*, 4–10 *Making amends for past actions*, 11–12 *Carrying hope to others*), and each step now carries a wiki-only note on what it actually looks like in practice — Step 10 as daily mood tracking, Step 11 as any regular practice of stepping back from your own thoughts, Step 12 as the board itself. Every step is searchable from the wiki’s 🔍, and a group heading hides itself when nothing under it matches. **All ten languages**, and the step statements themselves aren’t duplicated — the page reads them from the Survival Kit’s own `sk.steps.*` strings, so editing a step changes it in both apps at once and the two can’t drift apart. An **announcement** launches it and asks the board what they think of them, with a **📖 Read it in the Wiki →** button that opens the page directly. That button is the first announcement that can link anywhere: built-in announcements (ones that ship with the app and point at features this build has, rather than posts the admin published to Firestore) now always render at the top of the Announcements tab, and can name a wiki section to open. Touches `js/anonymous.js`, `css/anonymous.css`, `js/shared/i18n.js` (`CACHE_NAME` v233)
- 🌐 **Bipolar Anonymous reads in your language now.** The board is one community in ten languages, so a post written in Portuguese was unreadable to most of the people who might have answered it. Posts, daily topics, announcements and replies are now shown in whatever language you have the app set to — and **the original is always one tap away**: under every translated post is a quiet line saying which language it was written in, with a **Show original** button. Nothing is ever swapped silently, and a post already in your language is left completely alone, with no badge and no note. Translation happens when a post is *read*, not when it is written, and every result is cached for the whole board, so the second person to read a post gets it instantly. A new **🌐 Language & translation** sheet in settings carries the auto-translate switch (on by default) and — new — a language picker for the board itself, which until now could only be changed from the main app's home screen. Turning it off puts every post back exactly as written. Needs the Cloud Translation API enabled on the Firebase project; until it is, the board reads as written and says so rather than failing. New `js/shared/translate.js` and a `translateAnonTexts` Cloud Function; touches `anonymous.html`, `css/anonymous.css`, `js/anonymous.js`, `js/shared/i18n.js`, `functions/index.js`, `scripts/build-anonymous.js`, `DOCS.md` §2.15 (`CACHE_NAME` v231)
- 🔒 **Privacy policy §6 names the translator.** Google Cloud Translation is now listed beside Google Firebase and Universal Simulation Ltd, stating that only the text of a board post is sent — never your email address, your moniker or anything that identifies you. All ten languages. Touches `privacy.html`, `js/shared/i18n.js`
- 🌍 **Both apps joined the UNI·SIM suite — and its user counter.** Bipolar Bear and Bipolar Anonymous now live in the `universal-simulation-ltd` GitHub organisation alongside the rest of the Universal Simulation apps, and they share that suite's community counter. Their own Firestore counters are untouched and remain what each app says about itself — they count *accounts*, so one person on a phone and a laptop is one person, which the suite's figure cannot know — but each app now also beats the suite's `app_presence` table (Supabase migrations 0175 / 0179), so its users are part of "N people use UNI·SIM apps", and **tapping the count line switches between the two figures**. The choice is remembered, under the same key every other suite app uses. What goes up is a randomly generated install id and the app's name: no account (a Bipolar Bear account is a *Firebase* account, unknown to that server), no journal, nothing read or written. On bipolarbear.app the home page and the board share one install id, so reading both counts once. New `common.suiteCount` / `common.countTapHint` in all ten languages. Touches `js/shared/user-count.js`, `js/index.js`, `js/anonymous.js`, `js/shared/i18n.js` (`CACHE_NAME` v229). The suite figure is read once on load whatever the scope, so it can stand in on the home screen when the app's own number is missing — offline, or Firestore refused — rather than only when a cache happens to hold one; the board's line stays members-only (`CACHE_NAME` v230)
- 🔒 **Privacy policy — the counter is in it.** §2 ("Anonymous usage") now states what the beat sends, and §6 ("Who we share your data with") lists Universal Simulation Ltd beside Google Firebase; §6 used to say "the only third-party service", and now says "the third-party services". All ten languages, and "Last updated" moves to September 2026. Touches `privacy.html`, `js/shared/i18n.js`
- 🏠 The home screen's community count now sits under the "Being built by James Markey MBE" chip rather than above it (`CACHE_NAME` v232)
- Version bump: `_APP_VERSION` 1.37, iOS (app + widget) and Android build 37 for both apps, `service-worker.js` `CACHE_NAME` v234, `version.json` web channel 1.37. In-app changelog: What's New headline for 1.37 and a v1.37 block in the changelog modal. Store What's New for 1.37 in all 11 languages for both apps.
- ⚠️ These all landed on 17–18 Sep, **after** build 36 was uploaded (17 Sep, 09:40 UK), so the 1.36 store builds do not carry them even though this file first listed them under 1.36. The web app has had them since they merged.

## v1.36
- 🚀 **Live on the App Store and Google Play, both apps (build 36)**, confirmed 19 Sep 2026. `version.json` `app` channel 1.35 → 1.36.
- ⏳ **No more "you're logged out" on the way in.** Firebase Auth restores a cached session asynchronously, so the home screen painted its signed-out chrome — locked Bipolar Anonymous button, "Sign in to join the community", the Sign In FAB — and corrected itself a beat later; a returning user was told they were signed out on every cold load. A loading splash now covers that gap: the app icon with a line running round its outline, a few pixels clear of the artwork, over the brand gradient. It's a dash travelling an SVG rounded-rect path rather than a spun gradient, so the line keeps its length and speed round the corners instead of smearing down the flat sides. It goes up before `<body>` is parsed and **only when localStorage actually holds a Firebase session**, so a genuine guest never waits behind a splash for a sign-in that isn't coming; it comes down on the frame after auth resolves, so the page is revealed already correct. A self-contained 6s timeout takes it away regardless, so a Firebase CDN failure degrades to the old flash rather than a stuck page. Held still for `prefers-reduced-motion`. Currently on the home screen — `journal.html` and `survival-kit.html` can opt in with the same three lines. Touches `index.html`, `css/theme.css`, `js/index.js`, `js/shared/auth-splash.js` (new), `service-worker.js`, `DOCS.md` §2.6 (`CACHE_NAME` v227)
- ✨ **Auto-complete yesterday, from the first step.** The missing-entries auto-complete fills a run of gaps; this fills the one day the journal is already pointed at. Focused mode's first (mood) step now carries an **✨ Auto-fill from health** button — shown only on a native build with health sync switched on, only for a new entry, and only when the form's date is yesterday. Today is deliberately excluded: its night hasn't happened and its step count is still mid-day, so there's nothing honest to estimate from. One tap reads yesterday's sleep and step count from Apple Health / Health Connect (one permission ask for both, then the same single-day importers the sleep and energy steps use — skipped entirely when the silent sync on open already has the values), derives mood and energy from them with the same rules as the bulk auto-complete, and drops the user on the summary step with a note saying where the values came from. Nothing is written without their Save. Health had nothing for the day → the button says so and they stay on step 1. Touches `js/journal.js`, `js/shared/i18n.js`, `DOCS.md` §2.13 (`CACHE_NAME` v226)
- 🏷️ A day filled that way carries the same **AUTO** mark as a bulk-filled one — badge in the entry list, "Auto-filled estimate" in the PDF, a column in the CSV — because what the user reviewed before saving was still a guess. Change the mood, energy or sleep on the way through and the mark doesn't apply: the entry is their own report again
- ⭐ **Store review prompt, only after a real win.** On a native build, after a new hand-logged entry with a stable mood and at least three distinct logged days, the app asks the OS for its in-app review sheet — at most three times, 120 days apart. Uses `@capacitor-community/in-app-review`, added to `bipolarbear-native`. Touches `js/journal.js`
- 📐 **Android edge-to-edge.** Android 15+ draws the app behind the gesture / navigation bar (Play Console: "Edge-to-edge may not display for all users"), which left the dock and the home version label sitting on the gesture bar. `platform.js` now tags `<html>` with `is-android` / `is-ios`, and `fab.js` + `css/index.css` lift the dock bar, its buttons, the dock hint and the version label by the bottom inset on Android only — the larger of `env(safe-area-inset-bottom)` and the `--safe-area-inset-bottom` Capacitor's SystemBars plugin injects, because older WebViews (Chrome 124 on the API 35 emulator) report `env()` as 0. Both are 0 on Android 14 and below, where the system still reserves the bar; iOS keeps its layout. Touches `js/shared/platform.js`, `fab.js`, `css/index.css` (`CACHE_NAME` v228)
- 🌍 The home screen's "N more entries needed to complete tutorial" line was hard-coded English; it now reads `home.tutorialProgressOne` / `home.tutorialProgressMany` in all ten languages. Touches `js/index.js`, `js/shared/i18n.js`
- 🗣️ **The App Store lists all ten languages.** Native only: both iOS apps carry a `<lang>.lproj/InfoPlist.strings` per language (`bipolarbear-native@f227927`, `bipolaranonymous-native@568f44e`) — `CFBundleLocalizations` alone (1.35) left the store page on "Languages: English". Portuguese is declared as both pt-BR and pt-PT.
- 🇧🇷 Store listings in **Brazilian Portuguese** alongside European Portuguese on both stores, for both apps — text and localised screenshots.
- Version bump: `_APP_VERSION` 1.36, iOS (app + widget) and Android build 36 for both apps, `service-worker.js` `CACHE_NAME` v228. In-app changelog: What's New headline for 1.36 and a v1.36 block in the changelog modal.

## v1.35
- 🚀 **Released 16 Sep 2026** on the App Store and Google Play, both apps (build 35). `version.json` `app` channel 1.34 → 1.35 once both stores had it live, so older installs now get the update banner. Shipped: the iPhone home-screen widget no longer sticks on "Yesterday needs logging" and resets at midnight; the journal's "Step N of M" counter is translated; both native apps declare all ten UI languages (`CFBundleLocalizations`), so on iOS the first-run language picker now defaults to the phone's language (a saved choice still wins). First release with **localised store listings in ten languages** on both stores for both apps — App Store and Google Play text plus localised iPhone and Android screenshots, uploaded by API (`store-assets/asc-upload.mjs`, `store-assets/play-upload.mjs`). The App Store's Languages field still reads English only, so `CFBundleLocalizations` alone doesn't drive it — per-language `.lproj` folders are the likely next step.

## v1.34
- 🚀 **Released 14 Sep 2026** on the App Store and Google Play, both apps (build 34). `version.json` `app` channel 1.4 → 1.34 once both stores had it live, so older installs now get the update banner. The store builds were rebuilt before upload, so they include the feedback fixes below.
- 👥 **Both user counters can now include the people who were already here.** `counters/userCount` and `counters/anonUserCount` only ever counted an account when it next opened the app, so everyone who joined before the counters shipped was missing from the total until they happened to come back — a dormant account, never. A new admin-only callable, `backfillUserCounts`, counts them with the Admin SDK instead: one per `userSettings/{uid}` that still has a Firebase Auth account for Bipolar Bear, and one per `sha256(email)` across both anonymous entry paths (`userSettings/{uid}.anonProfile` and `anonProfiles/{hash}`, de-duplicated, so a member using both counts once). Each account's `counted` flag is written *before* the counters are set to the computed totals, so nothing a backfill counts can count itself again on its next visit. Dry-run by default (`{apply:false}` reports the numbers and writes nothing), repeatable, and also the way to repair a counter that has drifted; `userSettings` left behind by deleted accounts are reported as `orphaned` rather than counted. Functions-only — no client change, no `CACHE_NAME` bump. Deploy with `firebase deploy --only functions:backfillUserCounts`. Touches `functions/index.js`, `DOCS.md`
- 🐛 **Feedback that never arrived.** The feedback form thanked the user even when the page had no Firestore connection, so the message went nowhere and nobody knew; it now shows "Could not send — please try again". And guests couldn't send feedback from the Survival Kit at all: that page doesn't put its auth handle on `window`, so the form skipped the anonymous sign-in the rules require and the write was refused. It now falls back to the Firebase SDK's own auth and goes by the real session. Touches `fab.js` (`CACHE_NAME` v223)
- 📎 Feedback screenshots now reach the inbox as an **attachment**. They were inlined as a `data:` image, which Gmail and Outlook strip, so the email showed a broken picture — and the value was spliced into the email HTML unescaped. Only a base64 PNG/JPEG data URL is accepted. `onFeedbackSubmitted` now also logs each successful send. Touches `functions/index.js`
- 📧 `onAnonSuggestionCreated` is deployed, so a member suggesting an announcement now actually emails the admin — it had been written but never deployed.
- 📬 Admin notification emails — feedback, beta signups and announcement suggestions — now go to `jamesmarkey@gmail.com` (`FEEDBACK_TO`). The admin *account* is unchanged: `inbox@jamesmarkey.co.uk` is still what the Firestore rules and `ADMIN_EMAIL` check. Touches `functions/index.js`
- ✨ **Auto-complete missing entries.** When the journal's "N missing entries" pill opens the Missing Entries list with two or more gaps, it now offers to fill them all in one pass. Each day is built from the data the app already has: sleep hours and step counts pulled from Apple Health / Health Connect in two aggregated day-bucketed queries across the whole gap, falling back to the median energy, median sleep and most frequent mood of the last 30 entries for days (or platforms) with no health data — a flat baseline that deliberately does not lean towards whatever was logged nearest, since guessing the shape of an unrecorded episode would be predicting mood swings. Mood and energy are derived from steps + sleep by the same rules as focused mode's "best guess" — never read from Health directly, and nothing else on the form is invented. Before anything is written, a preview lists every day with its values and where they came from ("From your health app" / "Estimated from your recent entries"), each with a checkbox so any day can be dropped. Writes go through the same paths as a normal save: one encrypted Firestore batch when signed in, encrypted localStorage behind the first-save PIN gate as a guest. Touches `journal.html`, `js/journal.js`, `js/shared/i18n.js`, `DOCS.md` (new §2.13) (`CACHE_NAME` v208)
- 🏷️ Auto-completed days are marked as estimates everywhere they can be mistaken for something the user reported: an **AUTO** badge in the entry list, "Auto-filled estimate" in the PDF export a clinician reads, and an Auto-filled column in the CSV. Opening such a day and saving it clears the mark — once it's been reviewed it isn't a guess any more
- ♻️ The steps→energy mapping and the health→mood best-guess rule are now shared helpers (`_energyFromSteps`, `_suggestMoodFromHealth`) rather than copies inside the focused-mode importers, so auto-complete and the single-day sync can't drift apart
- 🌍 **Translation completeness.** Every one of the ten languages now carries every string the app can show. Eight locales (es, de, it, pt, nl, pl, sv, zh) had silently fallen ~646 keys behind English — the whole Survival Kit (`sk.*`), both landing pages (`lp.*`), the focused-mode journal steps, stats, health-sync and permission banners, the feedback / quick-note / dock-picker modals, the wiki pills and disclaimers, the anonymous-board delete-account flow and `mood.stable` — so users on those languages were reading the English fallback for all of it. French was 42 keys behind on the newer journal and board strings. Also fixed a real bug: the French block declared `anon.ui` twice inside one object literal, so its 17 genuine translations were discarded at runtime in favour of a two-key duplicate. Touches `js/shared/i18n.js` (`CACHE_NAME` v207)
- 🗓️ Auto-complete's per-day preview formats its dates the same way as the missing-entries list it opens on top of (`en-US`), instead of following the device locale — the two sat one on top of the other showing the same day in two different formats (`CACHE_NAME` v209)
- 🐻 Anonymous board: arriving from BipolarBear now shows the **BipolarBear icon and wordmark** top-left with a small "← Go back" line beneath it, so the way back is labelled rather than hidden behind an unmarked logo tap. Standalone (email-code) members and the standalone Bipolar Anonymous app keep the "Anonymous / BipolarBear" wordmark, which does nothing when tapped. On a narrow header the wordmark is dropped before the back line, then the whole label if even that won't fit. Touches `anonymous.html`, `css/anonymous.css`, `js/anonymous.js`, `js/shared/i18n.js` (`CACHE_NAME` v210)
- 📢 **Announcements are the admin's to publish.** Composing on the Announcements tab used to post straight to it from any account. It now opens a **Suggest an announcement** sheet for everyone but the admin: the text goes to a review queue (`bbAnonAnnSuggestions`) and shows as a faded, dashed card — "Waiting for approval" to whoever wrote it, and to the admin with **Publish** / **Refuse**. Publishing copies it onto the board still credited to the member who suggested it; refusing leaves the author one "Not published" card they can dismiss. The admin's tab carries a badge while anything waits. Members with nothing pending never start the listener. Needs the matching Firestore rules from `DOCS.md` §2.11 pasted into the console — the client gate is only half of it. Touches `anonymous.html`, `css/anonymous.css`, `js/anonymous.js`, `js/shared/brand-config.js`, `js/shared/i18n.js`, `DOCS.md` (`CACHE_NAME` v211)
- 🔔 **Notifications on the anonymous board.** Three switches — replies to your posts, new announcements, and a weekly summary — asked for once, right after a member's first post, and always editable from settings. Sent by Cloud Functions over FCM: `onAnonCommentCreated` notifies a post's author (never the person who wrote the reply), `onAnonAnnouncementCreated` covers both admin posts and approved suggestions, and `weeklyAnonDigest` goes out Sunday evenings, skipping a week with nothing in it. **No notification carries post or comment text** — a lock screen is read by whoever is nearby, so "someone replied to your post" is the whole body. Registrations are one `bbAnonPush` document per device token, deleted on sign-out, account deletion, a revoked OS permission, or the last switch going off; dead tokens are collected on send. Needs the setup in `NOTIFICATIONS.md` (APNs key, `GoogleService-Info.plist`, plugin install + `cap sync`, Web Push VAPID key, Firestore rules) — until then the app says notifications aren't available rather than failing. Touches `anonymous.html`, `css/anonymous.css`, `js/anonymous.js`, `js/shared/anon-push.js` (new), `js/shared/firebase-config.js`, `js/shared/i18n.js`, `firebase-messaging-sw.js` (new), `functions/index.js`, `scripts/build-anonymous.js`, `NOTIFICATIONS.md` (new), `DOCS.md` §2.14 (`CACHE_NAME` v212)
- 📧 A member suggesting an announcement now emails the admin through the same Resend path as feedback and beta signups (`onAnonSuggestionCreated`), so the queue doesn't sit unseen until the next visit to the board. Touches `functions/index.js`
- 💬 Opening a comment thread now lands on the **most recent comment** rather than the top of the thread — the part worth reading is the end. A reply arriving while the thread is open only follows the reader down if they were already at the live end, so scrolling up to re-read something isn't yanked away by a stranger's comment; sending your own always follows it down. Touches `js/anonymous.js` (`CACHE_NAME` v213)
- 🔎 **Search thumbnails that fill the box.** Google's mobile results show a square thumbnail, and the only image either site offered was the 1.91:1 Open Graph card — so it appeared shrunk between grey letterbox bars. Both brands now have a dedicated search card built in three shapes (1:1, 4:3, 16:9), listed in new JSON-LD on the landing pages and `privacy.html` so Google can pick the one that fits the surface it's rendering. The card is composed for the size it's actually seen at: the app mark filling most of the frame, the name under it, one short line of copy. JPEG at q92 — visually identical to the PNG (mean channel error ~1/255) at an eighth of the weight, 90–137KB each. The Open Graph cards are untouched: 1.91:1 is right for a Slack or X unfurl. New `store-assets/build-search-cards.mjs` (captures over the DevTools protocol, so the canvas is exactly 1200px wide however Chrome sizes its window) and `images/search/*.jpg`. Touches `welcome.html`, `welcome-anonymous.html`, `privacy.html` (`CACHE_NAME` v214)
- 🔗 **The Bipolar Anonymous store badges are live links.** All eight of them across the two landing pages — App Store (`id6768005853`) and Google Play (`com.bipolaranonymous.app`), in the Anonymous showcase on `welcome.html`, the hero and showcase on `welcome-anonymous.html`, and the two text links in its footer — were sitting on `href="#"` behind a "coming soon" title. Every store badge on both pages now points at a real listing. `js/shared/version-check.js` picked up the iOS Anonymous URL as well, so an out-of-date iOS Anonymous user gets a tappable banner instead of generic "update via your app store" copy. Touches `welcome.html`, `welcome-anonymous.html`, `js/welcome.js`, `js/shared/version-check.js` (`CACHE_NAME` v215)
- 🆕 **"New posts" notifications on the anonymous board.** A fourth switch in 🔔 Notifications — every new member post in General Chat, for anyone who wants to keep up with the board as it happens. Off by default (on a busy day it's the noisiest of the four, and the sub-label says so), sitting between announcements and the weekly summary in both the opt-in sheet and settings. Sent by the new `onAnonPostCreated` function: never to the author's own devices, never for the auto-generated daily topic or system cards, and announcements keep their own switch. Every post notification shares one collapse id (`anon-new-post` — APNs collapse id, Android tag + collapse key, web-push tag), so a burst replaces the one in the tray instead of stacking, and a phone that was offline gets the latest rather than all of them. Same rule as the others: **no post text** — "Someone posted on Bipolar Anonymous." in all ten languages. `subscribers()` now queries `prefs.<pref> == true` for board-wide sends instead of reading every registration, so each post costs reads in proportion to who asked. Needs `firebase deploy --only functions:onAnonPostCreated` — until then the switch saves but nothing is sent. Touches `js/anonymous.js`, `js/shared/anon-push.js`, `js/shared/i18n.js`, `functions/index.js`, `NOTIFICATIONS.md`, `DOCS.md` §2.14 (`CACHE_NAME` v217)
- 🔔 **The first-post notification sheet asks about new posts.** After a member's first post it now reads "Would you like to be notified when someone posts?", with New posts listed first and switched on (replies and announcements still on beneath it, weekly off) — before, that switch was off and only reachable from settings. Members who were subscribed before the switch existed, or who posted before notifications shipped, get the same sheet once on their next post; anyone who has already chosen "Not now" is not asked again. Accepting also no longer claims success when the device registration can't be saved (for instance while the `bbAnonPush` Firestore rule isn't published) — the switches stay off and a failure toast shows, and a switch flipped in settings that the server refuses goes back to what it was. The sheet only appears where push is actually available — see `NOTIFICATIONS.md`. Touches `anonymous.html`, `js/anonymous.js`, `js/shared/anon-push.js`, `js/shared/i18n.js`, `DOCS.md` §2.14 (`CACHE_NAME` v218)
- 🌐 **Web push is on for the anonymous board.** The Firestore rules for `bbAnonPush`, `bbAnonAnnSuggestions` and the admin-only Announcements gate are published (posting itself stays open to members without a Firebase session; only creating an announcement, or moving a post into that tab, needs the admin account), and `BB_PUSH_VAPID_KEY` is filled in, so Chrome, Edge and Firefox — and Safari for an installed PWA — can now subscribe. Three fixes that would have bitten on first use: `firebase-messaging-sw.js` registers under its own scope (`/firebase-cloud-messaging-push-scope`) rather than `/`, where it would have evicted the offline-cache worker and been evicted back on the next journal visit, silently dropping pushes; it no longer shows a second copy of a push the Firebase SDK already displayed, and its click handler runs ahead of the SDK's (which, with no link set, only closed the notification) so a click opens the board; and `bbAnonPush` writes sign in anonymously first, since the rules require a session and standalone members don't have one until asked. Web notifications carry the small anonymous app icon. Touches `js/shared/firebase-config.js`, `js/shared/anon-push.js`, `js/anonymous.js`, `firebase-messaging-sw.js`, `functions/index.js`, `NOTIFICATIONS.md`, `BACKLOG.md` (rules item done) (`CACHE_NAME` v219)
- 🐛 The "Would you like to be notified when someone posts?" sheet could stay hidden for good. `enable()` marked the member as asked *before* checking the device could deliver push, so a notification switch tapped in an older app build — or on the web before the push key went in — counted as a past "Not now" and the sheet never appeared once push did work. It now records the answer only once the OS permission prompt is reachable, and the two flags are renamed (`Anon_notifAsked2`, `Anon_notifPostsAsked2`) so the stale ones are ignored; a member who genuinely declined in the day since v219 is offered it once more. With `bbDebug` on, a skipped sheet logs why. Touches `js/shared/anon-push.js`, `js/anonymous.js`, `DOCS.md` §2.14 (`CACHE_NAME` v220)
- 💬 The notification sheet is now offered after a **reply** as well as a new post — a reply is posting too, and often a member's first contribution. It also stacks above the comment thread: every overlay sat at `z-index: 100` and the thread comes later in the page, so opened from a reply it would have been hidden behind it. Still asked once; anyone who has answered it, or whose device can't do push, isn't shown it again. Touches `js/anonymous.js`, `css/anonymous.css`, `DOCS.md` §2.14 (`CACHE_NAME` v221)
- 📋 Release 1.34: in-app changelog — a What's New headline (`_WHATS_NEW_HEADLINES['1.34']` in `js/index.js`) and a v1.34 block in the journal's changelog modal. Bipolar Anonymous native rebumped 1.33 → 1.34 (build 34) to stay in lockstep with the main app. Both native apps ship the push-notification work: Firebase Messaging plugin, APNs entitlement + Remote notifications background mode on iOS, status-bar icon on Android. Touches `js/index.js`, `journal.html` (`CACHE_NAME` v222)
- Version bump: `_APP_VERSION` 1.34, `version.json` web channel 1.34, iOS (app+widget) + Android build 34, `service-worker.js` `CACHE_NAME` v208

## v1.33
- 👀 **Live-now counts.** Both community counters gained a live figure — "🐻 12 people use Bipolar Bear (2 live)" above the home footer, "👥 842 members (3 live)" in the Anonymous board header. Live is presence, not analytics: each open page heartbeats one document into `bbPresence` / `bbAnonPresence` every 45s while visible, keyed by a random per-tab id from `sessionStorage` and carrying nothing but `lastSeen` — no uid, email or monika, because a live count must not become a record of who was reading a mental-health app and when. "Live" means beat within the last two minutes, so a closed tab ages out on its own and a backgrounded tab stops counting. The count uses Firestore's `count()` aggregate where the SDK exposes it and falls back to a capped document read; documents idle for 30 minutes are swept ten at a time on every tenth tick. Touches `js/shared/user-count.js`, `js/index.js`, `js/anonymous.js`, `js/shared/i18n.js` (`CACHE_NAME` v203)
- 🏃 Journal and survival-kit sessions count as live too — time spent writing an entry is time using the app. Those pages run in **beat-only** mode (no callback → no count query, no sweep), so an extra open page costs one write per 45s and no reads. The per-tab session id means home → journal → kit in one tab stays one live person. `survival-kit.html` picks up `js/shared/user-count.js` (`CACHE_NAME` v204)
- 🔍 A missing count is no longer silent: `js/shared/user-count.js` logs the resolved value (or that the counter document doesn't exist yet) and warns with the Firestore error code when a read, count or decrement is refused — so a rules denial is distinguishable from "nobody counted yet" (`CACHE_NAME` v202)
- 🎨 Home counter copy reads "N people use Bipolar Bear" rather than "have used", present tense across all ten locales (`CACHE_NAME` v205)
- 🔐 Requires Firestore rules for `counters/{doc}` (public read, authed write) and `bbPresence` / `bbAnonPresence` (public read; create/update constrained to a lone `lastSeen` field; delete allowed so tabs can tidy up after themselves)
- Version bump: `_APP_VERSION` 1.33, `version.json` web channel 1.33, iOS (app+widget) + Android build 33, `service-worker.js` `CACHE_NAME` v206

## v1.32
- 👥 **User counts across both apps** — the home screen now shows how many people are using Bipolar Bear (just above the footer credit), and the Bipolar Anonymous board header shows how many members the community has. Both read live Firestore counters (`counters/userCount`, `counters/anonUserCount`) maintained by a new shared module. Each account counts itself exactly once — the increment and the account's one-time `counted` flag are written in the same transaction — so accounts that predate this are picked up on their next visit, no device double-counts, and deleting an account gives the count back. Anonymous members are keyed on `anonProfiles/{sha256(email)}`, the one document shared by the BipolarBear-account and standalone email-code paths, so the same person is never counted twice. Both lines paint from a localStorage cache first (so they survive an offline load or a failed Firebase init) and stay hidden until a real, non-zero number resolves. Translated across all ten languages with plural forms. Touches `index.html`, `journal.html`, `anonymous.html`, `js/shared/user-count.js` (new), `js/index.js`, `js/anonymous.js`, `js/journal.js`, `js/survival-kit.js`, `js/shared/i18n.js`, `css/index.css`, `css/anonymous.css`, `scripts/build-anonymous.js`, `service-worker.js` (`CACHE_NAME` v200)
- Version bump: `_APP_VERSION` 1.32, `version.json` web channel 1.32 (it had drifted back at 1.25), iOS (app+widget) + Android build 32, `service-worker.js` `CACHE_NAME` v201

## v1.25
- 🎚️ New advanced setting: **Full Mood Spectrum** — track your mood on a 0–10 scale (e.g. 4 = sad but stable) by spinning a wheel or sliding, instead of the five fixed moods. Turn it on under Advanced → Journal Options (#84). Touches `js/journal.js`, `css/journal.css`, `journal.html`
- 🎨 Journal (classic form): cleaner energy / sleep / medication rows — dropped the big floating emoji + value readout from the energy and sleep steps (the step count and sleep time already sit in the section headers, leaving only the compact "✓ Synced from …" badge when health data is present); energy buttons now show the emoji plus a short symbol (`- -`, `-`, Normal, `+`, `++`) so each fits one line; the three medication responses (No / Forgot, Unsure, Taken) are a 3-across single-line row. Touches `js/journal.js`, `css/journal.css`, `service-worker.js` (`CACHE_NAME` v177)
- Version bump: `_APP_VERSION` 1.25, `version.json` web channel 1.25, iOS (app+widget) + Android build 25, `service-worker.js` `CACHE_NAME` v178

## v1.24
- 🐛 Focused mode: the **active mood pill's highlight ring** no longer gets clipped by the neighbouring pill to its right — the centred pill now sits above its siblings (`position:relative` + `z-index`, still under the dial arrow) so its full border/outline renders. Touches `css/journal.css`, `service-worker.js` (`CACHE_NAME` v176)
- 🎭 Anonymous board: admin authors are now masked as **"Bipolar Bear Admin"** everywhere on the board (feed posts, thread headers, comments) instead of showing an individual admin monika — presents moderation as one consistent voice. Touches `js/anonymous.js`
- ✨ Anonymous board: a **"Post actions"** guide box added to the ℹ️ About screen, explaining every post-action button (💛 Like, 💬 Comment, 🆘 SOS, 🚨 Report, 🙈 Mute, 🗑️ Remove) plus a "Moderators only" sub-section for the admin buttons (📌 Pin, 🗑️ Delete, 🚫 Ban). Touches `anonymous.html`
- 🎨 Focused mode: the medication wheel now defaults to **"Taken"** (the most common answer) instead of "Unsure"
- ✨ Home: a **"posted today" tick** appears next to Bipolar Anonymous once you've posted or commented on the board today. Touches `index.html`, `js/index.js`, `js/anonymous.js`, `js/journal.js`
- 🎨 Anonymous board header drops its "Anonymous / BipolarBear" wordmark to just the logo icon when the identity pill (monika, streaks, birthday) needs the room. Touches `css/anonymous.css`
- Version bump: `_APP_VERSION` 1.24, `version.json` web channel 1.24, iOS (app+widget) + Android build 24, `service-worker.js` `CACHE_NAME` v140

## v1.23
- 🍏 Bipolar Anonymous gains **iPad support** — `css/anonymous.css` gates the `#iphone-frame` device-mockup on `<html>.is-native` so native iPad renders full-screen (centred 620px column) instead of a fake iPhone on a grey field (the same mockup trap that got the main app's iPad screenshots rejected)
- 🎨 Focused mode: collapse the dead space above the "Additional tracking" step (a new `.fm-flat-top` class collapses the flexible header spacer, since that step has no hero) and block the medication/sleep-quality wheels from settling on their hidden runway slots (`scroll-snap-align:none` on `.fm-wheel-runway`)
- Version-only rebump of the main app to 1.23 / build 23 to keep it in lockstep with the Bipolar Anonymous app (which went to 1.23 for an Android launcher-icon hotfix). The store builds never shipped as 1.22, so the focused-mode wheel work from 1.22 ships here. Bump across web `_APP_VERSION`, iOS (app+widget) + Android

## v1.22
- 🎨 Focused mode: the medication + sleep-quality wheels now **hide their duplicate outer answers**. The 5-pill scroll surface stays (iOS needs it to swipe), but the two outer copies render as invisible runway so only the three distinct answers show. Touches `js/journal.js`, `css/journal.css`
- 🛡️ Anonymous board: **moderation controls on thread comments** — replies inside a thread now carry the same controls the feed posts do (report / mute / SOS, admin delete + ban, self-remove your own comment); previously replies had none. Admin control icons (pin/delete/ban) are kept inside the card. Touches `js/anonymous.js`, `css/anonymous.css`

## v1.21
- ✨ Focused mode: the medication step gains an **"🤷 Unsure"** answer in the middle, for nights you can't quite remember. It shows as Unsure across the calendar, stats and export, and counts as *not taken* for the adherence streak (a definite not-taken, not a neutral)

## v1.20
- 🐛 Focused mode: the medication and sleep-quality steps are **rebuilt as real 5-pill spinner wheels** so they swipe exactly like the mood and energy steps (an earlier special-cased short-wheel implementation never span reliably on iOS)

## v1.19
- 🐛 Focused mode: reworked the short-wheel swipe — deleted the special case and reused the working full-wheel template plus a runway of padding slots, so the shorter medication/sleep-quality wheels spin like the others

## v1.18
- 🐛 Focused mode fixes: swiping the medication step now works properly (native-scroll swipe), and the first step no longer opens with an awkward gap above the question (fresh-first-step spacing)

## v1.17
- 🎨 **Journal redesign** — focused mode reworked into a full-screen, one-question-at-a-time flow with a spinner-wheel option picker, big animated emoji, per-mood/emoji colour auras, Apple Health readouts (e.g. "7h 32m · synced"), a smart mood suggestion derived from your sleep + steps, and a fresh rounded look (Nunito shipped app-wide to match the App Store artwork). Sleep is now asked before energy; a "Reduced motion" badge appears when the OS setting is on. Extensive work across `js/journal.js`, `css/journal.css`
- 🛡️ Anonymous board (Apple UGC 1.2 compliance): a **content filter** on new posts/comments plus **admin user-ban**, so objectionable content and abusive users can be moderated. Duplicate "Today's topic" threads are now impossible; rotated daily topics are archived as BipolarBear posts; example posts rotate weekly with a retention footer
- 🍏 iPad rendering fix: native iPad builds render **full-screen** (no desktop device-frame mockup), with centred home content and a white content panel for the survival kit
- 😴 Journal: sleep is **locked for today/future entries** ("haven't slept yet") to avoid logging a night that hasn't happened
- ✉️ Feedback + beta-signup emails now route to `inbox@jamesmarkey.co.uk`

## v1.14
- 🐛 Fix (guest data loss): data entered during the tutorial as a guest — medications, daily goals, daily budget, coping strategies, mood definitions, mood memories, custom reminders, commitments and gratitude — was saved only to `localStorage`. Creating an account never uploaded that local data to Firestore — the auth listeners only ever pulled settings *down* from the account — so a guest's data was never backed up and disappeared the moment `localStorage` was cleared (app reinstall, storage eviction, switching device/web↔native). A new shared helper `BB.claimGuestData` (`js/shared/guest-data.js`) now backs guest-entered data *up* to `userSettings/{uid}` on sign-in/sign-up whenever the account doesn't already have that value, so guest data is claimed into the new account and survives across devices. Idempotent and non-destructive (it only ever adds data the account is missing, never overwrites an existing account value). Wired into the home, journal, and survival-kit auth listeners. Touches `js/shared/guest-data.js` (new), `index.html`, `journal.html`, `survival-kit.html`, `js/index.js`, `js/journal.js`, `js/survival-kit.js`, `service-worker.js` (`CACHE_NAME` v105)

## v1.13
- 🍎 App Store compliance (Guideline 5.1.1(iv)): removed the cancelable in-app `confirm()` popup that appeared before the HealthKit / Health Connect permission request when enabling the health-sync toggle. Apple flagged it because the message let users dismiss it with "Cancel" without ever reaching the OS permission sheet. Flipping the toggle on is now treated as the deliberate consent action and goes straight to the system permission request — the real consent gate — with no exit button in between. The "why" is still supplied by the toggle's own description label and the Info.plist usage strings. The post-request Settings-deep-link recovery prompt (shown only when iOS suppresses the sheet) is unchanged, as Apple explicitly permits informing the user and linking to Settings. Touches `js/journal.js`, `js/shared/brand-config.js` (`_APP_VERSION` 1.13), `service-worker.js` (`CACHE_NAME` v88)

## v1.5
- 🎨 Home screen: the action buttons (Mood Journal / Survival Kit / Bipolar Anonymous) are now vertically centred in the space between the logo and the bottom FAB dock, with the "Being built by James Markey" credit settling just above the dock — previously they clustered under the logo leaving a large empty gap at the bottom. Implemented in `css/index.css` (a `:not(.is-new-user)`-scoped flex layout; min-height fill on phones, flex-grow inside the ≥920px iPad frame), so the steps 0–3 onboarding layout is untouched
- ⚡ Home stats now appear instantly for returning users. The streak (🔥), stability (🧘), survival-kit progress and anon-monika badges paint synchronously from cached localStorage via a new inline early-paint script in `index.html`, before the four blocking Firebase SDK `<script>` tags load — previously these stayed blurred for ~1s until `js/index.js` ran. Respects the "Show stats" preference, and the async auth listener still refreshes/corrects the values afterwards
- 🎨 Marketing/welcome page: the mobile hero gains a faded happy-bear backdrop in the top-right, so it no longer feels bare before you scroll to the interactive mood-meter (the decorative floaties are hidden at phone widths). Desktop is unchanged. Touches `welcome.html`, `css/welcome.css`
- 🐛 Fix (follow-up): users with the "Show stats" preference off no longer see the blurred skeleton placeholders flash for ~1s before vanishing — the early-paint script now applies the `bb-hide-stats` gate class synchronously when stats are off, instead of waiting for `js/index.js`

## v1.4
- ✨ **Wiki** — new 📖 tab on the Bipolar Anonymous board with peer-friendly reference material. Sub-section pills: **Medications**, **Support Groups**, **Community Wisdom**, **Conditions** (Bipolar I/II, Cyclothymia, NOS, Rapid Cycling, Mixed Features, Seasonal Pattern, MDD, Anxiety Disorders, ADHD, BPD/EUPD, Schizophrenia & Schizoaffective), **Therapies**, **Lifestyle**, **Warning Signs**, **Side Effects**, **Hospital**, **Workplace**, **Pregnancy**, **Books & Films**, and **For Loved Ones** (early signs, what to say, helping through mania / depression, carer wellbeing, carer rights, when to call for help). Medication data is now extracted to a shared `js/shared/medications.js` so the survival kit and Anonymous Wiki read from one source
- ✨ Wiki **search FAB** — 🔍 toggles an inline search bar that filters cards within the active sub-section. Wiki strings are wired through the i18n system (English populated; other locales fall back gracefully)
- 🎨 Wiki pill chips stack across two rows on mobile (<520px); both rows are independently scrollable with an edge-fade mask indicating more pills off-screen. First open per session triggers a one-time peek nudge so the rows are clearly swipeable
- 🎨 Tapping a wiki pill now smooth-scrolls the pill to the left edge of its row to reveal more pills
- ✨ Mobile UX: `touch-action: manipulation` on the anonymous, beta, and privacy pages eliminates the 300 ms double-tap-zoom delay, making buttons feel instant
- 📄 Privacy policy section 7 (Account Deletion) expanded into a Google Play–compliant guide covering in-app deletion, what's removed vs retained, and contact paths for guest users

## v1.3
- 🔒 Security: Bipolar Anonymous email-code verification hardened — the wrong-attempt counter now runs inside a Firestore transaction, so a parallel burst can no longer slip past the 5-attempt budget. Codes widened from 4 to 6 digits and switched to `crypto.randomInt` (1,000,000 keyspace, cryptographically random) with a constant-time comparison. The verify screen now shows 6 input boxes.
- 🔒 Security: Anonymous community board renderers (`renderPost`, `renderThreadHeader`, `renderComment`, `renderSystem`) now whitelist gradient colours and number-coerce streak/stable/likes before HTML interpolation — previously a Firestore-stored post could break out of the inline `style` attribute and run JS in other viewers' sessions.

## v1.2
- ✨ Settings & auth FAB now appears after your first journal entry — no need to complete the full tutorial before you can sign in or access settings

## v1.1
- ✨ Signing into Bipolar Anonymous with a BipolarBear email now pulls your stability streak and account birthday from BipolarBear automatically — no need to have visited the board while logged into BB first. A new `getBBStats` Cloud Function looks up the linked account server-side after email-code verification and pre-fills `Anon_stableSince`, `Anon_stableStreak`, and `Anon_joinedAt` where those values are absent
- 🐛 Fix: BipolarBear users' stability streak (`stableStreakStart`) now propagates to the `anonProfiles` mirror on first board visit, so the standalone email-code path sees the correct stable-since date on a fresh device

## v1.0
- 🐛 Fix: Signed-out home no longer shows the previous account's streak/anon stats. The auth listener's no-user branch now hides `journalStreakBadge`, `anonStreakBadge`, and `anonMessagesBadge` for users without their own guest-PIN data, and the synchronous initial `_updateStreakBadge()` is gated on a cached Firebase user (any `firebase:authUser:*` key in localStorage) or on `bbGuestPinSalt` so the previous account's badges never flash before the auth listener resolves
- 🐛 Fix: On mobile, tapping Journal/Survival Kit while signed in no longer bounces back to the home page when stale `bbGuestPinSalt` localStorage is present. The synchronous PIN gate at the top of `journal.html` and `survival-kit.html` now skips the guest-PIN check for users with a cached Firebase auth user — signed-in users use account-derived encryption, not the guest PIN, so the stale salt was redirecting them away from journal.js's own cleanup path. The `guestPinOverlay` IIFE in `js/index.js` got the same treatment so they aren't trapped on an unenterable PIN dialog on the home screen either. The native-app PIN gate (`bbNativePinEnabled`) still applies regardless of sign-in state
- ✨ App version is now displayed in the auth and account modals (the profile FAB popup) — handy for bug reports. Format: "v1.0 · web" (or "iOS" / "Android" / "PWA"). `window._APP_VERSION` moved from `js/index.js` into `js/shared/brand-config.js` so every page (and `fab.js`) reads the same value without depending on index.js loading first

## v0.98
- 🐛 Fix: After signing in on a new device, journal streak (`bbCurrentStreak`) and stability (`bbStableStreak`) now load from Firestore (`userSettings.currentStreak`) immediately on the home page — previously the streak badge under the Journal button stayed hidden until the user opened the journal page (where `loadEntries()` recalculated and saved the streak)
- 🐛 Fix: `bbCurrentStreak` is now persisted to Firestore alongside `stableStreak` whenever entries reload — completes the cross-device sync loop
- 🐛 Fix: Achievement toasts no longer re-fire on a new device — `unlockedAchievements` now syncs to/from Firestore on sign-in, so already-earned achievements like "3-Day Streak" don't pop up when logging an entry on a new install
- 🐛 Fix: Sign-out now clears `bbCurrentStreak`, `bbStableStreak`, `bbAnon_streak`, `bbAnon_monika`, `bbAnon_verified`, `bbAnonLastVisit` from localStorage — previously these leaked across accounts (e.g. signing into a fresh account showed the previous user's "49d stability")
- 🐛 Fix: Sign-out now hides `journalStreakBadge`, `anonStreakBadge`, and `anonMessagesBadge` and resets the survival kit progress text to "5 / 13" — UI no longer keeps showing the previous account's stats
- 🐛 Fix: Bipolar Anonymous monika and verified flag now sync from Firestore (`anonProfile.monika`, `anonProfile.verified`) on sign-in — anon FAB badge ("👋 monika · 💬 streak"), monika display, and the new-messages badge populate without needing to visit the board first. `_bbSaveProfile()` in `anonymous.html` now writes `verified` into `anonProfile`
- ✨ FAB dock customisation now syncs across devices — slot assignments (`bbFabSlot_1`–`bbFabSlot_4`) and hidden flags (`bbWaFabHidden`, `bbQuickNoteFabHidden`, `bbCoffeeFabHidden`, `bbFeedbackFabHidden`, `bbFooterHidden`) are saved to `userSettings.fabState` via a new `_syncFabsToFirestore()` helper in `fab.js`, called after every picker assignment, hide-permanently action, and extra-FAB hide. Restored on sign-in in `index.html`'s `auth.onAuthStateChanged` handler with `_applyFabDock()` re-run

## v0.97
- 🐛 Fix: Reminder & weekly summary toggles in Mobile Settings now persist instantly when toggled — previously the "← Back" button only swapped panels without writing to localStorage, so unsaved toggles were lost on modal close
- ✨ Toggles now request iOS notification permission inline (`LocalNotifications.requestPermissions()`) — if denied, the toggle reverts and a clear "Blocked in iOS Settings → BipolarBear → Notifications" alert appears
- ✨ `reminderEnabled`, `reminderTime`, and `weeklySummaryEnabled` now sync to Firestore (`userSettings` doc) and load on login — settings persist across devices on the same account
- On login, `scheduleReminder()` is re-run on the new device using the synced settings; weekly summary reschedules via the existing entries-load flow
- Auto-save replaces the old reminder block in `saveSettings()` (which only fired when the main Save button was tapped)
- ✨ Bipolar Anonymous: returning signed-in users with a cached monika now go straight to the board — synchronous pre-activation script in `anonymous.html` activates `screen-board` before Firebase auth + `_bbRestoreProfile` resolve, eliminating the verify-screen flash. `bbAnon_verified='true'` is now also set for BB App users on successful boot so the next visit hits the fast path
- 🎨 Bipolar Anonymous: `renderPosts()` now collapses runs of deleted posts to a single tombstone — keeps the most recent deleted (first in newest-first order) and drops the rest, so admins removing spam don't leave a wall of "post deleted" entries
- ✨ New-user tutorial: Bipolar Anonymous button and profile/sign-in FAB are now hidden until the tutorial complete toast is dismissed (`bbFabsUnlocked`). Step 4 (sign-in blocking screen) is auto-skipped since the auth button is no longer shown mid-tutorial — users can sign in after exploring the app

## v0.96
- 🌐 Hosting migrated from GitHub Pages to **Cloudflare Pages** — auto-deploys from GitHub on every push to `main`
- 🌐 `bipolaranonymous.app` added as alias domain — serves identical content to `bipolarbear.app`, URL bar stays as the visited domain; nameservers managed via Namecheap → Cloudflare
- 🔐 `bipolaranonymous.app` added to Firebase Auth authorised domains so sign-in works from both domains

## v0.95
- 🎨 App background gradient softened from saturated orange (`#ff9500 → #ff6b00`) to a warmer amber (`#ffaa33 → #ff8833`) across all pages — easier on the eyes

## v0.94
- 🐛 Fix: Tutorial-complete popup no longer appears on every login for users who completed the tutorial before cloud persistence was added
- 🐛 Fix: FAB dock (settings access) was sometimes locked in journal after login — `bbFabsUnlocked` now set before `_applyOnboardingGating()` runs
- 🐛 Fix: "Survival kit filled in" celebration toast no longer re-fires on a new device/browser — `bbSurvivalCelebDone` now silently set on login when tutorial is complete
- 🐛 Fix: Tutorial flags are now all set before the survival tick is updated, so the MutationObserver cannot trigger stale celebration toasts
- ✨ All tutorial completion flags are silently reconciled on login — no popups, hints, or toasts fire for users who have already finished the tutorial

## v0.93
- ✨ Button sub-labels on the home screen (🔥 streak, survival progress, anonymous badge) now share a consistent style via `.btn-subnote` and `.btn-subnote-muted` CSS classes
- 🐛 Fix: Survival kit progress label now correctly shows when sections are incomplete (was using `style.display = ''` which resolved to the class default of `none`)

## v0.92
- ✨ "New messages" badge under Bipolar Anonymous button on home screen — shows count of posts since last visit, or "✓ No new messages" if up to date; first-time visitors see "💬 Tap to join the community"
- `bbAnonLastVisit` timestamp written to localStorage when the board is entered

## v0.91
- ✨ Day streak badge under Mood Journal button on home screen — shows 🔥 N days based on `bbCurrentStreak` (calculated in journal.html and cached to localStorage)

## v0.90
- ✨ **Bipolar Anonymous** — new `anonymous.html` page: email-verified anonymous community board
  - Email field locked to BipolarBear account email (read-only); page blocked if not signed in
  - 4-digit verification code sent via Resend API (Cloud Function `sendAnonCode`)
  - Paste-to-fill across code boxes; resend and back-to-email buttons
  - Error handling for wrong code, expired session, rate limit, and session not found
  - Board auto-unlocked (`bbAnon_verified`) after successful verification
  - Signed out of board if Firebase Auth session ends
- ✨ **Cloud Functions** (`functions/index.js`) — Firebase Functions v2, deployed to `europe-west1`
  - `sendAnonCode` — rate-limited (3 per 10 min), generates code, writes to `anonVerify` collection, sends email via Resend; `invoker: 'public'`
  - `verifyAnonCode` — validates code, checks TTL, marks session verified; `invoker: 'public'`
  - From address: `BipolarBear <verify@bipolarbear.app>` (domain verified in Resend)
  - Secret: `RESEND_API_KEY` stored in Firebase Secret Manager
- ✨ Node runtime upgraded from 20 → 22 in `functions/package.json`
- ✨ Firebase project upgraded to **Blaze plan** (required for Cloud Functions + Secret Manager)
- ✨ Admin accounts (`profile.isAdmin`) no longer see double delete button on their own posts
- 🐛 Fix: `firebase.app().functions('europe-west1')` used instead of `firebase.functions('europe-west1')` — the latter treated the region string as an app name in the compat SDK
- 🐛 Fix: Compound Firestore query (`email` + `createdAt`) replaced with single-field query + JS filter to avoid requiring a composite index

## v0.89
- ✨ "Change email" added to account modal (fab.js) — re-auth required, then `user.updateEmail()`
- 🐛 Fix: Guest PIN (`bbGuestPinSalt`) was not tied to a specific account UID, causing lock-out when switching accounts — `bbPinLinkedUID` now stores the owning UID; mismatched PIN cleared on sign-in
- 🐛 Fix: `bbTutorialToastShown` removed from logout `keysToRemove` array and instead persisted to Firestore (`tutorialToastShown: true`) so "tutorial complete" popup never repeats across devices

## v0.88
- ✨ FAB dock buttons now consistent across all three pages — Chat, Coffee, E2EE, and Feedback all open modals on index, journal, and survival kit
- ✨ Guest data deletion added to sign-in screen — wipes all data and restarts as new user
- 🐛 Fix: "Forgot PIN?" on guest PIN screen now performs a full data wipe and restart (previously only removed the PIN lock, leaving data in place — a data risk)
- 🐛 Fix: FAB hide confirmation modal removed — tapping "Hide this button" now hides immediately; buttons can always be re-added via the + dock picker
- 🐛 Fix: FABs introduced in v0.87 now render correctly on page load (TDZ bug where `_FAB_DEFAULTS` was referenced before definition)
- 🐛 Fix: Re-adding a hidden default FAB via the picker now places it in the chosen slot, not its original hardcoded position
- 🎨 Survival kit dock footer changed to white with orange top border

## v0.87
- ✨ "What's New" popup: shown once per version update to tutorial-complete users — headline feature + "Full changelog" link that opens the changelog in the journal

## v0.86
- ✨ FAB picker now lists hidden default buttons (Chat, E2EE, Coffee, Feedback) so they can be re-added to the dock
- ✨ All FABs — including extra ones (Stats, Celebrity, Goals, Quick Note) — have a "Hide this button" option; hidden buttons return to the picker
- ✨ Celebrity popup loads real Wikipedia photos
- 🐛 Fix: Quick Note hide button now removes the extra FAB from its slot (previously it accidentally hid the E2EE button)
- 🎨 Survival Kit dock footer reverted to orange gradient
- 🎨 Hide button text no longer says "permanently" since all buttons can be re-added via the + placeholder

## v0.85
- ✨ Full dock (Chat, E2EE, Coffee, Feedback) now synced across index, journal, and survival kit — hiding a button on one page hides it everywhere
- ✨ Empty dock slots show a dotted `+` placeholder; tapping opens a picker to assign Stats 📊, Celebrity ⭐, Goals 🎯, or Quick Note 📝
- ✨ Journal and survival-kit FAB footer changed to white background, matching index
- ✨ Settings FAB (⚙️) replaces profile icon in journal dock when logged in; tapping it opens the settings modal
- 🐛 Fix: Duplicate 🔐 E2EE FAB no longer appears when Feedback is permanently hidden (removed securityFab fallback)
- 🐛 Fix: Settings-button tutorial hints auto-skipped since settings button moved to dock FAB

## v0.71
- Beta gate: skip redirect when running from local file (file: protocol) so app works when opened directly from disk
- Survival kit sticky nav: Home link moved out of scrollable strip into its own fixed left cell; arrow pointer angle recalculated from final rendered position (not screen centre)
- Journal: Home link and post-delete redirect use file-safe location.replace; arrow pointer angle fix matches survival kit
- Journal settings: advanced settings badge hint correctly shown/hidden when settings panel closes

## v0.60
- Customise form: toggle individual steps on/off (energy, sleep, sleep quality, meds, additional, notes) via Journal Options; master switch; default is all active except sleep quality
- Reset settings now restores customise form defaults (all active except sleep quality)
- Energy step disabled → saves null instead of default "Normal"; done step summary hides energy row when not selected
- Sleep sync UX: resync button hidden while a synced value is active (reappears after Undo); banner colour matches the sleep range bucket; mobile hover effects disabled (tap flash only); editing sleep from summary bar visits sleep quality step before returning to done
- Focus mode notes: preserved when navigating between steps (synced to #notes textarea before content swap)
- Elaborate Responses: step notes element re-appended correctly in confirm-step mode; step notes and intention loaded from saved entry when editing in focused mode
- Medication step: correctly included when opening focused mode via + Log today
- Survival kit: rounded header bottom (border-radius 0 0 32px 32px) for smooth transition into nav bar

## v0.59
- 📝 Elaborate Responses setting: per-step notes in focused mode, combined into tomorrow's intention field on save
- Budget "Additional Info" inline note when over budget (Elaborate Responses mode)
- Stats timeframe picker: 30d / 60d / 90d / custom days (with pencil to re-edit) / All time — replaces tap-cycle
- Year calendar legend moved above streak card; uniform 12×12 squares ordered by frequency
- Monthly calendar mood key filtered to current month only
- Sleep sync: actual float hours saved from HealthKit; synced banner + undo button in focused sleep step
- Edit / add tomorrow's intention directly from past entry popup
- Survival kit: section completion ticks (✅/⬜) on medications, goals, mind, coping, memories, steps
- Survival kit: karma ← → navigation with back-history (mirrors celebrity carousel)
- Survival kit: safe-area notch colour matches orange header
- Stable mood entry: secondary mood no longer shown in Bear thought
- Double-click save guard prevents duplicate entries on rapid taps
- Personalised feedback: correlations with |r| < 0.1 filtered out
- Custom field name conflict: duplicate default hidden if user already has identically-named field
- More data: clicking a selected response button now deselects it
- Built-in reverse fields (Alcohol, Added Sugar) support emoji picker in field editor

## v0.58
- Focused mode colour scheme changes with selected mood (card background, progress dots, Next button)
- Hover colours on energy level, sleep hours, medication and more data buttons; text goes black & bold on hover
- ✕ Close button always shown on step 0 of focused mode (exits to overview)
- Greyed-out Save button on done step navigates to mood step instead of saving
- Samaritans (116 123) and user's emergency contact shown on depressed care popup
- Auto advance toggle on more data step; (+) button recentred
- Form centering fixed when opening focused mode or starting a new entry
- Sleep quality hover colours in both focused and regular forms
- Goal progress buttons in more data now have correct orange/green hover colours

## v0.57
- Advanced settings split: Journal Options on main advanced page; Stats start date, PDF export, Delete data moved to "More" sub-page
- Intention for tomorrow disabled by default; enable via Advanced → Journal Options
- 💾 save shortcut moved from top bar into summary icon bar (appears after notes chip)
- Delete confirmation z-index fixed — no longer hidden behind field picker modal
- Alcohol & Added Sugar names editable from Track Data / Additional Data popups
- Gone Outside and all built-in deletable fields now show delete confirmation dialog
- Bipolar Bear shows two adjacent mood suggestions with separate "Use" buttons
- Celebrity carousel back button; Strategies & Memories hide content until mood is selected

## v0.56
- Sleep quality (Bad / Unsure / Good) step added to both focused and regular forms; sleep chip in focused summary bar colours red/grey/green to match
- Focused mode notes page: live word counter updates as you type; Intention for tomorrow added as a collapsible section
- Added Sugar default tracking field (off by default); styled orange, No = positive/green direction
- Exercise, Outside, Emotions (was Anxiety), Alcohol now deletable from the field picker
- Deactivating a field while editing an entry now removes its data on save
- Emotions toggle in regular form correctly shows/hides stress and irritability rows
- Done step: entry date shown above the summary; long rows now wrap (no overflow)
- "Open by default" switch fixed; all focused mode response buttons uniformly orange
- Energy suggestion thresholds: 3k–9,999 = Normal, 10k–19,999 = More than usual, 20k+ = Too much

## v0.55
- Day overview shows Bipolar Bear's suggested mood (collapsible)
- Goals question simplified to Yes / No
- Steps & sleep import auto-highlights suggested option (focused mode doesn't auto-advance)
- Year calendar key squares sized by frequency; click to open mood breakdown
- Most common mood popup shows count and percentage (e.g. 212d | 78%)
- Achievements: "Full Spectrum" and "Stable Week" now use correct mood labels
- Offline banner moved to bottom to avoid phone notch
- Focused mode: delete stays in focused mode; mood long-press works on desktop too
- Bear suggested mood setting now persists across app restarts
- One-time tip shown first time mood selector appears (tap again / long press)
- Entry log: achievements shown on their own line (no stray pipe)
- Field picker scrolls to custom emoji section when opened
- Survival kit: mood section no longer changes page height during auto-cycle
- Survival kit: memories section cycles through moods with fixed height
- Survival kit: reminder edit/delete buttons stay inline with title

## v0.54
- Tap & hold on images no longer shows iOS native popup (-webkit-touch-callout: none on all pages)
- "Switch back to full form" link moved to below the focused mode card, above Open Journal button
- Survival kit sticky nav repositioned above the header title — sticks at top with notch padding as you scroll, name scrolls below it
- Mood suggestion ℹ️ info button added — explains how the score is calculated (energy, sleep, medication, etc.)
- All hover effects now guarded by `@media (hover: hover) and (pointer: fine)` — fixes iOS sticky-hover after closing popups
- PIN and focused mode settings (focusedModeEnabled, moreDataOpenByDefault, showMoodSuggestion) now reset on delete-all, logout, and new-user login
- "Gone outside" tracking field defaults to on for new users; all other extras default to off
- Focused mode: toggling an extra field on the "Anything else?" step live-updates the step count; 🗑️ delete button now always shown on done step (exits/resets for new entries, deletes for edits)
- Personalised guide title (James' / Jude's Bipolar Survival Kit) sourced from Personal Details name field

## v0.53
- Completed entry banner now shows "✅ View today's/yesterday's entry" button that opens the full entry overview popup
- Entry overview popup (calendar day detail) and favourites detail popup now show steps inline with energy (e.g. 7/10 | 🏃 5k)
- Focused mode budget step: shows current budget value with a Change button; if no budget set, shows a Set daily budget prompt
- Focused mode goals step: adds a "View / Edit Goals" link below the options
- Focused mode mood step: tap & hold (600ms) any mood icon to show its full definition popup; hint text shown below selector
- Depressed mood in focused mode: tapping it shows a supportive ♥️ message before proceeding to the next step
- Focused mode done step: 🗑️ delete button shown to the left of Save Entry when editing an existing entry
- PIN now cleared on pagehide — asked every time the journal is opened, not just once per session
- Bug: import steps in focused mode no longer auto-closes the form during health sync (_healthSyncInProgress guard on _fmNext)
- Login now clears bb_entryStatus cache so home screen journal/survival ticks refresh immediately
- Pagination ‹ › (prev/next single page) buttons removed; « » (first/last) remain
- Survival guide sticky nav background matches header gradient (seamless orange)
- Journal entries section silently closes when the user interacts with the entry form

## v0.52
- Sleep sync now shows "← suggested" on closest range button without auto-selecting (matches steps behaviour)
- Focused mode sleep: visible success/fail/no-data feedback on the sync button itself
- Delete all entries now resets focused mode, bear suggestion, and more-data-open-by-default settings to defaults
- Journal page scrollbar hidden; survival guide retains its scrollbar
- Focused mode "anything else?" + button is now a proper circle (min-width/height + flex-shrink fix)
- WhatsApp FAB close no longer causes the survival button to flash white (tap-highlight fix)

## v0.51
- Anxiety, stress & irritability now use relative labels: Less than usual / Normal / More than usual
- Corrected mood scoring direction: more anxiety/stress = depressed direction; less = stable/manic
- Irritability expanded from yes/no to three options matching relative scale
- Bear suggested mood (BETA): collapsible suggestion panel on save screen, opt-in toggle in Advanced settings
- Bear suggestion: Update mood button switches to Undo after tapping; X button to permanently hide with confirmation
- Focused mode: mood step now renders full mood-selector grid matching the regular form
- Focused mode: heading dynamically shows "How was yesterday?" / "How is today going?" etc.
- Focused mode: form closes correctly after saving; no longer re-opens focused card post-save
- Focused mode: smooth scroll to card top on every step advance
- Advanced settings: delete all entries replaced with bin icon in header (matching form style)
- Advanced settings: Journal Options section with Bear mood, Focus mode, More data toggles; logging button at bottom
- Tick caches cleared on delete all entries so home screen journal/survival buttons reset correctly

## v0.50
- Focused mode: energy and sleep have no preselection — nothing highlighted until you tap
- Focused mode energy step: "Sync Steps from Health" button with step count and suggested energy level
- Energy label "High" renamed to "Energetic" throughout the app
- Focused mode medication step: more robust display; falls back to "Your medications" if names can't be read
- Switching back to full form from focused mode now turns off the focused mode preference (🎯 goes grey)
- Regular form: tapping Save now shows a summary confirmation before committing the entry
- PIN lock button added to main settings panel (not just Advanced)

## v0.49
- PIN lock syncs to Firestore — set once and it works across all your devices
- PIN cleared from device on logout so the next user/account isn't locked out
- Session auto-unlock after email sign-in (no double-auth on fresh login)

## v0.48
- First-time hint toasts for 🕵️ (private mode) and ★ (favourite) — shown only on first use
- Alcohol buttons reordered (Yes left, No right); Yes highlighted red when selected
- Calendar header is now tappable — opens month/year picker with two dropdowns (supports future months)
- Sleep hours label shown in button when editing a saved entry or restoring a draft with sleep data
- "Recommendations" sub-header added above action tags in all mood detail panels in survival guide
- "Bipolar UK Definition" collapsible now labelled "— click here" when collapsed
- "Open section by default" toggle moved from form into Settings
- Survival guide goals input converted to fixed-overlay popup (fixes iOS scroll-behind issue)
- Fixed: WhatsApp hint now shows before Feedback hint after hint reset; pagehide no longer marks WA hint done before user sees it
- Fixed: Entry tick on home screen no longer deactivates after Firestore cache returns empty snapshot
- Fixed: PIN and unlock state cleared on logout (PIN no longer persists across account switches)

## v0.47
- Journal button on home screen shows 🔒 / 🔓 based on PIN lock state
- PIN lock: set a 4-digit PIN in Settings → Advanced to lock the journal on open; AppIcon shown on PIN entry screen
- Generate Wall Tracker now works on native iOS (Filesystem + Share sheet instead of doc.save)

## v0.46
- WhatsApp Group button added to home screen (native only) with a label hint; feedback hint shown sequentially after WhatsApp hint dismissed
- Survival guide sticky nav scrolling improved (GPU-accelerated); personal details link added to survival guide
- Alternate app icon switching fixed on iOS (storyboard BridgeViewController class corrected)

## v0.45
- Energy button shows imported steps inline (⚡ Energy | 5k); entry cards show energy label (None/Low/Fine/High/Full) and sleep range (≤5h/6-7h/7-8h/8-9h/9+h) instead of raw numbers
- Mood popups: bipolar UK definition collapses behind a toggle when a personal definition exists
- Tapping 🗓️ calendar icon now immediately opens the native date picker (no intermediate hidden row)
- Notes textarea is taller; "More data" section has "Open by default?" toggle
- Goals renamed to "5 Yr Goals" throughout the form
- Personal details link moved below the login footer in the entries list; Logging Yesterday/Today toggle moved to its spot in Advanced Settings
- Fixed: clicking + to log the other date now shows draft correctly (editingEntry was not being cleared)
- Fixed: "Review" button now opens the entry in edit mode even when date was stored as ISO string

## v0.44
- Favourite entries — tap ☆ on the form to star an entry; browse starred entries from the All-Time Stats "Favourite Entries" card
- Hover effects fully removed from all inline onmouseover/onmouseout handlers across all pages — no more sticky hover states on iPhone for any button or card

## v0.43
- Entry cards in the journal list now show 🔋 for energy and 😴 for sleep; more-data fields grouped into an "Achievements:" emoji section
- Steps shown next to the sleep label when editing an entry that already has step data saved
- Settings button now reliably tappable on mobile (iOS pointer-events fix)
- All hover effects disabled on touch screens throughout the app (no more sticky-hover on mood buttons etc.)
- Form stays open when app is minimised mid-entry (resume guard now checks form visibility)
- Survival guide navigation bar centred horizontally on desktop web

## v0.42
- Budget tracking field — enable "💰 Budget" via the More Data field picker, tap the label to set a daily limit (e.g. £50 daily), then log Yes/No each day
- Budget synced between journal and survival guide (Goals section)
- "How was..." heading now updates correctly when selecting a date from the month calendar

## v0.41
- Favourite entries — tap ☆ on the form to star an entry; browse starred entries from All-Time Stats card
- Missing entries popup no longer counts today as missing when the app is set to log yesterday
- All-Time Stats toggle button only appears after 30 entries are logged
- Backup download now works on iPhone — uses native share sheet instead of unsupported anchor download

## v0.40
- More data panel Done button no longer scrolls out of view
- Goals field correctly resets when opening a new entry after editing another
- Delete (🗑️) button no longer appears before a mood is selected when editing
- Fixed: visiting the beta page then journal no longer causes empty entries or broken UI (anonymous auth no longer treated as signed-in account)
- Survival Kit — coping strategies and memories sections pre-select "Good" mood on load
- Survival Kit — memory entries now have an ✏️ edit button

## v0.39
- Mood cycle animation now restarts correctly when opening a new entry after a previous edit or mood tap
- Home screen confetti fires on every visit when both ticks are complete (not throttled)

## v0.38
- Mood popup in journal now shows the last recorded memory for that mood from the Survival Kit
- New achievements: 💭 Memory Keeper (first mood memory recorded) and 🤝 Committed (first commitment added)

## v0.37
- Settings modal — close button saves and dismisses (no separate Save button)
- Survival Kit nav — Home button pinned to left, Help button pinned to right; other tabs scroll behind both

## v0.36
- Favourite entries — star any entry from the form; browse all favourites from All-Time Stats card
- Favourite anniversary notification — when a favourite entry is saved, a local notification is scheduled for the same date next year; tapping it shows all favourite entries from that date across all years; "Show again next year" reschedules for the following year
- Survival Kit "You're in good company" and random quote card backgrounds changed to white

## v0.35
- Sleep import fix — iOS HealthKit plugin now respects the query date window; correctly picks previous night's sleep
- Survival Kit page no longer jumps to top after saving a definition/strategy (requestAnimationFrame scroll restore)
- Goals management moved inline into the section (no popup modal)
- Home screen button ticks remain visible on hover (orange invert)
- Home screen tick checks Firestore on launch when local cache is missing or stale

## v0.34
- Mood memories — record personal memories linked to each mood in Survival Kit; shown in journal mood popup
- Survival Kit modal scroll fix on iPhone (body-lock prevents keyboard pushing content)
- 12 Steps section replaced with cycling card (Step X of 12) with Prev / Next navigation
- Your Commitments — personal slide deck below 12 Steps with add, edit and delete
- Custom reminders in Struggling? section — add your own title + message accordions
- More data button smooth scrolls to notes when expanded

## v0.33
- Delete current entry now immediately closes the form and clears the home screen tick
- Survival Kit tick on home screen — requires at least one entry in all 4 sections (mood definition, coping strategy, medication, goal)
- Achievements for each individual Survival Kit section, plus combined "Fully Prepared" achievement; toasts fire on the Survival Kit page directly
- Most common mood stat card shows 🥇 / 🥈 podium (with = marker when 2nd place is tied)
- Stats cards vertically centred
- Field picker scroll fade at bottom to indicate more options below

## v0.32
- Favourite entries — star any entry from the form, browse all favourites from All-Time Stats
- Clear draft button on the entry form (bin icon, appears after mood selected)
- "Back" button from edit mode now shows loading spinner while entries reload
- Missing entries pill always visible when complete banner shown; muted style when none missing
- Survival Kit button (🧰) in journal header, inline with ← Home
- Mood definitions in Survival Guide — add your own personal definition per mood, synced to journal
- Mood popup (double-tap mood) shows your definition and Bipolar UK description with link
- Health sleep sync window extended to noon next day (captures overnight sleep ending next morning)
- Total days popup now colour-coded per mood with label

## v0.31
- Coping strategies in Survival Guide — add strategies per mood, synced to journal
- Mood popup in journal shows your coping strategies for that mood
- Draft auto-save: entries in progress are saved locally and restored on return
- PDF export: per-entry hide checkbox + global default setting in Settings
- Delete button when editing an entry in the form
- "Log today's entry" shortcut when yesterday's entry is already complete
- Form heading adapts to date: "How is today going?" / "How was yesterday?"
- Health import now uses the form date (fixes sleep/steps import for today's entry)
- Complete banner and action pills use muted styling; Open Journal button more prominent
- Back button when editing an entry

## v0.30
- Yesterday, today and tomorrow marked in the monthly calendar

## v0.29
- "You're in good company" card in Survival Guide showing famous people with bipolar
- Fixed people helped counter showing wrong number after un-voting then re-voting

## v0.28
- Streak in All-Time Stats now accounts for yesterday mode

## v0.27
- Prevented flash of previous content when opening the journal

## v0.26
- Fixed issues relating to sign in / sign out

## v0.25
- Submit button says "Log Yesterday's Entry ✨" when in yesterday mode
- Stats chart (year/month calendar) now switches immediately when toggling 30d / All-Time
- Missing entries count no longer flags yesterday as missing before you've logged it
- "What is r?" in personalised feedback scrolls into view when expanded
- Widget logo enlarged

## v0.24
- Reduced header space on journal page, especially in landscape orientation
- All-Time Stats button no longer causes page scroll on first tap
- Opening a new entry from the calendar now always starts with a blank form
- Advanced Settings layout reordered: Delete All at top, log yesterday/today toggle above stats date
- Stats Start Date Save button moved inline with Clear

## v0.23
- Journal defaults to logging yesterday's entry (better for reviewing steps/goals objectively)
- "Yesterday's entry complete | Edit" banner when yesterday is already filled in
- Delete button added to calendar day popup
- Toggle in Advanced Settings to switch between yesterday / today default mode
- Yesterday/today preference syncs across devices via Firestore

## v0.22
- Tap a selected mood a second time to see its definition
- App icon changes with the logo when using the 5-tap easter egg
- Mood definitions and icon cycle work across all three pages

## v0.21
- "Outside" renamed to "Gone outside" in the field picker
- Steps in entry history now shown to the nearest thousand (e.g. 3k)
- Custom tracking fields in entry history show emoji only (not label text)
- Separator line between Personal Details and Delete All Entries in Advanced Settings

## v0.2 — Major Release
- Add your own custom yes/no tracking fields with emoji labels
- Field picker to choose which data fields appear when logging
- Field picker is context-aware when editing past entries
- Edit and delete custom fields inline
- Calendar days with no entry show an Add entry button
- Custom fields included in statistics, PDF export, and entry history
- Separate people helped counter for the native app (starts at 1)
- Substances renamed to Drugs in field picker

## v0.12
- Field picker shows entry's active fields when editing a past entry (not global prefs)
- Custom tracking fields support emoji labels (emoji picker in add form)
- Custom field name limit reduced to 20 characters

## v0.11
- "More data" fields are now all optional — none active by default
- Orange ⊕ button inside "More data" opens a field picker to toggle tracking on/off
- Tracking preferences sync across devices via Firestore
- Tracking toggles removed from Personal Details

## v0.10
- Calendar day popup now has an ✏️ edit button to open the entry directly in the form

## v0.09
- Emotional tracking split into separate anxiety, stress & irritability toggles
- No / Yes buttons now fill the same width as three-option rows (50/50)
- "What does r mean?" moved to below personalised insights
- Karma & Spirit section: rotating quote card with 50 sourced quotes
- Quotes cycle across different traditions (no two consecutive from same source)

## v0.08
- Tap any selected choice a second time to deselect it
- Fixed: alcohol & tracking fields now show correctly when editing today's entry
- Fixed: health sync no longer auto-closes the edit form
- Editing past entries now shows only the fields you recorded (plus any newly enabled)
- Version number opens changelog modal
- "Bipolar Disorder" section renamed to "Bipolar"
- Mood icons scroll to section on first tap only

## v0.07
- Calendar day popup with ghost-tap fix
- Fixed journal loading after home → journal → home → journal navigation
- Single loading animation covering both form and journal sections
- Achievements gallery in settings
