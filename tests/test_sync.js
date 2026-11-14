"use strict";

// Two phones and one private repository. What matters is that an entry made on
// one turns up on the other, and above all that no sync ever writes one
// phone's log over the other's. The ways that went wrong were all about size
// and time rather than logic: a log grown past a megabyte, which GitHub's
// Contents API stops sending; a reply that could not be read; and a request
// that never came back, which used to hold up every sync after it.

const crypto = require('crypto');
const h = require('./helpers');
const t = h.tally();
const ok = t.ok;
const APP = h.APP;

// ---------- a GitHub in miniature, shared by every phone ----------
const LOG = 'baby-tracker-log.json';
const gh = { file: null, sha: null, n: 0, puts: [], hang: false, calls: [] };

function store(text) {
  gh.n++;
  gh.file = text;
  gh.sha = 'sha' + gh.n;
}

function answer(url, method, body) {
  gh.calls.push(method + ' ' + url.replace(/\?.*$/, ''));
  if (gh.hang) return { hang: true };
  const reply = (status, obj) => ({ status, body: JSON.stringify(obj) });
  const blob = /\/git\/blobs\/([^/?]+)/.exec(url);
  if (blob) {
    if (blob[1] !== gh.sha) return reply(404, {});
    return reply(200, { sha: gh.sha, size: gh.file.length, encoding: 'base64',
      content: Buffer.from(gh.file).toString('base64') });
  }
  const m = /\/contents\/([^?]*)/.exec(url);
  const path = m ? decodeURIComponent(m[1]) : '';
  if (path === '' && method === 'GET') {
    return reply(200, gh.file === null ? [] : [{ type: 'file', name: LOG, sha: gh.sha }]);
  }
  if (path !== LOG) return reply(404, {});
  if (method === 'GET') {
    if (gh.file === null) return reply(404, {});
    // What the real one does past a megabyte: names it, sends nothing.
    if (gh.file.length > 1024 * 1024) {
      return reply(200, { name: LOG, sha: gh.sha, size: gh.file.length, content: '', encoding: 'none' });
    }
    return reply(200, { name: LOG, sha: gh.sha, size: gh.file.length, encoding: 'base64',
      content: Buffer.from(gh.file).toString('base64') });
  }
  if (method === 'PUT') {
    const sent = JSON.parse(body);
    if (gh.file !== null && sent.sha !== gh.sha) return reply(409, {});
    store(Buffer.from(sent.content, 'base64').toString('utf8'));
    gh.puts.push(JSON.parse(gh.file));
    return reply(200, { content: { sha: gh.sha } });
  }
  return reply(404, {});
}

async function phone(b, clock) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, timezoneId: 'UTC' });
  if (clock) await ctx.clock.install({ time: new Date('2026-11-13T19:00:00Z') });
  await ctx.exposeFunction('__gh', (url, method, body) => answer(url, method, body));
  await ctx.addInitScript(() => {
    const real = window.fetch;
    window.fetch = (url, opts) => {
      url = String(url);
      if (url.indexOf('api.github.com') === -1) return real(url, opts);
      return window.__gh(url, (opts && opts.method) || 'GET', (opts && opts.body) || null)
        .then(r => r.hang ? new Promise(() => {}) : new Response(r.body, { status: r.status }));
    };
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', e => errs.push('ERR ' + e.message));
  await page.goto(APP);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('baby-tracker-sync', JSON.stringify({ repo: 'us/log', token: 'x', sha: null }));
  });
  return page;
}

const errs = [];
const count = p => p.evaluate(() => JSON.parse(localStorage.getItem('baby-tracker-events') || '[]').length);
const status = p => p.evaluate(() => document.getElementById('syncStatus').textContent);
const resume = p => p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
const syncNow = p => p.evaluate(() => document.getElementById('syncNow').click());
const settled = p => p.waitForFunction(() =>
  !/Syncing/.test(document.getElementById('syncStatus').textContent));

function entries(n, from) {
  const out = [];
  let at = Date.parse('2026-06-01T00:00:00Z');
  for (let i = 0; i < n; i++) {
    at += 20 * 60000;
    const iso = new Date(at).toISOString();
    out.push(i % 2
      ? { id: from + crypto.randomUUID(), type: 'diaper', nappy: 'wet', time: iso, updatedAt: iso }
      : { id: from + crypto.randomUUID(), type: 'feed', time: iso, updatedAt: iso });
  }
  return out;
}

(async () => {
  const b = await h.launch();

  // ---------- an entry crosses over ----------
  const a = await phone(b);
  const w = await phone(b);
  await a.goto(APP);
  await a.waitForLoadState('load');
  await w.goto(APP);
  await w.waitForLoadState('load');
  await settled(a);
  await settled(w);
  const putsBefore = gh.puts.length;
  await a.click('#btnFeed');
  const tapped = Date.now();
  while (gh.puts.length === putsBefore && Date.now() - tapped < 15000) await a.waitForTimeout(200);
  const took = Date.now() - tapped;
  ok('a tap goes up within a few seconds', gh.puts.length > putsBefore && took < 7000, took + ' ms');
  await resume(w);
  await w.waitForFunction(() => JSON.parse(localStorage.getItem('baby-tracker-events') || '[]').length === 1);
  ok('and the other phone has it as soon as it is opened', await count(w) === 1);
  await a.context().close();
  await w.context().close();

  // ---------- a log past a megabyte ----------
  const big = entries(7600, 'big-');
  store(JSON.stringify({ app: 'baby-tracker', version: 4, meta: {}, events: big }));
  ok('the log up there is over a megabyte', gh.file.length > 1024 * 1024, gh.file.length);
  const putsAtBig = gh.puts.length;
  const p = await phone(b);
  await p.evaluate(() => localStorage.setItem('baby-tracker-events', JSON.stringify([
    { id: 'mine-1', type: 'feed', time: '2026-11-13T18:00:00.000Z', updatedAt: '2026-11-13T18:00:00.000Z' }
  ])));
  await p.goto(APP);
  await p.waitForLoadState('load');
  await p.waitForFunction(() => /last synced/.test(document.getElementById('syncStatus').textContent),
    null, { timeout: 30000 });
  ok('a phone still reads all of it', await count(p) === 7601, await count(p));
  ok('by asking for it again as a blob', gh.calls.some(c => /git\/blobs\/sha/.test(c)));
  const pushed = gh.puts.slice(putsAtBig);
  ok('and what it writes back keeps every entry, its own as well',
    pushed.length === 1 && pushed[0].events.length === 7601, pushed.map(d => d.events.length));
  await p.context().close();

  // ---------- a reply that cannot be read ----------
  store('{"app":"baby-tracker","events":[{"id":"x"');
  const putsAtBad = gh.puts.length;
  const q = await phone(b);
  await q.evaluate(() => localStorage.setItem('baby-tracker-events', JSON.stringify([
    { id: 'mine-2', type: 'feed', time: '2026-11-13T18:00:00.000Z', updatedAt: '2026-11-13T18:00:00.000Z' }
  ])));
  await q.goto(APP);
  await q.waitForLoadState('load');
  await q.waitForFunction(() => /Couldn't read the log/.test(document.getElementById('syncStatus').textContent));
  ok('a log it cannot read is never written over', gh.puts.length === putsAtBad);
  ok('and the phone keeps its own entry', await count(q) === 1);
  await q.context().close();

  // ---------- a request that never comes back ----------
  store(JSON.stringify({ app: 'baby-tracker', version: 4, meta: {}, events: entries(3, 'hang-') }));
  const c = await phone(b, true);
  gh.hang = true;
  await c.goto(APP);
  await c.waitForLoadState('load');
  await c.waitForTimeout(300);
  ok('while GitHub says nothing, the phone is syncing', /Syncing/.test(await status(c)));
  await c.clock.fastForward('00:30');
  await c.waitForFunction(() => /took too long/.test(document.getElementById('syncStatus').textContent));
  ok('it gives up after a while and says so', true);
  gh.hang = false;
  await c.clock.fastForward('00:10');
  await c.waitForFunction(() => /last synced/.test(document.getElementById('syncStatus').textContent));
  ok('then tries again by itself, and gets through', await count(c) === 3, await count(c));

  // Frozen with the phone: the request is stuck and so are the page's timers,
  // so only the wall clock has moved when somebody opens it again.
  gh.hang = true;
  await syncNow(c);
  await c.waitForTimeout(200);
  gh.hang = false;
  const now = await c.evaluate(() => Date.now());
  await c.clock.setSystemTime(new Date(now + 3 * 60000));
  // Five more, made on the other phone meanwhile.
  store(JSON.stringify({ app: 'baby-tracker', version: 4, meta: {}, events: JSON.parse(gh.file).events.concat(entries(5, 'later-')) }));
  await resume(c);
  await c.waitForFunction(() => JSON.parse(localStorage.getItem('baby-tracker-events') || '[]').length === 8);
  ok('a sync frozen with the phone does not hold up the next one', await count(c) === 8);
  await c.context().close();

  ok('no page errors', errs.length === 0, errs);
  await b.close();
  t.done();
})().catch(e => { console.error(e); process.exit(1); });
