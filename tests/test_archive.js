"use strict";

// The archive: the settled past kept in one file per month beside the live
// file, so a tap sends a fortnight rather than the whole history. Everything
// here is about one promise — however the files are split, written, raced
// or lost, no entry goes missing and the two phones end up agreeing — and
// one benefit: the everyday sync stays small.

const crypto = require('crypto');
const h = require('./helpers');
const t = h.tally();
const ok = t.ok;
const APP = h.APP;

const LOG = 'baby-tracker-log.json';
const NOW = new Date('2026-11-14T12:00:00Z');
const DAY = 86400000;

// ---------- a GitHub in miniature, with folders ----------
const gh = {
  files: {},          // path -> { text, sha }
  n: 0,
  puts: [],           // { path, bytes, doc }
  gets: [],           // paths fetched with content
  conflictOnce: {},   // path -> true: the next PUT to it is refused with 409
  hang: false
};

function setFile(path, text) {
  gh.n++;
  gh.files[path] = { text, sha: 'sha' + gh.n };
}

function treeSha(prefix) {
  const shas = Object.keys(gh.files).filter(p => p.indexOf(prefix + '/') === 0).sort()
    .map(p => gh.files[p].sha);
  return shas.length ? 'tree-' + crypto.createHash('sha1').update(shas.join(',')).digest('hex').slice(0, 12) : null;
}

function answer(url, method, body) {
  if (gh.hang) return { hang: true };
  const reply = (status, obj) => ({ status, body: JSON.stringify(obj) });
  const blob = /\/git\/blobs\/([^/?]+)/.exec(url);
  if (blob) {
    const path = Object.keys(gh.files).find(p => gh.files[p].sha === blob[1]);
    if (!path) return reply(404, {});
    gh.gets.push(path);
    return reply(200, { sha: blob[1], encoding: 'base64', size: gh.files[path].text.length,
      content: Buffer.from(gh.files[path].text).toString('base64') });
  }
  const m = /\/contents\/([^?]*)/.exec(url);
  const path = m ? decodeURIComponent(m[1]).replace(/\/$/, '') : '';
  if (method === 'GET') {
    // A folder (or the root): its direct children, with a tree sha for each subfolder.
    const prefix = path ? path + '/' : '';
    const isDir = Object.keys(gh.files).some(p => p.indexOf(prefix) === 0 && p !== path) && !gh.files[path];
    if (path === '' || isDir) {
      const seen = {};
      const out = [];
      Object.keys(gh.files).filter(p => p.indexOf(prefix) === 0).forEach(p => {
        const rest = p.slice(prefix.length);
        const slash = rest.indexOf('/');
        if (slash === -1) out.push({ type: 'file', name: rest, sha: gh.files[p].sha });
        else if (!seen[rest.slice(0, slash)]) {
          seen[rest.slice(0, slash)] = true;
          out.push({ type: 'dir', name: rest.slice(0, slash), sha: treeSha(prefix + rest.slice(0, slash)) });
        }
      });
      return reply(200, out);
    }
    const f = gh.files[path];
    if (!f) return reply(404, {});
    gh.gets.push(path);
    if (f.text.length > 1024 * 1024) {
      return reply(200, { name: path, sha: f.sha, size: f.text.length, content: '', encoding: 'none' });
    }
    return reply(200, { name: path, sha: f.sha, size: f.text.length, encoding: 'base64',
      content: Buffer.from(f.text).toString('base64') });
  }
  if (method === 'PUT') {
    const sent = JSON.parse(body);
    const f = gh.files[path];
    if (gh.conflictOnce[path]) {
      delete gh.conflictOnce[path];
      return reply(409, {});
    }
    // GitHub's own answers: 422 for a file that exists but no sha was sent,
    // 409 for a sha that is not the current one.
    if (f && !sent.sha) return reply(422, {});
    if (f ? sent.sha !== f.sha : !!sent.sha) return reply(409, {});
    const text = Buffer.from(sent.content, 'base64').toString('utf8');
    setFile(path, text);
    gh.puts.push({ path, bytes: body.length, doc: JSON.parse(text) });
    return reply(200, { content: { sha: gh.files[path].sha } });
  }
  return reply(404, {});
}

const errs = [];

async function phone(b, opts) {
  opts = opts || {};
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, timezoneId: 'UTC' });
  await ctx.clock.install({ time: opts.time || NOW });
  await ctx.exposeFunction('__gh', (url, method, body) => answer(url, method, body));
  await ctx.addInitScript(noIdb => {
    const real = window.fetch;
    window.fetch = (url, o) => {
      url = String(url);
      if (url.indexOf('api.github.com') === -1) return real(url, o);
      return window.__gh(url, (o && o.method) || 'GET', (o && o.body) || null)
        .then(r => r.hang ? new Promise(() => {}) : new Response(r.body, { status: r.status }));
    };
    if (noIdb) {
      Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => ({
        open: () => { throw new Error('no IndexedDB here'); } }) });
    }
  }, !!opts.noIdb);
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', e => errs.push('ERR ' + e.message));
  await page.goto(APP);
  await page.evaluate(own => {
    localStorage.clear();
    localStorage.setItem('baby-tracker-sync', JSON.stringify({ repo: 'us/log', token: 'x', sha: null }));
    localStorage.setItem('baby-tracker-events', JSON.stringify(own || []));
  }, opts.own || []);
  await page.goto(APP);
  await page.waitForLoadState('load');
  await synced(page);
  return page;
}

const synced = p => p.waitForFunction(() =>
  /last synced/.test(document.getElementById('syncStatus').textContent) &&
  !/Syncing/.test(document.getElementById('syncStatus').textContent));
const localEvents = p => p.evaluate(() => JSON.parse(localStorage.getItem('baby-tracker-events') || '[]'));
const syncNow = async p => {
  const before = gh.puts.length;
  await p.evaluate(() => {
    document.getElementById('syncStatus').textContent = '';
    document.getElementById('syncNow').click();
  });
  await synced(p);
  return gh.puts.slice(before);
};
const doc = path => gh.files[path] ? JSON.parse(gh.files[path].text) : null;
const ids = list => list.map(e => e.id).sort().join(',');

function entry(time, extra) {
  const iso = new Date(time).toISOString();
  return Object.assign({ id: crypto.randomUUID(), type: 'feed', time: iso, updatedAt: iso }, extra || {});
}

function spread(fromIso, days, perDay) {
  const out = [];
  const start = Date.parse(fromIso);
  for (let i = 0; i < days * perDay; i++) {
    out.push(entry(start + i * (DAY / perDay), i % 3 ? { type: 'diaper', nappy: 'wet' } : null));
  }
  return out;
}

function liveDoc(events, version) {
  return JSON.stringify({ app: 'baby-tracker', version: version || 4, meta: {}, events,
    plans: [], shopping: [], rotaShifts: [], milk: [], journal: [] });
}

function archiveDoc(month, events) {
  return JSON.stringify({ app: 'baby-tracker', kind: 'archive', version: 5, month, events });
}

function reset() {
  gh.files = {};
  gh.puts = [];
  gh.gets = [];
  gh.conflictOnce = {};
  gh.hang = false;
}

(async () => {
  const b = await h.launch();

  // ================= reading an archive that is already there =================
  reset();
  const aug = spread('2026-08-01T00:00:00Z', 31, 30);
  const sep = spread('2026-09-01T00:00:00Z', 30, 30);
  const recent = spread('2026-11-08T00:00:00Z', 6, 4);
  setFile('archive/events-2026-08.json', archiveDoc('2026-08', aug));
  setFile('archive/events-2026-09.json', archiveDoc('2026-09', sep));
  setFile(LOG, liveDoc(recent, 5));
  const mine = entry(NOW.getTime() - 3600000);
  const p = await phone(b, { own: [mine] });
  let have = await localEvents(p);
  ok('a phone meeting the archive takes in every month and the live file',
    have.length === aug.length + sep.length + recent.length + 1, have.length);
  let live = doc(LOG);
  ok('what it sends back leaves the archived months out',
    live.events.length === recent.length + 1 && live.version === 5, [live.events.length, live.version]);
  ok('and writes nothing to the archive', !gh.puts.some(x => x.path.indexOf('archive/') === 0));

  await p.click('#btnFeed');
  gh.gets = [];
  let sent = await syncNow(p);
  const tap = sent.filter(x => x.path === LOG);
  ok('a tap afterwards sends only the live file, and a small one',
    tap.length === 1 && tap[0].bytes < 50 * 1024 && sent.length === 1, sent.map(x => [x.path, x.bytes]));
  ok('and reads no month again', !gh.gets.some(g => g.indexOf('archive/') === 0), gh.gets);

  // Lost locally: everything the archive holds comes back.
  await p.evaluate(keep => localStorage.setItem('baby-tracker-events', JSON.stringify(keep)), recent);
  await p.reload();
  await p.waitForLoadState('load');
  await synced(p);
  have = await localEvents(p);
  ok('a phone that lost its past reads the months again and has it all back',
    have.length >= aug.length + sep.length + recent.length, have.length);
  ok('without leaving its past in the live file', doc(LOG).events.length < 100, doc(LOG).events.length);

  // A month that cannot be read is never written over, and what it held goes up in the live file.
  gh.files['archive/events-2026-09.json'] = { text: '{"app":"baby-tracker","events":[{"id"', sha: 'sha-broken' };
  sent = await syncNow(p);
  live = doc(LOG);
  ok('a month that cannot be read is not written to', !sent.some(x => x.path.indexOf('archive/') === 0));
  ok('and its entries go up in the live file instead, so nothing is lost',
    sep.every(e => live.events.some(l => l.id === e.id)), live.events.length);
  await p.context().close();

  // Without IndexedDB.
  reset();
  setFile('archive/events-2026-08.json', archiveDoc('2026-08', aug));
  setFile(LOG, liveDoc(recent, 5));
  const q = await phone(b, { noIdb: true });
  have = await localEvents(q);
  ok('without IndexedDB a phone still reads everything', have.length === aug.length + recent.length, have.length);
  await q.click('#btnFeed');
  sent = await syncNow(q);
  ok('and still sends only the live file', sent.length === 1 && doc(LOG).events.length === recent.length + 1,
    [sent.length, doc(LOG).events.length]);
  await q.context().close();

  // An archive month past a megabyte comes through the blob path.
  reset();
  const big = spread('2026-07-01T00:00:00Z', 31, 260);
  setFile('archive/events-2026-07.json', archiveDoc('2026-07', big));
  ok('(that month is over a megabyte)', gh.files['archive/events-2026-07.json'].text.length > 1024 * 1024);
  setFile(LOG, liveDoc([], 5));
  const r = await phone(b);
  ok('an archive month over a megabyte is read whole', (await localEvents(r)).length === big.length);
  await r.context().close();

  ok('no page errors', errs.length === 0, errs);
  await b.close();
  t.done();
})().catch(e => { console.error(e); process.exit(1); });
