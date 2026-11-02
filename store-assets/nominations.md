# App Store featuring nominations — Bipolar Bear and Bipolar Anonymous

**Three DRAFTS are in App Store Connect (created 2026-11-02 through the API),
none submitted.** Nothing reaches Apple until **Submit** is pressed: ASC → Apps
→ Featuring → Nominations, open each draft, check it, press Submit. Apple wants
at least 3 weeks' notice; up to 3 months ahead widens the chance.

| Draft | Type | Apps | Publish window | ID |
|---|---|---|---|---|
| World Bipolar Day | New Content | Bear + Anonymous | 23–31 Mar 2027 | `b302aff0-3cfa-400d-9aeb-a8bab24545fd` |
| Bipolar Bear | App Enhancements | Bear | from 23 Nov 2026 | `511d6d37-7f23-46a1-93f8-defcad59cab5` |
| Bipolar Anonymous | App Enhancements | Anonymous | from 23 Nov 2026 | `5754ade6-b573-425b-bfd6-1a6cef9df59f` |

All three: iPhone + iPad, notes = "Helpful details" below. The API takes
nominations (`POST /v1/nominations`, `submitted: false` = draft;
`asc-nominations.mjs` here made these; read them back with
`node Docs_UNI_SIM/store-kit/asc.mjs GET '/v1/nominations?filter[state]=DRAFT'`).
Its texts live in `nominations/*.txt`. ⚠️ Re-running it makes duplicates; edit
a draft with PATCH `/v1/nominations/<id>` instead.

Facts to keep honest (DOCS §2.17, CHANGELOG): only **Private journal** is
readable by its owner alone (Standard keeps a spare key); board posts are NOT
end-to-end encrypted; Bipolar Bear is not a medical device.

## 1. World Bipolar Day, 30 March 2027 (New Content, both apps)

- **Name:** World Bipolar Day: Bipolar Bear and Bipolar Anonymous
- **Publish:** 23–31 March 2027 · **Supplemental material:** https://www.bipolarbear.app/
- **In-App Events: DRAFTS in ASC (2026-11-02)**, "World Bipolar Day", badge
  Special Event, all territories, shown from 11 March, running 25–31 March 2027
  (the app's own countdown, DOCS §2.33, v396): **Bear `6829691851`**,
  **Anonymous `6829691972`** (`asc-app-events.mjs`; en-GB only so far).
  **Still needed before they can go to review:** an event card image (16:9,
  1920×1080) and a details-page image (9:16, 1080×1920) for each, and a phone
  build carrying v396 live before March. Once Apple approves an event, attach it
  to this nomination (`hasInAppEvents`) and submit it, by early January 2027.

```
30 March is World Bipolar Day. Bipolar Bear and Bipolar Anonymous are two free apps from the same small UK team, made for people living with bipolar disorder, and they work together.

Bipolar Bear is a private mood journal. Five mood bears log mood, energy and sleep in under a minute, a life chart shows the patterns, each medicine can have its own reminder, and the survival kit holds a safety plan and guided breathing exercises for the hard days. Entries are encrypted on the device.

Bipolar Anonymous is a peer-support board where people post under a moniker, never a real name. When a post sounds like a crisis, the Friendly neighbourhood Bipolar Bear replies within seconds with crisis lines for the reader's own country and language, and a moderator is told so a person can check in.

Both are free with no ads, in 11 languages, on iPhone and iPad. A journal mood joins the board's daily check-in only if the person turns that on.
```

## 2. Bipolar Bear (`com.app.bipolarbear`, 6766637453), App Enhancements

- **Name:** Bipolar Bear: a private mood journal for bipolar
- **Publish:** from 23 November 2026 (1.47 live on both stores) · **Supplemental material:** https://www.bipolarbear.app/

```
Bipolar Bear is a free mood journal for people living with bipolar disorder. Log mood, energy and sleep in under a minute with five mood bears, see the patterns on a life chart, and keep a survival kit for the hard days.

What's new this autumn:
• My medicines: every medicine in one place, a reminder for each, and Taken or a mood logged straight from the notification.
• Blood results on the mood charts.
• Five guided breathing exercises in the Survival Kit.
• Your week: a few plain sentences about the last 7 days, worked out on the phone.
• A Safety plan widget for the lock screen, with the person's support number.
• Sign in with Apple, Google or a passkey, and unlock with Face ID. Personal details, medicines and the survival kit are encrypted on the device before they sync.
• Feels like an iPhone app: sheets that swipe away, and swipe to delete with Undo.
```

## 3. Bipolar Anonymous (`com.bipolaranonymous.app`, 6768005853), App Enhancements

- **Name:** Bipolar Anonymous: peer support without names
- **Publish:** from 23 November 2026 (1.43 live) · **Supplemental material:** https://www.bipolaranonymous.app/

```
Bipolar Anonymous is a free peer-support board for people living with bipolar disorder. Members post under a moniker, never a real name, and get replies from people who know the highs and lows first-hand.

What's new this autumn:
• A safety net: when a post sounds like a crisis, the Friendly neighbourhood Bipolar Bear replies within seconds with crisis lines for the reader's own country and language, and a moderator is told so a person can check in.
• Read the board in your language: posts and the community wiki are machine-translated across 11 languages, with the original one tap away.
• More private: posts, replies and profiles no longer carry an account ID, and an email address is deleted as soon as its sign-in code is used.
• "I needed this today" works without an account.
• Medicine names in posts link to their wiki page.
```

## Helpful details (all three, the "notes" field)

```
Made by UNI·SIM, a small UK team. Both apps are free with no ads, in 11 languages (English, Spanish, French, German, Italian, Portuguese (PT and BR), Dutch, Polish, Swedish, Simplified Chinese), on iPhone and iPad. Light and dark themes; screen-reader labels on the crisis button. Bipolar Bear is a self-help journal, not a medical device. Crisis lines in both apps are shown for the reader's own country and language.
```
