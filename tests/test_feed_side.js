"use strict";

// Which breast: the Feed button split into L | R (breastfed) or L | 🍼 | R
// (mixed), one tap a whole feed of ten minutes, the side on the card, the
// "last" badge, and the optional `side` field everywhere a feed goes.

const h = require('./helpers');
const t = h.tally();
const ok = t.ok;
const APP = h.APP;
const TZ = process.env.TZ || 'UTC';

(async () => {
  const b = await h.launch();
  const errs = [];
  const at = (d, hh, mm) => +new Date(2026, 9, d, hh, mm || 0);
  const iso = ms => new Date(ms).toISOString();

  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, timezoneId: TZ, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message));
  page.setDefaultTimeout(8000);
  await page.clock.install({ time: new Date(at(12, 10)) });
  await page.goto(APP); await page.waitForTimeout(250);

  const seed = async (feeding, list) => {
    await page.evaluate(([feeding, list]) => {
      localStorage.clear();
      if (feeding) localStorage.setItem('baby-tracker-feeding', feeding);
      localStorage.setItem('baby-tracker-events', JSON.stringify(list));
    }, [feeding, list]);
    await page.goto(APP); await page.waitForTimeout(400);
  };
  const all = () => page.evaluate(() => JSON.parse(localStorage.getItem('baby-tracker-events')));
  const newest = async () => (await all()).sort((a, b) => a.time < b.time ? 1 : -1)[0];
  const buttons = () => page.evaluate(() => ({
    single: !document.getElementById('btnFeed').hidden,
    split: !document.getElementById('feedSplit').hidden,
    L: !document.getElementById('btnFeedL').hidden,
    B: !document.getElementById('btnFeedBottle').hidden,
    R: !document.getElementById('btnFeedR').hidden,
    lastL: !document.getElementById('feedBadgeL').hidden,
    lastR: !document.getElementById('feedBadgeR').hidden
  }));
  const card = () => page.evaluate(() => ({
    side: document.getElementById('sideBlock').hidden ? null
      : Array.from(document.querySelectorAll('#sideChips .side-chip')).map(c => c.textContent + (c.classList.contains('selected') ? '*' : '')),
    fed: Array.from(document.querySelectorAll('#feedChips .feed-chip')).map(c => c.textContent + (c.classList.contains('selected') ? '*' : '')),
    source: Array.from(document.querySelectorAll('#sourceChips .source-chip')).map(c => c.textContent + (c.classList.contains('selected') ? '*' : ''))
  }));

  // ---- not set up as breastfed: one button, as ever ----
  await seed('', [{ id: 'old', type: 'feed', time: iso(at(12, 6)), updatedAt: iso(at(12, 6)), fedMin: 20 }]);
  let bt = await buttons();
  ok('with no feeding set, the one Feed button', bt.single && !bt.split, bt);
  await page.click('#btnFeed'); await page.waitForTimeout(300);
  let e = await newest();
  ok('and a tap is a feed with no side and no length', !e.side && !e.fedMin, e);
  ok('its card asks no side', (await card()).side === null);
  await page.click('#nextUpClose');

  // ---- breastfed: L | R ----
  await seed('breast', [{ id: 'old', type: 'feed', time: iso(at(12, 6)), updatedAt: iso(at(12, 6)), fedMin: 20, fedWith: 'breast' }]);
  bt = await buttons();
  ok('breastfed splits the button into L | R', !bt.single && bt.split && bt.L && bt.R && !bt.B, bt);
  ok('no badge before any side is logged', !bt.lastL && !bt.lastR, bt);

  await page.click('#btnFeedL'); await page.waitForTimeout(300);
  e = await newest();
  ok('one tap on L is a whole feed: breast, left, 10 minutes',
    e.type === 'feed' && e.fedWith === 'breast' && e.side === 'L' && e.fedMin === 10, e);
  ok('the part says it was logged', await page.evaluate(() => /^✓ \d\d:\d\d$/.test(document.getElementById('feedNoteL').textContent)));
  let c = await card();
  ok('the card shows the side chosen', JSON.stringify(c.side) === JSON.stringify(['L · Left*', 'R · Right', 'L+R · Both']), c.side);
  ok('and 10 minutes selected, with 5 on offer', c.fed[0] === '5m' && c.fed[1] === '10m*', c.fed);
  bt = await buttons();
  ok('L now carries the last badge', bt.lastL && !bt.lastR, bt);

  await page.click('#sideChips .side-chip[data-side="R"]'); await page.waitForTimeout(200);
  e = await newest();
  ok('the card changes the side', e.side === 'R', e);
  ok('and the badge follows', (await buttons()).lastR);
  await page.click('#sideChips .side-chip[data-side="LR"]'); await page.waitForTimeout(200);
  ok('both sides in one feed', (await newest()).side === 'LR');
  bt = await buttons();
  ok('a feed on both ended on the right', bt.lastR && !bt.lastL, bt);
  await page.click('#feedChips .feed-chip[data-fed="15"]'); await page.waitForTimeout(200);
  ok('the length is changed with one tap', (await newest()).fedMin === 15);
  await page.click('#sideChips .side-chip[data-side="LR"]'); await page.waitForTimeout(200);
  e = await newest();
  ok('tapping the chosen side again clears it', !('side' in e), e);
  await page.click('#sideChips .side-chip[data-side="LR"]'); await page.waitForTimeout(200);

  // Turning it into a bottle drops the side.
  await page.click('#sourceChips .source-chip[data-source="formula"]'); await page.waitForTimeout(200);
  e = await newest();
  ok('a bottle has no side', e.fedWith === 'formula' && !('side' in e), e);
  ok('and the card stops asking', (await card()).side === null);
  await page.click('#sourceChips .source-chip[data-source="breast"]'); await page.waitForTimeout(200);
  await page.click('#sideChips .side-chip[data-side="LR"]'); await page.waitForTimeout(200);
  await page.click('#nextUpClose');

  // The history says which side; an old feed reads as it always did.
  await page.click('#logToggle'); await page.waitForTimeout(300);
  const details = await page.evaluate(() => Array.from(document.querySelectorAll('.log-item')).map(r =>
    ({ id: r.getAttribute('data-id'), detail: Array.from(r.querySelectorAll('.l-detail')).map(d => d.textContent).join('|') })));
  const mine = details.find(d => d.id !== 'old');
  ok('the history names the side', mine.detail === '🤱 Breast · L+R', details);
  ok('an old feed reads as before', details.find(d => d.id === 'old').detail === '🤱 Breast', details);

  // The edit form.
  await page.click('.log-item[data-id="' + mine.id + '"] .l-type'); await page.waitForTimeout(300);
  ok('the edit form shows the side', await page.evaluate(() =>
    !document.getElementById('manualSideField').hidden && document.getElementById('manualSide').value === 'LR'));
  await page.selectOption('#manualSide', 'L');
  await page.click('#manualSubmit'); await page.waitForTimeout(300);
  ok('and saves a change of it', (await newest()).side === 'L');

  // Handover.
  await page.click('#handoverOpen'); await page.waitForTimeout(400);
  const ho = await page.evaluate(() => document.getElementById('screenHandover').textContent);
  ok('the handover names the side', /Last [^.]*left side/.test(ho) && !/breast, left side/.test(ho), ho.slice(0, 400));
  await page.click('#handoverBack'); await page.waitForTimeout(200);

  // Reload, and the backup.
  await page.goto(APP); await page.waitForTimeout(400);
  ok('the side survives a reload', (await buttons()).lastL);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => document.getElementById('exportJson').click())
  ]);
  const backup = JSON.parse(require('fs').readFileSync(await download.path(), 'utf8'));
  ok('the backup carries it', backup.events.some(x => x.side === 'L'), backup.events);

  // From another phone: kept on a feed, dropped anywhere else or if junk.
  await page.evaluate(() => {
    const now = new Date().toISOString();
    const payload = { events: [
      { id: 'f1', type: 'feed', time: '2026-10-12T07:00:00', updatedAt: now, fedWith: 'breast', side: 'R' },
      { id: 'f2', type: 'feed', time: '2026-10-12T07:30:00', updatedAt: now, side: 'X' },
      { id: 'n1', type: 'diaper', time: '2026-10-12T07:40:00', updatedAt: now, side: 'L' }
    ] };
    const file = new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById('importFile');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(700);
  const byId = id => all().then(list => list.find(x => x.id === id));
  ok('a side from elsewhere arrives', (await byId('f1')).side === 'R');
  ok('a junk side is dropped', !('side' in (await byId('f2'))));
  ok('a nappy never carries one', !('side' in (await byId('n1'))));

  // ---- mixed: L | 🍼 | R ----
  await seed('mixed', []);
  bt = await buttons();
  ok('mixed gives three parts', bt.split && bt.L && bt.B && bt.R, bt);
  await page.click('#btnFeedBottle'); await page.waitForTimeout(300);
  e = await newest();
  ok('the bottle is a formula feed with no side or length', e.fedWith === 'formula' && !e.side && !e.fedMin, e);
  c = await card();
  ok('and its card asks how much, not which side', c.side === null && /ml/.test(c.fed[0]), c);
  await page.click('#nextUpClose');
  await page.click('#btnFeedR'); await page.waitForTimeout(300);
  e = await newest();
  ok('R is a breast feed on the right', e.fedWith === 'breast' && e.side === 'R' && e.fedMin === 10, e);

  ok('no page errors', errs.length === 0, errs);
  await ctx.close();
  await b.close();
  t.done();
})();
