'use strict';
/**
 * Privacy round, 2026-10-12 (James: "action all and follow your recs").
 *
 *   Board ownership without uids
 *     Posts, comments and monika reservations are public. They used to carry
 *     the author's Firebase uid, which linked every post (and, through
 *     bbAnonMonikas, every name) to one account. They now carry
 *       owner = sha256(uid + '/' + <document path>)
 *     which the Firestore rules can check (`hashing.sha256`), but which differs
 *     per document, so two posts can't be tied to the same person. Builds that
 *     still write `uid` (Bipolar Bear 1.41 / Bipolar Anonymous 1.40 as built
 *     on 2026-10-12) are converted the moment the document lands
 *     (anonOwnerOnPost / OnComment / OnMonika).
 *
 *   Board profiles keyed by a server secret
 *     anonProfiles used to be keyed by sha256(email): anyone who knew an
 *     address could find the document. They are now keyed by
 *       'p2_' + HMAC-SHA256(ANON_PROFILE_SECRET, 'bb-anon-profile:v1:' + email)
 *     and only the server can work that out. verifyAnonCode (email-code path)
 *     and anonProfileId (Bipolar Bear accounts) hand the id to the session and
 *     record it in bbAnonLinks/{uid}.profileIds, which the rules read.
 *     Old-style documents are moved across when their owner next signs in, and
 *     by privacySweep whenever the address can be worked out.
 *
 *   Retention (privacySweep, daily) and account deletion (onAuthUserDeleted).
 *
 * ⚠️ Never rotate or delete ANON_PROFILE_SECRET: every board profile id is
 * derived from it, and members would lose their profile.
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated, onDocumentDeleted, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const functionsV1 = require('firebase-functions/v1');
const admin = require('firebase-admin');
const crypto = require('crypto');

const { FieldValue: FV, Timestamp: TS, FieldPath } = require('firebase-admin/firestore');

const db = admin.firestore();
const REGION = 'europe-west1';
const ANON_PROFILE_SECRET = defineSecret('ANON_PROFILE_SECRET');

const POSTS = 'bbAnonPosts';
const MONIKAS = 'bbAnonMonikas';
const PROFILES = 'anonProfiles';
const LINKS = 'bbAnonLinks';
const PROFILE_PREFIX = 'p2_';
const DAY = 24 * 60 * 60 * 1000;

/** How long things are kept. Keep privacy.html §retention in step. */
const RETENTION = {
  postDays: 7,                 // board posts with no activity (the board says so)
  reportedPostDays: 90,        // a reported post is kept for moderation, then goes
  reportDays: 90,              // bbAnonReports
  reviewedSuggestionDays: 90,  // published or refused announcement suggestions
  translationDays: 7,          // bbAnonTranslations cache (posts only live a week)
  verifyHours: 25,             // anonVerify: getBBStats reads a verified one for 24 h
  verifyUnusedHours: 1,        // ... an unverified code is dead after 10 minutes
  feedbackDays: 365,           // feedback
  betaSignupDays: 365,         // betaSignups
  presenceHours: 1,            // bbPresence / bbAnonPresence heartbeats
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function sha256Hex(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function normEmail(e) { return String(e || '').toLowerCase().trim(); }
/** The old profile key, as js/anonymous.js `_anonEmailHash` computes it. */
function emailHash(email) { return sha256Hex(normEmail(email)); }
/** The board profile id for an address. Needs the secret's value. */
function profileIdFor(email, secret) {
  return PROFILE_PREFIX + crypto.createHmac('sha256', secret)
    .update('bb-anon-profile:v1:' + normEmail(email)).digest('hex');
}
function isLegacyProfileId(id) { return /^[0-9a-f]{64}$/.test(id); }
/** The `owner` stamp on a public board document. Matches firestore.rules. */
function ownerHash(uid, docPath) { return sha256Hex(uid + '/' + docPath); }
function millis(v) {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v === 'number') return v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

/** Delete refs in batches of 400. Returns how many. */
async function deleteRefs(refs) {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = db.batch();
    refs.slice(i, i + 400).forEach((r) => batch.delete(r));
    await batch.commit();
  }
  return refs.length;
}

/** Every doc of a query, paged by document id (no index needed beyond the default). */
async function allDocs(query, page = 400) {
  const out = [];
  let cursor = null;
  for (;;) {
    let q = query.orderBy(FieldPath.documentId()).limit(page);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    out.push(...snap.docs);
    if (snap.size < page) return out;
    cursor = snap.docs[snap.docs.length - 1];
  }
}

/**
 * Record in bbAnonLinks/{uid} that this session owns the profile `profileId`
 * (for the address whose sha256 is `hash`). The rules read `profileIds`.
 * `codeVerified` also makes it the session's email-code address (`emailHash`,
 * which the rules' admin check and the old-style profiles still use).
 */
async function addLink(uid, hash, profileId, codeVerified) {
  const patch = {
    emailHashes: FV.arrayUnion(hash),
    profileIds: FV.arrayUnion(profileId),
    [`profiles.${hash}`]: profileId,
    verifiedAt: TS.now(),
  };
  if (codeVerified) patch.emailHash = hash;
  const ref = db.collection(LINKS).doc(uid);
  try { await ref.update(patch); }
  catch (e) {
    // No link yet: update() can't create, set() can't take dotted paths.
    await ref.set({
      emailHashes: [hash], profileIds: [profileId], profiles: { [hash]: profileId },
      verifiedAt: TS.now(), ...(codeVerified ? { emailHash: hash } : {}),
    }, { merge: true });
  }
}

const SERVER_ONLY_PROFILE_KEYS = ['restoreUntil', 'compatCopy', 'compatUntil', 'compatOf'];

/**
 * Move anonProfiles/{legacyId} (sha256 of the address) into
 * anonProfiles/{profileId}. Whichever copy was saved more recently wins field by
 * field; `counted` (the member-count flag) is kept if either has it.
 * Resolves true if something was moved.
 */
async function mergeLegacyProfile(legacyId, profileId) {
  if (!legacyId || !profileId || legacyId === profileId) return false;
  const oldRef = db.collection(PROFILES).doc(legacyId);
  const newRef = db.collection(PROFILES).doc(profileId);
  return db.runTransaction(async (tx) => {
    const [o, n] = await Promise.all([tx.get(oldRef), tx.get(newRef)]);
    if (!o.exists) return false;
    const od = { ...o.data() };
    const nd = n.exists ? { ...n.data() } : {};
    const newer = millis(od.updatedAt) > millis(nd.updatedAt);
    const merged = newer ? { ...nd, ...od } : { ...od, ...nd };
    if (od.counted === true || nd.counted === true) merged.counted = true;
    SERVER_ONLY_PROFILE_KEYS.forEach((k) => { delete merged[k]; });
    // Only a server-written restore stamp: nothing a member saved.
    const hasContent = Object.keys(merged).some((k) => k !== 'updatedAt');
    if (hasContent) tx.set(newRef, merged);
    tx.delete(oldRef);
    return true;
  });
}

/**
 * App builds from before profile ids (Bipolar Anonymous / Bear as built on
 * 2026-10-12) still read anonProfiles/{sha256(email)} after the code. Give
 * that session a short-lived copy it alone can read (the rules want the
 * bbAnonLinks proof); privacySweep folds any change back and deletes it.
 */
async function writeCompatCopy(legacyId, profileId) {
  const snap = await db.collection(PROFILES).doc(profileId).get();
  if (!snap.exists) return;
  await db.collection(PROFILES).doc(legacyId).set({
    ...snap.data(), compatCopy: true, compatUntil: TS.fromMillis(Date.now() + 2 * DAY),
  });
}

// ── Profile ids ─────────────────────────────────────────────────────────────

/**
 * anonProfileId({ email? }) → { profileId }
 *   A Bipolar Bear account (verified email on the token): the id for that
 *   address. An email-code session from before profile ids: `email` must be
 *   the address bbAnonLinks says it proved.
 */
const anonProfileId = onCall(
  { region: REGION, invoker: 'public', secrets: [ANON_PROFILE_SECRET] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const uid = request.auth.uid;
    const tok = request.auth.token || {};
    const provider = tok.firebase && tok.firebase.sign_in_provider;
    let email = null;
    let viaAccount = false;
    const asked = request.data && typeof request.data.email === 'string' ? normEmail(request.data.email) : '';
    if (provider !== 'anonymous' && tok.email && tok.email_verified === true
        && (!asked || asked === normEmail(tok.email))) {
      email = tok.email;
      viaAccount = true;
    } else if (asked) {
      const link = await db.collection(LINKS).doc(uid).get();
      const h = emailHash(asked);
      const d = link.exists ? link.data() : {};
      if (d.emailHash !== h && !(Array.isArray(d.emailHashes) && d.emailHashes.includes(h))) {
        throw new HttpsError('permission-denied', 'Verify this address with a code first.');
      }
      email = asked;
    }
    if (!email) throw new HttpsError('failed-precondition', 'No verified address for this session.');
    const hash = emailHash(email);
    const profileId = profileIdFor(email, ANON_PROFILE_SECRET.value());
    await addLink(uid, hash, profileId, false);
    await mergeLegacyProfile(hash, profileId).catch((e) => console.warn('[anonProfileId] merge', e));
    return { profileId, account: viaAccount };
  }
);

/**
 * Called by verifyAnonCode once a code is right. Returns the profile id.
 * `wantsV2` is false for builds that still read the old-style document.
 */
async function recordVerifiedEmail(request, email, wantsV2) {
  if (!email) return null;
  const hash = emailHash(email);
  const profileId = profileIdFor(email, ANON_PROFILE_SECRET.value());
  try {
    await mergeLegacyProfile(hash, profileId);
    if (request.auth && request.auth.uid) {
      await addLink(request.auth.uid, hash, profileId, true);
      if (!wantsV2) await writeCompatCopy(hash, profileId);
    }
  } catch (e) { console.error('[verifyAnonCode] recording the verified email failed', e); }
  return profileId;
}

// ── Owner stamps instead of uids ────────────────────────────────────────────

async function swapUidForOwner(snap, docPath) {
  const d = snap && snap.data();
  if (!d || !Object.prototype.hasOwnProperty.call(d, 'uid')) return;
  const patch = { uid: FV.delete() };
  if (typeof d.uid === 'string' && d.uid && !d.owner) patch.owner = ownerHash(d.uid, docPath);
  try { await snap.ref.update(patch); }
  catch (e) { if (e.code !== 5) console.warn('[owner] swap failed', docPath, e.message); } // 5 = already deleted
}

const anonOwnerOnPost = onDocumentCreated(
  { document: `${POSTS}/{postId}`, region: REGION },
  (event) => swapUidForOwner(event.data, `${POSTS}/${event.params.postId}`)
);
const anonOwnerOnComment = onDocumentCreated(
  { document: `${POSTS}/{postId}/comments/{commentId}`, region: REGION },
  (event) => swapUidForOwner(event.data, `${POSTS}/${event.params.postId}/comments/${event.params.commentId}`)
);
const anonOwnerOnMonika = onDocumentCreated(
  { document: `${MONIKAS}/{id}`, region: REGION },
  (event) => swapUidForOwner(event.data, `${MONIKAS}/${event.params.id}`)
);

// A post's replies go with it, however it was deleted (the 7-day sweep, the
// author, the admin, an older app build).
const onAnonPostDeleted = onDocumentDeleted(
  { document: `${POSTS}/{postId}`, region: REGION },
  async (event) => {
    await db.recursiveDelete(db.collection(POSTS).doc(event.params.postId).collection('comments'));
  }
);

// Older builds send the sha256 of the member's email with their push
// registration. Nothing reads it; drop it as it lands.
const anonPushStripEmailHash = onDocumentWritten(
  { document: 'bbAnonPush/{token}', region: REGION },
  async (event) => {
    const after = event.data && event.data.after;
    if (!after || !after.exists) return;
    if (!Object.prototype.hasOwnProperty.call(after.data(), 'emailHash')) return;
    await after.ref.update({ emailHash: FV.delete() }).catch(() => {});
  }
);

// ── "I needed this today" (survival kit) without an account ────────────────
// It used to sign every visitor in anonymously just to move one number.
const _helpedHits = new Map(); // hashed caller → [timestamps], this instance only, never stored
const helpedVote = onCall(
  { region: REGION, invoker: 'public' },
  async (request) => {
    const delta = Number(request.data && request.data.delta);
    if (delta !== 1 && delta !== -1) throw new HttpsError('invalid-argument', 'delta must be 1 or -1.');
    const ip = (request.rawRequest && (request.rawRequest.ip || request.rawRequest.headers['x-forwarded-for'])) || '';
    const who = sha256Hex('helped:' + ip);
    const now = Date.now();
    const hits = (_helpedHits.get(who) || []).filter((t) => now - t < 60000);
    if (hits.length >= 10) throw new HttpsError('resource-exhausted', 'Slow down.');
    hits.push(now);
    _helpedHits.set(who, hits);
    if (_helpedHits.size > 5000) _helpedHits.clear();
    const ref = db.collection('counters').doc('helpedCount');
    await ref.set({ count: FV.increment(delta) }, { merge: true });
    const snap = await ref.get();
    return { count: snap.exists ? Number(snap.data().count) || 0 : 0 };
  }
);

// ── Retention ───────────────────────────────────────────────────────────────

/** Address book for moving old-style profiles: sha256(email) → profile id. */
async function legacyIdMap(secret) {
  const map = new Map();
  const links = await allDocs(db.collection(LINKS));
  links.forEach((l) => {
    const p = l.get('profiles');
    if (p && typeof p === 'object') Object.keys(p).forEach((h) => { if (p[h]) map.set(h, p[h]); });
  });
  let pageToken;
  do {
    const res = await admin.auth().listUsers(1000, pageToken);
    res.users.forEach((u) => { if (u.email) map.set(emailHash(u.email), profileIdFor(u.email, secret)); });
    pageToken = res.pageToken;
  } while (pageToken);
  const recent = await db.collection('anonVerify').get();
  recent.forEach((v) => { const e = v.get('email'); if (e) map.set(emailHash(e), profileIdFor(e, secret)); });
  return map;
}

/** Move every old-style profile whose address is known. */
async function migrateLegacyProfiles(secret, { apply = true } = {}) {
  const map = await legacyIdMap(secret);
  const docs = await allDocs(db.collection(PROFILES));
  const out = { legacy: 0, moved: 0, unknown: 0, compatExpired: 0, strippedRestore: 0 };
  for (const d of docs) {
    if (!isLegacyProfileId(d.id)) {
      if (d.get('restoreUntil') !== undefined) {
        out.strippedRestore++;
        if (apply) await d.ref.update({ restoreUntil: FV.delete() });
      }
      continue;
    }
    out.legacy++;
    const target = map.get(d.id);
    if (!target) {
      out.unknown++;
      // Nobody can prove this address any more without a new code, which moves
      // it then. Keep the member's profile, but not the restore stamp.
      if (apply && d.get('restoreUntil') !== undefined) await d.ref.update({ restoreUntil: FV.delete() });
      continue;
    }
    if (d.get('compatCopy') === true && millis(d.get('compatUntil')) > Date.now()) continue; // still in use
    if (d.get('compatCopy') === true) out.compatExpired++;
    if (apply && await mergeLegacyProfile(d.id, target)) out.moved++;
    else if (!apply) out.moved++;
  }
  return out;
}

/** Posts the 7-day rule (and the 90-day rule for reported ones) has expired. */
async function sweepPosts(apply) {
  const now = Date.now();
  const cutoff = TS.fromMillis(now - RETENTION.postDays * DAY);
  const snap = await db.collection(POSTS).where('timestamp', '<', cutoff).get();
  const refs = [];
  snap.forEach((doc) => {
    const d = doc.data();
    if (d.pinned || d.isTopic) return;
    const age = now - millis(d.timestamp);
    if (d.reported) { if (age > RETENTION.reportedPostDays * DAY) refs.push(doc.ref); return; }
    if (millis(d.lastActivity) >= cutoff.toMillis()) return;
    refs.push(doc.ref);
  });
  if (apply) for (const r of refs) await db.recursiveDelete(r);
  return refs.length;
}

/** Replies whose post is gone (deleted before onAnonPostDeleted existed). */
async function sweepOrphanComments(apply) {
  const docs = await db.collectionGroup('comments').get();
  const parents = new Map();
  const orphans = [];
  for (const c of docs.docs) {
    const post = c.ref.parent.parent;
    if (!post || post.parent.id !== POSTS) continue;
    if (!parents.has(post.path)) parents.set(post.path, (await post.get()).exists);
    if (!parents.get(post.path)) orphans.push(c.ref);
  }
  if (apply) await deleteRefs(orphans);
  return orphans.length;
}

async function sweepByTime(collection, field, olderThanMs, apply, { filter, asNumber } = {}) {
  const cutoff = Date.now() - olderThanMs;
  const snap = await db.collection(collection)
    .where(field, '<', asNumber ? cutoff : TS.fromMillis(cutoff)).get();
  const refs = snap.docs.filter((d) => !filter || filter(d.data())).map((d) => d.ref);
  if (apply) await deleteRefs(refs);
  return refs.length;
}

/**
 * Public board documents still carrying `uid` (written before the owner
 * stamps, or a trigger that didn't run) get the stamp instead.
 */
async function sweepUids(apply) {
  const out = { posts: 0, comments: 0, monikas: 0 };
  const fix = async (doc, kind) => {
    const d = doc.data();
    if (!Object.prototype.hasOwnProperty.call(d, 'uid')) return;
    out[kind]++;
    if (!apply) return;
    const patch = { uid: FV.delete() };
    if (typeof d.uid === 'string' && d.uid && !d.owner) patch.owner = ownerHash(d.uid, doc.ref.path);
    await doc.ref.update(patch).catch(() => {});
  };
  for (const d of (await db.collection(POSTS).get()).docs) await fix(d, 'posts');
  for (const d of (await db.collectionGroup('comments').get()).docs) await fix(d, 'comments');
  for (const d of (await db.collection(MONIKAS).get()).docs) await fix(d, 'monikas');
  return out;
}

/** Push registrations still carrying sha256(email). */
async function sweepPushHashes(apply) {
  let n = 0;
  for (const d of (await db.collection('bbAnonPush').get()).docs) {
    if (!Object.prototype.hasOwnProperty.call(d.data(), 'emailHash')) continue;
    n++;
    if (apply) await d.ref.update({ emailHash: FV.delete() }).catch(() => {});
  }
  return n;
}

/** One pass of every retention rule. Safe to repeat. */
async function runPrivacySweep({ apply = true, secret } = {}) {
  const r = {};
  const now = Date.now();
  r.ownerStamps = await sweepUids(apply);
  r.pushEmailHash = await sweepPushHashes(apply);
  // anonVerify: dead codes after an hour, verified ones after getBBStats' 24 h.
  {
    const snap = await db.collection('anonVerify')
      .where('createdAt', '<', TS.fromMillis(now - RETENTION.verifyUnusedHours * 3600000)).get();
    const refs = snap.docs.filter((d) => !d.get('verified')
      || millis(d.get('createdAt')) < now - RETENTION.verifyHours * 3600000).map((d) => d.ref);
    r.anonVerify = refs.length;
    if (apply) await deleteRefs(refs);
  }
  r.translations = await sweepByTime('bbAnonTranslations', 'updatedAt', RETENTION.translationDays * DAY, apply);
  r.reports = await sweepByTime('bbAnonReports', 'timestamp', RETENTION.reportDays * DAY, apply);
  r.suggestions = await sweepByTime('bbAnonAnnSuggestions', 'timestamp', RETENTION.reviewedSuggestionDays * DAY,
    apply, { filter: (d) => d.status === 'approved' || d.status === 'rejected' });
  r.feedback = await sweepByTime('feedback', 'ts', RETENTION.feedbackDays * DAY, apply, { asNumber: true });
  r.betaSignups = await sweepByTime('betaSignups', 'timestamp', RETENTION.betaSignupDays * DAY, apply);
  r.presence = await sweepByTime('bbPresence', 'lastSeen', RETENTION.presenceHours * 3600000, apply);
  r.anonPresence = await sweepByTime('bbAnonPresence', 'lastSeen', RETENTION.presenceHours * 3600000, apply);
  r.posts = await sweepPosts(apply);
  r.orphanComments = await sweepOrphanComments(apply);
  if (secret) r.profiles = await migrateLegacyProfiles(secret, { apply });
  return r;
}

const privacySweep = onSchedule(
  { schedule: '10 4 * * *', timeZone: 'Europe/London', region: REGION, timeoutSeconds: 540,
    memory: '512MiB', secrets: [ANON_PROFILE_SECRET] },
  async () => {
    const r = await runPrivacySweep({ apply: true, secret: ANON_PROFILE_SECRET.value() });
    console.log('[privacySweep]', JSON.stringify(r));
  }
);

// ── Account deletion ────────────────────────────────────────────────────────
// Whatever deleted the account (the app's own delete, an anonymous board
// session deleting itself, the console), nothing keyed to it stays behind.

async function deleteWhere(collection, field, value) {
  const snap = await db.collection(collection).where(field, '==', value).get();
  return deleteRefs(snap.docs.map((d) => d.ref));
}

/** Public board documents this uid wrote (owner stamp or a not-yet-swapped uid). */
async function boardDocsOf(uid) {
  const refs = [];
  const mine = (doc, path) => {
    const d = doc.data();
    return d.uid === uid || (d.owner && d.owner === ownerHash(uid, path));
  };
  const posts = await db.collection(POSTS).get();
  posts.forEach((p) => { if (mine(p, p.ref.path)) refs.push(p.ref); });
  const comments = await db.collectionGroup('comments').get();
  comments.forEach((c) => { if (mine(c, c.ref.path)) refs.push(c.ref); });
  const monikas = await db.collection(MONIKAS).get();
  monikas.forEach((m) => { if (mine(m, m.ref.path)) refs.push(m.ref); });
  return refs;
}

async function deleteUserData(user, secret) {
  const uid = user.uid;
  const out = {};
  const settings = await db.collection('userSettings').doc(uid).get();
  const monika = settings.exists && settings.get('anonProfile.monika');
  const refs = [
    db.collection('userSettings').doc(uid),
    db.collection('personalDetails').doc(uid),
    db.collection(LINKS).doc(uid),
    db.collection('bbAnonTranslateUsage').doc(uid),
  ];
  if (user.email && secret) {
    // The board profile of a Bipolar Bear account, as its own delete does.
    refs.push(db.collection(PROFILES).doc(profileIdFor(user.email, secret)));
    refs.push(db.collection(PROFILES).doc(emailHash(user.email)));
  }
  out.docs = await deleteRefs(refs);
  out.entries = await deleteWhere('entries', 'userId', uid);
  out.uidLinks = await deleteWhere('uidLinks', 'firebaseUid', uid);
  out.feedback = await deleteWhere('feedback', 'uid', uid);
  const seen = await db.collection('bbAnonMoodSeen').get();
  out.moodSeen = await deleteRefs(seen.docs.filter((d) => d.id.endsWith('_' + uid)).map((d) => d.ref));
  if (monika && user.email) out.push = await deleteWhere('bbAnonPush', 'monikaLower', String(monika).toLowerCase());
  const board = await boardDocsOf(uid);
  for (const r of board) await db.recursiveDelete(r);
  out.board = board.length;
  return out;
}

const onAuthUserDeleted = functionsV1.region(REGION)
  .runWith({ secrets: ['ANON_PROFILE_SECRET'], timeoutSeconds: 300 })
  .auth.user().onDelete(async (user) => {
    const out = await deleteUserData(user, process.env.ANON_PROFILE_SECRET);
    console.log('[onAuthUserDeleted]', JSON.stringify(out));
  });

module.exports = {
  // functions
  anonProfileId, anonOwnerOnPost, anonOwnerOnComment, anonOwnerOnMonika,
  onAnonPostDeleted, anonPushStripEmailHash, helpedVote, privacySweep, onAuthUserDeleted,
  // helpers for index.js and the one-off scripts
  _lib: {
    ANON_PROFILE_SECRET, RETENTION, emailHash, profileIdFor, ownerHash, isLegacyProfileId,
    recordVerifiedEmail, mergeLegacyProfile, migrateLegacyProfiles, runPrivacySweep, boardDocsOf,
    deleteUserData, sha256Hex,
  },
};
