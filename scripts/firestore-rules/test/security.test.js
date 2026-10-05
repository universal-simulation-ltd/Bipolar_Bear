'use strict';
/**
 * Access rules, checked against both the committed rules ("legacy") and the
 * same rules with legacyClients() switched off ("strict"). Where a rule only
 * applies once older builds are retired, the test runs against strict only.
 */
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  makeEnvs, people, seed, seedVerified, emailHash, postDoc, commentDoc,
  assertSucceeds, assertFails, FV, TS, DAY, ADMIN_EMAIL,
} = require('./helpers');
const { board, admin, profileOf } = require('./clients');

let envs;
before(async () => { envs = await makeEnvs('security'); });
after(async () => { await envs.cleanup(); });

for (const mode of ['legacy', 'strict']) {
  describe(`[${mode}]`, () => {
    let env, who;
    const strictOnly = (name, fn) => it(name, { skip: mode !== 'strict' }, fn);
    before(() => { env = envs[mode]; who = people(env); });
    beforeEach(async () => { await env.clearFirestore(); });

    describe('anonProfiles', () => {
      const email = 'robin@example.com';
      const hash = emailHash(email);
      beforeEach(async () => { await seed(env, { [`anonProfiles/${hash}`]: profileOf() }); });

      it('is not readable without proving the email', async () => {
        await assertFails(who.guest().doc(`anonProfiles/${hash}`).get());
        await assertFails(who.anon('someone').doc(`anonProfiles/${hash}`).get());
        await assertFails(who.bb('other', 'other@example.com').doc(`anonProfiles/${hash}`).get());
      });

      it('cannot be listed', async () => {
        await assertFails(who.guest().collection('anonProfiles').get());
        await assertFails(who.anon('someone').collection('anonProfiles').limit(1).get());
        await assertFails(who.bb('u', email).collection('anonProfiles').get());
      });

      it('an unverified account email does not prove the address', async () => {
        await assertFails(who.bb('u', email, false).doc(`anonProfiles/${hash}`).get());
        await assertFails(who.bb('u', email, false).doc(`anonProfiles/${hash}`).set({ monika: 'X' }, { merge: true }));
      });

      it('is not writable without proving the email', async () => {
        await assertFails(who.guest().doc(`anonProfiles/${hash}`).set({ monika: 'X' }, { merge: true }));
        await assertFails(who.anon('someone').doc(`anonProfiles/${hash}`).set({ monika: 'X' }, { merge: true }));
        await assertFails(who.anon('someone').doc(`anonProfiles/${emailHash('fresh@example.com')}`).set({ monika: 'X' }));
      });

      it('the owner (verified account email or email code) has full access', async () => {
        await assertSucceeds(who.bb('u', email).doc(`anonProfiles/${hash}`).get());
        await seed(env, { 'bbAnonLinks/anon-1': { emailHash: hash } });
        const db = who.anon('anon-1');
        await assertSucceeds(db.doc(`anonProfiles/${hash}`).get());
        await assertSucceeds(board.anonSaveProfile(db, email));
        await assertSucceeds(db.doc(`anonProfiles/${hash}`).delete());
      });

      it('a code for one address gives no access to another', async () => {
        await seed(env, { 'bbAnonLinks/anon-1': { emailHash: emailHash('mine@example.com') } });
        await assertFails(who.anon('anon-1').doc(`anonProfiles/${hash}`).get());
      });

      it('the restore window closes', async () => {
        await seedVerified(env, { uid: null, email, windowMs: -1000 });
        await assertFails(who.guest().doc(`anonProfiles/${hash}`).get());
        await assertFails(board.anonSaveProfile(who.guest(), email));
      });

      it('clients cannot set or move the restore window', async () => {
        await seed(env, { 'bbAnonLinks/anon-1': { emailHash: hash } });
        await assertFails(who.anon('anon-1').doc(`anonProfiles/${hash}`)
          .set({ restoreUntil: TS.fromMillis(Date.now() + 365 * DAY) }, { merge: true }));
        await seedVerified(env, { uid: null, email });
        await assertFails(who.guest().doc(`anonProfiles/${hash}`)
          .set({ restoreUntil: TS.fromMillis(Date.now() + 365 * DAY) }, { merge: true }));
      });

      strictOnly('no restore window once legacy builds are retired', async () => {
        await seedVerified(env, { uid: null, email });
        await assertFails(who.guest().doc(`anonProfiles/${hash}`).get());
        await assertFails(who.guest().doc(`anonProfiles/${hash}`).delete());
      });

      it('email-code links are server-only', async () => {
        await seed(env, { 'bbAnonLinks/anon-1': { emailHash: hash } });
        await assertFails(who.anon('anon-1').doc('bbAnonLinks/anon-1').get());
        await assertFails(who.anon('anon-2').doc('bbAnonLinks/anon-2').set({ emailHash: hash }));
        await assertFails(who.bb('u', email).doc('bbAnonLinks/u').set({ emailHash: hash }));
      });
    });

    describe('admin identity', () => {
      it('only the admin can post or comment as admin', async () => {
        await seed(env, { 'bbAnonPosts/p1': postDoc() });
        await assertFails(board.createPost(who.anon('a1'), { isAdmin: true, flavour: 'next', uid: 'a1' }));
        await assertFails(board.createPost(who.guest(), { isAdmin: true }));
        await assertFails(board.createPost(who.bb('u', 'kim@example.com'), { isAdmin: true, flavour: 'next', uid: 'u' }));
        await assertFails(who.anon('a1').collection('bbAnonPosts/p1/comments')
          .add(Object.assign(commentDoc({ isAdmin: true, uid: 'a1' }), { timestamp: FV.serverTimestamp() })));
        await assertSucceeds(admin.post(who.admin('adm'), { flavour: 'next', uid: 'adm' }));
      });

      it('the admin flag cannot be added to an existing post', async () => {
        await seed(env, { 'bbAnonPosts/p1': postDoc({ uid: 'a1' }), 'bbAnonPosts/p2': postDoc() });
        await assertFails(who.anon('a1').doc('bbAnonPosts/p1').update({ isAdmin: true }));
        await assertFails(who.anon('a1').doc('bbAnonPosts/p2').update({ isAdmin: true }));
      });

      it('an email code for the admin address counts as the admin', async () => {
        await seed(env, { 'bbAnonLinks/adm-anon': { emailHash: emailHash(ADMIN_EMAIL) } });
        await assertSucceeds(admin.post(who.anon('adm-anon'), { flavour: 'next', uid: 'adm-anon' }));
        await assertSucceeds(admin.ban(who.anon('adm-anon'), 'Troll'));
      });

      it('only the admin can publish announcements', async () => {
        await assertFails(board.createPost(who.anon('a1'), { tab: 'announcements', flavour: 'next', uid: 'a1' }));
        await seed(env, { 'bbAnonPosts/p1': postDoc({ uid: 'a1' }) });
        await assertFails(who.anon('a1').doc('bbAnonPosts/p1').update({ tab: 'announcements' }));
      });
    });

    describe('bans', () => {
      it('members cannot ban or unban', async () => {
        await seed(env, { 'bbAnonBanned/troll': { monika: 'Troll' } });
        await assertFails(who.anon('a1').doc('bbAnonBanned/sam').set({ monika: 'Sam', bannedBy: 'x', timestamp: FV.serverTimestamp() }));
        await assertFails(who.anon('a1').doc('bbAnonBanned/troll').delete());
        await assertFails(who.guest().doc('bbAnonBanned/troll').delete());
        await assertFails(who.bb('u', 'kim@example.com').doc('bbAnonBanned/troll').delete());
        await assertSucceeds(admin.unban(who.admin(), 'Troll'));
      });
    });

    describe('posts', () => {
      beforeEach(async () => {
        await seed(env, {
          'bbAnonPosts/owned': postDoc({ uid: 'owner', name: 'Robin' }),
          'bbAnonPosts/legacy': postDoc({ name: 'Robin' }),
          'bbAnonPosts/topic-2026-10-04': postDoc({ isTopic: true, dayStr: '2026-10-04', commentCount: 3 }),
        });
      });

      it('nobody but the admin can change what a post says or where it sits', async () => {
        for (const id of ['owned', 'legacy']) {
          const db = who.anon('intruder');
          await assertFails(db.doc(`bbAnonPosts/${id}`).update({ text: 'changed' }));
          await assertFails(db.doc(`bbAnonPosts/${id}`).update({ pinned: true }));
          await assertFails(db.doc(`bbAnonPosts/${id}`).update({ deleted: true, deletedByAdmin: true }));
          await assertFails(db.doc(`bbAnonPosts/${id}`).update({ tab: 'announcements' }));
          await assertFails(db.doc(`bbAnonPosts/${id}`).update({ likes: 500 }));
          await assertFails(db.doc(`bbAnonPosts/${id}`).update({ uid: 'intruder' }));
          await assertFails(db.doc(`bbAnonPosts/${id}`).set(postDoc({ text: 'replaced' })));
          await assertFails(who.anon('owner').doc(`bbAnonPosts/${id}`).update({ text: 'edited' }));
        }
        await assertFails(who.guest().doc('bbAnonPosts/owned').update({ uid: FV.delete() }));
        await assertSucceeds(admin.deletePost(who.admin(), 'owned'));
      });

      it("a member's post can only be deleted or renamed by them", async () => {
        await assertFails(who.anon('intruder').doc('bbAnonPosts/owned').delete());
        await assertFails(who.guest().doc('bbAnonPosts/owned').delete());
        await assertFails(who.anon('intruder').doc('bbAnonPosts/owned').update({ name: 'Mallory' }));
        await assertSucceeds(who.anon('owner').doc('bbAnonPosts/owned').update({ name: 'Robyn', initials: 'RO' }));
        await assertSucceeds(who.anon('owner').doc('bbAnonPosts/owned').delete());
      });

      strictOnly('posts without an owner can only be removed by the admin or the sweep', async () => {
        await assertFails(who.anon('anyone').doc('bbAnonPosts/legacy').delete());
        await assertFails(who.anon('anyone').doc('bbAnonPosts/legacy').update({ name: 'Mallory' }));
        await assertSucceeds(who.admin().doc('bbAnonPosts/legacy').delete());
      });

      it('new posts start clean and carry the real time', async () => {
        const db = who.anon('a1');
        const base = { flavour: 'next', uid: 'a1' };
        const add = (over) => db.collection('bbAnonPosts').add(Object.assign(
          { name: 'Robin', text: 'x', tab: 'general', isAdmin: false, likes: 0, timestamp: FV.serverTimestamp(), uid: 'a1' }, over));
        await assertSucceeds(board.createPost(db, base));
        await assertFails(add({ likes: 99 }));
        await assertFails(add({ commentCount: 50 }));
        await assertFails(add({ pinned: true }));
        await assertFails(add({ deleted: true }));
        await assertFails(add({ reported: true }));
        await assertFails(add({ poll: { options: ['a', 'b'], votes: [100, 0] } }));
        await assertFails(add({ timestamp: TS.fromMillis(Date.now() + 30 * DAY) }));
        await assertFails(add({ timestamp: TS.fromMillis(Date.now() - 30 * DAY) }));
      });

      it("posts cannot be written under someone else's uid", async () => {
        await assertFails(board.createPost(who.anon('a1'), { flavour: 'next', uid: 'owner' }));
        await assertFails(board.createPost(who.guest(), { flavour: 'next', uid: 'owner' }));
      });

      strictOnly('new posts must carry the author uid', async () => {
        await assertFails(board.createPost(who.anon('a1'), { flavour: 'shipped' }));
        await assertFails(board.createPost(who.guest(), { flavour: 'shipped' }));
      });

      it('counters on a post move by one', async () => {
        const db = who.anon('a1');
        await assertFails(db.doc('bbAnonPosts/owned').update({ likes: FV.increment(5) }));
        await assertFails(db.doc('bbAnonPosts/owned').update({ commentCount: FV.increment(10) }));
        await assertFails(db.doc('bbAnonPosts/owned').update({ lastActivity: TS.fromMillis(Date.now() + 30 * DAY) }));
        await assertFails(db.doc('bbAnonPosts/owned').update({ reported: false }));
        await assertSucceeds(db.doc('bbAnonPosts/owned').update({ likes: FV.increment(1) }));
      });

      it('only week-old posts can be swept, and never pinned or reported ones', async () => {
        const old = TS.fromMillis(Date.now() - 8 * DAY);
        await seed(env, {
          'bbAnonPosts/recent': postDoc({ uid: 'owner', timestamp: TS.fromMillis(Date.now() - 2 * DAY) }),
          'bbAnonPosts/pinnedOld': postDoc({ uid: 'owner', timestamp: old, pinned: true }),
          'bbAnonPosts/reportedOld': postDoc({ uid: 'owner', timestamp: old, reported: true }),
          'bbAnonPosts/activeOld': postDoc({ uid: 'owner', timestamp: old, lastActivity: TS.now() }),
          'bbAnonPosts/old': postDoc({ uid: 'owner', timestamp: old }),
        });
        const db = who.anon('sweeper');
        for (const id of ['recent', 'pinnedOld', 'reportedOld', 'activeOld']) {
          await assertFails(db.doc(`bbAnonPosts/${id}`).delete());
        }
        await assertSucceeds(db.doc('bbAnonPosts/old').delete());
      });

      it('daily topics: right id, only empty ones deleted, only demoted in place', async () => {
        const db = who.anon('a1');
        await assertFails(db.doc('bbAnonPosts/topic-2026-10-04').delete());           // has replies
        await assertFails(db.doc('bbAnonPosts/topic-2026-10-04').update({ text: 'x' }));
        await assertFails(db.doc('bbAnonPosts/topic-2026-10-04').update({ isTopic: false, wasTopic: true, text: 'x' }));
        await assertFails(db.doc('bbAnonPosts/whatever').set({
          isTopic: true, dayStr: '2026-10-05', tab: 'general', text: 'x', isAdmin: false, likes: 0, timestamp: FV.serverTimestamp(),
        }));
        await assertFails(db.doc('bbAnonPosts/owned').delete());                       // not a topic
        await assertSucceeds(board.retireTopic(db, 'topic-2026-10-04', true));
      });
    });

    describe('comments', () => {
      beforeEach(async () => {
        await seed(env, {
          'bbAnonPosts/p1': postDoc({ uid: 'owner' }),
          'bbAnonPosts/p1/comments/mine': commentDoc({ uid: 'author' }),
          'bbAnonPosts/p1/comments/old': commentDoc(),
        });
      });

      it("a member's comment can only be removed by them or the admin", async () => {
        await assertFails(who.anon('intruder').doc('bbAnonPosts/p1/comments/mine').delete());
        await assertFails(who.guest().doc('bbAnonPosts/p1/comments/old').delete());
        await assertSucceeds(who.anon('author').doc('bbAnonPosts/p1/comments/mine').delete());
        await assertSucceeds(who.admin().doc('bbAnonPosts/p1/comments/old').delete());
      });

      it('comments are never edited by members', async () => {
        await assertFails(who.anon('author').doc('bbAnonPosts/p1/comments/mine').update({ text: 'x' }));
        await assertFails(who.anon('x').doc('bbAnonPosts/p1/comments/old').update({ text: 'x' }));
      });

      it('comments need a session, the real time, and your own uid', async () => {
        const c = (over) => Object.assign(commentDoc({ timestamp: FV.serverTimestamp() }), over);
        await assertFails(who.guest().collection('bbAnonPosts/p1/comments').add(c()));
        await assertFails(who.anon('a1').collection('bbAnonPosts/p1/comments').add(c({ uid: 'author' })));
        await assertFails(who.anon('a1').collection('bbAnonPosts/p1/comments').add(c({ uid: 'a1', timestamp: TS.fromMillis(Date.now() - 9 * DAY) })));
        await assertSucceeds(who.anon('a1').collection('bbAnonPosts/p1/comments').add(c({ uid: 'a1' })));
      });

      strictOnly('legacy comments are removed only by the admin; new ones need a uid', async () => {
        await assertFails(who.anon('anyone').doc('bbAnonPosts/p1/comments/old').delete());
        await assertFails(who.anon('a1').collection('bbAnonPosts/p1/comments')
          .add(Object.assign(commentDoc(), { timestamp: FV.serverTimestamp() })));
      });
    });

    describe('monikas', () => {
      beforeEach(async () => {
        await seed(env, { 'bbAnonMonikas/robin': { monika: 'Robin', uid: 'owner' }, 'bbAnonMonikas/sam': { monika: 'Sam' } });
      });

      it('a taken name cannot be overwritten, and names match their id', async () => {
        await assertFails(who.anon('x').doc('bbAnonMonikas/robin').set({ monika: 'Robin', uid: 'x' }));
        await assertFails(who.guest().doc('bbAnonMonikas/sam').set({ monika: 'Sam' }));
        await assertFails(who.anon('x').doc('bbAnonMonikas/kim').set({ monika: 'Someone', uid: 'x' }));
        await assertFails(who.anon('x').doc('bbAnonMonikas/kim').set({ monika: 'Kim', uid: 'owner' }));
        await assertFails(who.anon('x').doc('bbAnonMonikas/kim').set({ monika: 'Kim', uid: 'x', extra: 1 }));
      });

      it("a member's name can only be released by them", async () => {
        await assertFails(who.anon('x').doc('bbAnonMonikas/robin').delete());
        await assertSucceeds(who.anon('owner').doc('bbAnonMonikas/robin').delete());
      });

      it('the name list cannot be dumped', async () => {
        await assertFails(who.anon('x').collection('bbAnonMonikas').get());
        await assertSucceeds(board.monikaInUse(who.guest(), 'Robin'));
      });

      strictOnly('legacy names are released only by the admin; new names need a uid', async () => {
        await assertFails(who.anon('x').doc('bbAnonMonikas/sam').delete());
        await assertFails(board.reserveMonika(who.anon('x'), 'Kim', { flavour: 'shipped' }));
        await assertSucceeds(who.admin().doc('bbAnonMonikas/sam').delete());
      });
    });

    describe('everything else', () => {
      it('counters move by one at a time', async () => {
        await seed(env, { 'counters/anonUserCount': { count: 40 }, 'counters/appCosts': { monthly: 12 } });
        const db = who.anon('a1');
        await assertFails(db.doc('counters/anonUserCount').set({ count: 0 }));
        await assertFails(db.doc('counters/anonUserCount').set({ count: FV.increment(100) }, { merge: true }));
        await assertFails(db.doc('counters/appCosts').set({ monthly: 0 }, { merge: true }));
        await assertFails(db.doc('counters/new').set({ count: 5000 }));
        await assertFails(db.doc('counters/anonUserCount').delete());
        await assertFails(who.guest().doc('counters/anonUserCount').set({ count: FV.increment(1) }, { merge: true }));
      });

      it('suggestions are reviewed only by the admin, and pending ones stay', async () => {
        await seed(env, { 'bbAnonAnnSuggestions/s1': { name: 'Robin', text: 'x', status: 'pending', timestamp: TS.now() } });
        await assertFails(who.anon('a1').doc('bbAnonAnnSuggestions/s1').update({ status: 'approved' }));
        await assertFails(who.anon('a1').doc('bbAnonAnnSuggestions/s1').delete());
        await assertFails(who.anon('a1').collection('bbAnonAnnSuggestions').add({ name: 'x', text: 'y', status: 'approved' }));
      });

      it('reports and feedback are write-only drop boxes', async () => {
        await seed(env, { 'bbAnonReports/r1': { type: 'report' }, 'feedback/f1': { message: 'x' } });
        await assertFails(who.anon('a1').doc('bbAnonReports/r1').get());
        await assertFails(who.anon('a1').doc('bbAnonReports/r1').delete());
        await assertFails(who.anon('a1').doc('bbAnonReports/r1').set({ type: 'x' }));
        await assertFails(who.anon('a1').doc('feedback/f1').get());
        await assertFails(who.anon('a1').doc('feedback/f1').delete());
      });

      it('private data stays private', async () => {
        await seed(env, {
          'userSettings/u1': { anonProfile: profileOf() }, 'personalDetails/u1': { name: 'x' },
          'entries/e1': { userId: 'u1', timestamp: 1 },
          'bbAnonPush/tok': { token: 'tok' },
        });
        const db = who.anon('u2');
        await assertFails(db.doc('userSettings/u1').get());
        await assertFails(db.doc('personalDetails/u1').get());
        await assertFails(db.doc('entries/e1').get());
        await assertFails(db.collection('entries').where('userId', '==', 'u1').get());
        await assertFails(db.doc('bbAnonPush/tok').get());
        await assertFails(db.doc('anonVerify/x').get());
      });
    });
  });
}

it('suite covers both rule sets', () => { assert.ok(envs.legacy && envs.strict); });
