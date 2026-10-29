'use strict';
/**
 * Access rules, checked against both the committed rules ("legacy") and the
 * same rules with legacyClients() switched off ("strict"). Where a rule only
 * applies once older builds are retired, the test runs against strict only.
 */
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  makeEnvs, people, seed, seedVerified, seedAccountLink, emailHash, profileId, ownerStamp,
  postDoc, commentDoc, adminLabelPost, adminLabelComment, assertSucceeds, assertFails, FV, TS, DAY, ADMIN_EMAIL,
} = require('./helpers');
const { board, admin, profileOf } = require('./clients');

let envs;
before(async () => { envs = await makeEnvs('security'); });
after(async () => { await envs.cleanup(); });

for (const mode of ['legacy', 'strict', 'adminStrict']) {
  describe(`[${mode}]`, () => {
    let env, who;
    const strictOnly = (name, fn) => it(name, { skip: mode !== 'strict' }, fn);
    const legacyOnly = (name, fn) => it(name, { skip: mode !== 'legacy' }, fn);
    // Device-written admin-label posts: allowed only while legacyAdminClients() is on.
    const adminDevice = (p) => (mode === 'legacy' ? assertSucceeds(p) : assertFails(p));
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

      it('there is no restore window: a fresh code without a session opens nothing', async () => {
        await seedVerified(env, { uid: null, email });
        await seed(env, { [`anonProfiles/${hash}`]: profileOf({ restoreUntil: TS.fromMillis(Date.now() + 600000) }) });
        await assertFails(who.guest().doc(`anonProfiles/${hash}`).get());
        await assertFails(who.anon('someone').doc(`anonProfiles/${hash}`).get());
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

      it('nobody else can delete a profile (the old open delete is gone)', async () => {
        await assertFails(who.guest().doc(`anonProfiles/${hash}`).delete());
        await assertFails(who.anon('someone').doc(`anonProfiles/${hash}`).delete());
        await assertFails(who.anon('someone').doc(`anonProfiles/${profileId(email)}`).set({ monika: 'X' }));
        // Deleting a profile that isn't there (older builds' account deletion) is harmless.
        await assertSucceeds(who.anon('someone').doc(`anonProfiles/${emailHash('gone@example.com')}`).delete());
      });

      describe('current profile ids (server secret)', () => {
        const pid = profileId(email);
        beforeEach(async () => { await seed(env, { [`anonProfiles/${pid}`]: profileOf() }); });

        it('open only to a session bbAnonLinks lists for it', async () => {
          await seedVerified(env, { uid: 'anon-1', email });
          const db = who.anon('anon-1');
          await assertSucceeds(db.doc(`anonProfiles/${pid}`).get());
          await assertSucceeds(db.doc(`anonProfiles/${pid}`).set({ monika: 'Robyn' }, { merge: true }));
          await assertSucceeds(db.doc(`anonProfiles/${pid}`).delete());
        });

        it('knowing the email (or its sha256) gives nothing', async () => {
          await assertFails(who.guest().doc(`anonProfiles/${pid}`).get());
          await assertFails(who.bb('u', email).doc(`anonProfiles/${pid}`).get());          // token email alone
          await seed(env, { 'bbAnonLinks/anon-1': { emailHash: hash } });                 // pre-2026-10-12 link
          await assertFails(who.anon('anon-1').doc(`anonProfiles/${pid}`).get());
          await assertFails(who.anon('anon-1').doc(`anonProfiles/${pid}`).delete());
        });

        it("a link for one address doesn't open another's", async () => {
          await seedAccountLink(env, { uid: 'u', email: 'other@example.com' });
          await assertFails(who.bb('u', 'other@example.com').doc(`anonProfiles/${pid}`).get());
        });

        it('the server-only compatibility fields are not the client\'s to set', async () => {
          await seedVerified(env, { uid: 'anon-1', email });
          await assertFails(who.anon('anon-1').doc(`anonProfiles/${pid}`)
            .set({ compatUntil: TS.fromMillis(Date.now() + 365 * DAY) }, { merge: true }));
        });
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
        await adminDevice(admin.post(who.admin('adm'), { flavour: 'next', uid: 'adm' }));
      });

      it('admin-label posts and replies come from adminAnonPost, not the device', async () => {
        await seed(env, { 'bbAnonPosts/p1': postDoc() });
        const db = who.admin('adm');
        // Every shape a device has written them in: owner stamp (v316+), uid
        // (1.41 / 1.40 as first built), nothing (older builds).
        for (const flavour of ['next', 'store141', 'shipped']) {
          await adminDevice(admin.post(db, { flavour, uid: 'adm' }));
          await adminDevice(admin.post(db, { flavour, uid: 'adm', tab: 'announcements' }));
          await adminDevice(board.comment(db, 'p1', { flavour, uid: 'adm', isAdmin: true }));
        }
        // With no owner of any kind it is still refused once the switch is off.
        await adminDevice(db.collection('bbAnonPosts').add(Object.assign(adminLabelPost(), { timestamp: FV.serverTimestamp() })));
        await adminDevice(db.collection('bbAnonPosts/p1/comments')
          .add(Object.assign(adminLabelComment(), { timestamp: FV.serverTimestamp() })));
        // The admin still publishes a member's suggestion and posts as a member.
        await seed(env, { 'bbAnonAnnSuggestions/s1': { name: 'Robin', text: 'x', status: 'pending', timestamp: TS.now() } });
        await assertSucceeds(admin.approve(db, 's1', { flavour: 'next', uid: 'adm' }));
        await assertSucceeds(board.createPost(db, { flavour: 'next', uid: 'adm', name: 'Robin' }));
      });

      it('admin-label posts written by the function are the admin\'s to moderate', async () => {
        await seed(env, {
          'bbAnonPosts/a1': adminLabelPost(),
          'bbAnonPosts/a1/comments/c1': adminLabelComment(),
        });
        // Nobody else can delete or rename them; they carry no owner to match.
        await assertFails(who.anon('a1').doc('bbAnonPosts/a1').delete());
        await assertFails(who.anon('a1').doc('bbAnonPosts/a1').update({ name: 'Robin', initials: 'RO', grad1: '#fff', grad2: '#000' }));
        await assertFails(who.anon('a1').doc('bbAnonPosts/a1/comments/c1').delete());
        // Members still like and reply.
        await assertSucceeds(board.like(who.anon('a1'), 'a1', 1));
        await assertSucceeds(board.comment(who.anon('a1'), 'a1', { flavour: 'next', uid: 'a1' }));
        // The admin deletes them with admin rights (any of the admin's sessions).
        await assertSucceeds(who.admin('adm-2').doc('bbAnonPosts/a1/comments/c1').delete());
        await assertSucceeds(who.admin('adm-2').doc('bbAnonPosts/a1').delete());
      });

      it('who wrote an admin-label post is server-only', async () => {
        await seed(env, {
          'bbAnonAdminAuthored/bbAnonPosts__a1': { path: 'bbAnonPosts/a1', postId: 'a1', uid: 'adm', createdAt: TS.now() },
        });
        for (const db of [who.guest(), who.anon('adm'), who.admin('adm')]) {
          await assertFails(db.doc('bbAnonAdminAuthored/bbAnonPosts__a1').get());
          await assertFails(db.collection('bbAnonAdminAuthored').get());
          await assertFails(db.doc('bbAnonAdminAuthored/bbAnonPosts__a2').set({ path: 'bbAnonPosts/a2', uid: 'adm' }));
          await assertFails(db.doc('bbAnonAdminAuthored/bbAnonPosts__a1').delete());
        }
      });

      it('the admin flag cannot be added to an existing post', async () => {
        await seed(env, { 'bbAnonPosts/p1': postDoc({ uid: 'a1' }), 'bbAnonPosts/p2': postDoc() });
        await assertFails(who.anon('a1').doc('bbAnonPosts/p1').update({ isAdmin: true }));
        await assertFails(who.anon('a1').doc('bbAnonPosts/p2').update({ isAdmin: true }));
      });

      it('an email code for the admin address counts as the admin', async () => {
        await seed(env, { 'bbAnonLinks/adm-anon': { emailHash: emailHash(ADMIN_EMAIL) } });
        await adminDevice(admin.post(who.anon('adm-anon'), { flavour: 'next', uid: 'adm-anon' }));
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

      // 2026-10-16: bans are enforced by the rules, keyed on the moniker and
      // (copied by the member's own app) on the board profile id, so a new
      // moniker doesn't escape them. A ban with `until` is temporary.
      const email = 'troll@example.com';
      const pid = profileId(email);

      it('a banned moniker cannot post or comment', async () => {
        await seedVerified(env, { uid: 't1', email });
        await assertSucceeds(admin.ban(who.admin(), 'Troll'));
        await seed(env, { 'bbAnonPosts/p1': postDoc({ name: 'Sam' }) });
        await assertFails(board.createPost(who.anon('t1'), { flavour: 'next', uid: 't1', name: 'Troll' }));
        await assertFails(board.comment(who.anon('t1'), 'p1', { flavour: 'next', uid: 't1', name: 'Troll' }));
        // Someone else is unaffected.
        await assertSucceeds(board.createPost(who.anon('s1'), { flavour: 'next', uid: 's1', name: 'Sam' }));
      });

      it('a member can copy their own moniker ban onto their own profile only', async () => {
        await seedVerified(env, { uid: 't1', email });
        await seedVerified(env, { uid: 's1', email: 'sam@example.com' });
        // Not while the moniker isn't banned.
        await assertFails(board.copyBanToProfile(who.anon('t1'), pid, 'Troll'));
        await assertSucceeds(admin.ban(who.admin(), 'Troll'));
        // Not onto somebody else's profile.
        await assertFails(board.copyBanToProfile(who.anon('s1'), pid, 'Troll'));
        await assertFails(board.copyBanToProfile(who.anon('t1'), profileId('sam@example.com'), 'Troll'));
        await assertSucceeds(board.copyBanToProfile(who.anon('t1'), pid, 'Troll'));
        // And they can't take it down again.
        await assertFails(who.anon('t1').doc(`bbAnonBanned/${pid}`).delete());
      });

      it('a profile ban survives a new moniker: no posts, replies, renames or new names', async () => {
        await seedVerified(env, { uid: 't1', email });
        await seed(env, {
          [`bbAnonBanned/${pid}`]: { monika: 'Troll' },
          'bbAnonPosts/p1': postDoc({ name: 'Sam' }),
          'bbAnonPosts/mine': postDoc({ name: 'Troll', owner: ownerStamp('t1', 'bbAnonPosts/mine') }),
        });
        await assertFails(board.reserveMonika(who.anon('t1'), 'Fresh', { flavour: 'next', uid: 't1' }));
        await assertFails(board.createPost(who.anon('t1'), { flavour: 'next', uid: 't1', name: 'Fresh' }));
        await assertFails(board.comment(who.anon('t1'), 'p1', { flavour: 'next', uid: 't1', name: 'Fresh' }));
        await assertFails(who.anon('t1').doc('bbAnonPosts/mine').update({ name: 'Fresh', initials: 'FR', grad1: '#64b5f6', grad2: '#1565c0' }));
        // Another session with no link to that profile is unaffected.
        await assertSucceeds(board.reserveMonika(who.anon('s1'), 'Other', { flavour: 'next', uid: 's1' }));
      });

      it('a temporary ban blocks until it ends, then anyone may take it down', async () => {
        await seedVerified(env, { uid: 't1', email });
        await assertSucceeds(admin.banFor(who.admin(), 'Troll', 7));
        await assertFails(board.createPost(who.anon('t1'), { flavour: 'next', uid: 't1', name: 'Troll' }));
        await assertFails(board.dropExpiredBan(who.anon('s1'), 'troll'));
        // The copy may not be shorter than the profile ban already there.
        await seed(env, { [`bbAnonBanned/${pid}`]: { monika: 'Troll', until: TS.fromMillis(Date.now() + 9 * DAY) } });
        await assertFails(board.copyBanToProfile(who.anon('t1'), pid, 'Troll', TS.fromMillis(Date.now() + 2 * DAY)));
        await assertSucceeds(board.copyBanToProfile(who.anon('t1'), pid, 'Troll'));
        // Run out: posting works again and the documents can be cleared.
        await seed(env, {
          'bbAnonBanned/troll': { monika: 'Troll', until: TS.fromMillis(Date.now() - DAY) },
          [`bbAnonBanned/${pid}`]: { monika: 'Troll', until: TS.fromMillis(Date.now() - DAY) },
        });
        await assertSucceeds(board.createPost(who.anon('t1'), { flavour: 'next', uid: 't1', name: 'Troll' }));
        await assertSucceeds(board.dropExpiredBan(who.anon('s1'), 'troll'));
        await assertSucceeds(board.dropExpiredBan(who.guest(), pid));
      });
    });

    describe('posts', () => {
      beforeEach(async () => {
        await seed(env, {
          'bbAnonPosts/owned': postDoc({ uid: 'owner', name: 'Robin' }),
          'bbAnonPosts/stamped': postDoc({ owner: ownerStamp('owner', 'bbAnonPosts/stamped'), name: 'Robin' }),
          'bbAnonPosts/legacy': postDoc({ name: 'Robin' }),
          'bbAnonPosts/topic-2026-10-04': postDoc({ isTopic: true, dayStr: '2026-10-04', commentCount: 3 }),
        });
      });

      it('nobody but the admin can change what a post says or where it sits', async () => {
        for (const id of ['owned', 'stamped', 'legacy']) {
          const db = who.anon('intruder');
          await assertFails(db.doc(`bbAnonPosts/${id}`).update({ text: 'changed' }));
          await assertFails(db.doc(`bbAnonPosts/${id}`).update({ pinned: true }));
          await assertFails(db.doc(`bbAnonPosts/${id}`).update({ deleted: true, deletedByAdmin: true }));
          await assertFails(db.doc(`bbAnonPosts/${id}`).update({ tab: 'announcements' }));
          await assertFails(db.doc(`bbAnonPosts/${id}`).update({ likes: 500 }));
          await assertFails(db.doc(`bbAnonPosts/${id}`).update({ uid: 'intruder' }));
          await assertFails(db.doc(`bbAnonPosts/${id}`).update({ owner: ownerStamp('intruder', `bbAnonPosts/${id}`) }));
          await assertFails(db.doc(`bbAnonPosts/${id}`).set(postDoc({ text: 'replaced' })));
          await assertFails(who.anon('owner').doc(`bbAnonPosts/${id}`).update({ text: 'edited' }));
        }
        await assertFails(who.guest().doc('bbAnonPosts/owned').update({ uid: FV.delete() }));
        await assertSucceeds(admin.deletePost(who.admin(), 'owned'));
      });

      it("a member's post can only be deleted or renamed by them", async () => {
        for (const id of ['owned', 'stamped']) {
          await assertFails(who.anon('intruder').doc(`bbAnonPosts/${id}`).delete());
          await assertFails(who.guest().doc(`bbAnonPosts/${id}`).delete());
          await assertFails(who.anon('intruder').doc(`bbAnonPosts/${id}`).update({ name: 'Mallory' }));
          await assertSucceeds(who.anon('owner').doc(`bbAnonPosts/${id}`).update({ name: 'Robyn', initials: 'RO' }));
          await assertSucceeds(who.anon('owner').doc(`bbAnonPosts/${id}`).delete());
        }
      });

      it("an owner stamp is the author's, for that post only", async () => {
        const db = who.anon('a1');
        const ref = db.collection('bbAnonPosts').doc();
        const base = { name: 'Robin', text: 'x', tab: 'general', isAdmin: false, likes: 0, timestamp: FV.serverTimestamp() };
        await assertFails(ref.set({ ...base, owner: ownerStamp('owner', ref.path) }));          // someone else's
        await assertFails(ref.set({ ...base, owner: ownerStamp('a1', 'bbAnonPosts/other') }));  // another post's
        await assertFails(ref.set({ ...base, owner: ownerStamp('a1', ref.path), uid: 'a1' }));  // stamp AND uid
        await assertSucceeds(ref.set({ ...base, owner: ownerStamp('a1', ref.path) }));
        // A stamped post never reveals the uid.
        const snap = await who.guest().doc(ref.path).get();
        assert.ok(!('uid' in snap.data()));
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
        await assertFails(add({ image: { w: 10, h: 10 } }));   // pictures: adminAnonPost only
        await assertFails(add({ timestamp: TS.fromMillis(Date.now() + 30 * DAY) }));
        await assertFails(add({ timestamp: TS.fromMillis(Date.now() - 30 * DAY) }));
      });

      it("an announcement's picture is read by its id, never listed or written by a device", async () => {
        await seed(env, { 'bbAnonPostImages/p1': { data: 'x', createdAt: TS.now() } });
        await assertSucceeds(who.guest().doc('bbAnonPostImages/p1').get());
        await assertFails(who.guest().collection('bbAnonPostImages').get());
        await assertFails(who.admin().collection('bbAnonPostImages').get());
        await assertFails(who.anon('a1').doc('bbAnonPostImages/p2').set({ data: 'x' }));
        await assertFails(who.admin().doc('bbAnonPostImages/p2').set({ data: 'x' }));
        await assertFails(who.admin().doc('bbAnonPostImages/p1').delete());
      });

      it("posts cannot be written under someone else's uid or stamp", async () => {
        await assertFails(board.createPost(who.anon('a1'), { flavour: 'next', uid: 'owner' }));
        await assertFails(board.createPost(who.guest(), { flavour: 'next', uid: 'owner' }));
        await assertFails(board.createPost(who.anon('a1'), { flavour: 'store141', uid: 'owner' }));
      });

      legacyOnly('1.41-era builds may still write their uid (swapped server-side)', async () => {
        await assertSucceeds(board.createPost(who.anon('a1'), { flavour: 'store141', uid: 'a1' }));
      });

      strictOnly('new posts must carry an owner stamp, never a uid', async () => {
        await assertFails(board.createPost(who.anon('a1'), { flavour: 'shipped' }));
        await assertFails(board.createPost(who.guest(), { flavour: 'shipped' }));
        await assertFails(board.createPost(who.anon('a1'), { flavour: 'store141', uid: 'a1' }));
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
          'bbAnonPosts/p1/comments/stamped': commentDoc({ owner: ownerStamp('author', 'bbAnonPosts/p1/comments/stamped') }),
          'bbAnonPosts/p1/comments/old': commentDoc(),
        });
      });

      it("a member's comment can only be removed by them or the admin", async () => {
        await assertFails(who.anon('intruder').doc('bbAnonPosts/p1/comments/mine').delete());
        await assertFails(who.anon('intruder').doc('bbAnonPosts/p1/comments/stamped').delete());
        await assertFails(who.guest().doc('bbAnonPosts/p1/comments/old').delete());
        await assertSucceeds(who.anon('author').doc('bbAnonPosts/p1/comments/mine').delete());
        await assertSucceeds(who.anon('author').doc('bbAnonPosts/p1/comments/stamped').delete());
        await assertSucceeds(who.admin().doc('bbAnonPosts/p1/comments/old').delete());
      });

      it("a member's replies can be counted across every thread (💬 post count)", async () => {
        await assertSucceeds(who.guest().collectionGroup('comments').where('name', '==', 'Bear').get());
      });

      it('comments are never edited by members', async () => {
        await assertFails(who.anon('author').doc('bbAnonPosts/p1/comments/mine').update({ text: 'x' }));
        await assertFails(who.anon('x').doc('bbAnonPosts/p1/comments/old').update({ text: 'x' }));
      });

      it('comments need a session, the real time, and your own owner stamp', async () => {
        const c = (over) => Object.assign(commentDoc({ timestamp: FV.serverTimestamp() }), over);
        const col = who.anon('a1').collection('bbAnonPosts/p1/comments');
        const ref = col.doc();
        await assertFails(who.guest().collection('bbAnonPosts/p1/comments').add(c()));
        await assertFails(col.add(c({ uid: 'author' })));
        await assertFails(ref.set(c({ owner: ownerStamp('author', ref.path) })));
        await assertFails(ref.set(c({ owner: ownerStamp('a1', ref.path), timestamp: TS.fromMillis(Date.now() - 9 * DAY) })));
        await assertSucceeds(ref.set(c({ owner: ownerStamp('a1', ref.path) })));
      });

      legacyOnly("1.41-era builds' comments may carry their own uid", async () => {
        await assertSucceeds(who.anon('a1').collection('bbAnonPosts/p1/comments')
          .add(Object.assign(commentDoc({ timestamp: FV.serverTimestamp() }), { uid: 'a1' })));
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
        await seed(env, { 'bbAnonMonikas/kim': { monika: 'Kim', owner: ownerStamp('owner', 'bbAnonMonikas/kim') } });
        await assertFails(who.anon('x').doc('bbAnonMonikas/kim').delete());
        await assertSucceeds(who.anon('owner').doc('bbAnonMonikas/kim').delete());
      });

      it('a name is reserved with an owner stamp, not a uid', async () => {
        await assertSucceeds(board.reserveMonika(who.anon('x'), 'Kim', { flavour: 'next', uid: 'x' }));
        const snap = await who.guest().doc('bbAnonMonikas/kim').get();
        assert.ok(!('uid' in snap.data()) && snap.data().owner === ownerStamp('x', 'bbAnonMonikas/kim'));
        await assertFails(board.reserveMonika(who.anon('x'), 'Lee', { flavour: 'next', uid: 'someone-else' }));
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

      it("the suggestions queue is the admin's to list", async () => {
        await seed(env, { 'bbAnonAnnSuggestions/s1': { name: 'Robin', text: 'x', status: 'pending', timestamp: TS.now() } });
        await assertFails(who.anon('a1').collection('bbAnonAnnSuggestions').get());
        await assertFails(who.anon('a1').collection('bbAnonAnnSuggestions').where('status', '==', 'pending').get());
        await assertFails(who.guest().doc('bbAnonAnnSuggestions/s1').get());
        await assertSucceeds(who.admin().collection('bbAnonAnnSuggestions').get());
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

      strictOnly('push registrations carry no email hash', async () => {
        await assertFails(board.pushRegister(who.anon('a1'), 'tok-s'));
        await assertSucceeds(board.pushRegister(who.anon('a1'), 'tok-s', 'next'));
      });

      strictOnly('personal details and sensitive settings are stored only encrypted', async () => {
        const db = who.bb('u1', 'u1@example.com');
        await assertFails(db.doc('personalDetails/u1').set({ personalName: 'Kim', personalMedicalNum: '943 476 5919' }));
        await assertSucceeds(db.doc('personalDetails/u1').set({ secureEnc: { _enc: 'eA==', _iv: 'eA==' }, updatedAt: 1 }));
        await assertFails(db.doc('userSettings/u1').set({ currentMedList: [{ name: 'Lithium' }] }, { merge: true }));
        await assertFails(db.doc('userSettings/u1').set({ moodMemories: ['x'] }, { merge: true }));
        await assertSucceeds(db.doc('userSettings/u1').set({ secureEnc: { _enc: 'eA==', _iv: 'eA==' }, reminderEnabled: true }, { merge: true }));
        // An account not migrated yet can still save other settings, and fold its plaintext away.
        await seed(env, { 'userSettings/u1': { currentMedList: [{ name: 'Lithium' }] } });
        await assertSucceeds(db.doc('userSettings/u1').set({ reminderEnabled: false }, { merge: true }));
        await assertSucceeds(db.doc('userSettings/u1').set({ secureEnc: { _enc: 'eA==', _iv: 'eA==' }, currentMedList: FV.delete() }, { merge: true }));
      });

      legacyOnly('older builds may still write plaintext details and settings', async () => {
        const db = who.bb('u1', 'u1@example.com');
        await assertSucceeds(db.doc('personalDetails/u1').set({ personalName: 'Kim' }, { merge: true }));
        await assertSucceeds(db.doc('userSettings/u1').set({ currentMedList: [{ name: 'Lithium' }] }, { merge: true }));
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
