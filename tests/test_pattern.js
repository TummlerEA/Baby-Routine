"use strict";

// The sleep pattern under 📊: a row per day since the first sleep, midnight
// to midnight, folded until opened. A settle of about half an hour or more
// is drawn as that long crying just before she went down, never reaching
// back into the sleep before it; a quicker one is not drawn at all.

const h = require('./helpers');
const t = h.tally();
const ok = t.ok;

const PLOT_W = 320 - 38 - 4;

(async () => {
  const b = await h.launch();
  const errs = [];

  async function open(events, extra) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, timezoneId: 'Europe/London' });
    await ctx.clock.setFixedTime(new Date('2026-10-27T12:00:00Z'));
    await ctx.addInitScript(([events, extra]) => {
      if (localStorage.getItem('test-seeded')) return;
      localStorage.setItem('test-seeded', '1');
      localStorage.setItem('baby-tracker-events', JSON.stringify(events.map((e, i) => Object.assign({
        id: 'e' + i, updatedAt: '2026-10-01T00:00:00.000Z' }, e, { time: new Date(e.time).toISOString() }))));
      Object.keys(extra || {}).forEach(k => localStorage.setItem(k, extra[k]));
    }, [events, extra || {}]);
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push('ERR ' + e.message));
    await page.goto(h.APP);
    await page.waitForTimeout(300);
    await page.click('#statsOpen');
    await page.waitForTimeout(200);
    return { ctx, page };
  }
  const rects = (page, k) => page.$$eval('#patternSvg .pt-' + k, rs => rs.map(r => ({
    x: +r.getAttribute('x'), y: +r.getAttribute('y'), w: +r.getAttribute('width') })));

  // 24 to 27 October: the clocks go back on the 25th.
  const EV = [
    { type: 'sleep_start', time: '2026-10-24T19:00:00+01:00' },
    { type: 'sleep_end', time: '2026-10-25T06:00:00Z' },
    { type: 'sleep_start', time: '2026-10-25T09:00:00Z', settle: 4 },   // an hour to settle
    { type: 'sleep_end', time: '2026-10-25T10:30:00Z' },
    { type: 'sleep_start', time: '2026-10-25T11:00:00Z', settle: 5 },   // two hours, but awake only 30m
    { type: 'sleep_end', time: '2026-10-25T12:00:00Z' },
    { type: 'sleep_start', time: '2026-10-25T14:00:00Z', settle: 2 },   // about 15 minutes: not crying
    { type: 'sleep_end', time: '2026-10-25T15:00:00Z' },
    { type: 'sleep_start', time: '2026-10-25T19:00:00Z' },
    { type: 'sleep_end', time: '2026-10-26T06:00:00Z' },
    { type: 'feed', time: '2026-10-27T08:00:00Z' }
  ];

  let { ctx, page } = await open(EV, { 'baby-tracker-dob': '2026-10-24' });
  ok('the section is there and folded', await page.isVisible('#patternToggle') && !(await page.isVisible('#patternBody')) &&
    (await page.getAttribute('#patternToggle', 'aria-expanded')) === 'false');
  await page.click('#patternToggle');
  await page.waitForTimeout(200);
  ok('it opens', await page.isVisible('#patternSvg'));
  const none = await rects(page, 'none');
  ok('one row a day from the first sleep to today', none.length === 4, none.length);
  ok('the first row is her birth', /Birth/.test(await page.textContent('#patternSvg')));

  const cry = await rects(page, 'cry');
  ok('two hard settles drawn, the quick one not', cry.length === 2, cry);
  // 25 October is 25 hours wide in the same row width.
  const hourOn25 = PLOT_W / 25;
  ok('an hour to settle is an hour wide', cry[0] && Math.abs(cry[0].w - hourOn25) < 0.3, cry[0]);
  ok('two hours to settle stops at the sleep before it', cry[1] && Math.abs(cry[1].w - hourOn25 / 2) < 0.3, cry[1]);

  // Tap the clock-change day for its totals.
  const rowY = none[1].y + 2;
  const box = await page.locator('#patternSvg').boundingBox();
  const vb = await page.$eval('#patternSvg', s => s.viewBox.baseVal.height);
  await page.locator('#patternSvg').click({ position: { x: 150, y: rowY * box.height / vb } });
  await page.waitForTimeout(200);
  const line = await page.textContent('#patternDay');
  ok('a tapped row names its day', /25 Oct/.test(line), line);
  ok('and its totals add up to its 25 hours', /asleep 15h 30m/.test(line) && /awake 8h(?! ?\d)/.test(line) &&
    /hard settling 1h 30m/.test(line), line);

  await page.reload();
  await page.waitForTimeout(300);
  await page.click('#statsOpen');
  await page.waitForSelector('#patternSvg', { timeout: 3000 }).catch(() => null);
  ok('opened, it stays open on this phone', await page.isVisible('#patternSvg'),
    await page.evaluate(() => localStorage.getItem('baby-tracker-pattern-open')));
  await ctx.close();

  ({ ctx, page } = await open([{ type: 'feed', time: '2026-10-27T08:00:00Z' }]));
  await page.click('#patternToggle');
  await page.waitForTimeout(200);
  ok('with no sleep yet it says what it needs', /Needs a sleep/.test(await page.textContent('#patternChart')));
  await ctx.close();

  ok('no page errors', errs.length === 0, errs);
  await b.close();
  t.done();
})().catch(e => { console.error(e); process.exit(1); });
