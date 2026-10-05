'use strict';
/**
 * Compatibility: app builds 1.38 / 1.39 (and the web app before this branch)
 * must keep working against the committed rules (legacyClients() == true).
 */
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  makeEnvs, people, seed, seedVerified, emailHash, postDoc, commentDoc,
  assertSucceeds, TS, DAY, ADMIN_EMAIL,
} = require('./helpers');
const { board, admin, bear, profileOf } = require('./clients');

const flavour = 'shipped';
let envs, env, who;

before(async () => { envs = await makeEnvs('shipped'); env = envs.legacy; who = people(env); });
after(async () => { await envs.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

describe('standalone email-code path (anonymous auth)', () => {
  it('new member: code verified with no session, then onboarding and first post', async () => {
    const email = 'new.member@example.com';
    await assertSucceeds(board.monikaInUse(who.guest(), 'Robin'));
    await seedVerified(env, { uid: null, email });       // verifyAnonCode, caller had no session
    const snap = await assertSucceeds(board.anonRestoreProfile(who.guest(), email));
    assert.strictEqual(snap.data().monika, undefined);   // nothing to restore → monika screen
    await assertSucceeds(board.reserveMonika(who.guest(), 'Robin'));
    // initBoard(): anonymous session, profile saved, member counted, first post
    const db = who.anon('anon-new');
    await assertSucceeds(board.anonSaveProfile(db, email));
    await assertSucceeds(board.countOnce(db, db.collection('anonProfiles').doc(emailHash(email)), 'anonUserCount', 'counted'));
    await assertSucceeds(board.createPost(db, { flavour }));
  });

  it('returning member on a new device restores their profile after the code', async () => {
    const email = 'robin@example.com';
    await seed(env, { [`anonProfiles/${emailHash(email)}`]: profileOf() });
    await seedVerified(env, { uid: null, email });
    const snap = await assertSucceeds(board.anonRestoreProfile(who.guest(), email));
    assert.strictEqual(snap.data().monika, 'Robin');
    await assertSucceeds(board.anonSaveProfile(who.anon('anon-2'), email));
  });

  it('a post written before the session resolves still lands', async () => {
    await assertSucceeds(board.createPost(who.guest(), { flavour }));
  });

  it('board reads, daily topic, likes, reports, SOS', async () => {
    const db = who.anon('anon-1');
    await seed(env, {
      'bbAnonPosts/p1': postDoc({ name: 'Sam' }),
      'bbAnonPosts/topic-2026-10-03': postDoc({ isTopic: true, dayStr: '2026-10-03', commentCount: 2, name: 'Emma_27' }),
      'bbAnonPosts/topic-2026-10-02': postDoc({ isTopic: true, dayStr: '2026-10-02', name: 'Liam' }),
      'bbAnonBanned/troll': { monika: 'Troll' },
      'counters/anonUserCount': { count: 41 },
    });
    await assertSucceeds(board.listenTab(db, 'general'));
    await assertSucceeds(board.listenTab(who.guest(), 'announcements'));
    await assertSucceeds(board.fetchTopics(db));
    await assertSucceeds(board.postDailyTopic(db, '2026-10-05'));
    await assertSucceeds(board.retireTopic(db, 'topic-2026-10-03', true));
    await assertSucceeds(board.retireTopic(db, 'topic-2026-10-02', false));
    await assertSucceeds(board.like(db, 'p1', 1));
    await assertSucceeds(board.like(db, 'p1', -1));
    await assertSucceeds(board.readPost(db, 'p1'));
    await assertSucceeds(board.reportPost(db, 'p1'));
    await assertSucceeds(board.sos(db));
    await assertSucceeds(board.listenBanned(db));
    await assertSucceeds(board.readCounter(db, 'anonUserCount'));
  });

  it('comments: write, read, remove your own', async () => {
    const db = who.anon('anon-1');
    await seed(env, { 'bbAnonPosts/p1': postDoc({ name: 'Sam' }) });
    const ref = await assertSucceeds(board.comment(db, 'p1', { flavour }));
    await assertSucceeds(board.readThread(who.guest(), 'p1'));
    await assertSucceeds(board.deleteComment(db, 'p1', ref.id));
  });

  it('self-delete and rename of your own posts', async () => {
    const db = who.anon('anon-1');
    await seed(env, {
      'bbAnonPosts/a': postDoc(), 'bbAnonPosts/b': postDoc(), 'bbAnonPosts/c': postDoc(),
      'bbAnonMonikas/robin': { monika: 'Robin' },
    });
    await assertSucceeds(board.selfDeletePost(db, 'a'));
    await assertSucceeds(board.rename(db, 'Robin', 'Robyn', { flavour }));
    await assertSucceeds(board.rename(db, 'Robyn', 'ROBYN', { flavour })); // case-only change
  });

  it('a prolific member renames and deletes 40 posts in one batch', async () => {
    const docs = { 'bbAnonMonikas/robin': { monika: 'Robin' } };
    for (let i = 0; i < 40; i++) docs[`bbAnonPosts/r${i}`] = postDoc();
    await seed(env, docs);
    const db = who.anon('anon-1');
    await assertSucceeds(board.rename(db, 'Robin', 'Robyn', { flavour }));
    await assertSucceeds(board.deleteAccount(db, { monika: 'Robyn', email: null, flavour, counted: false }));
  });

  it('retention sweep deletes week-old posts and skips the rest', async () => {
    const old = TS.fromMillis(Date.now() - 8 * DAY);
    await seed(env, {
      'bbAnonPosts/old': postDoc({ timestamp: old }),
      'bbAnonPosts/oldAnn': postDoc({ timestamp: old, tab: 'announcements' }),
      'bbAnonPosts/reported': postDoc({ timestamp: old, reported: true }),
      'bbAnonPosts/pinned': postDoc({ timestamp: old, pinned: true }),
      'bbAnonPosts/active': postDoc({ timestamp: old, lastActivity: TS.fromMillis(Date.now() - DAY) }),
      'bbAnonPosts/fresh': postDoc(),
    });
    const n = await assertSucceeds(board.cleanOldPosts(who.anon('anon-1')));
    assert.strictEqual(n, 2);
  });

  it('announcement suggestions: submit, see own, dismiss when refused', async () => {
    const db = who.anon('anon-1');
    const ref = await assertSucceeds(board.submitSuggestion(db));
    await assertSucceeds(board.listenSuggestions(db));
    await seed(env, { [`bbAnonAnnSuggestions/${ref.id}`]: { name: 'Robin', text: 'x', status: 'rejected', timestamp: TS.now() } });
    await assertSucceeds(board.dismissSuggestion(db, ref.id));
  });

  it('push registration, presence, counters', async () => {
    const db = who.anon('anon-1');
    await assertSucceeds(board.pushRegister(db, 'tok-1'));
    await assertSucceeds(board.pushUnregister(who.guest(), 'tok-1'));
    await assertSucceeds(board.presence(db, 'bbAnonPresence', 's1'));
    await assertSucceeds(board.presence(who.guest(), 'bbPresence', 's2'));
  });

  it('account deletion, long after the code was entered', async () => {
    const email = 'robin@example.com';
    await seed(env, {
      'bbAnonPosts/a': postDoc(), 'bbAnonPosts/b': postDoc(),
      'bbAnonMonikas/robin': { monika: 'Robin' },
      [`anonProfiles/${emailHash(email)}`]: profileOf({ counted: true }),
      'counters/anonUserCount': { count: 41 },
      'bbAnonPush/tok-1': { token: 'tok-1' },
    });
    await assertSucceeds(board.deleteAccount(who.anon('anon-1'), { monika: 'Robin', email, flavour, pushToken: 'tok-1' }));
  });
});

describe('Bipolar Bear account on the board', () => {
  const uid = 'bb-1';
  const email = 'Kim@Example.com';

  it('restores, mirrors and counts the board profile', async () => {
    const db = who.bb(uid, email);
    await seed(env, { [`anonProfiles/${emailHash(email)}`]: profileOf({ monika: 'Kim' }) });
    await assertSucceeds(board.bbRestoreProfile(db, uid, email));
    await assertSucceeds(board.bbSaveProfile(db, uid, email));
    await assertSucceeds(board.countOnce(db, db.collection('anonProfiles').doc(emailHash(email)), 'anonUserCount', 'counted'));
  });

  it('first board visit creates the profile mirror', async () => {
    await assertSucceeds(board.bbSaveProfile(who.bb(uid, email), uid, email));
  });

  it('posts and comments like any member', async () => {
    const db = who.bb(uid, email);
    const ref = await assertSucceeds(board.createPost(db, { flavour, name: 'Kim' }));
    await assertSucceeds(board.comment(db, ref.id, { flavour, name: 'Kim' }));
  });
});

describe('board admin (Bipolar Bear account)', () => {
  it('posts as admin, announces, pins, deletes, bans, reviews suggestions', async () => {
    const db = who.admin();
    await seed(env, {
      'bbAnonPosts/p1': postDoc({ name: 'Troll' }),
      'bbAnonPosts/p2': postDoc({ name: 'Sam', pinned: true }),
      'bbAnonPosts/p3': postDoc({ name: 'Sam' }),
      'bbAnonPosts/p1/comments/c1': commentDoc({ name: 'Troll' }),
      'bbAnonAnnSuggestions/s1': { name: 'Robin', text: 'x', status: 'pending', timestamp: TS.now() },
      'bbAnonAnnSuggestions/s2': { name: 'Robin', text: 'y', status: 'pending', timestamp: TS.now() },
    });
    await assertSucceeds(admin.post(db, { flavour, name: 'Admin' }));
    await assertSucceeds(admin.post(db, { flavour, name: 'Admin', tab: 'announcements' }));
    await assertSucceeds(board.comment(db, 'p3', { flavour, isAdmin: true, name: 'Admin' }));
    await assertSucceeds(admin.pin(db, 'p3', 'general'));
    await assertSucceeds(admin.unpin(db, 'p3'));
    await assertSucceeds(board.deleteComment(db, 'p1', 'c1'));
    await assertSucceeds(admin.deletePost(db, 'p1'));
    await assertSucceeds(admin.ban(db, 'Troll'));
    await assertSucceeds(admin.unban(db, 'Troll'));
    await assertSucceeds(board.listenSuggestions(db));
    await assertSucceeds(admin.approve(db, 's1', { flavour }));
    await assertSucceeds(admin.reject(db, 's2'));
  });
});

describe('Bipolar Bear app', () => {
  const uid = 'bb-2';
  const email = 'lee@example.com';

  it('settings, details, journal entries, feedback', async () => {
    const db = who.bb(uid, email);
    await assertSucceeds(bear.settings(db, uid));
    await assertSucceeds(bear.personalDetails(db, uid));
    await assertSucceeds(bear.entries(db, uid));
    await assertSucceeds(bear.feedback(db, uid));
  });

  it('counters: app costs, people helped, user count', async () => {
    const db = who.bb(uid, email);
    await seed(env, { 'counters/appCosts': { monthly: 12 } });
    await assertSucceeds(bear.appCosts(db));
    await assertSucceeds(bear.helped(db, 1));
    await assertSucceeds(bear.helped(who.anon('guest-anon'), -1));
    await assertSucceeds(board.countOnce(db, db.collection('userSettings').doc(uid), 'userCount', 'userCounted'));
    await assertSucceeds(board.uncount(db, 'userCount'));
  });

  it('home-screen board badges', async () => {
    await assertSucceeds(bear.boardBadges(who.bb(uid, email), 'Lee'));
  });

  it('account deletion clears the board profile and monika', async () => {
    await seed(env, {
      [`userSettings/${uid}`]: { x: 1 }, [`personalDetails/${uid}`]: { x: 1 },
      'bbAnonMonikas/lee': { monika: 'Lee' },
      [`anonProfiles/${emailHash(email)}`]: profileOf({ monika: 'Lee' }),
    });
    await assertSucceeds(bear.deleteAccount(who.bb(uid, email), uid, email, 'Lee'));
  });
});

// The admin address on the token is the admin, whatever the sign-in method.
it('admin constant matches the client', () => { assert.strictEqual(ADMIN_EMAIL, 'inbox@jamesmarkey.co.uk'); });
