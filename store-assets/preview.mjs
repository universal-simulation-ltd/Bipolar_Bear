#!/usr/bin/env node
// The App Store app previews (iPhone, 886×1920, 15–30 s) for BIPOLAR BEAR and
// BIPOLAR ANONYMOUS (James, 2026-10-04): the real app, driven the way a person
// would, recorded by the UNI·SIM store kit (Docs_UNI_SIM/store-kit/preview.mjs:
// status bar, touch dots, encoding, Apple's checks).
//
//   node store-assets/preview.mjs bear [de-DE fr-FR …]  → out/preview/bipolarbear/<locale>/iphone-01.mp4
//   node store-assets/preview.mjs anonymous [all]       → out/preview/anonymous/<locale>/iphone-01.mp4
//   … no locale = en-GB; `all` = every App Store locale in LOCALES below
//   … --stills                                and PNG stills beside it, to look at
//   … --worktree                              serve the working tree instead of HEAD
//
// Beside each mp4 (2026-10-17): contact.png (one frame a second, to check
// before uploading), texts.txt (every piece of text on screen at each step)
// and, for a translated locale, english.txt (those texts that are word for
// word the English run's: untranslated UI shows up there), and meta.json
// with the length and the poster frame for asc-preview.mjs --poster.
// CHROMIUM=<path> launches that Chromium (Playwright's own otherwise).
//
// Uploading one (App Store Connect, the 6.9" slot; dry run without --apply):
//   node Docs_UNI_SIM/store-kit/asc-preview.mjs --bundle com.app.bipolarbear --version 1.43 \
//     --locale de-DE --poster <meta.json's poster> --apply out/preview/bipolarbear/de-DE/iphone-01.mp4
// (Bipolar Anonymous: --bundle com.bipolaranonymous.app, out/preview/anonymous/…).
//
// What it serves: a copy of the committed app (git archive HEAD, so a neighbour
// session's uncommitted work never ends up in a store video), and for
// anonymous the Bipolar Anonymous bundle scripts/build-anonymous.js makes from
// it (anonymous.html as index.html, BB_BRAND.bundle = 'anonymous'), both in a
// temp folder: nothing in the repo is written but out/preview/.
//
// What it shows: invented data only, as the screenshot captures
// (_ipadseed.html) do. Bipolar Bear runs as a guest, its five weeks of entries
// and survival kit seeded into localStorage. Firebase never loads: the four
// gstatic SDK scripts are answered with a small in-memory stand-in
// (fakeFirebase below), so no request reaches Firestore, Auth or Functions,
// and the Bipolar Anonymous board, its daily topic and its replies are
// invented docs in that stand-in. Every other off-site request is refused.
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { realpathSync, readFileSync, existsSync } from 'node:fs'
import { execSync, execFileSync } from 'node:child_process'
import { pbkdf2Sync, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
const kit = await import('file:///Users/jamesmarkey/Github/UNISIM/Docs_UNI_SIM/store-kit/preview.mjs')
const { IPHONE, playwright, prepare, record, stills, tap, type, scroll, hold, W, H, FPS, MIN_S, MAX_S } = kit

const isMain = !!process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])
// Nothing listens on this port: every request is answered by the page's own
// routing (serve below). The recordings use 8811; capture-ipad-localized.mjs,
// which imports open(), navigates to 8765 itself.
const ORIGIN = `http://localhost:${isMain ? 8811 : 8765}`
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg',
}

// ── A stand-in for the Firebase compat SDK ─────────────────────────────────
// Runs in the page (serialised with its seed). Enough of firebase.app / auth /
// firestore / functions / messaging for the app's own calls: an in-memory
// Firestore with where / orderBy / limit / onSnapshot, batches and
// transactions, server timestamps and increments; an auth that starts signed
// out; callables that answer quietly.
function fakeFirebase(seed) {
  if (window.firebase && window.firebase.__preview) return
  const now = Date.now()
  class Timestamp {
    constructor(ms) { this.seconds = Math.floor(ms / 1000); this.nanoseconds = (ms % 1000) * 1e6; this._ms = ms }
    toMillis() { return this._ms } toDate() { return new Date(this._ms) } valueOf() { return this._ms }
    isEqual(o) { return o && o._ms === this._ms }
    static now() { return new Timestamp(Date.now()) }
    static fromMillis(ms) { return new Timestamp(ms) }
    static fromDate(d) { return new Timestamp(d.getTime()) }
  }
  const SERVER = { __sv: 'ts' }
  const inc = (n) => ({ __sv: 'inc', n })
  const store = new Map() // 'a/b/c/d' → data
  const revive = (v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('__ago' in v) return new Timestamp(now - v.__ago * 60000)
      const o = {}; for (const k in v) o[k] = revive(v[k]); return o
    }
    return Array.isArray(v) ? v.map(revive) : v
  }
  for (const [p, d] of Object.entries(seed.docs || {})) store.set(p, revive(d))

  const resolveVal = (v, old) => {
    if (v && v.__sv === 'ts') return Timestamp.now()
    if (v && v.__sv === 'inc') return (Number(old) || 0) + v.n
    if (v && v.__sv === 'del') return undefined
    if (v && v.__sv === 'union') return [...new Set([...(old || []), ...v.items])]
    if (v && v.__sv === 'remove') return (old || []).filter((x) => !v.items.includes(x))
    return v
  }
  const write = (p, data, { merge = false, update = false } = {}) => {
    const prev = store.get(p)
    if (update && !prev) return Promise.reject(Object.assign(new Error('not-found'), { code: 'not-found' }))
    const next = merge || update ? { ...(prev || {}) } : {}
    for (const [k, v] of Object.entries(data || {})) {
      if (update && k.includes('.')) {
        const parts = k.split('.'); let o = next
        for (const q of parts.slice(0, -1)) { o[q] = { ...(o[q] || {}) }; o = o[q] }
        const r = resolveVal(v, o[parts.at(-1)]); if (r === undefined) delete o[parts.at(-1)]; else o[parts.at(-1)] = r
      } else {
        const r = resolveVal(v, next[k]); if (r === undefined) delete next[k]; else next[k] = r
      }
    }
    store.set(p, next); changed(); return Promise.resolve()
  }
  const remove = (p) => { store.delete(p); changed(); return Promise.resolve() }

  const listeners = new Set()
  let pending = false
  function changed() {
    if (pending) return; pending = true
    setTimeout(() => { pending = false; for (const l of listeners) l() }, 40)
  }
  const field = (d, f) => f.split('.').reduce((o, k) => (o == null ? o : o[k]), d)
  const cmp = (a, b) => {
    const x = a && a.toMillis ? a.toMillis() : a, y = b && b.toMillis ? b.toMillis() : b
    return x < y ? -1 : x > y ? 1 : 0
  }
  let autoId = 0
  const newId = () => 'pv' + (now % 100000) + '_' + (++autoId)

  function docSnap(p) {
    const d = store.get(p)
    return {
      id: p.split('/').at(-1), exists: d !== undefined, ref: docRef(p),
      data: () => (d === undefined ? undefined : { ...d }), get: (f) => (d ? field(d, f) : undefined),
      metadata: { hasPendingWrites: false, fromCache: false },
    }
  }
  function querySnap(docs) {
    return {
      docs, size: docs.length, empty: !docs.length, forEach: (fn) => docs.forEach(fn),
      docChanges: () => docs.map((doc, i) => ({ type: 'added', doc, oldIndex: -1, newIndex: i })),
      metadata: { hasPendingWrites: false, fromCache: false },
    }
  }
  function docRef(p) {
    const ref = {
      id: p.split('/').at(-1), path: p,
      get parent() { return collRef(p.split('/').slice(0, -1).join('/')) },
      collection: (c) => collRef(p + '/' + c),
      get: () => Promise.resolve(docSnap(p)),
      set: (d, o) => write(p, d, { merge: !!(o && (o.merge || o.mergeFields)) }),
      update: (d, ...rest) => write(p, typeof d === 'string' ? { [d]: rest[0] } : d, { update: true }),
      delete: () => remove(p),
      onSnapshot: (a, b) => {
        const cb = typeof a === 'function' ? a : b
        const fire = () => { try { cb(docSnap(p)) } catch (e) { console.error(e) } }
        listeners.add(fire); setTimeout(fire, 30); return () => listeners.delete(fire)
      },
      isEqual: (o) => o && o.path === p,
    }
    return ref
  }
  function collRef(p, q = { where: [], order: [], limit: 0 }) {
    const run = () => {
      const depth = p.split('/').length + 1
      let docs = [...store.keys()].filter((k) => k.startsWith(p + '/') && k.split('/').length === depth).map(docSnap)
      for (const [f, op, v] of q.where) {
        docs = docs.filter((s) => {
          const x = field(s.data(), f)
          // Firestore leaves a doc out of every filter on a field it lacks.
          if (x === undefined) return false
          const same = (a, b) => (a && a.toMillis ? a.toMillis() : a) === (b && b.toMillis ? b.toMillis() : b)
          switch (op) {
            case '==': return same(x, v)
            case '!=': return !same(x, v)
            case '<': return cmp(x, v) < 0
            case '<=': return cmp(x, v) <= 0
            case '>': return cmp(x, v) > 0
            case '>=': return cmp(x, v) >= 0
            case 'in': return v.includes(x)
            case 'not-in': return !v.includes(x)
            case 'array-contains': return Array.isArray(x) && x.includes(v)
            case 'array-contains-any': return Array.isArray(x) && x.some((y) => v.includes(y))
            default: return true
          }
        })
      }
      for (const [f, dir] of [...q.order].reverse()) {
        docs.sort((a, b) => cmp(field(a.data(), f), field(b.data(), f)) * (dir === 'desc' ? -1 : 1))
      }
      if (q.limit) docs = docs.slice(0, q.limit)
      return querySnap(docs)
    }
    const next = (patch) => collRef(p, { ...q, ...patch })
    return {
      id: p.split('/').at(-1), path: p,
      doc: (id) => docRef(p + '/' + (id || newId())),
      add: (d) => { const r = docRef(p + '/' + newId()); return r.set(d).then(() => r) },
      where: (f, op, v) => next({ where: [...q.where, [typeof f === 'string' ? f : String(f), op, v]] }),
      orderBy: (f, dir = 'asc') => next({ order: [...q.order, [f, dir]] }),
      limit: (n) => next({ limit: n }), limitToLast: (n) => next({ limit: n }),
      startAfter: () => next({}), startAt: () => next({}), endAt: () => next({}), endBefore: () => next({}),
      withConverter: () => next({}),
      get: () => Promise.resolve(run()),
      onSnapshot: (a, b) => {
        const cb = typeof a === 'function' ? a : b
        const fire = () => { try { cb(run()) } catch (e) { console.error(e) } }
        listeners.add(fire); setTimeout(fire, 30); return () => listeners.delete(fire)
      },
    }
  }
  const db = {
    collection: (c) => collRef(c),
    doc: (p) => docRef(p),
    collectionGroup: (c) => collRef('__group__/' + c),
    batch: () => {
      const ops = []
      const b = {
        set: (r, d, o) => (ops.push(() => r.set(d, o)), b), update: (r, d) => (ops.push(() => r.update(d)), b),
        delete: (r) => (ops.push(() => r.delete()), b), commit: () => Promise.all(ops.map((f) => f().catch(() => {}))).then(() => {}),
      }
      return b
    },
    runTransaction: (fn) => fn({
      get: (r) => r.get(), set(r, d, o) { r.set(d, o); return this }, update(r, d) { r.update(d); return this }, delete(r) { r.delete(); return this },
    }),
    enablePersistence: () => Promise.resolve(), settings: () => {}, terminate: () => Promise.resolve(),
    clearPersistence: () => Promise.resolve(), enableNetwork: () => Promise.resolve(), disableNetwork: () => Promise.resolve(),
    waitForPendingWrites: () => Promise.resolve(),
  }

  // Auth: signed out (Bipolar Bear runs as a guest; the board's standalone
  // path signs in anonymously for its comment threads).
  const authListeners = new Set()
  const auth = {
    currentUser: null,
    onAuthStateChanged(cb) { authListeners.add(cb); setTimeout(() => cb(auth.currentUser), 60); return () => authListeners.delete(cb) },
    onIdTokenChanged(cb) { return auth.onAuthStateChanged(cb) },
    signInAnonymously() {
      auth.currentUser = { uid: 'preview-visitor', isAnonymous: true, email: null, emailVerified: false, providerData: [],
        getIdToken: () => Promise.resolve('preview'), reload: () => Promise.resolve(), delete: () => Promise.resolve() }
      setTimeout(() => authListeners.forEach((cb) => cb(auth.currentUser)), 20)
      return Promise.resolve({ user: auth.currentUser })
    },
    signOut() { auth.currentUser = null; authListeners.forEach((cb) => cb(null)); return Promise.resolve() },
    setPersistence: () => Promise.resolve(), useDeviceLanguage() {}, languageCode: 'en',
  }
  for (const m of ['signInWithEmailAndPassword', 'createUserWithEmailAndPassword', 'sendPasswordResetEmail',
    'signInWithCredential', 'signInWithPopup', 'signInWithRedirect', 'fetchSignInMethodsForEmail', 'sendSignInLinkToEmail'])
    auth[m] = () => Promise.reject(Object.assign(new Error('offline preview'), { code: 'auth/network-request-failed' }))
  auth.getRedirectResult = () => Promise.resolve({ user: null })

  const callables = seed.callables || {}
  // A callable answers with its seed; one seeded as { idle, withArg } answers
  // idle when called with nothing and withArg when called with something (the
  // board's mood check-in reads today's totals, then records yours).
  const answer = (name, data) => {
    const c = callables[name]
    // One seeded as { translate: { English: translation } } answers like
    // translateAnonTexts: the texts it knows, translated from English; the
    // rest as already in the reader's language.
    if (c && c.translate) {
      return { results: ((data && data.texts) || []).map((t) => (c.translate[t] != null ? { text: c.translate[t], src: 'en' } : { text: t, src: '', same: true })) }
    }
    if (c && c.idle) return data && Object.keys(data).length ? c.withArg : c.idle
    return c !== undefined ? c : {}
  }
  const functions = { httpsCallable: (name) => async (data) => ({ data: answer(name, data) }), useEmulator() {} }
  const messaging = { getToken: () => Promise.reject(new Error('unsupported')), onMessage() {}, deleteToken: () => Promise.resolve(), requestPermission: () => Promise.reject(new Error('unsupported')) }

  const app = { name: '[DEFAULT]', options: {}, auth: () => auth, firestore: () => db, functions: () => functions, messaging: () => messaging, delete: () => Promise.resolve() }
  const authFn = Object.assign(() => auth, {
    Auth: { Persistence: { LOCAL: 'local', SESSION: 'session', NONE: 'none' } },
    EmailAuthProvider: { credential: (e, p) => ({ e, p }) }, GoogleAuthProvider: function () {}, OAuthProvider: function () {},
  })
  const firestoreFn = Object.assign(() => db, {
    FieldValue: {
      serverTimestamp: () => SERVER, increment: inc, delete: () => ({ __sv: 'del' }),
      arrayUnion: (...items) => ({ __sv: 'union', items }), arrayRemove: (...items) => ({ __sv: 'remove', items }),
    },
    Timestamp, FieldPath: { documentId: () => '__name__' },
  })
  window.firebase = {
    __preview: true, SDK_VERSION: '10.7.1', apps: [],
    initializeApp(opts) { app.options = opts || {}; this.apps.push(app); return app },
    app: () => app, auth: authFn, firestore: firestoreFn, functions: () => functions,
    messaging: Object.assign(() => messaging, { isSupported: () => false }),
    User: function () {},
  }
}

// ── Invented content ───────────────────────────────────────────────────────
const DAY = 86400000
// Five weeks of Bipolar Bear entries: mostly steady, one gentle low patch and
// one lift, nothing alarming. Index 0 is the day before yesterday: yesterday
// is the day the journal asks about, and the one the video logs.
// `notes` replaces the English day notes (by index), for a localised capture.
export function bearEntries(notes) {
  const moods = [
    'stable', 'stable', 'elevated', 'stable', 'stable', 'stable', 'low',
    'stable', 'stable', 'stable', 'elevated', 'elevated', 'stable', 'stable',
    'stable', 'low', 'low', 'stable', 'stable', 'stable', 'stable',
    'elevated', 'stable', 'stable', 'stable', 'low', 'stable', 'stable',
    'stable', 'stable', 'elevated', 'stable', 'stable', 'stable',
  ]
  notes ??= {
    0: 'Walked to the park with my sister. Quiet, good day.',
    2: 'Lots of energy, kept an eye on it and went to bed on time.',
    6: 'Slow day. Rested, opened the curtains, called mum.',
    11: 'Finished the shelf I started weeks ago.',
    16: 'Heavy morning, lighter by the evening. Early night.',
    21: 'Coffee with an old friend.',
  }
  const out = {}
  const base = new Date(); base.setHours(12, 0, 0, 0)
  moods.forEach((mood, i) => {
    const d = new Date(base.getTime() - (i + 2) * DAY)
    const energy = { elevated: 7, stable: i % 3 ? 5 : 7, low: 3 }[mood]
    const sleep = { elevated: 6.5, stable: [7.5, 8, 7, 8.5][i % 4], low: 9 }[mood]
    const e = {
      date: d.toISOString(), mood, linkedMood: null, energy, sleep,
      sleepQuality: mood === 'low' ? 'unsure' : 'good', medication: 'taken', goals: mood === 'low' ? 'none' : 'some',
      alcohol: null, exercise: i % 3 === 0 ? 'yes' : null, anxiety: mood === 'low' ? 'high' : 'medium', irritability: null,
      stress: 'medium', outside: i % 2 ? 'yes' : null, smoking: null, drugs: null, notes: notes[i] || '', intention: '',
      customFields: {}, budget: null, pdfHidden: false, favourite: i === 11,
      timestamp: d.getTime(), recordedAt: new Date(d.getTime() + 9 * 3600000).toISOString(), recordedTz: 'Europe/London',
    }
    out[`entry:${e.timestamp}`] = e
  })
  return out
}

// The same first-run flags and survival kit as _ipadseed.html.
const BEAR_STORAGE = {
  bbLanguage: 'en', bbTheme: 'light',
  bbWelcomeShown: '1', bbFabFirstRunDone: '1', bbWaFabHidden: '1', bbSurvivalKitVisited: '1',
  bbMoodDefHintDone: '1', bbMedHintDone: '1', bbPersonalHintDone: '1', bbTutorialToastShown: '1', bbHasEntries: '1',
  bbOnboardingStep: '12', bbSettingsFabHintShown: '1', achievementToastsEnabled: 'false',
  // A new user's journal (v313): focus mode's wheel on, every step but Notes.
  // Without bbDefaults20261012 the app takes onboardingStep 12 for someone who
  // was already using it and keeps the old defaults (wheel off).
  bbDefaults20261012: '1', wheelModeEnabled: '1', disabledSteps: ['notes'],
  currentMedList: [{ name: 'Lithium', dosage: '800mg' }, { name: 'Quetiapine', dosage: '200mg' }],
  dailyGoals: ['Walk for 20 minutes', 'Message one friend today', 'Lights out by 11pm'],
  survivalGratitude: ['My morning coffee', 'A check-in text from mum', 'Getting through a hard week'],
  rememberThis: "This feeling is temporary. I've got through every low before, and I will again.",
  copingStrategies: {
    low: ['Get outside for a 10-minute walk', 'Call my sister, even just to say hi', 'Play a game to break the spiral'],
    depressed: ['Open the curtains and let the light in', 'Drink a full glass of water', 'Text someone I trust'],
    manic: ['Step away from any big decisions', 'No new purchases today', 'Call my care team'],
  },
  moodDefinitions: { low: 'Quiet, low energy: everything feels heavier than usual.' },
}

// A guest journal is locked with a PIN before its first save. Set one up as
// the app does (journal.js: PBKDF2 → AES-GCM key, salt in localStorage, key in
// sessionStorage for the unlocked session), so saving goes straight through.
function guestPin(pin = '2580') {
  const salt = randomBytes(16)
  const key = pbkdf2Sync(pin, salt, 100000, 32, 'sha256')
  return {
    local: { bbGuestPinSalt: salt.toString('base64'), bbPinEnabled: '1', bbPinCode: pin, bbPinLinkedUID: 'guest' },
    session: { bb_guest_key: key.toString('base64'), bbPinUnlocked: '1' },
  }
}

// The board: today's topic (from data/daily-topics.json) with three replies,
// and a handful of members' posts. Names, avatars and words are all invented,
// and none of the names is one of the app's own example posts (SEED_POOL).
// Times are minutes ago ({ __ago }), turned into Timestamps in the page.
export function boardDocs() {
  const day = new Date().toISOString().slice(0, 10)
  const G = { orange: ['#ffb340', '#e07800'], blue: ['#64b5f6', '#1565c0'], purple: ['#ce93d8', '#7b1fa2'],
    green: ['#81c784', '#2e7d32'], pink: ['#f48fb1', '#c2185b'], teal: ['#4dd0e1', '#00838f'] }
  const who = (name, initials, g, streak) => ({ name, initials, grad1: G[g][0], grad2: G[g][1], streak, isAdmin: false })
  const P = 'bbAnonPosts/'
  const docs = {
    [`${P}topic-${day}`]: {
      isTopic: true, topicIndex: 2, dayStr: day, text: "What's one small win from today, however tiny?",
      tab: 'general', likes: 9, isSystem: false, pinned: false, commentCount: 3,
      ...who('Hannah', 'HA', 'green', 37), timestamp: { __ago: 50 },
    },
    [`${P}topic-${day}/comments/c1`]: { ...who('WillowBay', 'WB', 'pink', 30), text: 'Made my bed and opened the window before 9. Felt like a proper start.', timestamp: { __ago: 41 } },
    [`${P}topic-${day}/comments/c2`]: { ...who('CopperFinch', 'CF', 'teal', 21), text: 'Took my meds on time all week. Small, but it counts.', timestamp: { __ago: 27 } },
    [`${P}topic-${day}/comments/c3`]: { ...who('LanternLight', 'LL', 'blue', 7), text: 'Answered a message I had been putting off. Weight off.', timestamp: { __ago: 9 } },
    [`${P}p1`]: { tab: 'general', ...who('SoftHarbour', 'SH', 'purple', 63), likes: 6, commentCount: 2,
      text: "Two months stable today. Not perfect, but steadier than I've been in a long time. Thank you all for being here.", timestamp: { __ago: 65 } },
    [`${P}p1/comments/c1`]: { ...who('Juniper', 'JU', 'orange', 42), text: 'Two months! That is brilliant. Well done.', timestamp: { __ago: 60 } },
    [`${P}p1/comments/c2`]: { ...who('BrambleRose', 'BR', 'green', 15), text: 'Love reading this. Steady is a win.', timestamp: { __ago: 56 } },
    [`${P}p2`]: { tab: 'general', ...who('StillWater', 'SW', 'orange', 12), likes: 4, commentCount: 1,
      text: 'Does anyone else keep a wind-down routine? Mine is tea, a short walk and no phone after ten. It helps more than I expected.', timestamp: { __ago: 95 } },
    [`${P}p2/comments/c1`]: { ...who('NorthStar', 'NS', 'purple', 9), text: 'Same here. Audiobooks instead of scrolling changed my sleep.', timestamp: { __ago: 80 } },
    [`${P}p3`]: { tab: 'general', ...who('BrambleRose', 'BR', 'green', 15), likes: 5, commentCount: 0,
      text: 'Went to my first support group meeting last night. Nervous walking in, glad I went.', timestamp: { __ago: 180 } },
    [`${P}p4`]: { tab: 'general', ...who('LanternLight', 'LL', 'blue', 7), likes: 3, commentCount: 0,
      text: 'Gentle reminder to drink some water and eat something today. You matter.', timestamp: { __ago: 420 } },
  }
  return docs
}

// Today's invented check-in totals for the board's "How are you today?".
const MOOD_COUNTS = { manic: 2, elevated: 9, stable: 37, low: 14, depressed: 5 }
const BOARD_CALLABLES = {
  anonMoodCheckin: {
    idle: { checkedIn: false, counts: MOOD_COUNTS },
    withArg: { checkedIn: true, via: 'board', counts: { ...MOOD_COUNTS, stable: MOOD_COUNTS.stable + 1 } },
  },
}

const ANON_STORAGE = {
  bbLanguage: 'en', bbAnonTheme: 'light', bbTheme: 'light',
  bbAnon_verified: 'true', bbAnon_monika: 'BlueHeron', bbAnon_agreedTerms: 'true',
}

// ── Serving ────────────────────────────────────────────────────────────────
async function snapshot(app) {
  const tmp = await mkdtemp(path.join(tmpdir(), 'bb-preview-'))
  if (process.argv.includes('--worktree')) execSync(`rsync -a --exclude .git --exclude store-assets --exclude www-anonymous "${repo}/" "${tmp}/"`)
  else execSync(`git -C "${repo}" archive HEAD | tar -x -C "${tmp}"`)
  if (app === 'anonymous') {
    execSync('node scripts/build-anonymous.js', { cwd: tmp, stdio: 'ignore' })
    return { tmp, root: path.join(tmp, 'www-anonymous') }
  }
  return { tmp, root: tmp }
}

async function serve(ctx, root, seed) {
  const sdk = `(${fakeFirebase})(${JSON.stringify(seed)});`
  await ctx.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    // The SDK is vendored now (vendor/firebasejs/…); gstatic is the old home.
    if ((url.hostname === 'www.gstatic.com' || url.origin === ORIGIN) && url.pathname.includes('/firebasejs/')) {
      return route.fulfill({ contentType: 'text/javascript', body: url.pathname.endsWith('firebase-app-compat.js') ? sdk : '' })
    }
    if (url.origin !== ORIGIN) return route.abort()
    let p = decodeURIComponent(url.pathname)
    if (p.endsWith('/')) p += 'index.html'
    if (p === '/__seed') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>seed</title>' })
    // The board's offline service worker is no use to a recording.
    if (p === '/service-worker.js' || p === '/firebase-messaging-sw.js') return route.fulfill({ status: 404, body: '' })
    try {
      const file = path.join(root, p)
      await route.fulfill({ body: await readFile(file), contentType: TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream' })
    } catch {
      await route.fulfill({ status: 404, body: '' })
    }
  })
}

// 9:41 in the morning where the page is (its time zone), so the greeting is
// "Good morning" in Shanghai and São Paulo too. The day is this machine's
// today, the one bearEntries() counts back from, so "yesterday" in the page
// is always the day the seed leaves unlogged.
function morning(timeZone = 'Europe/London') {
  const now = new Date()
  const part = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(d).map((x) => [x.type, +x.value]))
  const p = part(now)
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(now.getTime() / 1000) * 1000
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 9, 41) - offset)
}

/**
 * Open an app's page, seeded, ready to record. Also used on its own to look
 * around, and by capture-ipad-localized.mjs for stills: `device` (default the
 * kit's iPhone), the app's language `lang`, the browser's `locale` and
 * `timezoneId` (the time zone picks the crisis lines), `storage` laid over
 * the seed (that capture's translated survival kit and entries), and for
 * anonymous the board's `docs` in place of boardDocs() and `translations`
 * (English → the reader's language) for the board's auto-translation.
 */
export async function open(app, { browser, device = IPHONE, lang = 'en', locale = 'en-GB', timezoneId = 'Europe/London', storage: extra = {}, docs, translations, localMorning = false } = {}) {
  const { chromium } = await playwright()
  browser ??= await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
  const { tmp, root } = await snapshot(app)
  const ctx = await browser.newContext({ ...device, locale, timezoneId, serviceWorkers: 'block' })
  const callables = translations ? { ...BOARD_CALLABLES, translateAnonTexts: { translate: translations } } : BOARD_CALLABLES
  const seed = app === 'anonymous' ? { docs: docs ?? boardDocs(), callables } : { docs: {} }
  await serve(ctx, root, seed)
  const pin = guestPin()
  const storage = { ...(app === 'anonymous' ? ANON_STORAGE : { ...BEAR_STORAGE, ...pin.local, ...bearEntries() }), bbLanguage: lang, ...extra }
  const session = app === 'anonymous' ? {} : pin.session
  // The iOS app is this same code in Capacitor's WKWebView: say so, as the
  // shell does, so the web-only bits (install banners, the "web" version tag)
  // stay away. No plugins answer; the app already copes with a missing one.
  await ctx.addInitScript(() => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', isPluginAvailable: () => false,
      Plugins: {}, convertFileSrc: (s) => s, platform: 'ios' }
  })
  // A morning, so the app greets the day the way most people log it.
  // localMorning: 9:41 in the page's own time zone (the previews); otherwise
  // 9:41 London time, as the iPad stills were taken.
  await ctx.clock.install({ time: morning(localMorning ? timezoneId : undefined) })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.warn('[page error]', e.message))
  await prepare(page)
  // Seed localStorage once, on the app's origin, before the app first loads.
  await page.goto(`${ORIGIN}/__seed`)
  await page.evaluate(([s, ss]) => {
    localStorage.clear(); sessionStorage.clear()
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v))
    for (const [k, v] of Object.entries(ss)) sessionStorage.setItem(k, v)
  }, [storage, session])
  return { browser, ctx, page, cleanup: () => rm(tmp, { recursive: true, force: true }) }
}


// ── The App Store locales ──────────────────────────────────────────────────
// App Store locale → the app's language, the browser's locale, the time zone
// (it picks the crisis lines and the greeting), and the key in
// screens-i18n/ipad_seed.json / ipad_anon_board.json for what the "user" and
// the board's members wrote. pt-BR is the app's Portuguese with Brazilian
// notes and Brazil's crisis lines, as on the iPad set.
export const LOCALES = {
  'en-GB': ['en', 'en-GB', 'Europe/London', 'en'],
  'de-DE': ['de', 'de-DE', 'Europe/Berlin', 'de'],
  'es-ES': ['es', 'es-ES', 'Europe/Madrid', 'es'],
  'fr-FR': ['fr', 'fr-FR', 'Europe/Paris', 'fr'],
  it: ['it', 'it-IT', 'Europe/Rome', 'it'],
  'nl-NL': ['nl', 'nl-NL', 'Europe/Amsterdam', 'nl'],
  pl: ['pl', 'pl-PL', 'Europe/Warsaw', 'pl'],
  'pt-BR': ['pt', 'pt-BR', 'America/Sao_Paulo', 'pt-BR'],
  'pt-PT': ['pt', 'pt-PT', 'Europe/Lisbon', 'pt'],
  sv: ['sv', 'sv-SE', 'Europe/Stockholm', 'sv'],
  'zh-Hans': ['zh', 'zh-CN', 'Asia/Shanghai', 'zh'],
}
const i18n = (f) => JSON.parse(readFileSync(path.join(here, 'screens-i18n', f), 'utf8'))

// Bipolar Bear's seed for a locale: the survival kit, meds and day notes in
// that language (capture-ipad-localized.mjs's), and the state of someone a few
// weeks in: the dock unlocked (its white bar and the default 🆘 · + · 🕹️ · 📣,
// not a first run's lone centre button), the kit's "filled in!" confetti
// already played, and home's quick check-in card with its Last 7 days row
// (a new user's default since v313).
function bearStorage(key, tz) {
  const s = key === 'en' ? null : i18n('ipad_seed.json')[key]
  const extra = { bbFabsUnlocked: '1', bbWaFabHidden: '0', bbSurvivalCelebDone: '1', bbHomeDefaults20261012: '1' }
  const entries = bearEntries(s ? s.notes : undefined)
  for (const e of Object.values(entries)) e.recordedTz = tz
  Object.assign(extra, entries)
  if (s) Object.assign(extra, {
    copingStrategies: { low: s.low, depressed: s.depressed, manic: s.manic },
    dailyGoals: s.goals, survivalGratitude: s.gratitude, rememberThis: s.remember,
    moodDefinitions: { low: s.lowDef }, currentMedList: s.meds.map(([name, dosage]) => ({ name, dosage })),
  })
  return extra
}

// The board in a locale: preview.mjs's members, each post and reply in that
// language (ipad_anon_board.json). Today's topic stays as the app posts it
// (English) and the board's auto-translation shows it in the reader's
// language, as it does for every member.
function anonBoard(key) {
  const P = 'bbAnonPosts/', tr = i18n('ipad_anon_board.json')[key], all = boardDocs(), docs = {}
  for (const [k, v] of Object.entries(all)) docs[k] = { ...v }
  const topic = Object.keys(all).find((k) => k.startsWith(P + 'topic-') && !k.includes('/comments/'))
  for (const [k, text] of Object.entries(tr || {})) {
    if (k === 'topic' || !docs[k.startsWith('topic/') ? topic + k.slice(5) : P + k]) continue
    docs[k.startsWith('topic/') ? topic + k.slice(5) : P + k].text = text
  }
  const translations = key === 'en' ? null : { [all[topic].text]: tr.topic }
  return { docs, translations, topic: topic.slice(P.length) }
}

// ── The stories ────────────────────────────────────────────────────────────
const shown = (page, sel, opts) => page.locator(sel, opts).locator('visible=true')

// Every piece of text on screen, as capture-ipad-localized.mjs collects it.
function onScreenText() {
  const out = [], w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n; (n = w.nextNode());) {
    const t = n.textContent.replace(/\s+/g, ' ').trim()
    const el = n.parentElement
    if (!t || !el || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue
    // Where it is first (cheap), its style only if on screen: a board or wiki
    // has thousands of hidden nodes, and the recording waits while this runs.
    const r = document.createRange(); r.selectNodeContents(n)
    const b = r.getBoundingClientRect()
    if (!b.width || !b.height || b.bottom <= 0 || b.top >= innerHeight || b.right <= 0 || b.left >= innerWidth) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue
    out.push(t)
  }
  for (const el of document.querySelectorAll('input[placeholder], textarea[placeholder]')) {
    const b = el.getBoundingClientRect()
    if (b.width && b.height && b.bottom > 0 && b.top < innerHeight && !el.value) out.push('[placeholder] ' + el.placeholder)
  }
  return out
}

/**
 * What a story notes as it runs, in real time: `at(name)` marks a moment,
 * `cut(from, to)` drops the stretch between two marks from the video (a page
 * loading), the mark `poster` is the poster frame, and `text(step)` keeps
 * the text on screen for the English check. Turned into video seconds once
 * the recording is done: the kit lays frames out by their real times, with
 * `lead` ms of the opening screen before the story starts.
 */
function notebook(page) {
  const nb = { t0: 0, marks: {}, cuts: [], log: [] }
  nb.start = () => { nb.t0 = Date.now() }
  nb.at = (name) => { nb.marks[name] = Date.now() }
  nb.cut = (a, b) => nb.cuts.push([a, b])
  nb.text = async (step) => { nb.log.push([step, await page.evaluate(onScreenText)]) }
  return nb
}

/**
 * Swipe focus mode's wheel until the pill with data-val `val` sits under the
 * dial, the way a finger drags it: a touch dot travels with the drag. Snapping
 * is held off while the wheel moves (as the app does for its own writes), so
 * the frames run smoothly, and comes back once the pill is centred.
 */
async function swipeWheel(page, val, { ms = 650, after = 600 } = {}) {
  await page.evaluate(async ({ val, ms }) => {
    const wheel = document.getElementById('fmWheel')
    const pill = wheel.querySelector(`.fm-wheel-btn[data-val="${val}"]`)
    const from = wheel.scrollLeft
    const to = pill.offsetLeft - (wheel.clientWidth - pill.offsetWidth) / 2
    const r = wheel.getBoundingClientRect()
    // The finger moves against the scroll: dragging left brings later pills in.
    const x0 = r.left + r.width / 2 + Math.sign(to - from) * 90, y = r.top + r.height / 2
    const dot = document.createElement('div')
    dot.setAttribute('aria-hidden', 'true')
    dot.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(120,120,128,.42);box-shadow:0 0 0 2px rgba(255,255,255,.55);transition:opacity .35s ease-out,transform .35s ease-out'
    document.documentElement.appendChild(dot)
    wheel.style.scrollSnapType = 'none'
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
    const t0 = performance.now()
    await new Promise((done) => {
      const step = (now) => {
        const t = Math.min(1, (now - t0) / ms), e = ease(t)
        wheel.scrollLeft = from + (to - from) * e
        dot.style.left = (x0 - (to - from) * e) + 'px'; dot.style.top = y + 'px'
        t < 1 ? requestAnimationFrame(step) : done()
      }
      requestAnimationFrame(step)
    })
    wheel.style.scrollSnapType = ''
    dot.style.opacity = '0'; dot.style.transform = 'scale(1.35)'
    setTimeout(() => dot.remove(), 500)
  }, { val, ms })
  await page.waitForTimeout(after)
}

// Where to scroll the journal: `topOf` puts that element `gap` px below the
// top; `show` keeps those elements whole above the dock's white bar and
// `hide` keeps those below it (the "Log in to back up" row), and among the
// places that do both it takes the one nearest the dock (`prefer: 'bottom'`)
// where no button or stat tile is cut by the dock's edge or the top edge, and
// the app's top rows, which the status bar's ground is drawn from, fall on
// plain ground between cards rather than across one (a muddy band). Long
// translations make the tiles taller, so this is worked out on the page.
async function scrollTarget(page, { topOf, show = [], hide = [], gap = 4 }) {
  return page.evaluate(({ topOf, show, hide, gap }) => {
    const dock = document.querySelector('.fab-footer')
    const dockTop = dock && dock.offsetHeight ? dock.getBoundingClientRect().top : innerHeight
    const rect = (el) => { const r = el.getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY } }
    const one = (sel) => { const el = document.querySelector(sel); if (!el) throw new Error(`scrollTarget: no ${sel}`); return rect(el) }
    if (topOf) return one(topOf).top - gap - scrollY
    const S = show.map(one), Hd = hide.map(one)
    const lo = Math.ceil(Math.max(...S.map((r) => r.bottom - dockTop + gap)))
    const hi = Math.floor(Math.min(...S.map((r) => r.top - 2), ...Hd.map((r) => r.top - dockTop - 1)))
    const whole = [...document.querySelectorAll('#stats > *, #journalCard button, #calViewSwitch, #lifeChart, #monthCalendar, .entries-reveal-list > *')]
      .filter((e) => e.offsetHeight).map(rect)
    // The bar's rounded top edge hides a button's last few px anyway; a long
    // translation that leaves no other way tucks a little more under it.
    const cut = (y, tuck) => whole.some((r) => (r.top < y && r.bottom > y + 1) || (r.top < y + dockTop - 1 && r.bottom > y + dockTop + tuck))
    const was = scrollY
    const plain = (y) => {
      scrollTo(0, y)
      if (Math.abs(scrollY - y) > 0.5) return false
      for (const x of [innerWidth * 0.2, innerWidth * 0.5, innerWidth * 0.8]) {
        const e = document.elementFromPoint(x, 2)
        if (e && e.closest('#stats > *, button, #calViewSwitch, #lifeChart, #monthCalendar, .cal-cell, svg')) return false
      }
      return true
    }
    let got = null
    // Failing that (German's tall tiles), the dock still covers nothing and
    // the top edge goes just inside a stat tile's top: a card scrolled a few
    // px under the status bar, not a button half under the dock.
    const tileTop = (y) => Math.min(...whole.filter((r) => r.top < y && r.bottom > y + 1).map((r) => y - r.top), Infinity)
    for (let y = lo; y <= hi && got == null; y++) if (!cut(y, 4) && plain(y)) got = y
    if (got == null) {
      const free = []
      for (let y = lo; y <= hi; y++) {
        const dockCut = whole.some((r) => r.top < y + dockTop - 1 && r.bottom > y + dockTop + 4)
        if (!dockCut) free.push([tileTop(y), y])
      }
      free.sort((a, b) => a[0] - b[0])
      if (free.length) { got = free[0][1]; console.warn(`scrollTarget: top edge ${free[0][0]} px into a tile at ${got}`) }
    }
    scrollTo(0, was)
    if (got == null) { console.warn(`scrollTarget: nothing clean in ${lo}–${hi} (dock ${dockTop}; ${whole.map((r) => `${Math.round(r.top)}-${Math.round(r.bottom)}`).join(' ')})`); got = lo }
    return got - was
  }, { topOf, show, hide, gap })
}

// Bipolar Bear (James, 2026-10-17): home and its quick check-in card → the
// mood journal on focus mode's wheel: yesterday logged (the mood swiped to
// Low and back to Stable, then sleep, energy, meds and the budget), saved →
// the journal's stats and calendar → the life chart, ending on yesterday's
// day picked out on it. Framed so the dock's bar never sits across a card,
// and the "Log in to back up" row stays below it.
const SIGN_IN = '#journalCard button[onclick*="showAuthModal"]'
async function bear(page, out, nb) {
  const yest = new Date(await page.evaluate(() => Date.now()) - 86400000)
  const yKey = await page.evaluate((t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }, yest.getTime())
  await page.goto(`${ORIGIN}/index.html`)
  await shown(page, '#qcOpen').first().waitFor()
  await hold(page, 2200)
  await record(page, async () => {
    nb.start()
    await nb.text('home')
    await hold(page, 1300)
    // Into the journal from the card's header. The journal's own loading
    // spinner, while the page opens, is cut from the video.
    nb.at('tapJournal')
    await tap(page, page.locator('#qcOpen'), { after: 0 })
    await page.waitForTimeout(140)
    nb.at('leaveHome')
    const centre = () => shown(page, '#fmWheel .fm-wheel-btn.center').first()
    await centre().waitFor()
    await page.waitForFunction(() => { const p = document.getElementById('entryLoadingPlaceholder'); const o = document.getElementById('fmWheel'); return o && o.getBoundingClientRect().height > 0 })
    await page.waitForTimeout(120)
    nb.at('wheelIn')
    nb.cut('leaveHome', 'wheelIn')
    await hold(page, 700)
    nb.at('poster')
    await nb.text('mood')
    await hold(page, 600)
    await swipeWheel(page, 'low', { after: 650 })
    await swipeWheel(page, 'stable', { after: 350 })
    await tap(page, centre(), { after: 1050 })
    await nb.text('sleep')
    await tap(page, centre(), { after: 900 })
    await tap(page, centre(), { after: 900 })
    await nb.text('meds')
    await tap(page, centre(), { after: 1000 })
    await nb.text('additional')
    // The budget question's ✅: one question on the step, so it moves on.
    await tap(page, shown(page, 'button').filter({ hasText: /✅/ }).last(), { after: 1200 })
    await nb.text('review')
    await tap(page, shown(page, '.fm-done-save').first(), { after: 1300 })
    await nb.text('saved')
    // Your Journey: the stats, then the month's calendar.
    await tap(page, page.locator('#journalToggleBtn'), { after: 500 })
    await page.locator('#stats').waitFor()
    await scroll(page, await scrollTarget(page, { topOf: '#journalCard', gap: 12 }), { ms: 900, after: 1500 })
    await nb.text('stats')
    await scroll(page, await scrollTarget(page, { show: ['#monthCalendar'], hide: [SIGN_IN] }), { ms: 800, after: 1300 })
    await nb.text('calendar')
    // The life chart: five weeks at a glance, and yesterday, just logged, on it.
    await tap(page, page.locator('#calViewSwitch .cv-opt').nth(1), { after: 600 })
    await scroll(page, await scrollTarget(page, { show: ['#lifeChart'], hide: [SIGN_IN] }), { ms: 800, after: 500 })
    const bar = await page.evaluate(() => {
      const svg = document.querySelector('#lifeChart svg')
      const moods = ['#51cf66', '#d2be00', '#ff6b6b', '#845ef7', '#5c7cfa']
      const last = [...svg.querySelectorAll('rect')].filter((r) => r.id !== 'lcHl' && r.getAttribute('fill') && r.getAttribute('fill') !== '#6495ed')
        .sort((a, b) => +b.getAttribute('x') - +a.getAttribute('x'))[0]
      const r = last.getBoundingClientRect(), s = svg.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: s.top + s.height * 0.4 }
    })
    await tap(page, bar, { after: 300 })
    await nb.text('lifechart')
  }, { out, lead: 700, tail: 2600, edge: { top: 4 } })
}

// Bipolar Anonymous (James, 2026-10-17): the board as it opens (How are you
// today?, today's topic, Help, the dock) → today's topic's thread, its
// replies read → a heart for a member's post → the wiki, an article open →
// back on the board, checking in as Stable: "You're not alone in it", held to
// the end. The feed stays at its top: the board's floating dock always sits
// over a post (its cards' gaps are narrower than the dock), and any scroll
// that clears it slices the greeting card's text or the post under it.
// Nothing leaves the page: the stand-in Firestore keeps it all.
async function anonymous(page, out, nb, { topic }) {
  await page.goto(`${ORIGIN}/index.html`)
  await page.locator('#post-list .mood-btn[data-mood=stable]:not([disabled])').waitFor()
  await page.locator('#post-list .topic-card').waitFor()
  await hold(page, 1500)
  await record(page, async () => {
    nb.start()
    await nb.text('board')
    // The poster: the board as it opens, its five bears asking how you are.
    await hold(page, 500)
    nb.at('poster')
    await hold(page, 1300)
    // Today's topic: what members wrote.
    await tap(page, page.locator(`#post-list [data-comment="${topic}"]`).first(), { after: 1400 })
    await nb.text('thread')
    await hold(page, 1800)
    await tap(page, page.locator('#thread-close'), { after: 700 })
    // A heart for SoftHarbour's two months stable.
    await tap(page, page.locator('#post-list .like-btn[data-id="p1"]'), { after: 1400 })
    await nb.text('heart')
    // The wiki: plain-language notes on treatments, conditions and more.
    await tap(page, page.locator('.board-tab[data-tab="wiki"]'), { after: 900 })
    await tap(page, shown(page, '.wiki-pill[data-wiki="therapies"]').first(), { after: 800 })
    await tap(page, shown(page, '.wiki-card summary').first(), { after: 2400 })
    await nb.text('wiki')
    // Back on the board: How are you today? Stable, and the day's totals.
    await tap(page, page.locator('.board-tab[data-tab="general"]'), { after: 900 })
    await tap(page, page.locator('#post-list .mood-btn[data-mood=stable]'), { after: 1800 })
    await hold(page, 600)
    await nb.text('checkin')
  }, { out, lead: 700, tail: 2400 })
}

// ── After the recording ────────────────────────────────────────────────────
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString()
const probe = (f) => JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height,r_frame_rate', '-of', 'json', f]))

// Drop each [from, to] (video seconds) from `src` into `out`, at the kit's
// encoding (H.264 high, 30 fps, a silent stereo AAC track).
function cutVideo(src, out, cuts) {
  const keep = cuts.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join('+')
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-filter_complex', `[0:v]select='not(${keep})',setpts=N/${FPS}/TB,fps=${FPS},setsar=1,format=yuv420p[v]`,
    '-map', '[v]', '-map', '1:a', '-shortest',
    '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.0', '-crf', '16', '-maxrate', '10M', '-bufsize', '20M',
    '-r', String(FPS), '-c:a', 'aac', '-b:a', '256k', '-ar', '44100', '-ac', '2', '-movflags', '+faststart', out])
}

function contactSheet(file, out) {
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-vf', `fps=1,scale=221:480:flags=area,tile=10x3:padding=4:color=white`, '-frames:v', '1', out])
}

async function finish(app, locale, rawOut, out, nb, lead) {
  const vt = (w) => (w - nb.t0) / 1000 + lead / 1000
  const cuts = nb.cuts.map(([a, b]) => [vt(nb.marks[a]), vt(nb.marks[b])])
  if (cuts.length) cutVideo(rawOut, out, cuts)
  else execSync(`mv "${rawOut}" "${out}"`)
  if (existsSync(rawOut)) await rm(rawOut)
  // A time after the cuts, in the finished video.
  const after = (t) => t - cuts.filter(([a, b]) => b <= t).reduce((s, [a, b]) => s + (b - a), 0)
  const poster = Math.round(after(vt(nb.marks.poster)) * FPS) / FPS
  const p = probe(out), v = p.streams.find((s) => s.width), a = p.streams.find((s) => !s.width)
  const secs = +p.format.duration
  const ok = v.width === W && v.height === H && v.r_frame_rate === `${FPS}/1` && a && secs >= MIN_S && secs <= MAX_S
  const dir = path.dirname(out)
  contactSheet(out, path.join(dir, 'contact.png'))
  run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(poster), '-i', out, '-frames:v', '1', path.join(dir, 'poster.png')])
  await writeFile(path.join(dir, 'texts.txt'), nb.log.map(([step, t]) => `## ${step}\n${t.join('\n')}`).join('\n\n') + '\n')
  // Word-for-word the English run's text: untranslated UI, or a name / number.
  const enTexts = path.join(path.dirname(dir), 'en-GB', 'texts.txt')
  let english = []
  if (locale !== 'en-GB' && existsSync(enTexts)) {
    const en = new Set(readFileSync(enTexts, 'utf8').split('\n').filter((l) => l && !l.startsWith('## ')))
    const lettered = (l) => /\p{L}{3,}/u.test(l.replace(/\[[^\]]*\]/g, ''))
    english = [...new Set(nb.log.flatMap(([, t]) => t))].filter((l) => en.has(l) && lettered(l))
    await writeFile(path.join(dir, 'english.txt'), english.join('\n') + (english.length ? '\n' : ''))
  }
  const meta = { app, locale, secs: +secs.toFixed(2), poster, cuts: cuts.map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]), ok, width: v.width, height: v.height, fps: v.r_frame_rate, audio: a && a.codec_name }
  await writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 1) + '\n')
  console.log(`${ok ? 'OK ' : 'BAD'} ${app} ${locale}: ${secs.toFixed(2)} s, poster ${poster.toFixed(2)} s, cut ${cuts.map(([x, y]) => `${x.toFixed(2)}–${y.toFixed(2)}`).join(', ') || 'none'}${english.length ? `, ${english.length} English line(s): ${english.slice(0, 6).join(' | ')}` : ''}`)
  if (!ok) throw new Error(`${out} is not a valid preview`)
  return meta
}

const DIR = { bear: 'bipolarbear', anonymous: 'anonymous' }

export async function recordLocale(app, locale, { browser } = {}) {
  const [lang, bLocale, tz, key] = LOCALES[locale]
  const dir = path.join(here, 'out/preview', DIR[app], locale)
  const out = path.join(dir, 'iphone-01.mp4'), rawOut = path.join(dir, 'raw.mp4')
  const board = app === 'anonymous' ? anonBoard(key) : null
  const opts = app === 'anonymous'
    ? { docs: board.docs, translations: board.translations }
    : { storage: bearStorage(key, tz) }
  const { browser: b, ctx, page, cleanup } = await open(app, { browser, lang, locale: bLocale, timezoneId: tz, localMorning: true, ...opts })
  const nb = notebook(page)
  page.on('console', (m) => { if (m.text().startsWith('scrollTarget')) console.warn(`  ⚠ ${locale}: ${m.text()}`) })
  try {
    if (app === 'bear') await bear(page, rawOut, nb)
    else await anonymous(page, rawOut, nb, board)
    const meta = await finish(app, locale, rawOut, out, nb, 700)
    if (process.argv.includes('--stills')) console.log((await stills(out, [1, 3, 6, 9, 12, 15, 18, 21])).join('\n'))
    return meta
  } finally {
    await ctx.close(); await cleanup()
    if (!browser) await b.close()
  }
}

if (isMain) {
  const app = process.argv[2]
  if (!DIR[app]) { console.error('usage: node store-assets/preview.mjs bear|anonymous [all | <locale> …] [--stills] [--worktree]'); process.exit(1) }
  const asked = process.argv.slice(3).filter((a) => !a.startsWith('--'))
  const locales = asked.includes('all') ? Object.keys(LOCALES) : asked.length ? asked : ['en-GB']
  for (const l of locales) if (!LOCALES[l]) throw new Error(`unknown locale ${l} (${Object.keys(LOCALES).join(' ')})`)
  // English first: the other locales' English check reads its texts.txt.
  locales.sort((a, b) => (b === 'en-GB') - (a === 'en-GB'))
  const { chromium } = await playwright()
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
  try {
    for (const l of locales) await recordLocale(app, l, { browser })
  } finally {
    await browser.close()
  }
}
