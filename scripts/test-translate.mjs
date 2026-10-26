#!/usr/bin/env node
/**
 * Browser check for the auto-translation of member-written text
 * (js/shared/translate.js), against a fake translateAnonTexts callable.
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-translate.mjs
 *   ENGINE=webkit (default) | chromium
 *
 * The regressions it guards (James, 2026-10-26 — a Portuguese post in General
 * stayed in Portuguese on his iPhone with auto-translate on):
 *   1. The board re-renders while a translation call is in flight (the Firestore
 *      listener's cache snapshot, then the server one, on every open or resume).
 *      The fresh card was skipped as "already asked for" and the answer only
 *      reached the card it replaced — so the post stayed untranslated until
 *      something else on the board changed.
 *   2. A failed call (offline, the phone just woke, a cold function) was only
 *      retried on the next re-render — on a quiet board, never.
 * Nothing here touches Firebase or the translation API.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const lib = pw.default || pw;
const engine = lib[process.env.ENGINE || 'webkit'];

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x').pathname;
  if (u === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><meta charset="utf-8"><div id="list"></div>'
      + '<script src="/js/shared/brand-config.js"></script>'
      + '<script src="/js/shared/translate.js"></script>');
    return;
  }
  const p = path.join(ROOT, decodeURIComponent(u));
  if (!p.startsWith(ROOT) || !fs.existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/javascript' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const PT = 'Oii pessoal. Hoje recebi o diagnóstico de TAB.';
const EN = 'Hi everyone. Today I received my diagnosis of bipolar disorder.';

const browser = await engine.launch();
let failed = 0;
async function check(name, fn) {
  const page = await browser.newPage();
  try {
    await page.goto(url);
    await page.evaluate(() => { try { localStorage.clear(); } catch (_) {} });
    await page.reload();
    await fn(page);
    console.log('  ok  ', name);
  } catch (e) {
    failed++;
    console.log('  FAIL', name, '\n       ', e.message.split('\n')[0]);
  } finally {
    await page.close();
  }
}

// The fake backend: answers when the test says so (or fails, when told to).
const FAKE = ({ PT, EN }) => {
  window.__calls = 0;
  window.__fail = 0;            // fail this many calls before answering
  window.__hold = [];           // pending resolvers
  window.__auto = false;        // answer at once
  window.render = () => {       // what renderPosts does: fresh markup, then a scan
    document.getElementById('list').innerHTML = '<div class="post-text" data-tt>' + PT + '</div>';
    BB.translate.scan(document.getElementById('list'));
  };
  window.shown = () => document.querySelector('#list .post-text').textContent;
  BB.translate.init({
    callable: ({ texts }) => {
      window.__calls++;
      if (window.__fail > 0) { window.__fail--; return Promise.reject(new Error('network connection lost')); }
      const answer = { data: { results: texts.map(t => (t === PT ? { text: EN, src: 'pt', same: false } : { text: t, src: 'en', same: true })) } };
      if (window.__auto) return Promise.resolve(answer);
      return new Promise(r => window.__hold.push(() => r(answer)));
    },
  });
};

await check('a post is translated into the reader\'s language', async (page) => {
  await page.evaluate(FAKE, { PT, EN });
  await page.evaluate(() => { window.__auto = true; render(); });
  await page.waitForFunction((EN) => shown() === EN, EN, { timeout: 3000 });
});

await check('a re-render while the call is in flight still ends up translated', async (page) => {
  await page.evaluate(FAKE, { PT, EN });
  await page.evaluate(() => render());                         // cache snapshot
  await page.waitForFunction(() => window.__hold.length === 1);
  await page.evaluate(() => render());                         // server snapshot, call still out
  await page.evaluate(() => window.__hold.shift()());          // the answer lands
  await page.waitForFunction((EN) => shown() === EN, EN, { timeout: 3000 });
  assert.equal(await page.evaluate(() => window.__calls), 1, 'one call, not one per render');
  assert.ok(await page.evaluate(() => !!document.querySelector('#list .tt-bar')), 'the "Translated from" line is shown');
});

await check('a failed call is tried again without waiting for a re-render', async (page) => {
  await page.evaluate(FAKE, { PT, EN });
  await page.evaluate(() => { window.__fail = 1; window.__auto = true; render(); });
  await page.waitForFunction((EN) => shown() === EN, EN, { timeout: 15000 });
  assert.equal(await page.evaluate(() => window.__calls), 2);
});

await check('switched off: nothing is called and the post reads as written', async (page) => {
  await page.evaluate(FAKE, { PT, EN });
  await page.evaluate(() => { BB.translate.setOn(false); window.__auto = true; render(); });
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => shown()), PT);
  assert.equal(await page.evaluate(() => window.__calls), 0);
});

await browser.close();
server.close();
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
