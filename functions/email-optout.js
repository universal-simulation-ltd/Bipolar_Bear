'use strict';

// Opting out of service emails (James, 2026-10-16: "give them a link to opt
// out of important service emails").
//
// An email sent with scripts/send-service-email.mjs carries a link to this
// function with ?id=<optOutId>, where optOutId = base64url(HMAC-SHA256(
// EMAIL_OPTOUT_SECRET, 'bb-email-optout:v1:' + lower-case email)). The link
// holds no email address, and only the sender (who holds the secret) can make
// one. This function needs no secret: it records the id in
// emailOptOuts/{optOutId}, and the send script skips every recipient whose id
// is there. A forged id only adds a document nobody matches.
//
// GET shows a page with one button (mail scanners open links, so a GET must
// not unsubscribe anyone); POST unsubscribes. The email's List-Unsubscribe +
// List-Unsubscribe-Post headers make the mail app's own button POST here
// directly (RFC 8058 one-click).

const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

const ID_RE = /^[A-Za-z0-9_-]{43}$/;

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Bipolar Bear</title><meta name="robots" content="noindex">
<style>body{margin:0;background:#fff8ee;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#333;line-height:1.55}
main{max-width:460px;margin:12vh auto;padding:0 20px;text-align:center}h1{font-size:1.35em}
button{background:#ff9500;color:#fff;border:0;border-radius:12px;padding:12px 26px;font-size:1em;font-weight:700;cursor:pointer}
a{color:#c97900}</style></head><body><main><div style="font-size:2.4em">🐻</div><h1>${title}</h1>${body}</main></body></html>`;
}

exports.emailOptOut = onRequest({ region: 'europe-west1', invoker: 'public', cors: false }, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const id = String((req.body && req.body.id) || req.query.id || '');
  if (!ID_RE.test(id)) {
    res.status(400).send(page('This link has expired', '<p>Something is missing from this link. To stop our emails, reply to any of them, or write to <a href="mailto:bipolar@unisim.co.uk">bipolar@unisim.co.uk</a>, and we\'ll take you off.</p>'));
    return;
  }
  if (req.method === 'POST') {
    await admin.firestore().collection('emailOptOuts').doc(id).set({ at: admin.firestore.FieldValue.serverTimestamp() });
    res.status(200).send(page('You won\'t get these emails any more', '<p>We\'ve taken you off Bipolar Bear\'s service emails. Your journal and account aren\'t affected.</p><p>Changed your mind? Write to <a href="mailto:bipolar@unisim.co.uk">bipolar@unisim.co.uk</a>.</p>'));
    return;
  }
  if (req.method !== 'GET') { res.status(405).send(''); return; }
  res.status(200).send(page('Stop Bipolar Bear emails?', `<p>You'll stop getting our service emails, such as notes about problems and fixes. Your journal and account aren't affected.</p>
<form method="post"><input type="hidden" name="id" value="${id}"><button type="submit">Unsubscribe</button></form>`));
});
