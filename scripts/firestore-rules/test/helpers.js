'use strict';
/**
 * Shared set-up for the Firestore rules suite.
 *
 * Every test file gets two emulator projects loaded with ../../firestore.rules:
 *   legacy  — the rules as committed (legacyClients() == true), i.e. what is
 *             deployed while app builds <= 1.39 are still installed;
 *   strict  — the same file with legacyClients() switched to false.
 *
 * Identities mirror what the real clients carry:
 *   anon(uid)           standalone email-code path: Firebase anonymous auth,
 *                       no email on the token
 *   bb(uid, email)      Bipolar Bear account (email + password), verified
 *   admin()             the board admin's Bipolar Bear account
 *   guest()             no Firebase session at all
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  initializeTestEnvironment, assertSucceeds, assertFails,
} = require('@firebase/rules-unit-testing');
const firebase = require('firebase/compat/app').default;
require('firebase/compat/firestore');
// Denied writes are the point of half the suite; keep the SDK from logging each one.
require('firebase/firestore').setLogLevel('silent');

const RULES_PATH = path.join(__dirname, '..', '..', '..', 'firestore.rules');
const RULES = fs.readFileSync(RULES_PATH, 'utf8');
const LEGACY_SWITCH = 'function legacyClients() { return true; }';
if (!RULES.includes(LEGACY_SWITCH)) {
  throw new Error('firestore.rules no longer contains the legacyClients() switch the suite flips');
}
const STRICT_RULES = RULES.replace(LEGACY_SWITCH, 'function legacyClients() { return false; }');

const ADMIN_EMAIL = 'inbox@jamesmarkey.co.uk';
const FV = firebase.firestore.FieldValue;
const TS = firebase.firestore.Timestamp;
const DAY = 86400000;

/** sha256(lower-case trimmed email) as lower-case hex — same as the clients. */
function emailHash(email) {
  return crypto.createHash('sha256').update(String(email).toLowerCase().trim()).digest('hex');
}

/**
 * @param {string} name  unique per test file (becomes part of the project id)
 * @returns {Promise<{legacy: object, strict: object, cleanup: function}>}
 */
async function makeEnvs(name) {
  const mk = (mode, rules) => initializeTestEnvironment({
    projectId: `demo-bb-${name}-${mode}`,
    firestore: { rules },
  });
  const legacy = await mk('legacy', RULES);
  const strict = await mk('strict', STRICT_RULES);
  return {
    legacy,
    strict,
    async cleanup() { await legacy.cleanup(); await strict.cleanup(); },
  };
}

/** Context factories bound to one environment. */
function people(env) {
  return {
    guest: () => env.unauthenticatedContext().firestore(),
    anon: (uid) => env.authenticatedContext(uid, {
      firebase: { sign_in_provider: 'anonymous' },
    }).firestore(),
    bb: (uid, email, verified = true) => env.authenticatedContext(uid, {
      email, email_verified: verified, firebase: { sign_in_provider: 'password' },
    }).firestore(),
    admin: (uid = 'admin-uid') => env.authenticatedContext(uid, {
      email: ADMIN_EMAIL, email_verified: true, firebase: { sign_in_provider: 'password' },
    }).firestore(),
  };
}

/** Write documents with rules disabled (fixture data / Cloud Function writes). */
async function seed(env, docs) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [p, data] of Object.entries(docs)) await db.doc(p).set(data);
  });
}

/** What verifyAnonCode writes on a successful code. */
async function seedVerified(env, { uid, email, windowMs = 10 * 60 * 1000 }) {
  const hash = emailHash(email);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    if (uid) await db.doc(`bbAnonLinks/${uid}`).set({ emailHash: hash, verifiedAt: TS.now() });
    await db.doc(`anonProfiles/${hash}`).set(
      { restoreUntil: TS.fromMillis(Date.now() + windowMs) }, { merge: true });
  });
  return hash;
}

/** A board post as an existing member's client wrote it. */
function postDoc(over = {}) {
  return Object.assign({
    name: 'Robin', streak: 3, initials: 'RO', grad1: '#ffd54f', grad2: '#f9a825',
    isAdmin: false, text: 'hello', med: '', stable: 0, joinedAt: null,
    tab: 'general', likes: 0, isSystem: false,
    timestamp: TS.fromMillis(Date.now() - 60 * 1000),
  }, over);
}

function commentDoc(over = {}) {
  return Object.assign({
    name: 'Robin', text: 'same here', streak: 3, initials: 'RO',
    grad1: '#ffd54f', grad2: '#f9a825', isAdmin: false,
    timestamp: TS.fromMillis(Date.now() - 60 * 1000),
  }, over);
}

module.exports = {
  makeEnvs, people, seed, seedVerified, emailHash, postDoc, commentDoc,
  assertSucceeds, assertFails, FV, TS, DAY, ADMIN_EMAIL,
};
