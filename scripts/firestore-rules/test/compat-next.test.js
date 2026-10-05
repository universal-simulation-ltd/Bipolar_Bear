'use strict';
/**
 * Compatibility: the clients on this branch must work against the committed
 * rules AND against the strict rules (legacyClients() == false), so the switch
 * can be flipped without another client release.
 */
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  makeEnvs, people, seed, seedVerified, emailHash, postDoc, commentDoc,
  assertSucceeds, TS, DAY, ADMIN_EMAIL,
} = require('./helpers');
const { board, admin, bear, profileOf } = require('./clients');

const flavour = 'next';
let envs;
before(async () => { envs = await makeEnvs('next'); });
after(async () => { await envs.cleanup(); });

for (const mode of ['legacy', 'strict']) {
  describe(`[${mode}]`, () => {
    let env, who;
    before(() => { env = envs[mode]; who = people(env); });
    beforeEach(async () => { await env.clearFirestore(); });

    describe('standalone email-code path', () => {
      const uid = 'anon-n';
      const email = 'new.member@example.com';

      it('new member: session first, code, onboarding, first post', async () => {
        const db = who.anon(uid);
        await assertSucceeds(board.monikaInUse(db, 'Robin'));
        await seedVerified(env, { uid, email });                // verifyAnonCode with a session
        await assertSucceeds(board.anonRestoreProfile(db, email));
        await assertSucceeds(board.reserveMonika(db, 'Robin', { flavour, uid }));
        await assertSucceeds(board.anonSaveProfile(db, email));
        await assertSucceeds(board.countOnce(db, db.collection('anonProfiles').doc(emailHash(email)), 'anonUserCount', 'counted'));
        const ref = await assertSucceeds(board.createPost(db, { flavour, uid }));
        await assertSucceeds(board.comment(db, ref.id, { flavour, uid, name: 'Robin' }));
      });

      it('returning member on a new device restores, and keeps saving later', async () => {
        await seed(env, { [`anonProfiles/${emailHash(email)}`]: profileOf() });
        await seedVerified(env, { uid: 'anon-device-2', email, windowMs: -1000 }); // window long gone
        const db = who.anon('anon-device-2');
        const snap = await assertSucceeds(board.anonRestoreProfile(db, email));
        assert.strictEqual(snap.data().monika, 'Robin');
        await assertSucceeds(board.anonSaveProfile(db, email));
      });

      it('board reads, topics, likes, reports, comments, suggestions, push, presence', async () => {
        const db = who.anon(uid);
        await seed(env, {
          'bbAnonPosts/p1': postDoc({ name: 'Sam', uid: 'sam' }),
          'bbAnonPosts/legacy': postDoc({ name: 'Old' }),
          'bbAnonPosts/topic-2026-10-03': postDoc({ isTopic: true, dayStr: '2026-10-03', commentCount: 2 }),
          'bbAnonPosts/topic-2026-10-02': postDoc({ isTopic: true, dayStr: '2026-10-02' }),
        });
        await assertSucceeds(board.listenTab(db, 'general'));
        await assertSucceeds(board.fetchTopics(db));
        await assertSucceeds(board.postDailyTopic(db, '2026-10-05'));
        await assertSucceeds(board.retireTopic(db, 'topic-2026-10-03', true));
        await assertSucceeds(board.retireTopic(db, 'topic-2026-10-02', false));
        for (const id of ['p1', 'legacy']) {
          await assertSucceeds(board.like(db, id, 1));
          await assertSucceeds(board.like(db, id, -1));
          await assertSucceeds(board.reportPost(db, id));
          const c = await assertSucceeds(board.comment(db, id, { flavour, uid }));
          await assertSucceeds(board.deleteComment(db, id, c.id));
        }
        await assertSucceeds(board.sos(db));
        await assertSucceeds(board.listenBanned(db));
        const s = await assertSucceeds(board.submitSuggestion(db));
        await assertSucceeds(board.listenSuggestions(db));
        await seed(env, { [`bbAnonAnnSuggestions/${s.id}`]: { name: 'Robin', text: 'x', status: 'rejected', timestamp: TS.now() } });
        await assertSucceeds(board.dismissSuggestion(db, s.id));
        await assertSucceeds(board.pushRegister(db, 'tok-n'));
        await assertSucceeds(board.pushUnregister(who.guest(), 'tok-n'));
        await assertSucceeds(board.presence(db, 'bbAnonPresence', 'sn'));
      });

      it('self-delete, rename and retention sweep', async () => {
        const db = who.anon(uid);
        const old = TS.fromMillis(Date.now() - 8 * DAY);
        await seed(env, {
          'bbAnonPosts/a': postDoc({ uid }), 'bbAnonPosts/b': postDoc({ uid }),
          'bbAnonPosts/c': postDoc({ uid: 'other-device' }),
          'bbAnonPosts/legacy': postDoc(),
          'bbAnonPosts/oldOther': postDoc({ uid: 'sam', name: 'Sam', timestamp: old }),
          'bbAnonPosts/oldLegacy': postDoc({ name: 'Sam', timestamp: old }),
          'bbAnonMonikas/robin': { monika: 'Robin', uid },
        });
        await assertSucceeds(board.selfDeletePost(db, 'a'));
        const moved = await assertSucceeds(board.rename(db, 'Robin', 'Robyn', { flavour, uid }));
        assert.ok(moved.length >= 1 && moved[0] === true);
        const n = await assertSucceeds(board.cleanOldPosts(db));
        assert.strictEqual(n, 2);
      });

      it('account deletion', async () => {
        await seed(env, {
          'bbAnonPosts/a': postDoc({ uid }), 'bbAnonPosts/legacy': postDoc(),
          'bbAnonMonikas/robin': { monika: 'Robin', uid },
          [`anonProfiles/${emailHash(email)}`]: profileOf({ counted: true }),
          [`bbAnonLinks/${uid}`]: { emailHash: emailHash(email) },
          'counters/anonUserCount': { count: 10 },
        });
        await assertSucceeds(board.deleteAccount(who.anon(uid), { monika: 'Robin', email, flavour, uid }));
      });
    });

    describe('Bipolar Bear account on the board', () => {
      const uid = 'bb-1';
      const email = 'Kim@Example.com';

      it('verified account email: restore, mirror, count, post', async () => {
        const db = who.bb(uid, email);
        await seed(env, { [`anonProfiles/${emailHash(email)}`]: profileOf({ monika: 'Kim' }) });
        await assertSucceeds(board.bbRestoreProfile(db, uid, email));
        await assertSucceeds(board.bbSaveProfile(db, uid, email));
        await assertSucceeds(board.countOnce(db, db.collection('anonProfiles').doc(emailHash(email)), 'anonUserCount', 'counted'));
        await assertSucceeds(board.createPost(db, { flavour, uid, name: 'Kim' }));
      });

      it('unverified account email, proved with the board email code', async () => {
        const db = who.bb(uid, email, false);
        await seedVerified(env, { uid, email });
        await assertSucceeds(board.bbRestoreProfile(db, uid, email));
        await assertSucceeds(board.bbSaveProfile(db, uid, email));
      });
    });

    describe('board admin', () => {
      for (const [label, ctx] of [
        ['Bipolar Bear account', (w) => w.admin('adm')],
        ['email code on the Anonymous app', (w) => w.anon('adm')],
      ]) {
        it(`${label}: posts as admin, announces, pins, deletes, bans, reviews`, async () => {
          await seed(env, {
            'bbAnonLinks/adm': { emailHash: emailHash(ADMIN_EMAIL) },
            'bbAnonPosts/p1': postDoc({ name: 'Troll', uid: 'troll' }),
            'bbAnonPosts/p2': postDoc({ name: 'Sam', pinned: true }),
            'bbAnonPosts/p3': postDoc({ name: 'Sam', uid: 'sam' }),
            'bbAnonPosts/p1/comments/c1': commentDoc({ name: 'Troll', uid: 'troll' }),
            'bbAnonPosts/p1/comments/c2': commentDoc({ name: 'Troll' }),
            'bbAnonAnnSuggestions/s1': { name: 'Robin', text: 'x', status: 'pending', timestamp: TS.now() },
            'bbAnonAnnSuggestions/s2': { name: 'Robin', text: 'y', status: 'pending', timestamp: TS.now() },
          });
          const db = ctx(who);
          await assertSucceeds(admin.post(db, { flavour, uid: 'adm', name: 'Admin' }));
          await assertSucceeds(admin.post(db, { flavour, uid: 'adm', name: 'Admin', tab: 'announcements' }));
          await assertSucceeds(board.comment(db, 'p3', { flavour, uid: 'adm', isAdmin: true, name: 'Admin' }));
          await assertSucceeds(admin.pin(db, 'p3', 'general'));
          await assertSucceeds(admin.unpin(db, 'p3'));
          await assertSucceeds(board.deleteComment(db, 'p1', 'c1'));
          await assertSucceeds(board.deleteComment(db, 'p1', 'c2'));
          await assertSucceeds(admin.deletePost(db, 'p1'));
          await assertSucceeds(admin.ban(db, 'Troll'));
          await assertSucceeds(admin.unban(db, 'Troll'));
          await assertSucceeds(admin.approve(db, 's1', { flavour, uid: 'adm' }));
          await assertSucceeds(admin.reject(db, 's2'));
        });
      }
    });

    describe('Bipolar Bear app', () => {
      const uid = 'bb-2';
      const email = 'lee@example.com';
      it('settings, details, entries, feedback, counters, badges, account deletion', async () => {
        const db = who.bb(uid, email);
        await seed(env, {
          'counters/appCosts': { monthly: 12 },
          'bbAnonMonikas/lee': { monika: 'Lee', uid },
          [`anonProfiles/${emailHash(email)}`]: profileOf({ monika: 'Lee' }),
        });
        await assertSucceeds(bear.settings(db, uid));
        await assertSucceeds(bear.personalDetails(db, uid));
        await assertSucceeds(bear.entries(db, uid));
        await assertSucceeds(bear.feedback(db, uid));
        await assertSucceeds(bear.appCosts(db));
        await assertSucceeds(bear.helped(db, 1));
        await assertSucceeds(board.countOnce(db, db.collection('userSettings').doc(uid), 'userCount', 'userCounted'));
        await assertSucceeds(bear.boardBadges(db, 'Lee'));
        await assertSucceeds(bear.deleteAccount(db, uid, email, 'Lee'));
      });
    });
  });
}
