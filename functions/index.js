'use strict';

const { onCall, HttpsError }   = require('firebase-functions/v2/https');
const { onDocumentCreated }    = require('firebase-functions/v2/firestore');
const { defineSecret }         = require('firebase-functions/params');
const admin                    = require('firebase-admin');
const crypto                   = require('crypto');
const { Resend }               = require('resend');
const { GoogleAuth }           = require('google-auth-library');

admin.initializeApp();
const db = admin.firestore();

const RESEND_API_KEY = defineSecret('RESEND_API_KEY');

const REGION          = 'europe-west1';
const FROM_ADDRESS    = 'Bipolar Anonymous <bipolar@mail.unisim.co.uk>';
// Where admin notifications go (feedback, beta signups, announcement
// suggestions). Not the admin *account* — that stays inbox@jamesmarkey.co.uk
// (Firestore rules, ADMIN_EMAIL in js/anonymous.js).
const FEEDBACK_TO     = 'jamesmarkey@gmail.com';
const CODE_TTL_MS     = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT      = 3;              // max codes per email per window
const MAX_ATTEMPTS    = 5;             // wrong-code attempts before lockout
const CODE_DIGITS     = 6;              // 6-digit codes → 1,000,000 keyspace
const CODE_KEYSPACE   = 10 ** CODE_DIGITS;

// 6-digit cryptographically-random verification code, zero-padded so
// every value from 000000 to 999999 is reachable.
function generateCode() {
  return String(crypto.randomInt(0, CODE_KEYSPACE)).padStart(CODE_DIGITS, '0');
}

// ── Colours matching the Bipolar Anonymous yellow theme ──────────────────────
const YELLOW      = '#f5c800';
const YELLOW_DARK = '#c79d00';
const YELLOW_BG   = '#fffde7';
const DARK        = '#1a1a1a';
const MUTED       = '#6b7280';

function emailHtml(code) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your Bipolar Anonymous verification code</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;">

          <!-- Header -->
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:${YELLOW};border-radius:16px;padding:12px 20px;display:inline-block;">
                    <span style="font-size:22px;font-weight:800;color:${DARK};letter-spacing:-0.5px;">🐻 Bipolar Anonymous</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#ffffff;border-radius:20px;padding:36px 32px;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

              <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:${DARK};">Your verification code</p>
              <p style="margin:0 0 28px;font-size:14px;color:${MUTED};line-height:1.5;">
                Enter this code in the app to join the Bipolar Anonymous community board.
                It expires in <strong>10 minutes</strong>.
              </p>

              <!-- Code block -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td align="center" style="background:${YELLOW_BG};border:2px solid ${YELLOW};border-radius:14px;padding:24px;">
                    <span style="font-size:44px;font-weight:800;letter-spacing:10px;color:${DARK};font-variant-numeric:tabular-nums;">${code}</span>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 6px;font-size:13px;color:${MUTED};line-height:1.6;">
                If you didn't request this code, you can safely ignore this email.
                Someone may have entered your address by mistake.
              </p>
              <p style="margin:0;font-size:13px;color:${MUTED};line-height:1.6;">
                Never share this code with anyone.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="margin:0;font-size:12px;color:${MUTED};">
                Sent by <a href="https://bipolarbear.app" style="color:${YELLOW_DARK};text-decoration:none;font-weight:600;">BipolarBear</a>
                &nbsp;·&nbsp; A safe space for people living with bipolar
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── sendAnonCode ─────────────────────────────────────────────────────────────
exports.sendAnonCode = onCall(
  { region: REGION, invoker: 'public', secrets: [RESEND_API_KEY] },
  async (request) => {
    const email = (request.data.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpsError('invalid-argument', 'A valid email address is required.');
    }

    const now      = Date.now();
    const windowMs = CODE_TTL_MS;

    // Rate-limit: count recent sessions for this email
    const recent = await db.collection('anonVerify')
      .where('email', '==', email)
      .where('createdAt', '>', admin.firestore.Timestamp.fromMillis(now - windowMs))
      .get();

    if (recent.size >= RATE_LIMIT) {
      throw new HttpsError('resource-exhausted', 'Too many code requests. Please wait 10 minutes and try again.');
    }

    const code      = generateCode();
    const sessionId = db.collection('anonVerify').doc().id;

    await db.collection('anonVerify').doc(sessionId).set({
      email,
      code,
      createdAt: admin.firestore.Timestamp.fromMillis(now),
      verified:  false,
      uid:       request.auth ? request.auth.uid : null,
      attempts:  0,
    });

    const resend = new Resend(RESEND_API_KEY.value());
    const { error: resendError } = await resend.emails.send({
      from:    FROM_ADDRESS,
      to:      email,
      subject: `${code} is your Bipolar Anonymous code`,
      html:    emailHtml(code),
      text:    `Your Bipolar Anonymous verification code is: ${code}\n\nThis code expires in 10 minutes. Never share it with anyone.`,
    });

    if (resendError) {
      console.error('[sendAnonCode] Resend error:', JSON.stringify(resendError));
      throw new HttpsError('internal', 'Failed to send verification email. Please try again.');
    }

    return { sessionId };
  }
);

// After a correct code, record what it proved so the Firestore rules can use it:
//   bbAnonLinks/{uid}      — the caller's Firebase session owns sha256(email).
//                            Lets that session read and write
//                            anonProfiles/{sha256(email)}. Clients never read it.
//   anonProfiles/{hash}    — `restoreUntil` a few minutes ahead, so app builds
//                            that check the code before they have a Firebase
//                            session (<= 1.39) can still restore the profile.
// Best-effort: a failure here must not fail the verification itself.
const RESTORE_WINDOW_MS = 10 * 60 * 1000;
async function recordVerifiedEmail(request, email, now) {
  if (!email) return;
  const emailHash = anonEmailHash(email);
  const writes = [
    db.collection('anonProfiles').doc(emailHash).set({
      restoreUntil: admin.firestore.Timestamp.fromMillis(now + RESTORE_WINDOW_MS),
    }, { merge: true }),
  ];
  if (request.auth && request.auth.uid) {
    writes.push(db.collection('bbAnonLinks').doc(request.auth.uid).set({
      emailHash,
      verifiedAt: admin.firestore.Timestamp.fromMillis(now),
    }));
  }
  try { await Promise.all(writes); }
  catch (e) { console.error('[verifyAnonCode] recording the verified email failed', e); }
}

// ── verifyAnonCode ───────────────────────────────────────────────────────────
// The whole check runs inside a Firestore transaction so concurrent
// attempts can't race past the MAX_ATTEMPTS budget. The attempts counter
// is incremented BEFORE the code comparison and on EVERY attempt — even
// successful ones — so a parallel burst of guesses can't slip a verified
// write through without first exhausting attempts.
exports.verifyAnonCode = onCall(
  { region: REGION, invoker: 'public' },
  async (request) => {
    const { sessionId, code } = request.data || {};
    if (typeof sessionId !== 'string' || !sessionId ||
        (typeof code !== 'string' && typeof code !== 'number')) {
      throw new HttpsError('invalid-argument', 'sessionId and code are required.');
    }
    const submitted = String(code);
    if (submitted.length === 0 || submitted.length > 16) {
      throw new HttpsError('invalid-argument', 'Invalid code.');
    }

    const ref = db.collection('anonVerify').doc(sessionId);
    const now = Date.now();

    const outcome = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { kind: 'not-found' };

      const data = snap.data();
      if (now - data.createdAt.toMillis() > CODE_TTL_MS) return { kind: 'expired' };
      if (data.verified) return { kind: 'already-verified' };

      const prevAttempts = data.attempts || 0;
      if (prevAttempts >= MAX_ATTEMPTS) return { kind: 'locked' };

      const attempts = prevAttempts + 1;
      const expected = String(data.code || '');
      const match =
        submitted.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(expected));

      if (!match) {
        tx.update(ref, { attempts });
        return { kind: 'mismatch', remaining: Math.max(0, MAX_ATTEMPTS - attempts) };
      }

      tx.update(ref, {
        verified:   true,
        attempts,
        uid:        request.auth ? request.auth.uid : (data.uid || null),
        verifiedAt: admin.firestore.Timestamp.fromMillis(now),
      });
      return { kind: 'verified', email: data.email };
    });

    if (outcome.kind === 'verified') await recordVerifiedEmail(request, outcome.email, now);

    switch (outcome.kind) {
      case 'verified':
      case 'already-verified':
        return { success: true };
      case 'not-found':
        throw new HttpsError('not-found', 'Verification session not found. Please start again.');
      case 'expired':
        throw new HttpsError('deadline-exceeded', 'This code has expired. A new one is on its way.');
      case 'locked':
        throw new HttpsError('resource-exhausted', 'Too many incorrect attempts. Please request a new code.');
      case 'mismatch':
        if (outcome.remaining <= 0) {
          throw new HttpsError('resource-exhausted', 'Too many incorrect attempts. Please request a new code.');
        }
        throw new HttpsError('unauthenticated', `Incorrect code. ${outcome.remaining} attempt${outcome.remaining === 1 ? '' : 's'} remaining.`);
      default:
        throw new HttpsError('internal', 'Verification failed.');
    }
  }
);

// ── getBBStats ───────────────────────────────────────────────────────────────
// Called by the standalone anonymous path after email-code verification to
// pull stability streak and account creation date from the linked BipolarBear
// account (if one exists with the same email). Requires a verified sessionId.
exports.getBBStats = onCall(
  { region: REGION, invoker: 'public' },
  async (request) => {
    const { sessionId } = request.data || {};
    if (!sessionId) {
      throw new HttpsError('invalid-argument', 'sessionId is required.');
    }

    const snap = await db.collection('anonVerify').doc(sessionId).get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Session not found.');
    }
    const session = snap.data();
    if (!session.verified) {
      throw new HttpsError('permission-denied', 'Session not verified.');
    }
    // Allow up to 24 hours after verification (covers slow onboarding flows)
    const verifiedAt = session.verifiedAt ? session.verifiedAt.toMillis() : 0;
    if (Date.now() - verifiedAt > 24 * 60 * 60 * 1000) {
      throw new HttpsError('deadline-exceeded', 'Session expired.');
    }

    const email = session.email;
    try {
      const userRecord = await admin.auth().getUserByEmail(email);
      const uid = userRecord.uid;
      const accountCreatedAt = userRecord.metadata.creationTime || null;

      const settingsDoc = await db.collection('userSettings').doc(uid).get();
      const settings = settingsDoc.exists ? settingsDoc.data() : {};

      return {
        bbLinked:        true,
        stableStreak:    settings.stableStreak     || 0,
        stableSince:     settings.stableStreakStart || null,
        accountCreatedAt,
      };
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        return { bbLinked: false };
      }
      throw e;
    }
  }
);

// ── onFeedbackSubmitted ──────────────────────────────────────────────────────
// Fires whenever a document is created in feedback/{docId} and emails a
// summary to FEEDBACK_TO via Resend.
const ORANGE      = '#ff9500';
const ORANGE_DARK = '#c97900';
const ORANGE_BG   = '#fff8ee';

function feedbackEmailHtml(d) {
  const TYPE_EMOJI = { bug: '🐛', comment: '💬', idea: '💡' };
  const typeLabel = d.type ? `${TYPE_EMOJI[d.type] || '📣'} ${d.type}` : '📣 unknown';
  const ts = d.ts ? new Date(d.ts).toUTCString() : 'unknown';
  const rows = [
    ['Type',     typeLabel],
    ['Message',  d.message || '(empty)'],
    ['Page',     d.page    || '—'],
    ['Platform', d.platform || '—'],
    ['Version',  d.version  || '—'],
    ['UID',      d.uid      || '(guest)'],
    ['User email', d.email  || '—'],
    ['Notify me?', d.notify ? 'Yes' : 'No'],
    ['Submitted', ts],
  ];

  const rowsHtml = rows.map(([label, value]) => `
    <tr>
      <td style="padding:8px 12px;font-size:13px;font-weight:600;color:${MUTED};white-space:nowrap;vertical-align:top;">${label}</td>
      <td style="padding:8px 12px;font-size:13px;color:${DARK};word-break:break-word;">${String(value).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>
    </tr>`).join('');

  // The screenshot travels as an attachment (screenshotAttachment below):
  // Gmail and Outlook strip data: URIs from <img>, so inline it showed broken.
  const screenshotHtml = screenshotAttachment(d.screenshot)
    ? `<p style="margin:20px 0 0;font-size:13px;font-weight:600;color:${MUTED};">📎 Screenshot attached</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>New feedback — BipolarBear</title></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;">

        <tr><td align="center" style="padding-bottom:24px;">
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="background:${ORANGE};border-radius:16px;padding:12px 20px;">
              <span style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-0.5px;">🐻 BipolarBear — New Feedback</span>
            </td>
          </tr></table>
        </td></tr>

        <tr><td style="background:#fff;border-radius:20px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #f0f0f0;border-radius:10px;overflow:hidden;">
            ${rowsHtml}
          </table>
          ${screenshotHtml}
        </td></tr>

        <tr><td align="center" style="padding-top:20px;">
          <p style="margin:0;font-size:12px;color:${MUTED};">
            <a href="https://console.firebase.google.com" style="color:${ORANGE_DARK};text-decoration:none;font-weight:600;">Open Firestore console</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// A feedback screenshot arrives as a data: URL (fab.js compresses it to a
// ≤900px JPEG before it's stored). It's sent as an attachment — Gmail and
// Outlook strip data: URIs from <img>, so inline it only ever showed broken.
// Anything that isn't a base64 PNG/JPEG data URL is ignored, not trusted.
function screenshotAttachment(dataUrl) {
  const m = /^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  return { filename: `screenshot.${m[1] === 'png' ? 'png' : 'jpg'}`, content: Buffer.from(m[2], 'base64') };
}

exports.onFeedbackSubmitted = onDocumentCreated(
  { document: 'feedback/{docId}', region: REGION, secrets: [RESEND_API_KEY] },
  async (event) => {
    const d = event.data.data();
    const typeLabel = d.type || 'feedback';
    const subject = `[BipolarBear] New ${typeLabel} from ${d.email || d.uid || 'guest'}`;

    const resend = new Resend(RESEND_API_KEY.value());
    const shot   = screenshotAttachment(d.screenshot);
    const { error } = await resend.emails.send({
      from:    FROM_ADDRESS,
      to:      FEEDBACK_TO,
      subject,
      html:    feedbackEmailHtml(d),
      ...(shot ? { attachments: [shot] } : {}),
      text:    `Type: ${typeLabel}\nMessage: ${d.message || ''}\nPage: ${d.page || ''}\nPlatform: ${d.platform || ''}\nUID: ${d.uid || 'guest'}\nUser email: ${d.email || '—'}\nNotify: ${d.notify ? 'yes' : 'no'}\nTime: ${d.ts ? new Date(d.ts).toUTCString() : 'unknown'}`,
    });

    if (error) {
      console.error('[onFeedbackSubmitted] Resend error:', JSON.stringify(error));
    } else {
      console.log(`[onFeedbackSubmitted] emailed ${typeLabel}${shot ? ' + screenshot' : ''} (${event.params.docId})`);
    }
  }
);

// ── onBetaSignup ─────────────────────────────────────────────────────────────
// Fires whenever a document is created in betaSignups/{docId} and emails a
// notification to FEEDBACK_TO via Resend.
function betaSignupEmailHtml(d) {
  const ts = d.timestamp ? new Date(d.timestamp.toMillis()).toUTCString() : 'unknown';
  const rows = [
    ['Email',    d.email    || '—'],
    ['Platform', d.platform || '—'],
    ['Source',   d.source   || '—'],
    ['Time',     ts],
  ];

  const rowsHtml = rows.map(([label, value]) => `
    <tr>
      <td style="padding:8px 12px;font-size:13px;font-weight:600;color:${MUTED};white-space:nowrap;vertical-align:top;">${label}</td>
      <td style="padding:8px 12px;font-size:13px;color:${DARK};word-break:break-word;">${String(value).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>New beta signup — BipolarBear</title></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;">

        <tr><td align="center" style="padding-bottom:24px;">
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="background:${ORANGE};border-radius:16px;padding:12px 20px;">
              <span style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-0.5px;">🐻 BipolarBear — New Beta Signup</span>
            </td>
          </tr></table>
        </td></tr>

        <tr><td style="background:#fff;border-radius:20px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #f0f0f0;border-radius:10px;overflow:hidden;">
            ${rowsHtml}
          </table>
        </td></tr>

        <tr><td align="center" style="padding-top:20px;">
          <p style="margin:0;font-size:12px;color:${MUTED};">
            <a href="https://console.firebase.google.com" style="color:${ORANGE_DARK};text-decoration:none;font-weight:600;">Open Firestore console</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

exports.onBetaSignup = onDocumentCreated(
  { document: 'betaSignups/{docId}', region: REGION, secrets: [RESEND_API_KEY] },
  async (event) => {
    const d = event.data.data();
    const resend = new Resend(RESEND_API_KEY.value());
    const { error } = await resend.emails.send({
      from:    FROM_ADDRESS,
      to:      FEEDBACK_TO,
      subject: `[BipolarBear] New beta signup — ${d.email || 'unknown'} (${d.platform || '?'})`,
      html:    betaSignupEmailHtml(d),
      text:    `New beta signup\nEmail: ${d.email || '—'}\nPlatform: ${d.platform || '—'}\nSource: ${d.source || '—'}\nTime: ${d.timestamp ? new Date(d.timestamp.toMillis()).toUTCString() : 'unknown'}`,
    });

    if (error) {
      console.error('[onBetaSignup] Resend error:', JSON.stringify(error));
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// Bipolar Anonymous — push notifications
//
// Four things reach a member, each gated on a preference they set in the
// board's settings sheet (see js/shared/anon-push.js):
//
//   replies       — someone answered a post of theirs
//   announcements — the admin published (or approved) an announcement
//   posts         — someone else posted in General Chat
//   weekly        — one digest of the week, Sunday evening
//
// Registrations live in bbAnonPush/{fcmToken}:
//   { token, prefs: {replies, announcements, posts, weekly}, monikaLower,
//     emailHash, platform, bundle, lang, updatedAt }
//
// Notifications deliberately carry NO post or comment text. The board is a
// mental-health space and a notification lands on a lock screen where anyone
// nearby can read it — "someone replied to your post" is all the prompt
// anyone needs to open the app, and it can't out a member to the person
// looking over their shoulder.
// ═══════════════════════════════════════════════════════════════════════════

const { onSchedule } = require('firebase-functions/v2/scheduler');

const PUSH_COLLECTION = 'bbAnonPush';
const POSTS           = 'bbAnonPosts';
const FCM_BATCH       = 500;   // sendEachForMulticast ceiling

// Notification copy, mirroring js/shared/i18n.js. Kept deliberately short and
// contentless — see the note above. `{n}` is substituted for the digest.
const PUSH_TEXT = {
  en: { replyT: 'New reply',        replyB: 'Someone replied to your post on Bipolar Anonymous.',
        annT:   'New announcement', annB:   'There is a new announcement on the board.',
        postT:  'New post', postB:  'Someone posted on Bipolar Anonymous.',
        weekT:  'Your week on the board', weekB: '{n} new posts this week. Come and see how everyone is doing.' },
  es: { replyT: 'Nueva respuesta',  replyB: 'Alguien ha respondido a tu publicación en Bipolar Anonymous.',
        annT:   'Nuevo anuncio',    annB:   'Hay un nuevo anuncio en el foro.',
        postT:  'Nueva publicación', postB:  'Alguien ha publicado en Bipolar Anonymous.',
        weekT:  'Tu semana en el foro', weekB: '{n} publicaciones nuevas esta semana. Ven a ver cómo está todo el mundo.' },
  fr: { replyT: 'Nouvelle réponse', replyB: 'Quelqu’un a répondu à ton post sur Bipolar Anonymous.',
        annT:   'Nouvelle annonce', annB:   'Il y a une nouvelle annonce sur le forum.',
        postT:  'Nouveau post', postB:  'Quelqu’un a publié sur Bipolar Anonymous.',
        weekT:  'Ta semaine sur le forum', weekB: '{n} nouveaux posts cette semaine. Viens voir comment vont les autres.' },
  de: { replyT: 'Neue Antwort',     replyB: 'Jemand hat auf deinen Beitrag bei Bipolar Anonymous geantwortet.',
        annT:   'Neue Ankündigung', annB:   'Es gibt eine neue Ankündigung im Forum.',
        postT:  'Neuer Beitrag', postB:  'Jemand hat etwas bei Bipolar Anonymous gepostet.',
        weekT:  'Deine Woche im Forum', weekB: '{n} neue Beiträge diese Woche. Schau, wie es allen geht.' },
  it: { replyT: 'Nuova risposta',   replyB: 'Qualcuno ha risposto al tuo post su Bipolar Anonymous.',
        annT:   'Nuovo annuncio',   annB:   'C’è un nuovo annuncio sulla bacheca.',
        postT:  'Nuovo post', postB:  'Qualcuno ha pubblicato su Bipolar Anonymous.',
        weekT:  'La tua settimana sulla bacheca', weekB: '{n} nuovi post questa settimana. Vieni a vedere come stanno tutti.' },
  pt: { replyT: 'Nova resposta',    replyB: 'Alguém respondeu à tua publicação no Bipolar Anonymous.',
        annT:   'Novo anúncio',     annB:   'Há um novo anúncio no fórum.',
        postT:  'Nova publicação', postB:  'Alguém publicou no Bipolar Anonymous.',
        weekT:  'A tua semana no fórum', weekB: '{n} novas publicações esta semana. Vem ver como estão todos.' },
  nl: { replyT: 'Nieuwe reactie',   replyB: 'Iemand heeft gereageerd op je bericht op Bipolar Anonymous.',
        annT:   'Nieuwe mededeling', annB:  'Er staat een nieuwe mededeling op het forum.',
        postT:  'Nieuw bericht', postB:  'Iemand heeft iets geplaatst op Bipolar Anonymous.',
        weekT:  'Jouw week op het forum', weekB: '{n} nieuwe berichten deze week. Kom kijken hoe het met iedereen gaat.' },
  pl: { replyT: 'Nowa odpowiedź',   replyB: 'Ktoś odpowiedział na Twój wpis na Bipolar Anonymous.',
        annT:   'Nowe ogłoszenie',  annB:   'Na forum pojawiło się nowe ogłoszenie.',
        postT:  'Nowy wpis', postB:  'Ktoś dodał wpis na Bipolar Anonymous.',
        weekT:  'Twój tydzień na forum', weekB: '{n} nowych wpisów w tym tygodniu. Zobacz, co u innych.' },
  sv: { replyT: 'Nytt svar',        replyB: 'Någon har svarat på ditt inlägg på Bipolar Anonymous.',
        annT:   'Nytt meddelande',  annB:   'Det finns ett nytt meddelande på forumet.',
        postT:  'Nytt inlägg', postB:  'Någon har skrivit ett inlägg på Bipolar Anonymous.',
        weekT:  'Din vecka på forumet', weekB: '{n} nya inlägg den här veckan. Kom och se hur alla mår.' },
  zh: { replyT: '有新回复',          replyB: '有人回复了你在 Bipolar Anonymous 的帖子。',
        annT:   '新公告',            annB:   '论坛有一条新公告。',
        postT:  '新帖子', postB:  '有人在 Bipolar Anonymous 发布了新帖子。',
        weekT:  '你这一周的社区',      weekB: '本周有 {n} 条新帖子。来看看大家过得怎么样。' },
};

function pushText(lang, key, vars) {
  const table = PUSH_TEXT[lang] || PUSH_TEXT.en;
  let out = table[key] || PUSH_TEXT.en[key] || '';
  if (vars) Object.keys(vars).forEach((k) => { out = out.split(`{${k}}`).join(String(vars[k])); });
  return out;
}

/**
 * Registrations that want `pref`, optionally narrowed to one monika.
 * Narrowed to a monika, the query is a single equality on monikaLower and the
 * preference is checked in code, so no composite index is needed. Board-wide
 * sends query the preference itself — Firestore's automatic single-field
 * index on `prefs.<pref>` covers it — so a send on every new post reads only
 * the devices that asked for it, not every registration.
 * @returns {Promise<Array<{token: string, lang: string, monikaLower: string}>>}
 */
async function subscribers(pref, monikaLower) {
  const query = monikaLower
    ? db.collection(PUSH_COLLECTION).where('monikaLower', '==', monikaLower)
    : db.collection(PUSH_COLLECTION).where(`prefs.${pref}`, '==', true);
  const snap = await query.get();
  return snap.docs
    .map((d) => ({ token: d.id, ...d.data() }))
    .filter((r) => r.token && r.prefs && r.prefs[pref]);
}

/**
 * Send one notification to a set of registrations, grouped by language, and
 * clear out tokens FCM tells us are dead. Returns how many were delivered.
 * @param {Array} recipients from subscribers()
 * `collapse`, when given, makes every send under that id replace the previous
 * one on the device (APNs collapse id, Android tag, web-push tag) and lets FCM
 * drop the older ones queued for a device that's offline.
 * @param {{titleKey: string, bodyKey: string, vars?: object, data?: object, collapse?: string}} msg
 * @returns {Promise<number>}
 */
async function sendToRecipients(recipients, msg) {
  if (!recipients.length) return 0;

  const apns    = { payload: { aps: { sound: 'default' } } };
  // ic_stat_notify is a white silhouette drawable in both Android apps
  // (res/drawable/ic_stat_notify.xml); the status bar paints it, tinted yellow.
  const android = { notification: { icon: 'ic_stat_notify', color: '#f5c800' } };
  // Web: the Firebase SDK in firebase-messaging-sw.js displays these itself,
  // so the icon has to travel with the message.
  const webpush = { notification: { icon: '/icons/favicons-anonymous/android-chrome-192x192.png' } };
  if (msg.collapse) {
    apns.headers             = { 'apns-collapse-id': msg.collapse };
    android.collapseKey      = msg.collapse;
    android.notification.tag = msg.collapse;
    webpush.notification.tag = msg.collapse;
  }

  const byLang = new Map();
  recipients.forEach((r) => {
    const lang = PUSH_TEXT[r.lang] ? r.lang : 'en';
    if (!byLang.has(lang)) byLang.set(lang, []);
    byLang.get(lang).push(r.token);
  });

  let sent = 0;
  const dead = [];

  for (const [lang, allTokens] of byLang) {
    const notification = {
      title: pushText(lang, msg.titleKey, msg.vars),
      body:  pushText(lang, msg.bodyKey,  msg.vars),
    };
    for (let i = 0; i < allTokens.length; i += FCM_BATCH) {
      const tokens = allTokens.slice(i, i + FCM_BATCH);
      let res;
      try {
        res = await admin.messaging().sendEachForMulticast({
          tokens,
          notification,
          data: Object.assign({ kind: msg.data && msg.data.kind ? msg.data.kind : 'anon' }, msg.data || {}),
          apns,
          android,
          webpush,
        });
      } catch (e) {
        console.error('[anonPush] send failed', e);
        continue;
      }
      sent += res.successCount;
      res.responses.forEach((r, idx) => {
        const code = r.error && r.error.code;
        // The app was deleted, or the token was replaced. Either way nothing
        // is listening — drop it so the collection doesn't rot.
        if (code === 'messaging/registration-token-not-registered'
            || code === 'messaging/invalid-registration-token'
            || code === 'messaging/invalid-argument') {
          dead.push(tokens[idx]);
        }
      });
    }
  }

  if (dead.length) {
    const batch = db.batch();
    dead.forEach((t) => batch.delete(db.collection(PUSH_COLLECTION).doc(t)));
    await batch.commit().catch((e) => console.warn('[anonPush] token cleanup failed', e));
  }
  return sent;
}

// ── Replies ──────────────────────────────────────────────────────────────────
// A comment on a post notifies that post's author, on every device they have
// registered — but never the person who wrote the comment (replying to
// yourself, or to your own thread, is not news).
exports.onAnonCommentCreated = onDocumentCreated(
  { document: 'bbAnonPosts/{postId}/comments/{commentId}', region: REGION },
  async (event) => {
    const comment = event.data && event.data.data();
    if (!comment) return;

    const postSnap = await db.collection(POSTS).doc(event.params.postId).get();
    if (!postSnap.exists) return;
    const post = postSnap.data();
    const author = (post.name || '').toLowerCase();
    if (!author) return;                                   // system card, no author
    if (author === (comment.name || '').toLowerCase()) return;  // replying to themselves

    const recipients = await subscribers('replies', author);
    if (!recipients.length) return;

    const sent = await sendToRecipients(recipients, {
      titleKey: 'replyT',
      bodyKey:  'replyB',
      data:     { kind: 'reply', postId: event.params.postId, url: '/anonymous.html' },
    });
    console.log(`[anonPush] reply → ${author}: ${sent}/${recipients.length}`);
  }
);

// ── Announcements ────────────────────────────────────────────────────────────
// Fires for anything landing on the announcements tab, which covers both the
// admin posting directly and the admin approving a member's suggestion (the
// approval writes an ordinary announcement post).
exports.onAnonAnnouncementCreated = onDocumentCreated(
  { document: 'bbAnonPosts/{postId}', region: REGION },
  async (event) => {
    const post = event.data && event.data.data();
    if (!post || post.tab !== 'announcements' || post.deleted) return;

    const recipients = await subscribers('announcements');
    if (!recipients.length) return;

    const sent = await sendToRecipients(recipients, {
      titleKey: 'annT',
      bodyKey:  'annB',
      data:     { kind: 'announcement', postId: event.params.postId, url: '/anonymous.html' },
    });
    console.log(`[anonPush] announcement: ${sent}/${recipients.length}`);
  }
);

// ── New posts ────────────────────────────────────────────────────────────────
// Every member post in General Chat, to everyone who switched it on — except
// the devices of whoever wrote it. The daily topic (created by whichever client
// opens the board first that day, under a generated identity) and system cards
// aren't something a member wrote, so they don't ring anyone's phone.
// Announcements have their own switch above.
//
// This is the noisiest switch on a busy day, so every post notification shares
// one collapse id: a burst replaces the one already in the tray instead of
// stacking, and a phone that was offline gets the latest rather than all.
exports.onAnonPostCreated = onDocumentCreated(
  { document: 'bbAnonPosts/{postId}', region: REGION },
  async (event) => {
    const post = event.data && event.data.data();
    if (!post || post.tab !== 'general' || post.deleted || post.isSystem || post.isTopic) return;

    const author = (post.name || '').toLowerCase();
    const recipients = (await subscribers('posts'))
      .filter((r) => !author || r.monikaLower !== author);
    if (!recipients.length) return;

    const sent = await sendToRecipients(recipients, {
      titleKey: 'postT',
      bodyKey:  'postB',
      collapse: 'anon-new-post',
      data:     { kind: 'post', postId: event.params.postId, url: '/anonymous.html' },
    });
    console.log(`[anonPush] new post: ${sent}/${recipients.length}`);
  }
);

// ── Weekly digest ────────────────────────────────────────────────────────────
// Sunday evening, UK time. Counts only — no titles, no snippets. A week with
// nothing in it sends nothing: an empty digest is just a notification tax.
exports.weeklyAnonDigest = onSchedule(
  { schedule: '0 18 * * 0', timeZone: 'Europe/London', region: REGION },
  async () => {
    const since = admin.firestore.Timestamp.fromMillis(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const snap  = await db.collection(POSTS).where('timestamp', '>=', since).get();
    const posts = snap.docs
      .map((d) => d.data())
      .filter((p) => !p.deleted && p.tab === 'general');

    if (!posts.length) {
      console.log('[anonPush] weekly digest: quiet week, nothing sent');
      return;
    }

    const recipients = await subscribers('weekly');
    if (!recipients.length) return;

    const sent = await sendToRecipients(recipients, {
      titleKey: 'weekT',
      bodyKey:  'weekB',
      vars:     { n: posts.length },
      data:     { kind: 'weekly', url: '/anonymous.html' },
    });
    console.log(`[anonPush] weekly digest: ${sent}/${recipients.length} (${posts.length} posts)`);
  }
);

// ── Announcement suggestions → email the admin ───────────────────────────────
// A suggestion is only useful once someone looks at it, and the admin isn't
// necessarily on the board that day. Same Resend path as feedback and beta
// signups; the queue itself lives in the app.
function suggestionEmailHtml(d) {
  const escape = (v) => String(v == null ? '' : v).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Announcement suggestion — Bipolar Anonymous</title></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;">

        <tr><td align="center" style="padding-bottom:24px;">
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="background:${YELLOW};border-radius:16px;padding:12px 20px;">
              <span style="font-size:20px;font-weight:800;color:${DARK};letter-spacing:-0.5px;">📢 Announcement suggestion</span>
            </td>
          </tr></table>
        </td></tr>

        <tr><td style="background:#fff;border-radius:20px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          <p style="margin:0 0 12px;font-size:13px;color:${MUTED};">From <strong style="color:${DARK};">[${escape(d.name)}]</strong></p>
          <div style="background:${YELLOW_BG};border-radius:12px;padding:16px;font-size:15px;line-height:1.6;color:${DARK};white-space:pre-wrap;">${escape(d.text)}</div>
          <p style="margin:20px 0 0;font-size:13px;color:${MUTED};">Open the Announcements tab on the board to publish or refuse it.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

exports.onAnonSuggestionCreated = onDocumentCreated(
  { document: 'bbAnonAnnSuggestions/{docId}', region: REGION, secrets: [RESEND_API_KEY] },
  async (event) => {
    const d = event.data && event.data.data();
    if (!d || d.status !== 'pending') return;

    const resend = new Resend(RESEND_API_KEY.value());
    const { error } = await resend.emails.send({
      from:    FROM_ADDRESS,
      to:      FEEDBACK_TO,
      subject: `[Bipolar Anonymous] Announcement suggested by [${d.name || 'unknown'}]`,
      html:    suggestionEmailHtml(d),
      text:    `Announcement suggested by [${d.name || 'unknown'}]\n\n${d.text || ''}\n\nPublish or refuse it from the Announcements tab.`,
    });

    if (error) {
      console.error('[onAnonSuggestionCreated] Resend error:', JSON.stringify(error));
    }
  }
);

// ── backfillUserCounts ───────────────────────────────────────────────────────
// One-shot (but safely repeatable) reconciliation of the two community
// counters with the accounts that already exist.
//
// `js/shared/user-count.js` counts incrementally: an account increments
// `counters/{userCount,anonUserCount}` the first time it opens the app, in the
// same transaction that writes its one-time "counted" flag. That is correct
// going forward but it starts from zero — everyone who joined before the
// feature shipped is missing from the total until they happen to come back,
// which for a dormant account may be never.
//
// The client cannot fix this itself: `userSettings/{uid}` and
// `anonProfiles/{hash}` are readable only by their owner, so nobody in a
// browser can enumerate them. This runs with the Admin SDK instead, counts
// every existing account once, writes each account's flag so the client never
// counts it a second time, and then sets both counters to the true totals.
//
// Call it signed in as the admin account, dry-run first:
//
//   const fn = firebase.app().functions('europe-west1')
//                .httpsCallable('backfillUserCounts');
//   (await fn({ apply: false })).data   // report only, writes nothing
//   (await fn({ apply: true  })).data   // write the flags and set the counters
//
// Idempotent: re-running recomputes the same totals and only flags accounts
// that are still unflagged. An account created *during* a run can have its own
// +1 overwritten by the final absolute set — vanishingly unlikely, and fixed
// by running it again.

/** The admin *account* — matches ADMIN_EMAIL in js/anonymous.js. */
const ADMIN_ACCOUNT_EMAIL = 'inbox@jamesmarkey.co.uk';
/** Documents per scan page, and writes per batch (Firestore's ceiling is 500). */
const BACKFILL_PAGE  = 400;
const BACKFILL_BATCH = 400;

/**
 * SHA-256 of an email, normalised exactly as `_anonEmailHash()` in
 * js/anonymous.js does it — the key `anonProfiles` is stored under.
 */
function anonEmailHash(email) {
  return crypto.createHash('sha256')
    .update(String(email).toLowerCase().trim())
    .digest('hex');
}

/** uid → email for every Firebase Auth account that has one. */
async function authEmailsByUid() {
  const map = new Map();
  let pageToken;
  do {
    const res = await admin.auth().listUsers(1000, pageToken);
    res.users.forEach((u) => { if (u.email) map.set(u.uid, u.email); });
    pageToken = res.pageToken;
  } while (pageToken);
  return map;
}

/** Walk a whole collection in id order, page by page, without holding it all. */
async function scanCollection(name, onDoc) {
  let cursor = null;
  for (;;) {
    let q = db.collection(name)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(BACKFILL_PAGE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) return;
    snap.forEach(onDoc);
    if (snap.size < BACKFILL_PAGE) return;
    cursor = snap.docs[snap.docs.length - 1];
  }
}

/** Merge `patch` into every ref, in batches. */
async function commitPatch(refs, patch) {
  for (let i = 0; i < refs.length; i += BACKFILL_BATCH) {
    const batch = db.batch();
    refs.slice(i, i + BACKFILL_BATCH).forEach((ref) => batch.set(ref, patch, { merge: true }));
    await batch.commit();
  }
}

/** Current value of a counter document, or null if it doesn't exist yet. */
async function counterValue(id) {
  const snap = await db.collection('counters').doc(id).get();
  const n = snap.exists ? snap.data().count : null;
  return typeof n === 'number' ? n : null;
}

exports.backfillUserCounts = onCall(
  { region: REGION, invoker: 'public', timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    const caller = request.auth && request.auth.token && request.auth.token.email;
    if (!caller || String(caller).toLowerCase() !== ADMIN_ACCOUNT_EMAIL) {
      throw new HttpsError('permission-denied', 'Admin only.');
    }
    const apply = !!(request.data && request.data.apply === true);

    const emails = await authEmailsByUid();

    // ── Bipolar Bear accounts ────────────────────────────────────────────────
    // One `userSettings/{uid}` document per account — the same thing the
    // client flags. A document whose Auth account is gone is leftover from a
    // deleted account: not a user, so not counted and not flagged.
    let bearTotal    = 0;
    let bearOrphans  = 0;
    const bearToFlag = [];

    // ── Bipolar Anonymous members ────────────────────────────────────────────
    // Keyed on sha256(email) like the client, from both entry paths: a
    // BipolarBear account carrying an anon profile, and a standalone
    // `anonProfiles/{hash}` document. The Set collapses anyone using both.
    const anonHashes  = new Set();
    const anonFlagged = new Set();

    await scanCollection('userSettings', (doc) => {
      const email = emails.get(doc.id);
      if (!email) { bearOrphans++; return; }
      bearTotal++;
      if (doc.get('userCounted') !== true) bearToFlag.push(doc.ref);
      const ap = doc.get('anonProfile');
      if (ap && ap.monika) anonHashes.add(anonEmailHash(email));
    });

    await scanCollection('anonProfiles', (doc) => {
      if (!doc.get('monika')) return;   // signed up but never picked a monika
      anonHashes.add(doc.id);
      if (doc.get('counted') === true) anonFlagged.add(doc.id);
    });

    const anonToFlag = Array.from(anonHashes)
      .filter((h) => !anonFlagged.has(h))
      .map((h) => db.collection('anonProfiles').doc(h));

    const report = {
      apply,
      bear: {
        total:          bearTotal,
        alreadyCounted: bearTotal - bearToFlag.length,
        toCount:        bearToFlag.length,
        orphaned:       bearOrphans,
        was:            await counterValue('userCount'),
      },
      anon: {
        total:          anonHashes.size,
        alreadyCounted: anonHashes.size - anonToFlag.length,
        toCount:        anonToFlag.length,
        was:            await counterValue('anonUserCount'),
      },
    };

    if (!apply) {
      console.log('[backfillUserCounts] dry run:', JSON.stringify(report));
      return Object.assign({ dryRun: true }, report);
    }

    // Flags first, totals last: an account that is already flagged when the
    // absolute set lands can never be counted twice afterwards. A flag written
    // for a member whose `anonProfiles` document doesn't exist yet creates it
    // holding nothing but `counted` — harmless, since every reader of that
    // document keys off `monika`.
    await commitPatch(bearToFlag, { userCounted: true });
    await commitPatch(anonToFlag, { counted: true });
    await db.collection('counters').doc('userCount')
      .set({ count: bearTotal }, { merge: true });
    await db.collection('counters').doc('anonUserCount')
      .set({ count: anonHashes.size }, { merge: true });

    console.log('[backfillUserCounts] applied:', JSON.stringify(report));
    return Object.assign({ dryRun: false }, report);
  }
);

// ── translateAnonTexts ───────────────────────────────────────────────────────
// On-demand translation for member-written text on the anonymous board (posts,
// daily topics, announcements and comments). The board is one community reading
// in ten languages, so a Portuguese post is unreadable to most of it — this
// translates it into whatever language the reader has the app set to, and the
// client keeps the original one tap away.
//
// Everything is translated on read, never on write: a post is stored once, in
// the language it was written in, and only the languages someone actually reads
// it in are ever paid for.
//
// Requires the **Cloud Translation API** to be enabled on the Firebase project
// (console → APIs & Services → Enable APIs → "Cloud Translation API") with
// billing active. Until it is, this returns `unavailable: true` and the client
// quietly leaves every post in the language it was written in — the board works
// exactly as it did before. See DOCS.md §2.15.

// The ten languages the app's UI is translated into (js/shared/i18n.js). A
// target outside that set is refused: no reader can have asked for it.
const TRANSLATE_TARGETS   = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'sv', 'zh'];
const TRANSLATE_MAX_ITEMS = 40;      // texts per call (about one screen of posts)
const TRANSLATE_MAX_CHARS = 2000;    // characters per text
const TRANSLATE_MAX_TOTAL = 16000;   // characters per call
// Per-caller daily budget. The shared cache means the board pays for each
// (text, language) pair once for everybody, so a genuine reader never comes
// near this; it is here so a scripted client can't run up a bill on a paid API.
const TRANSLATE_DAILY_CHARS = 120000;
const TRANSLATE_CACHE_COL   = 'bbAnonTranslations';
const TRANSLATE_USAGE_COL   = 'bbAnonTranslateUsage';
const TRANSLATE_API_URL     = 'https://translation.googleapis.com/language/translate/v2';

// Content-addressed cache id: same text + same target language → same document,
// so a translation is bought once and then read by everyone who needs it.
function translateCacheId(text, target) {
  return crypto.createHash('sha256').update(target + '\n' + text).digest('hex').slice(0, 40);
}

// The v2 API HTML-escapes a handful of characters even with format:'text'
// (most visibly apostrophes, which are everywhere in ordinary writing).
function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g,         (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&amp;/g,  '&');   // last, so &amp;lt; survives as &lt;
}

let _translateAuth = null;
function translateAuth() {
  if (!_translateAuth) {
    _translateAuth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });
  }
  return _translateAuth;
}

/**
 * Translate a batch of strings, auto-detecting each one's source language.
 * @returns {Promise<Array<{translatedText: string, detectedSourceLanguage: string}>>}
 */
async function callTranslateApi(texts, target) {
  const client = await translateAuth().getClient();
  const token  = await client.getAccessToken();
  const res = await fetch(TRANSLATE_API_URL, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${token && token.token ? token.token : token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ q: texts, target, format: 'text' }),
  });
  if (!res.ok) {
    throw new Error(`Cloud Translation API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const body = await res.json();
  return (body.data && body.data.translations) || [];
}

/**
 * Today's translated-character count for this caller, plus a writer for it.
 * Keyed by UTC day, so the budget resets at midnight with no scheduled sweep.
 */
async function translateBudget(uid) {
  const day  = new Date().toISOString().slice(0, 10);
  const ref  = db.collection(TRANSLATE_USAGE_COL).doc(uid);
  const snap = await ref.get();
  const d    = snap.exists ? snap.data() : {};
  const used = d.day === day && typeof d.chars === 'number' ? d.chars : 0;
  return {
    used,
    spend: (chars) => ref.set(
      { day, chars: used + chars, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true },
    ).catch(() => {}),
  };
}

exports.translateAnonTexts = onCall(
  { region: REGION, invoker: 'public' },
  async (request) => {
    // Anonymous auth counts — every board reader has a session by the time they
    // can read a post (see _ensureAuthSession in js/anonymous.js). What this
    // rules out is a caller with no Firebase session at all.
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError('unauthenticated', 'Sign-in required.');
    }
    const data   = request.data || {};
    const target = String(data.target || '').trim().toLowerCase();
    const texts  = Array.isArray(data.texts) ? data.texts : null;

    if (!TRANSLATE_TARGETS.includes(target)) {
      throw new HttpsError('invalid-argument', 'Unsupported target language.');
    }
    if (!texts || !texts.length) {
      throw new HttpsError('invalid-argument', 'texts must be a non-empty array.');
    }
    if (texts.length > TRANSLATE_MAX_ITEMS) {
      throw new HttpsError('invalid-argument', `At most ${TRANSLATE_MAX_ITEMS} texts per call.`);
    }

    // Normalise: anything that isn't a usable string becomes a null result in
    // the same position, so the client can zip the response onto its inputs.
    const clean = texts.map((t) => {
      const s = typeof t === 'string' ? t.trim() : '';
      return s && s.length <= TRANSLATE_MAX_CHARS ? s : null;
    });
    const totalChars = clean.reduce((n, s) => n + (s ? s.length : 0), 0);
    if (totalChars > TRANSLATE_MAX_TOTAL) {
      throw new HttpsError('invalid-argument', `At most ${TRANSLATE_MAX_TOTAL} characters per call.`);
    }

    const results = clean.map(() => null);

    // ── 1. Cache ────────────────────────────────────────────────────────────
    // One document per (text, target). Identical texts in the same batch share
    // a lookup, and the whole board shares the document.
    const unique = new Map();               // text → [result indexes]
    clean.forEach((s, i) => {
      if (!s) return;
      if (!unique.has(s)) unique.set(s, []);
      unique.get(s).push(i);
    });
    const uniqueTexts = Array.from(unique.keys());
    if (!uniqueTexts.length) return { results };

    const cacheRefs = uniqueTexts.map(
      (s) => db.collection(TRANSLATE_CACHE_COL).doc(translateCacheId(s, target)),
    );
    const cached = await db.getAll(...cacheRefs);

    const misses = [];                      // indexes into uniqueTexts
    cached.forEach((snap, i) => {
      const d = snap.exists ? (snap.data() || {}) : {};
      if (typeof d.out !== 'string') { misses.push(i); return; }
      const hit = { text: d.out, src: d.src || '', same: !!d.same };
      for (const idx of unique.get(uniqueTexts[i])) results[idx] = hit;
    });
    if (!misses.length) return { results, cached: true };

    // ── 2. Budget ───────────────────────────────────────────────────────────
    // Only cache misses are charged, so a reader scrolling a board everyone
    // else has already read spends nothing.
    const missChars = misses.reduce((n, i) => n + uniqueTexts[i].length, 0);
    const budget    = await translateBudget(request.auth.uid);
    if (budget.used + missChars > TRANSLATE_DAILY_CHARS) {
      console.warn(`[translateAnonTexts] daily budget reached for ${request.auth.uid}`);
      return { results, budgetReached: true };
    }

    // ── 3. Translate ────────────────────────────────────────────────────────
    let translations;
    try {
      translations = await callTranslateApi(misses.map((i) => uniqueTexts[i]), target);
    } catch (e) {
      // Most likely the API isn't enabled, or billing is off. Say so rather
      // than failing the call — the board reads fine untranslated.
      console.error('[translateAnonTexts] translation failed', e);
      return { results, unavailable: true };
    }
    await budget.spend(missChars);

    const writes = db.batch();
    misses.forEach((uIdx, n) => {
      const source = uniqueTexts[uIdx];
      const tr     = translations[n] || {};
      const out    = decodeEntities(tr.translatedText || source);
      const src    = String(tr.detectedSourceLanguage || '').toLowerCase();
      // Already in the reader's language (detected as the target, or came back
      // unchanged) → the client shows it as written, with no translation line.
      const same   = src === target || out === source;
      const entry  = { text: out, src, same };
      for (const idx of unique.get(source)) results[idx] = entry;
      writes.set(cacheRefs[uIdx], {
        out, src, same, target,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    await writes.commit().catch((e) => console.warn('[translateAnonTexts] cache write failed', e));

    return { results };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// Board interactions: reactions, polls, the daily mood check-in
// ═══════════════════════════════════════════════════════════════════════════
// Written through callables (Admin SDK) rather than client writes, so none of
// them needs a Firestore rules change — clients already read post docs, which
// is where reaction counts and poll tallies live.
//
// Privacy follows likes: only totals are stored. Which posts you reacted to,
// and how you voted, stay in localStorage on your device. The mood check-in
// keeps one "this session has checked in today" marker so it counts once — the
// marker holds no mood, and sweepAnonMoodSeen deletes it two days later.

const REACTION_KINDS  = ['hug', 'same', 'strong'];
// The board check-in uses Bipolar Bear's own five moods (30 Sep 2026), so a
// journal entry can check in for its owner with no translation. The first
// release asked Low / Flat / Okay / Racing; a cached client may still send those,
// and today's totals may still hold them, so they fold into the nearest mood.
const MOOD_KINDS      = ['manic', 'elevated', 'stable', 'low', 'depressed'];
const MOOD_LEGACY     = { low: 'low', flat: 'stable', okay: 'stable', high: 'elevated' };
const MOOD_COL        = 'bbAnonMood';       // {day}: totals per mood
const MOOD_SEEN_COL   = 'bbAnonMoodSeen';   // {day}_{uid}: checked-in marker
// The bear checks in first each day with a random mood (stored as `bear` on the
// day's totals, never in the mood counts), so whoever checks in early on a quiet
// day isn't on their own. It's counted until the third real check-in, then
// quietly left out — the total stays at 3 rather than dropping (James, 2026-10-05).
const MOOD_BEAR_UNTIL = 3;
const BANNED_COL      = 'bbAnonBanned';     // doc id = lowercased monika
const POLL_MAX_OPTS   = 4;
const POLL_OPT_CHARS  = 60;
const POLL_TEXT_CHARS = 1000;

function requireAuth(request) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Sign-in required.');
  }
}

// The board's day, in UK time — the community is UK-based, and a day that
// rolled over at 01:00 BST would split one evening across two totals.
function boardDay(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(date || new Date());
}

// ── Reactions ────────────────────────────────────────────────────────────────
// { postId, kind: 'hug'|'same'|'strong', delta: 1|-1 } → { count }
// The client dedupes (like it does for 💛); the server only keeps the total
// sane — never below zero, never on a deleted or missing post.
exports.reactAnonPost = onCall(
  { region: REGION, invoker: 'public' },
  async (request) => {
    requireAuth(request);
    const data   = request.data || {};
    const postId = String(data.postId || '');
    const kind   = String(data.kind || '');
    const delta  = data.delta === -1 ? -1 : 1;
    if (!postId || postId.includes('/') || !REACTION_KINDS.includes(kind)) {
      throw new HttpsError('invalid-argument', 'Bad reaction.');
    }
    const ref = db.collection(POSTS).doc(postId);
    const count = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data().deleted) throw new HttpsError('not-found', 'Post not found.');
      const cur  = Number((snap.data().reactions || {})[kind]) || 0;
      const next = Math.max(0, cur + delta);
      tx.update(ref, { [`reactions.${kind}`]: next });
      return next;
    });
    return { count };
  }
);

// ── Polls ────────────────────────────────────────────────────────────────────
// createAnonPoll: the compose sheet's poll. Written here so the options are
// validated and the tallies start at zero; the rest of the post has the same
// shape (and the same trust) as a post the client writes itself.
exports.createAnonPoll = onCall(
  { region: REGION, invoker: 'public' },
  async (request) => {
    requireAuth(request);
    const d = request.data || {};
    const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
    const text    = str(d.text, POLL_TEXT_CHARS);
    const name    = str(d.name, 20);
    const options = (Array.isArray(d.options) ? d.options : [])
      .map((o) => str(o, POLL_OPT_CHARS)).filter(Boolean);
    if (!text || !name) throw new HttpsError('invalid-argument', 'A question and a name are needed.');
    if (options.length < 2 || options.length > POLL_MAX_OPTS) {
      throw new HttpsError('invalid-argument', `A poll needs 2–${POLL_MAX_OPTS} options.`);
    }
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
      throw new HttpsError('invalid-argument', 'Options must differ.');
    }
    const banned = await db.collection(BANNED_COL).doc(name.toLowerCase()).get();
    if (banned.exists) throw new HttpsError('permission-denied', 'Posting is disabled for this member.');

    const num = (v, dflt) => (Number.isFinite(Number(v)) ? Number(v) : dflt);
    const colour = (v) => (/^#[0-9a-f]{3,8}$/i.test(String(v || '')) ? String(v) : '');
    const ref = await db.collection(POSTS).add({
      name,
      text,
      tab:       'general',
      streak:    num(d.streak, 1),
      initials:  str(d.initials, 2),
      grad1:     colour(d.grad1),
      grad2:     colour(d.grad2),
      // The admin posts under the shared "Bipolar Bear Admin" label (see
      // authorLabel in js/anonymous.js); trusted from the token, not the client.
      isAdmin:   !!(request.auth.token && request.auth.token.email === ADMIN_ACCOUNT_EMAIL),
      med:       str(d.med, 60),
      stable:    num(d.stable, 0),
      joinedAt:  d.joinedAt ? str(d.joinedAt, 40) : null,
      likes:     0,
      isSystem:  false,
      poll:      { options, votes: options.map(() => 0) },
      uid:       request.auth.uid,   // owner, for self-delete / rename (firestore.rules)
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { id: ref.id };
  }
);

// voteAnonPoll: { postId, option, from? } → { votes }. `from` is the option the
// device voted for before (changing your vote moves it); the device remembers
// its own vote, as with likes.
exports.voteAnonPoll = onCall(
  { region: REGION, invoker: 'public' },
  async (request) => {
    requireAuth(request);
    const data   = request.data || {};
    const postId = String(data.postId || '');
    const option = Number(data.option);
    const from   = data.from == null ? null : Number(data.from);
    if (!postId || postId.includes('/') || !Number.isInteger(option)) {
      throw new HttpsError('invalid-argument', 'Bad vote.');
    }
    const ref = db.collection(POSTS).doc(postId);
    const votes = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const poll = snap.exists && !snap.data().deleted ? snap.data().poll : null;
      if (!poll || !Array.isArray(poll.options)) throw new HttpsError('not-found', 'Poll not found.');
      const n = poll.options.length;
      if (option < 0 || option >= n) throw new HttpsError('invalid-argument', 'No such option.');
      const v = poll.options.map((_, i) => Math.max(0, Number((poll.votes || [])[i]) || 0));
      if (from !== null && Number.isInteger(from) && from >= 0 && from < n) {
        if (from === option) return v;
        v[from] = Math.max(0, v[from] - 1);
      }
      v[option] += 1;
      tx.update(ref, { 'poll.votes': v });
      return v;
    });
    return { votes };
  }
);

// ── Daily mood check-in ──────────────────────────────────────────────────────
// { mood?, source? } → { day, counts, checkedIn, via, bear }. With no mood it just
// reads today's totals (the board shows them once you've checked in). One
// check-in per account per UK day; a second is ignored rather than moved, which
// is what lets the marker carry no mood at all. source: 'journal' is Bipolar
// Bear checking in for a linked account after a journal entry is saved — the
// marker then says so (still no mood), so the board can explain the tick.
exports.anonMoodCheckin = onCall(
  { region: REGION, invoker: 'public' },
  async (request) => {
    requireAuth(request);
    const raw  = request.data && request.data.mood != null ? String(request.data.mood) : null;
    const mood = raw === null ? null : (MOOD_KINDS.includes(raw) ? raw : (MOOD_LEGACY[raw] || ''));
    if (mood === '') throw new HttpsError('invalid-argument', 'Unknown mood.');
    const via      = request.data && request.data.source === 'journal' ? 'journal' : 'board';
    const day      = boardDay();
    const totalRef = db.collection(MOOD_COL).doc(day);
    const seenRef  = db.collection(MOOD_SEEN_COL).doc(`${day}_${request.auth.uid}`);
    const out = await db.runTransaction(async (tx) => {
      const [totSnap, seenSnap] = await Promise.all([tx.get(totalRef), tx.get(seenRef)]);
      const doc = totSnap.exists ? totSnap.data() : {};
      const counts = {};
      MOOD_KINDS.forEach((k) => { counts[k] = Number(doc[k] || 0); });
      // Fold today's old-style totals into the new moods (read-side only).
      Object.keys(MOOD_LEGACY).forEach((old) => {
        if (!MOOD_KINDS.includes(old)) counts[MOOD_LEGACY[old]] += Number(doc[old] || 0);
      });
      let checkedIn = seenSnap.exists;
      let seenVia   = seenSnap.exists ? (seenSnap.data().via || 'board') : null;
      const write   = {};
      if (mood !== null && !checkedIn) {
        counts[mood] += 1;
        Object.assign(write, { [mood]: admin.firestore.FieldValue.increment(1), day });
        tx.set(seenRef, { day, via });
        checkedIn = true;
        seenVia = via;
      }
      const real = MOOD_KINDS.reduce((n, k) => n + counts[k], 0);
      let bear = MOOD_KINDS.includes(doc.bear) ? doc.bear : null;
      if (real < MOOD_BEAR_UNTIL) {
        if (!bear) {
          bear = MOOD_KINDS[Math.floor(Math.random() * MOOD_KINDS.length)];
          Object.assign(write, { bear, day });
        }
        counts[bear] += 1;
      } else {
        bear = null;
      }
      if (Object.keys(write).length) tx.set(totalRef, write, { merge: true });
      // `bear` lets the client drop it from its optimistic count at the same
      // moment the server does, so the third check-in doesn't flicker.
      return { counts, checkedIn, via: seenVia, bear };
    });
    return { day, ...out };
  }
);

// The check-in markers are only needed for the day they belong to.
exports.sweepAnonMoodSeen = onSchedule(
  { schedule: '30 3 * * *', timeZone: 'Europe/London', region: REGION },
  async () => {
    const cutoff = boardDay(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
    let removed = 0;
    for (;;) {
      const snap = await db.collection(MOOD_SEEN_COL).where('day', '<=', cutoff).limit(400).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      removed += snap.size;
      if (snap.size < 400) break;
    }
    console.log(`[sweepAnonMoodSeen] removed ${removed} markers up to ${cutoff}`);
  }
);

// ── Universal ID ─────────────────────────────────────────────────────────────
// The UNI·SIM sign-in in front of the Bipolar Bear account (2026-10-05). The
// client (js/shared/universal-id.js) signs in to Universal ID — Supabase Auth on
// the shared UNI·SIM project — and sends that session's access token here.
// `uidSignIn` checks it with Supabase and answers with a Firebase custom token
// for the Bipolar Bear account it belongs to. Everything underneath (Firestore,
// its rules, the journal's end-to-end encryption) is unchanged.
//
// The Supabase user id ↔ Firebase uid join lives ONLY here, in `uidLinks`
// (Cloud Functions only — the rules deny every client). Supabase is never told
// that the person uses Bipolar Bear.
//
// ⚠️ An existing Bipolar Bear account with the same email is NEVER handed over
// on the email alone: its personal details are stored unencrypted, and an
// address may have been registered by someone who never owned it. The person
// signs in with its old password once, and `uidLink` joins the two.
//
// Minting custom tokens needs the runtime service account to hold
// roles/iam.serviceAccountTokenCreator on itself (DOCS.md §2.17).

const SUPABASE_URL      = 'https://rygfxgalojojppxmhddo.supabase.co';
// The PUBLISHABLE anon key, the same one every suite web bundle ships.
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5Z2Z4Z2Fsb2pvanBweG1oZGRvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NTY4MjUsImV4cCI6MjA5NDMzMjgyNX0.hLy_vt9vY_rdPKF3nL32yAuMCD604E3CH5VM7D7CaNE';
const UID_LINKS         = 'uidLinks';
/** How recent the Bipolar Bear password sign-in behind `uidLink` must be. */
const LINK_PASSWORD_MAX_AGE_S = 15 * 60;

/**
 * The Universal ID user behind an access token, asked of Supabase itself (so a
 * revoked or signed-out session is refused). Only a real account with a
 * confirmed email passes.
 * @returns {Promise<{id: string, email: string}>}
 */
async function universalIdUser(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 8192) {
    throw new HttpsError('invalid-argument', 'A Universal ID session is required.');
  }
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    throw new HttpsError('unavailable', 'Universal ID could not be reached. Try again.');
  }
  if (res.status === 401 || res.status === 403) {
    throw new HttpsError('unauthenticated', 'Your Universal ID sign-in has ended. Sign in again.');
  }
  if (!res.ok) throw new HttpsError('unavailable', 'Universal ID could not be reached. Try again.');
  const u = await res.json();
  const email = String(u.email || '').trim().toLowerCase();
  if (!u.id || u.is_anonymous || !email || !(u.email_confirmed_at || u.confirmed_at)) {
    throw new HttpsError('failed-precondition', 'This Universal ID has no confirmed email address.');
  }
  return { id: String(u.id), email };
}

/** A Firebase user, or null when there is no such user. */
async function firebaseUserOrNull(lookup) {
  try { return await lookup(); }
  catch (e) { if (e.code === 'auth/user-not-found') return null; throw e; }
}

function hasPasswordSignIn(user) {
  return (user.providerData || []).some((p) => p.providerId === 'password');
}

function writeUidLink(supabaseId, firebaseUid, email, via) {
  return db.collection(UID_LINKS).doc(supabaseId).set({
    firebaseUid, email, via, linkedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * Keep the Firebase account's email in step with the Universal ID it is joined
 * to (Universal ID lets people change theirs), and marked verified — Supabase
 * proved it. The Firestore rules and the Bipolar Anonymous board read both.
 */
async function syncFirebaseEmail(fbUser, email) {
  try {
    if ((fbUser.email || '').toLowerCase() !== email) {
      await admin.auth().updateUser(fbUser.uid, { email, emailVerified: true });
    } else if (!fbUser.emailVerified) {
      await admin.auth().updateUser(fbUser.uid, { emailVerified: true });
    }
  } catch (e) {
    // Another Bipolar Bear account already has the new address: leave it be.
    if (e.code !== 'auth/email-already-exists') console.warn('[uidSignIn] email sync failed', e.code || e);
  }
}

exports.uidSignIn = onCall(
  { region: REGION, invoker: 'public' },
  async (request) => {
    const person  = await universalIdUser(request.data && request.data.token);
    const linkRef = db.collection(UID_LINKS).doc(person.id);

    // Twice at most: a parallel call can create the account between our look
    // and our create, and the second pass then finds it.
    for (let pass = 0; pass < 2; pass++) {
      const link = await linkRef.get();
      if (link.exists) {
        const fb = await firebaseUserOrNull(() => admin.auth().getUser(link.data().firebaseUid));
        if (fb) {
          await syncFirebaseEmail(fb, person.email);
          return { status: 'ok', customToken: await admin.auth().createCustomToken(fb.uid), created: false };
        }
        // The Bipolar Bear account was deleted since: start again below.
        await linkRef.delete();
      }

      const existing = await firebaseUserOrNull(() => admin.auth().getUserByEmail(person.email));
      if (existing) {
        if (hasPasswordSignIn(existing)) return { status: 'link', email: person.email };
        // No password to prove, so this function made it — but only adopt it
        // if no OTHER Universal ID is joined to it (someone who has since
        // changed their Universal ID email must not lose it to the address's
        // next owner).
        const others = await db.collection(UID_LINKS).where('firebaseUid', '==', existing.uid).limit(1).get();
        if (!others.empty) {
          throw new HttpsError('already-exists',
            'This email belongs to another Bipolar Bear account. Email inbox@unisim.co.uk and we will sort it out.');
        }
        await writeUidLink(person.id, existing.uid, person.email, 'adopted');
        continue;
      }

      try {
        const created = await admin.auth().createUser({ email: person.email, emailVerified: true });
        await writeUidLink(person.id, created.uid, person.email, 'created');
        return { status: 'ok', customToken: await admin.auth().createCustomToken(created.uid), created: true };
      } catch (e) {
        if (e.code !== 'auth/email-already-exists') throw e;
      }
    }
    throw new HttpsError('aborted', 'Sign-in clashed with another attempt. Try again.');
  }
);

// Join the Bipolar Bear account signed in right now — by its password, moments
// ago — to the caller's Universal ID. Any other Universal ID joined to the same
// account is dropped: the password has just proved who owns it.
exports.uidLink = onCall(
  { region: REGION, invoker: 'public' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in with your Bipolar Bear password first.');
    }
    const person = await universalIdUser(request.data && request.data.token);
    const claims = request.auth.token || {};
    const viaPassword = claims.firebase && claims.firebase.sign_in_provider === 'password';
    const ageS = Math.floor(Date.now() / 1000) - Number(claims.auth_time || 0);
    if (!viaPassword || ageS > LINK_PASSWORD_MAX_AGE_S) {
      throw new HttpsError('permission-denied', 'Sign in with your Bipolar Bear password first.');
    }
    const fb = await admin.auth().getUser(request.auth.uid);
    if ((fb.email || '').toLowerCase() !== person.email) {
      throw new HttpsError('permission-denied', 'This Bipolar Bear account has a different email address.');
    }
    const others = await db.collection(UID_LINKS).where('firebaseUid', '==', fb.uid).get();
    const batch = db.batch();
    others.docs.forEach((d) => { if (d.id !== person.id) batch.delete(d.ref); });
    await batch.commit();
    await writeUidLink(person.id, fb.uid, person.email, 'password');
    if (!fb.emailVerified) await admin.auth().updateUser(fb.uid, { emailVerified: true });
    return { status: 'ok' };
  }
);
