"use strict";

// Goals, set from one phone. Two phones and one private repository: the goals
// are their own record on their own clock, so changing the routine on the
// other phone never carries a stale copy of them over; once a phone owns
// them the other shows them locked and nothing it sends replaces them; and
// ownership moves only when somebody asks for it.

const h = require('./helpers');
const t = h.tally();
const ok = t.ok;
const APP = h.APP;
const TZ = process.env.TZ || 'UTC';

const LOG = 'baby-tracker-log.json';
const gh = { file: null, sha: null, n: 0, down: false };

function store(text) {
  gh.n++;
  gh.file = text;
  gh.sha = 'sha' + gh.n;
}
const remote = () => (gh.file ? JSON.parse(gh.file) : null);

function answer(url, method, body) {
  const reply = (status, obj) => ({ status, body: JSON.stringify(obj) });
  if (gh.down) return { down: true };
  const blob = /\/git\/blobs\/([^/?]+)/.exec(url);
  if (blob) {
    if (blob[1] !== gh.sha) return reply(404, {});
    return reply(200, { sha: gh.sha, encoding: 'base64', content: Buffer.from(gh.file).toString('base64') });
  }
  const m = /\/contents\/([^?]*)/.exec(url);
  const path = m ? decodeURIComponent(m[1]) : '';
  if (path === '' && method === 'GET') {
    return reply(200, gh.file === null ? [] : [{ type: 'file', name: LOG, sha: gh.sha }]);
  }
  if (path !== LOG) return reply(404, {});
  if (method === 'GET') {
    if (gh.file === null) return reply(404, {});
    return reply(200, { name: LOG, sha: gh.sha, encoding: 'base64', content: Buffer.from(gh.file).toString('base64') });
  }
  if (method === 'PUT') {
    const sent = JSON.parse(body);
    if (gh.file !== null && sent.sha !== gh.sha) return reply(409, {});
    store(Buffer.from(sent.content, 'base64').toString('utf8'));
    return reply(200, { content: { sha: gh.sha } });
  }
  return reply(404, {});
}

const errs = [];

async function phone(b, author, before) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, timezoneId: TZ });
  await ctx.exposeFunction('__gh', (url, method, body) => answer(url, method, body));
  await ctx.addInitScript(() => {
    const real = window.fetch;
    window.fetch = (url, opts) => {
      url = String(url);
      if (url.indexOf('api.github.com') === -1) return real(url, opts);
      return window.__gh(url, (opts && opts.method) || 'GET', (opts && opts.body) || null)
        .then(r => r.down ? Promise.reject(new TypeError('Failed to fetch')) : new Response(r.body, { status: r.status }));
    };
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', e => errs.push(author + ': ' + e.message));
  await page.goto(APP);
  await page.evaluate(([author, before]) => {
    localStorage.clear();
    localStorage.setItem('baby-tracker-sync', JSON.stringify({ repo: 'us/log', token: 'x', sha: null }));
    if (author) localStorage.setItem('baby-tracker-author', author);
    Object.keys(before || {}).forEach(k => localStorage.setItem(k, before[k]));
  }, [author, before || null]);
  await page.goto(APP);
  await settled(page);
  return page;
}

const settled = p => p.waitForFunction(() => {
  const s = document.getElementById('syncStatus').textContent;
  return !/Syncing/.test(s) && /synced|Synced|took|couldn|Couldn/i.test(s);
}, null, { timeout: 20000 }).catch(() => {});
async function sync(p) {
  await p.evaluate(() => document.getElementById('syncNow').click());
  await p.waitForTimeout(150);
  await settled(p);
  await p.waitForTimeout(150);
}
const goals = p => p.evaluate(() => JSON.parse(localStorage.getItem('baby-tracker-goals') || 'null'));
const titles = list => (list || []).map(g => typeof g === 'string' ? g : g.title);
const items = async p => titles(((await goals(p)) || {}).items);
async function openRoutine(p) {
  await p.evaluate(() => document.getElementById('routineOpen').click());
  await p.waitForTimeout(250);
}
const shown = p => p.evaluate(() => ({
  goals: Array.from(document.querySelectorAll('#goalList .goal-text')).map(x => x.textContent),
  buttons: document.querySelectorAll('#goalList .goal-btn').length,
  add: !document.getElementById('goalAddRow').hidden,
  suggest: !document.getElementById('goalSuggest').hidden,
  owner: document.getElementById('goalOwner').textContent,
  claim: document.getElementById('goalClaim').textContent
}));

(async () => {
  const b = await h.launch();

  // ---------- the owner sets them ----------
  const a = await phone(b, 'Женя');
  await openRoutine(a);
  let s = await shown(a);
  ok('to start with, either phone may change them', /Either phone/.test(s.owner) && /set from this phone/.test(s.claim), s);
  await a.click('#goalSuggest .goal-chip[data-goal="Self-settling"]');
  await a.click('#goalSuggest .goal-chip[data-goal="Longer night stretch"]');
  await a.click('#goalClaim'); await a.waitForTimeout(150);
  let g = await goals(a);
  ok('📌 makes this phone the owner, signed with its name', g.owner === 'Женя' && g.by === 'Женя' &&
    titles(g.items).join() === 'Self-settling,Longer night stretch', g);
  s = await shown(a);
  ok('and says so, with a way to let go', /Set from this phone, as Женя/.test(s.owner) && /either phone/.test(s.claim) &&
    s.buttons === 12 && s.add, s);
  await sync(a);
  const up = remote();
  ok('the goals go up as their own record', up && up.goals && up.goals.owner === 'Женя' &&
    up.goals.items.length === 2, up && up.goals);
  ok('with a read-only copy where 138 looks', up.meta.routine.goals && up.meta.routine.goals.join() === 'Self-settling,Longer night stretch',
    up.meta.routine);

  // ---------- the other phone ----------
  const w = await phone(b, 'Аня');
  ok('the other phone has them', (await items(w)).join() === 'Self-settling,Longer night stretch', await goals(w));
  await openRoutine(w);
  s = await shown(w);
  ok('locked there: no buttons, nothing to add', s.goals.length === 2 && s.buttons === 0 && !s.add && !s.suggest, s);
  ok('and it says who sets them', /Set by Женя/.test(s.owner) && /Take over/.test(s.claim), s);

  // ---------- the overwrite this is for ----------
  // Her phone offline, still holding the old goals; his phone changes them;
  // she changes the routine, which used to send her whole copy of everything.
  gh.down = true;
  await w.evaluate(() => document.getElementById('routineEnabled').click());
  await w.waitForTimeout(200);
  gh.down = false;
  await a.click('.goal-btn[data-act="up"][data-index="1"]'); await a.waitForTimeout(100);
  await a.click('#goalSuggest .goal-chip[data-goal="Consistent bedtime"]'); await a.waitForTimeout(100);
  await sync(a);
  const his = (await items(a)).join();
  ok('his new order and goal are up there', titles(remote().goals.items).join() === his && his === 'Longer night stretch,Self-settling,Consistent bedtime', remote().goals);
  await w.waitForTimeout(1100);
  await sync(w);
  ok('her routine change went up', remote().meta.routine.on === true, remote().meta.routine);
  ok('and did not take his goals with it', titles(remote().goals.items).join() === his, remote().goals);
  ok('her phone now has his', (await items(w)).join() === his, await goals(w));
  await sync(a);
  ok('and his phone kept them', (await items(a)).join() === his, await goals(a));
  ok('while taking her routine', await a.evaluate(() => JSON.parse(localStorage.getItem('baby-tracker-routine')).on) === true);

  // ---------- nothing but the owner's version wins ----------
  const doc = remote();
  doc.goals = { items: ['Something else'], owner: 'Женя', by: 'Аня', updatedAt: new Date(Date.now() + 3600e3).toISOString() };
  store(JSON.stringify(doc));
  await sync(a);
  await sync(w);
  ok('a newer version not made by the owner is ignored on both phones',
    (await items(a)).join() === his && (await items(w)).join() === his, [await items(a), await items(w)]);
  // An older copy carrying the owner's name loses on time as well.
  const doc2 = remote();
  doc2.goals = { items: ['Old'], owner: 'Женя', by: 'Женя', updatedAt: '2026-01-01T00:00:00.000Z' };
  store(JSON.stringify(doc2));
  await sync(w);
  ok('and an older one loses on time', (await items(w)).join() === his, await items(w));
  await sync(a);
  ok('the owner\'s phone puts its own back up', titles(remote().goals.items).join() === his, remote().goals);

  // ---------- taking over ----------
  await w.evaluate(() => { document.getElementById('routineBack').click(); });
  await openRoutine(w);
  await w.click('#goalClaim'); await w.waitForTimeout(150);
  s = await shown(w);
  ok('taking over asks for a second tap', /Tap again/.test(s.claim) && (await goals(w)).owner === 'Женя', s);
  await w.click('#goalClaim'); await w.waitForTimeout(150);
  g = await goals(w);
  ok('and then her phone sets them', g.owner === 'Аня' && g.by === 'Аня' && titles(g.items).join() === his, g);
  await sync(w);
  await sync(a);
  await a.evaluate(() => document.getElementById('routineBack').click());
  await openRoutine(a);
  s = await shown(a);
  ok('his phone hears it and is locked in turn', /Set by Аня/.test(s.owner) && s.buttons === 0, s);

  // ---------- a phone with no name ----------
  const n = await phone(b, '');
  await openRoutine(n);
  await n.click('#goalClaim'); await n.waitForTimeout(250);
  ok('taking over needs a name under This phone first', (await goals(n)).owner === 'Аня' &&
    await n.evaluate(() => /This phone/.test(document.body.textContent)), await goals(n));
  await n.context().close();

  // ---------- coming from 138 ----------
  const old = await phone(b, 'Женя', {
    'baby-tracker-routine': JSON.stringify({ on: false, slots: [{ time: '19:00', kind: 'sleep', until: '23:00' }], goals: ['Self-settling', 'Fewer night feeds'] })
  });
  // Moved out of the routine on load, stamped as old as possible: the record
  // already up there (hers) is newer and wins.
  ok('goals kept in a 138 routine lose to the owner\'s record', (await items(old)).join() === his, await goals(old));
  await old.context().close();

  gh.file = null; gh.sha = null;
  store(JSON.stringify({ app: 'baby-tracker', version: 4, meta: { updatedAt: '2026-11-01T00:00:00.000Z',
    routine: { on: false, slots: [{ time: '19:00', kind: 'sleep' }], goals: ['Self-settling', 'Fewer night feeds'] } }, events: [] }));
  const fresh = await phone(b, 'Аня');
  ok('a blank phone takes them from a log written by 138', (await items(fresh)).join() === 'Self-settling,Fewer night feeds', await goals(fresh));
  await fresh.context().close();

  await a.context().close();
  await w.context().close();
  ok('no page errors', errs.length === 0, errs);
  await b.close();
  t.done();
})().catch(e => { console.error(e); process.exit(1); });
