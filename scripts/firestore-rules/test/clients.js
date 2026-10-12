'use strict';
/**
 * The Firestore calls the apps make, transcribed from the client code so the
 * rules can be checked against them. Three flavours:
 *
 *   shipped  — store builds Bipolar Bear <= 1.40 / Bipolar Anonymous <= 1.39
 *              (js/anonymous.js 5b64da2 and 0ef0d18): no owner on board
 *              writes, monika reserved and the cross-device profile read
 *              before any Firebase session; plaintext personal details.
 *   store141 — Bipolar Bear 1.41 / Bipolar Anonymous 1.40 as built on
 *              2026-10-12 (web v315): board writes carry `uid`, the session
 *              exists before the email code, profiles keyed sha256(email).
 *   next     — the clients since the 2026-10-12 privacy round: board writes
 *              carry an owner stamp, profiles keyed by the server's profile
 *              id, personal details and sensitive settings encrypted.
 *
 * Source references are to js/anonymous.js unless noted.
 */
const { FV, TS, DAY, emailHash, profileId, ownerStamp } = require('./helpers');

const POSTS = 'bbAnonPosts';
const MONIKAS = 'bbAnonMonikas';
const RETENTION_DAYS = 7;

/** Owner field for `flavour` on the document at `path`. */
function stamp(flavour, uid, path, obj) {
  if (!uid) return obj;
  if (flavour === 'next') return Object.assign({ owner: ownerStamp(uid, path) }, obj);
  if (flavour === 'store141') return Object.assign({ uid }, obj);
  return obj;
}
/** Is this board document this session's, as the client decides it? */
function isMine(flavour, uid, doc) {
  const d = doc.data();
  if (flavour === 'next') return d.owner ? d.owner === ownerStamp(uid, doc.ref.path) : !('uid' in d) || d.uid === uid;
  return !('uid' in d) || d.uid === uid;
}
/** The profile id each flavour uses. */
function profileRef(db, email, flavour) {
  return db.collection('anonProfiles').doc(flavour === 'next' ? profileId(email) : emailHash(email));
}

function profileOf(over = {}) {
  return Object.assign({
    monika: 'Robin', colorKey: 'orange', customInit: '', showMeds: false,
    medList: [{ name: 'Lithium', dose: '400mg' }], showStable: true,
    stableSince: '2026-01-01', stableStreak: 270,
  }, over);
}

const board = {
  // isMonikaInUse()
  monikaInUse: (db, monika) => db.collection(MONIKAS).doc(monika.toLowerCase()).get(),

  // setupMonika() → reserve the name
  reserveMonika: (db, monika, { flavour, uid } = {}) =>
    db.collection(MONIKAS).doc(monika.toLowerCase()).set(stamp(flavour, uid, `${MONIKAS}/${monika.toLowerCase()}`, {
      monika, createdAt: FV.serverTimestamp(),
    })),

  profileRef,

  // _anonRestoreProfile()
  anonRestoreProfile: (db, email, flavour) => profileRef(db, email, flavour).get(),

  // _anonSaveProfile()
  anonSaveProfile: (db, email, p = profileOf(), flavour) =>
    profileRef(db, email, flavour).set({
      monika: p.monika || null, colorKey: p.colorKey || 'orange', customInit: p.customInit || '',
      showMeds: p.showMeds, medList: p.medList, showStable: p.showStable,
      stableSince: p.stableSince || null, stableStreak: p.stableStreak,
      visitStreak: 4, visitDate: '2026-10-05', joinedAt: null,
      updatedAt: FV.serverTimestamp(),
    }, { merge: true }),

  // js/shared/user-count.js countOnce() — profileRef = anonProfiles/{hash} (board)
  // or userSettings/{uid} (home screen).
  countOnce: (db, profileRef, counterId, flagPath) => db.runTransaction(async (tx) => {
    const snap = await tx.get(profileRef);
    const data = snap.exists ? snap.data() : {};
    if (data[flagPath] === true) return false;
    tx.set(profileRef, { [flagPath]: true }, { merge: true });
    tx.set(db.collection('counters').doc(counterId), { count: FV.increment(1) }, { merge: true });
    return true;
  }),

  // user-count.js uncount()
  uncount: (db, counterId) =>
    db.collection('counters').doc(counterId).set({ count: FV.increment(-1) }, { merge: true }),

  // _bbRestoreProfile(): Bipolar Bear account on the board
  async bbRestoreProfile(db, uid, email, flavour) {
    const us = await db.collection('userSettings').doc(uid).get();
    const anonDoc = await profileRef(db, email, flavour).get();
    const ap = anonDoc.exists && anonDoc.data().monika ? anonDoc.data() : profileOf();
    await db.collection('userSettings').doc(uid).set({ anonProfile: ap }, { merge: true });
    await profileRef(db, email, flavour).set({
      monika: ap.monika, colorKey: 'orange', customInit: '', showMeds: false, medList: [],
      showStable: true, stableSince: null, visitStreak: 0, visitDate: null, joinedAt: null,
      updatedAt: FV.serverTimestamp(),
    }, { merge: true });
    return us;
  },

  // _bbSaveProfile()
  async bbSaveProfile(db, uid, email, flavour) {
    const data = { monika: 'Robin', colorKey: 'orange', customInit: '', showMeds: false,
      medList: [], showStable: true, stableSince: null, visitStreak: 1, visitDate: null,
      joinedAt: null, verified: true, termsAccepted: true };
    await db.collection('userSettings').doc(uid).set({ anonProfile: data }, { merge: true });
    await profileRef(db, email, flavour)
      .set({ ...data, updatedAt: FV.serverTimestamp() }, { merge: true });
  },

  // listenPosts() — one listener per tab
  listenTab: (db, tab) => db.collection(POSTS).where('tab', '==', tab).limit(60).get(),

  // fetchTopicDocs()
  fetchTopics: (db) => db.collection(POSTS).where('isTopic', '==', true).get(),

  // maybePostDailyTopic()
  async postDailyTopic(db, dayStr) {
    const ref = db.collection(POSTS).doc('topic-' + dayStr);
    const existing = await ref.get();
    if (existing.exists) return;
    await ref.set({
      isTopic: true, topicIndex: 3, dayStr, text: 'What helped today?', tab: 'general',
      likes: 0, isSystem: false, pinned: false, name: 'Sarah', isAdmin: false,
      initials: 'SA', grad1: '#ffd54f', grad2: '#f9a825', streak: 12,
      timestamp: FV.serverTimestamp(),
    });
  },

  // retireTopic(): archive a topic with replies, delete an empty one
  retireTopic(db, id, hasReplies) {
    const ref = db.collection(POSTS).doc(id);
    return hasReplies
      ? ref.update({ isTopic: false, wasTopic: true, isAdmin: false, name: 'Adam94',
          initials: 'AD', grad1: '#ffd54f', grad2: '#f9a825', streak: 40 })
      : ref.delete();
  },

  // compose → post
  async createPost(db, { flavour, uid, isAdmin = false, tab = 'general', name = 'Robin' } = {}) {
    const ref = db.collection(POSTS).doc();
    await ref.set(stamp(flavour, uid, ref.path, {
      name, streak: 3, initials: 'RO', grad1: '#ffd54f', grad2: '#f9a825', isAdmin,
      text: 'first post', med: '', stable: 0, joinedAt: null, tab, likes: 0, isSystem: false,
      timestamp: FV.serverTimestamp(),
    }));
    return ref;
  },

  // like toggle
  like: (db, id, delta) => db.collection(POSTS).doc(id).update({ likes: FV.increment(delta) }),

  // pollCanPost()
  readPost: (db, id) => db.collection(POSTS).doc(id).get(),

  // report sheet: report + keep the post out of the retention sweep
  async reportPost(db, id) {
    await db.collection('bbAnonReports').add({
      type: 'report', postId: id, reason: 'harm', postText: 'x', postName: 'Robin',
      reportedBy: 'Sam', adminEmail: 'inbox@jamesmarkey.co.uk', timestamp: FV.serverTimestamp(),
    });
    await db.collection(POSTS).doc(id).update({ reported: true });
  },

  // SOS sheet
  sos: (db) => db.collection('bbAnonReports').add({
    type: 'sos', targetName: 'Robin', reportedBy: 'Sam', timestamp: FV.serverTimestamp(),
  }),

  // setupThread() — comment, then bump the parent
  async comment(db, postId, { flavour, uid, isAdmin = false, name = 'Sam' } = {}) {
    const postRef = db.collection(POSTS).doc(postId);
    const ref = postRef.collection('comments').doc();
    await ref.set(stamp(flavour, uid, ref.path, {
      name, text: 'same here', streak: 2, initials: 'SA', grad1: '#ffd54f', grad2: '#f9a825',
      isAdmin, timestamp: FV.serverTimestamp(),
    }));
    await postRef.update({ lastActivity: FV.serverTimestamp(), commentCount: FV.increment(1) });
    return ref;
  },

  // openThread() listener
  readThread: (db, postId) =>
    db.collection(POSTS).doc(postId).collection('comments').orderBy('timestamp', 'asc').get(),

  // deleteComment() — self or admin
  async deleteComment(db, postId, commentId) {
    const postRef = db.collection(POSTS).doc(postId);
    await postRef.collection('comments').doc(commentId).delete();
    await postRef.update({ commentCount: FV.increment(-1) });
  },

  // self-delete sheet
  selfDeletePost: (db, id) => db.collection(POSTS).doc(id).delete(),

  // ms-save: rename monika across past posts
  async rename(db, oldMonika, newMonika, { flavour, uid } = {}) {
    const snap = await db.collection(POSTS).where('name', '==', oldMonika).get();
    const patch = { name: newMonika, initials: 'NE', grad1: '#ffd54f', grad2: '#f9a825' };
    if (flavour === 'next' || flavour === 'store141') {
      // Reserve the new name first (fails if taken), then move this device's
      // posts one by one so a post it can't change doesn't sink the rest,
      // then release the old name (best effort).
      if (oldMonika.toLowerCase() !== newMonika.toLowerCase()) {
        await db.collection(MONIKAS).doc(newMonika.toLowerCase())
          .set(stamp(flavour, uid, `${MONIKAS}/${newMonika.toLowerCase()}`, { monika: newMonika, createdAt: FV.serverTimestamp() }));
      }
      const results = await Promise.all(snap.docs
        .filter((d) => isMine(flavour, uid, d))
        .map((d) => d.ref.update(patch).then(() => true, () => false)));
      if (oldMonika.toLowerCase() !== newMonika.toLowerCase()) {
        await db.collection(MONIKAS).doc(oldMonika.toLowerCase()).delete().catch(() => {});
      }
      return results;
    }
    const batch = db.batch();
    snap.docs.forEach((d) => batch.update(d.ref, patch));
    if (oldMonika.toLowerCase() !== newMonika.toLowerCase()) {
      batch.delete(db.collection(MONIKAS).doc(oldMonika.toLowerCase()));
      batch.set(db.collection(MONIKAS).doc(newMonika.toLowerCase()),
        { monika: newMonika, createdAt: FV.serverTimestamp() });
    }
    await batch.commit();
  },

  // deleteAnonAccount()
  async deleteAccount(db, { monika, email, flavour, uid, counted = true, pushToken }) {
    if (counted) await board.uncount(db, 'anonUserCount');
    const snap = await db.collection(POSTS).where('name', '==', monika).get();
    if (flavour === 'next' || flavour === 'store141') {
      await Promise.all(snap.docs.filter((d) => isMine(flavour, uid, d))
        .map((d) => d.ref.delete().catch(() => {})));
      await db.collection(MONIKAS).doc(monika.toLowerCase()).delete().catch(() => {});
    } else {
      // The shipped build catches each step (js/anonymous.js deleteAnonAccount).
      try {
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        if (snap.size) await batch.commit();
      } catch (_) { /* posts */ }
      await db.collection(MONIKAS).doc(monika.toLowerCase()).delete().catch(() => {});
    }
    if (email) {
      const del = profileRef(db, email, flavour).delete();
      if (flavour === 'next') await del; else await del.catch(() => {});
    }
    if (pushToken) await db.collection('bbAnonPush').doc(pushToken).delete();
  },

  // cleanOldPosts()
  async cleanOldPosts(db) {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * DAY);
    const snap = await db.collection(POSTS).where('timestamp', '<', cutoff).get();
    if (snap.empty) return 0;
    const batch = db.batch();
    let n = 0;
    snap.docs.forEach((doc) => {
      const d = doc.data();
      if (d.reported || d.pinned || d.isTopic) return;
      if (d.lastActivity && d.lastActivity.toMillis() >= cutoff.getTime()) return;
      batch.delete(doc.ref); n++;
    });
    await batch.commit();
    return n;
  },

  // listenBanned()
  listenBanned: (db) => db.collection('bbAnonBanned').get(),

  // submitSuggestion()
  submitSuggestion: (db) => db.collection('bbAnonAnnSuggestions').add({
    name: 'Robin', initials: 'RO', grad1: '#ffd54f', grad2: '#f9a825', streak: 3,
    joinedAt: null, text: 'Meet-up idea', status: 'pending', timestamp: FV.serverTimestamp(),
  }),

  // listenSuggestions(): the admin's queue (and older builds, for everyone)
  listenSuggestions: (db) =>
    db.collection('bbAnonAnnSuggestions').orderBy('timestamp', 'desc').limit(40).get(),
  // ... a member, since 2026-10-12: their own suggestions, by id
  watchOwnSuggestion: (db, id) => db.collection('bbAnonAnnSuggestions').doc(id).get(),

  // dismissSuggestion() — author clearing a refused suggestion
  dismissSuggestion: (db, id) => db.collection('bbAnonAnnSuggestions').doc(id).delete(),

  // js/shared/anon-push.js writeToken() / deleteToken()
  pushRegister: (db, token, flavour) => db.collection('bbAnonPush').doc(token).set(Object.assign({
    token, prefs: { replies: true, announcements: true, posts: false, weekly: true },
    monikaLower: 'robin', platform: 'ios', bundle: 'anonymous', lang: 'en',
    updatedAt: FV.serverTimestamp(),
  }, flavour === 'next' ? {} : { emailHash: null }), { merge: true }),
  pushUnregister: (db, token) => db.collection('bbAnonPush').doc(token).delete(),

  // js/shared/user-count.js presence + counters
  async presence(db, coll, sessionId) {
    const ref = db.collection(coll).doc(sessionId);
    await ref.set({ lastSeen: FV.serverTimestamp() }, { merge: true });
    await db.collection(coll).where('lastSeen', '>', TS.fromMillis(Date.now() - 120000)).get();
    const stale = await db.collection(coll).where('lastSeen', '<', TS.fromMillis(Date.now() - 1800000)).limit(10).get();
    await Promise.all(stale.docs.map((d) => d.ref.delete()));
    await ref.delete();
  },
  readCounter: (db, id) => db.collection('counters').doc(id).get(),
};

const admin = {
  // compose as admin (isAdmin: true), on either tab
  post: (db, opts = {}) => board.createPost(db, Object.assign({ isAdmin: true }, opts)),

  // handlePin()
  async pin(db, postId, tab) {
    const existing = await db.collection(POSTS).where('tab', '==', tab).where('pinned', '==', true).get();
    const batch = db.batch();
    existing.docs.forEach((d) => batch.update(d.ref, { pinned: false }));
    batch.update(db.collection(POSTS).doc(postId), { pinned: true });
    await batch.commit();
  },
  unpin: (db, postId) => db.collection(POSTS).doc(postId).update({ pinned: false }),

  // adminDeletePost()
  deletePost: (db, id) => db.collection(POSTS).doc(id).update({
    deleted: true, deletedByAdmin: true, deletedAt: FV.serverTimestamp(),
  }),

  // adminBanUser()
  async ban(db, name) {
    await db.collection('bbAnonBanned').doc(name.toLowerCase()).set({
      monika: name, bannedBy: 'Admin', timestamp: FV.serverTimestamp(),
    });
    const snap = await db.collection(POSTS).where('name', '==', name).get();
    await Promise.all(snap.docs.map((d) => d.ref.update({
      deleted: true, deletedByAdmin: true, deletedAt: FV.serverTimestamp(),
    })));
  },
  unban: (db, name) => db.collection('bbAnonBanned').doc(name.toLowerCase()).delete(),

  // approveSuggestion() / rejectSuggestion()
  async approve(db, id, { flavour, uid } = {}) {
    const ref = db.collection(POSTS).doc();
    await ref.set(stamp(flavour, uid, ref.path, {
      name: 'Robin', streak: 3, initials: 'RO', grad1: '#ffd54f', grad2: '#f9a825',
      isAdmin: false, text: 'Meet-up idea', med: '', stable: 0, joinedAt: null,
      tab: 'announcements', likes: 0, isSystem: false, suggestedBy: 'Robin',
      timestamp: FV.serverTimestamp(),
    }));
    await db.collection('bbAnonAnnSuggestions').doc(id).update({
      status: 'approved', reviewedAt: FV.serverTimestamp(),
    });
  },
  reject: (db, id) => db.collection('bbAnonAnnSuggestions').doc(id).update({
    status: 'rejected', reviewedAt: FV.serverTimestamp(),
  }),
};

// The Bipolar Bear app itself (index.js, journal.js, survival-kit.js, fab.js).
const bear = {
  async settings(db, uid, flavour) {
    await db.collection('userSettings').doc(uid).get();
    await db.collection('userSettings').doc(uid).set({ reminderEnabled: true, currentStreak: 3 }, { merge: true });
    if (flavour === 'next') {
      // js/shared/secure-store.js: fold plaintext into secureEnc, delete it.
      await db.runTransaction(async (tx) => {
        const ref = db.collection('userSettings').doc(uid);
        await tx.get(ref);
        tx.set(ref, {
          secureEnc: { _enc: 'c2VjcmV0', _iv: 'aXY=', v: 1, updatedAt: Date.now() },
          currentMedList: FV.delete(), moodDefinitions: FV.delete(), copingStrategies: FV.delete(),
        }, { merge: true });
      });
    } else {
      // survival-kit.js saveMedList() and friends, before 2026-10-12
      await db.collection('userSettings').doc(uid).set({ currentMedList: [{ name: 'Lithium' }] }, { merge: true });
    }
  },
  async personalDetails(db, uid, flavour) {
    const ref = db.collection('personalDetails').doc(uid);
    await ref.get();
    if (flavour === 'next') {
      await db.runTransaction(async (tx) => {
        await tx.get(ref);
        tx.set(ref, {
          secureEnc: { _enc: 'c2VjcmV0', _iv: 'aXY=', v: 1 }, updatedAt: Date.now(),
          personalName: FV.delete(), personalMedicalNum: FV.delete(),
        }, { merge: true });
      });
    } else {
      await ref.set({ personalName: 'x', personalMedicalNum: '123' }, { merge: true });
    }
  },
  async entries(db, uid) {
    const ref = await db.collection('entries').add({ userId: uid, timestamp: Date.now(), enc: 'blob' });
    await db.collection('entries').where('userId', '==', uid).get();
    await db.collection('entries').doc(ref.id).set({ userId: uid, timestamp: Date.now(), enc: 'blob2' });
    await db.collection('entries').doc(ref.id).update({ intention: 'rest' });
    await db.collection('entries').doc(ref.id).delete();
  },
  feedback: (db, uid) => db.collection('feedback').add({
    type: 'bug', message: 'x', page: '/journal.html', version: '1.39', platform: 'ios',
    notify: false, email: null, uid, ts: Date.now(), screenshot: null,
  }),
  appCosts: (db) => db.collection('counters').doc('appCosts').get(),
  // survival-kit.js loadHelpedCount() / adjustCounter()
  async helped(db, delta) {
    const ref = db.collection('counters').doc('helpedCount');
    const doc = await ref.get();
    if (!doc.exists) await ref.set({ count: 1 });
    await ref.set({ count: FV.increment(delta) }, { merge: true });
  },
  // index.js / journal.js account deletion
  async deleteAccount(db, uid, email, monika, flavour) {
    await db.collection('userSettings').doc(uid).delete();
    await db.collection('personalDetails').doc(uid).delete();
    if (monika) await db.collection(MONIKAS).doc(monika.toLowerCase()).delete();
    await profileRef(db, email, flavour).delete();
  },
  // index.js unread badge + today's-post check
  async boardBadges(db, monika) {
    await db.collection(POSTS).where('timestamp', '>', TS.fromMillis(Date.now() - DAY)).limit(5).get();
    await db.collection(POSTS).where('name', '==', monika).get();
  },
};

module.exports = { board, admin, bear, profileOf };
