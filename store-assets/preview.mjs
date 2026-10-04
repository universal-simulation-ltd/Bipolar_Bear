#!/usr/bin/env node
// The App Store app previews (iPhone, 886×1920, 15–30 s) for BIPOLAR BEAR and
// BIPOLAR ANONYMOUS (James, 2026-10-04): the real app, driven the way a person
// would, recorded by the UNI·SIM store kit (Docs_UNI_SIM/store-kit/preview.mjs:
// status bar, touch dots, encoding, Apple's checks).
//
//   node store-assets/preview.mjs bear        → out/preview/bipolarbear/en/iphone-01.mp4
//   node store-assets/preview.mjs anonymous   → out/preview/anonymous/en/iphone-01.mp4
//   … --stills                                and PNG stills beside it, to look at
//   … --worktree                              serve the working tree instead of HEAD
//
// What it serves: a copy of the committed app (git archive HEAD, so a neighbour
// session's uncommitted work never ends up in a store video), and for
// anonymous the Bipolar Anonymous bundle scripts/build-anonymous.js makes from
// it (anonymous.html as index.html, BB_BRAND.bundle = 'anonymous'), both in a
// temp folder: nothing in the repo is written but the mp4.
//
// What it shows: invented data only, as the screenshot captures
// (_ipadseed.html) do. Bipolar Bear runs as a guest, its five weeks of entries
// and survival kit seeded into localStorage. Firebase never loads: the four
// gstatic SDK scripts are answered with a small in-memory stand-in
// (fakeFirebase below), so no request reaches Firestore, Auth or Functions,
// and the Bipolar Anonymous board, its daily topic and its replies are
// invented docs in that stand-in. Every other off-site request is refused.
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { pbkdf2Sync, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
const kit = await import('file:///Users/jamesmarkey/Github/UNISIM/Docs_UNI_SIM/store-kit/preview.mjs')
const { IPHONE, playwright, prepare, record, stills, tap, type, scroll, hold } = kit

const ORIGIN = 'http://localhost:8765'
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
function bearEntries() {
  const moods = [
    'stable', 'stable', 'elevated', 'stable', 'stable', 'stable', 'low',
    'stable', 'stable', 'stable', 'elevated', 'elevated', 'stable', 'stable',
    'stable', 'low', 'low', 'stable', 'stable', 'stable', 'stable',
    'elevated', 'stable', 'stable', 'stable', 'low', 'stable', 'stable',
    'stable', 'stable', 'elevated', 'stable', 'stable', 'stable',
  ]
  const notes = {
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
function boardDocs() {
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
    if (url.hostname === 'www.gstatic.com' && url.pathname.includes('/firebasejs/')) {
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

function morning() {
  const d = new Date(); d.setHours(9, 41, 0, 0); return d
}

/** Open an app's page, seeded, ready to record. Also used on its own to look around. */
export async function open(app, { browser } = {}) {
  const { chromium } = await playwright()
  browser ??= await chromium.launch()
  const { tmp, root } = await snapshot(app)
  const ctx = await browser.newContext({ ...IPHONE, locale: 'en-GB', timezoneId: 'Europe/London', serviceWorkers: 'block' })
  const seed = app === 'anonymous' ? { docs: boardDocs(), callables: BOARD_CALLABLES } : { docs: {} }
  await serve(ctx, root, seed)
  const pin = guestPin()
  const storage = app === 'anonymous' ? ANON_STORAGE : { ...BEAR_STORAGE, ...pin.local, ...bearEntries() }
  const session = app === 'anonymous' ? {} : pin.session
  // The iOS app is this same code in Capacitor's WKWebView: say so, as the
  // shell does, so the web-only bits (install banners, the "web" version tag)
  // stay away. No plugins answer; the app already copes with a missing one.
  await ctx.addInitScript(() => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', isPluginAvailable: () => false,
      Plugins: {}, convertFileSrc: (s) => s, platform: 'ios' }
  })
  // A morning, so the app greets the day the way most people log it.
  await ctx.clock.install({ time: morning() })
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

// ── The stories ────────────────────────────────────────────────────────────
const shown = (page, sel, opts) => page.locator(sel, opts).locator('visible=true')

// Bipolar Bear: yesterday logged in five taps on the journal's step-by-step
// card → five weeks at a glance → the survival kit's coping strategies →
// back to the journal, held on the life chart.
async function bear(page, out) {
  await page.goto(`${ORIGIN}/journal.html`)
  await shown(page, '.mood-btn.mood-stable').first().waitFor()
  await hold(page, 900)
  await record(page, async () => {
    // Log yesterday: mood, sleep, energy, meds, a line of notes, save.
    await hold(page, 300)
    await tap(page, shown(page, '.mood-btn.mood-stable').first(), { after: 1000 })
    await tap(page, shown(page, '.fm-card-btn', { hasText: '7–9h' }).first(), { after: 900 })
    await tap(page, shown(page, '.fm-card-btn', { hasText: 'Normal' }).first(), { after: 900 })
    await tap(page, shown(page, '.fm-opt', { hasText: '✅' }).last(), { after: 600 })
    await type(page, page.locator('#fmNotesInput'), 'Calm day. Walk with Sam.', { delay: 38, after: 300 })
    await tap(page, shown(page, '.fm-notes-next').first(), { after: 1200 })
    await tap(page, shown(page, '.fm-done-save').first(), { after: 1000 })
    // Five weeks at a glance.
    await tap(page, page.locator('#journalToggleBtn'), { after: 1500 })
    // The survival kit: what helps when things get low.
    await scroll(page, -3000, { ms: 600, after: 200 })
    await tap(page, page.locator('#survivalNavBtn'), { after: 1400 })
    await tap(page, shown(page, 'a.sk-tab', { hasText: 'Coping' }).first(), { after: 450 })
    await tap(page, shown(page, '#coping-strategies .mood-icon-btn.low').first(), { after: 1800 })
    // Back to the journal, and the life chart.
    await scroll(page, -3000, { ms: 600, after: 200 })
    await tap(page, page.locator('#skJournalNavBtn'), { after: 1300 })
    await tap(page, page.locator('#journalToggleBtn'), { after: 1000 })
    await tap(page, shown(page, 'button', { hasText: 'Life chart' }).first(), { after: 700 })
    // Settle with the Calendar | Life chart switch just under the status bar,
    // so the bar sits on the card's plain ground rather than its numbers.
    const top = await shown(page, 'button', { hasText: 'Life chart' }).first().evaluate((b) => b.getBoundingClientRect().top)
    await scroll(page, top - 10, { ms: 900, after: 0 })
    // The status bar's ground is row 4 of the app, not the kit's 16: the survival
    // kit's sticky tab strip has its icons on row 16, which would streak the bar.
  }, { out, tail: 2000, edge: { top: 4 } })
}

// Bipolar Anonymous: the board on a calm morning, checking in as Stable → the
// daily topic's thread, answered under a moniker → the built-in wiki → back
// to the board, held.
async function anonymous(page, out) {
  await page.goto(`${ORIGIN}/index.html`)
  await page.locator('#post-list .mood-btn[data-mood=stable]:not([disabled])').waitFor()
  await page.locator('#post-list .topic-card').waitFor()
  await hold(page, 900)
  await record(page, async () => {
    await hold(page, 300)
    // How are you today? Stable, and the board says you're not alone.
    await tap(page, page.locator('#post-list .mood-btn[data-mood=stable]'), { after: 2300 })
    // Today's topic, its replies, and one more.
    await tap(page, page.locator('#post-list .topic-card'), { after: 1300 })
    await type(page, page.locator('#thread-ta'), 'A short walk before breakfast. Felt good.', { delay: 38, after: 300 })
    await tap(page, page.locator('#thread-send'), { after: 1700 })
    await tap(page, page.locator('#thread-close'), { after: 600 })
    // The wiki: plain-English notes on treatments, conditions and more.
    await tap(page, shown(page, '.board-tab', { hasText: 'Wiki' }).first(), { after: 900 })
    await tap(page, shown(page, '.wiki-pill', { hasText: 'Therapies' }).first(), { after: 800 })
    await tap(page, shown(page, '.wiki-card summary').first(), { after: 2600 })
    // Back to the board, down past the topic to the members' posts.
    await tap(page, shown(page, '.board-tab', { hasText: 'General' }).first(), { after: 900 })
    const feed = await page.evaluate(() => {
      for (const el of [document.querySelector('#post-list'), ...document.querySelectorAll('#post-list *')]) {
        let e = el
        while (e && e !== document.body) { const o = getComputedStyle(e).overflowY; if ((o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight) return e.id ? '#' + e.id : null; e = e.parentElement }
      }
      return null
    })
    // Today's topic near the top, and the feed's last visible card ending just
    // above the bottom edge, so the home indicator's ground (the app's bottom
    // rows, stretched) is the feed's plain background rather than a line of text.
    const dy = await page.evaluate(() => {
      const H = innerHeight, want = H - 8
      let dy = document.querySelector('#post-list .topic-card').getBoundingClientRect().top - 110
      const ends = [...document.querySelectorAll('#post-list > *')].map((c) => c.getBoundingClientRect().bottom - dy)
      const best = ends.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a), Infinity)
      if (Math.abs(best - want) < 120) dy += best - want
      return dy
    })
    await scroll(page, dy, { ms: 1100, selector: feed, after: 0 })
  }, { out, tail: 2600 })
}

const OUT = {
  bear: path.join(here, 'out/preview/bipolarbear/en/iphone-01.mp4'),
  anonymous: path.join(here, 'out/preview/anonymous/en/iphone-01.mp4'),
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const app = process.argv[2]
  if (!OUT[app]) { console.error('usage: node store-assets/preview.mjs bear|anonymous [--stills] [--worktree]'); process.exit(1) }
  const { browser, page, cleanup } = await open(app)
  try {
    await (app === 'bear' ? bear : anonymous)(page, OUT[app])
    if (process.argv.includes('--stills')) console.log((await stills(OUT[app], [1, 3, 6, 9, 12, 15, 18, 21])).join('\n'))
  } finally {
    await browser.close(); await cleanup()
  }
}
