/**
 * Firebase Cloud Messaging service worker — web push for the Bipolar
 * Anonymous board.
 *
 * Separate from `service-worker.js` (the app's offline cache) and from
 * `worker.js` (the Cloudflare edge worker). The browser requires FCM's
 * background handler to live in its own worker file at the site root:
 * `js/shared/anon-push.js` registers this one by name when a member turns
 * notifications on.
 *
 * Everything here runs with the page closed, so it can't share code with the
 * app — the Firebase config below is duplicated from
 * `js/shared/firebase-config.js` on purpose. Keep the two in step; only
 * `messagingSenderId` and `projectId`/`apiKey`/`appId` matter for messaging.
 *
 * @file firebase-messaging-sw.js
 */
/* eslint-env serviceworker */
importScripts('/vendor/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('/vendor/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBlF7DjbOvU4xgM47kAd6Ttx42_W1BPVUY',
  authDomain: 'bipolarbear-app.firebaseapp.com',
  projectId: 'bipolarbear-app',
  storageBucket: 'bipolarbear-app.firebasestorage.app',
  messagingSenderId: '566288727451',
  appId: '1:566288727451:web:8921f3242193df115df53e',
});

const ICON = '/icons/favicons-anonymous/android-chrome-192x192.png';

// Focus an open board rather than opening a second copy of it.
//
// Added BEFORE firebase.messaging() on purpose: the SDK attaches its own
// notificationclick listener when the messaging instance is created, and for a
// push it displayed itself it stops propagation and — with no link in the send
// — only closes the notification. Going first, this one opens the board.
self.addEventListener('notificationclick', function (event) {
  event.stopImmediatePropagation();
  event.notification.close();
  // Ours carry { url }; ones the SDK displayed carry the FCM payload.
  const d = event.notification.data || {};
  const fcm = d.FCM_MSG || {};
  const target = d.url || (fcm.data && fcm.data.url) || '/anonymous.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (const client of list) {
        if (new URL(client.url).pathname.startsWith('/anonymous') && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});

const messaging = firebase.messaging();

// A push with a `notification` block — every one the Cloud Functions send — is
// displayed by the SDK itself before this handler runs, so showing it here too
// would put two in the tray. This only covers data-only messages, tagged so a
// burst of replies to the same thread collapses instead of stacking.
messaging.onBackgroundMessage(function (payload) {
  if (payload.notification) return;
  const data = payload.data || {};
  self.registration.showNotification(data.title || 'Bipolar Anonymous', {
    body: data.body || '',
    icon: ICON,
    tag: data.kind === 'reply' ? 'reply-' + (data.postId || '') : (data.kind || 'anon'),
    data: { url: data.url || '/anonymous.html' },
  });
});
