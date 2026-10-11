/**
 * The Friendly neighbourhood Bipolar Bear: an automatic reply to a board post
 * or comment that reads like someone in crisis.
 *
 * Why it exists: on 2026-10-10 a member posted "I need to talk to someone
 * asap" and the only reply, twelve hours later, was "hang in there". The board
 * has a 🛟 Help sheet, but someone in that state may not think to open it, and
 * a moderator may not be awake. So the bear replies within seconds with the
 * same crisis lines the Help sheet shows, and the team is emailed so a person
 * follows up.
 *
 * Matching is deliberately generous. A false positive costs one kind message
 * with phone numbers in it; a miss costs much more. It is a backstop, not a
 * judgement: it never hides, flags or reports anything the member wrote.
 *
 * Plain Node, no dependencies, so `node scripts/test-crisis-bot.js` can test it
 * without the Firebase emulator.
 *
 * @file functions/crisis-bot.js
 */
'use strict';

const BOT_NAME = 'Friendly neighbourhood Bipolar Bear';

// English, matched on word boundaries after lower-casing and straightening
// apostrophes. Keep each pattern about the writer's own state: "suicide" in a
// post about a news story still gets a reply, and that is an acceptable cost.
const EN = [
  /\bsuicid(e|al)\b/,
  /\bkill(ing)? my ?self\b/,
  /\bend(ing)? (it all|my life|my own life|everything)\b/,
  /\btake my (own )?life\b/,
  /\b(want|wanted|wanting) to die\b/,
  /\bwanna die\b/,
  /\bwish i (was|were) dead\b/,
  /\bbetter off (dead|without me)\b/,
  /\bdon'?t want to (be here|be alive|live|wake up)( any ?more)?\b/,
  /\bno (reason|point) (to|in) (live|living|going on)\b/,
  /\bnot worth living\b/,
  /\bcan'?t (go on|cope|take (it|this) any ?more|do this any ?more)\b/,
  /\b(hurt|hurting|harm|harming|cut|cutting) my ?self\b/,
  /\bself[- ]?harm/,
  /\boverdos(e|ed|ing)\b/,
  /\bin crisis\b/,
  /\bneed (to talk|to speak|someone to talk) to (someone|somebody|anyone)\b/,
  /\bneed (to talk|to speak) to (someone|somebody|anyone)? ?(asap|now|urgently|right now)\b/,
  /\bneed help (asap|now|urgently|right now)\b/,
];

// The board's other nine languages: plain substrings, because \b is ASCII-only
// and would break on accented letters. A few unambiguous phrases each.
const OTHER = [
  // es / it / fr / pt share the stem
  'suicid', 'suïcid',
  // es
  'quiero morir', 'matarme', 'quitarme la vida', 'no puedo más', 'no quiero vivir',
  // it
  'voglio morire', 'farla finita', 'uccidermi', 'togliermi la vita', 'non ce la faccio più',
  'ho bisogno di parlare con qualcuno',
  // fr
  'je veux mourir', 'me tuer', "envie d'en finir", 'envie de mourir', "j'ai besoin de parler à quelqu'un",
  // de
  'ich will sterben', 'mich umbringen', 'selbstmord', 'suizid', 'nicht mehr leben',
  // pt
  'quero morrer', 'me matar', 'acabar com tudo', 'não quero viver',
  // nl
  'ik wil dood', 'zelfmoord', 'wil niet meer leven',
  // pl
  'chcę umrzeć', 'samobój', 'zabić się', 'nie chcę żyć',
  // sv
  'vill dö', 'självmord', 'ta livet av mig',
  // zh
  '想死', '自杀', '自殺', '不想活',
];

function normalise(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/\s+/g, ' ');
}

/** True when `text` reads like someone who may be in crisis. */
function looksLikeCrisis(text) {
  const t = normalise(text);
  if (!t) return false;
  return EN.some((re) => re.test(t)) || OTHER.some((s) => t.indexOf(s) !== -1);
}

/**
 * The comment's `text`. New web builds draw the bear's comment from i18n
 * strings and BB.crisis (so every reader sees lines for their own country, in
 * their own language); this text is what older builds, the native apps until
 * their next rebuild, push previews and the admin email show. It mirrors the
 * UK markup of the 🛟 Help sheet in anonymous.html.
 */
function crisisReplyText(name) {
  const hi = name ? `Hi [${name}], it` : 'It';
  return [
    `${hi} sounds like things are really hard right now, and we're glad you reached out. ` +
      "You don't have to wait for a reply here. If you need to talk to someone now, these are free and confidential:",
    '',
    '📞 Samaritans: call 116 123, any time, day or night',
    '💬 Shout: text SHOUT to 85258',
    '🩺 NHS 111: call 111 and choose the mental health option',
    "🚨 If you're in danger, or might act on thoughts of harming yourself, call 999 or go to A&E now.",
    '',
    'Outside the UK? Tap 🛟 Help at the top of the board for numbers where you are, or go to findahelpline.com.',
    '',
    "I'm an automatic message. A moderator has been told about your post too. 💛",
  ].join('\n');
}

module.exports = { BOT_NAME, looksLikeCrisis, crisisReplyText, normalise };
