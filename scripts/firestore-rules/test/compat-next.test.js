'use strict';
/**
 * Compatibility: the clients since the 2026-10-12 privacy round must work
 * against the committed rules AND against the strict rules
 * (legacyClients() == false), so the switch can be flipped without another
 * client release. Board documents carry owner stamps, profiles use the
 * server's profile id, personal details and sensitive settings are encrypted.
 */
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  makeEnvs, people, seed, seedVerified, seedAccountLink, emailHash, profileId, ownerStamp,
  postDoc, commentDoc, adminLabelPost, adminLabelComment, assertSucceeds, assertFails, TS, DAY, ADMIN_EMAIL,
} = require('./helpers');
const { board, admin, bear, profileOf } = require('./clients');

const flavour = 'next';
const owned = (uid, path, over = {}) => Object.assign({ owner: ownerStamp(uid, path) }, over);
let envs;
before(async () => { envs = await makeEnvs('next'); });
after(async () => { await envs.cleanup(); });

for (const mode of ['legacy', 'strict', 'adminStrict']) {
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
        await assertSucceeds(board.anonRestoreProfile(db, email, flavour));
        await assertSucceeds(board.reserveMonika(db, 'Robin', { flavour, uid }));
        await assertSucceeds(board.anonSaveProfile(db, email, undefined, flavour));
        await assertSucceeds(board.countOnce(db, board.profileRef(db, email, flavour), 'anonUserCount', 'counted'));
        const ref = await assertSucceeds(board.createPost(db, { flavour, uid }));
        await assertSucceeds(board.comment(db, ref.id, { flavour, uid, name: 'Robin' }));
      });

      it('returning member on a new device restores, and keeps saving later', async () => {
        await seed(env, { [`anonProfiles/${profileId(email)}`]: profileOf() });
        await seedVerified(env, { uid: 'anon-device-2', email });
        const db = who.anon('anon-device-2');
        const snap = await assertSucceeds(board.anonRestoreProfile(db, email, flavour));
        assert.strictEqual(snap.data().monika, 'Robin');
        await assertSucceeds(board.anonSaveProfile(db, email, undefined, flavour));
      });

      it('board reads, topics, likes, reports, comments, suggestions, push, presence', async () => {
        const db = who.anon(uid);
        await seed(env, {
          'bbAnonPosts/p1': postDoc(owned('sam', 'bbAnonPosts/p1', { name: 'Sam' })),
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
          await assertSucceeds(board.support(db, id, 1));
          await assertSucceeds(board.support(db, id, -1));
          await assertSucceeds(board.reportPost(db, id));
          const c = await assertSucceeds(board.comment(db, id, { flavour, uid }));
          await assertSucceeds(board.deleteComment(db, id, c.id));
        }
        await assertSucceeds(board.sos(db));
        await assertSucceeds(board.listenBanned(db));
        const s = await assertSucceeds(board.submitSuggestion(db));
        await assertSucceeds(board.watchOwnSuggestion(db, s.id));
        await seed(env, { [`bbAnonAnnSuggestions/${s.id}`]: { name: 'Robin', text: 'x', status: 'rejected', timestamp: TS.now() } });
        await assertSucceeds(board.dismissSuggestion(db, s.id));
        await assertSucceeds(board.pushRegister(db, 'tok-n', flavour));
        await assertSucceeds(board.pushUnregister(who.guest(), 'tok-n'));
        await assertSucceeds(board.presence(db, 'bbAnonPresence', 'sn'));
      });

      it('self-delete, rename and retention sweep', async () => {
        const db = who.anon(uid);
        const old = TS.fromMillis(Date.now() - 8 * DAY);
        await seed(env, {
          'bbAnonPosts/a': postDoc(owned(uid, 'bbAnonPosts/a')),
          'bbAnonPosts/b': postDoc(owned(uid, 'bbAnonPosts/b')),
          'bbAnonPosts/c': postDoc(owned('other-device', 'bbAnonPosts/c')),
          'bbAnonPosts/legacy': postDoc(),
          'bbAnonPosts/oldOther': postDoc(owned('sam', 'bbAnonPosts/oldOther', { name: 'Sam', timestamp: old })),
          'bbAnonPosts/oldLegacy': postDoc({ name: 'Sam', timestamp: old }),
          'bbAnonMonikas/robin': owned(uid, 'bbAnonMonikas/robin', { monika: 'Robin' }),
        });
        await assertSucceeds(board.selfDeletePost(db, 'a'));
        const moved = await assertSucceeds(board.rename(db, 'Robin', 'Robyn', { flavour, uid }));
        assert.ok(moved.length >= 1 && moved[0] === true);
        const n = await assertSucceeds(board.cleanOldPosts(db));
        assert.strictEqual(n, 2);
      });

      it('account deletion', async () => {
        await seed(env, {
          'bbAnonPosts/a': postDoc(owned(uid, 'bbAnonPosts/a')), 'bbAnonPosts/legacy': postDoc(),
          'bbAnonMonikas/robin': owned(uid, 'bbAnonMonikas/robin', { monika: 'Robin' }),
          [`anonProfiles/${profileId(email)}`]: profileOf({ counted: true }),
          'counters/anonUserCount': { count: 10 },
        });
        await seedVerified(env, { uid, email });
        await assertSucceeds(board.deleteAccount(who.anon(uid), { monika: 'Robin', email, flavour, uid }));
      });
    });

    describe('Bipolar Bear account on the board', () => {
      const uid = 'bb-1';
      const email = 'Kim@Example.com';

      it('verified account email: profile id from anonProfileId, restore, mirror, count, post', async () => {
        const db = who.bb(uid, email);
        await seedAccountLink(env, { uid, email });
        await seed(env, { [`anonProfiles/${profileId(email)}`]: profileOf({ monika: 'Kim' }) });
        await assertSucceeds(board.bbRestoreProfile(db, uid, email, flavour));
        await assertSucceeds(board.bbSaveProfile(db, uid, email, flavour));
        await assertSucceeds(board.countOnce(db, board.profileRef(db, email, flavour), 'anonUserCount', 'counted'));
        await assertSucceeds(board.createPost(db, { flavour, uid, name: 'Kim' }));
      });

      it('unverified account email, proved with the board email code', async () => {
        const db = who.bb(uid, email, false);
        await seedVerified(env, { uid, email });
        await assertSucceeds(board.bbRestoreProfile(db, uid, email, flavour));
        await assertSucceeds(board.bbSaveProfile(db, uid, email, flavour));
      });

      it('without the link, the verified account email alone opens no current profile', async () => {
        await seed(env, { [`anonProfiles/${profileId(email)}`]: profileOf({ monika: 'Kim' }) });
        await assertFails(board.anonRestoreProfile(who.bb(uid, email), email, flavour));
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
            'bbAnonPosts/p1': postDoc(owned('troll', 'bbAnonPosts/p1', { name: 'Troll' })),
            'bbAnonPosts/p2': postDoc({ name: 'Sam', pinned: true }),
            'bbAnonPosts/p3': postDoc(owned('sam', 'bbAnonPosts/p3', { name: 'Sam' })),
            'bbAnonPosts/p1/comments/c1': commentDoc(owned('troll', 'bbAnonPosts/p1/comments/c1', { name: 'Troll' })),
            'bbAnonPosts/p1/comments/c2': commentDoc({ name: 'Troll' }),
            'bbAnonAnnSuggestions/s1': { name: 'Robin', text: 'x', status: 'pending', timestamp: TS.now() },
            'bbAnonAnnSuggestions/s2': { name: 'Robin', text: 'y', status: 'pending', timestamp: TS.now() },
          });
          const db = ctx(who);
          // "Bipolar Bear Admin" posts and replies: the current client calls
          // adminAnonPost. Writing one from the device (as the v316/v317 web
          // and the 1.41 / 1.40 rebuilds do) works only while
          // legacyAdminClients() is on.
          const device = mode === 'legacy' ? assertSucceeds : assertFails;
          await device(admin.post(db, { flavour, uid: 'adm', name: 'Admin' }));
          await device(admin.post(db, { flavour, uid: 'adm', name: 'Admin', tab: 'announcements' }));
          await device(board.comment(db, 'p3', { flavour, uid: 'adm', isAdmin: true, name: 'Admin' }));
          await seed(env, {                                      // what adminAnonPost writes
            'bbAnonPosts/a1': adminLabelPost(),
            'bbAnonPosts/a2': adminLabelPost({ tab: 'announcements' }),
            'bbAnonPosts/p3/comments/ac1': adminLabelComment(),
          });
          await assertSucceeds(board.listenTab(db, 'announcements'));
          await assertSucceeds(admin.pin(db, 'a2', 'announcements'));
          await assertSucceeds(admin.deletePost(db, 'a2'));      // a pinned admin announcement
          await assertSucceeds(db.doc('bbAnonPosts/p3/comments/ac1').delete());
          await assertSucceeds(db.doc('bbAnonPosts/a1').delete());
          // "Post as a member": an ordinary owner-stamped post under the moniker.
          await assertSucceeds(board.createPost(db, { flavour, uid: 'adm', name: 'Robin' }));
          await assertSucceeds(board.comment(db, 'p3', { flavour, uid: 'adm', name: 'Robin' }));
          await assertSucceeds(admin.pin(db, 'p3', 'general'));
          await assertSucceeds(admin.unpin(db, 'p3'));
          await assertSucceeds(board.deleteComment(db, 'p1', 'c1'));
          await assertSucceeds(board.deleteComment(db, 'p1', 'c2'));
          await assertSucceeds(admin.deletePost(db, 'p1'));
          await assertSucceeds(admin.ban(db, 'Troll'));
          await assertSucceeds(admin.unban(db, 'Troll'));
          await assertSucceeds(board.listenSuggestions(db));
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
        await seedAccountLink(env, { uid, email });
        await seed(env, {
          'counters/appCosts': { monthly: 12 },
          'bbAnonMonikas/lee': owned(uid, 'bbAnonMonikas/lee', { monika: 'Lee' }),
          [`anonProfiles/${profileId(email)}`]: profileOf({ monika: 'Lee' }),
          [`userSettings/${uid}`]: { currentMedList: [{ name: 'Lithium' }], moodDefinitions: {}, copingStrategies: {} },
          [`personalDetails/${uid}`]: { personalName: 'Lee', personalMedicalNum: '943 476 5919' },
        });
        await assertSucceeds(bear.settings(db, uid, flavour));
        await assertSucceeds(bear.personalDetails(db, uid, flavour));
        await assertSucceeds(bear.entries(db, uid));
        await assertSucceeds(bear.feedback(db, uid));
        await assertSucceeds(bear.appCosts(db));
        await assertSucceeds(bear.helped(db, 1));
        await assertSucceeds(board.countOnce(db, db.collection('userSettings').doc(uid), 'userCount', 'userCounted'));
        await assertSucceeds(bear.boardBadges(db, 'Lee'));
        await assertSucceeds(bear.deleteAccount(db, uid, email, 'Lee', flavour));
      });
    });
  });
}
