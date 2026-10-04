# App Store / Play Store listing copy

Paste-ready metadata for both apps. Character limits noted per field (Apple's
are the tight ones). The English blocks below match `screens-i18n/listing_*.json`
"en", which `asc-upload.mjs` pushes (2026-10-04 store-listing pass: the name
carries "Mood Tracker", keywords never repeat a word already in the name or
subtitle, and the description ends with the credit line).

---

# 1. Bipolar Bear  (`com.bipolarbear.app`)

### App name  (max 30 chars)
```
Bipolar Bear: Mood Tracker
```

### Subtitle  (max 30 chars)
```
Mood journal & survival kit
```

### Promotional text  (max 170 chars, editable any time without review)
```
Log mood, energy and sleep in under a minute, see what shapes tomorrow’s mood, and keep a survival kit for the hard days. Journal entries are end-to-end encrypted.
```

### Keywords  (max 100 chars, comma-separated, no spaces after commas)
```
depression,mania,hypomania,manic,mental health,wellbeing,diary,sleep,energy,medication,anxiety,log
```

### Description  (max 4000 chars)
```
Bipolar Bear is a free, private mood journal and mood tracker built for people living with bipolar disorder. Log your moods, energy and sleep day by day, spot the patterns that matter, and keep a survival kit for the hard days.

TRACK WHAT MATTERS
Log your mood, energy, sleep, anxiety and custom fields every day. It takes less than a minute, and gentle reminders and streaks help you keep the habit without the pressure.

UNDERSTAND YOUR PATTERNS
See your mood over time with charts and personalised insights. Spot what's affecting your next-day mood — sleep, alcohol, exercise and more — worked out privately on your device.

SYNC WITH APPLE HEALTH
Pull your sleep in from Apple Health, so your sleep log fills itself in.

BUILD YOUR SURVIVAL KIT
Keep the strategies, medications, goals, memories and crisis resources that help you through hard times, all in one place. On overwhelming days, focused mode strips the app back to just what you need.

SHARE WITH YOUR CARE TEAM
Export a clean PDF summary for your doctor or psychiatrist.

ANONYMOUS COMMUNITY
Connect with others who get it. Share your thoughts without sharing your identity on the optional anonymous community board.

PRIVATE BY DESIGN
Journal entries are end-to-end encrypted: only you can read them, not us and not anyone else. Insights stay on your device. No ads, and we never sell your data.

Bipolar Bear is for people living with bipolar disorder, their families, and anyone who wants to understand their mental health better.

Bipolar Bear is not a medical device and does not give medical advice. It's a tool to help you notice, reflect and stay connected, alongside the care of your health professionals.

Built by James Markey MBE and hosted by UNI·SIM.
```

### Support URL
```
https://www.bipolarbear.app
```

### Marketing URL
```
https://www.bipolarbear.app
```

### Privacy Policy URL
```
https://www.bipolarbear.app/privacy.html
```

---

# 2. Bipolar Anonymous  (`com.bipolaranonymous.app`)

### App name  (max 30 chars)
```
Bipolar Anonymous
```

### Subtitle  (max 30 chars)
```
Anonymous peer support
```

### Promotional text  (max 170 chars)
```
Talk to people who know what the highs and lows feel like. No real names, no profiles, no likes to chase — just a calm, anonymous place to be heard.
```

### Keywords  (max 100 chars)
```
mania,depression,manic,mood,mental,health,community,recovery,disorder,swings,forum,wiki,wellbeing
```

### Description  (max 4000 chars)
```
Bipolar Anonymous is a calm, anonymous peer community for people living with bipolar disorder — a place to share what you're going through, ask questions, and connect with others who genuinely understand, without using your real name.

Living with bipolar can feel isolating. Highs, lows, medication changes, sleepless nights, difficult days at work, and the worry of telling the people around you — it helps to talk to others who've been there. Bipolar Anonymous gives you that space, anytime, from your phone.

WHY PEOPLE USE IT

• Anonymous by design — you choose a private nickname (your "moniker"), not your real identity. There are no profiles to fill in and no real names on display.
• Real peer support — post about how you're doing, reply to others, and offer encouragement. Everyone here gets it.
• A fresh daily topic — a rotating discussion prompt gives the community something new to talk about each day.
• Reach out when things are hard — flag a post for support when you're struggling and want others to know.
• A community you can shape — mute anyone you'd rather not see, and report posts that cross the line. Posts are moderated, and you can delete your own at any time.

A BUILT-IN WIKI

Browse plain-language, community-oriented information on the topics that come up most when living with bipolar, including:
• Medications
• Conditions
• Therapies
• Lifestyle
• Warning signs
• Hospital
• Workplace
• Pregnancy
• For loved ones

Search across it all to quickly find what you need.

PRIVATE AND LOW-PRESSURE

• No real names, no public profiles.
• You're in control of what you share and can remove your posts or account whenever you want.
• Older posts are automatically cleared over time, so the board stays current rather than becoming a permanent record.

A KIND PLACE TO LAND

Bipolar Anonymous is built to be supportive and judgement-free. Whether you're newly diagnosed, supporting someone you love, or years into managing bipolar, you're welcome here.

IMPORTANT

Bipolar Anonymous is a peer-support community, not a medical service. It does not provide diagnosis, treatment, or professional mental-health care, and it is not a substitute for advice from a qualified clinician. If you are in crisis or think you may harm yourself or someone else, please contact your local emergency services or a crisis line immediately.

Download Bipolar Anonymous and join a community that understands.

Built by James Markey MBE and hosted by UNI·SIM.
```

### Support URL
```
https://www.bipolarbear.app
```

### Privacy Policy URL
```
https://www.bipolarbear.app/privacy.html
```

---

# App Privacy "nutrition label"  (Apple) / Data Safety  (Google)

Answer these honestly in App Store Connect → App Privacy and Play Console →
Data safety. Based on the architecture notes in CLAUDE.md / DOCS.md.

## Bipolar Bear

| Data type | Collected? | Linked to user? | Used for tracking? | Notes |
|-----------|-----------|-----------------|--------------------|-------|
| Email address | Yes | Yes | No | Firebase Auth account |
| Health & fitness (mood/sleep/energy) | Yes | Yes* | No | *Stored end-to-end ENCRYPTED — we cannot read it |
| User content (journal notes) | Yes | Yes* | No | *End-to-end encrypted |
| Contact info (PDF export details) | Yes | Yes | No | Optional, user-entered |
| Identifiers (user ID) | Yes | Yes | No | Firestore document key |
| Diagnostics / crash data | Check Firebase | — | No | Only if Crashlytics/Analytics enabled |

Encryption / export-compliance answer: app uses standard encryption (HTTPS +
E2E entry encryption). Most likely qualifies for the exemption — answer the
`ITSAppUsesNonExemptEncryption` question accordingly (typically "No" /
exempt), but confirm against current Apple wording.

## Bipolar Anonymous

| Data type | Collected? | Linked to user? | Used for tracking? | Notes |
|-----------|-----------|-----------------|--------------------|-------|
| User content (posts/replies) | Yes | No** | No | **PLAINTEXT on Firestore, public to other users |
| Email address (hashed) | Yes | Pseudonymous | No | SHA-256 hash only, for cross-device profile |
| Identifiers (monika) | Yes | Pseudonymous | No | User-chosen handle |

Be explicit in the Data Safety form that posts are NOT encrypted and are
visible to other users — Google rejects listings that under-declare this.

---

# "What's New" / release notes

Apple max 4000 chars; Play max 500 chars. Keep v1.0 simple — for a first
release Apple just wants a sentence, not a changelog.

## Bipolar Bear — v1.0
```
Welcome to Bipolar Bear! This is our first release.

• Private, end-to-end encrypted mood journal — track mood, energy and sleep
• Patterns and stats to spot your early warning signs
• A survival kit for coping tools, goals, medications and memories
• Focused mode for overwhelming days
• PDF export to share with your care team
• An optional anonymous peer community

Thank you for being here. We'd love your feedback — there's a feedback option
right inside the app.
```

## Bipolar Anonymous — v1.0
```
Welcome to Bipolar Anonymous — our first release.

A calm, anonymous peer-support board for people living with bipolar disorder.
Pick a monika, share what you're going through, and connect with others who
understand. No real names, no judgement.

We'd love your feedback.
```

### Template for future updates (keep one per release)
```
What's new in vX.Y:
• <user-facing change>
• <bug fix in plain language>
Thanks for using Bipolar Bear — keep the feedback coming.
```

---

# Description accuracy check (verified against code 2026-06-07)

Every feature claimed in the descriptions above was confirmed present in the
source, so nothing needs softening:

| Claim | Verified in |
|-------|-------------|
| End-to-end encrypted journal | entries E2E (CLAUDE.md, DOCS.md) |
| Mood / energy / sleep logging | journal.html, js/journal.js |
| Patterns & stats | js/journal.js |
| Survival kit (coping/goals/medications/memories) | js/survival-kit.js |
| Focused mode | js/journal.js (focusedMode) |
| PDF export | js/journal.js `exportPDF()` |
| Apple Health / HealthKit sync | js/journal.js (healthSync) |
| Anonymous community | anonymous.html, js/anonymous.js |
| Streaks & reminders | currentStreak / reminderEnabled |
| In-app feedback | feedback collection (CLAUDE.md) |

Note: the description avoids any medical/clinical claim and includes a "not a
medical device / not medical advice" line — important for App Store review of
health-adjacent apps.

---

# Pre-submission checklist (cross-reference CLAUDE.md)

- [ ] Apple Developer Program membership active ($99/yr)
- [ ] Bundle IDs registered: com.bipolarbear.app, com.bipolaranonymous.app
- [ ] privacy.html reachable at the live URL (confirmed in repo ✓)
- [ ] Screenshots: iPhone 6.9" = 1290×2796 ✓ (in store-assets/out/iphone/)
- [ ] Marketing icon 1024×1024 — see icon alpha note below
- [ ] Age rating questionnaire completed
- [ ] Export compliance answer decided
- [ ] CFBundleVersion bumped — AND widget CFBundleVersion matched (CLAUDE.md)
- [ ] service-worker.js CACHE_NAME bumped if precached assets changed
```
