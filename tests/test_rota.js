"use strict";

// The carer rota's working day: from and until, in half-hour steps, with
// the hours worked out between them and added to the week. Kept as a start
// and a length, so a shift saved before this reads the same.

const h = require('./helpers');
const t = h.tally();
const ok = t.ok;

(async () => {
  const b = await h.launch();
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, timezoneId: 'Europe/London' });
  // Monday 9 November 2026, 15:00 in London.
  await ctx.clock.setFixedTime(new Date('2026-11-09T15:00:00Z'));
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    const at = '2026-11-01T10:00:00.000Z';
    localStorage.setItem('baby-tracker-rota-shifts', JSON.stringify([
      { id: '2026-11-10', date: '2026-11-10', hours: 4, start: '14:00', updatedAt: at },
      { id: '2026-11-14', date: '2026-11-14', off: true, updatedAt: at }
    ]));
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push('ERR ' + e.message));
  await page.goto(h.APP);
  await page.waitForTimeout(300);
  await page.click('#rotaOpen');
  await page.waitForTimeout(200);

  const row = (n) => page.locator('#rotaWeekDays .rota-row').nth(n);
  const read = (n) => row(n).evaluate(r => ({
    state: r.querySelector('.rota-day-state').textContent,
    from: r.querySelector('.rota-start-select').value,
    until: r.querySelector('.rota-end-select').selectedOptions[0].textContent,
    shown: !r.querySelector('.rota-detail').hidden
  }));
  const kept = (date) => page.evaluate(d => JSON.parse(localStorage.getItem('baby-tracker-rota-shifts'))
    .filter(s => s.date === d)[0], date);
  const total = () => page.textContent('#rotaWeekTotal');

  let r = await read(1);
  ok('a shift saved as a start and hours reads as from and until', r.shown && r.from === '14:00' && r.until === '18:00', r);
  ok('with its hours beside the day', r.state === '4h', r);
  ok('and in the week\'s total', (await total()) === '4 hours', await total());

  // Monday: tap twice to working, then 14:00 until 18:00.
  await row(0).locator('.rota-toggle').click();
  await row(0).locator('.rota-toggle').click();
  r = await read(0);
  ok('a new working day starts at 12:00 until 18:00', r.from === '12:00' && r.until === '18:00' && r.state === '6h', r);
  await row(0).locator('.rota-start-select').selectOption('19:00');
  r = await read(0);
  ok('moving the start past the old end keeps the length', r.until === '01:00 +1' && r.state === '6h', r);
  await row(0).locator('.rota-start-select').selectOption('14:00');
  r = await read(0);
  ok('moving it back keeps the end, and the hours follow', r.until === '01:00 +1' && r.state === '11h', r);
  await row(0).locator('.rota-end-select').selectOption({ label: '18:00' });
  r = await read(0);
  ok('14:00 until 18:00 is 4 hours', r.state === '4h', r);
  let s = await kept('2026-11-09');
  ok('kept as a start and its hours', s.start === '14:00' && s.hours === 4, s);
  ok('the week adds both up', (await total()) === '8 hours', await total());

  // A start moved earlier keeps the end where it was.
  await row(0).locator('.rota-start-select').selectOption('13:30');
  r = await read(0);
  ok('an earlier start keeps the end', r.until === '18:00' && r.state === '4h 30m', r);
  ok('half hours count in the total', (await total()) === '8h 30m', await total());

  // The banner: today's shift is on at 15:00, until 18:00.
  await page.click('#rotaBack');
  await page.waitForTimeout(200);
  ok('the main screen says until when', await page.isVisible('#rotaBanner') &&
    /until 18:00/.test(await page.textContent('#rotaBannerText')), await page.textContent('#rotaBannerText'));

  // Late into the night: an end past midnight is marked.
  await page.click('#rotaOpen');
  await page.waitForTimeout(200);
  await row(2).locator('.rota-toggle').click();
  await row(2).locator('.rota-toggle').click();
  await row(2).locator('.rota-start-select').selectOption('20:00');
  await row(2).locator('.rota-end-select').selectOption({ label: '01:00 +1' });
  r = await read(2);
  ok('an end past midnight reads +1 and counts on', r.state === '5h', r);
  s = await kept('2026-11-11');
  ok('and is kept as five hours from 20:00', s.start === '20:00' && s.hours === 5, s);

  r = await read(5);
  ok('a day off stays off', r.state === 'Off' && !r.shown, r);

  ok('no page errors', errs.length === 0, errs);
  await b.close();
  t.done();
})().catch(e => { console.error(e); process.exit(1); });
