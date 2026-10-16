// Send a Bipolar Bear service email to account holders, one email per person
// (nobody sees anyone else's address), through Resend from
// bipolar@mail.unisim.co.uk with replies going to bipolar@unisim.co.uk.
//
//   node scripts/send-service-email.mjs <email.json> --count
//   node scripts/send-service-email.mjs <email.json> --test a@x.com,b@y.com
//   node scripts/send-service-email.mjs <email.json> --send-all
//
// <email.json> is { "subject": "...", "paras": ["...", "- bullet\n- bullet", ...] }.
// Recipients: every Firebase Auth email except our own and test accounts,
// de-duplicated, minus anyone who opted out. Every email carries its own
// unsubscribe link and RFC 8058 one-click headers (functions/email-optout.js,
// James 2026-10-16), and an opted-out address is skipped on every later send.
//
// Needs the Firebase CLI logged in (its cached token reads Auth + Firestore,
// and `functions:secrets:access` gives RESEND_API_KEY and EMAIL_OPTOUT_SECRET).
// Secrets are never printed.

import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const PROJECT = 'bipolarbear-app';
const REPO = new URL('..', import.meta.url).pathname;
const FROM = 'Bipolar Bear <bipolar@mail.unisim.co.uk>';
const REPLY_TO = 'bipolar@unisim.co.uk';
const OPT_OUT_URL = 'https://europe-west1-bipolarbear-app.cloudfunctions.net/emailOptOut';
const OWN = /jamesmarkey|@unisim\.co\.uk$|bradleysummers|@example\.|@test\./i;

const [file, mode, arg] = process.argv.slice(2);
if (!file || !['--count', '--test', '--send-all'].includes(mode)) {
  console.log('usage: node scripts/send-service-email.mjs <email.json> --count | --test a@x,b@y | --send-all');
  process.exit(2);
}
const mail = JSON.parse(fs.readFileSync(file, 'utf8'));

const secret = (name) => execFileSync('npx', ['-y', 'firebase-tools@latest', 'functions:secrets:access', name, '--project', PROJECT],
  { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').pop();
const token = () => JSON.parse(fs.readFileSync(process.env.HOME + '/.config/configstore/firebase-tools.json', 'utf8')).tokens.access_token;

/** The id an address opts out under: no address in the link, and only the secret's holder can make one. */
const optOutId = (optSecret, email) =>
  crypto.createHmac('sha256', optSecret).update('bb-email-optout:v1:' + email.trim().toLowerCase()).digest('base64url');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function html(paras, unsubUrl) {
  const block = (p) => p.startsWith('- ')
    ? '<ul style="margin:0 0 16px;padding-left:20px;">' + p.split('\n').map((l) => `<li style="margin:0 0 6px;">${esc(l.slice(2))}</li>`).join('') + '</ul>'
    : `<p style="margin:0 0 16px;">${esc(p).replace(/\n/g, '<br>')}</p>`;
  const body = paras.map(block).join('')
    .replace(/(https:\/\/[^\s<]+)/g, '<a href="$1" style="color:#c97900;">$1</a>')
    .replace(/([a-z]+@unisim\.co\.uk)/g, '<a href="mailto:$1" style="color:#c97900;">$1</a>');
  return `<!doctype html><html><body style="margin:0;background:#fff8ee;"><div style="max-width:560px;margin:0 auto;padding:28px 22px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.55;color:#333;">
<div style="font-size:28px;margin-bottom:12px;">🐻</div>${body}
<p style="margin:28px 0 0;font-size:13px;color:#8a8a8a;">You're getting this because you have a Bipolar Bear account. Don't want emails like this? <a href="${unsubUrl}" style="color:#8a8a8a;">Unsubscribe</a>.</p></div></body></html>`;
}
const text = (paras, unsubUrl) => paras.join('\n\n') +
  `\n\n--\nYou're getting this because you have a Bipolar Bear account. Don't want emails like this? Unsubscribe: ${unsubUrl}`;

async function accountEmails() {
  let users = [], next;
  do {
    const r = await (await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:batchGet?maxResults=500` + (next ? '&nextPageToken=' + next : ''),
      { headers: { Authorization: 'Bearer ' + token() } })).json();
    if (r.error) throw new Error(r.error.message);
    users.push(...(r.users || [])); next = r.nextPageToken;
  } while (next);
  const seen = new Set();
  return users.map((u) => (u.email || '').trim().toLowerCase())
    .filter((e) => e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !OWN.test(e) && !seen.has(e) && seen.add(e));
}

async function optedOut() {
  const ids = new Set(); let next;
  do {
    const u = new URL(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/emailOptOuts`);
    u.searchParams.set('pageSize', '300'); u.searchParams.append('mask.fieldPaths', 'at');
    if (next) u.searchParams.set('pageToken', next);
    const j = await (await fetch(u, { headers: { Authorization: 'Bearer ' + token() } })).json();
    if (j.error) throw new Error(j.error.message);
    (j.documents || []).forEach((d) => ids.add(d.name.split('/').pop()));
    next = j.nextPageToken;
  } while (next);
  return ids;
}

async function send(list, optSecret) {
  const resendKey = secret('RESEND_API_KEY');
  // Resend's batch endpoint: up to 100 separate messages per call, each with one To.
  for (let i = 0; i < list.length; i += 100) {
    const batch = list.slice(i, i + 100).map((to) => {
      const unsub = `${OPT_OUT_URL}?id=${optOutId(optSecret, to)}`;
      return {
        from: FROM, to: [to], reply_to: REPLY_TO, subject: mail.subject,
        html: html(mail.paras, unsub), text: text(mail.paras, unsub),
        headers: { 'List-Unsubscribe': `<${unsub}>, <mailto:${REPLY_TO}?subject=unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      };
    });
    const r = await fetch('https://api.resend.com/emails/batch', { method: 'POST', headers: { Authorization: 'Bearer ' + resendKey, 'Content-Type': 'application/json' }, body: JSON.stringify(batch) });
    const j = await r.json();
    console.log(`batch ${i / 100 + 1}: ${r.status}`, Array.isArray(j.data) ? `${j.data.length} sent` : JSON.stringify(j));
  }
}

const optSecret = secret('EMAIL_OPTOUT_SECRET');
if (mode === '--test') {
  await send(arg.split(',').map((s) => s.trim()).filter(Boolean), optSecret);
} else {
  const out = await optedOut();
  const all = await accountEmails();
  const list = all.filter((e) => !out.has(optOutId(optSecret, e)));
  console.log(`account emails: ${all.length}, opted out: ${all.length - list.length}, to send: ${list.length}`);
  if (mode === '--send-all') await send(list, optSecret);
}
