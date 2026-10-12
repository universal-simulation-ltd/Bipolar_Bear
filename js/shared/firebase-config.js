/**
 * Shared Firebase Web SDK configuration for every BipolarBear page.
 *
 * Exposes `window.BB_FIREBASE_CONFIG` so the inline `<script>` blocks in
 * index.html, journal.html, survival-kit.html and anonymous.html
 * can call `firebase.initializeApp(window.BB_FIREBASE_CONFIG)` instead of
 * each redeclaring the same literal.
 *
 * Note on the API key: the Firebase Web SDK API key is intentionally public.
 * It identifies the project but does not grant access — read/write permissions
 * are enforced by Firestore Security Rules and Cloud Functions IAM. See:
 * https://firebase.google.com/docs/projects/api-keys
 *
 * @file js/shared/firebase-config.js
 */
window.BB_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBlF7DjbOvU4xgM47kAd6Ttx42_W1BPVUY",
  authDomain: "bipolarbear-app.firebaseapp.com",
  projectId: "bipolarbear-app",
  storageBucket: "bipolarbear-app.firebasestorage.app",
  messagingSenderId: "566288727451",
  appId: "1:566288727451:web:8921f3242193df115df53e"
  // No measurementId: the app has no Analytics (removed 2026-10-12).
};

/**
 * Web Push (VAPID) public key for browser notifications on the Bipolar
 * Anonymous board — Firebase console → Project settings → Cloud Messaging →
 * Web configuration → "Web Push certificates" → Key pair.
 *
 * Public by design (it identifies the sender to the browser's push service;
 * the private half never leaves Google). Left empty until it's generated:
 * js/shared/anon-push.js treats an empty key as "web push not available", so
 * the settings sheet says so instead of failing at getToken(). Native builds
 * don't use it at all — they go through FCM's own registration.
 */
window.BB_PUSH_VAPID_KEY = 'BNub0J3a3KbqjXjf6ym4sMVN8D-lHMVhofk_eF0Gq7yEHtEJWM1T1FGYgMN00hWgrqhZ5dpRvpDAr_-OjcQcVGw';
