'use strict';

// The weekly insight: a few plain-language sentences about the user's own week
// of mood entries, written by Claude (James, 2026-10-26: build the weekly
// summary on the Anthropic API credits). See DOCS.md §2.32.
//
// Entries are encrypted on the device, so this function never reads them. The
// journal decrypts the last 14 days itself and sends only the structured fields
// in DAY_FIELDS below: no notes, no medicine names, no custom fields, no
// personal details. They are validated again here, passed to the API, and the
// reply goes straight back to the caller. Nothing about the week is stored or
// logged; the only document written is the caller's rate-limit counter.
//
// Opt-in only, and owner-gated: the ANTHROPIC_API_KEY secret must exist before
// any `firebase deploy --only functions` (the CLI stops on a missing secret).
// An empty one makes the function answer `unavailable: true`.
//
// The pure helpers (sanitiseDays, weekCounts, buildPrompt, parseInsight) need
// nothing from Firebase, so `node scripts/test-weekly-insight.js` can test them.

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret }       = require('firebase-functions/params');
const admin                  = require('firebase-admin');
const Anthropic              = require('@anthropic-ai/sdk').default;

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

const MODEL          = 'claude-opus-5-5';
const MAX_DAYS       = 14;     // this week + the week before, for comparison
const MIN_THIS_WEEK  = 3;      // fewer logged days than this → no call, nothing to say
const CALLS_PER_WEEK = 3;      // per uid, rolling 7 days
const USAGE_COL      = 'bbWeeklyInsightUsage';
const WEEK_MS        = 7 * 24 * 60 * 60 * 1000;

// The ten app languages (js/shared/i18n.js), named for the prompt.
const LANGS = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
  pt: 'Portuguese', nl: 'Dutch', pl: 'Polish', sv: 'Swedish', zh: 'Simplified Chinese',
};

const MOODS = ['manic', 'elevated', 'stable', 'low', 'depressed'];
const HML   = ['high', 'medium', 'low'];
const YN    = ['yes', 'no'];

// Everything a day may carry, and what each value may be (DOCS.md §2.3). A
// field that isn't here, or a value that doesn't fit, is dropped silently:
// an older or newer client still gets an insight from what does fit.
const DAY_FIELDS = {
  mood:         (v) => MOODS.includes(v),
  linkedMoods:  (v) => Array.isArray(v) && v.length <= 4 && v.every((m) => MOODS.includes(m)),
  energy:       (v) => [0, 3, 5, 7, 10].includes(v),
  sleep:        (v) => typeof v === 'number' && v >= 0 && v <= 16,
  steps:        (v) => Number.isInteger(v) && v >= 0 && v <= 100000,
  medication:   (v) => ['taken', 'some', 'unsure', 'not-taken'].includes(v),
  goals:        (v) => ['completed', 'some', 'none'].includes(v),
  exercise:     (v) => YN.includes(v),
  outside:      (v) => YN.includes(v),
  alcohol:      (v) => YN.includes(v),
  anxiety:      (v) => HML.includes(v),
  stress:       (v) => HML.includes(v),
  irritability: (v) => ['yes', 'medium', 'no'].includes(v),
  autoFilled:   (v) => v === true,
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Keep only well-formed days, one per date, oldest first, at most MAX_DAYS.
 * Every field is checked against DAY_FIELDS; a day without a valid mood is
 * dropped, since mood is the one thing every entry has.
 */
function sanitiseDays(days) {
  if (!Array.isArray(days)) return [];
  const byDate = new Map();
  for (const d of days) {
    if (!d || typeof d !== 'object' || !DATE_RE.test(String(d.date))) continue;
    if (!DAY_FIELDS.mood(d.mood)) continue;
    const clean = { date: d.date };
    for (const [k, ok] of Object.entries(DAY_FIELDS)) {
      if (d[k] !== undefined && d[k] !== null && ok(d[k])) clean[k] = d[k];
    }
    byDate.set(d.date, clean);
  }
  return Array.from(byDate.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_DAYS);
}

/**
 * Counts for "this week" — the last 7 calendar days up to the newest date sent
 * — worked out here rather than by the model, so `checkIn` never depends on
 * how a sentence came out. Auto-filled days (§2.13) are estimates, not
 * something the user said, so they don't count towards either.
 */
function weekCounts(days) {
  if (!days.length) return { logged: 0, depressed: 0, manic: 0, checkIn: false };
  const end   = new Date(days[days.length - 1].date + 'T00:00:00Z');
  const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);
  const week  = days.filter((d) => {
    const t = new Date(d.date + 'T00:00:00Z');
    return t >= start && t <= end && !d.autoFilled;
  });
  const depressed = week.filter((d) => d.mood === 'depressed').length;
  const manic     = week.filter((d) => d.mood === 'manic').length;
  // The same bar as the low-days card (§2.16) for lows; two manic days, because
  // an elevated stretch is the one people are least likely to flag themselves.
  return { logged: week.length, depressed, manic, checkIn: depressed >= 3 || manic >= 2 };
}

const SYSTEM = `You write a short weekly reflection for someone who keeps a daily mood journal in Bipolar Bear, an app for people living with bipolar disorder. You are shown their own entries; you are describing their week back to them, the way a thoughtful friend who had read the journal might.

What the fields mean: mood is one of manic, elevated, stable, low, depressed (linkedMoods are other moods felt the same day). energy is 0-10. sleep is hours. steps is a step count from their phone or watch. medication is whether they took their usual medicines (taken, some, unsure, not-taken). goals is how many of their daily goals they met. anxiety, stress and irritability are their own ratings. autoFilled days were estimated by the app, not logged by them, so lean on them less. The last 7 dates are this week; anything earlier is the week before, for comparison only.

How to write it:
- Describe, don't judge. Notice what moved together ("on the two nights you slept under six hours, the next day was elevated") and what changed since last week. Only call something a pattern if it happened at least twice, and say "seemed to" rather than claiming cause.
- Lead with something true and kind. Missed entries, alcohol or skipped medicines are facts to mention plainly if they matter to a pattern, never something to tell them off for.
- You are not their clinician. Never diagnose, never predict an episode, never suggest starting, stopping or changing a medicine or dose.
- If the reply's checkIn is true, one observation may say gently that this week might be worth sharing with someone they trust or their care team. Don't include phone numbers or crisis lines; the app shows its own.
- The suggestion is one small, optional thing they could try next week, drawn from their own data (for example, protecting sleep before busy days). Skip anything generic.
- Plain words, second person, no headings, no emoji, no markdown.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    headline:     { type: 'string', description: 'One sentence about the week, under 90 characters.' },
    observations: {
      type: 'array',
      description: 'One to three observations, each one or two sentences.',
      items: { type: 'string' },
    },
    suggestion:   { type: 'string', description: 'One small idea for next week, one sentence.' },
  },
  required: ['headline', 'observations', 'suggestion'],
  additionalProperties: false,
};

/** The user turn: the counts, the language, then one JSON line per day. */
function buildPrompt(days, counts, lang) {
  return [
    `Write in ${LANGS[lang] || LANGS.en}.`,
    `checkIn: ${counts.checkIn}`,
    `Days logged this week (not auto-filled): ${counts.logged} of 7.`,
    '',
    '<entries>',
    ...days.map((d) => JSON.stringify(d)),
    '</entries>',
  ].join('\n');
}

// Lengths the client can lay out without measuring. Over-long text is cut at a
// word, not refused: a long sentence is still worth showing.
function clip(s, max) {
  s = String(s || '').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).trim() + '…';
}

/** The model's JSON → the shape the client renders, or null if unusable. */
function parseInsight(text) {
  let o;
  try { o = JSON.parse(text); } catch (_) { return null; }
  if (!o || typeof o.headline !== 'string' || !Array.isArray(o.observations)) return null;
  const observations = o.observations
    .filter((s) => typeof s === 'string' && s.trim())
    .slice(0, 3)
    .map((s) => clip(s, 320));
  if (!o.headline.trim() || !observations.length) return null;
  return {
    headline:     clip(o.headline, 120),
    observations,
    suggestion:   typeof o.suggestion === 'string' ? clip(o.suggestion, 240) : '',
  };
}

/**
 * One Messages API call → the parsed insight, or null on any failure. Kept
 * apart from the callable so scripts/try-weekly-insight.js can run it on
 * made-up weeks with a local key.
 */
async function writeInsight(api, days, counts, lang) {
  let response;
  try {
    response = await api.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      // A safety decline is re-run server-side on the model Anthropic picks
      // for that category, instead of coming back as no insight.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [{ role: 'user', content: buildPrompt(days, counts, lang) }],
    });
  } catch (e) {
    // Log the kind of failure only: never the request, which is health data.
    if (e instanceof Anthropic.AuthenticationError) console.error('[weeklyInsight] ANTHROPIC_API_KEY rejected');
    else if (e instanceof Anthropic.RateLimitError) console.warn('[weeklyInsight] rate limited');
    else if (e instanceof Anthropic.APIError) console.error(`[weeklyInsight] API error ${e.status}`);
    else console.error('[weeklyInsight] call failed', e && e.name);
    return null;
  }
  if (response.stop_reason !== 'end_turn') {
    console.warn(`[weeklyInsight] stopped: ${response.stop_reason}`);
    return null;
  }
  const insight = parseInsight(response.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
  if (!insight) console.warn('[weeklyInsight] unparseable reply');
  return insight;
}

/**
 * Take one call from this uid's rolling weekly allowance, in a transaction so
 * two taps at once can't both slip under it. Charged before the API call: a
 * failed call costing an allowance is fine, a free retry loop isn't.
 */
async function takeAllowance(uid) {
  const db  = admin.firestore();
  const ref = db.collection(USAGE_COL).doc(uid);
  return db.runTransaction(async (tx) => {
    const snap  = await tx.get(ref);
    const now   = Date.now();
    const calls = ((snap.exists && snap.get('calls')) || []).filter((t) => t > now - WEEK_MS);
    if (calls.length >= CALLS_PER_WEEK) return false;
    tx.set(ref, { calls: [...calls, now], updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    return true;
  });
}

let _client = null;
function client() {
  if (!_client) _client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value(), maxRetries: 1, timeout: 60000 });
  return _client;
}

// { days: [{date, mood, ...}], lang } →
//   { insight: {headline, observations[], suggestion}, checkIn, counts }
//   | { notEnough: true, counts } | { limitReached: true } | { unavailable: true }
exports.weeklyInsight = onCall(
  { region: 'europe-west1', invoker: 'public', secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 90 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const provider = request.auth.token && request.auth.token.firebase && request.auth.token.firebase.sign_in_provider;
    // A guest's journal lives on the device; guests can be minted freely, so a
    // paid API stays behind a real account.
    if (provider === 'anonymous') throw new HttpsError('permission-denied', 'Not for guest sessions.');

    const data = request.data || {};
    const lang = LANGS[data.lang] ? data.lang : 'en';
    const days = sanitiseDays(data.days);
    const counts = weekCounts(days);
    if (counts.logged < MIN_THIS_WEEK) return { notEnough: true, counts };

    if (!ANTHROPIC_API_KEY.value()) return { unavailable: true };
    if (!(await takeAllowance(request.auth.uid))) return { limitReached: true };

    const insight = await writeInsight(client(), days, counts, lang);
    if (!insight) return { unavailable: true };
    return { insight, checkIn: counts.checkIn, counts };
  }
);

exports._lib = { sanitiseDays, weekCounts, buildPrompt, parseInsight, writeInsight, DAY_FIELDS, MAX_DAYS, USAGE_COL };
