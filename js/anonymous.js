/**
 * Bipolar Anonymous board logic (extracted from inline <script> in
 * anonymous.html). Loads after the Firebase compat SDK and after the
 * shared helpers in <head> (platform.js, debug.js, firebase-config.js).
 *
 * The pre-activation IIFE that picks the initial screen synchronously
 * stays inline in anonymous.html — it MUST run before this file so the
 * verify/board/monika screen is visible during the Firebase boot.
 *
 * High-level structure:
 *   - Beta gate
 *   - Constants & state (YELLOW theme, COLOR_PRESETS, in-memory state)
 *   - Profile getters (read-through to localStorage for bbAnon_* keys)
 *   - Firebase init (initFirebase) + auth-state handler
 *   - boot() — the screen router
 *   - Helpers (esc, initials, timeAgo, _anonEmailHash, ...)
 *   - Screens: setupVerify, setupMonika, setupColor, setupMeds, setupStable, initBoard
 *   - Compose / like / SOS / report / self-delete / admin-delete flows
 *   - Cross-device profile mirror to anonProfiles/{emailHash}
 *
 * innerHTML safety: every innerHTML containing user-supplied content
 * (monika, post body, medication name, email) routes through `esc()` —
 * see the helper at the top of this file.
 *
 * @file js/anonymous.js
 */

// ─────────────────────────────────────────────────────────────────
// Constants & state
// ─────────────────────────────────────────────────────────────────
const YELLOW      = 'var(--brand-secondary)';
const YELLOW_DARK = '#c49e00';
const YELLOW_LT   = '#ffe566';
// How long a post/reply lives before cleanOldPosts() removes it. Also the cadence
// the example (seed) posts rotate on, and the number surfaced in the feed footer,
// so all three stay in lockstep.
const POST_RETENTION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const ADMIN_EMAIL = 'inbox@jamesmarkey.co.uk';
// App Store / Play review access. This single address skips email-code
// verification using the fixed demo code below, so reviewers can test posting
// without access to a live inbox. The board is already open to any
// authenticated user (we anonymous-sign-in for comment threads regardless), so
// this grants no capability an attacker couldn't already reach — it only avoids
// the email round-trip for one known address.
const REVIEW_EMAIL = 'test@bipolarbear.app';
const REVIEW_CODE  = '424242';
// True for both the anon web domain and the dedicated Capacitor bundle.
// See BB.isAnonymousApp() in js/shared/brand-config.js — native shells
// can't be detected by hostname alone.
const _isAnonymousApp = BB.isAnonymousApp();

const COLOR_PRESETS = [
  { key: 'orange', g1: '#ffb340', g2: '#e07800' },
  { key: 'blue',   g1: '#64b5f6', g2: '#1565c0' },
  { key: 'purple', g1: '#ce93d8', g2: '#7b1fa2' },
  { key: 'green',  g1: '#81c784', g2: '#2e7d32' },
  { key: 'pink',   g1: '#f48fb1', g2: '#c2185b' },
  { key: 'teal',   g1: '#4dd0e1', g2: '#00838f' },
];

let db = null;
let currentTab      = 'general';
let unsubTabListeners = { announcements: null, general: null };
let postsByTab        = { announcements: [], general: [] };
let suggestions       = [];   // announcement suggestions awaiting the admin
let unsubSuggestions  = null;
// Millisecond timestamp of when the user last had each tab open
const lastSeenMs = {
  announcements: parseInt(BB.storage.get('Anon_lastSeen_announcements') || '0', 10),
  general:       parseInt(BB.storage.get('Anon_lastSeen_general')       || '0', 10),
};
// Per-thread read state: postId → { c: comments seen, t: when it was stored }.
// A post whose live commentCount runs ahead of its stored `c` has replies the
// user hasn't read, and its 💬 button pulses. See the unread-reply helpers.
const THREAD_SEEN_KEY = 'Anon_threadSeen';
let threadSeen = _loadThreadSeen();
let localPosts      = [];
let sosTargetName   = '';
let reportTargetId  = '';
let muteTargetName  = '';
let adminDeleteId    = '';
let adminBanName     = '';
let selfDeleteId     = '';
let commentTargetId  = '';
// Comment moderation targets (thread view). Parent post id is captured at
// click time so a confirm still resolves the right thread even if state drifts.
let commentActionParent = '';
let commentSelfDeleteId  = '';
let commentAdminDeleteId = '';
let reportCommentMeta    = null; // {id, parentId, name, text} when reporting a comment, else null
let lastCommentAuthor = ''; // monika of the most recent comment in the open thread (for the per-thread post gate)
let currentThreadUnsub = null;
let _bbUser         = null; // Firebase-auth verified user (BB App path)
let _boardSetupDone = false; // initBoard's one-time handler wiring (compose, FAB, tabs, overlays)

// Persisted user profile (localStorage)
const profile = {
  get monika()      { return BB.storage.get('Anon_monika')    || ''; },
  get verified()    { return BB.storage.get('Anon_verified')  === 'true'; },
  // Guideline 1.2 agreement. Set by the verify-screen checkbox on the
  // standalone path and by screen-agree on the BB-app path (which skips
  // verify). Mirrored to userSettings.anonProfile.termsAccepted so it
  // survives a reinstall.
  get termsOk()     { return BB.storage.get('Anon_agreedTerms') === 'true'; },
  get showMeds()    { return BB.storage.get('Anon_showMeds')    === 'true'; },
  get showStable()  { return BB.storage.get('Anon_showStable') === 'true'; },
  get stableStreak(){ return parseInt(BB.storage.get('Anon_stableStreak') || '0', 10); },
  get stableSince() { return BB.storage.get('Anon_stableSince') || ''; }, // standalone: YYYY-MM-DD
  get med()         { return BB.storage.get('Anon_med')       || ''; },
  get medList()     {
    try {
      const s = BB.storage.get('Anon_medList');
      if (s) return JSON.parse(s);
      const m = BB.storage.get('Anon_med');
      return m ? [{ name: m, dosage: '' }] : [];
    } catch(e) { return []; }
  },
  get hasPosted()   { return BB.storage.get('Anon_hasPosted') === 'true'; },
  get isAdmin()     { return BB.storage.get('Anon_isAdmin')   === 'true'; },
  get colorKey()    { return BB.storage.get('Anon_colorKey')  || 'orange'; },
  get grad1()       { const p = COLOR_PRESETS.find(c => c.key === this.colorKey); return p ? p.g1 : YELLOW_LT; },
  get grad2()       { const p = COLOR_PRESETS.find(c => c.key === this.colorKey); return p ? p.g2 : YELLOW_DARK; },
  get customInit()  { return BB.storage.get('Anon_initials')  || ''; },
  avatarInitials()  { return this.customInit || initials(this.monika); },
  // Pull streak from journal if available, else default to 1
  get streak()      { return parseInt(BB.storage.get('Anon_streak') || '1', 10); },
  // ISO timestamp of "Bipolar Bear birthday" — earliest of BB account
  // creation and anon profile creation. Resolved by _resolveJoinedAt().
  get joinedAt()    { return BB.storage.get('Anon_joinedAt')   || ''; },
};

// Liked posts set (persisted)
const likedPosts = new Set(
  JSON.parse(BB.storage.get('Anon_liked') || '[]')
);
function saveLiked() {
  BB.storage.set('Anon_liked', JSON.stringify([...likedPosts]));
}

// Muted users set (persisted, device-local). Posts and comments from these
// monikas are hidden from the feed on this device only — nothing is written
// to Firestore. Apple's UGC guideline (1.2) requires a user-level block in
// addition to per-post reporting.
const mutedUsers = new Set(
  JSON.parse(BB.storage.get('Anon_muted') || '[]')
);
function saveMuted() {
  BB.storage.set('Anon_muted', JSON.stringify([...mutedUsers]));
}

// ─────────────────────────────────────────────────────────────────
// Content filter (Apple UGC guideline 1.2)
// ─────────────────────────────────────────────────────────────────
// Blocks posts and comments containing slurs, hate speech, or explicit
// sexual content BEFORE they reach Firestore. Deliberately tight: crisis
// language ("kill myself", "want to die", "self-harm") is NOT filtered — that
// is a peer-support disclosure handled by the SOS flow, not something to
// censor. We only block terms that are objectionable in any context on a
// kind, anonymous mental-health board.
const _BLOCKED_WORDS = [
  // Identity-based slurs (hate speech)
  'nigger', 'nigga', 'faggot', 'tranny', 'chink', 'spic', 'kike',
  'wetback', 'coon', 'gook', 'paki', 'retard', 'retarded',
  // Explicit sexual / harassment
  'cunt', 'whore', 'slut', 'rape', 'rapist', 'cum', 'blowjob', 'dildo',
  'porn', 'porno', 'pedo', 'pedophile', 'paedophile', 'molest',
];
const _BLOCKED_SET = new Set(_BLOCKED_WORDS);
// The most-evaded, unambiguous slurs — caught even when padded with
// separators ("n i g g e r", "f-a-g-g-o-t"). Kept to terms that are NOT
// substrings of ordinary words, to avoid the Scunthorpe problem.
const _BLOCKED_TIGHT = ['nigger', 'faggot'];

// Fold common leetspeak so "f@gg0t" / "n1gger" still match.
function _normalizeForFilter(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[@4]/g, 'a')
    .replace(/0/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/[5$]/g, 's')
    .replace(/7/g, 't');
}

// Returns the offending term if the text contains blocked content, else null.
function findBlockedTerm(text) {
  const norm = _normalizeForFilter(text);
  // 1) Whole-word match — no false positives on substrings like "therapist"
  //    or "scunthorpe".
  const words = norm.split(/[^a-z]+/);
  for (const w of words) {
    if (w && _BLOCKED_SET.has(w)) return w;
  }
  // 2) Separator-stripped match for the worst slurs only.
  const collapsed = norm.replace(/[^a-z]/g, '');
  for (const w of _BLOCKED_TIGHT) {
    if (collapsed.includes(w)) return w;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────
// Banned users (Apple UGC guideline 1.2 — "eject the user")
// ─────────────────────────────────────────────────────────────────
// Populated from the bbAnonBanned collection via a live listener so an admin
// ban takes effect on every device: banned monikas' posts and comments are
// hidden everywhere, and the banned user is blocked from composing. Monikas
// are stored lowercased (doc id) for case-insensitive matching.
const bannedUsers = new Set();
let unsubBanned = null;
function isBanned(name) {
  return !!name && bannedUsers.has(String(name).toLowerCase());
}

// ─────────────────────────────────────────────────────────────────
// Firebase
// ─────────────────────────────────────────────────────────────────
// File-scope (not inside initFirebase) — the 2.5s fallback boot at the foot
// of this file reads it, and it must also stay false when Firebase never
// loads and initFirebase never runs.
let _anonInitialBoot = false;
function initFirebase() {
  try {
    if (!firebase.apps.length) {
      // Config lives in js/shared/firebase-config.js so every page reads the
      // same source of truth.
      firebase.initializeApp(window.BB_FIREBASE_CONFIG);
    }
    db = firebase.firestore();
    db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    // Expose callable functions for email verification
    const _fns = firebase.app().functions('europe-west1');
    window._anonSendCode   = _fns.httpsCallable('sendAnonCode');
    window._anonVerifyCode = _fns.httpsCallable('verifyAnonCode');
    window._anonGetBBStats = _fns.httpsCallable('getBBStats');

    // Auto-translation of member-written text (js/shared/translate.js). Wired
    // from here rather than inside the module so a page that never reaches
    // Firebase simply shows every post as written, instead of erroring.
    if (window.BB && BB.translate) {
      BB.translate.init({
        callable:   _fns.httpsCallable('translateAnonTexts'),
        ensureAuth: _ensureAuthSession,
      });
    }

    // Auth state handler — routes on first load, handles sign-out while on board
    firebase.auth().onAuthStateChanged(async function(user) {
      const isReal = user && !user.isAnonymous;

      if (!_anonInitialBoot) {
        _anonInitialBoot = true;
        // Reload to get fresh emailVerified status
        if (isReal) await user.reload().catch(() => {});
        boot(isReal ? firebase.auth().currentUser : null);
        return;
      }

      // Subsequent auth changes — sign-out while on board (Firebase-auth path only).
      // Checks !user (not !isReal) so the standalone path's anonymous
      // sign-in (_ensureAuthSession) doesn't read as a sign-out.
      if (!user && BB.storage.get('Anon_verified') === 'true' && !BB.storage.get('Anon_email')) {
        BB.storage.remove('Anon_verified');
        BB.storage.remove('Anon_isAdmin');
        stopAllListeners();
        boot(null);
      }
    });
  } catch (e) {
    console.warn('[Anonymous] Firebase init failed — running offline', e);
  }
}
if (typeof firebase !== 'undefined') {
  initFirebase();
} else {
  window.addEventListener('load', () => { if (typeof firebase !== 'undefined') initFirebase(); });
}

// Standalone users (email-code path) never sign in to Firebase Auth, but the
// Firestore rules for the comments subcollection require request.auth — the
// top-level bbAnonPosts collection is open, which is why posting works while
// comment threads silently fail. Sign in anonymously so threads work too.
// No-op when a session (BB account or a previous anonymous one) exists.
let _anonAuthPromise = null;
let _anonAuthSettled = false;
function _ensureAuthSession() {
  // A settled promise with no current user means the session ended since
  // (account deleted, signed out) — sign in again rather than reuse it.
  if (_anonAuthPromise && _anonAuthSettled && !_authUid()) _anonAuthPromise = null;
  if (!_anonAuthPromise) {
    _anonAuthSettled = false;
    _anonAuthPromise = (async () => {
      try {
        if (typeof firebase !== 'undefined' && firebase.auth && !firebase.auth().currentUser) {
          await firebase.auth().signInAnonymously();
        }
      } catch (e) {
        console.warn('[Anonymous] anonymous sign-in failed', e);
      }
    })().finally(() => { _anonAuthSettled = true; });
  }
  return _anonAuthPromise;
}

// The Firebase uid of this session (anonymous or BipolarBear account), or null.
function _authUid() {
  try {
    const u = typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser;
    return u ? u.uid : null;
  } catch (e) { return null; }
}

// Board documents carry their author's uid: the Firestore rules let only that
// session delete or rename them. Left off if sign-in failed.
function _withOwner(doc) {
  const uid = _authUid();
  return uid ? { ...doc, uid } : doc;
}

// ─────────────────────────────────────────────────────────────────
// Screen routing
// ─────────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
  document.getElementById('app-shell').style.opacity = '1';
  // The logo fit can only be measured once the board screen is laid out.
  if (id === 'board') requestAnimationFrame(_fitBoardLogo);
}

async function boot(user) {
  const isReal = user && !user.isAnonymous;
  // Treat any BipolarBear-signed-in user as "the BB user" — the anon board
  // verifies email itself via the code flow below, so we don't gate on
  // user.emailVerified here. Pre-fill + save-back keeps the BB account and
  // the anon email connected.
  _bbUser = isReal ? user : null;
  _updateBoardLogo();
  // Show "← Home" on verify/monika screens only for BB App users (Firebase Auth)
  ['verify-back-btn', 'monika-back-btn'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.style.display = isReal ? '' : 'none';
  });

  if (isReal && user.emailVerified) {
    // Signed in to BipolarBear with verified email — skip code verification
    // Set/clear admin flag based on Firebase Auth email
    if (user.email && user.email.toLowerCase() === ADMIN_EMAIL) {
      BB.storage.set('Anon_isAdmin', 'true');
    } else {
      BB.storage.remove('Anon_isAdmin');
    }
    // Mark as verified for the synchronous pre-activation hint on next visit.
    // Cleared on sign-out by the auth-change handler above.
    BB.storage.set('Anon_verified', 'true');
    // Restore full anon profile (monika, meds, stable, etc.) from userSettings
    await _bbRestoreProfile(user.uid);
    // Guideline 1.2: this path skips the verify screen, so the terms checkbox
    // there never ran. Gate on the agreement before any UGC is reachable.
    if (!profile.termsOk) {
      showScreen('agree');
      setupAgree();
      return;
    }
    if (profile.monika) {
      showScreen('board');
      initBoard();
    } else {
      showScreen('monika');
      setupMonika();
    }
  } else if (profile.verified && profile.monika) {
    // Standalone verified (email code path, not signed in to main app).
    // Refresh stats from Firestore on every visit so stableStreak / joinedAt
    // stay current without requiring a fresh email verification.
    const savedEmail = BB.storage.get('Anon_email');
    // Backfill the guideline-1.2 flag for standalone installs that predate it:
    // they ticked the verify-screen checkbox, so re-prompting is wrong, and
    // without this the pre-activation picker would flash screen-agree at them.
    // Gated on Anon_email — only the standalone path stores it, so a BB-app
    // user landing here (e.g. the 2.5s auth-timeout fallback boot(null)) is
    // NOT silently granted an agreement they never gave.
    if (savedEmail && !profile.termsOk) BB.storage.set('Anon_agreedTerms', 'true');
    // Anything still lacking an agreement at this point reached here without
    // the verify-screen checkbox (a BB-app user whose auth didn't resolve in
    // time). No UGC before the gate — initBoard() must not run.
    if (!profile.termsOk) {
      showScreen('agree');
      setupAgree();
      return;
    }
    if (savedEmail) {
      await _ensureAuthSession();
      await _anonRestoreProfile(savedEmail);
    }
    showScreen('board');
    initBoard();
  } else if (profile.verified) {
    showScreen('monika');
    setupMonika();
  } else {
    // Not verified — show email+code verify screen
    showScreen('verify');
    setupVerify();
  }
}

// ─────────────────────────────────────────────────────────────────
// Overlay helpers
// ─────────────────────────────────────────────────────────────────
function openOv(id)  { document.getElementById(id).classList.remove('hidden'); }
function closeOv(id) { document.getElementById(id).classList.add('hidden'); }

// ─────────────────────────────────────────────────────────────────
// About overlay + home navigation helper
// ─────────────────────────────────────────────────────────────────
function openAbout() { renderMutedList(); openOv('ov-about'); }

// "Muted users" section of the About sheet — hidden when nothing is muted.
function renderMutedList() {
  const wrap = document.getElementById('about-muted-wrap');
  const listEl = document.getElementById('about-muted-list');
  if (!wrap || !listEl) return;
  if (!mutedUsers.size) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  listEl.innerHTML = [...mutedUsers].map(n => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;">
      <span>🙈 [${esc(n)}]</span>
      <button class="btn-secondary" data-unmute="${esc(n)}" style="padding:4px 12px;font-size:12px;">${esc(_wt('anon.mute.unmute'))}</button>
    </div>`).join('');
  listEl.querySelectorAll('[data-unmute]').forEach(btn => {
    btn.addEventListener('click', () => {
      mutedUsers.delete(btn.dataset.unmute);
      saveMuted();
      renderMutedList();
      renderPosts(currentTab === 'general' ? assembleGeneralPosts(localPosts) : announcementFeed());
    });
  });
}
document.getElementById('about-close').addEventListener('click', () => closeOv('ov-about'));

// Stamp the shared web app version (from brand-config.js) into the About footer.
(function () {
  const el = document.getElementById('about-version');
  if (el && window._APP_VERSION) el.textContent = 'v' + window._APP_VERSION;
})();

// _goHome() is called from inline onclick attributes on onboarding screens
// and the board logo. Navigates appropriately for the current bundle.
function _goHome() {
  if (_bbUser) {
    // In the native app navigate within the app; on the web go to the public homepage
    if (window.Capacitor || location.protocol === 'file:') { location.replace('index.html'); }
    else { location.href = 'https://bipolarbear.app'; }
  } else if (!_isAnonymousApp) { location.replace('index.html'); }
  // standalone users in the anonymous app (web or native): do nothing —
  // they're already at the only "home" their bundle has.
}

// True when the user got here from BipolarBear (signed in on the main bundle),
// so the board logo can double as the way back. Never true in the standalone
// Bipolar Anonymous bundle — there is no BipolarBear app to return to.
function _canGoBackToBB() { return !!_bbUser && !_isAnonymousApp; }

// The board's top-left logo. Standalone users get the plain "Anonymous /
// BipolarBear" wordmark. Users who arrived from BipolarBear get the
// BipolarBear icon and wordmark with a small "← Go back" under it, so the
// route home is visible rather than hidden behind an unlabelled logo tap.
function _updateBoardLogo() {
  const btn = document.getElementById('board-logo-btn');
  if (!btn) return;
  const img    = btn.querySelector('img');
  const nameEl = btn.querySelector('.board-logo-name');
  const subEl  = btn.querySelector('.board-logo-sub');
  if (_canGoBackToBB()) {
    btn.style.cursor = 'pointer';
    btn.title = _wt('anon.ui.backToBB');
    btn.classList.add('logo-back');
    if (img)    { img.src = 'icons/AppIcon.png'; img.alt = 'BipolarBear'; }
    if (nameEl) nameEl.textContent = 'BipolarBear';
    if (subEl)  subEl.textContent  = '\u2190 ' + _wt('anon.ui.goBack');
  } else {
    btn.style.cursor = 'default';
    btn.title = '';
    btn.classList.remove('logo-back');
    if (img)    { img.src = 'icons/AppIcon_anonymous.png'; img.alt = ''; }
    if (nameEl) nameEl.textContent = 'Anonymous';
    if (subEl)  subEl.textContent  = 'BipolarBear';
  }
  _fitBoardLogo();
}

// Close on backdrop tap
['ov-compose','ov-firstpost','ov-sos','ov-report','ov-mute','ov-e2ee','ov-monika','ov-self-delete','ov-admin-delete','ov-admin-ban','ov-anon-delete','ov-terms','ov-med','ov-stable','ov-about'].forEach(id => {
  document.getElementById(id).addEventListener('click', e => {
    if (e.target === document.getElementById(id)) closeOv(id);
  });
});
// Thread overlay needs special handling to also unsubscribe the comments listener
document.getElementById('ov-thread').addEventListener('click', e => {
  if (e.target === document.getElementById('ov-thread')) closeThread();
});

// Community Guidelines & Terms overlay (UGC agreement, guideline 1.2).
// Openable from the signup checkbox and the About sheet; closeable from its
// own button (backdrop-tap is handled by the array above).
['open-terms-link','open-terms-link-bb','about-terms-link'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', () => openOv('ov-terms'));
});
document.getElementById('terms-close').addEventListener('click', () => closeOv('ov-terms'));

// ─────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────
function initials(name) { return (name || '??').slice(0, 2).toUpperCase(); }

function esc(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Whitelist a hex colour for inline `style=` interpolation. Anything that
// doesn't match a plain `#rgb`/`#rrggbb`/`#rrggbbaa` falls back to the
// default — prevents Firestore-stored gradients from breaking out of the
// style attribute.
function safeColor(c, fallback) {
  return (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c)) ? c : fallback;
}

// Coerce a Firestore value to a finite number for safe HTML interpolation.
// Strings, NaN, Infinity, etc. all fall back to `fallback`.
function num(n, fallback) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function timeAgo(ts) {
  if (!ts) return _wt('anon.time.now');
  const ms = ts.toMillis ? ts.toMillis() : (ts instanceof Date ? ts.getTime() : ts);
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60)   return _wt('anon.time.now');
  if (s < 3600)  return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}

// ─────────────────────────────────────────────────────────────────
// Bipolar Bear birthday — joined-date resolution + formatting
// ─────────────────────────────────────────────────────────────────
// Picks the earliest known join date between the BB Firebase Auth
// account (metadata.creationTime) and any previously-stored anon
// profile date. First-time standalone users get "today". The result
// is cached in localStorage and mirrored to Firestore via the
// profile-save helpers.
function _resolveJoinedAt() {
  const candidates = [];
  const stored = BB.storage.get('Anon_joinedAt');
  if (stored) candidates.push(stored);
  if (_bbUser && _bbUser.metadata && _bbUser.metadata.creationTime) {
    const ct = new Date(_bbUser.metadata.creationTime);
    if (!isNaN(ct.getTime())) candidates.push(ct.toISOString());
  }
  let earliest;
  if (candidates.length) {
    candidates.sort();
    earliest = candidates[0];
  } else {
    earliest = new Date().toISOString();
  }
  if (earliest !== stored) BB.storage.set('Anon_joinedAt', earliest);
  return earliest;
}

// Compact "Xy Yd" / "Yd" used on the user pill and post header.
function _birthdayCompact(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms) || ms < 0) return '';
  const days = Math.floor(ms / 86400000);
  if (days < 1) return '';
  const years = Math.floor(days / 365);
  const rem = days - years * 365;
  return years > 0 ? `${years}y ${rem}d` : `${days}d`;
}

// Verbose "1 year, 23 days old" used in the Monika overlay.
function _birthdayVerbose(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms) || ms < 0) return '';
  const days = Math.floor(ms / 86400000);
  const years = Math.floor(days / 365);
  const rem = days - years * 365;
  const yPart = years === 1 ? '1 year' : `${years} years`;
  const dPart = rem === 1 ? '1 day'   : `${rem} days`;
  return years > 0 ? `${yPart}, ${dPart} old` : `${dPart} old`;
}

// Localised "10 May 2026" for the Monika overlay row.
function _birthdayDateLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  try {
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  } catch (_) {
    return d.toISOString().slice(0, 10);
  }
}

function getLatestRealPost(tab) {
  // Daily topics are excluded: they're app-authored, and since they now post
  // under a generated member name that name could collide with the user's
  // monika and wrongly trip the "wait for a reaction" gate.
  const real = localPosts.filter(p => p.tab === tab && !p.deleted && !p.isTopic && !p.wasTopic);
  if (!real.length) return null;
  return real.reduce((a, b) => {
    const ta = a.timestamp?.toMillis?.() ?? 0;
    const tb = b.timestamp?.toMillis?.() ?? 0;
    return tb > ta ? b : a;
  });
}

function isSelfDeleteEligible(post) {
  if ((post.likes || 0) > 0) return true;
  const ts = post.timestamp?.toMillis?.() ?? 0;
  return !localPosts.some(p =>
    p.id !== post.id && p.tab === post.tab && !p.deleted &&
    (p.timestamp?.toMillis?.() ?? 0) > ts
  );
}

function showHint(msg) {
  const h = document.getElementById('fab-hint');
  h.textContent = msg;
  h.classList.add('show');
  clearTimeout(h._t);
  h._t = setTimeout(() => h.classList.remove('show'), 2200);
}

// ─────────────────────────────────────────────────────────────────
// Feel: haptics, empty states, loading skeletons
// ─────────────────────────────────────────────────────────────────
// A light tap on the phone for likes, sends, the ⋯ menu and pull-to-refresh.
// Native shells use @capacitor/haptics when the build carries it; Android's
// web view falls back to navigator.vibrate; iOS Safari has neither, so the
// web build on an iPhone stays silent. Never throws.
function _haptic(kind) {
  try {
    const H = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics;
    if (H) {
      if (kind === 'success') H.notification({ type: 'SUCCESS' });
      else H.impact({ style: kind === 'medium' ? 'MEDIUM' : 'LIGHT' });
      return;
    }
    if (navigator.vibrate) navigator.vibrate(kind === 'success' ? [12, 40, 12] : 10);
  } catch (e) {}
}

// The bear over a line of copy, for "nothing here" moments. `text` is plain
// text (escaped here).
function _emptyHtml(text, compact) {
  return `<div class="empty-illus${compact ? ' compact' : ''}">`
       + `<img src="icons/anon-bear-256.png" alt="" loading="lazy">`
       + `<div>${esc(text)}</div></div>`;
}

function _skeletonHtml(n) {
  const card = `<div class="skel-card"><div class="skel-row"><div class="skel skel-av"></div>`
    + `<div style="flex:1"><div class="skel skel-line" style="width:40%"></div>`
    + `<div class="skel skel-line" style="width:25%;margin:0"></div></div></div>`
    + `<div class="skel skel-line" style="width:92%"></div><div class="skel skel-line" style="width:70%"></div></div>`;
  return card.repeat(n || 3);
}

// ─────────────────────────────────────────────────────────────────
// Appearance (automatic / light / dark)
// ─────────────────────────────────────────────────────────────────
// Stored in localStorage.bbAnonTheme — outside the bbAnon_* prefix on purpose,
// so signing out doesn't flip someone back into a bright screen at 2 a.m. The
// inline script in <head> applies it before first paint; this keeps it right
// afterwards (setting changed, or the phone switching at sunset).
const THEME_KEY = 'bbAnonTheme';
function _themePref() {
  try { const v = localStorage.getItem(THEME_KEY); return (v === 'light' || v === 'dark') ? v : 'auto'; }
  catch (e) { return 'auto'; }
}
const _darkQuery = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
function applyTheme() {
  const pref = _themePref();
  const dark = pref === 'dark' || (pref === 'auto' && !!(_darkQuery && _darkQuery.matches));
  document.documentElement.classList.toggle('theme-dark', dark);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#1c190f' : '#f5c800');
}
if (_darkQuery) {
  const onChange = () => { if (_themePref() === 'auto') applyTheme(); };
  if (_darkQuery.addEventListener) _darkQuery.addEventListener('change', onChange);
  else if (_darkQuery.addListener) _darkQuery.addListener(onChange);
}
applyTheme();
function _paintThemeStatus() {
  const el = document.getElementById('ms-theme-status');
  if (!el) return;
  const pref = _themePref();
  el.textContent = _wt(pref === 'dark' ? 'anon.ux.themeDark' : pref === 'light' ? 'anon.ux.themeLight' : 'anon.ux.themeAuto');
}
function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  const next = order[(order.indexOf(_themePref()) + 1) % order.length];
  try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  applyTheme();
  _paintThemeStatus();
  _haptic();
}

// ─────────────────────────────────────────────────────────────────
// Saved posts (this device only)
// ─────────────────────────────────────────────────────────────────
// A snapshot of the post, not a pointer to it — posts leave the board after
// POST_RETENTION_DAYS, and the point of saving the reply that helped is being
// able to find it again on a bad day next month. Cleared with the rest of the
// bbAnon_* state on sign-out.
const SAVED_MAX = 100;
function _loadSaved() {
  try { const a = JSON.parse(BB.storage.get('Anon_saved') || '[]'); return Array.isArray(a) ? a : []; }
  catch (e) { return []; }
}
function _storeSaved(list) {
  try { BB.storage.set('Anon_saved', JSON.stringify(list.slice(0, SAVED_MAX))); } catch (e) {}
}
function isSaved(id) { return !!id && _loadSaved().some(s => s.id === id); }
function _findPost(id) {
  return localPosts.find(p => p.id === id)
      || (postsByTab.general || []).find(p => p.id === id)
      || (postsByTab.announcements || []).find(p => p.id === id);
}
function toggleSaved(id) {
  const list = _loadSaved();
  const at = list.findIndex(s => s.id === id);
  if (at >= 0) {
    list.splice(at, 1);
    _storeSaved(list);
    showHint(_wt('anon.ux.unsavedToast'));
    return false;
  }
  const p = _findPost(id);
  if (!p) return false;
  const topicA = (p.isTopic || p.wasTopic) ? topicAuthorOf(p) : null;
  list.unshift({
    id,
    name:     topicA ? topicA.name : (p.isAdmin ? ADMIN_DISPLAY_NAME : (p.name || '')),
    initials: topicA ? topicA.initials : (p.initials || initials(p.name || '')),
    grad1:    safeColor(topicA ? topicA.grad1 : p.grad1, YELLOW_LT),
    grad2:    safeColor(topicA ? topicA.grad2 : p.grad2, YELLOW_DARK),
    text:     String(p.text || ''),
    ts:       p.timestamp?.toMillis?.() ?? (p.timestamp instanceof Date ? p.timestamp.getTime() : Date.now()),
    savedAt:  Date.now(),
  });
  _storeSaved(list);
  _haptic('success');
  showHint(_wt('anon.ux.savedToast'));
  return true;
}
function _paintSavedStatus() {
  const el = document.getElementById('ms-saved-status');
  if (!el) return;
  const n = _loadSaved().length;
  el.textContent = n ? _wt('anon.ux.savedCount', { n }) : _wt('anon.ux.savedNone');
}
function openSaved() {
  const listEl = document.getElementById('saved-list');
  const saved = _loadSaved();
  if (!saved.length) {
    listEl.innerHTML = _emptyHtml(_wt('anon.ux.savedEmpty'), true);
  } else {
    listEl.innerHTML = saved.map(s => {
      const live = !!_findPost(s.id);
      return `<div class="saved-card" data-sid="${esc(s.id)}">
        <div class="saved-head">
          <div class="post-av-circle" style="background:linear-gradient(135deg,${safeColor(s.grad1, YELLOW_LT)},${safeColor(s.grad2, YELLOW_DARK)});">${esc(s.initials || '')}</div>
          <div class="saved-name">[${esc(s.name)}]</div>
          <div class="saved-when">${esc(timeAgo(new Date(num(s.ts, Date.now()))))}</div>
        </div>
        <div class="saved-text" data-tt>${esc(s.text)}</div>
        <div class="saved-actions">
          ${live ? `<button class="sugg-btn sugg-yes" data-saved-open="${esc(s.id)}">${esc(_wt('anon.ux.openThread'))}</button>`
                 : `<span class="saved-gone">${esc(_wt('anon.ux.expired'))}</span>`}
          <div style="flex:1"></div>
          <button class="sugg-btn sugg-no" data-saved-remove="${esc(s.id)}">${esc(_wt('anon.ux.remove'))}</button>
        </div>
      </div>`;
    }).join('');
    if (window.BB && BB.translate) BB.translate.scan(listEl);
  }
  openOv('ov-saved');
}
document.getElementById('saved-list').addEventListener('click', e => {
  const open = e.target.closest('[data-saved-open]');
  const rm   = e.target.closest('[data-saved-remove]');
  if (open) {
    const id = open.dataset.savedOpen;
    const p = _findPost(id);
    closeOv('ov-saved');
    closeOv('ov-monika');
    if (p) {
      const tab = p.tab === 'announcements' ? 'announcements' : 'general';
      if (currentTab !== tab) setTab(tab);
      openThread(id);
    }
  } else if (rm) {
    const list = _loadSaved().filter(s => s.id !== rm.dataset.savedRemove);
    _storeSaved(list);
    openSaved();
    _paintSavedStatus();
  }
});
document.getElementById('saved-close').addEventListener('click', () => closeOv('ov-saved'));

// ─────────────────────────────────────────────────────────────────
// Need help now
// ─────────────────────────────────────────────────────────────────
// The sheet's markup is the UK's (Samaritans, Shout, NHS 111, 999). On a
// phone anywhere else, swap in that country's lines from js/shared/crisis.js
// — or, for a country it doesn't list, findahelpline.com — so nobody in
// crisis is handed a number that won't connect. Rebuilt on every open so a
// language change is picked up.
function _applyCrisisLines() {
  const C = window.BB && BB.crisis;
  const sheet = document.querySelector('#ov-help .sheet');
  if (!C || !sheet) return;
  const g = C.get();
  if (g.uk) return;
  const cls = { row: 'help-row', ico: 'help-ico', name: 'help-name', sub: 'help-sub' };
  const link = sheet.querySelector('.help-link');
  sheet.querySelectorAll('.help-row').forEach(el => el.remove());
  const sub = sheet.querySelector('.sheet-sub');
  if (sub) { sub.removeAttribute('data-i18n'); sub.textContent = C.dangerSub(); }
  g.lines.forEach(l => sheet.insertBefore(C.row(l, cls), link));
  if (g.emergency) {
    const r = C.row({ name: BB.t('crisis.emergency'), href: 'tel:' + g.emergency, icon: '🚑',
      sub: BB.t('crisis.callN', { n: g.emergency }) }, cls);
    r.classList.add('help-urgent');
    sheet.insertBefore(r, link);
  }
  if (link) {
    link.removeAttribute('data-i18n');
    link.textContent = BB.t('crisis.elsewhere');
    link.style.display = g.cc ? '' : 'none'; // the find-a-helpline row is already the link
  }
}
document.getElementById('board-help-btn').addEventListener('click', () => { _haptic(); _applyCrisisLines(); openOv('ov-help'); });
// The same sheet from the sign-up screen, so help is there before joining.
document.getElementById('verify-help-btn').addEventListener('click', () => { _haptic(); _applyCrisisLines(); openOv('ov-help'); });
document.getElementById('help-close').addEventListener('click', () => closeOv('ov-help'));

// ─────────────────────────────────────────────────────────────────
// The ⋯ action sheet (posts and comments)
// ─────────────────────────────────────────────────────────────────
// Each card still renders its moderation buttons (SOS / report / mute / the
// admin tools), hidden inside .post-more-items, so the handlers that were
// already bound to them keep working. The sheet lists them and, on a tap,
// clicks the real button — one code path, whichever way the member got there.
const _DANGER_ACTIONS = ['delete', 'ban', 'report', 'selfdelete', 'cdelete', 'cban', 'creport', 'cselfdelete'];
let _actionTargets = [];
function openActions(card) {
  if (!card) return;
  const isComment = card.classList.contains('comment-card');
  const rows = [];
  _actionTargets = [];
  const add = (ico, label, fn, danger) => {
    _actionTargets.push(fn);
    rows.push(`<button class="action-row${danger ? ' action-danger' : ''}" data-act="${_actionTargets.length - 1}">`
      + `<span class="action-ico">${ico}</span><span>${esc(label)}</span></button>`);
  };
  if (isComment) {
    const author = card.dataset.author || '';
    if (author && author !== profile.monika) {
      add('↩️', _wt('anon.ux.reply'), () => _replyTo(author));
    }
  } else {
    const pid = card.dataset.pid;
    const p = pid && _findPost(pid);
    if (p && _isThreadable(p)) {
      const saved = isSaved(pid);
      add('🔖', _wt(saved ? 'anon.ux.unsave' : 'anon.ux.save'), () => toggleSaved(pid));
    }
  }
  card.querySelectorAll('.post-more-items > button').forEach(btn => {
    const kind = Object.keys(btn.dataset).find(k => k !== 'tab') || '';
    add(btn.textContent.trim(), btn.title || kind, () => btn.click(), _DANGER_ACTIONS.includes(kind));
  });
  if (!rows.length) return;
  const txt = card.querySelector('.post-text, .comment-text');
  const prev = document.getElementById('actions-preview');
  prev.textContent = txt ? txt.textContent.trim() : '';
  prev.style.display = prev.textContent ? '' : 'none';
  document.getElementById('actions-list').innerHTML = rows.join('');
  _haptic();
  openOv('ov-actions');
}
document.getElementById('actions-list').addEventListener('click', e => {
  const row = e.target.closest('[data-act]');
  if (!row) return;
  const fn = _actionTargets[parseInt(row.dataset.act, 10)];
  closeOv('ov-actions');
  if (fn) fn();
});
document.getElementById('actions-cancel').addEventListener('click', () => closeOv('ov-actions'));

// The ⋯ button itself: shared markup for posts and comments. `items` is the
// hidden moderation buttons' HTML.
function moreMenuHtml(items) {
  return `<button class="more-btn" data-more title="${esc(_wt('anon.ux.more'))}" aria-label="${esc(_wt('anon.ux.more'))}">⋯</button>`
       + `<span class="post-more-items">${items}</span>`;
}

// Press and hold a post or reply: same sheet as ⋯. Delegated on a container
// that outlives its re-renders. A move of more than a few pixels is a scroll,
// not a press; the click that follows a long press is swallowed so it doesn't
// also open the thread or like the post.
function bindLongPress(container, selector) {
  let timer = null, startX = 0, startY = 0, card = null, fired = false;
  const cancel = () => { clearTimeout(timer); timer = null; if (card) card.classList.remove('pressing'); card = null; };
  container.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return cancel();
    const c = e.target.closest(selector);
    if (!c || e.target.closest('button, a, textarea, input')) return;
    card = c; fired = false;
    startX = e.touches[0].clientX; startY = e.touches[0].clientY;
    timer = setTimeout(() => {
      if (!card) return;
      fired = true;
      const target = card;
      cancel();
      openActions(target);
    }, 480);
    setTimeout(() => { if (timer && card) card.classList.add('pressing'); }, 150);
  }, { passive: true });
  container.addEventListener('touchmove', e => {
    if (!timer) return;
    const t = e.touches[0];
    if (Math.abs(t.clientX - startX) > 8 || Math.abs(t.clientY - startY) > 8) cancel();
  }, { passive: true });
  container.addEventListener('touchend', cancel, { passive: true });
  container.addEventListener('touchcancel', cancel, { passive: true });
  container.addEventListener('click', e => {
    if (fired) { fired = false; e.stopPropagation(); e.preventDefault(); }
  }, true);
  container.addEventListener('contextmenu', e => { if (e.target.closest(selector)) e.preventDefault(); });
}

// Swipe a reply to the right to answer it: the composer gets "@Name " and focus.
function _replyTo(author) {
  const ta = document.getElementById('thread-ta');
  if (!ta || !author) return;
  const tag = '@' + author + ' ';
  if (!ta.value.startsWith(tag)) ta.value = tag + ta.value.replace(/^@\S+\s/, '');
  document.getElementById('thread-send').disabled = !ta.value.trim();
  ta.focus();
  try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) {}
}
function bindSwipeReply(container) {
  let card = null, startX = 0, startY = 0, dx = 0, locked = null;
  const THRESH = 64;
  container.addEventListener('touchstart', e => {
    card = e.target.closest('.comment-card');
    if (!card || e.touches.length !== 1) { card = null; return; }
    startX = e.touches[0].clientX; startY = e.touches[0].clientY; dx = 0; locked = null;
  }, { passive: true });
  container.addEventListener('touchmove', e => {
    if (!card) return;
    const t = e.touches[0];
    const mx = t.clientX - startX, my = t.clientY - startY;
    if (locked === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) {
      locked = (mx > 0 && Math.abs(mx) > Math.abs(my) * 1.5) ? 'x' : 'y';
      if (locked === 'x') card.classList.add('swiping');
    }
    if (locked !== 'x') return;
    const was = dx >= THRESH;
    dx = Math.max(0, Math.min(mx, 90));
    card.style.transform = `translateX(${dx}px)`;
    const ready = dx >= THRESH;
    card.classList.toggle('swipe-ready', ready);
    if (ready && !was) _haptic();
  }, { passive: true });
  const end = () => {
    if (!card) return;
    const c = card; card = null;
    c.classList.remove('swiping', 'swipe-ready');
    c.style.transform = '';
    if (locked === 'x' && dx >= THRESH) {
      const author = c.dataset.author || '';
      if (author && author !== profile.monika) _replyTo(author);
    }
  };
  container.addEventListener('touchend', end, { passive: true });
  container.addEventListener('touchcancel', end, { passive: true });
}

// ─────────────────────────────────────────────────────────────────
// Pull to refresh (feed)
// ─────────────────────────────────────────────────────────────────
// The feed is already live, so a refresh re-opens the listeners — which is
// also what a member means by it when the connection has quietly dropped.
let _ptrDone = null;
function setupPullToRefresh() {
  const list = document.getElementById('post-list');
  const ptr  = document.getElementById('ptr');
  const lbl  = document.getElementById('ptr-label');
  if (!list || !ptr) return;
  const TRIGGER = 64;
  let startY = 0, pulling = false, h = 0, busy = false;
  const setH = v => { h = v; ptr.style.height = v + 'px'; };
  list.addEventListener('touchstart', e => {
    if (busy || list.scrollTop > 0 || e.touches.length !== 1) return;
    startY = e.touches[0].clientY; pulling = true;
    ptr.style.transition = 'none';
  }, { passive: true });
  list.addEventListener('touchmove', e => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0 || list.scrollTop > 0) { setH(0); return; }
    const was = h >= TRIGGER;
    setH(Math.min(dy * 0.5, 90));
    const ready = h >= TRIGGER;
    ptr.classList.toggle('ready', ready);
    lbl.textContent = _wt(ready ? 'anon.ux.releaseRefresh' : 'anon.ux.pullRefresh');
    if (ready && !was) _haptic();
  }, { passive: true });
  const finish = () => {
    ptr.style.transition = 'height 0.2s ease';
    ptr.classList.remove('busy', 'ready');
    setH(0);
    busy = false;
  };
  list.addEventListener('touchend', () => {
    if (!pulling) return;
    pulling = false;
    ptr.style.transition = 'height 0.2s ease';
    if (h < TRIGGER) { setH(0); ptr.classList.remove('ready'); return; }
    busy = true;
    ptr.classList.remove('ready');
    ptr.classList.add('busy');
    lbl.textContent = _wt('anon.ux.refreshing');
    setH(44);
    const timeout = setTimeout(() => { _ptrDone = null; finish(); }, 4000);
    _ptrDone = () => {
      clearTimeout(timeout);
      _ptrDone = null;
      lbl.textContent = _wt('anon.ux.refreshed');
      ptr.classList.remove('busy');
      setTimeout(finish, 500);
    };
    listenPosts({ keep: true });
    listenBanned();
  }, { passive: true });
}

// ─────────────────────────────────────────────────────────────────
// Polls and the daily mood check-in
// ─────────────────────────────────────────────────────────────────
// Both write through callables in functions/index.js (createAnonPoll,
// voteAnonPoll, anonMoodCheckin), so no Firestore rules change is involved.
// As with 💛, only totals live on the server: how this device voted is
// remembered here in localStorage.
async function _callFn(name, data) {
  if (typeof firebase === 'undefined' || !firebase.app) throw new Error('offline');
  await _ensureAuthSession();
  const res = await firebase.app().functions('europe-west1').httpsCallable(name)(data || {});
  return res.data || {};
}

// The gentle reactions (🫂 🙋 💪) were withdrawn on 30 Sep 2026 — 💛 is the
// one reaction. reactAnonPost stays deployed so an older cached client fails
// quietly, and any counts already on posts are simply no longer drawn.
function _loadMap(key) {
  try { const o = JSON.parse(BB.storage.get(key) || '{}'); return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}; }
  catch (e) { return {}; }
}
const votedPolls   = _loadMap('Anon_votes');     // postId → option index
function _saveMap(key, obj) { try { BB.storage.set(key, JSON.stringify(obj)); } catch (e) {} }
try { BB.storage.remove('Anon_reacted'); } catch (e) {}

function _repaintCard(id) {
  const card = document.querySelector(`#post-list .post-card[data-pid="${CSS.escape(id)}"]`);
  const p = _findPost(id);
  if (!card || !p) return;
  const poll = card.querySelector('.poll');
  if (poll) poll.outerHTML = pollHtml(p);
}

// A poll under the post text. Before you vote: plain option buttons. After:
// bars with percentages, your pick ticked, and still tappable to change it.
// `readonly` for the copy in the thread header.
function pollHtml(p, readonly) {
  const poll = p && p.poll;
  if (!poll || !Array.isArray(poll.options) || poll.options.length < 2) return '';
  const votes = poll.options.map((_, i) => Math.max(0, num((poll.votes || [])[i], 0)));
  const total = votes.reduce((a, b) => a + b, 0);
  const mine  = Object.prototype.hasOwnProperty.call(votedPolls, p.id) ? votedPolls[p.id] : null;
  const showResults = mine !== null || readonly;
  const rows = poll.options.map((o, i) => {
    const pct = total ? Math.round(votes[i] * 100 / total) : 0;
    const attrs = readonly ? ' disabled' : ` data-vote="${i}" data-pid="${esc(p.id)}"`;
    return `<button class="poll-opt${showResults ? ' voted' : ''}${mine === i ? ' mine' : ''}"${attrs}>`
      + (showResults ? `<span class="poll-fill" style="width:${pct}%"></span>` : '')
      + `<span class="poll-label">${mine === i ? '✓ ' : ''}${esc(o)}</span>`
      + (showResults ? `<span class="poll-pct">${pct}%</span>` : '')
      + `</button>`;
  }).join('');
  const count = total === 1 ? _wt('anon.ux.votesOne') : _wt('anon.ux.votesMany', { n: total });
  return `<div class="poll"><div class="poll-tag">📊 ${esc(_wt('anon.ux.pollTag'))} · ${esc(count)}</div>${rows}</div>`;
}
async function votePoll(id, option) {
  const p = _findPost(id);
  if (!p || !p.poll || !_isThreadable(p)) return;
  const had  = Object.prototype.hasOwnProperty.call(votedPolls, id);
  const from = had ? votedPolls[id] : null;
  if (from === option) return;
  const before = (p.poll.votes || []).slice();
  const v = p.poll.options.map((_, i) => Math.max(0, num(before[i], 0)));
  if (from !== null && v[from] > 0) v[from] -= 1;
  v[option] += 1;
  p.poll = Object.assign({}, p.poll, { votes: v });
  votedPolls[id] = option;
  _saveMap('Anon_votes', votedPolls);
  _haptic();
  _repaintCard(id);
  try {
    const res = await _callFn('voteAnonPoll', { postId: id, option, from });
    if (Array.isArray(res.votes)) p.poll = Object.assign({}, p.poll, { votes: res.votes });
  } catch (e) {
    console.warn('[Anonymous] vote failed', e);
    p.poll = Object.assign({}, p.poll, { votes: before });
    if (had) votedPolls[id] = from; else delete votedPolls[id];
    _saveMap('Anon_votes', votedPolls);
    showHint(_wt('anon.ux.voteFailed'));
  }
  _repaintCard(id);
}

// The daily check-in on the greeting card. One tap, once a day; afterwards the
// card shows how the board as a whole is doing. Only totals are stored.
// The five moods are Bipolar Bear's own (same names, bears and colours as the
// journal), so a member with a linked Bipolar Bear account is checked in by
// their journal entry — see _journalCheckin() here and _anonJournalCheckin()
// in js/journal.js. Hidden entirely with Your Moniker → "How are you today?".
const MOODS = [
  { k: 'manic',     key: 'mood.manic',     c: '#ff6b6b' },
  { k: 'elevated',  key: 'mood.elevated',  c: '#d2be00' },
  { k: 'stable',    key: 'mood.stable',    c: '#51cf66' },
  { k: 'low',       key: 'mood.low',       c: '#845ef7' },
  { k: 'depressed', key: 'mood.depressed', c: '#5c7cfa' },
];
const _moodImg = (k, cls) => `<img class="${cls || 'mb-img'}" src="images/moods/sm/${k}.png" alt="" draggable="false">`;
const _moodState = { ready: false, failed: false, counts: null, checkedIn: false, via: null, day: '', showAll: false, flashAt: 0 };
// How long "✓ Checked in" stays beside the heading after a tap (it fades out).
const MOOD_FLASH_MS = 3500;
function _ukDay() {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date()); }
  catch (e) { return new Date().toISOString().slice(0, 10); }
}
function _myMood() {
  try {
    const m = JSON.parse(BB.storage.get('Anon_mood') || 'null');
    return m && m.day === _ukDay() && MOODS.some(x => x.k === m.mood) ? m.mood : null;
  } catch (e) { return null; }
}
// Settings (Your Moniker sheet). Both default ON; stored as '0' when off.
function _moodAskShown()     { return BB.storage.get('Anon_moodAsk') !== '0'; }
function _journalCheckinOn() { return BB.storage.get('Anon_journalCheckin') !== '0'; }
// Holds the check-in's place on the greeting card while anonMoodCheckin
// answers, so the feed under it doesn't jump when the answer lands (James,
// 2026-09-30). It takes the shape the answer will probably have: the tally
// when this device already knows today's mood (board or journal), otherwise
// the five bears, dimmed and not yet tappable.
function moodPlaceholderHtml() {
  const known = _myMood() || _journalMoodForToday();
  if (!known) {
    return `<div class="mood-block mood-loading" aria-busy="true"><div class="mood-ask">${esc(_wt('anon.ux.moodAsk'))}</div><div class="mood-btns">`
      + MOODS.map(m => `<button class="mood-btn" disabled tabindex="-1" style="--mc:${m.c}">${_moodImg(m.k)}<span class="mb-l">${esc(_wt(m.key))}</span></button>`).join('')
      + `</div><div class="mood-note">${esc(_wt('anon.ux.moodPrivate'))}</div></div>`;
  }
  return `<div class="mood-block mood-loading" aria-busy="true"><div class="mood-ask">${esc(_wt('anon.ux.moodToday'))}</div>`
    + `<div class="mood-same">${_moodImg(known, 'ms-img')}<span></span></div>`
    + `<button class="mood-all" disabled tabindex="-1">${esc(_wt('anon.ux.moodSeeAll'))}</button>`
    + `</div>`;
}
// After checking in, the card leads with how many others picked the same mood,
// not a tally to measure yourself against. A member said the bar made them
// feel everyone else was doing better than them (2026-10-01) — and the people
// at their lowest are the least likely to check in, so the bar flatters the
// day. The whole board is one tap away (closed again on every visit), and
// "You: Depressed" no longer sits under it.
function _moodSameHtml(k, counts) {
  const m = MOODS.find(x => x.k === k);
  const others = Math.max(0, num(counts[k], 0) - 1);
  const MARK = '%MOOD%';
  const line = others
    ? esc(_wt('anon.ux.moodSame', { count: others, mood: MARK })) + ' ' + esc(_wt('anon.ux.moodNotAlone'))
    : esc(_wt('anon.ux.moodSameNone', { mood: MARK }));
  return `<div class="mood-same">${_moodImg(k, 'ms-img')}<span>${line.replace(MARK, `<b>${esc(_wt(m.key))}</b>`)}</span></div>`;
}
function moodBlockHtml() {
  if (!_moodAskShown() || _moodState.failed) return '<div class="mood-block"></div>';
  if (!_moodState.ready) return moodPlaceholderHtml();
  const mine = _myMood();
  if (!_moodState.checkedIn && !mine) {
    return `<div class="mood-block"><div class="mood-ask">${esc(_wt('anon.ux.moodAsk'))}</div><div class="mood-btns">`
      + MOODS.map(m => `<button class="mood-btn" data-mood="${m.k}" style="--mc:${m.c}">${_moodImg(m.k)}<span class="mb-l">${esc(_wt(m.key))}</span></button>`).join('')
      + `</div><div class="mood-note">${esc(_wt('anon.ux.moodPrivate'))}</div></div>`;
  }
  const counts = _moodState.counts || {};
  const total  = MOODS.reduce((n, m) => n + num(counts[m.k], 0), 0);
  const bar = total ? MOODS.map(m => {
    const n = num(counts[m.k], 0);
    return n ? `<span style="flex:${n};background:${m.c}" title="${esc(_wt(m.key))}: ${n}"></span>` : '';
  }).join('') : '';
  const legend = MOODS.map(m => `<span class="ml-i" title="${esc(_wt(m.key))}">${_moodImg(m.k, 'ml-img')}<b>${num(counts[m.k], 0)}</b></span>`).join('');
  const countLabel = total === 1 ? _wt('anon.ux.moodOne') : _wt('anon.ux.moodCount', { n: total });
  // A negative delay picks the fade up where it was, so a feed re-render
  // mid-fade doesn't restart it.
  const since = Date.now() - _moodState.flashAt;
  const flash = since < MOOD_FLASH_MS
    ? `<span class="mood-flash" style="animation-delay:-${since}ms">${esc(_wt('anon.ux.moodCheckedIn'))}</span>` : '';
  const open = _moodState.showAll;
  return `<div class="mood-block"><div class="mood-ask"><span>${esc(_wt('anon.ux.moodToday'))} · ${esc(countLabel)}</span>${flash}</div>`
    + (mine ? _moodSameHtml(mine, counts) : '')
    + (open && bar ? `<div class="mood-bar">${bar}</div>` : '')
    + (open ? `<div class="mood-legend">${legend}</div>` : '')
    + (_moodState.via === 'journal' ? `<div class="mood-note">✓ ${esc(_wt('anon.ux.moodViaJournal'))}</div>` : '')
    + `<button class="mood-all" data-mood-all aria-expanded="${open}">${esc(_wt(open ? 'anon.ux.moodHideAll' : 'anon.ux.moodSeeAll'))}</button>`
    + `</div>`;
}
function _repaintMood() {
  const el = document.querySelector('#post-list .sys-card .mood-block');
  if (el) el.outerHTML = moodBlockHtml();
}
// The main app's journal leaves bb_recentMoods ({"YYYY-MM-DD": mood}) on this
// device after it loads your entries (never while a PIN or incognito is on).
// Used when the board is opened inside Bipolar Bear itself, so an entry saved
// before the journal learned to check in still counts. The separate Bipolar
// Anonymous app has no journal on the device — there the journal's own save
// (js/journal.js) is what checks in.
function _journalMoodForToday() {
  if (!_bbUser || !_journalCheckinOn()) return null;
  try {
    const map = JSON.parse(BB.storage.get('_recentMoods') || 'null');
    if (!map || typeof map !== 'object') return null;
    const d = new Date(); const key = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    const today = key(d); d.setDate(d.getDate() - 1); const yday = key(d);
    const m = map[today] || map[yday];
    const cat = m === 'good' ? 'stable' : m;
    return MOODS.some(x => x.k === cat) ? cat : null;
  } catch (e) { return null; }
}
async function loadMood() {
  if (!_moodAskShown()) return;
  try {
    // Capped, so a slow callable (the SDK waits up to 70s) can't leave the
    // placeholder pulsing — the card falls back to a plain greeting.
    let res = await Promise.race([
      _callFn('anonMoodCheckin', {}),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000)),
    ]);
    const jm = !res.checkedIn && !_myMood() ? _journalMoodForToday() : null;
    if (jm) {
      res = await _callFn('anonMoodCheckin', { mood: jm, source: 'journal' });
      if (res.via === 'journal') { try { BB.storage.set('Anon_mood', JSON.stringify({ day: _ukDay(), mood: jm })); } catch (e) {} }
    }
    Object.assign(_moodState, { ready: true, failed: false, counts: res.counts || {}, checkedIn: !!res.checkedIn, via: res.via || null, day: res.day || '' });
  } catch (e) {
    // Offline or the function isn't there: the card just stays a greeting
    // (the placeholder goes).
    _moodState.failed = true;
    _repaintMood();
    return;
  }
  _repaintMood();
}
async function checkInMood(kind) {
  if (!MOODS.some(m => m.k === kind) || _myMood()) return;
  const prev = Object.assign({}, _moodState);
  try { BB.storage.set('Anon_mood', JSON.stringify({ day: _ukDay(), mood: kind })); } catch (e) {}
  const counts = Object.assign({}, _moodState.counts);
  counts[kind] = num(counts[kind], 0) + 1;
  Object.assign(_moodState, { counts, checkedIn: true, via: 'board', flashAt: Date.now() });
  _haptic('success');
  _repaintMood();
  try {
    const res = await _callFn('anonMoodCheckin', { mood: kind });
    Object.assign(_moodState, { counts: res.counts || counts, checkedIn: true, via: res.via || 'board', day: res.day || '' });
  } catch (e) {
    console.warn('[Anonymous] mood check-in failed', e);
    BB.storage.remove('Anon_mood');
    Object.assign(_moodState, prev);
    showHint(_wt('anon.ux.moodFailed'));
  }
  _repaintMood();
}

// One delegated listener on the feed for all three (the feed re-renders on
// every snapshot, so per-button binding would be rewired constantly).
function setupInteractions() {
  const list = document.getElementById('post-list');
  if (!list) return;
  list.addEventListener('click', e => {
    const v = e.target.closest('[data-vote]');
    if (v) { votePoll(v.dataset.pid, parseInt(v.dataset.vote, 10)); return; }
    const m = e.target.closest('[data-mood]');
    if (m) { checkInMood(m.dataset.mood); return; }
    if (e.target.closest('[data-mood-all]')) {
      _moodState.showAll = !_moodState.showAll;
      _repaintMood();
      // The repaint replaces the button, so keep keyboard focus on it.
      const b = document.querySelector('#post-list .sys-card [data-mood-all]');
      if (b) b.focus({ preventScroll: true });
    }
  });
}

// ─────────────────────────────────────────────────────────────────
// SCREEN: Agree to terms (BipolarBear-app path only)
// ─────────────────────────────────────────────────────────────────
/**
 * Guideline 1.2 gate for users who arrive already signed in to BipolarBear
 * and therefore never see the verify screen's terms checkbox. Records the
 * agreement locally and (best-effort) in userSettings/{uid}.anonProfile so
 * it survives a reinstall, then continues to the board or monika picker.
 */
let _agreeWired = false;
function setupAgree() {
  const chk  = document.getElementById('agree-terms-bb');
  const btn  = document.getElementById('agree-continue-btn');
  if (!chk || !btn) return;
  chk.checked  = false;
  btn.disabled = true;
  if (_agreeWired) return;
  _agreeWired = true;

  chk.addEventListener('change', () => { btn.disabled = !chk.checked; });

  btn.addEventListener('click', async () => {
    if (!chk.checked) return;
    btn.disabled = true;
    BB.storage.set('Anon_agreedTerms', 'true');
    BB.storage.set('Anon_agreedTermsAt', new Date().toISOString());
    // Best-effort cross-device mirror — never block entry on a failed write.
    if (db && _bbUser) {
      try {
        await db.collection('userSettings').doc(_bbUser.uid).set(
          { anonProfile: { termsAccepted: true } }, { merge: true }
        );
      } catch (_) { /* local flag is enough for this session */ }
    }
    if (profile.monika) {
      showScreen('board');
      initBoard();
    } else {
      showScreen('monika');
      setupMonika();
    }
  });
}

// ─────────────────────────────────────────────────────────────────
// SCREEN: Verify
// ─────────────────────────────────────────────────────────────────
function setupVerify() {
  const emailIn   = document.getElementById('email-input');
  const sendBtn   = document.getElementById('send-code-btn');
  const verifyBtn = document.getElementById('verify-btn');
  const boxes     = document.querySelectorAll('.code-box');
  const errDiv    = document.getElementById('verify-error');
  const agreeChk  = document.getElementById('agree-terms');
  let   _pendingEmail = '';
  let   _sessionId    = null;

  function showError(msg) {
    errDiv.textContent   = msg;
    errDiv.style.display = 'block';
  }
  function clearError() {
    errDiv.style.display = 'none';
    errDiv.textContent   = '';
  }

  function _validateEmail() {
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailIn.value.trim());
    // Guideline 1.2: can't request a code until the terms checkbox is ticked.
    const agreed  = !agreeChk || agreeChk.checked;
    sendBtn.disabled = !(emailOk && agreed);
    emailIn.classList.toggle('valid', emailOk);
  }

  // Ensure email field is editable and wired for validation
  emailIn.readOnly    = false;
  emailIn.placeholder = 'your@email.com';
  emailIn.style.background = '';
  emailIn.style.color      = '';
  emailIn.style.cursor     = '';

  // Pre-fill the BipolarBear account email when the user is signed in via
  // the main app — saves typing and lets us link the verified anon email
  // back to their user account afterwards. Editable: they may want to use
  // a different inbox.
  if (!emailIn.value && _bbUser && _bbUser.email) {
    emailIn.value = _bbUser.email;
  }

  emailIn.addEventListener('input',   _validateEmail);
  emailIn.addEventListener('keydown', e => { if (e.key === 'Enter' && !sendBtn.disabled) sendBtn.click(); });
  if (agreeChk) {
    // Re-check the box if the user already agreed earlier this session.
    agreeChk.checked = BB.storage.get('Anon_agreedTerms') === 'true';
    agreeChk.onchange = _validateEmail;
  }

  // Run once so button state matches whatever is already in the field
  _validateEmail();

  function getCode() { return Array.from(boxes).map(b => b.value).join(''); }

  function resetBoxes() {
    boxes.forEach(b => { b.value = ''; b.classList.remove('filled'); });
    verifyBtn.disabled = true;
  }

  function goToEmailStep() {
    clearError();
    resetBoxes();
    _sessionId = null;
    document.getElementById('step-code').style.display  = 'none';
    document.getElementById('step-email').style.display = 'block';
    emailIn.focus();
  }

  async function doSend(email) {
    if (profile.verified) return;
    clearError();
    sendBtn.disabled = true;
    const origText = sendBtn.textContent;
    sendBtn.textContent = _wt('anon.ui.sending');
    try {
      // Reviewer bypass: skip the email round-trip for the demo address and go
      // straight to the code step (the fixed REVIEW_CODE is checked on verify).
      if (email.toLowerCase() === REVIEW_EMAIL) {
        _sessionId    = 'review-bypass';
        _pendingEmail = email;
        document.getElementById('step-email').style.display = 'none';
        document.getElementById('step-code').style.display  = 'block';
        document.getElementById('code-sent-label').textContent =
          _wt('anon.verifyMsg.demoCode');
        resetBoxes();
        boxes[0].focus();
        return;
      }
      if (!window._anonSendCode) {
        throw new Error(_wt('anon.verifyMsg.serviceUnavailable'));
      }
      // Sign in first: verifyAnonCode links the verified address to this
      // session, which is what lets it read and save the profile below.
      await _ensureAuthSession();
      const result = await window._anonSendCode({ email });
      _sessionId    = result.data.sessionId;
      _pendingEmail = email;
      document.getElementById('step-email').style.display = 'none';
      document.getElementById('step-code').style.display  = 'block';
      document.getElementById('code-sent-label').innerHTML =
        _wt('anon.verifyMsg.codeSent', { email: `<strong>${esc(email)}</strong>` });
      resetBoxes();
      boxes[0].focus();
    } catch (err) {
      sendBtn.disabled    = false;
      sendBtn.textContent = origText;
      const errCode = err.code || '';
      if (errCode === 'functions/resource-exhausted') {
        showError(_wt('anon.verifyMsg.tooManyRequests'));
      } else if (errCode === 'functions/invalid-argument') {
        showError(_wt('anon.verifyMsg.invalidEmail'));
      } else {
        showError(err.message || _wt('anon.verifyMsg.couldNotSend'));
      }
    }
  }

  sendBtn.onclick = () => doSend(emailIn.value.trim());

  // Code box navigation + input
  boxes.forEach((box, i) => {
    box.addEventListener('input', e => {
      const v = e.target.value.replace(/\D/g, '');
      box.value = v ? v[0] : '';
      box.classList.toggle('filled', !!box.value);
      if (box.value && boxes[i + 1]) boxes[i + 1].focus();
      verifyBtn.disabled = getCode().length < boxes.length;
      clearError();
    });
    box.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !box.value && boxes[i - 1]) {
        boxes[i - 1].focus();
        boxes[i - 1].value = '';
        boxes[i - 1].classList.remove('filled');
        verifyBtn.disabled = true;
      }
    });
    // Paste the full code at once
    box.addEventListener('paste', e => {
      e.preventDefault();
      const digits = (e.clipboardData || window.clipboardData)
        .getData('text').replace(/\D/g, '').slice(0, boxes.length);
      if (!digits) return;
      boxes.forEach((b, j) => {
        b.value = digits[j] || '';
        b.classList.toggle('filled', !!b.value);
      });
      const nextIdx = Math.min(digits.length, boxes.length - 1);
      boxes[nextIdx].focus();
      verifyBtn.disabled = getCode().length < boxes.length;
    });
  });

  verifyBtn.addEventListener('click', async () => {
    const code = getCode();
    if (code.length < boxes.length || !_sessionId) return;
    clearError();
    verifyBtn.disabled  = true;
    const origText = verifyBtn.textContent;
    verifyBtn.textContent = _wt('anon.ui.verifying');
    try {
      if (_pendingEmail.toLowerCase() === REVIEW_EMAIL) {
        // Reviewer bypass: validate the fixed demo code locally, then make sure
        // an anonymous auth session exists so the reviewer can post and comment.
        if (code !== REVIEW_CODE) throw new Error(_wt('anon.verifyMsg.incorrectDemo'));
        await _ensureAuthSession();
      } else {
        await _ensureAuthSession();
        await window._anonVerifyCode({ sessionId: _sessionId, code });
      }
      // ✅ Verified
      if (_pendingEmail.toLowerCase() === ADMIN_EMAIL) {
        BB.storage.set('Anon_isAdmin', 'true');
      }
      BB.storage.set('Anon_verified', 'true');
      BB.storage.set('Anon_email', _pendingEmail);
      // Record acceptance of the terms / zero-tolerance policy (guideline 1.2).
      BB.storage.set('Anon_agreedTerms', 'true');
      BB.storage.set('Anon_agreedTermsAt', new Date().toISOString());

      // If the user is signed in via the BipolarBear app, link the verified
      // anon email to their user account so it can be used for future
      // recovery / cross-device restore, then pull any existing anon profile
      // they've already set up against this account (uid lookup beats
      // email-hash lookup).
      if (_bbUser && db) {
        db.collection('userSettings').doc(_bbUser.uid)
          .set({ anonEmail: _pendingEmail }, { merge: true }).catch(() => {});
        await _bbRestoreProfile(_bbUser.uid);
      }
      // Standalone path: email-hash lookup. _anonRestoreProfile no-ops when
      // _bbUser is set, so safe to call unconditionally.
      const _restored = await _anonRestoreProfile(_pendingEmail);

      // If the verified email belongs to a BipolarBear account, pull the
      // stability streak and account creation date so they show up on the
      // anonymous board even if the user has never visited while logged into BB.
      // Only fills gaps — never overwrites data already restored above.
      if (!_bbUser && window._anonGetBBStats) {
        try {
          const bbRes = await window._anonGetBBStats({ sessionId: _sessionId });
          if (bbRes.data && bbRes.data.bbLinked) {
            const { stableStreak, stableSince, accountCreatedAt } = bbRes.data;
            if (stableSince && !BB.storage.get('Anon_stableSince')) {
              BB.storage.set('Anon_stableSince', stableSince);
              const days = Math.max(0, Math.floor(
                (Date.now() - new Date(stableSince).getTime()) / 86400000
              ));
              BB.storage.set('Anon_stableStreak', String(stableStreak || days));
              // First-time BB stats pull — auto-show the badge so it's visible
              BB.storage.set('Anon_showStable', 'true');
            }
            if (accountCreatedAt) {
              const existing = BB.storage.get('Anon_joinedAt');
              if (!existing || accountCreatedAt < existing) {
                BB.storage.set('Anon_joinedAt', accountCreatedAt);
              }
            }
          }
        } catch (_) { /* best-effort — BB stats are supplemental */ }
      }

      if (profile.monika || _restored) {
        showScreen('board');
        initBoard();
      } else {
        showScreen('monika');
        setupMonika();
      }
    } catch (err) {
      verifyBtn.disabled  = false;
      verifyBtn.textContent = origText;
      const errCode = err.code || '';
      if (errCode === 'functions/unauthenticated') {
        // Wrong code — message already includes "X attempts remaining"
        showError(err.message || _wt('anon.verifyMsg.incorrectCode'));
        resetBoxes();
        boxes[0].focus();
      } else if (errCode === 'functions/deadline-exceeded') {
        showError(_wt('anon.verifyMsg.codeExpired'));
        resetBoxes();
        setTimeout(() => doSend(_pendingEmail), 1200);
      } else if (errCode === 'functions/resource-exhausted') {
        showError(_wt('anon.verifyMsg.tooManyAttempts'));
        goToEmailStep();
      } else if (errCode === 'functions/not-found') {
        showError(_wt('anon.verifyMsg.sessionNotFound'));
        goToEmailStep();
      } else {
        showError(err.message || _wt('anon.verifyMsg.verifyFailed'));
        resetBoxes();
        boxes[0].focus();
      }
    }
  });

  // Resend code
  document.getElementById('resend-btn').addEventListener('click', () => {
    if (!_pendingEmail) { goToEmailStep(); return; }
    resetBoxes();
    clearError();
    doSend(_pendingEmail);
  });

  // Back to email step
  document.getElementById('back-to-email-btn').addEventListener('click', goToEmailStep);
}

// ─────────────────────────────────────────────────────────────────
// SCREEN: Monika
// ─────────────────────────────────────────────────────────────────
async function isMonikaInUse(monika, ownMonika) {
  if (!db) return false;
  if (ownMonika && monika.toLowerCase() === ownMonika.toLowerCase()) return false;
  const doc = await db.collection(BB_BRAND.collections.monikas).doc(monika.toLowerCase()).get();
  return doc.exists;
}

function setupMonika() {
  const input   = document.getElementById('monika-input');
  const counter = document.getElementById('monika-counter');
  const preview = document.getElementById('monika-preview');
  const av      = document.getElementById('monika-av');
  const pvName  = document.getElementById('monika-preview-name');
  const btn     = document.getElementById('monika-btn');
  const streak  = profile.streak;

  input.addEventListener('input', () => {
    const v = input.value.slice(0, 10);
    input.value = v;
    counter.textContent  = `${v.length}/10`;
    counter.style.color  = v.length >= 8 ? '#e55' : 'var(--muted)';
    input.classList.toggle('valid', v.length >= 2);
    btn.disabled = v.length < 2;
    if (v.length >= 2) {
      av.textContent    = initials(v);
      pvName.textContent = `[${v}] 🔥 ${streak}d`;
      preview.classList.add('show');
    } else {
      preview.classList.remove('show');
    }
  });

  btn.addEventListener('click', async () => {
    const monika = input.value.trim();
    if (monika.length < 2) return;
    const errEl = document.getElementById('monika-error');
    btn.disabled = true;
    btn.textContent = _wt('anon.ui.checking');
    try {
      if (await isMonikaInUse(monika, null)) {
        errEl.textContent  = _wt('anon.ui.nameTaken');
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = _wt('anon.monika.btn');
        return;
      }
    } catch (e) { /* network error — allow through */ }
    errEl.style.display = 'none';
    BB.storage.set('Anon_monika', monika);
    if (db) {
      _ensureAuthSession()
        .then(() => db.collection(BB_BRAND.collections.monikas).doc(monika.toLowerCase())
          .set(_withOwner({ monika, createdAt: firebase.firestore.FieldValue.serverTimestamp() })))
        .catch(() => {});
    }
    _bbSaveProfile(); // persist monika to userSettings for cross-device recovery
    showScreen('meds');
    setupMeds();
  });
}

// ─────────────────────────────────────────────────────────────────
// SCREEN: Medication visibility
// ─────────────────────────────────────────────────────────────────
function setupMeds() {
  document.getElementById('meds-yes').onclick = async () => {
    BB.storage.set('Anon_showMeds', 'true');
    // For BB App users, pre-populate med list from their Firestore data
    if (_bbUser && db) {
      try {
        const snap = await db.collection('userSettings').doc(_bbUser.uid).get();
        if (snap.exists) {
          const list = snap.data().currentMedList || [];
          if (list.length > 0) {
            BB.storage.set('Anon_medList', JSON.stringify(list));
            BB.storage.set('Anon_med', list.map(m => m.name).filter(Boolean).join(', '));
          }
        }
      } catch(e) { /* silently fail — user can add manually */ }
    }
    showScreen('med-define');
    setupMedDefine(() => { showScreen('board'); initBoard(); });
  };
  document.getElementById('meds-no').onclick = () => {
    BB.storage.set('Anon_showMeds', 'false');
    showScreen('board');
    initBoard();
  };
}

// ─────────────────────────────────────────────────────────────────
// Med helpers
// ─────────────────────────────────────────────────────────────────
function _anonGetMedList() {
  try {
    const s = BB.storage.get('Anon_medList');
    if (s) return JSON.parse(s);
    const m = BB.storage.get('Anon_med');
    return m ? [{ name: m, dosage: '' }] : [];
  } catch(e) { return []; }
}

async function _anonSaveMedList(list) {
  BB.storage.set('Anon_medList', JSON.stringify(list));
  const medStr = list.map(m => m.name).filter(Boolean).join(', ');
  BB.storage.set('Anon_med', medStr);
  // Sync back to BB App if the user is signed into BipolarBear
  if (_bbUser && db) {
    try {
      await db.collection('userSettings').doc(_bbUser.uid).set(
        { currentMedList: list }, { merge: true }
      );
    } catch(e) { console.warn('[Anonymous] medList sync failed', e); }
  }
}

// ─────────────────────────────────────────────────────────────────
// Standalone profile persistence (Firestore, keyed by email hash)
// ─────────────────────────────────────────────────────────────────

// SHA-256 of email — never the raw address, so it's not directly linkable
async function _anonEmailHash(email) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(email.toLowerCase().trim()));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Write current profile to anonProfiles/{hash}. No-op for BB users (they use userSettings).
async function _anonSaveProfile() {
  if (!db || _bbUser) return;
  const email = BB.storage.get('Anon_email');
  if (!email) return;
  try {
    const hash = await _anonEmailHash(email);
    await db.collection('anonProfiles').doc(hash).set({
      monika:       profile.monika      || null,
      colorKey:     profile.colorKey    || 'orange',
      customInit:   profile.customInit  || '',
      showMeds:     profile.showMeds,
      medList:      _anonGetMedList(),
      showStable:   profile.showStable,
      stableSince:  profile.stableSince || null,
      stableStreak: profile.stableStreak,
      visitStreak:  parseInt(BB.storage.get('Anon_streak') || '0', 10),
      visitDate:    BB.storage.get('AnonVisitDate') || null,
      joinedAt:     profile.joinedAt    || null,
      updatedAt:    firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch(e) { console.warn('[Anonymous] profile save failed', e); }
}

// Read profile from Firestore and restore localStorage. Returns true if a monika was found.
async function _anonRestoreProfile(email) {
  if (!db) return false;
  try {
    const hash = await _anonEmailHash(email);
    const doc  = await db.collection('anonProfiles').doc(hash).get();
    if (!doc.exists) return false;
    const d = doc.data();
    if (d.monika)              BB.storage.set('Anon_monika',   d.monika);
    if (d.colorKey)            BB.storage.set('Anon_colorKey', d.colorKey);
    if (d.customInit !== undefined) BB.storage.set('Anon_initials', d.customInit || '');
    if (d.showMeds   !== undefined) BB.storage.set('Anon_showMeds', d.showMeds ? 'true' : 'false');
    if (d.medList && d.medList.length > 0) {
      BB.storage.set('Anon_medList', JSON.stringify(d.medList));
      BB.storage.set('Anon_med', d.medList.map(m => m.name).filter(Boolean).join(', '));
    }
    if (d.showStable !== undefined) BB.storage.set('Anon_showStable', d.showStable ? 'true' : 'false');
    if (d.stableSince) {
      BB.storage.set('Anon_stableSince', d.stableSince);
      // Recompute days since (it grows each day automatically)
      const days = Math.max(0, Math.floor((Date.now() - new Date(d.stableSince).getTime()) / 86400000));
      BB.storage.set('Anon_stableStreak', String(days));
    }
    if (typeof d.visitStreak === 'number') BB.storage.set('Anon_streak',  String(d.visitStreak));
    if (d.visitDate)                       BB.storage.set('AnonVisitDate', d.visitDate);
    if (d.joinedAt)                        BB.storage.set('Anon_joinedAt', d.joinedAt);
    return !!d.monika;
  } catch(e) {
    console.warn('[Anonymous] profile restore failed', e);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────
// BB App user profile persistence (userSettings/{uid}.anonProfile)
// ─────────────────────────────────────────────────────────────────

// Restore monika + settings from userSettings into localStorage. Called on boot before screen routing.
async function _bbRestoreProfile(uid) {
  if (!db || !uid) return;
  try {
    const doc = await db.collection('userSettings').doc(uid).get();
    const d   = doc.exists ? doc.data() : {};
    // Stable streak is computed by journal.html and stored flat
    if (typeof d.stableStreak === 'number') {
      BB.storage.set('Anon_stableStreak', String(d.stableStreak));
    }
    // Anon board profile is nested under anonProfile
    let ap = d.anonProfile || {};
    // Fallback: if this BB account has never been used to set up an anon
    // profile but the same email already verified on bipolaranonymous.app
    // (standalone path), pull the existing monika+settings from
    // anonProfiles/{hash(email)} so the user doesn't get prompted to pick a
    // second monika. We then copy it into userSettings/{uid}.anonProfile so
    // future sessions take the fast path.
    if (!ap.monika && _bbUser && _bbUser.email) {
      try {
        const hash    = await _anonEmailHash(_bbUser.email);
        const anonDoc = await db.collection('anonProfiles').doc(hash).get();
        if (anonDoc.exists && anonDoc.data().monika) {
          ap = anonDoc.data();
          db.collection('userSettings').doc(uid).set(
            { anonProfile: ap }, { merge: true }
          ).catch(() => {});
        }
      } catch (_) { /* best-effort */ }
    }
    if (ap.monika)                   BB.storage.set('Anon_monika',      ap.monika);
    // Guideline 1.2 agreement — restore so a returning or reinstalled user
    // isn't asked twice. Deliberately NOT inferred from an existing monika:
    // BB-app users who joined before this gate shipped never saw the terms,
    // so they must accept once, exactly as a new user does.
    if (ap.termsAccepted) BB.storage.set('Anon_agreedTerms', 'true');
    if (ap.journalCheckin !== undefined) BB.storage.set('Anon_journalCheckin', ap.journalCheckin ? '1' : '0');
    if (ap.colorKey)                 BB.storage.set('Anon_colorKey',    ap.colorKey);
    if (ap.customInit !== undefined) BB.storage.set('Anon_initials',    ap.customInit || '');
    if (ap.showMeds   !== undefined) BB.storage.set('Anon_showMeds',    ap.showMeds   ? 'true' : 'false');
    if (ap.showStable !== undefined) {
      BB.storage.set('Anon_showStable', ap.showStable ? 'true' : 'false');
    } else if (typeof d.stableStreak === 'number' && d.stableStreak > 0 && !BB.storage.get('Anon_showStable')) {
      // Not yet configured via anon board — auto-show since BB account has a streak
      BB.storage.set('Anon_showStable', 'true');
    }
    // Fall back to the journal-computed stableStreakStart when the anon profile
    // hasn't stored its own stableSince yet (e.g. first visit to the board).
    const resolvedStableSince = ap.stableSince || d.stableStreakStart || null;
    if (resolvedStableSince) BB.storage.set('Anon_stableSince', resolvedStableSince);
    const medList = ap.medList && ap.medList.length ? ap.medList : (d.currentMedList || []);
    if (medList.length) {
      BB.storage.set('Anon_medList', JSON.stringify(medList));
      BB.storage.set('Anon_med', medList.map(m => m.name).filter(Boolean).join(', '));
    }
    if (typeof ap.visitStreak === 'number') BB.storage.set('Anon_streak',     String(ap.visitStreak));
    if (ap.visitDate)                       BB.storage.set('AnonVisitDate',    ap.visitDate);
    // Use the earliest of anonProfile.joinedAt and the BB account creation date
    // so the birthday always reflects when the user first joined BipolarBear.
    let resolvedJoinedAt = ap.joinedAt || null;
    if (_bbUser && _bbUser.metadata && _bbUser.metadata.creationTime) {
      const creationISO = new Date(_bbUser.metadata.creationTime).toISOString();
      if (!resolvedJoinedAt || creationISO < resolvedJoinedAt) resolvedJoinedAt = creationISO;
    }
    if (resolvedJoinedAt)  BB.storage.set('Anon_joinedAt', resolvedJoinedAt);
    // Mirror restored profile to anonProfiles so standalone email-code path
    // can restore it on a fresh browser/device without needing Firebase Auth.
    if (ap.monika && _bbUser && _bbUser.email) {
      _anonEmailHash(_bbUser.email).then(hash =>
        db.collection('anonProfiles').doc(hash).set({
          monika:      ap.monika,
          colorKey:    ap.colorKey    || 'orange',
          customInit:  ap.customInit  || '',
          showMeds:    !!ap.showMeds,
          medList:     medList,
          showStable:  !!ap.showStable,
          stableSince: resolvedStableSince,
          visitStreak: ap.visitStreak || 0,
          visitDate:   ap.visitDate   || null,
          joinedAt:    resolvedJoinedAt,
          updatedAt:   firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true })
      ).catch(() => {});
    }
  } catch(e) { console.warn('[BB] _bbRestoreProfile failed', e); }
}

// Save current anon board profile into userSettings/{uid}.anonProfile
// and mirror to anonProfiles/{hash} so the standalone email-code path
// can restore the same profile on a fresh browser/device.
function _bbSaveProfile() {
  if (!_bbUser || !db) return;
  const data = {
    monika:      profile.monika     || null,
    colorKey:    profile.colorKey   || 'orange',
    customInit:  profile.customInit || '',
    showMeds:    profile.showMeds,
    medList:     _anonGetMedList(),
    showStable:  profile.showStable,
    stableSince: profile.stableSince || null,
    visitStreak: parseInt(BB.storage.get('Anon_streak') || '0', 10),
    visitDate:   BB.storage.get('AnonVisitDate') || null,
    joinedAt:    profile.joinedAt   || null,
    verified:    BB.storage.get('Anon_verified') === 'true',
    termsAccepted: profile.termsOk, // guideline 1.2 agreement (see screen-agree)
  };
  db.collection('userSettings').doc(_bbUser.uid).set(
    { anonProfile: data }, { merge: true }
  ).catch(e => console.warn('[BB] _bbSaveProfile failed', e));
  // Mirror to anonProfiles so standalone email-code path finds the profile
  if (_bbUser.email) {
    _anonEmailHash(_bbUser.email).then(hash =>
      db.collection('anonProfiles').doc(hash).set(
        { ...data, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      )
    ).catch(e => console.warn('[BB] _bbSaveProfile mirror failed', e));
  }
}

// ─────────────────────────────────────────────────────────────────
// SCREEN: Medication entry (onboarding + editing from settings)
// ─────────────────────────────────────────────────────────────────
function setupMedDefine(onDone) {
  let medList = _anonGetMedList();

  // Contextual subtitle
  const sub = document.getElementById('med-define-sub');
  if (sub) {
    if (_bbUser && medList.length > 0) {
      sub.textContent = _wt('anon.ui.medSubBbList');
    } else if (_bbUser) {
      sub.textContent = _wt('anon.ui.medSubBbAdd');
    } else {
      sub.textContent = _wt('anon.medDefine.sub');
    }
  }

  function renderList() {
    const el = document.getElementById('anon-med-list-wrap');
    if (!el) return;
    if (!medList.length) {
      el.innerHTML = '<p style="color:var(--muted);font-size:13px;text-align:center;margin:4px 0 10px;">' + esc(_wt('anon.ui.noMedsYet')) + '</p>';
      return;
    }
    el.innerHTML = medList.map((m, i) => `
      <div class="anon-med-tag">
        <span style="flex:1;">💊 <strong>${esc(m.name)}</strong>${m.dosage ? ` <span style="color:var(--muted);font-size:12px;">${esc(m.dosage)}</span>` : ''}</span>
        <button class="anon-med-tag-del" data-idx="${i}">✕</button>
      </div>`).join('');
    el.querySelectorAll('.anon-med-tag-del').forEach(btn => {
      btn.onclick = () => { medList.splice(parseInt(btn.dataset.idx), 1); renderList(); };
    });
  }
  renderList();

  const nameIn = document.getElementById('anon-med-name');
  const doseIn = document.getElementById('anon-med-dose');
  nameIn.value = ''; doseIn.value = '';

  document.getElementById('anon-med-add').onclick = () => {
    const name = nameIn.value.trim();
    if (!name) { nameIn.focus(); return; }
    medList.push({ name, dosage: doseIn.value.trim() });
    nameIn.value = ''; doseIn.value = '';
    nameIn.focus();
    renderList();
  };
  nameIn.onkeydown = e => { if (e.key === 'Enter') document.getElementById('anon-med-add').click(); };

  document.getElementById('anon-med-continue').onclick = async () => {
    await _anonSaveMedList(medList);
    if (onDone) onDone();
  };
  document.getElementById('anon-med-skip').onclick = () => { if (onDone) onDone(); };
}

// ─────────────────────────────────────────────────────────────────
// Medication settings overlay
// ─────────────────────────────────────────────────────────────────
function openMedSettings() {
  closeOv('ov-monika');
  let medList  = _anonGetMedList().map(m => ({ ...m })); // working copy
  let showMeds = profile.showMeds;

  // Show BB sync note if signed in
  const bbNote = document.getElementById('med-ov-bb-note');
  if (bbNote) bbNote.style.display = _bbUser ? 'block' : 'none';

  function renderList() {
    const el = document.getElementById('med-ov-list');
    if (!el) return;
    if (!medList.length) {
      el.innerHTML = '<p style="color:var(--muted);font-size:13px;margin:4px 0 8px;">' + esc(_wt('anon.ui.noMedsYet')) + '</p>';
      return;
    }
    el.innerHTML = medList.map((m, i) => `
      <div class="anon-med-tag">
        <span style="flex:1;">💊 <strong>${esc(m.name)}</strong>${m.dosage ? ` <span style="color:var(--muted);font-size:12px;">${esc(m.dosage)}</span>` : ''}</span>
        <button class="anon-med-tag-del" data-idx="${i}">✕</button>
      </div>`).join('');
    el.querySelectorAll('.anon-med-tag-del').forEach(btn => {
      btn.onclick = () => { medList.splice(parseInt(btn.dataset.idx), 1); renderList(); };
    });
  }

  function updateToggle() {
    document.getElementById('med-ov-show').classList.toggle('active', showMeds);
    document.getElementById('med-ov-hide').classList.toggle('active', !showMeds);
  }

  renderList();
  updateToggle();

  document.getElementById('med-ov-show').onclick = () => { showMeds = true;  updateToggle(); };
  document.getElementById('med-ov-hide').onclick = () => { showMeds = false; updateToggle(); };

  const nameIn = document.getElementById('med-ov-name');
  const doseIn = document.getElementById('med-ov-dose');
  nameIn.value = ''; doseIn.value = '';

  document.getElementById('med-ov-add').onclick = () => {
    const name = nameIn.value.trim();
    if (!name) { nameIn.focus(); return; }
    medList.push({ name, dosage: doseIn.value.trim() });
    nameIn.value = ''; doseIn.value = '';
    renderList();
  };
  nameIn.onkeydown = e => { if (e.key === 'Enter') document.getElementById('med-ov-add').click(); };

  document.getElementById('med-ov-cancel').onclick = () => closeOv('ov-med');
  document.getElementById('med-ov-save').onclick = async () => {
    BB.storage.set('Anon_showMeds', showMeds ? 'true' : 'false');
    await _anonSaveMedList(medList);
    _anonSaveProfile(); _bbSaveProfile();
    closeOv('ov-med');
    showHint(_wt('anon.toast.medUpdated'));
  };

  openOv('ov-med');
}

// ─────────────────────────────────────────────────────────────────
// SCREEN: Board
// ─────────────────────────────────────────────────────────────────
function _updateAnonStreak() {
  const today     = new Date().toISOString().slice(0, 10);
  const lastDate  = BB.storage.get('AnonVisitDate') || '';
  if (lastDate === today) return; // already counted today
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const prev      = parseInt(BB.storage.get('Anon_streak') || '0', 10);
  const streak    = lastDate === yesterday ? prev + 1 : 1;
  BB.storage.set('Anon_streak',  String(streak));
  BB.storage.set('AnonVisitDate', today);
}

/**
 * Paint the "N members" line in the board header.
 *
 * Cached value first (instant, and still right offline), then a refresh from
 * `counters/anonUserCount`. Stays hidden until there's a real number — an
 * empty-looking community is worse than no line at all.
 */
let _mcTotal = null;   // members who have ever joined the board
let _mcLive  = null;   // sessions on the board right now, or null while unknown
let _mcPresenceStarted = false;
let _mcSuite = null;   // {total, live} across every UNI·SIM app, or null while unknown

/**
 * Paint the header line from whatever we currently know. The member total is
 * the headline; "(N live)" is appended only once presence resolves to at least
 * one session, so the line never reads "(0 live)" while it settles.
 */
function _paintMemberCount() {
  const el = document.getElementById('member-count');
  if (!el || !window.BB || !BB.userCount) return;

  // Two figures share this line: the board's own membership, and the whole
  // UNI·SIM suite's. A tap switches, and the choice is remembered (the same
  // choice the home page's line remembers — one key, one answer per browser).
  // (`suite` can be missing for the moment a new page script runs beside an
  // older cached user-count.js — the membership figure still shows.)
  const suite = BB.userCount.suite;
  let showSuite = !!suite && suite.scope() === 'suite';
  const suiteTotal = suite ? (_mcSuite ? _mcSuite.total : suite.cached()) : null;
  const suiteLive  = _mcSuite ? _mcSuite.live : null;
  const haveSuite = typeof suiteTotal === 'number' && suiteTotal > 0;
  if (showSuite && !haveSuite) showSuite = false;
  // Deliberately no stand-in the other way: this line is the board's membership,
  // shown to members. Somebody who has not joined saw nothing here before, and
  // still sees nothing — unless they have chosen the suite figure themselves.

  const total = showSuite ? suiteTotal : _mcTotal;
  const live  = showSuite ? suiteLive : _mcLive;
  if (typeof total !== 'number' || total <= 0) return;

  let text = showSuite
    ? _wt('common.suiteCount', { n: BB.userCount.format(total), count: total })
    : _wt('anon.board.memberCount', { n: BB.userCount.format(total), count: total });
  if (typeof live === 'number' && live > 0) {
    text += ' ' + _wt('common.live', { n: live });
  }
  el.textContent = text;
  el.style.display = 'block';
  if (!suite) return;
  suite.wireTap(el, _wt('common.countTapHint'), () => {
    _paintMemberCount();
    if (suite.scope() === 'suite') {
      suite.refresh(c => { _mcSuite = c; _paintMemberCount(); });
    } else {
      _refreshMemberCount();
    }
  });
}

/**
 * Refresh the member total in the board header.
 *
 * Cached value first (instant, and still right offline), then a refresh from
 * `counters/anonUserCount`. Stays hidden until there's a real number — an
 * empty-looking community is worse than no line at all.
 */
function _refreshMemberCount() {
  if (!window.BB || !BB.userCount) return;
  const cached = BB.userCount.cached('anon');
  if (typeof cached === 'number') { _mcTotal = cached; _paintMemberCount(); }
  BB.userCount.load(db, 'anon').then(n => {
    if (typeof n === 'number') { _mcTotal = n; _paintMemberCount(); }
  });
}

// Join the UNI·SIM suite-wide counter (migrations 0175/0177/0179). Out here
// rather than inside initBoard()'s _ensureAuthSession() chain, and running for
// anyone who opens the board rather than only for members: the beat has nothing
// to do with Firestore or with having joined, and "everyone, guests included"
// is what the suite figure counts (James, 2026-09-17). On bipolarbear.app this
// shares an install id with the home page, so reading both is one person, not
// two; the standalone Bipolar Anonymous app has its own storage and is its own.
if (window.BB && BB.userCount && BB.userCount.suite) {
  const _mcSuiteCached = BB.userCount.suite.cached();
  if (typeof _mcSuiteCached === 'number') {
    _mcSuite = { total: _mcSuiteCached, live: null };
    _paintMemberCount();
  }
  BB.userCount.suite.start(
    'anon',
    () => BB.userCount.suite.scope() === 'suite',
    counts => { _mcSuite = counts; _paintMemberCount(); }
  );
}

/**
 * Count this member towards `counters/anonUserCount`, exactly once ever.
 *
 * The flag lives on `anonProfiles/{sha256(email)}` — the one document that
 * identifies a member across both entry paths (BipolarBear account and the
 * standalone email-code flow) and across devices, so the same person can't be
 * counted twice. Members who joined before this shipped get counted the first
 * time they open the board.
 */
async function _countAnonMember() {
  if (!db || !window.BB || !BB.userCount) return;
  if (!profile.monika) return; // still mid-onboarding — not a member yet
  const email = (_bbUser && _bbUser.email) || BB.storage.get('Anon_email');
  if (!email) return;
  try {
    const hash    = await _anonEmailHash(email);
    const counted = await BB.userCount.countOnce(
      db, 'anon', db.collection('anonProfiles').doc(hash), 'counted'
    );
    if (counted) _refreshMemberCount();
  } catch (e) { /* best-effort — the board doesn't depend on this */ }
}

function initBoard() {
  BB.storage.set('AnonLastVisit', Date.now());
  // Opening the board reads everything up to now — record it so the home
  // screen's Bipolar Anonymous tick is already active on the way back, before
  // its own Firestore unread count resolves. (Home re-derives this key from the
  // live count on load; this just avoids the stale-tick flash in between.)
  BB.storage.set('Anon_allRead', '1');
  _updateAnonStreak();
  _resolveJoinedAt();
  renderUserPill();
  // One-time DOM handler wiring. initBoard() is reachable from multiple paths
  // (boot, verify success, meds yes/no) — re-running setup* would attach
  // duplicate click handlers to the Post / SOS / report / delete buttons,
  // which is what caused chat messages to be written twice.
  if (!_boardSetupDone) {
    setupTabs();
    setupFAB();
    setupCompose();
    setupThread();
    setupOverlayActions();
    setupPullToRefresh();
    setupInteractions();
    bindLongPress(document.getElementById('post-list'), '.post-card');
    _boardSetupDone = true;
  }
  // Fire-and-forget; openThread/send await the same memoised promise. The
  // community-size read and the one-time self-count both need the auth session
  // Firestore rules expect, so they chain off it rather than racing it.
  _ensureAuthSession().then(() => {
    loadMood();
    _refreshMemberCount();
    _countAnonMember();
    // "(N live)" — report this session as live and count the others. Once per
    // page: initBoard() is reachable from several paths (boot, verify success,
    // meds yes/no) and a second heartbeat loop would double-count this session.
    if (!_mcPresenceStarted && window.BB && BB.userCount) {
      _mcPresenceStarted = true;
      BB.userCount.startPresence(db, 'anon', live => { _mcLive = live; _paintMemberCount(); });
    }
  });
  setTab('general');
  listenPosts(); // starts both tab listeners; setTab no longer does this
  listenBanned(); // live ban list — hides banned users + gates compose
  listenSuggestions(); // admin review queue / your own suggestions awaiting it
  initPush(); // refresh an existing push registration (no-op if unsubscribed)
  cleanOldPosts();
  _anonSaveProfile(); _bbSaveProfile(); // persist profile to Firestore
}

function renderUserPill() {
  const m  = profile.monika;
  const g1 = profile.grad1;
  const g2 = profile.grad2;
  const av = profile.avatarInitials();
  document.getElementById('board-user-pill').innerHTML = `
    <div class="pill-row" style="display:flex;align-items:center;gap:5px;">
      <div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,${g1},${g2});display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:11px;flex-shrink:0;">${esc(av)}</div>
      <div class="pill-namecol" style="display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-width:0;">
        <span class="pill-name" style="font-size:12px;color:rgba(0,0,0,0.75);font-weight:600;">[${esc(m)}]</span>
        ${profile.isAdmin ? '<span style="background:rgba(0,0,0,0.55);color:#fff;font-size:9px;font-weight:800;border-radius:4px;padding:1px 5px;line-height:1.2;">ADMIN</span>' : ''}
      </div>
    </div>`;
  // The 🔥 / 🧘 / 🎂 figures used to follow the name here; they moved into
  // Your Moniker (#ms-stats, _paintMsStats) to give the header row room.
  _fitBoardLogo();
}

// On the narrow board header the identity pill (moniker, streaks, birthday)
// takes priority over the "Anonymous / BipolarBear" wordmark. If the wordmark
// can't show in full without truncating, drop it and keep just the logo icon,
// freeing the row for the user's name and streak badges. Measures real element
// widths (not the viewport), so it behaves the same inside the desktop iPhone
// frame as on a real phone. Always resets to shown before measuring, so it
// re-expands when the row grows and never flip-flops.
function _fitBoardLogo() {
  const logo   = document.getElementById('board-logo-btn');
  const nameEl = logo && logo.querySelector('.board-logo-name');
  const subEl  = logo && logo.querySelector('.board-logo-sub');
  if (!logo || !nameEl) return;
  logo.classList.remove('logo-iconly', 'logo-backonly');
  // Board not laid out yet (screen hidden) — nothing to measure.
  if (!nameEl.clientWidth && !nameEl.scrollWidth) return;
  // Wordmark fits — nothing to drop.
  if (nameEl.scrollWidth <= nameEl.clientWidth + 1) return;
  // Back-to-BipolarBear mode: the "← Go back" line is the point of the logo,
  // so drop the wordmark first and only go icon-only if that truncates too.
  if (logo.classList.contains('logo-back') && subEl) {
    logo.classList.add('logo-backonly');
    if (subEl.scrollWidth <= subEl.clientWidth + 1) return;
    logo.classList.remove('logo-backonly');
  }
  logo.classList.add('logo-iconly');
}

// Record that the user posted (or commented) today, so the BipolarBear home
// page can show its "posted today" tick next to Bipolar Anonymous. Same local
// date key format the home page's entry ticks use.
function _anonMarkPostedToday() {
  const d = new Date();
  const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  try { BB.storage.set('Anon_lastPostDate', key); } catch (e) {}
}

function setupTabs() {
  document.querySelectorAll('.board-tab').forEach(btn => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  });
}

// ── Unseen-message helpers ─────────────────────────────────────────
function stopAllListeners() {
  ['announcements', 'general'].forEach(tab => {
    if (unsubTabListeners[tab]) { unsubTabListeners[tab](); unsubTabListeners[tab] = null; }
  });
  if (unsubBanned) { unsubBanned(); unsubBanned = null; }
  if (unsubSuggestions) { unsubSuggestions(); unsubSuggestions = null; }
}

// Re-render the current tab from cached posts (used after the ban list or mute
// list changes, where no posts snapshot fires). No-op if the board isn't shown.
function _rerenderCurrentTab() {
  if (!document.getElementById('post-list')) return;
  renderPosts(currentTab === 'general'
    ? assembleGeneralPosts(localPosts)
    : announcementFeed());
}

// Subscribe to the admin ban list. A ban hides the user's content for everyone
// and re-gates the compose button if the current user was just banned.
function listenBanned() {
  if (!db) return;
  if (unsubBanned) { unsubBanned(); unsubBanned = null; }
  unsubBanned = db.collection(BB_BRAND.collections.banned)
    .onSnapshot(snap => {
      bannedUsers.clear();
      snap.docs.forEach(d => {
        const m = (d.data().monika || d.id || '').toLowerCase();
        if (m) bannedUsers.add(m);
      });
      _rerenderCurrentTab();
      _applyComposeBanGate();
    }, err => console.warn('[Anonymous] banned listener error', err));
}

// Visually disable compose for a banned user. The hard gate lives in the
// compose/comment handlers; this is the affordance. Inline styles avoid a
// CSS-file dependency (and the service-worker cache bump that comes with it).
function _applyComposeBanGate() {
  const fab = document.getElementById('fab-compose');
  if (!fab) return;
  const banned = isBanned(profile.monika);
  fab.style.filter  = banned ? 'grayscale(1)' : '';
  fab.style.opacity = banned ? '0.45' : '';
  fab.title = banned ? _wt('anon.modbtn.postingDisabled') : _wt('anon.tips.compose');
}

function saveLastSeen(tab) {
  lastSeenMs[tab] = Date.now();
  BB.storage.set('Anon_lastSeen_' + tab, String(lastSeenMs[tab]));
}

function tabHasUnseen(tab) {
  const seen = lastSeenMs[tab];
  const mine = profile.monika;
  return postsByTab[tab].some(p => {
    if (p.isSystem || p.isSeed || p.isAnnouncement || p.deleted || p.isTopic) return false;
    // Unread replies count on any post, your own included — that's how you
    // hear that somebody answered you.
    if (threadSeen[p.id]) {
      if (threadHasUnread(p)) return true;
    } else {
      // No read state for this thread (it has never rendered on this device),
      // so fall back to its activity stamp. Commenting is only possible from
      // the thread overlay, which records read state, so a bump reaching this
      // branch is never the user's own reply.
      const la = p.lastActivity?.toMillis?.() ?? 0;
      if (la > seen) return true;
    }
    // A post you wrote is not news to you — you saw it when you posted it.
    // (_refreshAnonMessagesBadge in js/index.js applies the same rule to the
    // home-screen count.)
    if (mine && p.name === mine) return false;
    const ts = p.timestamp?.toMillis?.() ?? 0;
    return ts > seen;
  });
}

function renderTabBadges() {
  ['announcements', 'general'].forEach(tab => {
    const btn = document.querySelector(`.board-tab[data-tab="${tab}"]`);
    // The admin's announcements tab also flags suggestions waiting on them.
    const waiting = tab === 'announcements' && profile.isAdmin && pendingSuggestionCount() > 0;
    if (btn) btn.classList.toggle('has-badge', tab !== currentTab && (waiting || tabHasUnseen(tab)));
  });
}
// ──────────────────────────────────────────────────────────────────

// ── Unread replies, per thread ─────────────────────────────────────
// The tab badge above answers "is there anything new on this tab?". These
// helpers answer the finer question "which of these threads has replies I
// haven't read?", and pulse that post's 💬 button until the thread is opened.
//
// Read state is a count, not a timestamp: a thread is unread when the post
// doc's commentCount runs ahead of the number of comments we saw the last time
// its thread was open. Counts survive a clock skew and, unlike lastActivity,
// don't flag your own reply as unread.
//
// Threads are baselined the first time they render (see baselineThreadSeen),
// so a first-ever board load doesn't light up every post that already had
// replies — only activity from that point on counts as unread.

function _loadThreadSeen() {
  try {
    const raw = JSON.parse(BB.storage.get(THREAD_SEEN_KEY) || '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    // Posts are swept after POST_RETENTION_DAYS, so entries older than twice
    // that can't refer to a live thread — drop them and keep the map small.
    const cutoff = Date.now() - (POST_RETENTION_DAYS * 2 * DAY_MS);
    const out = {};
    Object.keys(raw).forEach(id => {
      const e = raw[id];
      const t = e && num(e.t, 0);
      if (t > cutoff) out[id] = { c: Math.max(0, num(e.c, 0)), t };
    });
    return out;
  } catch (e) { return {}; }
}

// Coalesce the writes — a burst of snapshots (or a feed full of first-sight
// posts being baselined) would otherwise re-serialise the whole map each time.
let _threadSeenSaveT = null;
function _saveThreadSeen() {
  clearTimeout(_threadSeenSaveT);
  _threadSeenSaveT = setTimeout(() => {
    try { BB.storage.set(THREAD_SEEN_KEY, JSON.stringify(threadSeen)); } catch (e) {}
  }, 400);
}

// Only real, live post docs carry a thread. Seeds, the system card, the feed
// footer and tombstones have no comments to be unread — nor does the `local-`
// placeholder an optimistic compose renders before its doc id comes back
// (marked read against the real id once the write lands).
function _isThreadable(p) {
  return !!(p && p.id && !String(p.id).startsWith('local-')
    && !p.isSeed && !p.isSystem && !p.isAnnouncement && !p.isFooter && !p.deleted);
}

function threadHasUnread(p) {
  if (!_isThreadable(p)) return false;
  const seen = threadSeen[p.id];
  if (!seen) return false; // never seen before → baselined on this render, not flagged
  return num(p.commentCount, 0) > seen.c;
}

// Record how many comments the user has now seen in a thread. Called from the
// open thread's snapshot, so a reply that arrives while you're reading counts
// as read — including your own.
function markThreadSeen(postId, count) {
  if (!postId) return;
  const c = Math.max(0, num(count, 0));
  const prev = threadSeen[postId];
  if (prev && prev.c === c) return; // already current; no write needed
  threadSeen[postId] = { c, t: Date.now() };
  _saveThreadSeen();
}

// First sight of a thread sets its baseline instead of flagging it. Runs after
// the feed markup is built so this render still reads the previous state.
function baselineThreadSeen(posts) {
  let added = false;
  posts.forEach(p => {
    if (!_isThreadable(p) || threadSeen[p.id]) return;
    threadSeen[p.id] = { c: Math.max(0, num(p.commentCount, 0)), t: Date.now() };
    added = true;
  });
  if (added) _saveThreadSeen();
}

// Repaint the unread affordance on the already-rendered feed. Used when the
// thread overlay closes: the feed underneath is untouched by that, and a full
// re-render would throw away the user's scroll position.
function syncUnreadFlags() {
  const list = document.getElementById('post-list');
  if (!list) return;
  list.querySelectorAll('[data-comment]').forEach(el => {
    const post   = localPosts.find(p => p.id === el.dataset.comment);
    const unread = threadHasUnread(post);
    el.classList.toggle('has-unread', unread);
    if (el.classList.contains('comment-btn')) {
      el.title = _wt(unread ? 'anon.modbtn.newReplies' : 'anon.modbtn.viewComments');
    }
  });
}

// Shared by renderPost and renderArchivedTopic — the 💬 pulses and gains a dot
// while the thread holds replies the user hasn't opened.
function commentBtnHtml(p, commentCount) {
  const unread = threadHasUnread(p);
  const title  = _wt(unread ? 'anon.modbtn.newReplies' : 'anon.modbtn.viewComments');
  return `<button class="comment-btn${unread ? ' has-unread' : ''}" data-comment="${esc(p.id)}" title="${esc(title)}">`
       + `<span class="cb-icon">💬</span>${commentCount > 0 ? ` <span>${commentCount}</span>` : ''}</button>`;
}
// ──────────────────────────────────────────────────────────────────

function setTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.board-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('fab-ann').classList.toggle('active', tab === 'announcements');
  document.getElementById('fab-gen').classList.toggle('active', tab === 'general');

  const postList    = document.getElementById('post-list');
  const wikiSection = document.getElementById('wiki-section');
  const fabCompose  = document.getElementById('fab-compose');
  const fabSearch   = document.getElementById('fab-search');
  const isWiki      = tab === 'wiki';
  if (postList)    postList.style.display    = isWiki ? 'none'  : '';
  if (wikiSection) wikiSection.style.display = isWiki ? 'block' : 'none';
  if (fabCompose)  fabCompose.style.display  = isWiki ? 'none'  : '';
  if (fabSearch)   fabSearch.style.display   = isWiki ? ''      : 'none';
  if (!isWiki) closeWikiSearch();

  if (isWiki) {
    renderWiki();
    renderTabBadges();
    return;
  }

  saveLastSeen(tab);
  // Render from the already-running listener's cached data (no listener restart)
  localPosts = postsByTab[tab] || [];
  renderPosts(tab === 'general' ? assembleGeneralPosts(localPosts) : announcementFeed());
  renderTabBadges();
}

// ─────────────────────────────────────────────────────────────────
// Wiki tab
// ─────────────────────────────────────────────────────────────────
let _wikiSection = 'meds';
const _wikiCache = { groups: null, posts: null };
function _wt(key, vars) { return (window.BB && window.BB.t) ? window.BB.t(key, vars) : key; }

// Map hostnames to friendly source names shown next to wiki links.
const _WIKI_SOURCE_NAMES = {
  'nhs.uk':                       'NHS.uk',
  'england.nhs.uk':               'NHS England',
  'bipolaruk.org':                'Bipolar UK',
  'mind.org.uk':                  'Mind',
  'gov.uk':                       'GOV.UK',
  'acas.org.uk':                  'ACAS',
  'samaritans.org':               'Samaritans',
  'talktofrank.com':              'FRANK',
  'rcpsych.ac.uk':                'Royal College of Psychiatrists',
  'carersuk.org':                 'Carers UK',
  'rethink.org':                  'Rethink Mental Illness',
  'breastfeedingnetwork.org.uk':  'Breastfeeding Network',
  'app-network.org':              'APP Network',
  'en.wikipedia.org':             'Wikipedia',
  'guilford.com':                 'Guilford Press',
};
function _wikiSourceName(url) {
  if (!url) return '';
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    if (_WIKI_SOURCE_NAMES[host]) return _WIKI_SOURCE_NAMES[host];
    // Fallback — registrable-ish: keep last two labels.
    const parts = host.split('.');
    return parts.length >= 2 ? parts.slice(-2).join('.') : host;
  } catch (_) {
    return '';
  }
}
// Small sparkles SVG used to flag AI-summarised content.
const _WIKI_AI_SVG = '<svg class="wiki-ai-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M6 1.5l1.1 2.4L9.5 5l-2.4 1.1L6 8.5 4.9 6.1 2.5 5l2.4-1.1L6 1.5zm6 5l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6L9.7 8.8l1.6-.7L12 6.5zm-3 4l.8 1.7 1.7.8-1.7.8L9 15.5l-.8-1.7-1.7-.8 1.7-.8L9 10.5z" fill="currentColor"/></svg>';
// Renders the source-attribution row sitting above the wiki link button.
// `sourceType` is 'ai' (default — body text is an AI summary) or 'direct'
// (body is taken verbatim from the linked source).
function _wikiSourceMetaHtml(url, sourceType) {
  if (!url) return '';
  const name = _wikiSourceName(url);
  if (!name) return '';
  const isDirect = sourceType === 'direct';
  const badge = isDirect
    ? `<span class="wiki-source-badge wiki-source-badge--direct">${esc(_wt('anon.wiki.directBadge'))}</span>`
    : `<span class="wiki-source-badge wiki-source-badge--ai">${_WIKI_AI_SVG}${esc(_wt('anon.wiki.aiSummaryBadge'))}</span>`;
  return `<div class="wiki-source-meta">${badge}<span class="wiki-source-name">${esc(_wt('anon.wiki.sourceLabel'))} <strong>${esc(name)}</strong></span></div>`;
}
function _wikiLinkLabel(url, fallback) {
  const name = _wikiSourceName(url);
  return name
    ? _wt('anon.wiki.readOn').replace('{site}', name)
    : fallback;
}

function renderWiki() {
  const wiki = document.getElementById('wiki-section');
  if (!wiki) return;
  if (wiki.dataset.rendered !== '1') {
    wiki.dataset.rendered = '1';
    wiki.innerHTML = `
      <div id="wiki-search-bar" class="wiki-search-bar" style="display:none;">
        <input id="wiki-search-input" type="search" placeholder="${esc(_wt('anon.wiki.searchPlaceholder'))}" autocomplete="off" />
        <button id="wiki-search-close" class="wiki-search-close" aria-label="${esc(_wt('anon.ui.closeSearch'))}">✕</button>
      </div>
      <div class="wiki-pills">
        <div class="wiki-pill-row" data-pill-row="0">
          <div class="wiki-pill-track">
            <button class="wiki-pill active" data-wiki="meds">${esc(_wt('anon.wiki.pillMeds'))}</button>
            <button class="wiki-pill" data-wiki="conditions">${esc(_wt('anon.wiki.pillConditions'))}</button>
            <button class="wiki-pill" data-wiki="therapies">${esc(_wt('anon.wiki.pillTherapies'))}</button>
            <button class="wiki-pill" data-wiki="sideEffects">${esc(_wt('anon.wiki.pillSideEffects'))}</button>
            <button class="wiki-pill" data-wiki="lifestyle">${esc(_wt('anon.wiki.pillLifestyle'))}</button>
            <button class="wiki-pill" data-wiki="warningSigns">${esc(_wt('anon.wiki.pillWarningSigns'))}</button>
            <button class="wiki-pill" data-wiki="hospital">${esc(_wt('anon.wiki.pillHospital'))}</button>
          </div>
        </div>
        <div class="wiki-pill-row" data-pill-row="1">
          <div class="wiki-pill-track">
            <button class="wiki-pill" data-wiki="twelveSteps">${esc(_wt('anon.wiki.pillTwelveSteps'))}</button>
            <button class="wiki-pill" data-wiki="workplace">${esc(_wt('anon.wiki.pillWorkplace'))}</button>
            <button class="wiki-pill" data-wiki="pregnancy">${esc(_wt('anon.wiki.pillPregnancy'))}</button>
            <button class="wiki-pill" data-wiki="media">${esc(_wt('anon.wiki.pillMedia'))}</button>
            <button class="wiki-pill" data-wiki="lovedOnes">${esc(_wt('anon.wiki.pillLovedOnes'))}</button>
            <button class="wiki-pill" data-wiki="groups">${esc(_wt('anon.wiki.pillGroups'))}</button>
            <button class="wiki-pill" data-wiki="wisdom">${esc(_wt('anon.wiki.pillWisdom'))}</button>
          </div>
        </div>
      </div>
      <div id="wiki-hero" class="wiki-hero"></div>
      <div id="wiki-body" class="wiki-body"></div>
    `;
    // Keep the banner's article count right for the sections that load
    // asynchronously (groups, community wisdom) as well as the static ones.
    new MutationObserver(_paintWikiCount).observe(document.getElementById('wiki-body'), { childList: true });
    wiki.querySelectorAll('.wiki-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        setWikiSection(btn.dataset.wiki);
        _slideWikiPillLeft(btn);
      });
    });
    wiki.querySelectorAll('.wiki-pill-row').forEach(row => {
      row.addEventListener('scroll', _updateWikiFades, { passive: true });
    });
    document.getElementById('wiki-search-input').addEventListener('input', applyWikiFilter);
    document.getElementById('wiki-search-close').addEventListener('click', closeWikiSearch);
    setWikiSection(_wikiSection);
    _updateWikiFades();
    _peekWikiRows();
  } else {
    // Re-evaluate fades in case viewport size changed while hidden.
    _updateWikiFades();
    _peekWikiRows();
  }
}

function toggleWikiSearch() {
  const bar = document.getElementById('wiki-search-bar');
  if (!bar) return;
  if (bar.style.display === 'none') {
    bar.style.display = 'flex';
    const input = document.getElementById('wiki-search-input');
    if (input) { input.value = ''; setTimeout(() => input.focus(), 50); }
  } else {
    closeWikiSearch();
  }
}

function closeWikiSearch() {
  const bar = document.getElementById('wiki-search-bar');
  if (!bar) return;
  bar.style.display = 'none';
  const input = document.getElementById('wiki-search-input');
  if (input) input.value = '';
  applyWikiFilter();
}

function applyWikiFilter() {
  const input = document.getElementById('wiki-search-input');
  const body  = document.getElementById('wiki-body');
  if (!body) return;
  const q = input ? input.value.trim().toLowerCase() : '';
  const cards = body.querySelectorAll('[data-wiki-search]');
  let visibleCount = 0;
  cards.forEach(c => {
    const match = !q || (c.dataset.wikiSearch || '').includes(q);
    c.style.display = match ? '' : 'none';
    if (match) visibleCount++;
  });
  // Region headings (groups view): hide if all groups under them are filtered out.
  body.querySelectorAll('[data-wiki-region]').forEach(h => {
    const region = h.dataset.wikiRegion;
    const anyVisible = Array.from(body.querySelectorAll(`[data-wiki-region-card="${CSS.escape(region)}"]`))
      .some(el => el.style.display !== 'none');
    h.style.display = anyVisible ? '' : 'none';
  });
  // No-results state.
  let noResults = body.querySelector('.wiki-no-results');
  if (q && visibleCount === 0) {
    if (!noResults) {
      noResults = document.createElement('div');
      noResults.className = 'wiki-no-results';
      noResults.innerHTML = _emptyHtml(_wt('anon.wiki.noResults'), true);
      body.appendChild(noResults);
    }
  } else if (noResults) {
    noResults.remove();
  }
}

// Banner above each wiki section: the pill's own emoji and name, bigger, in
// the section's colour (see #wiki-section[data-section] in anonymous.css).
function _paintWikiHero(section) {
  const hero = document.getElementById('wiki-hero');
  const pill = document.querySelector(`.wiki-pill[data-wiki="${section}"]`);
  if (!hero || !pill) return;
  const label = pill.textContent.trim();
  const m = label.match(/^(\S+)\s+(.*)$/);
  const ico  = m && !/[A-Za-z0-9]/.test(m[1]) ? m[1] : '📖';
  const name = m && !/[A-Za-z0-9]/.test(m[1]) ? m[2] : label;
  hero.innerHTML = `<div class="wiki-hero-ico">${esc(ico)}</div>`
    + `<div><div class="wiki-hero-title">${esc(name)}</div><div class="wiki-hero-count" id="wiki-hero-count"></div></div>`;
  _paintWikiCount();
}
function _paintWikiCount() {
  const el = document.getElementById('wiki-hero-count');
  const body = document.getElementById('wiki-body');
  if (!el || !body) return;
  const n = body.querySelectorAll('.wiki-card, .wiki-wisdom-card').length;
  el.textContent = n ? '📄 ' + n : '';
}

function setWikiSection(section) {
  _wikiSection = section;
  const wikiSec = document.getElementById('wiki-section');
  if (wikiSec) wikiSec.dataset.section = section;
  _paintWikiHero(section);
  document.querySelectorAll('.wiki-pill').forEach(b =>
    b.classList.toggle('active', b.dataset.wiki === section));
  if (section === 'meds')              renderWikiMeds();
  else if (section === 'conditions')   renderWikiConditions();
  else if (section === 'therapies')    renderWikiTherapies();
  else if (section === 'lifestyle')    renderWikiLifestyle();
  else if (section === 'warningSigns') renderWikiWarningSigns();
  else if (section === 'sideEffects')  renderWikiSideEffects();
  else if (section === 'hospital')     renderWikiHospital();
  else if (section === 'workplace')    renderWikiWorkplace();
  else if (section === 'pregnancy')    renderWikiPregnancy();
  else if (section === 'media')        renderWikiMedia();
  else if (section === 'lovedOnes')    renderWikiLovedOnes();
  else if (section === 'groups')       renderWikiGroups();
  else if (section === 'wisdom')       renderWikiWisdom();
  else if (section === 'twelveSteps')  renderWikiTwelveSteps();
}

// Open the wiki tab straight onto a named section. Used by the announcement
// cards that link to a wiki page. _wikiSection is set BEFORE setTab because a
// first-ever wiki render calls setWikiSection(_wikiSection) itself — without
// this the pill would land on the default section for one frame.
function openWikiSection(section) {
  _wikiSection = section;
  setTab('wiki');
  setWikiSection(section);
  const pill = document.querySelector(`.wiki-pill[data-wiki="${section}"]`);
  if (pill) _slideWikiPillLeft(pill);
  const wiki = document.getElementById('wiki-section');
  if (wiki) wiki.scrollTop = 0;
}

// Slide the tapped pill so it aligns with the left edge of its scrollable
// row, revealing more pills to the right. No-op when the row isn't
// overflowing (e.g. desktop where the rows render as `display: contents`
// and don't scroll).
function _slideWikiPillLeft(pill) {
  if (!pill) return;
  const row = pill.closest('.wiki-pill-row');
  if (!row) return;
  if (row.scrollWidth <= row.clientWidth + 1) return;
  const target = pill.offsetLeft;
  if (typeof row.scrollTo === 'function') {
    row.scrollTo({ left: target, behavior: 'smooth' });
  } else {
    row.scrollLeft = target;
  }
}

// Both pill rows are independently scrollable on mobile. We fade the edge
// of each row where there's more content to reveal, so the user knows the
// row can be swiped.
function _updateWikiFades() {
  const wiki = document.getElementById('wiki-section');
  if (!wiki || wiki.style.display === 'none') return;
  wiki.querySelectorAll('.wiki-pill-row').forEach(row => {
    const canRight = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
    const canLeft  = row.scrollLeft > 0;
    row.classList.toggle('can-scroll-right', canRight);
    row.classList.toggle('can-scroll-left',  canLeft);
  });
}

// First wiki open per session: nudge each overflowing row so the user
// sees the chips can move. Persistent affordance (the edge fade) takes
// over after that.
function _peekWikiRows() {
  try { if (sessionStorage.getItem('bbWikiPeeked') === '1') return; } catch (e) {}
  let didPeek = false;
  document.querySelectorAll('.wiki-pill-row').forEach(row => {
    const track = row.querySelector('.wiki-pill-track');
    if (!track) return;
    if (row.scrollWidth > row.clientWidth + 1) {
      track.classList.add('peek');
      didPeek = true;
      setTimeout(() => track.classList.remove('peek'), 1000);
    }
  });
  if (didPeek) {
    try { sessionStorage.setItem('bbWikiPeeked', '1'); } catch (e) {}
  }
}

let _wikiFadesResizeT = 0;
window.addEventListener('resize', () => {
  clearTimeout(_wikiFadesResizeT);
  _wikiFadesResizeT = setTimeout(_updateWikiFades, 120);
  _fitBoardLogo();
});

const _CONDITIONS = [
  {
    keys: ['bipolar 1', 'bipolar one', 'bp1', 'bpi', 'mania', 'manic'],
    title: 'Bipolar I',
    body: 'Defined by at least one manic episode lasting 7+ days (or any length if it required hospital). Mania involves elevated or irritable mood, racing thoughts, reduced need for sleep, risky behaviour, and sometimes psychosis. Most people with Bipolar I also experience major depressive episodes between manic ones.',
    nhs: 'https://www.nhs.uk/mental-health/conditions/bipolar-disorder/'
  },
  {
    keys: ['bipolar 2', 'bipolar two', 'bp2', 'bpii', 'hypomania', 'hypomanic'],
    title: 'Bipolar II',
    body: 'At least one hypomanic episode (4+ days, less severe than full mania — no hospitalisation, no psychosis) and at least one major depressive episode. Hypomania can feel productive or even pleasant, which is why Bipolar II is often misdiagnosed as depression for years before the pattern is recognised.',
    nhs: 'https://www.nhs.uk/mental-health/conditions/bipolar-disorder/'
  },
  {
    keys: ['cyclothymia', 'cyclothymic'],
    title: 'Cyclothymia',
    body: 'Chronic, fluctuating mood swings lasting at least 2 years in adults (1 year in under-18s), with periods of hypomanic and depressive symptoms that don\'t quite meet the threshold for a full episode. Less severe but persistent — and it can develop into Bipolar I or II over time.',
    nhs: 'https://www.nhs.uk/mental-health/conditions/bipolar-disorder/'
  },
  {
    keys: ['nos', 'other specified', 'unspecified', 'bipolar nos'],
    title: 'Other Specified Bipolar (NOS)',
    body: 'A diagnosis used when symptoms clearly fit a bipolar pattern but don\'t meet the strict criteria for I, II, or cyclothymia — for example, hypomanic episodes shorter than 4 days, or depressive episodes alongside subthreshold hypomanic symptoms. Just as real and just as worth treating.',
    nhs: 'https://www.nhs.uk/mental-health/conditions/bipolar-disorder/'
  },
  {
    keys: ['rapid cycling', 'rapid-cycling', 'rapid cycler', 'cycling'],
    title: 'Rapid Cycling',
    body: 'Not a separate diagnosis but a course specifier that can apply to Bipolar I or II: four or more mood episodes (manic, hypomanic, or depressive) within a 12-month period, each separated by partial or full remission, or by a switch to the opposite pole. Ultra-rapid (days) and ultra-ultra-rapid / ultradian (within a single day) cycling are sometimes described too, though they sit outside the formal DSM definition. Rapid cycling is more common in Bipolar II, in women, and can be triggered or worsened by antidepressants taken without a mood stabiliser, thyroid problems, sleep disruption, or substance use. It tends to respond less well to lithium alone — clinicians often try valproate, lamotrigine, or atypical antipsychotics, and look hard for reversible triggers.',
    nhs: 'https://www.nhs.uk/mental-health/conditions/bipolar-disorder/symptoms/'
  },
  {
    keys: ['mixed features', 'mixed episode', 'mixed state', 'dysphoric mania', 'agitated depression'],
    title: 'Mixed Features',
    body: 'Manic/hypomanic and depressive symptoms occurring at the same time — for example, depressed mood with racing thoughts and agitation, or elevated energy paired with hopelessness. Used to be called "mixed episodes"; the DSM-5 reframed it as a "with mixed features" specifier that can attach to any mood episode in Bipolar I, II, or major depression. Often experienced as the most painful state in bipolar — the energy to act on suicidal thoughts is higher than in pure depression — and is a recognised high-risk window. Antidepressants alone tend to make it worse; mood stabilisers and atypical antipsychotics are first-line.',
    nhs: 'https://www.nhs.uk/mental-health/conditions/bipolar-disorder/symptoms/'
  },
  {
    keys: ['seasonal', 'sad', 'seasonal affective', 'winter depression', 'summer mania', 'seasonal pattern'],
    title: 'Seasonal Pattern',
    body: 'A specifier (not a separate diagnosis) for people whose mood episodes follow the seasons in a reliable, multi-year pattern — most commonly winter depression and spring/summer hypomania or mania, though the reverse occurs. Light therapy and dawn simulators can help the winter-depression side; for the manic side they can actually trigger a switch, so timing and clinician supervision matter. Sleep hygiene, blackout curtains during light months, and pre-emptive medication adjustments around the equinoxes are common strategies.',
    nhs: 'https://www.nhs.uk/mental-health/conditions/seasonal-affective-disorder-sad/'
  },
  {
    keys: ['mdd', 'major depression', 'major depressive', 'depression', 'unipolar', 'unipolar depression', 'clinical depression'],
    title: 'Major Depressive Disorder',
    body: 'Recurrent depressive episodes without any history of mania or hypomania. Symptoms overlap heavily with bipolar depression — low mood, loss of interest, fatigue, sleep and appetite changes, hopelessness, suicidal thoughts — but the absence of "up" episodes is the key distinction. Because hypomania can feel pleasant or simply productive, Bipolar II is misdiagnosed as MDD for an average of around 10 years. If antidepressants trigger agitation, insomnia, or a sudden mood lift, ask your prescriber to revisit the diagnosis: that pattern can unmask bipolarity.',
    nhs: 'https://www.nhs.uk/mental-health/conditions/clinical-depression/'
  },
  {
    keys: ['anxiety', 'gad', 'panic', 'panic disorder', 'social anxiety', 'phobia', 'anxiety disorder'],
    title: 'Anxiety Disorders',
    body: 'An umbrella covering Generalised Anxiety Disorder (persistent worry across many areas of life), Panic Disorder (sudden physical surges of fear), Social Anxiety, specific phobias, and others. Anxiety disorders co-occur with bipolar more often than not — estimates run between 50% and 75% — and can mimic or mask hypomania, since agitation and racing thoughts feature in both. SSRIs are standard for primary anxiety but need caution in bipolar because of switch risk; CBT, mindfulness-based approaches, and short-term beta-blockers for performance situations are common adjuncts.',
    nhs: 'https://www.nhs.uk/mental-health/conditions/generalised-anxiety-disorder/'
  },
  {
    keys: ['adhd', 'add', 'attention deficit', 'hyperactive', 'hyperactivity'],
    title: 'ADHD',
    body: 'A neurodevelopmental condition involving difficulty sustaining attention, impulsivity, and (for many) hyperactivity, present since childhood. Roughly 1 in 5 adults with bipolar also meet ADHD criteria, and the symptom overlap with hypomania — talkativeness, distractibility, restlessness, sleep disruption — makes diagnosis tricky. The key distinction is duration: ADHD is a lifelong baseline trait, while hypomania is episodic and a clear change from your normal. Stimulants treat ADHD effectively but can destabilise unmedicated bipolar, so most clinicians stabilise mood first; atomoxetine and guanfacine are non-stimulant alternatives.',
    nhs: 'https://www.nhs.uk/conditions/attention-deficit-hyperactivity-disorder-adhd/'
  },
  {
    keys: ['bpd', 'eupd', 'borderline', 'borderline personality', 'emotionally unstable'],
    title: 'Borderline Personality Disorder (BPD / EUPD)',
    body: 'A personality disorder marked by intense, rapidly-shifting emotions (typically minutes-to-hours, rarely full days), fear of abandonment, unstable self-image and relationships, impulsivity, and self-harming or suicidal behaviour. Frequently misdiagnosed as bipolar — and vice versa — because both feature mood swings, but the timescale and triggers differ: BPD shifts are usually reactive to interpersonal events, while bipolar episodes last days-to-weeks and arise more autonomously. Dialectical Behaviour Therapy (DBT) is the gold-standard treatment; medication plays a supporting, not primary, role. The two conditions can also co-exist.',
    nhs: 'https://www.nhs.uk/mental-health/conditions/borderline-personality-disorder/'
  },
  {
    keys: ['schizophrenia', 'psychosis', 'schizoaffective', 'psychotic'],
    title: 'Schizophrenia & Schizoaffective',
    body: 'Schizophrenia is a chronic condition involving positive symptoms (hallucinations, delusions, disorganised thinking), negative symptoms (flattened affect, reduced motivation, social withdrawal), and cognitive symptoms. It is not "split personality" and it is not the same as Bipolar I with psychotic features — in bipolar, psychosis appears during mood episodes and resolves with them; in schizophrenia, psychotic symptoms persist independently of mood. Schizoaffective disorder sits between the two: full mood episodes plus periods of psychosis when mood is stable for at least two weeks. Antipsychotics are the mainstay of treatment, with long-acting injectables as an option for adherence; psychosocial support and family-based approaches matter just as much as medication.',
    nhs: 'https://www.nhs.uk/mental-health/conditions/schizophrenia/'
  }
];

const _THERAPIES = [
  {
    keys: ['cbt', 'cognitive', 'cognitive behavioural', 'cognitive behavioral'],
    title: 'CBT — Cognitive Behavioural Therapy',
    body: 'The most widely-offered talking therapy on the NHS. CBT works on the loop between thoughts, feelings, and behaviours — for bipolar it focuses on catching distorted thinking in depression and challenging the "I don\'t need sleep / I can do anything" cognitions early in hypomania. Usually 8–20 weekly sessions. Bipolar-adapted CBT includes mood charting and prodromal-symptom work; standard CBT alone is more useful for the depressive phase.',
    link: 'https://www.nhs.uk/mental-health/talking-therapies-medicine-treatments/talking-therapies-and-counselling/cognitive-behavioural-therapy-cbt/'
  },
  {
    keys: ['dbt', 'dialectical', 'mindfulness skills'],
    title: 'DBT — Dialectical Behaviour Therapy',
    body: 'Originally developed for borderline personality disorder, DBT combines CBT with mindfulness and acceptance skills. Four skill modules: mindfulness, distress tolerance, emotion regulation, interpersonal effectiveness. Useful in bipolar where mood swings include self-harm urges or intense interpersonal pain. Usually delivered as weekly individual therapy plus weekly skills group for 6–12 months. NHS access is patchier than CBT — often via specialist services.',
    link: 'https://www.nhs.uk/mental-health/talking-therapies-medicine-treatments/talking-therapies-and-counselling/'
  },
  {
    keys: ['ipsrt', 'social rhythm', 'interpersonal', 'rhythm therapy'],
    title: 'IPSRT — Interpersonal & Social Rhythm Therapy',
    body: 'Bipolar-specific therapy targeting the disrupted body-clock side of the illness. You map your daily routines — wake time, first contact with people, meals, sleep — and work on stabilising them, on the theory that disrupted rhythms trigger mood episodes. The "IP" half addresses relationship grief, role transitions, and conflicts that often precede an episode. Strong evidence for relapse prevention; rarely offered on the NHS but worth asking about privately.',
    link: 'https://www.bipolaruk.org/'
  },
  {
    keys: ['mbct', 'mindfulness', 'mindfulness based'],
    title: 'MBCT — Mindfulness-Based Cognitive Therapy',
    body: 'An 8-week group programme combining mindfulness meditation with CBT principles. NICE recommends it specifically for preventing recurrence in depression. For bipolar it can help with rumination in depression and noticing early agitation in hypomania — though some people find prolonged meditation destabilising during a mood episode, so timing matters. Free apps exist; structured NHS courses are increasingly available via Talking Therapies.',
    link: 'https://www.nhs.uk/mental-health/self-help/tips-and-support/mindfulness/'
  },
  {
    keys: ['fft', 'family focused', 'family therapy', 'family-focused'],
    title: 'Family-Focused Therapy (FFT)',
    body: 'Designed specifically for bipolar disorder, FFT brings the patient and close family or partners together for 12–21 sessions. Covers psychoeducation about the illness, communication skills, and problem-solving. Strong evidence for reducing relapse and hospital admission, especially in young people newly diagnosed. Rarely on the standard NHS pathway — usually only via research clinics or specialist mood-disorder units.',
    link: 'https://www.bipolaruk.org/'
  },
  {
    keys: ['emdr', 'eye movement', 'trauma therapy', 'ptsd therapy'],
    title: 'EMDR — Eye Movement Desensitisation & Reprocessing',
    body: 'A trauma-focused therapy where you recall distressing memories while following the therapist\'s finger (or tapping/tones) in alternating left-right patterns. NICE-recommended for PTSD. Relevant for bipolar because trauma is a common co-occurring issue and unprocessed trauma can act as a relapse trigger. NHS access is via specialist trauma services; eight to twelve sessions is typical.',
    link: 'https://www.nhs.uk/mental-health/talking-therapies-medicine-treatments/talking-therapies-and-counselling/'
  },
  {
    keys: ['psychoeducation', 'education', 'learning about bipolar'],
    title: 'Psychoeducation',
    body: 'Structured teaching about your condition — early warning signs, medication, lifestyle, when to seek help. Sounds basic but the evidence is strong: structured group psychoeducation (the Barcelona programme is the most famous, 21 weekly sessions) cuts relapse rates significantly. NHS CMHTs sometimes run bipolar psychoeducation groups; Bipolar UK\'s "Living with Bipolar" courses are a peer-led alternative.',
    link: 'https://www.bipolaruk.org/'
  },
  {
    keys: ['counselling', 'counseling', 'psychotherapy', 'therapy difference'],
    title: 'Counselling vs Psychotherapy',
    body: 'Counselling is usually shorter (6–12 weeks), focused on a specific issue (grief, work stress), and centred on listening and reflection. Psychotherapy is longer (months to years), goes deeper into patterns, and can be psychodynamic, person-centred, or integrative. Neither is bipolar-specific, but both can support the wider work alongside CBT/DBT/IPSRT. The NHS offers brief counselling via Talking Therapies; longer psychotherapy is usually private or via specialist services.',
    link: 'https://www.nhs.uk/mental-health/talking-therapies-medicine-treatments/talking-therapies-and-counselling/'
  }
];

const _LIFESTYLE = [
  {
    keys: ['sleep', 'circadian', 'insomnia', 'sleep hygiene', 'jet lag'],
    title: 'Sleep & Circadian Rhythm',
    body: 'Probably the single most powerful lifestyle factor in bipolar. Reduced sleep is both a symptom and a trigger of mania — losing one night can switch some people. Aim for a fixed sleep window (7–9 hours), a consistent wake time even on weekends, no screens for an hour before bed, and a dark cool room. Travel across time zones, shift work, and all-nighters are high-risk; talk to your prescriber about pre-emptive sleep meds for unavoidable disruptions.',
    link: 'https://www.nhs.uk/live-well/sleep-and-tiredness/'
  },
  {
    keys: ['alcohol', 'drinking', 'booze', 'wine', 'beer'],
    title: 'Alcohol',
    body: 'Alcohol depresses mood the day after, disrupts sleep architecture (even when it helps you fall asleep), and interacts with most psychiatric meds — lithium and lamotrigine both have significant cautions. Heavy use roughly doubles relapse risk and worsens treatment response. If you drink, ideally low and slow, with food, never alone, never to manage symptoms; the UK low-risk guideline is ≤14 units/week spread over 3+ days. Mocktails and 0% beers are now everywhere.',
    link: 'https://www.nhs.uk/live-well/alcohol-advice/'
  },
  {
    keys: ['caffeine', 'coffee', 'tea', 'energy drinks'],
    title: 'Caffeine',
    body: 'A stimulant — speeds up the heart, raises anxiety, delays sleep onset (over a 6-hour half-life), and at high doses can fuel hypomania. Worth tracking how much you actually consume: a Starbucks grande is around 310mg, the upper-end NHS guideline is 400mg/day, and many bipolar specialists suggest dropping under 200mg if you\'re sensitive. Cut gradually to avoid headaches; switch to decaf or matcha (lower dose, slower release) after lunch.',
    link: 'https://www.nhs.uk/live-well/eat-well/food-types/the-effects-of-caffeine-on-your-health/'
  },
  {
    keys: ['exercise', 'gym', 'running', 'walking', 'cardio', 'strength'],
    title: 'Exercise',
    body: '150 minutes of moderate activity per week has antidepressant effects comparable to some SSRIs in mild-to-moderate depression. For bipolar specifically, the catch is that intense or novel training can also trigger hypomania — so the pattern is "regular and moderate", not "bursts of new training plans". Walking, swimming, yoga, and weight training all count; team sports add the social-rhythm bonus.',
    link: 'https://www.nhs.uk/live-well/exercise/'
  },
  {
    keys: ['light', 'dark', 'sunlight', 'blackout', 'morning light', 'lightbox'],
    title: 'Light & Dark',
    body: 'Bright morning light shifts your body clock earlier and lifts depressed mood; evening light delays sleep and can fuel mania. Useful tactics: a 20-minute morning walk or a 10,000-lux lightbox for winter depression; blackout curtains and amber glasses after 9pm during summer or in manic phases. "Dark therapy" (deliberate 14-hour darkness) has small-trial evidence for stopping early mania.',
    link: 'https://www.nhs.uk/mental-health/conditions/seasonal-affective-disorder-sad/treatment/'
  },
  {
    keys: ['routine', 'schedule', 'social rhythm', 'structure'],
    title: 'Routine & Social Rhythms',
    body: 'Bipolar brains are particularly sensitive to routine disruption. Anchoring a few daily fixed points — wake time, first meal, first social contact, evening wind-down — gives the body clock something to lock onto. Big life events (new job, baby, bereavement, breakups) disrupt rhythms predictably; building extra support around them rather than relying on willpower is the standard advice.',
    link: 'https://www.bipolaruk.org/'
  },
  {
    keys: ['diet', 'food', 'nutrition', 'omega', 'mediterranean', 'vitamin d'],
    title: 'Diet & Nutrition',
    body: 'No "bipolar diet" exists, but a few patterns matter: blood-sugar swings can amplify mood swings (regular meals, less ultra-processed food), omega-3s have small adjunctive evidence, vitamin D deficiency is common and worth checking, and several mood stabilisers (lithium especially) drive weight gain — early conversations with a dietitian beat trying to claw it back later. Avoid grapefruit on some antipsychotics (it interferes with metabolism).',
    link: 'https://www.nhs.uk/live-well/eat-well/'
  },
  {
    keys: ['cannabis', 'weed', 'marijuana', 'mdma', 'cocaine', 'recreational drugs', 'psychedelics'],
    title: 'Cannabis & Recreational Drugs',
    body: 'Cannabis is the most-used and most-studied: regular use roughly doubles psychosis risk in bipolar and worsens episode length and severity. Stimulants (cocaine, MDMA, amphetamine) can directly trigger manic switches; psychedelics (LSD, psilocybin) carry similar risk and limited evidence in bipolar, despite the depression research in unipolar populations. Talk to your prescriber honestly — they\'ve heard it all and need the full picture to dose your meds.',
    link: 'https://www.talktofrank.com/'
  }
];

const _WARNING_SIGNS = [
  {
    keys: ['mania prodrome', 'early mania', 'manic warning', 'hypomania signs', 'prodrome'],
    title: 'Early Signs of Mania / Hypomania',
    body: 'Common early shifts (often 1–4 weeks before a full episode): sleep dropping by an hour or two with no fatigue; new projects appearing out of nowhere; speech speeding up or thoughts feeling crowded; spending or sexual impulses rising; irritability with people who "don\'t get it"; religious or grandiose ideas creeping in; reduced need for food. If others around you have started asking "are you OK?" — that itself is a warning sign.',
    link: 'https://www.nhs.uk/mental-health/conditions/bipolar-disorder/symptoms/'
  },
  {
    keys: ['depression prodrome', 'early depression', 'depressive warning'],
    title: 'Early Signs of Depression',
    body: 'Often: sleep increasing or fragmenting (early morning waking); appetite changes; replies to texts getting shorter or stopping; reduced enjoyment in things you usually like; physical heaviness; concentration dropping; a creeping sense of dread or self-criticism. Some people first notice it as a loss of music — songs that used to move you stop landing.',
    link: 'https://www.nhs.uk/mental-health/conditions/bipolar-disorder/symptoms/'
  },
  {
    keys: ['mixed warning', 'mixed prodrome', 'dysphoric early signs'],
    title: 'Early Signs of Mixed States',
    body: 'Mixed states often start with the worst of both poles: tired but unable to sleep, slowed-down body with racing thoughts, hopeless mood with agitated energy, or irritability that swings between tears and rage within hours. Suicide risk is elevated because energy is present even when motivation isn\'t. If this pattern shows up, call your CMHT or crisis team — don\'t wait it out.',
    link: 'https://www.nhs.uk/mental-health/conditions/bipolar-disorder/symptoms/'
  },
  {
    keys: ['relapse signature', 'warning signs list', 'personal warning'],
    title: 'Building Your Relapse Signature',
    body: 'A relapse signature is a personalised checklist of your earliest, most reliable warning signs — usually 5–10 items, ordered from "subtle" to "obvious". Build it by reviewing past episodes with a clinician, a family member, or your journal. Share it with one or two trusted people who can flag changes you might miss. Update it after every episode, since the signature can drift over years.',
    link: 'https://www.bipolaruk.org/'
  },
  {
    keys: ['when to call', 'cmht', 'gp', 'help', 'who to call'],
    title: 'When to Call Your CMHT or GP',
    body: 'Call your CMHT (Community Mental Health Team) or care coordinator if: warning signs are clearly building over more than a few days, you\'ve missed doses or sleep, you\'ve started spending or risk-taking, or family are concerned. Call your GP if you don\'t have a CMHT, or for changes that are uncomfortable but not yet urgent. They can refer or fast-track you. Earlier always beats later — there\'s no "wasting their time".',
    link: 'https://www.nhs.uk/nhs-services/mental-health-services/'
  },
  {
    keys: ['crisis line', 'samaritans', 'shout', 'crisis', '111'],
    title: 'When to Call a Crisis Line',
    body: 'For active distress, suicidal thoughts, or "I don\'t know what to do right now": Samaritans 116 123 (free, 24/7, any reason), Shout text 85258 (text-based, 24/7), NHS 111 option 2 (urgent mental health), or your local CMHT\'s crisis line if you have one. Bipolar UK\'s eCommunity and peer support line are also worth saving in your phone before you need them.',
    link: 'https://www.samaritans.org/'
  },
  {
    keys: ['a&e', 'emergency', '999', 'er', 'urgent'],
    title: 'When to Go to A&E or Call 999',
    body: 'Go to A&E or call 999 if: you are about to act on suicidal thoughts, you\'ve taken an overdose or harmed yourself seriously, you are experiencing psychosis or losing touch with reality, or you cannot keep yourself safe. A&E mental-health liaison teams can assess and refer; if there is risk to life, ambulance or police can help under Section 136 in public or Section 135 with a warrant at home.',
    link: 'https://www.nhs.uk/nhs-services/urgent-and-emergency-care-services/when-to-go-to-ae/'
  }
];

const _SIDE_EFFECTS = [
  {
    keys: ['weight gain', 'metabolic', 'diabetes', 'olanzapine weight', 'quetiapine weight'],
    title: 'Weight Gain & Metabolic Effects',
    body: 'Common with most antipsychotics (olanzapine and quetiapine in particular), lithium, and valproate. Mechanism is mixed: appetite increase, slower metabolism, fluid retention, sedation cutting exercise. Annual blood tests for HbA1c, lipids, and weight are standard. Mitigations: pre-emptive dietitian referral, weight-neutral alternatives (aripiprazole, lurasidone), metformin add-on, and not assuming "willpower" alone can outpace the drug.',
    link: 'https://www.nhs.uk/mental-health/conditions/bipolar-disorder/treatment/'
  },
  {
    keys: ['tremor', 'shaking', 'lithium tremor'],
    title: 'Tremor',
    body: 'Fine hand tremor is common with lithium (especially at higher levels) and valproate. Worsens with caffeine, anxiety, and high doses. Usually mild and stable — if it suddenly worsens, ask for a lithium level (could be toxicity). Mitigations: split the dose, drop caffeine, propranolol 10–40mg as needed, or a small dose reduction with your prescriber.',
    link: 'https://www.nhs.uk/conditions/lithium-medicine/side-effects-of-lithium/'
  },
  {
    keys: ['brain fog', 'cognitive', 'dulling', 'slow thinking', 'word finding'],
    title: 'Cognitive Dulling / Brain Fog',
    body: 'A real and under-acknowledged side effect of lithium, valproate, topiramate (nicknamed "dopamax"), and some antipsychotics. Word-finding lapses, slower recall, less creative momentum. Some of it is the medication, some is residual depression, some is sleep meds carrying over. Worth distinguishing before assuming — and worth raising with your prescriber, as switching agents can help.',
    link: 'https://www.bipolaruk.org/'
  },
  {
    keys: ['sedation', 'grogginess', 'tired', 'sleepy', 'med hangover'],
    title: 'Sedation & Morning Grogginess',
    body: 'Often the first side effect of antipsychotics, mirtazapine, and some mood stabilisers. Frequently eases over 2–4 weeks. If not: shift the dose to earlier in the evening, split it, or ask about switching. Heavy "med hangover" until midday is not something to push through silently — it\'s usually fixable.',
    link: 'https://www.nhs.uk/mental-health/conditions/bipolar-disorder/treatment/'
  },
  {
    keys: ['libido', 'sexual', 'sex drive', 'erectile', 'anorgasmia'],
    title: 'Libido & Sexual Function',
    body: 'SSRIs are the worst offenders (low libido, delayed orgasm, anorgasmia); antipsychotics and mood stabilisers can also reduce desire or contribute to erectile dysfunction. Often under-reported because patients are too embarrassed to mention it. Tell your prescriber — switching agents (bupropion, mirtazapine, aripiprazole), dose tweaks, and short drug holidays under guidance can all help.',
    link: 'https://www.nhs.uk/conditions/ssri-antidepressants/side-effects/'
  },
  {
    keys: ['akathisia', 'restlessness', 'cant sit still', 'inner restlessness'],
    title: 'Akathisia',
    body: 'An inner, agonising restlessness — usually pacing, jiggling legs, unable to stay still — caused by antipsychotics (haloperidol, aripiprazole, risperidone, and others). Easy to mistake for anxiety or agitation. Distressing enough that it can drive suicidal thoughts on its own. Tell your prescriber urgently: a dose reduction, switch, or addition of propranolol or a short-term benzodiazepine usually helps.',
    link: 'https://www.bipolaruk.org/'
  },
  {
    keys: ['blood test', 'lithium level', 'valproate level', 'monitoring', 'tdm'],
    title: 'Blood Tests (Lithium & Valproate)',
    body: 'Lithium needs 12-hour-post-dose blood levels — weekly when starting, then 3–6 monthly once stable; therapeutic range 0.4–1.0 mmol/L. Plus kidney function (U&Es), thyroid function (TFTs), and calcium annually. Valproate doesn\'t strictly require level monitoring but liver function and platelets are checked at baseline and periodically. Skipping bloods is the single biggest cause of avoidable toxicity.',
    link: 'https://www.nhs.uk/conditions/lithium-medicine/'
  },
  {
    keys: ['dry mouth', 'thirst', 'polydipsia'],
    title: 'Dry Mouth & Thirst',
    body: 'Lithium increases thirst by affecting kidney water handling; antipsychotics and antidepressants cause dry mouth via anticholinergic effects. Heavy thirst (over 3L water/day, frequent night urination) on lithium needs investigating — could be early lithium-induced diabetes insipidus, which is reversible if caught. Sugar-free gum, frequent sips, and humidifiers help dry mouth; bedside water is fine, gallons of fluid is not.',
    link: 'https://www.nhs.uk/conditions/lithium-medicine/side-effects-of-lithium/'
  },
  {
    keys: ['constipation', 'gi', 'gut', 'nausea', 'diarrhoea', 'clozapine bowel'],
    title: 'Constipation & GI Effects',
    body: 'Clozapine famously causes severe constipation (occasionally fatal — take laxatives proactively). Lithium and valproate often cause nausea or loose stools, usually settling within 2 weeks. Take meds with food, split doses, and use enteric-coated or slow-release versions if available. New or severe abdominal pain on clozapine is urgent — go to A&E.',
    link: 'https://www.nhs.uk/mental-health/conditions/bipolar-disorder/treatment/'
  }
];

const _HOSPITAL = [
  {
    keys: ['voluntary', 'informal admission', 'admission'],
    title: 'Voluntary (Informal) Admission',
    body: 'You agree to come in for treatment and can in principle leave whenever you want — though staff may ask you to stay and consider sectioning if they think it\'s needed. Most hospital admissions for bipolar are informal. You keep the same rights as any patient: refusing specific medications, having visitors, leaving the ward for a walk. Bring photo ID, charging cable, basic toiletries — phones are usually allowed.',
    link: 'https://www.mind.org.uk/information-support/legal-rights/mental-health-act-1983/about-the-mha-1983/'
  },
  {
    keys: ['section 2', 's2', 'assessment section'],
    title: 'Section 2 — Assessment (28 days)',
    body: 'Up to 28 days, for assessment with or without treatment. Needs two doctors and one Approved Mental Health Professional (AMHP). You have the right to apply to a tribunal in the first 14 days, free legal representation, and an Independent Mental Health Advocate (IMHA). Cannot be renewed — must be discharged, converted to Section 3, or you stay on informally.',
    link: 'https://www.mind.org.uk/information-support/legal-rights/sectioning/section-2/'
  },
  {
    keys: ['section 3', 's3', 'treatment section'],
    title: 'Section 3 — Treatment (up to 6 months)',
    body: 'Up to 6 months, renewable for another 6, then yearly. Same two-doctor + AMHP requirement; the nearest relative must be consulted and can object. Treatment can be given without consent in the first 3 months (with some exceptions like ECT). Same tribunal and advocate rights. Discharge can also come from the responsible clinician or the hospital managers.',
    link: 'https://www.mind.org.uk/information-support/legal-rights/sectioning/section-3/'
  },
  {
    keys: ['section 5(2)', 's5(2)', '52', 'holding power'],
    title: 'Section 5(2) — Doctor\'s Holding Power (72 hours)',
    body: 'A short-term hold used when you\'ve gone in voluntarily but want to leave and the doctor thinks you need detaining. Lasts up to 72 hours while a full Section 2 or 3 assessment is arranged. Nurses have a similar 6-hour power under Section 5(4). Cannot be used in A&E — only on an inpatient ward.',
    link: 'https://www.mind.org.uk/information-support/legal-rights/sectioning/section-5/'
  },
  {
    keys: ['section 136', 's136', '136', 'police section'],
    title: 'Section 136 — Police Powers in Public',
    body: 'Police can take someone from a public place to a "place of safety" (usually a hospital 136 suite) for up to 24 hours (extendable to 36) when they appear to need urgent mental-health care. You haven\'t been arrested — it\'s a protective power. The clock starts when you arrive at the place of safety. You\'ll be assessed by a doctor and AMHP and either released, kept informally, or moved to Section 2 or 3.',
    link: 'https://www.mind.org.uk/information-support/legal-rights/police-and-mental-health/'
  },
  {
    keys: ['rights', 'imha', 'advocate', 'tribunal', 'patient rights'],
    title: 'Your Rights as a Sectioned Patient',
    body: 'Even when sectioned you keep the right to: free legal aid for tribunals, an Independent Mental Health Advocate (IMHA), have your care plan explained, receive visitors (within reason), correspondence in and out, complain via PALS, refuse most treatments (Section 3 has limits), and have a named nearest relative who can request your discharge. Mind and Rethink both run advocacy services.',
    link: 'https://www.mind.org.uk/information-support/legal-rights/'
  },
  {
    keys: ['what to pack', 'hospital bag', 'admission pack'],
    title: 'What to Pack',
    body: 'Comfortable clothes (drawstring trousers — belts and laces are restricted on some wards), pyjamas, slippers, toiletries (some items may be locked in), phone and charger (cable rules vary), books, ear plugs, eye mask, paper and pens, a written list of your meds and doses, photo ID, glasses if you wear them, and a small amount of cash. Leave valuables and razors at home — the ward will provide alternatives.',
    link: 'https://www.bipolaruk.org/'
  },
  {
    keys: ['discharge', 'section 117', 'aftercare', 's117'],
    title: 'Discharge & Section 117 Aftercare',
    body: 'After Section 3 (and some other sections), you\'re entitled to free aftercare under Section 117 — typically a care coordinator, follow-up appointments, support with housing or benefits, and any community treatment needs. This can\'t legally be charged for. Push for a clear discharge plan in writing before you leave: who your care coordinator is, when the first appointment is, what to do if you start declining again.',
    link: 'https://www.mind.org.uk/information-support/legal-rights/leaving-hospital/'
  }
];

const _WORKPLACE = [
  {
    keys: ['equality act', 'disability', 'discrimination', 'protected characteristic'],
    title: 'Equality Act 2010 & Disability Status',
    body: 'Bipolar disorder (and most long-term mental health conditions) usually counts as a "disability" under the Equality Act 2010 — meaning a substantial and long-term effect on day-to-day life. That triggers protection from discrimination, harassment, and victimisation at work, plus a positive duty on employers to make reasonable adjustments. You don\'t need a formal employer-side diagnosis; documentation from your GP or psychiatrist is enough.',
    link: 'https://www.gov.uk/definition-of-disability-under-equality-act-2010'
  },
  {
    keys: ['reasonable adjustments', 'adjustments', 'workplace accommodations'],
    title: 'Reasonable Adjustments',
    body: 'Adjustments your employer should consider include: phased return after sickness, flexible hours around medication side effects, working from home some days, a quieter workspace, written instructions instead of verbal, regular 1:1s, swapping client-facing tasks during episodes, time off for appointments. Request them in writing; "I am asking for a reasonable adjustment under the Equality Act" makes it clear. Refusal needs a justifiable business reason.',
    link: 'https://www.acas.org.uk/reasonable-adjustments'
  },
  {
    keys: ['access to work', 'atw', 'aw scheme'],
    title: 'Access to Work Scheme',
    body: 'A UK government grant that pays for support to start or stay in work — covering coaching, assistive tech, taxis if you can\'t use transport, or a mental-health support worker. Apply online; an assessor talks through what helps. The employer doesn\'t pay (small employers receive 100% of costs, larger ones pay a share above a threshold). One of the most under-used resources in mental-health employment.',
    link: 'https://www.gov.uk/access-to-work'
  },
  {
    keys: ['sick note', 'fit note', 'med3', 'doctor note'],
    title: 'Sick Notes / Fit Notes',
    body: 'After 7 days off sick you need a "fit note" from your GP (formerly called a sick note). It can say "not fit for work" or "may be fit with adjustments" (phased return, reduced hours, altered duties). You can self-certify for the first 7 days. Fit notes are confidential — your employer doesn\'t need the diagnosis, only the work capacity. They can also be issued by psychiatrists, nurses, OTs, and pharmacists.',
    link: 'https://www.gov.uk/taking-sick-leave'
  },
  {
    keys: ['disclosure', 'telling employer', 'disclose', 'tell work'],
    title: 'Disclosure: To Tell or Not',
    body: 'No legal duty to disclose at application or interview unless asked directly about a relevant condition (and "relevant" is narrow). Pros of disclosing: triggers Equality Act protection, unlocks adjustments, removes the secret. Cons: real-world stigma still exists in some sectors. A common pattern is to disclose later (not at interview) — once probation passes, in a 1:1 with HR, with a written summary of what you need.',
    link: 'https://www.mind.org.uk/workplace/'
  },
  {
    keys: ['pip', 'personal independence', 'disability benefit'],
    title: 'PIP — Personal Independence Payment',
    body: 'A non-means-tested benefit for people with long-term conditions affecting daily living or mobility — including mental health. Two parts (daily living, mobility), two rates (standard, enhanced). The form is long and the descriptors don\'t fit mental health well; charities (Mind, Citizens Advice, Bipolar UK) provide free help with applications and appeals. Many successful claims are won at tribunal, so don\'t take a first refusal as final.',
    link: 'https://www.gov.uk/pip'
  },
  {
    keys: ['universal credit', 'uc', 'limited capability', 'lcw', 'lcwra'],
    title: 'Universal Credit & Limited Capability',
    body: 'If you can\'t work or can only work limited hours, the "limited capability for work" (LCW) or "limited capability for work and work-related activity" (LCWRA) elements of Universal Credit add money and remove the work-search requirement. Triggered by a work capability assessment after sustained fit notes. Plan around the timing — there\'s usually a 3-month wait before payments start.',
    link: 'https://www.gov.uk/universal-credit'
  },
  {
    keys: ['return to work', 'phased return', 'after episode'],
    title: 'Returning to Work After an Episode',
    body: 'A phased return — reduced hours building back over 2–4 weeks — is the standard pattern, agreed between you, your GP, and HR or Occupational Health. Ask for: a return-to-work meeting before day one, an agreed first-day workload, time excluded from on-call rotas, regular check-ins for 4–6 weeks, and a clear plan if things slip. Many people relapse on return because they go too fast — slower is safer.',
    link: 'https://www.acas.org.uk/returning-to-work-after-absence'
  }
];

const _PREGNANCY = [
  {
    keys: ['preconception', 'pre-conception', 'planning pregnancy', 'trying to conceive'],
    title: 'Pre-Conception Planning',
    body: 'Ideally start the conversation 6–12 months before trying to conceive. Topics: which meds are safest to continue (lamotrigine, some antipsychotics, lithium with monitoring), which to taper off (valproate is contraindicated for pregnancy in most circumstances), folic acid 5mg daily, perinatal mental-health team referral, contingency plan for relapse, and partner involvement. Coming off all meds for pregnancy almost always relapses; informed continuation is the usual safer path.',
    link: 'https://www.rcpsych.ac.uk/mental-health/mental-illnesses-and-mental-health-problems/planning-a-pregnancy'
  },
  {
    keys: ['lithium pregnancy', 'lithium baby', 'ebstein'],
    title: 'Lithium in Pregnancy',
    body: 'Once thought catastrophic; current evidence is more nuanced — there\'s a small increase in cardiac malformations (Ebstein\'s anomaly) when used in the first trimester (around 0.6% vs 0.18% background), and risk of neonatal complications around delivery. Levels can shift dramatically because of changing fluid volumes and kidney function — monthly bloods through pregnancy, weekly near delivery, and held briefly around labour. Often a reasonable continuation for high-relapse-risk patients.',
    link: 'https://www.nhs.uk/conditions/lithium-medicine/pregnancy-and-breastfeeding/'
  },
  {
    keys: ['valproate pregnancy', 'sodium valproate', 'epilim', 'pregnancy prevention'],
    title: 'Valproate & the Pregnancy Prevention Programme',
    body: 'Valproate carries roughly a 10% risk of major birth defects and a 30–40% risk of developmental disorder when taken in pregnancy — the highest of any commonly-used psychiatric drug. Since 2018 it\'s banned in pregnancy in the UK except in extreme circumstances, and people of childbearing potential must be on the Pregnancy Prevention Programme (annual specialist review plus reliable contraception). Talk to your prescriber about switching if you might become pregnant.',
    link: 'https://www.gov.uk/government/publications/valproate-use-by-women-and-girls'
  },
  {
    keys: ['medications pregnancy', 'antipsychotic pregnancy', 'lamotrigine pregnancy'],
    title: 'Other Medications in Pregnancy',
    body: 'Lamotrigine has the most reassuring data among mood stabilisers and is generally considered safer. Olanzapine and quetiapine have moderate data; gestational diabetes risk is the main flag. SSRIs are widely used in pregnancy with small absolute risks. Benzodiazepines and z-drugs are avoided where possible. Always weigh against the harm of an untreated episode, which carries real risk to both parent and baby.',
    link: 'https://www.rcpsych.ac.uk/mental-health/mental-illnesses-and-mental-health-problems/mental-health-in-pregnancy'
  },
  {
    keys: ['perinatal team', 'perinatal mental health', 'pmh team'],
    title: 'Perinatal Mental Health Teams',
    body: 'NHS specialist teams that look after pregnant and recently-postpartum people with serious mental illness. Available in most parts of England (less consistent elsewhere in the UK). Referrals from GP, midwife, or self-referral via the trust. They liaise with your obstetric team, monitor mood through pregnancy, plan delivery, and arrange postpartum support. Ask your midwife about local services as soon as pregnancy is confirmed.',
    link: 'https://www.england.nhs.uk/mental-health/perinatal/'
  },
  {
    keys: ['postpartum psychosis', 'puerperal psychosis', 'pp'],
    title: 'Postpartum Psychosis',
    body: 'A psychiatric emergency affecting 1 in 1000 births overall, but 25–50% of births in women with bipolar I. Onset is usually in the first 2 weeks postpartum, often abrupt. Symptoms: confusion, paranoia, mania, hallucinations, severe insomnia. Treatable but always needs immediate admission, ideally to a Mother & Baby Unit. Pre-emptive lithium or antipsychotic prophylaxis is standard for high-risk patients in the week after birth.',
    link: 'https://www.app-network.org/'
  },
  {
    keys: ['breastfeeding', 'nursing', 'lactation', 'breast milk meds'],
    title: 'Breastfeeding & Medication',
    body: 'Many psychiatric meds pass into breast milk but at much lower doses than in pregnancy. Lithium is generally avoided (high transfer, infant blood monitoring needed if used). Lamotrigine and sertraline are commonly considered compatible. Olanzapine and quetiapine carry sedation risk for the baby. The Breastfeeding Network drug factsheets and the LactMed database are the best references; perinatal teams can advise on individual decisions.',
    link: 'https://www.breastfeedingnetwork.org.uk/detailed-information/drugs-factsheets/'
  },
  {
    keys: ['mother and baby unit', 'mbu', 'inpatient mother', 'mother baby'],
    title: 'Mother & Baby Units (MBUs)',
    body: 'Specialist NHS inpatient wards where a mother with severe perinatal mental illness can be admitted with her baby (under 12 months, sometimes older). Outcomes are far better than separating mother and infant. There are around 22 MBUs across the UK — sometimes admission means travelling. Action on Postpartum Psychosis (APP) maintains a current map and a peer-support network for mothers who have been through PP.',
    link: 'https://www.app-network.org/what-is-pp/getting-help/mbus/'
  }
];

const _MEDIA = [
  {
    keys: ['unquiet mind', 'jamison', 'kay redfield', 'kay jamison', 'book'],
    title: 'An Unquiet Mind — Kay Redfield Jamison (book)',
    body: 'The defining memoir of bipolar I, written by a clinical psychologist who has the illness herself. Published 1995 and still the first book most newly-diagnosed people are recommended. Beautifully written, unflinching about the manic highs as well as the costs. Pairs well with her later book Touched with Fire on the link between mood disorders and creativity.',
    link: 'https://en.wikipedia.org/wiki/An_Unquiet_Mind',
    cover: 'images/wiki-media/an-unquiet-mind.jpg'
  },
  {
    keys: ['madness', 'hornbacher', 'marya', 'book'],
    title: 'Madness: A Bipolar Life — Marya Hornbacher (book)',
    body: 'The younger, rawer, more chaotic counterpoint to Jamison — Hornbacher\'s memoir covers rapid cycling, substance use, eating disorders, and years of misdiagnosis before finding the right meds. Some readers find it triggering; others find it the only book that names what their life has felt like. Honest about how long it can take to find stability.',
    link: 'https://en.wikipedia.org/wiki/Madness:_A_Bipolar_Life',
    cover: 'images/wiki-media/madness-bipolar-life.jpg'
  },
  {
    keys: ['miklowitz', 'survival guide', 'bipolar survival', 'book'],
    title: 'The Bipolar Disorder Survival Guide — David Miklowitz (book)',
    body: 'The standard "what to actually do" handbook by one of the world\'s leading bipolar researchers (and developer of Family-Focused Therapy). Practical chapters on mood charting, prodrome work, talking to family, choosing therapy, managing meds. Now in its 4th edition. Less literary than the memoirs but the one to give a partner or parent.',
    link: 'https://www.guilford.com/books/The-Bipolar-Disorder-Survival-Guide/David-Miklowitz/9781462553624',
    cover: 'images/wiki-media/bipolar-survival-guide.jpg'
  },
  {
    keys: ['electroboy', 'behrman', 'ect memoir', 'book'],
    title: 'Electroboy — Andy Behrman (book)',
    body: 'A wild memoir of New York art-world mania, fraud, and ultimately ECT (electroconvulsive therapy) — which Behrman credits with saving his life. Unusual for being honest about ECT working when nothing else did. Hard, often uncomfortable, and very funny in places.',
    link: 'https://en.wikipedia.org/wiki/Electroboy',
    cover: 'images/wiki-media/electroboy.jpg'
  },
  {
    keys: ['manic', 'terri cheney', 'cheney', 'book'],
    title: 'Manic — Terri Cheney (book)',
    body: 'A non-chronological memoir of life with treatment-resistant bipolar I, structured as discrete mood-driven episodes rather than a linear story. Cheney is a former entertainment lawyer; the writing is sharp and the structure mirrors the disorder itself. Her New York Times essay later became the Modern Love TV episode below.',
    link: 'https://en.wikipedia.org/wiki/Terri_Cheney',
    cover: 'images/wiki-media/manic-cheney.jpg'
  },
  {
    keys: ['silver linings', 'silver linings playbook', 'cooper', 'lawrence', 'film'],
    title: 'Silver Linings Playbook (2012) — film',
    body: 'Bradley Cooper plays a recently-discharged bipolar I man trying to rebuild after a manic episode. The first big mainstream film to portray bipolar with sympathy and humour. Slightly oversimplifies the recovery arc, but the depiction of mood swings, family dynamics, and the dance between mania and grief lands well. Based on Matthew Quick\'s novel.',
    link: 'https://en.wikipedia.org/wiki/Silver_Linings_Playbook',
    cover: 'images/wiki-media/silver-linings-playbook.jpg'
  },
  {
    keys: ['touched with fire', 'paul dalio', 'film 2015'],
    title: 'Touched with Fire (2015) — film',
    body: 'Two poets with bipolar meet in a psychiatric hospital and fall into a relationship that swings between transcendence and disaster. Written and directed by Paul Dalio, who has bipolar himself, with Kay Redfield Jamison consulting. Slow and sometimes uneven, but honest about the seductive pull of mania and the impossible choice between medication and intensity.',
    link: 'https://en.wikipedia.org/wiki/Touched_with_Fire_(film)',
    cover: 'images/wiki-media/touched-with-fire.jpg'
  },
  {
    keys: ['mr jones', 'richard gere', 'figgis', 'film'],
    title: 'Mr Jones (1993) — film',
    body: 'Richard Gere plays a man with untreated bipolar disorder; Lena Olin is the psychiatrist who treats him. Of its era — the diagnostic language is dated, the romance subplot is dubious — but the manic sequences (particularly the conductor scene) remain one of the most accurate depictions of mania on screen.',
    link: 'https://en.wikipedia.org/wiki/Mr._Jones_(1993_film)',
    cover: 'images/wiki-media/mr-jones.jpg'
  },
  {
    keys: ['polar bear', 'infinitely polar bear', 'maya forbes', 'mark ruffalo', 'film'],
    title: 'Infinitely Polar Bear (2014) — film',
    body: 'Mark Ruffalo plays a father with bipolar disorder caring for his two young daughters in 1970s Boston while his wife trains in another city. Based on writer/director Maya Forbes\'s own childhood. Gentle, funny, accurate about the texture of living with a parent who has bipolar — without sanitising it.',
    link: 'https://en.wikipedia.org/wiki/Infinitely_Polar_Bear',
    cover: 'images/wiki-media/infinitely-polar-bear.jpg'
  },
  {
    keys: ['modern love', 'anne hathaway', 'whoever i am', 'tv'],
    title: 'Modern Love S1E3 — "Take Me as I Am" (TV)',
    body: 'Anne Hathaway plays a successful lawyer hiding bipolar I — and the swing-of-the-pendulum mid-episode is one of the most accessible portrayals of bipolar on screen. Adapted from Terri Cheney\'s New York Times essay (Cheney also wrote Manic). 30 minutes. Worth showing to family who want to understand.',
    link: 'https://en.wikipedia.org/wiki/Modern_Love_(TV_series)',
    cover: 'images/wiki-media/modern-love-take-me-as-i-am.jpg'
  },
  {
    keys: ['stephen fry', 'manic depressive', 'documentary'],
    title: 'Stephen Fry: The Secret Life of the Manic Depressive (2006) — documentary',
    body: 'BBC documentary in which Stephen Fry — who has bipolar I — interviews celebrities, clinicians, and ordinary people about the illness. The language is slightly dated now but it holds up as a humane, intelligent introduction. The 2016 follow-up The Not So Secret Life of the Manic Depressive: 10 Years On picks up where it left off.',
    link: 'https://en.wikipedia.org/wiki/Stephen_Fry:_The_Secret_Life_of_the_Manic_Depressive',
    cover: 'images/wiki-media/stephen-fry-secret-life.jpg'
  },
  {
    keys: ['bipolar podcast', 'bipolar uk podcast', 'inside bipolar', 'podcast'],
    title: 'Bipolar Podcasts — Bipolar UK / Inside Bipolar / MIHH',
    body: 'A range of bipolar-focused podcasts exist. The Bipolar UK Podcast is the UK peer-led option; Inside Bipolar (Psych Central) is an honest US-based show co-hosted by people with and treating the condition; Mental Illness Happy Hour by Paul Gilmartin covers a wider mental-health landscape with frequent bipolar episodes. All free on major podcast apps.',
    link: 'https://www.bipolaruk.org/',
    cover: 'images/wiki-media/bipolar-podcasts.jpg'
  }
];

const _LOVED_ONES = [
  {
    keys: ['spot warning', 'early signs partner', 'noticing change', 'family warning'],
    title: 'Spotting the Early Signs',
    body: 'You\'ll often see prodromal symptoms before your loved one does — they\'re sometimes the last to notice. Common changes: sleep patterns shifting, irritability creeping up, spending or risk-taking rising, withdrawal from texts and plans, or unusual energy and grandiose ideas. Ask in a calm moment to be told what you should look out for, write it down together, and agree how you\'ll raise it when you see it. A pre-agreed phrase ("can we check the warning list?") is less inflammatory in the moment than "I think you\'re manic".',
    link: 'https://www.bipolaruk.org/Pages/Category/family-and-friends'
  },
  {
    keys: ['what to say', 'language', 'how to talk', 'comfort', 'communication'],
    title: 'What to Say (and What Not to Say)',
    body: 'Helpful: "I\'m here, what do you need right now?", "I noticed you haven\'t slept much — how are you doing?", "I love you. This is the illness, not you." Unhelpful: "Just snap out of it", "Cheer up", or "Have you taken your meds?" used as a constant question. Validate first, problem-solve later. Don\'t argue with delusions during mania — neither agreeing nor pushing back works; redirecting to safety usually does.',
    link: 'https://www.mind.org.uk/information-support/helping-someone-else/'
  },
  {
    keys: ['mania help', 'manic episode', 'helping mania', 'partner mania'],
    title: 'Helping During a Manic Episode',
    body: 'Mania can feel like watching someone you love drive at speed with no brakes. Practical anchors: limit credit-card or banking access if agreed in advance, reduce stimulating environments, protect sleep, avoid escalation arguments (the brain isn\'t fully online), and call the CMHT or crisis team before things require A&E. Keep a written record of what you observe and when — clinicians find timestamped notes invaluable. Don\'t try to do it alone; bring in other family or friends in shifts.',
    link: 'https://www.bipolaruk.org/Pages/Category/family-and-friends'
  },
  {
    keys: ['depression help', 'depressive episode', 'helping depression', 'partner depression'],
    title: 'Helping During a Depressive Episode',
    body: 'Depression often steals the ability to ask for help. Small, low-demand acts beat grand gestures: drop off food, sit nearby without expectation, suggest one small walk, handle one piece of admin. Avoid pressuring "you need to get out more" — agency is part of what\'s broken. Watch for hopelessness, giving away possessions, or sudden calm after distress — those can signal active suicide risk. Ask directly about suicidal thoughts; asking does not "plant the idea", and the evidence on this is clear.',
    link: 'https://www.samaritans.org/how-we-can-help/if-youre-worried-about-someone-else/'
  },
  {
    keys: ['hospital partner', 'admission carer', 'visiting hospital', 'inpatient support'],
    title: 'Supporting Through a Hospital Admission',
    body: 'Visit regularly even if conversations are short; bring familiar things (favourite snacks, photos, a familiar jumper) within the ward\'s rules. Ask to be involved in care-planning meetings — as a "nearest relative" under the Mental Health Act you have specific rights, including the right to be consulted about a Section 3 and to apply for discharge. Keep your own life going where you can; visiting is a marathon, not a sprint, and the recovery period after discharge is often harder than the admission itself.',
    link: 'https://www.rethink.org/advice-and-information/carers-hub/'
  },
  {
    keys: ['carer wellbeing', 'caregiver burnout', 'looking after yourself', 'compassion fatigue', 'self care carer'],
    title: 'Looking After Yourself',
    body: 'Carer burnout is real and predictable. The cycle is exhausting — episodes, recovery, fear of the next one — and trying to be the sole safety net is unsustainable. Keep at least one space that\'s just yours (a sport, a friendship, your own therapy), accept help when offered, and don\'t let care duties absorb every relationship. You can\'t pour from an empty cup, and a burned-out carer is no good to anyone. Carers UK runs a free helpline; Bipolar UK has a dedicated peer line for family and friends.',
    link: 'https://www.carersuk.org/help-and-advice/'
  },
  {
    keys: ['carer rights', 'carers assessment', 'carer act', 'nearest relative', 'carers allowance'],
    title: 'Your Rights as a Carer',
    body: 'In the UK, anyone providing unpaid care is entitled to a free Carer\'s Assessment via the local authority — covering practical, financial, and emotional support. Carer\'s Allowance is means-tested but worth checking. Under the Mental Health Act, the "nearest relative" (a specific legal role, not always the closest person) has standing including the right to apply for discharge from Section 2 or 3 and to be consulted about admissions. The Carers Act 2014 places duties on local councils to support carers in their own right.',
    link: 'https://www.gov.uk/carers-assessment'
  },
  {
    keys: ['when to call', 'crisis carer', 'urgent help', 'emergency family', 'calling 999'],
    title: 'When to Call for Help',
    body: 'Call the CMHT or crisis team if warning signs are building, sleep is being lost, or your loved one is talking about harm. Call 999 or take them to A&E if they are about to act on suicidal thoughts, have harmed themselves seriously, are out of touch with reality, or you can\'t keep them safe. As a carer in your own right, Samaritans (116 123), Bipolar UK\'s Family Line, and your own GP are available to you separately — you don\'t need to be the patient to make the call.',
    link: 'https://www.nhs.uk/mental-health/advice-for-life-situations-and-events/help-for-suicidal-thoughts/'
  }
];

// Wiki articles are authored in English (the arrays below double as the search
// source + English fallback). Translations live under anon.wiki.a.<slug>_<field>
// keyed by a deterministic slug of the English title, so no per-article id is
// needed. _wikiTxt returns the active-locale string, or the English source when
// that locale has no translation for the key.
function _wikiSlug(t) {
  return String(t).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
}
function _wikiTxt(obj, field) {
  if (!obj || !obj[field]) return (obj && obj[field]) || '';
  const k = 'anon.wiki.a.' + _wikiSlug(obj.title) + '_' + field;
  const v = _wt(k);
  return v === k ? obj[field] : v;
}

function _renderWikiSimpleCards(items, disclaimerKey, defaultLinkLabelKey) {
  const body = document.getElementById('wiki-body');
  if (!body) return;
  const disclaimer = disclaimerKey
    ? `<div class="wiki-disclaimer">${esc(_wt(disclaimerKey))}<br><span class="wiki-disclaimer-src">${esc(_wt('anon.wiki.ukGuidance'))}</span></div>`
    : '';
  const defaultLabel = _wt(defaultLinkLabelKey || 'anon.wiki.moreInfo');
  body.innerHTML = disclaimer + items.map(c => {
    const _t = _wikiTxt(c, 'title'), _b = _wikiTxt(c, 'body');
    const search = (_t + ' ' + c.title + ' ' + _b + ' ' + (c.keys || []).join(' ')).toLowerCase();
    const link = c.link || c.nhs;
    const sourceMeta = _wikiSourceMetaHtml(link, c.source);
    const linkLabel = c.linkLabel || _wikiLinkLabel(link, defaultLabel);
    const linkHtml = link
      ? `<a href="${esc(link)}" target="_blank" rel="noopener" class="wiki-link-btn">${esc(linkLabel)}</a>`
      : '';
    // Cover thumbnail (e.g. book cover / film poster). Hides itself on
    // load error so a missing file just looks like a no-cover card.
    const bodyHtml = c.cover
      ? `<div class="wiki-media-row">
          <img class="wiki-media-cover" src="${esc(c.cover)}" alt="" loading="lazy" onerror="this.closest('.wiki-media-row').classList.add('wiki-media-row--no-cover')">
          <p class="wiki-media-text">${esc(_b)}</p>
        </div>`
      : `<p>${esc(_b)}</p>`;
    return `
      <details class="wiki-card" data-wiki-search="${esc(search)}">
        <summary>${esc(_t)}<span class="wiki-chev">▼</span></summary>
        <div class="wiki-card-body">
          ${bodyHtml}
          ${sourceMeta}
          ${linkHtml}
        </div>
      </details>`;
  }).join('');
  applyWikiFilter();
}

function renderWikiTherapies()     { _renderWikiSimpleCards(_THERAPIES,     'anon.wiki.therapiesDisclaimer'); }
function renderWikiLifestyle()     { _renderWikiSimpleCards(_LIFESTYLE,     'anon.wiki.lifestyleDisclaimer'); }
function renderWikiWarningSigns()  { _renderWikiSimpleCards(_WARNING_SIGNS, 'anon.wiki.warningSignsDisclaimer'); }
function renderWikiSideEffects()   { _renderWikiSimpleCards(_SIDE_EFFECTS,  'anon.wiki.sideEffectsDisclaimer'); }
function renderWikiHospital()      { _renderWikiSimpleCards(_HOSPITAL,      'anon.wiki.hospitalDisclaimer'); }
function renderWikiWorkplace()     { _renderWikiSimpleCards(_WORKPLACE,     'anon.wiki.workplaceDisclaimer'); }
function renderWikiPregnancy()     { _renderWikiSimpleCards(_PREGNANCY,     'anon.wiki.pregnancyDisclaimer'); }
function renderWikiMedia()         { _renderWikiSimpleCards(_MEDIA,         'anon.wiki.mediaDisclaimer'); }
function renderWikiLovedOnes()     { _renderWikiSimpleCards(_LOVED_ONES,    'anon.wiki.lovedOnesDisclaimer'); }

function renderWikiConditions() {
  const body = document.getElementById('wiki-body');
  if (!body) return;
  body.innerHTML = `
    <div class="wiki-disclaimer">${esc(_wt('anon.wiki.conditionsDisclaimer'))}<br><span class="wiki-disclaimer-src">${esc(_wt('anon.wiki.ukGuidance'))}</span></div>
    ${_CONDITIONS.map(c => {
      const _t = _wikiTxt(c, 'title'), _b = _wikiTxt(c, 'body');
      const search = (_t + ' ' + c.title + ' ' + _b + ' ' + (c.keys || []).join(' ')).toLowerCase();
      const sourceMeta = _wikiSourceMetaHtml(c.nhs, c.source);
      const linkLabel = _wikiLinkLabel(c.nhs, _wt('anon.wiki.nhsInfo'));
      return `
        <details class="wiki-card" data-wiki-search="${esc(search)}">
          <summary>${esc(_t)}<span class="wiki-chev">▼</span></summary>
          <div class="wiki-card-body">
            <p>${esc(_b)}</p>
            ${sourceMeta}
            <a href="${esc(c.nhs)}" target="_blank" rel="noopener" class="wiki-link-btn">${esc(linkLabel)}</a>
          </div>
        </details>`;
    }).join('')}
  `;
  applyWikiFilter();
}

function renderWikiMeds() {
  const body = document.getElementById('wiki-body');
  if (!body) return;
  const meds = (window.BB && window.BB.medications && window.BB.medications.list) || [];
  body.innerHTML = `
    <div class="wiki-disclaimer">${esc(_wt('anon.wiki.medsDisclaimer'))}<br><span class="wiki-disclaimer-src">${esc(_wt('anon.wiki.ukGuidance'))}</span></div>
    ${meds.map(m => {
      const _t = _wikiTxt(m, 'title'), _b = _wikiTxt(m, 'body');
      const search = (_t + ' ' + m.title + ' ' + _b + ' ' + (m.keys || []).join(' ')).toLowerCase();
      const sourceMeta = _wikiSourceMetaHtml(m.nhs, m.source);
      const linkLabel = _wikiLinkLabel(m.nhs, _wt('anon.wiki.nhsInfo'));
      return `
        <details class="wiki-card" data-wiki-search="${esc(search)}">
          <summary>${esc(_t)}<span class="wiki-chev">▼</span></summary>
          <div class="wiki-card-body">
            <p>${esc(_b)}</p>
            ${sourceMeta}
            <a href="${esc(m.nhs)}" target="_blank" rel="noopener" class="wiki-link-btn">${esc(linkLabel)}</a>
          </div>
        </details>`;
    }).join('')}
  `;
  applyWikiFilter();
}

async function renderWikiGroups() {
  const body = document.getElementById('wiki-body');
  if (!body) return;
  body.innerHTML = `<div class="wiki-loading">${esc(_wt('anon.wiki.loadingGroups'))}</div>`;
  try {
    if (!_wikiCache.groups) {
      const res = await fetch('data/wiki-support-groups.json', { cache: 'no-cache' });
      _wikiCache.groups = await res.json();
    }
    // Drop the placeholder example entry shipped in the seed file.
    const groups = (_wikiCache.groups.groups || []).filter(g => !/Example/i.test(g.name || ''));
    if (groups.length === 0) {
      // emptyGroups contains a link (HTML); render via innerHTML.
      body.innerHTML = `<div class="wiki-empty">${_wt('anon.wiki.emptyGroups')}</div>`;
      return;
    }
    const byRegion = {};
    groups.forEach(g => {
      const r = g.region || 'Other';
      (byRegion[r] = byRegion[r] || []).push(g);
    });
    body.innerHTML = Object.keys(byRegion).sort().map(region => `
      <h3 class="wiki-region-heading" data-wiki-region="${esc(region)}">${esc(region)}</h3>
      ${byRegion[region].map(g => {
        const search = [g.name, g.region, g.format, g.when, g.location,
                        g.contactName, g.contactEmail, g.contactPhone, g.notes]
                        .filter(Boolean).join(' ').toLowerCase();
        return `
          <details class="wiki-card" data-wiki-search="${esc(search)}" data-wiki-region-card="${esc(region)}">
            <summary>${esc(g.name)}<span class="wiki-chev">▼</span></summary>
            <div class="wiki-card-body">
              ${g.format   ? `<div class="wiki-meta"><strong>${esc(_wt('anon.wiki.format'))}</strong> ${esc(g.format)}</div>` : ''}
              ${g.when     ? `<div class="wiki-meta"><strong>${esc(_wt('anon.wiki.when'))}</strong> ${esc(g.when)}</div>` : ''}
              ${g.location ? `<div class="wiki-meta"><strong>${esc(_wt('anon.wiki.where'))}</strong> ${esc(g.location)}</div>` : ''}
              ${(g.contactName || g.contactEmail || g.contactPhone) ? `<div class="wiki-meta"><strong>${esc(_wt('anon.wiki.contact'))}</strong>
                ${g.contactName  ? ' ' + esc(g.contactName) : ''}
                ${g.contactEmail ? ` <a href="mailto:${esc(g.contactEmail)}">${esc(g.contactEmail)}</a>` : ''}
                ${g.contactPhone ? ` <a href="tel:${esc(g.contactPhone)}">${esc(g.contactPhone)}</a>` : ''}
              </div>` : ''}
              ${g.notes ? `<p class="wiki-notes">${esc(g.notes)}</p>` : ''}
              ${g.link  ? `<a href="${esc(g.link)}" target="_blank" rel="noopener" class="wiki-link-btn">${esc(_wikiLinkLabel(g.link, _wt('anon.wiki.moreInfo')))}</a>` : ''}
            </div>
          </details>`;
      }).join('')}
    `).join('');
    applyWikiFilter();
  } catch (err) {
    console.error('[Wiki] support groups fetch failed', err);
    body.innerHTML = `<div class="wiki-empty">${esc(_wt('anon.wiki.errorGroups'))}</div>`;
  }
}

async function renderWikiWisdom() {
  const body = document.getElementById('wiki-body');
  if (!body) return;
  body.innerHTML = `<div class="wiki-loading">${esc(_wt('anon.wiki.loadingGeneric'))}</div>`;
  try {
    if (!_wikiCache.posts) {
      const res = await fetch('data/wiki-posts.json', { cache: 'no-cache' });
      _wikiCache.posts = await res.json();
    }
    const entries = _wikiCache.posts.entries || [];
    if (entries.length === 0) {
      body.innerHTML = `<div class="wiki-empty">${esc(_wt('anon.wiki.emptyWisdom'))}</div>`;
      return;
    }
    body.innerHTML = entries.map(e => {
      const search = [e.text, e.topic, e.monika].filter(Boolean).join(' ').toLowerCase();
      return `
        <div class="wiki-wisdom-card" data-wiki-search="${esc(search)}">
          ${e.topic ? `<div class="wiki-wisdom-topic">${esc(e.topic)}</div>` : ''}
          <p class="wiki-wisdom-text">${esc(e.text)}</p>
          ${e.monika ? `<div class="wiki-wisdom-attr">— ${esc(e.monika)}</div>` : ''}
        </div>`;
    }).join('');
    applyWikiFilter();
  } catch (err) {
    console.error('[Wiki] posts fetch failed', err);
    body.innerHTML = `<div class="wiki-empty">${esc(_wt('anon.wiki.errorWisdom'))}</div>`;
  }
}

// ─────────────────────────────────────────────────────────────────
// Bipolar Anonymous 12 Steps
//
// The same twelve steps the main app carries in the Survival Kit — kept here
// as the board's own reference page so members can read, search and link to
// them without leaving Anonymous.
//
// Only the card headings, the search keys and the "in practice" notes live in
// this array. The step statements themselves are read from sk.steps.text (see
// _stepStatement) so the two apps can't drift apart, and the three group
// headings from sk.steps.modal — both already hand-translated in all ten
// languages. Headings and practice notes are translated the way every other
// wiki article is: anon.wiki.a.<slug of the English title>_<field>.
// ─────────────────────────────────────────────────────────────────
const _TWELVE_STEPS = [
  {
    group: 1, n: 1,
    keys: ['step 1', 'powerless', 'unmanageable', 'admitting', 'acceptance'],
    title: 'Step 1 · Admitting powerlessness',
    practice: 'This isn\'t giving up, and it isn\'t saying you are your illness. It\'s the end of pretending you can white-knuckle a mood episode away. Bipolar is a medical condition, not a character flaw or a willpower problem — naming that honestly is what makes room for treatment, support and self-compassion.'
  },
  {
    group: 1, n: 2,
    keys: ['step 2', 'hope', 'higher power', 'restore', 'sanity', 'believe'],
    title: 'Step 2 · Coming to believe',
    practice: 'A higher power means whatever is bigger than you and genuinely helps: faith, if you have it — but equally your care team, your medication, this community, nature, or simply the accumulated experience of people who have lived with this longer than you have. You do not have to be religious to work these steps.'
  },
  {
    group: 1, n: 3,
    keys: ['step 3', 'letting go', 'turn it over', 'decision', 'trust', 'control'],
    title: 'Step 3 · Letting go of the wheel',
    practice: 'In practice this often looks very ordinary: taking the medication as prescribed even on the days you feel fine, keeping the appointment you\'d rather cancel, letting someone else drive when you\'re not safe to. Trusting a plan you made when you were well is a way of handing the wheel over to the steadiest version of you.'
  },
  {
    group: 2, n: 4,
    keys: ['step 4', 'inventory', 'moral inventory', 'honesty', 'self examination', 'triggers'],
    title: 'Step 4 · An honest inventory',
    practice: 'Write it down — patterns, triggers, resentments, the things done during an episode you\'ve never said out loud. Be fair as well as fearless: an inventory that only lists your failures isn\'t honest either. Separating "what I did" from "what the illness did" is slow, uncomfortable work, and it is where most of the relief in these steps lives.'
  },
  {
    group: 2, n: 5,
    keys: ['step 5', 'confession', 'telling someone', 'shame', 'honesty', 'sharing'],
    title: 'Step 5 · Saying it out loud',
    practice: 'Shame survives on secrecy. Telling one trusted person — a sponsor, therapist, friend, or the board here under a moniker — is what takes the inventory out of your own head, where it distorts, and into the open, where it can be answered. Choose someone safe; this step doesn\'t require an audience.'
  },
  {
    group: 2, n: 6,
    keys: ['step 6', 'ready', 'willingness', 'defects', 'change', 'patterns'],
    title: 'Step 6 · Becoming ready',
    practice: 'Readiness comes before change and usually lags behind wanting it. Some habits — the spending, the isolating, the 3am messages, the way you test people who love you — have been protecting you from something. Being ready means being willing to let go of them anyway, before you have proof of what comes next.'
  },
  {
    group: 2, n: 7,
    keys: ['step 7', 'humility', 'asking for help', 'shortcomings', 'support'],
    title: 'Step 7 · Asking humbly',
    practice: 'Humility here is practical: asking is a skill, and most of us are worse at it than we think. Asking your GP for a medication review, asking a friend to check in on you this week, asking the board for experience rather than advice — all of it counts. Nothing about this condition is meant to be carried alone.'
  },
  {
    group: 2, n: 8,
    keys: ['step 8', 'list', 'harmed', 'amends', 'willing', 'relationships'],
    title: 'Step 8 · Making the list',
    practice: 'Put yourself on that list too — people living with bipolar have usually been hardest on themselves. The list is just a list at this stage; nothing is owed to anyone yet. Willingness can take months to arrive for some names, and that\'s allowed.'
  },
  {
    group: 2, n: 9,
    keys: ['step 9', 'amends', 'apology', 'repair', 'making it right'],
    title: 'Step 9 · Making amends',
    practice: 'An amend is not the same as an apology: it\'s changed behaviour, and sometimes repayment or repair. The exception matters as much as the rule — if contacting someone would reopen a wound, frighten them, or is mainly about easing your own guilt, the amend is to leave them in peace and live differently instead.'
  },
  {
    group: 2, n: 10,
    keys: ['step 10', 'daily inventory', 'mood tracking', 'promptly admitted', 'maintenance'],
    title: 'Step 10 · Keeping short accounts',
    practice: 'This is the maintenance step, and it maps neatly onto mood tracking: a daily check of how you are, what you did, and what needs putting right before it hardens. Catching a slipping sleep pattern or an unfair word the same day is far easier than unpicking a month of it.'
  },
  {
    group: 3, n: 11,
    keys: ['step 11', 'prayer', 'meditation', 'mindfulness', 'grounding', 'conscious contact'],
    title: 'Step 11 · Staying connected',
    practice: 'Prayer and meditation are one route; so are mindfulness, breathwork, walking, journalling, or ten quiet minutes before the day starts. The point is a regular practice of stepping back from your own thoughts — which is precisely the skill that lets you notice a mood shift as weather passing through rather than as the truth about your life.'
  },
  {
    group: 3, n: 12,
    keys: ['step 12', 'carrying the message', 'helping others', 'service', 'peer support', 'awakening'],
    title: 'Step 12 · Carrying it to others',
    practice: 'This is why the board exists. Answering someone at their worst with "me too, and here\'s what helped" is the whole of Step 12, and it turns out to be one of the most reliably stabilising things you can do for yourself. You don\'t need to be recovered to be useful — you just need to be honest about where you are.'
  }
];

// The step statements and the three group headings are NOT duplicated here —
// they are read from the Survival Kit's own strings (sk.steps.*), which are
// hand-translated in all ten languages and are the canonical wording. Editing a
// step in js/shared/i18n.js changes it in both apps at once. sk.steps.text
// carries <strong> markup for the Survival Kit's card, which this page strips.
function _stepStatement(n) {
  return _wt('sk.steps.text.s' + n).replace(/<[^>]*>/g, '');
}

function renderWikiTwelveSteps() {
  const body = document.getElementById('wiki-body');
  if (!body) return;
  const groups = [1, 2, 3].map(g => {
    const region = _wt('sk.steps.modal.group' + g + 'Title');
    const cards = _TWELVE_STEPS.filter(st => st.group === g).map(st => {
      const _t = _wikiTxt(st, 'title'), _b = _stepStatement(st.n), _p = _wikiTxt(st, 'practice');
      const search = (_t + ' ' + st.title + ' ' + _b + ' ' + _p + ' ' + st.keys.join(' ')).toLowerCase();
      return `
        <details class="wiki-card" data-wiki-search="${esc(search)}" data-wiki-region-card="${esc(region)}">
          <summary>${esc(_t)}<span class="wiki-chev">▼</span></summary>
          <div class="wiki-card-body">
            <p class="wiki-step-text">${esc(_b)}</p>
            <p class="wiki-notes">${esc(_p)}</p>
          </div>
        </details>`;
    }).join('');
    return `<h3 class="wiki-region-heading" data-wiki-region="${esc(region)}">${esc(region)}</h3>${cards}`;
  }).join('');
  body.innerHTML = `
    <div class="wiki-disclaimer">${esc(_wt('anon.wiki.twelveStepsIntro'))}<br><span class="wiki-disclaimer-src">${esc(_wt('anon.wiki.twelveStepsNote'))}</span></div>
    ${groups}
    <div class="wiki-disclaimer wiki-steps-outro">${esc(_wt('anon.wiki.twelveStepsOutro'))}</div>
  `;
  applyWikiFilter();
}

// ─────────────────────────────────────────────────────────────────
// Posts — Firestore real-time listener
// ─────────────────────────────────────────────────────────────────
function sortPosts(posts) {
  const getTime = p => {
    const la = p.lastActivity?.toMillis?.() ?? (p.lastActivity instanceof Date ? p.lastActivity.getTime() : 0);
    const ts = p.timestamp?.toMillis?.()    ?? (p.timestamp    instanceof Date ? p.timestamp.getTime()    : 0);
    return Math.max(la, ts);
  };
  return [...posts].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return getTime(b) - getTime(a);
  });
}

function todaySystemPost() {
  const h = new Date().getHours();
  let icon, text;
  if      (h >= 5  && h < 12) { icon = '☀️';  text = _wt('anon.feed.greetMorning'); }
  else if (h >= 12 && h < 17) { icon = '🌤️'; text = _wt('anon.feed.greetAfternoon'); }
  else if (h >= 17 && h < 21) { icon = '🌙';  text = _wt('anon.feed.greetEvening'); }
  else                         { icon = '⭐';  text = _wt('anon.feed.greetNight'); }
  return { id: 'sys_daily', isSystem: true, icon, text };
}

// Example posts shown at the foot of the General feed so the board never looks
// empty. Purely local demo content (isSeed: no likes/comments/reports persist).
// Two are shown at a time and the pair rotates every POST_RETENTION_DAYS so the
// examples stay fresh — the same cadence real posts age out on. Keep entries
// warm, supportive and non-clinical.
const SEED_POOL = [
  { name: 'SunnyDaze',  streak: 42, likes: 5, med: 'Lithium',     grad1: YELLOW_LT, grad2: YELLOW_DARK, initials: 'SD', textKey: 'anon.seed.s1' },
  { name: 'NightOwl',   streak: 7,  likes: 3, med: '',            grad1: '#64b5f6', grad2: '#1565c0',   initials: 'NO', textKey: 'anon.seed.s2' },
  { name: 'QuietTide',  streak: 15, likes: 4, med: '',            grad1: '#81c784', grad2: '#2e7d32',   initials: 'QT', textKey: 'anon.seed.s3' },
  { name: 'PaperMoon',  streak: 63, likes: 8, med: 'Lamotrigine', grad1: '#ba68c8', grad2: '#6a1b9a',   initials: 'PM', textKey: 'anon.seed.s4' },
  { name: 'RiverStone', streak: 21, likes: 6, med: '',            grad1: '#4dd0e1', grad2: '#00838f',   initials: 'RS', textKey: 'anon.seed.s5' },
  { name: 'EmberGlow',  streak: 3,  likes: 2, med: 'Quetiapine',  grad1: '#ff8a65', grad2: '#d84315',   initials: 'EG', textKey: 'anon.seed.s6' },
  { name: 'MapleHush',  streak: 30, likes: 7, med: '',            grad1: '#f06292', grad2: '#ad1457',   initials: 'MH', textKey: 'anon.seed.s7' },
  { name: 'DriftWood',  streak: 9,  likes: 5, med: '',            grad1: '#9575cd', grad2: '#4527a0',   initials: 'DW', textKey: 'anon.seed.s8' },
];

function seedPosts() {
  // Deterministic per-device from the clock — every POST_RETENTION_DAYS the
  // window advances and the next consecutive pair shows. SEED_POOL has an even
  // length so pairs never straddle the wrap. `text` is resolved from textKey at
  // render time so the sample posts follow the active UI language.
  const period = Math.floor(Date.now() / (POST_RETENTION_DAYS * DAY_MS));
  const pick = i => SEED_POOL[(period * 2 + i) % SEED_POOL.length];
  return [0, 1].map(i => {
    const s = pick(i);
    return { id: 'seed_' + (i + 1), isSeed: true, tab: 'general', timestamp: null, ...s, text: _wt(s.textKey) };
  });
}

// A quiet note at the very bottom of the General feed telling users their posts
// aren't permanent. isFooter is rendered by renderFeedFooter (see renderPosts).
function feedFooter() {
  return { id: 'sys_footer', isFooter: true };
}

function assembleGeneralPosts(realPosts) {
  return [todaySystemPost(), ...sortPosts(dedupeTopics(realPosts)), ...seedPosts(), feedFooter()];
}

// Defensive: only ever surface ONE "Today's topic". Firestore can transiently
// (or, on a failed cleanup, persistently) hold more than one isTopic post — for
// example when a capped feed snapshot drops the live topic and the rotation
// re-bootstraps a fresh one. Keep the newest topic and drop the rest so the user
// never sees two topic threads regardless of the underlying data state.
function dedupeTopics(posts) {
  let newest = null, newestMs = -1;
  for (const p of posts) {
    if (!p.isTopic) continue;
    const ms = _postMs(p);
    if (ms >= newestMs) { newestMs = ms; newest = p; }
  }
  if (!newest) return posts;
  return posts.filter(p => !p.isTopic || p === newest);
}

// ─────────────────────────────────────────────────────────────────
// Daily discussion topic
//
// A rotating conversation-starter that drops into the General feed as a
// real post (so it scrolls inline with messages and can take replies).
// It is shared across all devices because it lives in Firestore as an
// ordinary post — flagged isTopic, with a deterministic per-day doc id
// (topic-YYYY-MM-DD) so racing clients converge on one doc rather than
// creating duplicates. No separate collection and no rules change: any
// authenticated user can already write posts.
//
// Rotation rule: a NEW topic only appears when it is a new (UTC) day AND the
// current topic has received at least one reply. A topic that sparked no
// responses stays up until it does, so it always gets its chance to land.
// When it does rotate, the outgoing topic is NOT deleted — it is demoted to an
// ordinary member post so its reply thread lives on in the feed (an empty
// topic with no replies is simply removed instead, as there's nothing to keep).
// ─────────────────────────────────────────────────────────────────
let _dailyTopics        = null; // string[] once loaded
let _dailyTopicsPromise = null;
let _topicCheckInFlight = false;

function loadDailyTopics() {
  if (_dailyTopics) return Promise.resolve(_dailyTopics);
  if (_dailyTopicsPromise) return _dailyTopicsPromise;
  _dailyTopicsPromise = fetch('data/daily-topics.json')
    .then(r => r.json())
    .then(j => { _dailyTopics = Array.isArray(j.topics) ? j.topics : []; return _dailyTopics; })
    .catch(e => {
      console.warn('[Anonymous] daily-topics load failed', e);
      _dailyTopics = [];
      return _dailyTopics;
    });
  return _dailyTopicsPromise;
}

function _postMs(p) {
  return p.timestamp?.toMillis?.() ?? (p.timestamp instanceof Date ? p.timestamp.getTime() : 0);
}

// Pure: decide what (if anything) to do about the daily topic given the
// current general-tab posts. Returns { action:'noop' } or
// { action:'post', dayStr, index, replacePostId }.
function decideDailyTopic(posts, poolLen, nowMs) {
  if (!poolLen) return { action: 'noop' };
  const todayStr = new Date(nowMs).toISOString().slice(0, 10); // UTC day — same for every client

  // Current topic = newest post flagged isTopic.
  let current = null, currentMs = -1;
  for (const p of posts) {
    if (!p.isTopic) continue;
    const ms = _postMs(p);
    if (ms >= currentMs) { currentMs = ms; current = p; }
  }

  // Bootstrap: no topic has ever been posted.
  if (!current) return { action: 'post', dayStr: todayStr, index: 0, replacePostId: null };

  // Never post twice on the same UTC day.
  if (current.dayStr === todayStr) return { action: 'noop' };

  // New day: only rotate once the current topic has actually sparked a reply.
  // No responses yet → it stays put and gets another day. Once someone has
  // replied, it rotates to the next question on the next UTC day.
  const gotReply = (Number(current.commentCount) || 0) > 0;
  if (!gotReply) return { action: 'noop' };

  const nextIndex = ((Number(current.topicIndex) || 0) + 1) % poolLen;
  return { action: 'post', dayStr: todayStr, index: nextIndex, replacePostId: current.id };
}

// Authoritatively read every live topic doc. The per-tab feed listener is
// capped at 60 docs with NO ordering, so Firestore returns them by document id
// — and topic ids ("topic-YYYY-MM-DD") sort late, so an existing topic silently
// falls out of the snapshot once the feed is busy. Relying on that snapshot made
// the rotation believe no topic existed and re-bootstrap a duplicate. A direct
// equality query is immune to the cap. Returns null if the read fails so the
// caller can fall back to the snapshot rather than skipping the rotation.
async function fetchTopicDocs() {
  try {
    const snap = await db.collection(BB_BRAND.collections.posts)
      .where('isTopic', '==', true).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('[Anonymous] topic fetch failed', e);
    return null;
  }
}

// ── Topic author identity ────────────────────────────────────────
// The daily topic used to be signed by the BipolarBear admin account, which
// made an ordinary conversation-starter read like a broadcast from the app.
// It now carries a plain member-style identity — a first name, sometimes with
// a number or trailing initial, plus one of the standard avatar gradients and
// a streak — so it sits in the feed like anyone else's post.
//
// The identity is DERIVED, not random: a hash of the topic's UTC day string
// picks every field, so all clients (and topic docs written before these
// fields existed) resolve the same author for a given day without needing to
// coordinate. The author fields are still written onto the doc at creation so
// the archived post keeps its identity even if the pools below change later.
const TOPIC_NAME_POOL = [
  'Sarah', 'Adam', 'Emma', 'Josh', 'Chloe', 'Daniel', 'Megan', 'Ryan',
  'Hannah', 'Liam', 'Olivia', 'Nathan', 'Jess', 'Callum', 'Amelia', 'Owen',
  'Leah', 'Marcus', 'Grace', 'Toby', 'Nadia', 'Elliot', 'Priya', 'Sam',
  'Rachel', 'Jamie', 'Sofia', 'Ben', 'Katie', 'Theo', 'Maya', 'Connor',
];
const TOPIC_INITIAL_POOL = 'BCDGHJKLMNPRSTW'.split('');

// FNV-1a — small, stable, and dependency-free. Same string always yields the
// same 32-bit unsigned hash on every device.
function _topicSeedHash(str) {
  let h = 2166136261;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Build the member-style author for a topic from its day string (or, as a
// fallback, its doc id). Returns the exact field set an ordinary post carries.
function topicAuthor(seed) {
  const h    = _topicSeedHash(seed);
  const at   = shift => (h >>> shift) >>> 0;
  const first = TOPIC_NAME_POOL[at(0) % TOPIC_NAME_POOL.length];
  const digits = 10 + (at(7) % 89);           // 10–98, reads like a birth year / handle suffix
  const letter = TOPIC_INITIAL_POOL[at(13) % TOPIC_INITIAL_POOL.length];
  let name;
  switch (at(17) % 6) {
    case 0:  name = first; break;                              // Sarah
    case 1:  name = first + digits; break;                     // Adam94
    case 2:  name = first + '_' + digits; break;               // Emma_27
    case 3:  name = first.toLowerCase() + digits; break;       // josh81
    case 4:  name = first + letter; break;                     // ChloeR
    default: name = first.toLowerCase() + '_' + letter.toLowerCase(); break; // daniel_k
  }
  const preset = COLOR_PRESETS[at(23) % COLOR_PRESETS.length];
  return {
    name,
    isAdmin:  false,
    initials: initials(name),
    grad1:    preset.g1,
    grad2:    preset.g2,
    streak:   4 + (at(3) % 115),  // 4–118 days, in the range real members show
  };
}

// Resolve the author to render for a topic / archived topic post: the fields
// stored on the doc when present, otherwise derived from the doc's day. The
// derived path covers docs written before the author fields existed — topics
// with no author at all, and ones already archived under the BipolarBear admin
// identity — so no daily topic anywhere in the feed still reads as admin.
function topicAuthorOf(p) {
  const fallback = topicAuthor(p.dayStr || p.id || '');
  const legacy   = !p.name || p.isAdmin || p.name === 'BipolarBear';
  if (legacy) return fallback;
  return {
    name:     p.name,
    initials: p.initials || fallback.initials,
    grad1:    safeColor(p.grad1, fallback.grad1),
    grad2:    safeColor(p.grad2, fallback.grad2),
    streak:   num(p.streak, fallback.streak),
  };
}

// Retire a topic doc that is no longer the live one. If it sparked a
// conversation (has at least one reply) it is demoted in place to an ordinary
// member post — same doc id, so the `comments` subcollection and its reply
// thread carry over untouched — so the discussion lives on in the feed. If it
// never got a reply there is nothing to preserve, so it is deleted. `topicDoc`
// carries the doc data (needs commentCount); pass a synthesized doc when only
// the id is known. Fire-and-forget: a failure just leaves a straggler that the
// next pass (or the render-side dedupeTopics guard) handles.
function retireTopic(topicDoc) {
  if (!topicDoc || !topicDoc.id) return;
  const ref = db.collection(BB_BRAND.collections.posts).doc(topicDoc.id);
  const hasReplies = (Number(topicDoc.commentCount) || 0) > 0;
  if (hasReplies) {
    // Keep whatever author the topic was posted under; older topic docs (and
    // ones the admin account wrote) get one derived from their day so the
    // archived post never reads as BipolarBear.
    const author = topicAuthorOf(topicDoc);
    ref.update({
      isTopic:  false,   // stop it counting as the live topic / being deduped away
      wasTopic: true,    // render as a "past daily topic" member post
      isAdmin:  false,
      name:     author.name,
      initials: author.initials,
      grad1:    author.grad1,
      grad2:    author.grad2,
      streak:   author.streak,
    }).catch(() => {});
  } else {
    ref.delete().catch(() => {});
  }
}

// Evaluate the rotation rule against the live feed and, if due, write the
// next topic post. Safe to call on every snapshot: the same-day short-circuit
// and the deterministic doc id make repeat calls idempotent.
async function maybePostDailyTopic() {
  if (!db || _topicCheckInFlight) return;
  const pool = await loadDailyTopics();
  if (!pool.length) return;

  // Read the true set of topics rather than trusting the capped feed snapshot.
  const topicDocs = await fetchTopicDocs();

  // Converge to a single live topic no matter how duplicates arose (a failed
  // prior cleanup, a re-bootstrap from a dropped snapshot, …): keep the newest
  // and retire the rest — archiving any that hold a conversation, deleting the
  // empties. Runs independently of the rotation decision below so existing
  // duplicates get healed even when no new topic is due.
  if (topicDocs && topicDocs.length > 1) {
    const newest = topicDocs.reduce((a, b) => (_postMs(b) >= _postMs(a) ? b : a));
    for (const t of topicDocs) {
      if (t.id !== newest.id) retireTopic(t);
    }
  }

  // Merge the authoritative topic(s) over the snapshot so decideDailyTopic sees
  // the real current topic even when the snapshot dropped it (prevents the
  // duplicate-bootstrap). If the fetch failed, fall back to the raw snapshot.
  let posts = postsByTab.general;
  if (topicDocs) {
    const byId = new Map(posts.map(p => [p.id, p]));
    for (const t of topicDocs) byId.set(t.id, t);
    posts = [...byId.values()];
  }

  const decision = decideDailyTopic(posts, pool.length, Date.now());
  if (decision.action !== 'post') return;

  _topicCheckInFlight = true;
  try {
    await _ensureAuthSession(); // writes require request.auth
    const newId = 'topic-' + decision.dayStr;
    const ref = db.collection(BB_BRAND.collections.posts).doc(newId);
    const existing = await ref.get();

    if (!existing.exists) {
      // Posted under a member-style identity rather than the admin account —
      // derived from the day string, so it is the same author on every device.
      const author = topicAuthor(decision.dayStr);
      await ref.set({
        isTopic:    true,
        topicIndex: decision.index,
        dayStr:     decision.dayStr,
        text:       pool[decision.index],
        tab:        'general',
        likes:      0,
        isSystem:   false,
        pinned:     false,
        name:       author.name,
        isAdmin:    author.isAdmin,
        initials:   author.initials,
        grad1:      author.grad1,
        grad2:      author.grad2,
        streak:     author.streak,
        timestamp:  firebase.firestore.FieldValue.serverTimestamp(),
      });
    }

    // Retire the outgoing topic instead of deleting it: demote it to a
    // BipolarBear post so its reply thread survives (rotation only fires once a
    // topic got a reply, so this always archives rather than deletes). Prefer
    // the authoritative doc (carries commentCount); synthesize one when the
    // topic fetch failed — rotation implies a reply, so archive it.
    if (decision.replacePostId && decision.replacePostId !== newId) {
      const prev = (topicDocs || []).find(t => t.id === decision.replacePostId)
        || { id: decision.replacePostId, commentCount: 1 };
      retireTopic(prev);
    }

    // Clear out any *other* leftover topic docs (duplicate artifacts) — never
    // the new topic and never the one we just retired.
    if (topicDocs) {
      for (const t of topicDocs) {
        if (t.id === newId || t.id === decision.replacePostId) continue;
        retireTopic(t);
      }
    }
  } catch (e) {
    console.warn('[Anonymous] daily topic post failed', e);
  } finally {
    _topicCheckInFlight = false;
  }
}

// opts.keep (pull-to-refresh): leave the current feed on screen until the new
// snapshot replaces it, rather than blanking it to skeletons.
function listenPosts(opts) {
  const keep = !!(opts && opts.keep);
  stopAllListeners();
  if (!keep) {
    postsByTab = { announcements: [], general: [] };
    localPosts = [];
  }

  if (!db) {
    renderPosts(currentTab === 'general' ? assembleGeneralPosts(keep ? localPosts : []) : announcementFeed());
    if (_ptrDone) _ptrDone();
    return;
  }

  if (!keep) document.getElementById('post-list').innerHTML = _skeletonHtml(3);

  // Run one listener per tab simultaneously so badge counts stay live
  // even when the user is looking at the other tab.
  ['announcements', 'general'].forEach(tab => {
    unsubTabListeners[tab] = db.collection(BB_BRAND.collections.posts)
      .where('tab', '==', tab)
      .limit(60)
      .onSnapshot(snap => {
        postsByTab[tab] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (tab === 'general') maybePostDailyTopic(); // rotate the daily topic if due
        if (tab === currentTab) {
          localPosts = postsByTab[tab];
          renderPosts(tab === 'general'
            ? assembleGeneralPosts(localPosts)
            : announcementFeed());
          if (_ptrDone) _ptrDone();
        }
        renderTabBadges();
      }, err => {
        console.error('[Anonymous] posts error', tab, err);
        if (tab === currentTab) {
          renderPosts(currentTab === 'general'
            ? assembleGeneralPosts(localPosts)
            : announcementFeed());
        }
      });
  });
}

function announcementPosts() {
  return [
    { id: 'ann1', isAnnouncement: true, text: _wt('anon.feed.annWelcome'), timestamp: null },
    { id: 'ann2', isAnnouncement: true, text: _wt('anon.feed.annMedProfile'), timestamp: null },
  ];
}

function demoData() {
  return currentTab === 'announcements' ? announcementPosts() : assembleGeneralPosts([]);
}

// The announcements tab, assembled: suggestions awaiting (or refused) review
// sit above the published announcements. Every announcement render funnels
// through here so the faded cards can't be dropped by one code path.
function announcementFeed() {
  const published = localPosts.length ? sortPosts(localPosts) : announcementPosts();
  return [...visibleSuggestions(), ...builtInAnnouncements(), ...published];
}

// Announcements that ship with the app rather than being published to
// Firestore by the admin. Unlike announcementPosts() (a demo fallback shown
// only while the collection is empty) these always render, at the top of the
// tab — they point at app features that exist in this build, so they can't go
// stale the way a stored post can. `wikiLink` renders a button that opens the
// named wiki section (see renderAnnouncement / openWikiSection).
function builtInAnnouncements() {
  return [
    {
      id: 'ann_twelve_steps',
      isAnnouncement: true,
      text: _wt('anon.feed.annTwelveSteps'),
      wikiLink: 'twelveSteps',
      timestamp: null,
    },
  ];
}

// ─────────────────────────────────────────────────────────────────
// Announcement suggestions
//
// Only the admin publishes announcements. Anyone else composing on the
// announcements tab writes a *suggestion* instead: it lands in
// bbAnonAnnSuggestions and renders as a faded card — to its author, who
// sees it waiting, and to the admin, who publishes or refuses it.
// Publishing copies it into the posts collection as a real announcement,
// still credited to the member who suggested it.
// ─────────────────────────────────────────────────────────────────

// Ids of suggestions written on this device. Suggestions carry a monika, not
// an account, so there is nothing to query "mine" by — the author's own card
// is driven off this list instead.
function mySuggestionIds() {
  try { return JSON.parse(BB.storage.get('Anon_mySuggestions') || '[]'); }
  catch (_) { return []; }
}
function rememberSuggestion(id) {
  const ids = mySuggestionIds();
  if (ids.includes(id)) return;
  ids.push(id);
  BB.storage.set('Anon_mySuggestions', JSON.stringify(ids.slice(-20)));
}
function forgetSuggestion(id) {
  BB.storage.set('Anon_mySuggestions',
    JSON.stringify(mySuggestionIds().filter(x => x !== id)));
}

// Two kinds of user have anything to see here: the admin (every suggestion
// waiting) and a member who has suggested something (their own). Everyone
// else skips the listener rather than paying for reads they can't use.
function listenSuggestions() {
  if (unsubSuggestions) { unsubSuggestions(); unsubSuggestions = null; }
  suggestions = [];
  if (!db || (!profile.isAdmin && !mySuggestionIds().length)) return;
  unsubSuggestions = db.collection(BB_BRAND.collections.annSuggestions)
    .orderBy('timestamp', 'desc')
    .limit(40)
    .onSnapshot(snap => {
      suggestions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // A suggestion of yours that made it onto the board is now an ordinary
      // announcement — stop tracking it so the listener can retire.
      suggestions.forEach(x => { if (x.status === 'approved') forgetSuggestion(x.id); });
      if (currentTab === 'announcements') renderPosts(announcementFeed());
      renderTabBadges();
    }, err => console.warn('[Anonymous] suggestions listener error', err));
}

// Suggestions this viewer should see, newest first, as feed-shaped cards.
function visibleSuggestions() {
  const mine = mySuggestionIds();
  return suggestions
    .filter(x => {
      const isMine = mine.includes(x.id);
      if (x.status === 'rejected') return isMine;  // the author gets one "not published" card
      if (x.status === 'pending')  return profile.isAdmin || isMine;
      return false;                                // approved ones are in the feed proper
    })
    .map(x => ({ ...x, isSuggestion: true, mine: mine.includes(x.id) }));
}

function pendingSuggestionCount() {
  return suggestions.filter(x => x.status === 'pending').length;
}

function renderSuggestion(x) {
  const rejected = x.status === 'rejected';
  const g1 = safeColor(x.grad1, YELLOW_LT);
  const g2 = safeColor(x.grad2, YELLOW_DARK);
  const av = x.initials || initials(x.name || '');
  const label = rejected ? _wt('anon.sugg.rejected')
    : (profile.isAdmin ? _wt('anon.sugg.forReview') : _wt('anon.sugg.waiting'));
  const actions = profile.isAdmin && !rejected
    ? `<button class="sugg-btn sugg-yes" data-sugg-approve="${esc(x.id)}">${esc(_wt('anon.sugg.publish'))}</button>`
    + `<button class="sugg-btn sugg-no" data-sugg-reject="${esc(x.id)}">${esc(_wt('anon.sugg.reject'))}</button>`
    : (x.mine && rejected
        ? `<button class="sugg-btn" data-sugg-dismiss="${esc(x.id)}">${esc(_wt('anon.sugg.dismiss'))}</button>`
        : '');
  return `<div class="sugg-card${rejected ? ' sugg-rejected' : ''}">
    <div class="sugg-flag">${esc(label)}</div>
    <div class="post-header">
      <div class="post-avatar">
        <div class="post-av-circle" style="background:linear-gradient(135deg,${g1},${g2});">${esc(av)}</div>
        <div><div class="post-name">[${esc(x.name || '')}]</div></div>
      </div>
      <span class="post-time">${x.timestamp ? timeAgo(x.timestamp) : _wt('anon.time.now')}</span>
    </div>
    <div class="post-text" data-tt>${esc(x.text || '')}</div>
    ${actions ? `<div class="sugg-actions">${actions}</div>` : ''}
  </div>`;
}

// Publish a suggestion as a real announcement. Authorship stays with the
// member who wrote it — the admin decides what goes up, not who said it.
async function approveSuggestion(id) {
  const x = suggestions.find(s => s.id === id);
  if (!x || !db || !profile.isAdmin) return;
  try {
    await _ensureAuthSession();
    await db.collection(BB_BRAND.collections.posts).add(_withOwner({
      name:        x.name,
      streak:      num(x.streak, 1),
      initials:    x.initials || initials(x.name || ''),
      grad1:       x.grad1 || YELLOW_LT,
      grad2:       x.grad2 || YELLOW_DARK,
      isAdmin:     false,
      text:        x.text,
      med:         '',
      stable:      0,
      joinedAt:    x.joinedAt || null,
      tab:         'announcements',
      likes:       0,
      isSystem:    false,
      suggestedBy: x.name,
      timestamp:   firebase.firestore.FieldValue.serverTimestamp(),
    }));
    await db.collection(BB_BRAND.collections.annSuggestions).doc(id).update({
      status:     'approved',
      reviewedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    showHint(_wt('anon.toast.suggPublished'));
  } catch (e) {
    console.error('[Anonymous] approve suggestion failed', e);
    showHint(_wt('anon.toast.suggFailed'));
  }
}

async function rejectSuggestion(id) {
  if (!db || !profile.isAdmin) return;
  try {
    await _ensureAuthSession();
    await db.collection(BB_BRAND.collections.annSuggestions).doc(id).update({
      status:     'rejected',
      reviewedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    showHint(_wt('anon.toast.suggRejected'));
  } catch (e) {
    console.error('[Anonymous] reject suggestion failed', e);
    showHint(_wt('anon.toast.suggFailed'));
  }
}

// Author clearing their own refused suggestion off the board.
async function dismissSuggestion(id) {
  forgetSuggestion(id);
  suggestions = suggestions.filter(x => x.id !== id);
  if (currentTab === 'announcements') renderPosts(announcementFeed());
  if (!db) return;
  try {
    await _ensureAuthSession();
    await db.collection(BB_BRAND.collections.annSuggestions).doc(id).delete();
  } catch (e) { console.warn('[Anonymous] dismiss suggestion failed', e); }
  if (!mySuggestionIds().length && !profile.isAdmin) listenSuggestions(); // drops the listener
}

// ─────────────────────────────────────────────────────────────────
// Auto-delete posts older than 7 days (skip reported ones)
// ─────────────────────────────────────────────────────────────────
async function cleanOldPosts() {
  if (!db) return;
  const cutoff = new Date(Date.now() - POST_RETENTION_DAYS * DAY_MS);
  try {
    // Query posts whose original timestamp is past the cutoff; we then
    // check lastActivity client-side to preserve posts kept alive by comments.
    const snap = await db.collection(BB_BRAND.collections.posts)
      .where('timestamp', '<', cutoff)
      .get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach(doc => {
      const data = doc.data();
      if (data.reported || data.pinned || data.isTopic) return; // topics are managed by the rotation, never auto-swept
      // Preserve if a comment was added within the 7-day window
      if (data.lastActivity) {
        const laMs = data.lastActivity.toMillis
          ? data.lastActivity.toMillis()
          : (data.lastActivity instanceof Date ? data.lastActivity.getTime() : 0);
        if (laMs >= cutoff.getTime()) return;
      }
      batch.delete(doc.ref);
    });
    await batch.commit();
  } catch (e) {
    console.warn('[Anonymous] cleanOldPosts:', e);
  }
}

// ─────────────────────────────────────────────────────────────────
// Comment threads
// ─────────────────────────────────────────────────────────────────
// A thread reads oldest-first, so the part worth seeing is at the bottom.
// Opening one lands at that end rather than at the top; later snapshots only
// follow if the reader was already there — someone who scrolled up to re-read
// something must not be yanked back by a stranger's reply — and always after
// they send a comment themselves.
let _threadStickToBottom = true;

function _threadScroller() {
  return document.querySelector('#ov-thread .thread-scroll');
}

// Within a comment's height of the end counts as "at the end" — a reader
// sitting just above the last card is still following the live conversation.
function _threadAtBottom() {
  const el = _threadScroller();
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

function _scrollThreadToEnd() {
  const el = _threadScroller();
  if (!el) return;
  // After the paint that follows the innerHTML swap, or scrollHeight is still
  // the old list's.
  requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
}

async function openThread(postId) {
  const post = localPosts.find(p => p.id === postId);
  if (!post || post.isSeed) return;
  commentTargetId = postId;
  lastCommentAuthor = ''; // reset until the listener reports the thread's newest comment
  _threadStickToBottom = true; // open on the newest comment, not the top of the thread

  document.getElementById('thread-original-post').innerHTML = renderThreadHeader(post);
  if (window.BB && BB.translate) BB.translate.scan(document.getElementById('thread-original-post'));
  document.getElementById('thread-comments-list').innerHTML =
    '<div class="empty-state" style="padding:24px 0;">' + esc(_wt('anon.ui.loadingComments')) + '</div>';

  const ta = document.getElementById('thread-ta');
  ta.value = '';
  document.getElementById('thread-send').disabled = true;

  openOv('ov-thread');
  setTimeout(() => ta.focus(), 220);

  if (currentThreadUnsub) { currentThreadUnsub(); currentThreadUnsub = null; }
  if (!db) {
    document.getElementById('thread-comments-list').innerHTML = _emptyHtml(_wt('anon.ui.noComments'), true);
    return;
  }

  // Comments reads require request.auth — make sure the standalone path has
  // its anonymous session before subscribing, or the listener dies with
  // permission-denied. Bail if the user closed the thread while waiting.
  await _ensureAuthSession();
  if (commentTargetId !== postId) return;

  currentThreadUnsub = db.collection(BB_BRAND.collections.posts).doc(postId)
    .collection('comments')
    .orderBy('timestamp', 'asc')
    .onSnapshot(snap => {
      // Track the most recent comment's author (ordered asc, so last doc is
      // newest) for the per-thread gate — use the raw snapshot, not the
      // mute-filtered list, so a muted user's reply still counts as "someone
      // else commented" and lifts your own gate.
      const lastDoc = snap.docs[snap.docs.length - 1];
      lastCommentAuthor = lastDoc ? (lastDoc.data().name || '') : '';
      // Everything in this thread is now read. Take the higher of the real
      // comment count and the parent's counter so a drifted commentCount (a
      // decrement that never landed) can't leave the post pulsing forever.
      markThreadSeen(postId, Math.max(snap.docs.length, num(post.commentCount, 0)));
      const comments = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(c => !c.name || (!mutedUsers.has(c.name) && !isBanned(c.name)));
      const el = document.getElementById('thread-comments-list');
      // Measure before the innerHTML swap — afterwards the old scroll position
      // means nothing.
      const stick = _threadStickToBottom || _threadAtBottom();
      _threadStickToBottom = false;
      if (!comments.length) {
        el.innerHTML = _emptyHtml(_wt('anon.ui.noComments'), true);
        return;
      }
      el.innerHTML = comments.map(renderComment).join('');
      if (window.BB && BB.translate) BB.translate.scan(el);
      if (stick) _scrollThreadToEnd();
    }, err => {
      console.warn('[Thread] comments listener error', err);
      const el = document.getElementById('thread-comments-list');
      if (el) el.innerHTML = _emptyHtml(_wt('anon.ui.commentsError'), true);
    });
}

function closeThread() {
  if (currentThreadUnsub) { currentThreadUnsub(); currentThreadUnsub = null; }
  closeOv('ov-thread');
  commentTargetId = '';
  lastCommentAuthor = '';
  syncUnreadFlags(); // drop the pulse on the thread just read, in place
}

// Hard-delete a comment from a thread (self-remove or admin-remove) and keep
// the parent post's commentCount in step. The open thread's snapshot listener
// drops the comment from the list on the next tick.
function deleteComment(parentId, commentId, opts) {
  const admin = !!(opts && opts.admin);
  if (!db || !parentId || !commentId) return;
  const postRef = db.collection(BB_BRAND.collections.posts).doc(parentId);
  postRef.collection('comments').doc(commentId).delete()
    .then(() => postRef.update({
      commentCount: firebase.firestore.FieldValue.increment(-1),
    }).catch(() => {}))
    .catch(err => console.error('[Thread] comment delete failed', err));
  showHint(admin ? 'Comment deleted 🛡️' : 'Comment removed ✓');
}

// The self-delete / admin-delete overlays are shared between feed posts and
// thread comments. Cache their default (post) copy once, then swap in
// comment-specific wording when acting on a comment, restoring it otherwise.
let _delOverlayCopy = null;
function setDeleteOverlayMode(which, isComment) {
  if (!_delOverlayCopy) {
    _delOverlayCopy = {
      selfTitle: document.querySelector('#ov-self-delete .sheet-title').textContent,
      selfSub:   document.querySelector('#ov-self-delete .sheet-sub').textContent,
      selfBtn:   document.getElementById('sdel-confirm').textContent,
      adminTitle:document.querySelector('#ov-admin-delete .sheet-title').textContent,
      adminSub:  document.querySelector('#ov-admin-delete .sheet-sub').textContent,
    };
  }
  if (which === 'self') {
    document.querySelector('#ov-self-delete .sheet-title').textContent =
      isComment ? _wt('anon.feed.removeCommentTitle') : _delOverlayCopy.selfTitle;
    document.querySelector('#ov-self-delete .sheet-sub').textContent =
      isComment ? _wt('anon.feed.removeCommentSub') : _delOverlayCopy.selfSub;
    document.getElementById('sdel-confirm').textContent =
      isComment ? _wt('anon.feed.removeCommentBtn') : _delOverlayCopy.selfBtn;
  } else {
    document.querySelector('#ov-admin-delete .sheet-title').textContent =
      isComment ? _wt('anon.feed.deleteCommentTitle') : _delOverlayCopy.adminTitle;
    document.querySelector('#ov-admin-delete .sheet-sub').textContent =
      isComment ? _wt('anon.feed.deleteCommentSub') : _delOverlayCopy.adminSub;
  }
}

// Every admin is shown to everyone under one shared identity so no individual
// admin's monika (e.g. a real name) is exposed on the board. Returns the
// bracketed on-screen author label. The item's own `name` is still used
// everywhere else (ban / mute / self-delete checks, data attributes) — only
// the visible label is masked, so the ADMIN badge is folded into the name and
// no longer rendered separately for these posts.
const ADMIN_DISPLAY_NAME = 'Bipolar Bear Admin';
function authorLabel(item) {
  if (item && item.isAdmin) return `[${ADMIN_DISPLAY_NAME}]`;
  return `[${esc(item ? item.name : '')}]`;
}

function renderThreadHeader(p) {
  // Live and retired daily topics both render under their member-style author
  // (see topicAuthor) with the topic label demoted to a sub-line, so opening a
  // topic thread looks like opening any other member's thread.
  if (p.isTopic || p.wasTopic) {
    const a = topicAuthorOf(p);
    const label = p.isTopic ? _wt('anon.feed.todayTopic') : _wt('anon.feed.pastTopic');
    return `<div class="thread-orig-post">
      <div class="post-header">
        <div class="post-avatar">
          <div class="post-av-circle" style="background:linear-gradient(135deg,${a.grad1},${a.grad2});">${esc(a.initials)}</div>
          <div>
            <div class="post-name">[${esc(a.name)}]</div>
            ${_chipsHtml({ streak: a.streak, label: '💬 ' + label })}
          </div>
        </div>
        <span class="post-time">${p.timestamp ? timeAgo(p.timestamp) : _wt('anon.time.now')}</span>
      </div>
      <div class="post-text" data-tt>${esc(p.text)}</div>
    </div>`;
  }
  const g1 = safeColor(p.grad1, YELLOW_LT);
  const g2 = safeColor(p.grad2, YELLOW_DARK);
  const av = p.initials || initials(p.name);
  const showMed    = profile.showMeds && p.med;
  const streakNum  = num(p.streak, 1);
  const stableNum  = num(p.stable, 0);
  const showStable = stableNum > 0;
  return `<div class="thread-orig-post">
    <div class="post-header">
      <div class="post-avatar">
        <div class="post-av-circle" style="background:linear-gradient(135deg,${g1},${g2});">${esc(av)}</div>
        <div>
          <div class="post-name">${authorLabel(p)}</div>
          ${_chipsHtml({ streak: streakNum, stable: showStable ? stableNum : 0, med: showMed ? p.med : '' })}
        </div>
      </div>
      <span class="post-time">${p.timestamp ? timeAgo(p.timestamp) : _wt('anon.time.now')}</span>
    </div>
    <div class="post-text" data-tt>${esc(p.text)}</div>
    ${pollHtml(p, true)}
  </div>`;
}

function renderComment(c) {
  const g1 = safeColor(c.grad1, YELLOW_LT);
  const g2 = safeColor(c.grad2, YELLOW_DARK);
  const av = c.initials || initials(c.name);
  const isMine = c.name && c.name === profile.monika;
  // Moderation controls (mirror the feed post controls). Actions read the
  // comment id / author from the .comment-card dataset, so buttons stay light.
  const selfDeleteBtn = isMine && !profile.isAdmin
    ? `<button class="icon-btn" data-cselfdelete title="${esc(_wt('anon.modbtn.selfDeleteComment'))}" style="opacity:0.4;">🗑️</button>` : '';
  const adminDeleteBtn = profile.isAdmin
    ? `<button class="icon-btn" data-cdelete title="${esc(_wt('anon.modbtn.deleteComment'))}">🗑️</button>` : '';
  const banBtn = profile.isAdmin && !isMine
    ? `<button class="icon-btn" data-cban title="${esc(_wt('anon.modbtn.banUser'))}">🚫</button>` : '';
  const sosBtn = !isMine
    ? `<button class="icon-btn" data-csos title="${esc(_wt('anon.modbtn.sosFlag'))}">🆘</button>` : '';
  const reportBtn = !isMine
    ? `<button class="icon-btn" data-creport title="${esc(_wt('anon.modbtn.reportComment'))}">🚨</button>` : '';
  const muteBtn = !isMine
    ? `<button class="icon-btn" data-cmute title="${esc(_wt('anon.modbtn.muteUser'))}">🙈</button>` : '';
  return `<div class="comment-card" data-cid="${esc(c.id)}" data-author="${esc(c.name)}">
    ${isMine ? '' : '<span class="swipe-cue">↩️</span>'}
    <div class="comment-header">
      <div class="post-av-circle" style="width:28px;height:28px;font-size:11px;flex-shrink:0;background:linear-gradient(135deg,${g1},${g2});">${esc(av)}</div>
      <div style="flex:1;min-width:0;">
        <span class="post-name" style="font-size:12px;">${authorLabel(c)}</span>
        <span style="font-size:11px;color:var(--muted);margin-left:6px;">${c.timestamp ? timeAgo(c.timestamp) : _wt('anon.time.now')}</span>
      </div>
    </div>
    <div class="comment-text" data-tt>${esc(c.text)}</div>
    <div class="comment-actions">
      <div style="flex:1"></div>
      ${(selfDeleteBtn || adminDeleteBtn || banBtn || sosBtn) ? moreMenuHtml(`${selfDeleteBtn}${adminDeleteBtn}${banBtn}${sosBtn}${reportBtn}${muteBtn}`) : ''}
    </div>
  </div>`;
}

function setupThread() {
  const ta      = document.getElementById('thread-ta');
  const sendBtn = document.getElementById('thread-send');

  ta.addEventListener('input', () => { sendBtn.disabled = !ta.value.trim(); });
  document.getElementById('thread-close').addEventListener('click', closeThread);

  // Comment moderation controls (delegated — the comments list re-renders on
  // every snapshot, so per-button binding would be re-wired constantly).
  const commentsList = document.getElementById('thread-comments-list');
  bindSwipeReply(commentsList);
  bindLongPress(commentsList, '.comment-card');
  commentsList.addEventListener('click', e => {
    const more = e.target.closest('[data-more]');
    if (more) { openActions(more.closest('.comment-card')); return; }
    const btn = e.target.closest('button.icon-btn');
    if (!btn) return;
    const card = btn.closest('.comment-card');
    if (!card) return;
    const cid    = card.dataset.cid || '';
    const author = card.dataset.author || '';
    const d = btn.dataset;
    if ('cmute' in d) {
      muteTargetName = author;
      document.getElementById('mute-body').innerHTML =
        _wt('anon.mute.bodyNamed', { name: `<strong>[${esc(author)}]</strong>` });
      openOv('ov-mute');
    } else if ('csos' in d) {
      sosTargetName = author;
      document.getElementById('sos-body').innerHTML =
        `Are you worried about <strong>[${esc(author)}]</strong>? A moderator will be notified to check in. Only use this if genuinely concerned.`;
      openOv('ov-sos');
    } else if ('cban' in d) {
      adminBanName = author;
      document.getElementById('aban-body').innerHTML =
        _wt('anon.ban.bodyNamed', { name: `<strong>[${esc(author)}]</strong>` });
      openOv('ov-admin-ban');
    } else if ('creport' in d) {
      reportCommentMeta = {
        id: cid, parentId: commentTargetId, name: author,
        text: card.querySelector('.comment-text')?.textContent || '',
      };
      openOv('ov-report');
    } else if ('cselfdelete' in d) {
      commentSelfDeleteId = cid;
      commentActionParent = commentTargetId;
      setDeleteOverlayMode('self', true);
      openOv('ov-self-delete');
    } else if ('cdelete' in d) {
      commentAdminDeleteId = cid;
      commentActionParent = commentTargetId;
      setDeleteOverlayMode('admin', true);
      openOv('ov-admin-delete');
    }
  });

  let _sending = false;
  sendBtn.addEventListener('click', async () => {
    if (_sending) return;
    const text = ta.value.trim();
    if (!text || !commentTargetId) return;
    // Banned users can't comment (Apple UGC 1.2).
    if (isBanned(profile.monika)) {
      showHint(_wt('anon.toast.accessRevoked'));
      return;
    }
    // Content filter (Apple UGC 1.2).
    if (findBlockedTerm(text)) {
      showHint(_wt('anon.toast.commentObjectionable'));
      sendBtn.disabled = false;
      return;
    }
    // Per-thread gate (mirrors the compose gate): you can leave a comment, but
    // not a second one in a row — wait until someone else replies first.
    if (!profile.isAdmin && lastCommentAuthor && lastCommentAuthor === profile.monika) {
      showHint(_wt('anon.toast.commentWait'));
      return;
    }
    _sending = true;
    sendBtn.disabled = true;

    const comment = {
      name:      profile.monika,
      text,
      streak:    profile.streak,
      initials:  profile.avatarInitials(),
      grad1:     profile.grad1,
      grad2:     profile.grad2,
      isAdmin:   profile.isAdmin,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    };

    let sent = false;
    if (db) {
      try {
        await _ensureAuthSession(); // comment writes require request.auth
        const postRef = db.collection(BB_BRAND.collections.posts).doc(commentTargetId);
        await postRef.collection('comments').add(_withOwner(comment));
        sent = true;
        _threadStickToBottom = true; // follow your own comment down to the end
        // Your own reply is read the instant you send it. The thread listener
        // lands on the same number a moment later, but recording it here means
        // a dead listener — or closing the sheet mid-flight — can't leave your
        // own comment pulsing back at you from the feed.
        markThreadSeen(commentTargetId, num(threadSeen[commentTargetId]?.c, 0) + 1);
        _anonMarkPostedToday();
        // Bump the parent post to the top of the board and update count.
        // Separate try — a failed bump shouldn't read as a failed comment.
        try {
          await postRef.update({
            lastActivity: firebase.firestore.FieldValue.serverTimestamp(),
            commentCount: firebase.firestore.FieldValue.increment(1),
          });
        } catch (e) {
          console.warn('[Thread] post bump failed', e);
        }
      } catch (e) {
        console.error('[Thread] comment failed', e);
      }
    }

    if (sent) {
      _haptic('success');
      ta.value = '';
      // A reply is posting too — often a member's first contribution — so
      // offer notifications here as well. No-op once the sheet has been
      // answered, or on a device that can't do push.
      maybeAskNotifications();
    } else {
      // Keep the typed text so the user can retry, and say what happened —
      // previously this failed silently and the comment just vanished.
      showHint(_wt('anon.toast.commentFailed'));
      sendBtn.disabled = !ta.value.trim();
    }
    _sending = false;
  });
}

// ─────────────────────────────────────────────────────────────────
// Admin: pin/unpin post
// ─────────────────────────────────────────────────────────────────
async function handlePin(postId, tab) {
  if (!db || !profile.isAdmin) return;
  const post = localPosts.find(p => p.id === postId);
  if (!post) return;
  const isPinned = !!post.pinned;

  try {
    if (!isPinned) {
      // Unpin any existing pinned post in this tab first (one pin per tab)
      const existing = await db.collection(BB_BRAND.collections.posts)
        .where('tab', '==', tab)
        .where('pinned', '==', true)
        .get();
      const batch = db.batch();
      existing.docs.forEach(doc => batch.update(doc.ref, { pinned: false }));
      batch.update(db.collection(BB_BRAND.collections.posts).doc(postId), { pinned: true });
      await batch.commit();
      showHint(_wt('anon.toast.postPinned'));
    } else {
      await db.collection(BB_BRAND.collections.posts).doc(postId).update({ pinned: false });
      showHint(_wt('anon.toast.postUnpinned'));
    }
  } catch (e) {
    console.error('[Admin] pin failed', e);
    showHint(_wt('anon.toast.pinFailed'));
  }
}

// ─────────────────────────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────────────────────────
let _tombstoneSweepTimer = null;

// Re-render once the soonest-expiring visible tombstone passes the 24-hour mark,
// so it disappears even when no Firestore snapshot fires in the meantime.
function scheduleTombstoneSweep(nextExpiry, now) {
  if (_tombstoneSweepTimer) { clearTimeout(_tombstoneSweepTimer); _tombstoneSweepTimer = null; }
  if (!nextExpiry) return;
  const delay = Math.max(0, nextExpiry - now) + 1000; // +1s cushion past the boundary
  _tombstoneSweepTimer = setTimeout(() => {
    _tombstoneSweepTimer = null;
    renderPosts(currentTab === 'general'
      ? assembleGeneralPosts(localPosts)
      : announcementFeed());
  }, delay);
}

function renderPosts(posts) {
  const list = document.getElementById('post-list');
  // Drop posts from users muted on this device, and from users an admin has
  // banned (hidden for everyone). System/announcement cards have no name and
  // always pass — and so do daily topics, which now carry a generated member
  // name (see topicAuthor) that could otherwise collide with a muted/banned
  // monika and silently hide the topic on that device.
  posts = posts.filter(p => p.isTopic || p.wasTopic || p.isSuggestion || !p.name ||
    (!mutedUsers.has(p.name) && !isBanned(p.name)));
  // Final safety net: never surface more than one "Today's topic" card, no matter
  // which caller assembled `posts`. assembleGeneralPosts already dedupes, but the
  // optimistic-compose path (and any future render path) can hand us the raw
  // snapshot, which may hold several topic docs. Deduping here — the single choke
  // point every render funnels through — makes duplicate topic cards impossible.
  posts = dedupeTopics(posts);
  if (!posts.length) {
    list.innerHTML = _emptyHtml(_wt('anon.ui.noPosts'));
    return;
  }
  // Collapse runs of deleted posts: keep only the most recent tombstone, drop the rest.
  // Posts are sorted newest-first (sortPosts), so the first deleted in iteration is
  // the most recent. Prevents a wall of "post was deleted" entries when an admin
  // removes several spam posts in a row.
  // The "deleted by an admin" tombstone is also short-lived: once an hour has
  // passed since deletedAt, the post drops out of the feed entirely.
  const DELETED_TOMBSTONE_MS = 60 * 60 * 1000; // show "deleted by admin" for max 1h
  const _now = Date.now();
  let _keptDeletedTombstone = false;
  let _nextTombstoneExpiry = 0;
  posts = posts.filter(p => {
    if (!p.deleted) return true;
    // Expire the tombstone an hour after deletion. Missing deletedAt (legacy
    // deletes, or a serverTimestamp not yet resolved) keeps it visible.
    const delMs = p.deletedAt?.toMillis?.() ?? (p.deletedAt instanceof Date ? p.deletedAt.getTime() : 0);
    if (delMs && (_now - delMs) > DELETED_TOMBSTONE_MS) return false;
    if (_keptDeletedTombstone) return false;
    _keptDeletedTombstone = true;
    _nextTombstoneExpiry = delMs ? delMs + DELETED_TOMBSTONE_MS : _nextTombstoneExpiry;
    return true;
  });
  // On an idle page no snapshot fires to re-render, so a still-visible tombstone
  // would linger past the hour. Schedule a re-render for when it expires.
  scheduleTombstoneSweep(_nextTombstoneExpiry, _now);
  list.innerHTML = posts.map(p => {
    if (p.isSuggestion)   return renderSuggestion(p);
    if (p.isTopic)        return renderTopic(p);
    if (p.wasTopic)       return renderArchivedTopic(p);
    if (p.isSystem)       return renderSystem(p);
    if (p.isAnnouncement) return renderAnnouncement(p);
    if (p.isFooter)       return renderFeedFooter();
    return renderPost(p);
  }).join('');
  // After the markup, never before — a thread first seen on this render is
  // baselined, so it isn't flagged as unread the moment it appears.
  baselineThreadSeen(posts);

  // Like buttons
  list.querySelectorAll('.like-btn').forEach(btn => {
    btn.addEventListener('click', () => handleLike(btn));
  });
  // SOS buttons
  list.querySelectorAll('[data-sos]').forEach(btn => {
    btn.addEventListener('click', () => {
      sosTargetName = btn.dataset.sos;
      document.getElementById('sos-body').innerHTML =
        _wt('anon.sos.bodyNamed', { name: `<strong>[${esc(sosTargetName)}]</strong>` });
      openOv('ov-sos');
    });
  });
  // Report buttons
  list.querySelectorAll('[data-report]').forEach(btn => {
    btn.addEventListener('click', () => {
      reportTargetId = btn.dataset.report;
      reportCommentMeta = null; // this is a post report, not a comment report
      openOv('ov-report');
    });
  });
  // Mute buttons
  list.querySelectorAll('[data-mute]').forEach(btn => {
    btn.addEventListener('click', () => {
      muteTargetName = btn.dataset.mute;
      document.getElementById('mute-body').innerHTML =
        _wt('anon.mute.bodyNamed', { name: `<strong>[${esc(muteTargetName)}]</strong>` });
      openOv('ov-mute');
    });
  });
  // Self-delete buttons
  list.querySelectorAll('[data-selfdelete]').forEach(btn => {
    btn.addEventListener('click', () => {
      selfDeleteId = btn.dataset.selfdelete;
      commentSelfDeleteId = ''; // this is a post self-delete, not a comment
      setDeleteOverlayMode('self', false);
      openOv('ov-self-delete');
    });
  });
  // Admin delete buttons
  list.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', () => {
      adminDeleteId = btn.dataset.delete;
      commentAdminDeleteId = ''; // this is a post delete, not a comment
      setDeleteOverlayMode('admin', false);
      openOv('ov-admin-delete');
    });
  });
  // Admin ban buttons
  list.querySelectorAll('[data-ban]').forEach(btn => {
    btn.addEventListener('click', () => {
      adminBanName = btn.dataset.ban;
      document.getElementById('aban-body').innerHTML =
        _wt('anon.ban.bodyNamed', { name: `<strong>[${esc(adminBanName)}]</strong>` });
      openOv('ov-admin-ban');
    });
  });
  // ⋯ menus and the author chips
  list.querySelectorAll('[data-more]').forEach(btn => {
    btn.addEventListener('click', () => openActions(btn.closest('.post-card')));
  });
  list.querySelectorAll('.chip[data-hint]').forEach(chip => {
    chip.addEventListener('click', () => showHint(chip.dataset.hint));
  });
  // Comment thread buttons
  list.querySelectorAll('[data-comment]').forEach(btn => {
    btn.addEventListener('click', () => openThread(btn.dataset.comment));
  });
  // Announcement → wiki page links
  list.querySelectorAll('[data-wiki-open]').forEach(btn => {
    btn.addEventListener('click', () => openWikiSection(btn.dataset.wikiOpen));
  });
  // Admin pin buttons
  list.querySelectorAll('[data-pin]').forEach(btn => {
    btn.addEventListener('click', () => handlePin(btn.dataset.pin, btn.dataset.tab));
  });
  // Announcement suggestions — publish / refuse (admin) and dismiss (author)
  list.querySelectorAll('[data-sugg-approve]').forEach(btn => {
    btn.addEventListener('click', () => approveSuggestion(btn.dataset.suggApprove));
  });
  list.querySelectorAll('[data-sugg-reject]').forEach(btn => {
    btn.addEventListener('click', () => rejectSuggestion(btn.dataset.suggReject));
  });
  list.querySelectorAll('[data-sugg-dismiss]').forEach(btn => {
    btn.addEventListener('click', () => dismissSuggestion(btn.dataset.suggDismiss));
  });
  // Member-written text into the reader's language. Cached texts swap in
  // synchronously, so a re-render doesn't flash back to the original.
  if (window.BB && BB.translate) BB.translate.scan(list);
}

// The daily greeting breaks after its first sentence so it reads cleaner:
// "Hope your afternoon is going well." / "You're doing great. 💛" (James,
// 2026-09-30). The home page's copy does the same (js/index.js).
function greetingHtml(text) {
  const m = String(text || '').match(/^(.*?[.!?。！？])\s*(\S[\s\S]*)$/);
  return m ? esc(m[1]) + '<br>' + esc(m[2]) : esc(text);
}

function renderSystem(p) {
  return `<div class="sys-card">
    <div class="sys-emoji">${esc(p.icon) || '☀️'}</div>
    <div class="sys-text">${p.id === 'sys_daily' ? greetingHtml(p.text) : esc(p.text)}</div>
    <div class="sys-meta">BipolarBear${p.time ? ' · ' + esc(p.time) : (p.timestamp ? ' · ' + timeAgo(p.timestamp) : '')}</div>
    ${p.id === 'sys_daily' ? moodBlockHtml() : ''}
  </div>`;
}

function renderTopic(p) {
  const replies = num(p.commentCount, 0);
  const a = topicAuthorOf(p);
  const cta = replies
    ? _wt('anon.feed.topicCtaReplies', { count: replies, word: replies === 1 ? _wt('anon.feed.replyOne') : _wt('anon.feed.replyMany') })
    : _wt('anon.feed.topicCtaNone');
  // The author sits on the label line ("· Sarah_88") — no new copy to
  // translate, and it matches the name the thread header shows.
  return `<div class="topic-card${threadHasUnread(p) ? ' has-unread' : ''}" data-comment="${esc(p.id)}">
    <div class="topic-head"><span class="topic-emoji">💬</span><span class="topic-label">${esc(_wt('anon.feed.todayTopic'))}</span><span class="topic-by">· ${esc(a.name)}</span></div>
    <div class="topic-text" data-tt>${esc(p.text)}</div>
    <div class="topic-cta">${cta}</div>
  </div>`;
}

// A retired daily topic, rendered as an ordinary member post so its reply
// thread stays open and scrolls with the feed. It carries the same member-style
// author the topic was posted under (see topicAuthor) and keeps the "past daily
// topic" sub-label so the thread's origin is still clear. No report/mute/ban
// affordances — the author isn't a real member to act on.
function renderArchivedTopic(p) {
  const liked        = likedPosts.has(p.id);
  const likes        = num(p.likes, 0);
  const commentCount = num(p.commentCount, 0);
  const a            = topicAuthorOf(p);
  const deleteBtn    = profile.isAdmin
    ? `<button class="icon-btn" data-delete="${esc(p.id)}" title="${esc(_wt('anon.modbtn.deletePost'))}">🗑️</button>` : '';
  return `<div class="post-card" data-pid="${esc(p.id)}">
    <div class="post-header">
      <div class="post-avatar">
        <div class="post-av-circle" style="background:linear-gradient(135deg,${a.grad1},${a.grad2});">${esc(a.initials)}</div>
        <div>
          <div class="post-name">[${esc(a.name)}]</div>
          ${_chipsHtml({ streak: a.streak, label: '💬 ' + _wt('anon.feed.pastTopic') })}
        </div>
      </div>
      <span class="post-time">${p.timestamp ? timeAgo(p.timestamp) : _wt('anon.time.now')}</span>
    </div>
    <div class="post-text" data-tt>${esc(p.text)}</div>
    ${pollHtml(p)}
    <div class="post-actions">
      <button class="like-btn ${liked ? 'liked' : ''}" data-id="${esc(p.id)}" data-likes="${likes}" data-author="${esc(a.name)}">
        💛 <span>${likes}</span>
      </button>
      ${commentBtnHtml(p, commentCount)}
      <div style="flex:1"></div>
      ${moreMenuHtml(deleteBtn)}
    </div>
  </div>`;
}

// Bottom-of-feed note: posts are not permanent. Kept in sync with
// POST_RETENTION_DAYS (the cleanOldPosts cutoff and the seed rotation cadence).
function renderFeedFooter() {
  const days = POST_RETENTION_DAYS;
  return `<div class="feed-footer" style="text-align:center;padding:18px 16px 10px;font-size:12px;line-height:1.5;color:var(--muted);">
    ${esc(_wt('anon.feed.footer', { days }))}
  </div>`;
}

function renderAnnouncement(p) {
  const wikiBtn = p.wikiLink
    ? `<button class="ann-wiki-link" data-wiki-open="${esc(p.wikiLink)}">${esc(_wt('anon.feed.annReadWiki'))}</button>`
    : '';
  return `<div class="ann-card">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
      <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,${YELLOW_LT},${YELLOW_DARK});display:flex;align-items:center;justify-content:center;font-size:16px;">🐻</div>
      <div style="font-size:13px;font-weight:700;color:var(--dark);">BipolarBear</div>
    </div>
    <div class="post-text" data-tt>${esc(p.text)}</div>
    ${wikiBtn}
  </div>`;
}

// Author badges under a name: visit streak, days stable, Bipolar Bear
// birthday, medication (when both sides share it). Each chip explains itself
// on a tap — "🔥 12d" means nothing to a new member until it does. `label` is
// a plain extra chip (the "past daily topic" marker).
function _chipsHtml(o) {
  const chips = [];
  const chip = (text, hint) => chips.push(
    `<button class="chip"${hint ? ` data-hint="${esc(hint)}" title="${esc(hint)}"` : ''}>${esc(text)}</button>`);
  if (o.label) chip(o.label, '');
  if (o.streak) chip('🔥 ' + o.streak + 'd', _wt('anon.ux.chipStreak', { n: o.streak }));
  if (o.stable) chip('🧘 ' + o.stable + 'd', _wt('anon.ux.chipStable', { n: o.stable }));
  if (o.bday)   chip('🎂 ' + o.bday, _wt('anon.ui.bbBirthday'));
  if (o.med)    chip('💊 ' + o.med, _wt('anon.ux.chipMed'));
  return chips.length ? `<div class="post-chips">${chips.join('')}</div>` : '';
}

function renderPost(p) {
  if (p.deleted) {
    return `<div class="post-card"><div class="post-deleted">🛡️ ${esc(_wt('anon.feed.postDeleted'))}</div></div>`;
  }
  const liked        = likedPosts.has(p.id);
  const likes        = num(p.likes, 0);
  const commentCount = num(p.commentCount, 0);
  const showMed      = profile.showMeds && p.med;
  const streakNum    = num(p.streak, 1);
  const stableNum    = num(p.stable, 0);
  const showStable   = stableNum > 0;
  const g1           = safeColor(p.grad1, YELLOW_LT);
  const g2           = safeColor(p.grad2, YELLOW_DARK);
  const av           = p.initials || initials(p.name);
  const deleteBtn    = profile.isAdmin && !p.isSeed
    ? `<button class="icon-btn" data-delete="${esc(p.id)}" title="${esc(_wt('anon.modbtn.deletePost'))}">🗑️</button>` : '';
  const banBtn       = profile.isAdmin && !p.isSeed && p.name !== profile.monika
    ? `<button class="icon-btn" data-ban="${esc(p.name)}" title="${esc(_wt('anon.modbtn.banUser'))}">🚫</button>` : '';
  const pinBtn       = profile.isAdmin && !p.isSeed
    ? `<button class="icon-btn${p.pinned ? ' pin-active' : ''}" data-pin="${esc(p.id)}" data-tab="${esc(p.tab || currentTab)}" title="${esc(p.pinned ? _wt('anon.modbtn.unpinPost') : _wt('anon.modbtn.pinPost'))}">📌</button>` : '';
  const selfDeleteBtn = !p.isSeed && !profile.isAdmin && p.name === profile.monika && isSelfDeleteEligible(p)
    ? `<button class="icon-btn" data-selfdelete="${esc(p.id)}" title="${esc(_wt('anon.modbtn.selfDeletePost'))}" style="opacity:0.4;">🗑️</button>` : '';
  const commentBtn   = !p.isSeed ? commentBtnHtml(p, commentCount) : '';
  const pinnedBadge  = p.pinned ? `<div class="pinned-badge">📌 ${esc(_wt('anon.modbtn.pinnedBadge'))}</div>` : '';
  const postBday     = _birthdayCompact(p.joinedAt || '');
  return `<div class="post-card${p.pinned ? ' post-pinned' : ''}" data-pid="${esc(p.id)}">
    ${pinnedBadge}
    <div class="post-header">
      <div class="post-avatar">
        <div class="post-av-circle" style="background:linear-gradient(135deg,${g1},${g2});">${esc(av)}</div>
        <div>
          <div class="post-name">${authorLabel(p)}</div>
          ${_chipsHtml({ streak: streakNum, stable: showStable ? stableNum : 0, bday: postBday, med: showMed ? p.med : '' })}
        </div>
      </div>
      <span class="post-time">${p.timestamp ? timeAgo(p.timestamp) : _wt('anon.time.now')}</span>
    </div>
    <div class="post-text" data-tt>${esc(p.text)}</div>
    ${p.isSeed ? '' : pollHtml(p)}
    <div class="post-actions">
      <button class="like-btn ${liked ? 'liked' : ''}" data-id="${esc(p.id)}" data-likes="${likes}" data-author="${esc(p.name)}"${p.name === profile.monika ? ` data-self="true" style="opacity:0.35;cursor:default;" title="${esc(_wt('anon.modbtn.cannotLikeOwn'))}"` : ''}>
        💛 <span>${likes}</span>
      </button>
      ${commentBtn}
      <div style="flex:1"></div>
      ${p.isSeed ? '' : moreMenuHtml(`${selfDeleteBtn}${pinBtn}${deleteBtn}${banBtn}`
        + (p.name !== profile.monika ? `<button class="icon-btn" data-sos="${esc(p.name)}" title="${esc(_wt('anon.modbtn.sosFlag'))}">🆘</button>`
          + `<button class="icon-btn" data-report="${esc(p.id)}" title="${esc(_wt('anon.modbtn.reportPost'))}">🚨</button>`
          + `<button class="icon-btn" data-mute="${esc(p.name)}" title="${esc(_wt('anon.modbtn.muteUser'))}">🙈</button>` : ''))}
    </div>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────
// Likes
// ─────────────────────────────────────────────────────────────────
function handleLike(btn) {
  const id     = btn.dataset.id;
  const span   = btn.querySelector('span');
  const liked  = likedPosts.has(id);
  const count  = parseInt(btn.dataset.likes, 10) || 0;

  // Block self-likes (allow un-liking if somehow previously liked, to clean up)
  if (!liked && btn.dataset.author === profile.monika) {
    showHint(_wt('anon.toast.cantLikeOwn'));
    return;
  }

  if (liked) {
    likedPosts.delete(id);
    btn.classList.remove('liked');
    btn.dataset.likes = count - 1;
    span.textContent  = count - 1;
    if (db) db.collection(BB_BRAND.collections.posts).doc(id).update({ likes: firebase.firestore.FieldValue.increment(-1) }).catch(() => {});
  } else {
    _haptic();
    likedPosts.add(id);
    btn.classList.add('liked');
    btn.dataset.likes = count + 1;
    span.textContent  = count + 1;
    if (db) db.collection(BB_BRAND.collections.posts).doc(id).update({ likes: firebase.firestore.FieldValue.increment(1) }).catch(() => {});
  }
  saveLiked();
}

// ─────────────────────────────────────────────────────────────────
// Post gate — check if first post has a like yet
// ─────────────────────────────────────────────────────────────────
function pollCanPost() {
  if (profile.canPost || !profile.hasPosted) return;
  const firstId = BB.storage.get('Anon_firstPostId');
  if (!firstId || !db) return;
  db.collection(BB_BRAND.collections.posts).doc(firstId).get().then(doc => {
    if (doc.exists && (doc.data().likes || 0) > 0) {
      BB.storage.set('Anon_canPost', 'true');
    }
  }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────
// FAB
// ─────────────────────────────────────────────────────────────────
function setupFAB() {
  document.getElementById('fab-ann').addEventListener('click', () => {
    if (currentTab === 'announcements') { showHint(_wt('anon.toast.annOpen')); return; }
    setTab('announcements');
  });
  document.getElementById('fab-gen').addEventListener('click', () => {
    if (currentTab === 'general') { showHint(_wt('anon.toast.genOpen')); return; }
    setTab('general');
  });
  document.getElementById('fab-compose').addEventListener('click', () => {
    if (isBanned(profile.monika)) {
      showHint(_wt('anon.toast.accessRevoked'));
      return;
    }
    // The "wait for a reaction before posting again" gate is about the feed,
    // not the review queue — a suggestion isn't on the board yet.
    const latest = getLatestRealPost(currentTab);
    if (composeMode() === 'post' && !profile.isAdmin
        && latest && latest.name === profile.monika && (latest.likes || 0) === 0) {
      showHint(_wt('anon.toast.reactWait'));
      return;
    }
    setComposeMode();
    resetComposePoll();
    document.getElementById('compose-ta').value = '';
    document.getElementById('compose-post').disabled = true;
    openOv('ov-compose');
    setTimeout(() => document.getElementById('compose-ta').focus(), 50);
  });
  document.getElementById('fab-e2ee').addEventListener('click', () => openOv('ov-e2ee'));

  document.getElementById('fab-home').addEventListener('click', openAbout);

  const searchBtn = document.getElementById('fab-search');
  if (searchBtn) searchBtn.addEventListener('click', toggleWikiSearch);
}

// ─────────────────────────────────────────────────────────────────
// Compose
// ─────────────────────────────────────────────────────────────────
// 'suggest' when a member composes on the announcements tab — only the admin
// publishes announcements. Everything else is an ordinary post.
function composeMode() {
  return (currentTab === 'announcements' && !profile.isAdmin) ? 'suggest' : 'post';
}

// Dress the compose sheet for the mode it's about to open in.
function setComposeMode() {
  const suggest = composeMode() === 'suggest';
  const head    = document.getElementById('compose-head');
  const ta      = document.getElementById('compose-ta');
  const post    = document.getElementById('compose-post');
  if (head) head.style.display = suggest ? '' : 'none';
  if (ta)   ta.placeholder = _wt(suggest ? 'anon.sugg.placeholder' : 'anon.compose.placeholder');
  if (post) post.textContent = _wt(suggest ? 'anon.sugg.send' : 'anon.compose.post');
}

// ── Compose: optional poll ──
const POLL_MAX_OPTIONS = 4;
function _pollOptionInput(i) {
  return `<input type="text" class="bb-input poll-opt-input" maxlength="60" placeholder="${esc(_wt('anon.ux.pollOption', { n: i + 1 }))}">`;
}
function resetComposePoll() {
  const box = document.getElementById('compose-poll');
  const tog = document.getElementById('compose-poll-toggle');
  const opts = document.getElementById('compose-poll-opts');
  if (!box || !tog || !opts) return;
  box.style.display = 'none';
  opts.innerHTML = _pollOptionInput(0) + _pollOptionInput(1);
  document.getElementById('compose-poll-more').style.display = '';
  tog.textContent = _wt('anon.ux.pollAdd');
  // Polls are member posts on General; suggestions and announcements don't carry them.
  tog.style.display = (composeMode() === 'post' && currentTab === 'general') ? '' : 'none';
}
// null when no poll is being written; otherwise the trimmed, non-empty options.
function _composePollOptions() {
  const box = document.getElementById('compose-poll');
  if (!box || box.style.display === 'none') return null;
  return [...box.querySelectorAll('.poll-opt-input')].map(i => i.value.trim()).filter(Boolean);
}

function setupCompose() {
  document.getElementById('compose-poll-toggle').addEventListener('click', () => {
    const box = document.getElementById('compose-poll');
    const tog = document.getElementById('compose-poll-toggle');
    const showing = box.style.display !== 'none';
    box.style.display = showing ? 'none' : '';
    tog.textContent = _wt(showing ? 'anon.ux.pollAdd' : 'anon.ux.pollRemove');
    if (!showing) { const f = box.querySelector('.poll-opt-input'); if (f) f.focus(); }
  });
  document.getElementById('compose-poll-more').addEventListener('click', () => {
    const opts = document.getElementById('compose-poll-opts');
    const n = opts.querySelectorAll('.poll-opt-input').length;
    if (n >= POLL_MAX_OPTIONS) return;
    opts.insertAdjacentHTML('beforeend', _pollOptionInput(n));
    opts.lastElementChild.focus();
    if (n + 1 >= POLL_MAX_OPTIONS) document.getElementById('compose-poll-more').style.display = 'none';
  });

  const ta   = document.getElementById('compose-ta');
  const post = document.getElementById('compose-post');

  ta.addEventListener('input', () => { post.disabled = !ta.value.trim(); });

  document.getElementById('compose-cancel').addEventListener('click', () => closeOv('ov-compose'));

  let _posting = false;
  post.addEventListener('click', async () => {
    if (_posting) return; // guard against double-tap / re-entrant clicks
    const text = ta.value.trim();
    if (!text) return;
    // Banned users can't post (Apple UGC 1.2 — ejected users stay out).
    if (isBanned(profile.monika)) {
      showHint(_wt('anon.toast.accessRevoked'));
      return;
    }
    // Content filter (Apple UGC 1.2). Keep the overlay open so the user can edit.
    if (findBlockedTerm(text)) {
      showHint(_wt('anon.toast.postObjectionable'));
      post.disabled = false;
      return;
    }
    const pollOpts = composeMode() === 'post' ? _composePollOptions() : null;
    if (pollOpts) {
      const distinct = new Set(pollOpts.map(o => o.toLowerCase())).size === pollOpts.length;
      if (pollOpts.length < 2 || !distinct) { showHint(_wt('anon.ux.pollNeedTwo')); return; }
      if (pollOpts.some(o => findBlockedTerm(o))) { showHint(_wt('anon.toast.postObjectionable')); return; }
    }
    _posting = true;
    post.disabled = true;
    closeOv('ov-compose');

    // Announcements are the admin's to publish — a member's goes to them for
    // review instead of onto the board.
    if (composeMode() === 'suggest') {
      await submitSuggestion(text);
      _posting = false;
      return;
    }

    const now = new Date();
    const optimisticId = 'local-' + now.getTime();
    const entry = {
      name:     profile.monika,
      streak:   profile.streak,
      initials: profile.avatarInitials(),
      grad1:    profile.grad1,
      grad2:    profile.grad2,
      isAdmin:  profile.isAdmin,
      text,
      med:      profile.showMeds   ? profile.med          : '',
      stable:   profile.showStable ? profile.stableStreak : 0,
      joinedAt: profile.joinedAt   || null,
      tab:      currentTab,
      likes:    0,
      isSystem: false,
      timestamp: now,
    };
    if (pollOpts) entry.poll = { options: pollOpts, votes: pollOpts.map(() => 0) };

    // Show post immediately (optimistic update). Route through assembleGeneralPosts
    // on the general tab so the optimistic render keeps the system greeting, the
    // deduped daily topic, and the seed posts instead of dropping them until the
    // next snapshot fires.
    localPosts.unshift({ id: optimisticId, ...entry });
    renderPosts(currentTab === 'general'
      ? assembleGeneralPosts(localPosts)
      : announcementFeed());

    let docId = null;
    if (db) {
      try {
        if (pollOpts) {
          // Polls go through the createAnonPoll callable (validated options,
          // tallies at zero) rather than a direct write.
          const { timestamp, poll, ...fields } = entry;
          const res = await _callFn('createAnonPoll', { ...fields, options: pollOpts });
          docId = res.id || null;
        } else {
          await _ensureAuthSession(); // the post records its author's uid
          const ref = await db.collection(BB_BRAND.collections.posts).add(_withOwner({
            ...entry,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
          }));
          docId = ref.id;
        }
        // A post you just wrote starts read, with no replies outstanding — the
        // first-render baseline would land on the same value, but only if the
        // post renders before anyone answers it.
        markThreadSeen(docId, 0);
        _anonMarkPostedToday();
        _haptic('success');
        // Replace optimistic entry with the real one from the snapshot (happens automatically)
      } catch (e) {
        console.error('[Anonymous] post failed', e);
        if (pollOpts) {
          // No snapshot will replace the optimistic card, so take it back down.
          localPosts = localPosts.filter(p => p.id !== optimisticId);
          renderPosts(currentTab === 'general' ? assembleGeneralPosts(localPosts) : announcementFeed());
          showHint(_wt('anon.ux.pollFailed'));
          _posting = false;
          return;
        }
      }
    }

    if (!profile.hasPosted) {
      if (docId) BB.storage.set('Anon_firstPostId', docId);
      BB.storage.set('Anon_hasPosted', 'true');
      openOv('ov-firstpost');   // its close offers notifications
    } else if (docId) {
      maybeAskNotifications();  // no-op unless they've never seen the posts offer
    }
    _posting = false;
  });
}

// Write a suggested announcement to the review queue. The author's own copy
// shows on the announcements tab straight away (faded, "waiting for approval")
// because listenSuggestions picks it up once the id is remembered.
async function submitSuggestion(text) {
  if (!db) { showHint(_wt('anon.toast.suggFailed')); return; }
  try {
    await _ensureAuthSession();
    const ref = await db.collection(BB_BRAND.collections.annSuggestions).add({
      name:      profile.monika,
      initials:  profile.avatarInitials(),
      grad1:     profile.grad1,
      grad2:     profile.grad2,
      streak:    profile.streak,
      joinedAt:  profile.joinedAt || null,
      text,
      status:    'pending',
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    });
    rememberSuggestion(ref.id);
    listenSuggestions(); // first suggestion on this device — start watching it
    showHint(_wt('anon.toast.suggSent'));
  } catch (e) {
    console.error('[Anonymous] suggestion failed', e);
    showHint(_wt('anon.toast.suggFailed'));
  }
}

// ─────────────────────────────────────────────────────────────────
// Notifications
//
// Four things can reach a member: a reply to their post, a new
// announcement, a new post in General Chat, and the weekly digest. All
// four are sent by Cloud Functions over FCM; js/shared/anon-push.js owns
// permission, the registration token and the bbAnonPush document. This is
// the UI half — the opt-in sheet shown once after a first post, and the
// settings sheet.
// ─────────────────────────────────────────────────────────────────
const NOTIF_ROWS = [
  { key: 'replies',       icon: '💬', name: 'anon.notif.replies',       sub: 'anon.notif.repliesSub' },
  { key: 'announcements', icon: '📢', name: 'anon.notif.announcements', sub: 'anon.notif.announcementsSub' },
  { key: 'posts',         icon: '🆕', name: 'anon.notif.posts',         sub: 'anon.notif.postsSub' },
  { key: 'weekly',        icon: '📊', name: 'anon.notif.weekly',        sub: 'anon.notif.weeklySub' },
];
const NOTIF_SHORT = {
  replies:       'anon.notif.shortReplies',
  announcements: 'anon.notif.shortAnnouncements',
  posts:         'anon.notif.shortPosts',
  weekly:        'anon.notif.shortWeekly',
};

function _push() { return (window.BB && BB.anonPush) || null; }

// sha256 of the member's email, resolved once. It identifies the same person
// across devices without the server ever holding the address — the same hash
// anonProfiles is keyed by.
let _pushEmailHash = null;
function _resolvePushEmailHash() {
  const email = (_bbUser && _bbUser.email) || BB.storage.get('Anon_email') || '';
  if (!email || _pushEmailHash) return;
  _anonEmailHash(email).then(h => { _pushEmailHash = h; }).catch(() => {});
}

// Hand the push module the page's Firestore handle and identity, then bring
// any existing registration up to date (tokens rotate; permission can be
// revoked between visits).
function initPush() {
  const push = _push();
  if (!push) return;
  _resolvePushEmailHash();
  push.configure({
    db,
    identity: () => ({ monika: profile.monika, emailHash: _pushEmailHash }),
    // bbAnonPush writes require request.auth, and standalone members have no
    // Firebase session until something asks for one.
    ensureAuth: _ensureAuthSession,
    // A push that lands while the board is open belongs in the page, not in
    // the notification tray.
    onMessage: payload => {
      const body = (payload && payload.notification && payload.notification.body) || '';
      if (body) showHint(body);
    },
  });
  push.refresh().catch(() => {});
}

// Render the switches into a container. `prefs` is mutated in place so
// the caller decides when (or whether) to persist. `rows` sets the order.
function renderNotifRows(containerId, prefs, onChange, rows = NOTIF_ROWS) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = rows.map(r => `
    <button type="button" class="notif-row${prefs[r.key] ? ' on' : ''}" data-notif="${r.key}"
            role="switch" aria-checked="${prefs[r.key] ? 'true' : 'false'}">
      <span class="notif-ico">${r.icon}</span>
      <span class="notif-copy">
        <span class="notif-name">${esc(_wt(r.name))}</span>
        <span class="notif-sub">${esc(_wt(r.sub))}</span>
      </span>
      <span class="notif-sw" aria-hidden="true"></span>
    </button>`).join('');
  el.querySelectorAll('[data-notif]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.notif;
      prefs[key] = !prefs[key];
      btn.classList.toggle('on', prefs[key]);
      btn.setAttribute('aria-checked', prefs[key] ? 'true' : 'false');
      if (onChange) onChange(prefs, key);
    });
  });
}

// One-time opt-in, offered after a member's first post or reply — "Would you like to
// be notified when someone posts?" — leading with New posts, switched on, and
// the other switches beneath it. Members subscribed before the posts switch
// existed (or who posted before notifications did) get it once on their next
// post. A past "Not now" is never re-asked; settings is always there.
function maybeAskNotifications() {
  const push = _push();
  // Every silent exit says why under bbDebug — "the sheet never came up" is
  // otherwise indistinguishable from a device that can't do push at all.
  const skip = why => { if (BB.log) BB.log('[notif-ask] skipped:', why); };
  if (!push)                                { skip('no push module'); return; }
  if (!push.isSupported())                  { skip('push unsupported on this device/build'); return; }
  if (push.hasBeenAskedAboutPosts())        { skip('already asked about new posts'); return; }
  if (push.hasBeenAsked() && !push.anyOn()) { skip('declined before'); return; }
  const prefs = push.anyOn() ? push.getPrefs() : push.defaultPrefs();
  prefs.posts = true;
  const rows = [
    ...NOTIF_ROWS.filter(r => r.key === 'posts'),
    ...NOTIF_ROWS.filter(r => r.key !== 'posts'),
  ];
  renderNotifRows('notif-ask-rows', prefs, null, rows);
  document.getElementById('notif-ask-yes').onclick = async () => {
    closeOv('ov-notif-ask');
    // Every switch turned off is a "no", not a registration with nothing in it.
    if (!push.anyOn(prefs)) { push.savePrefs(prefs); push.markAsked(); return; }
    const res = await push.enable(prefs);
    showHint(_wt(res.ok ? 'anon.toast.notifOn'
      : (res.reason === 'denied' ? 'anon.toast.notifDenied' : 'anon.toast.notifFailed')));
    updateNotifStatus();
  };
  document.getElementById('notif-ask-no').onclick = () => {
    push.markAsked();
    closeOv('ov-notif-ask');
  };
  openOv('ov-notif-ask');
}

// The status line under "Notifications" in the settings sheet.
async function updateNotifStatus() {
  const el = document.getElementById('ms-notif-status');
  if (!el) return;
  const push = _push();
  if (!push || !push.isSupported()) { el.textContent = _wt('anon.notif.statusUnavailable'); return; }
  const state = await push.permissionState();
  if (state === 'denied') { el.textContent = _wt('anon.notif.statusBlocked'); return; }
  const prefs = push.getPrefs();
  const on = NOTIF_ROWS.filter(r => prefs[r.key]).map(r => _wt(NOTIF_SHORT[r.key]));
  el.textContent = on.length ? on.join(' · ') : _wt('anon.notif.statusOff');
}

async function openNotifSettings() {
  closeOv('ov-monika');
  const push  = _push();
  const prefs = push ? push.getPrefs() : Object.fromEntries(NOTIF_ROWS.map(r => [r.key, false]));
  const note  = document.getElementById('notif-note');

  renderNotifRows('notif-rows', prefs, async (next, key) => {
    if (!push) return;
    const res = await push.savePrefs(next);
    if (!res.ok) {
      // Permission refused (or nothing to send with) — re-render from what was
      // actually stored rather than leaving a switch claiming to be on.
      showHint(_wt(res.reason === 'denied' ? 'anon.toast.notifDenied' : 'anon.toast.notifFailed'));
      openNotifSettings();
      return;
    }
    if (!next[key]) showHint(_wt('anon.toast.notifOff'));
    updateNotifStatus();
  });

  if (note) {
    const state = push && push.isSupported() ? await push.permissionState() : 'unsupported';
    const msg = state === 'unsupported' ? _wt('anon.notif.noteUnavailable')
              : state === 'denied'      ? _wt('anon.notif.noteBlocked')
              : '';
    note.textContent   = msg;
    note.style.display = msg ? '' : 'none';
  }
  openOv('ov-notifs');
}

// ─────────────────────────────────────────────────────────────────
// Stability settings overlay
// ─────────────────────────────────────────────────────────────────
function openStableSettings() {
  closeOv('ov-monika');

  const isBB     = !!_bbUser;
  const streak   = profile.stableStreak;
  let   showStable = profile.showStable;

  // Show/hide the appropriate section
  document.getElementById('stable-ov-bb-section').style.display     = isBB ? '' : 'none';
  document.getElementById('stable-ov-manual-section').style.display  = isBB ? 'none' : '';

  if (isBB) {
    document.getElementById('stable-ov-bb-count').textContent = streak;
  } else {
    // Pre-fill date if already set
    const el = document.getElementById('stable-ov-date');
    el.value = profile.stableSince || '';
    el.max   = new Date().toISOString().slice(0, 10); // can't be future
  }

  function updateToggle() {
    document.getElementById('stable-ov-show').classList.toggle('active', showStable);
    document.getElementById('stable-ov-hide').classList.toggle('active', !showStable);
  }
  updateToggle();

  document.getElementById('stable-ov-show').onclick = () => { showStable = true;  updateToggle(); };
  document.getElementById('stable-ov-hide').onclick = () => { showStable = false; updateToggle(); };

  document.getElementById('stable-ov-cancel').onclick = () => closeOv('ov-stable');

  document.getElementById('stable-ov-save').onclick = () => {
    BB.storage.set('Anon_showStable', showStable ? 'true' : 'false');

    if (!isBB) {
      // Compute days from entered date
      const since = document.getElementById('stable-ov-date').value; // YYYY-MM-DD
      if (since) {
        BB.storage.set('Anon_stableSince', since);
        const days = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 86400000));
        BB.storage.set('Anon_stableStreak', String(days));
      } else {
        BB.storage.remove('Anon_stableSince');
        BB.storage.set('Anon_stableStreak', '0');
      }
    }

    _anonSaveProfile(); _bbSaveProfile();
    closeOv('ov-stable');
    renderUserPill();
  };

  openOv('ov-stable');
}

// ─────────────────────────────────────────────────────────────────
// Overlay button wiring
// ─────────────────────────────────────────────────────────────────
function setupOverlayActions() {
  // First post
  // Closing the first-post sheet is the moment to ask about notifications:
  // they have just written something that can be replied to.
  document.getElementById('fp-yes').addEventListener('click', () => {
    closeOv('ov-firstpost'); maybeAskNotifications();
  });
  document.getElementById('fp-no').addEventListener('click',  () => {
    closeOv('ov-firstpost'); maybeAskNotifications();
  });

  // SOS
  document.getElementById('sos-cancel').addEventListener('click',  () => closeOv('ov-sos'));
  document.getElementById('sos-confirm').addEventListener('click', () => {
    closeOv('ov-sos');
    // Production: write SOS report to Firestore for moderator review
    if (db && sosTargetName) {
      db.collection(BB_BRAND.collections.reports).add({
        type: 'sos', targetName: sosTargetName,
        reportedBy: profile.monika, timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      }).catch(() => {});
    }
    showHint(_wt('anon.toast.sosSent'));
  });

  // Report
  document.querySelectorAll('.report-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      closeOv('ov-report');
      if (db && reportCommentMeta) {
        // Comment report — target the comment in its parent thread.
        const m = reportCommentMeta;
        db.collection(BB_BRAND.collections.reports).add({
          type: 'report', kind: 'comment',
          postId: m.parentId, commentId: m.id, reason: btn.dataset.reason,
          postText: m.text, postName: m.name,
          reportedBy: profile.monika,
          adminEmail: ADMIN_EMAIL,
          timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        }).catch(() => {});
      } else if (db && reportTargetId) {
        const post = localPosts.find(p => p.id === reportTargetId);
        db.collection(BB_BRAND.collections.reports).add({
          type: 'report', postId: reportTargetId, reason: btn.dataset.reason,
          postText: post ? post.text : '',
          postName: post ? post.name : '',
          reportedBy: profile.monika,
          adminEmail: ADMIN_EMAIL,
          timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        }).catch(() => {});
        // Flag post so 7-day auto-delete skips it
        db.collection(BB_BRAND.collections.posts).doc(reportTargetId)
          .update({ reported: true }).catch(() => {});
      }
      reportCommentMeta = null;
      reportTargetId = '';
      showHint(_wt('anon.toast.reportSubmitted'));
    });
  });

  // Mute
  document.getElementById('mute-cancel').addEventListener('click', () => closeOv('ov-mute'));
  document.getElementById('mute-confirm').addEventListener('click', () => {
    closeOv('ov-mute');
    if (!muteTargetName) return;
    mutedUsers.add(muteTargetName);
    saveMuted();
    renderPosts(currentTab === 'general' ? assembleGeneralPosts(localPosts) : announcementFeed());
    showHint(_wt('anon.toast.mutedNamed', { name: `[${muteTargetName}]` }));
    muteTargetName = '';
  });

  // Self delete
  document.getElementById('sdel-cancel').addEventListener('click', () => closeOv('ov-self-delete'));
  document.getElementById('sdel-confirm').addEventListener('click', () => {
    closeOv('ov-self-delete');
    if (commentSelfDeleteId) {
      deleteComment(commentActionParent, commentSelfDeleteId, { admin: false });
      commentSelfDeleteId = '';
      commentActionParent = '';
      return;
    }
    if (db && selfDeleteId) {
      db.collection(BB_BRAND.collections.posts).doc(selfDeleteId).delete().catch(() => {});
      localPosts = localPosts.filter(p => p.id !== selfDeleteId);
      renderPosts(currentTab === 'general' ? assembleGeneralPosts(localPosts) : announcementFeed());
    }
    showHint(_wt('anon.toast.postRemoved'));
  });

  // Admin delete
  document.getElementById('adel-cancel').addEventListener('click', () => closeOv('ov-admin-delete'));
  document.getElementById('adel-confirm').addEventListener('click', () => {
    closeOv('ov-admin-delete');
    if (commentAdminDeleteId) {
      deleteComment(commentActionParent, commentAdminDeleteId, { admin: true });
      commentAdminDeleteId = '';
      commentActionParent = '';
      return;
    }
    adminDeletePost(adminDeleteId);
  });

  // Admin ban
  document.getElementById('aban-cancel').addEventListener('click', () => closeOv('ov-admin-ban'));
  document.getElementById('aban-confirm').addEventListener('click', () => {
    closeOv('ov-admin-ban');
    adminBanUser(adminBanName);
  });
}

// ─────────────────────────────────────────────────────────────────
// Admin: delete post
// ─────────────────────────────────────────────────────────────────
function adminDeletePost(id) {
  if (!db || !id) return;
  db.collection(BB_BRAND.collections.posts).doc(id).update({
    deleted: true,
    deletedByAdmin: true,
    deletedAt: firebase.firestore.FieldValue.serverTimestamp(),
  }).catch(err => console.error('[Admin] delete failed', err));
  showHint(_wt('anon.toast.postDeleted'));
}

// ─────────────────────────────────────────────────────────────────
// Admin: ban (eject) a user — Apple UGC guideline 1.2
// ─────────────────────────────────────────────────────────────────
// Adds the monika to the bbAnonBanned list (hides them everywhere via the
// live ban listener, and blocks them from posting/commenting) AND tombstones
// their existing posts so the content is removed server-side, independent of
// any client having the ban list loaded.
function adminBanUser(name) {
  if (!db || !name) return;
  const key = String(name).toLowerCase();
  db.collection(BB_BRAND.collections.banned).doc(key).set({
    monika: name,
    bannedBy: profile.monika,
    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
  }).catch(err => console.error('[Admin] ban failed', err));
  // Remove their existing posts so offending content disappears immediately.
  db.collection(BB_BRAND.collections.posts).where('name', '==', name).get()
    .then(snap => snap.forEach(doc => doc.ref.update({
      deleted: true,
      deletedByAdmin: true,
      deletedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {})))
    .catch(() => {});
  showHint(_wt('anon.toast.bannedNamed', { name: `[${name}]` }));
}

// ─────────────────────────────────────────────────────────────────
// Language & translation settings
// ─────────────────────────────────────────────────────────────────

/** The one-line summary under "Language & translation" in the settings sheet. */
function _translateStatusText() {
  const lang = (window.BB && BB.i18n) ? BB.i18n.languageName(BB.i18n.getLang()) : 'English';
  if (window.BB && BB.translate && !BB.translate.isAvailable()) return _wt('anon.xlate.unavailable');
  const on = !(window.BB && BB.translate) || BB.translate.isOn();
  return on ? _wt('anon.xlate.statusOn', { lang }) : _wt('anon.xlate.statusOff');
}

function _paintTranslateStatus() {
  const el = document.getElementById('ms-lang-status');
  if (el) el.textContent = _translateStatusText();
}

function openTranslateSettings() {
  // App language — the board's own yellow-themed chips rather than the shared
  // (orange) BB.i18n.showPicker() overlay.
  const wrap = document.getElementById('xlate-langs');
  if (wrap && window.BB && BB.i18n) {
    const current = BB.i18n.getLang();
    wrap.innerHTML = BB.i18n.getLanguages().map(lg =>
      `<button type="button" class="xlate-lang${lg.code === current ? ' selected' : ''}" data-lang="${esc(lg.code)}">${esc(lg.name)}</button>`
    ).join('');
    wrap.querySelectorAll('[data-lang]').forEach(btn => {
      btn.addEventListener('click', () => {
        // setLanguage re-applies every data-i18n string and fires
        // bb:languagechange, which re-renders the feed and re-translates it.
        BB.i18n.setLanguage(btn.dataset.lang);
        wrap.querySelectorAll('[data-lang]').forEach(b =>
          b.classList.toggle('selected', b.dataset.lang === btn.dataset.lang));
        _paintTranslateNote();
        _paintTranslateStatus();
      });
    });
  }

  // Auto-translate switch, in the same style as the notification switches.
  const prefs = { auto: !(window.BB && BB.translate) || BB.translate.isOn() };
  renderNotifRows('xlate-rows', prefs, (p) => {
    if (window.BB && BB.translate) BB.translate.setOn(p.auto);
    _paintTranslateStatus();
  }, [{ key: 'auto', icon: '🌐', name: 'anon.xlate.autoLabel', sub: 'anon.xlate.autoSub' }]);

  _paintTranslateNote();
  openOv('ov-translate');
}

/** Say so when the backend has told us it can't translate right now. */
function _paintTranslateNote() {
  const note = document.getElementById('xlate-note');
  if (!note) return;
  const down = window.BB && BB.translate && !BB.translate.isAvailable();
  note.style.display = down ? '' : 'none';
  if (down) note.textContent = _wt('anon.xlate.unavailable');
}

// A language change rewrites every data-i18n string, but the feed is built
// from data — post times, streak labels, the empty state — so it has to be
// drawn again. js/shared/translate.js listens for the same event and puts the
// posts back into the language they were written in before re-translating.
document.addEventListener('bb:languagechange', () => {
  try {
    renderUserPill();
    _rerenderCurrentTab();
    _paintTranslateStatus();
  } catch (e) { console.warn('[Anonymous] language change re-render failed', e); }
});

// ─────────────────────────────────────────────────────────────────
// Monika settings
// ─────────────────────────────────────────────────────────────────
function openMonikaSettings() {
  const msMonika   = document.getElementById('ms-monika');
  const msCounter  = document.getElementById('ms-monika-counter');
  const msInitials = document.getElementById('ms-initials');
  const msColors   = document.getElementById('ms-colors');
  const msAv       = document.getElementById('ms-av');
  const msAvName   = document.getElementById('ms-av-name');

  msMonika.value   = profile.monika;
  msCounter.textContent = `${profile.monika.length}/10`;
  msInitials.value = profile.customInit;

  // Notification status row (async — permission state comes from the OS)
  updateNotifStatus();

  // Language & translation status row
  _paintTranslateStatus();

  // Saved posts count and Appearance
  _paintSavedStatus();
  _paintThemeStatus();

  // Your figures (moved here from the header) and the daily check-in switches
  _paintMsStats();
  _paintCheckinStatus();

  // Medication status row
  const msStatus = document.getElementById('ms-med-status');
  if (msStatus) {
    const list = _anonGetMedList();
    if (!list.length) {
      msStatus.textContent = _wt('anon.ui.noMeds');
    } else {
      const names = list.map(m => m.name).join(', ');
      msStatus.textContent = profile.showMeds ? `${names} · ${_wt('anon.ui.visibleOnPosts')}` : `${names} · ${_wt('anon.ui.privateStatus')}`;
    }
  }

  // Stability counter is BB-app only — standalone (anon-direct) users
  // don't track journal-driven streaks, so the option is hidden for them.
  const msStableBtn = document.getElementById('ms-stable-btn');
  if (msStableBtn) msStableBtn.style.display = _bbUser ? '' : 'none';

  const msStableStatus = document.getElementById('ms-stable-status');
  if (msStableStatus && _bbUser) {
    const streak = profile.stableStreak;
    if (!streak && !profile.stableSince) {
      msStableStatus.textContent = _wt('anon.ui.notSetUp');
    } else {
      msStableStatus.textContent = streak > 0
        ? (profile.showStable ? `${streak}d · ${_wt('anon.ui.visibleOnPosts')}` : `${streak}d · ${_wt('anon.ui.privateStatus')}`)
        : (profile.showStable ? _wt('anon.ui.visibleOnPosts') : _wt('anon.ui.privateStatus'));
    }
  }

  // Bipolar Bear birthday — date joined + age. Resolved lazily here so
  // users opening settings before initBoard() still see something.
  const joinedISO = profile.joinedAt || _resolveJoinedAt();
  const msBday    = document.getElementById('ms-birthday');
  if (msBday) {
    const dateLabel = _birthdayDateLabel(joinedISO);
    const ageLabel  = _birthdayVerbose(joinedISO);
    if (dateLabel) {
      document.getElementById('ms-birthday-date').textContent = dateLabel;
      document.getElementById('ms-birthday-age').textContent  = ageLabel;
      msBday.style.display = '';
    } else {
      msBday.style.display = 'none';
    }
  }

  // Build colour swatches
  msColors.innerHTML = COLOR_PRESETS.map(c =>
    `<div class="color-swatch ${c.key === profile.colorKey ? 'selected' : ''}"
       data-key="${c.key}"
       style="background:linear-gradient(135deg,${c.g1},${c.g2});"
       title="${c.key}"></div>`
  ).join('');

  function updatePreview() {
    const name = msMonika.value || profile.monika;
    const init = msInitials.value.toUpperCase() || initials(name);
    const key  = msColors.querySelector('.color-swatch.selected')?.dataset.key || profile.colorKey;
    const col  = COLOR_PRESETS.find(c => c.key === key) || COLOR_PRESETS[0];
    msAv.textContent = init;
    msAv.style.background = `linear-gradient(135deg,${col.g1},${col.g2})`;
    msAvName.textContent = `[${name}] 🔥 ${profile.streak}d`;
  }
  updatePreview();

  msMonika.oninput = () => {
    msCounter.textContent = `${msMonika.value.length}/10`;
    updatePreview();
  };
  msInitials.oninput = () => {
    msInitials.value = msInitials.value.toUpperCase().slice(0, 2);
    updatePreview();
  };
  msColors.onclick = e => {
    const sw = e.target.closest('.color-swatch');
    if (!sw) return;
    msColors.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
    sw.classList.add('selected');
    updatePreview();
  };

  // Sign Out is only meaningful for standalone (email-code) users; BB-app
  // users sign out from the main app. _bbUser is null on the standalone path.
  const msSignOut = document.getElementById('ms-signout');
  if (msSignOut) msSignOut.style.display = _bbUser ? 'none' : 'block';

  // Delete account is standalone-only too — BB-app users delete from the
  // main app (which removes their anon footprint as part of that flow).
  const msDelete = document.getElementById('ms-delete');
  if (msDelete) msDelete.style.display = _bbUser ? 'none' : 'block';

  openOv('ov-monika');
}

document.getElementById('ms-cancel').addEventListener('click', () => closeOv('ov-monika'));
document.getElementById('ms-saved-btn').addEventListener('click', openSaved);
document.getElementById('ms-theme-btn').addEventListener('click', cycleTheme);

// ── Your figures + the daily check-in switches (Your Moniker sheet) ──
function _paintMsStats() {
  const el = document.getElementById('ms-stats');
  if (!el) return;
  const chips = [];
  const streak = num(profile.streak, 0);
  chips.push(`<span class="ms-stat"><span class="ms-stat-e">🔥</span><b>${streak}</b><span>${esc(_wt('anon.ux.statStreak'))}</span></span>`);
  if (_bbUser && profile.stableStreak > 0) {
    chips.push(`<span class="ms-stat"><span class="ms-stat-e">🧘</span><b>${num(profile.stableStreak, 0)}</b><span>${esc(_wt('anon.ux.statStable'))}</span></span>`);
  }
  const bday = _birthdayCompact(profile.joinedAt || _resolveJoinedAt());
  if (bday) chips.push(`<span class="ms-stat"><span class="ms-stat-e">🎂</span><b>${esc(bday)}</b><span>${esc(_wt('anon.ux.statMember'))}</span></span>`);
  el.innerHTML = chips.join('');
  el.style.display = chips.length ? '' : 'none';
}
function _paintCheckinStatus() {
  const a = document.getElementById('ms-checkin-status');
  if (a) a.textContent = _wt(_moodAskShown() ? 'anon.ux.checkinShown' : 'anon.ux.checkinHidden');
  const jBtn = document.getElementById('ms-jcheckin-btn');
  // Only an account that is also a Bipolar Bear account has a journal to use.
  if (jBtn) jBtn.style.display = _bbUser && _moodAskShown() ? 'flex' : 'none';
  const j = document.getElementById('ms-jcheckin-status');
  if (j) j.textContent = _wt(_journalCheckinOn() ? 'anon.ux.journalCheckinOn' : 'anon.ux.journalCheckinOff');
}
document.getElementById('ms-checkin-btn').addEventListener('click', () => {
  BB.storage.set('Anon_moodAsk', _moodAskShown() ? '0' : '1');
  _paintCheckinStatus();
  if (_moodAskShown()) { loadMood(); } else { _repaintMood(); }
});
document.getElementById('ms-jcheckin-btn').addEventListener('click', () => {
  const on = !_journalCheckinOn();
  BB.storage.set('Anon_journalCheckin', on ? '1' : '0');
  _paintCheckinStatus();
  // Synced, because the journal that does the checking in may be on another
  // device (or in the other app). js/journal.js reads anonProfile.journalCheckin.
  if (db && _bbUser) {
    db.collection('userSettings').doc(_bbUser.uid)
      .set({ anonProfile: { journalCheckin: on } }, { merge: true }).catch(() => {});
  }
  if (on) loadMood();
});

document.getElementById('ms-signout').addEventListener('click', () => {
  // Standalone sign-out: clear all bbAnon_* identity/session state. Profile
  // data persists in anonProfiles/{sha256email} so the same email re-verifies
  // back into the same identity. The push registration does not: this device
  // should stop being notified the moment it stops being signed in.
  if (_push()) _push().unregister();
  Object.keys(localStorage)
    .filter(k => k === 'bbAnonLastVisit' || k === 'bbAnonVisitDate' || k.startsWith('bbAnon_'))
    .forEach(k => localStorage.removeItem(k));
  stopAllListeners();
  closeOv('ov-monika');
  boot(null);
});

// ── Delete account (standalone email-code path) ───────────────────────
// Opens the confirmation sheet; the actual destruction runs on confirm.
document.getElementById('ms-delete').addEventListener('click', () => {
  closeOv('ov-monika');
  openOv('ov-anon-delete');
});
document.getElementById('adel-acc-cancel').addEventListener('click', () => closeOv('ov-anon-delete'));
document.getElementById('adel-acc-confirm').addEventListener('click', deleteAnonAccount);

/**
 * Permanently delete the standalone anonymous account. Removes every trace
 * the signup created: the monika reservation, the cross-device anonProfile,
 * all posts authored under the monika, the (anonymous) Firebase Auth user,
 * and all local identity/session state. Best-effort per step — a network
 * blip on one delete must not strand the user half-deleted, so each Firestore
 * call swallows its own error and we always end on the verify screen.
 *
 * Required by App Store guideline 5.1.1(v): account creation must be matched
 * by an in-app account-deletion path.
 */
async function deleteAnonAccount() {
  const btn = document.getElementById('adel-acc-confirm');
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }

  const monika = profile.monika;
  const email  = BB.storage.get('Anon_email');

  try {
    // Comment-thread deletes need an auth session (Firestore rules require
    // request.auth); the standalone path may not have signed in yet.
    await _ensureAuthSession();

    if (db) {
      // 0. Hand the member count back before the anonProfile document that
      //    holds the one-time "counted" flag is deleted below. No-op unless
      //    this device knows the member was counted.
      if (window.BB && BB.userCount) await BB.userCount.uncount(db, 'anon');

      // 1. Delete every post authored under this monika.
      if (monika) {
        try {
          const snap  = await db.collection(BB_BRAND.collections.posts).where('name', '==', monika).get();
          // Only posts this session wrote (or written before posts carried an
          // owner uid) — anything else under the name isn't ours to delete.
          // One by one, so a refused delete doesn't take the rest with it.
          const uid = _authUid();
          await Promise.all(snap.docs
            .filter(doc => { const o = doc.get('uid'); return !o || o === uid; })
            .map(doc => doc.ref.delete().catch(() => {})));
        } catch (e) { console.warn('[AnonDelete] posts', e); }

        // 2. Release the monika reservation so the name frees up.
        await db.collection(BB_BRAND.collections.monikas).doc(monika.toLowerCase()).delete().catch(() => {});
      }

      // 3. Delete the cross-device profile (keyed by hashed email).
      if (email) {
        try {
          const hash = await _anonEmailHash(email);
          await db.collection('anonProfiles').doc(hash).delete();
        } catch (e) { console.warn('[AnonDelete] anonProfile', e); }
      }

      // 3b. Drop the push registration — nothing should still be notifying a
      //     member who no longer exists.
      if (_push()) await _push().unregister();
    }

    // 4. Delete the (anonymous) Firebase Auth user. Anonymous users can
    //    always delete without re-auth; ignore if there's no session.
    try {
      const u = firebase.auth && firebase.auth().currentUser;
      if (u) await u.delete();
    } catch (e) { console.warn('[AnonDelete] auth user', e); }
  } catch (e) {
    console.warn('[AnonDelete] failed', e);
  } finally {
    // 5. Wipe all local identity/session state (same scope as sign-out).
    Object.keys(localStorage)
      .filter(k => k === 'bbAnonLastVisit' || k === 'bbAnonVisitDate' || k.startsWith('bbAnon_'))
      .forEach(k => localStorage.removeItem(k));
    stopAllListeners();
    if (btn) { btn.disabled = false; btn.textContent = 'Delete forever'; }
    closeOv('ov-anon-delete');
    boot(null);
    showHint(_wt('anon.toast.accountDeleted'));
  }
}

const _msHomeBtn = document.getElementById('ms-home');
if (_isAnonymousApp) {
  // "Discover BipolarBear" is already in the info popup — don't duplicate it here.
  _msHomeBtn.style.display = 'none';
} else {
  _msHomeBtn.textContent = '← ' + _wt('anon.ui.backToBB');
  _msHomeBtn.addEventListener('click', () => { location.href = 'index.html'; });
}
document.getElementById('ms-notif-btn').addEventListener('click', openNotifSettings);
document.getElementById('notif-close').addEventListener('click', () => closeOv('ov-notifs'));
document.getElementById('ms-lang-btn').addEventListener('click', openTranslateSettings);
document.getElementById('xlate-close').addEventListener('click', () => closeOv('ov-translate'));
document.getElementById('ms-med-btn').addEventListener('click', openMedSettings);
document.getElementById('ms-stable-btn').addEventListener('click', openStableSettings);

document.getElementById('ms-save').addEventListener('click', async () => {
  const newMonika = document.getElementById('ms-monika').value.trim();
  if (newMonika.length < 2) { showHint(_wt('anon.toast.monikaTooShort')); return; }

  const oldMonika = profile.monika;
  try {
    if (await isMonikaInUse(newMonika, oldMonika)) {
      showHint(_wt('anon.toast.nameTaken'));
      return;
    }
  } catch (e) { /* network error — allow through */ }

  const newInit  = document.getElementById('ms-initials').value.toUpperCase().slice(0, 2);
  const selKey   = document.querySelector('#ms-colors .color-swatch.selected')?.dataset.key || profile.colorKey;

  BB.storage.set('Anon_monika',   newMonika);
  BB.storage.set('Anon_initials', newInit);
  BB.storage.set('Anon_colorKey', selKey);

  closeOv('ov-monika');
  renderUserPill();
  showHint(_wt('anon.toast.monikaUpdated'));
  // Reply notifications are addressed by monika, so the token document has to
  // learn the new one or replies stop arriving.
  if (_push()) _push().refresh().catch(() => {});

  // Update past Firestore posts authored by this user
  if (db && oldMonika) {
    const col = COLOR_PRESETS.find(c => c.key === selKey) || COLOR_PRESETS[0];
    try {
      await _ensureAuthSession();
      const nameChanged = oldMonika.toLowerCase() !== newMonika.toLowerCase();
      // Reserve the new name first: if someone else holds it, nothing moves.
      if (nameChanged) {
        await db.collection(BB_BRAND.collections.monikas).doc(newMonika.toLowerCase())
          .set(_withOwner({ monika: newMonika, createdAt: firebase.firestore.FieldValue.serverTimestamp() }));
      }
      // Rename this session's posts (and any from before posts carried an
      // owner uid), one by one so a refused update doesn't stop the rest.
      const uid   = _authUid();
      const snap  = await db.collection(BB_BRAND.collections.posts).where('name', '==', oldMonika).get();
      await Promise.all(snap.docs
        .filter(doc => { const o = doc.get('uid'); return !o || o === uid; })
        .map(doc => doc.ref.update({
          name:     newMonika,
          initials: newInit || initials(newMonika),
          grad1:    col.g1,
          grad2:    col.g2,
        }).catch(() => {})));
      if (nameChanged) {
        await db.collection(BB_BRAND.collections.monikas).doc(oldMonika.toLowerCase()).delete().catch(() => {});
      }
    } catch (e) { console.warn('[Monika] update posts failed', e); }
  }
  _anonSaveProfile(); _bbSaveProfile();
});

// ─────────────────────────────────────────────────────────────────
// Boot — driven by onAuthStateChanged; fallback if Firebase blocked
// ─────────────────────────────────────────────────────────────────
setTimeout(() => { if (!_anonInitialBoot) boot(null); }, 2500);

// Offline copy of the board and its 🛟 Help sheet (web only — the native
// shells bundle the files, and the Anonymous bundle has no service worker).
if ('serviceWorker' in navigator && !(window.isNative && window.isNative())) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  });
}
