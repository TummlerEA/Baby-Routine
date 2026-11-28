"use strict";

// Goals as cards (141): a goal carries what success looks like, its dates, a
// status and the steps of a plan. Steps with a time show on the main screen
// as Tonight's plan and can nudge the phone; a weekly progress file in the
// synced repository is read and shown, never written. Goals kept as bare
// lines — by 140 and before — read as cards with a title, and a bare line
// coming back from such a phone does not cost the card its plan.

const h = require('./helpers');
const t = h.tally();
const ok = t.ok;
const APP = h.APP;
const TZ = process.env.TZ || 'UTC';

const LOG = 'baby-tracker-log.json';
const PROGRESS = 'goals-progress.json';
const gh = { file: null, sha: null, n: 0, progress: null };

function store(text) {
  gh.n++;
  gh.file = text;
  gh.sha = 'sha' + gh.n;
}

function answer(url, method, body) {
  const reply = (status, obj) => ({ status, body: JSON.stringify(obj) });
  const blob = /\/git\/blobs\/([^/?]+)/.exec(url);
  if (blob) {
    if (blob[1] !== gh.sha) return reply(404, {});
    return reply(200, { sha: gh.sha, encoding: 'base64', content: Buffer.from(gh.file).toString('base64') });
  }
  const m = /\/contents\/([^?]*)/.exec(url);
  const path = m ? decodeURIComponent(m[1]) : '';
  if (path === '' && method === 'GET') {
    const list = gh.file === null ? [] : [{ type: 'file', name: LOG, sha: gh.sha }];
    if (gh.progress) list.push({ type: 'file', name: PROGRESS, sha: 'p' + gh.progress.length });
    return reply(200, list);
  }
  if (path === PROGRESS && method === 'GET') {
    if (!gh.progress) return reply(404, {});
    return reply(200, { name: PROGRESS, sha: 'p' + gh.progress.length, encoding: 'base64',
      content: Buffer.from(gh.progress).toString('base64') });
  }
  if (path === PROGRESS) return reply(403, {});   // the app must never write it
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
const card = i => '#goalList .goal-item[data-index="' + i + '"]';

(async () => {
  const b = await h.launch();

  // ---------- one phone, on a clock that says 20:03 on 28 November ----------
  const ctx = await b.newContext({ viewport: { width: 390, height: 950 }, timezoneId: TZ });
  // Node runs in the same zone as the page, so this is 20:03 there.
  await ctx.clock.install({ time: new Date(2026, 10, 28, 20, 3) });
  await ctx.addInitScript(() => {
    window.__sent = [];
    window.Notification = function () {};
    window.Notification.permission = 'granted';
    window.Notification.requestPermission = () => Promise.resolve('granted');
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      get: () => ({ ready: Promise.resolve({
        showNotification: (title, opts) => { window.__sent.push({ title, body: opts.body }); }
      }), register: () => Promise.resolve({}) })
    });
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(APP);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('baby-tracker-author', 'Evgeny');
    localStorage.setItem('baby-tracker-goals', JSON.stringify({ items: ['Long night', 'Self-settling'],
      owner: '', by: '', updatedAt: '2026-11-20T10:00:00.000Z' }));
  });
  await page.goto(APP);
  await page.waitForTimeout(300);
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('baby-tracker-goals')).items);
  const openRoutine = async () => {
    await page.evaluate(() => document.getElementById('routineOpen').click());
    await page.waitForTimeout(250);
  };
  const back = async () => {
    await page.evaluate(() => document.getElementById('routineBack').click());
    await page.waitForTimeout(250);
  };

  await openRoutine();
  let shown = await page.$$eval('#goalList .goal-item', els => els.map(e => ({
    title: e.querySelector('.goal-text').textContent,
    status: e.querySelector('.goal-status').textContent,
    open: !!e.querySelector('.plan-add')
  })));
  ok('goals kept as bare lines show as cards, active and open', shown.length === 2 &&
    shown[0].title === 'Long night' && shown[0].status === 'Active' && shown[0].open, shown);
  ok('the nudge is off to start with', await page.evaluate(() => !document.getElementById('planNudgeOn').checked));

  // ---------- the plan ----------
  async function addStep(text, at) {
    await page.fill(card(0) + ' .plan-add-text', text);
    if (at) await page.fill(card(0) + ' .plan-add-at', at);
    await page.click(card(0) + ' [data-act="step-add"]');
    await page.waitForTimeout(120);
  }
  await addStep('Bottle 150 ml', '19:50');
  await addStep('Bedtime', '20:15');
  await addStep('Dream feed', '22:45');
  await addStep('Check on her', '02:00');
  await page.fill(card(0) + ' .plan-add-text', 'No feed before 3 h');
  await page.press(card(0) + ' .plan-add-text', 'Enter');
  await page.waitForTimeout(120);
  let g = await stored();
  ok('steps go in, with and without a time', g[0].plan.map(s => (s.at || '-') + ' ' + s.text).join('|') ===
    '19:50 Bottle 150 ml|20:15 Bedtime|22:45 Dream feed|02:00 Check on her|- No feed before 3 h', g[0].plan);
  ok('every goal and step is given an id, and the goal a stamp and a name', g[0].id && g[1].id &&
    g[0].plan.every(s => s.id) && g[0].by === 'Evgeny' && g[0].updatedAt, g[0]);

  await page.click(card(0) + ' [data-act="step-edit"][data-step="4"]');
  await page.waitForTimeout(120);
  await page.fill(card(0) + ' .plan-edit-text', 'Wait 3 h before a feed');
  await page.click(card(0) + ' [data-act="step-up"]');
  await page.waitForTimeout(120);
  await page.click(card(0) + ' [data-act="step-save"]');
  await page.waitForTimeout(120);
  g = await stored();
  ok('a step is moved and changed', g[0].plan[3].text === 'Wait 3 h before a feed' && !g[0].plan[3].at &&
    g[0].plan[4].text === 'Check on her', g[0].plan);
  await page.click(card(0) + ' [data-act="step-edit"][data-step="3"]');
  await page.waitForTimeout(120);
  await page.click(card(0) + ' [data-act="step-del"]');
  await page.waitForTimeout(120);
  g = await stored();
  ok('and one is removed', g[0].plan.length === 4 && g[0].plan[3].text === 'Check on her', g[0].plan);

  // ---------- the details ----------
  await page.click(card(0) + ' [data-act="edit"]');
  await page.waitForTimeout(120);
  await page.fill(card(0) + ' [data-field="target"]', 'One stretch of 4 hours');
  await page.fill(card(0) + ' [data-field="start"]', '2026-11-28');
  await page.fill(card(0) + ' [data-field="review"]', '2026-12-12');
  await page.click(card(0) + ' [data-act="edit-save"]');
  await page.waitForTimeout(150);
  g = await stored();
  ok('target and dates are kept', g[0].target === 'One stretch of 4 hours' && g[0].start === '2026-11-28' &&
    g[0].review === '2026-12-12', g[0]);
  ok('and shown on the card', await page.$eval(card(0) + ' .goal-dates', e => e.textContent) ===
    'From 28 Nov · review 12 Dec — 14 days to go');

  // ---------- tonight's plan ----------
  await back();
  const tonight = () => page.evaluate(() => ({
    hidden: document.getElementById('tonightPlan').hidden,
    sub: document.getElementById('tonightPlanGoal').textContent,
    rows: Array.from(document.querySelectorAll('#tonightPlanList li')).map(li => ({
      at: li.querySelector('.tp-time').textContent, cls: li.className,
      in: (li.querySelector('.tp-in') || {}).textContent || '' }))
  }));
  let tp = await tonight();
  ok('tonight\'s plan shows the timed steps, two in the morning last', !tp.hidden &&
    tp.rows.map(r => r.at).join() === '19:50,20:15,22:45,02:00', tp);
  ok('what has gone by is struck through and the next one is marked', tp.rows[0].cls === 'tp-past' &&
    tp.rows[1].cls === 'tp-next' && /^in 1[12]m$/.test(tp.rows[1].in), tp.rows);
  ok('with the goal and the day of the plan', tp.sub === 'Long night · day 1 of 14', tp.sub);

  // ---------- the nudge ----------
  await openRoutine();
  await page.click('#planNudgeOn');
  await page.waitForTimeout(150);
  await back();
  await page.clock.runFor(14 * 60 * 1000);
  await page.waitForTimeout(200);
  let sent = await page.evaluate(() => window.__sent);
  ok('turned on, it nudges at the next step and not for the one gone by', sent.length === 1 &&
    sent[0].title === '🎯 20:15 — Long night' && sent[0].body === 'Bedtime', sent);
  await page.clock.runFor(3 * 60 * 1000);
  sent = await page.evaluate(() => window.__sent);
  ok('and only once', sent.length === 1, sent);

  // ---------- paused ----------
  await openRoutine();
  await page.click(card(0) + ' [data-act="pause"]');
  await page.waitForTimeout(150);
  g = await stored();
  ok('⏸ pauses it and folds the plan away', g[0].status === 'paused' &&
    await page.isVisible(card(0) + ' .goal-toggle'), g[0].status);
  await back();
  ok('a paused goal leaves tonight\'s plan', (await tonight()).hidden);
  await openRoutine();
  await page.click(card(0) + ' [data-act="resume"]');
  await page.waitForTimeout(150);
  ok('▶ brings it back', (await stored())[0].status === 'active');
  await back();

  // ---------- the summary for an AI ----------
  await page.evaluate(() => document.getElementById('btnFeed').click()); await page.waitForTimeout(200);
  await page.evaluate(() => document.getElementById('aiOpen').click()); await page.waitForTimeout(300);
  const prompt = await page.evaluate(() => document.getElementById('aiPreview').value);
  ok('the AI summary carries the target and the plan',
    prompt.indexOf('1. Long night (aiming for: One stretch of 4 hours; since 2026-11-28, review 2026-12-12)') !== -1 &&
    prompt.indexOf('Plan for Long night: 19:50 Bottle 150 ml; 20:15 Bedtime; 22:45 Dream feed; 02:00 Check on her') !== -1,
    prompt.slice(0, 600));
  await ctx.close();

  // ---------- two things that come through sync ----------
  const sctx = await b.newContext({ viewport: { width: 390, height: 950 }, timezoneId: TZ });
  await sctx.exposeFunction('__gh', (url, method, body) => answer(url, method, body));
  await sctx.addInitScript(() => {
    const real = window.fetch;
    window.fetch = (url, opts) => {
      url = String(url);
      if (url.indexOf('api.github.com') === -1) return real(url, opts);
      return window.__gh(url, (opts && opts.method) || 'GET', (opts && opts.body) || null)
        .then(r => new Response(r.body, { status: r.status }));
    };
  });
  const p = await sctx.newPage();
  p.setDefaultTimeout(15000);
  p.on('pageerror', e => errs.push('sync: ' + e.message));
  const settled = () => p.waitForFunction(() => {
    const s = document.getElementById('syncStatus').textContent;
    return !/Syncing/.test(s) && /synced|Synced|took|couldn|Couldn/i.test(s);
  }, null, { timeout: 20000 }).catch(() => {});
  const sync = async () => {
    await p.evaluate(() => document.getElementById('syncNow').click());
    await p.waitForTimeout(150);
    await settled();
    await p.waitForTimeout(200);
  };

  const mine = { items: [{ id: 'g1', title: 'Long night', status: 'active', start: '2026-11-28',
    plan: [{ id: 's1', text: 'Dream feed', at: '22:45' }, { id: 's2', text: 'Wait 3 h' }],
    updatedAt: '2026-11-28T10:00:00.000Z', by: 'Evgeny' }],
    owner: 'Evgeny', by: 'Evgeny', updatedAt: '2026-11-28T10:00:00.000Z' };
  store(JSON.stringify({ app: 'baby-tracker', version: 4, meta: { updatedAt: '2026-11-28T09:00:00.000Z',
    routine: { on: false, slots: [{ time: '19:00', kind: 'sleep' }] } }, events: [],
    goals: { items: ['Long night', 'Fewer night feeds'], owner: 'Evgeny', by: 'Evgeny',
      updatedAt: '2026-11-28T11:00:00.000Z' } }));
  gh.progress = JSON.stringify({ updatedAt: '2026-11-28T12:00:00Z', goals: { g1: {
    baseline: { period: '21–27.11', first_stretch_min: 170, longest_min: 180, nights_4h: '2/7', night_feeds: 3.4 },
    latest: { period: '28.11–4.12', first_stretch_min: null, longest_min: null, nights_4h: null, night_feeds: null },
    note: 'Baseline <b>recorded</b>' } } });
  await p.goto(APP);
  await p.evaluate(m => {
    localStorage.clear();
    localStorage.setItem('baby-tracker-author', 'Evgeny');
    localStorage.setItem('baby-tracker-goals', JSON.stringify(m));
    localStorage.setItem('baby-tracker-sync', JSON.stringify({ repo: 'us/log', token: 'x', sha: null }));
  }, mine);
  await p.goto(APP);
  await settled();
  await sync();
  const items = await p.evaluate(() => JSON.parse(localStorage.getItem('baby-tracker-goals')).items);
  ok('a newer list of bare lines from an older phone is taken, keeping the plan behind a title it knows',
    items.map(g => g.title).join() === 'Long night,Fewer night feeds' && items[0].plan.length === 2 &&
    items[0].id === 'g1' && items[1].plan.length === 0, items);

  await p.evaluate(() => document.getElementById('routineOpen').click());
  await p.waitForTimeout(250);
  const prog = await p.evaluate(() => {
    const box = document.querySelector('#goalList .goal-item[data-index="0"] .goal-progress');
    return box ? { cells: Array.from(box.querySelectorAll('td, th')).map(c => c.textContent),
      note: box.querySelector('.goal-progress-note').textContent,
      html: box.innerHTML } : null;
  });
  ok('the weekly progress file shows under the goal it names', prog &&
    prog.cells.indexOf('2 h 50') !== -1 && prog.cells.indexOf('3 h 00') !== -1 &&
    prog.cells.indexOf('2 of 7') !== -1 && prog.cells.indexOf('3.4') !== -1 &&
    prog.cells.indexOf('21–27.11') !== -1, prog);
  ok('as text, never as markup', prog && prog.note === 'Baseline <b>recorded</b>' && prog.html.indexOf('<b>') === -1, prog);
  ok('nothing else has a progress block', await p.evaluate(() =>
    !document.querySelector('#goalList .goal-item[data-index="1"] .goal-progress')));
  const doc = JSON.parse(gh.file);
  ok('the progress copy stays on the phone', JSON.stringify(doc).indexOf('first_stretch') === -1);

  gh.progress = null;
  await p.evaluate(() => document.getElementById('routineBack').click());
  await sync();
  await p.evaluate(() => document.getElementById('routineOpen').click());
  await p.waitForTimeout(250);
  ok('once the file is gone, so is the block', await p.evaluate(() =>
    !document.querySelector('.goal-progress') && !localStorage.getItem('baby-tracker-goals-progress')));
  await sctx.close();

  ok('no page errors', errs.length === 0, errs);
  await b.close();
  t.done();
})().catch(e => { console.error(e); process.exit(1); });
