"use strict";

// Away from home. The phone has moved to San Francisco, eight hours behind
// London; the app can be kept to London time instead, so a feed at 9pm in
// London still reads 21:00 and still falls on the day it fell on. Off, it
// follows the phone exactly as it always has. Chosen at home before leaving,
// it changes nothing until the phone's clock moves.

const h = require('./helpers');
const t = h.tally();
const ok = t.ok;

// 10:00 on 6 November in London is 02:00 that morning in San Francisco.
const NOW = new Date(Date.UTC(2026, 10, 6, 10, 0));

(async () => {
  const b = await h.launch();
  const errs = [];

  async function open(zone, clock) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, timezoneId: zone });
    await ctx.clock.setFixedTime(NOW);
    await ctx.addInitScript((clock) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      const at = (iso) => ({ type: 'feed', time: iso, updatedAt: iso });
      localStorage.setItem('baby-tracker-events', JSON.stringify([
        Object.assign(at('2026-11-05T21:00:00.000Z'), { id: 'a' }),
        Object.assign(at('2026-11-06T02:00:00.000Z'), { id: 'b' })
      ]));
      if (clock) localStorage.setItem('baby-tracker-clock', clock);
    }, clock || '');
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push('ERR ' + e.message));
    await page.goto(h.APP);
    await page.waitForTimeout(400);
    return { ctx, page };
  }

  // The day headings in the history and the times under each.
  async function history(page) {
    if (!(await page.isVisible('#logList'))) await page.click('#logToggle');
    await page.waitForTimeout(200);
    return page.$$eval('.log-day', ds => ds.map(d => ({
      day: d.querySelector('.log-day-name').textContent,
      times: [...d.querySelectorAll('.l-time')].map(x => x.textContent)
    })));
  }

  // ---- the phone's own clock, as always ----
  let { ctx, page } = await open('America/Los_Angeles');
  ok('with nothing chosen there is no clock line', !(await page.isVisible('#clockBanner')));
  let hist = await history(page);
  ok('times are the phone\'s, and so are the days: both were yesterday there',
    hist.length === 1 && hist[0].day === 'Yesterday' && hist[0].times.join() === '18:00,13:00', hist);
  await ctx.close();

  // ---- kept to London ----
  ({ ctx, page } = await open('America/Los_Angeles', 'Europe/London'));
  ok('kept to London, the main screen says so, with both clocks', await page.isVisible('#clockBanner') &&
    /London time, 10:00 · on this phone it is 02:00/.test(await page.textContent('#clockBannerText')),
    await page.textContent('#clockBannerText'));
  hist = await history(page);
  ok('times are London\'s', hist[0].times.join() === '02:00' && hist[1].times.join() === '21:00', hist);
  ok('and 02:00 in London is today', hist[0].day === 'Today', hist);
  ok('the top date is London\'s too', /6 Nov/.test(await page.textContent('#topDate')), await page.textContent('#topDate'));
  ok('the time picker for a new entry starts at London\'s now',
    await page.evaluate(() => {
      document.getElementById('manualToggle').click();
      return document.getElementById('manualDateTime').value;
    }).then(v => /^2026-11-06T10:/.test(v)));

  // An entry typed in London time lands at the London instant.
  await page.selectOption('#manualType', 'diaper');
  await page.fill('#manualDateTime', '2026-11-06T09:30');
  await page.click('#manualSubmit');
  await page.waitForTimeout(200);
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('baby-tracker-events'))
    .filter(e => e.type === 'diaper').map(e => e.time));
  ok('an entry typed as 09:30 is kept as 09:30 in London', kept.length === 1 &&
    kept[0].startsWith('2026-11-06T09:30'), kept);

  await page.click('#clockBannerBtn');
  await page.waitForTimeout(200);
  ok('the line opens the setting', await page.isVisible('#clockZone') &&
    (await page.inputValue('#clockZone')) === 'Europe/London');
  ok('settings say both zones', /Europe\/London/.test(await page.textContent('#settingsZone')) &&
    /This phone is on America\/Los_Angeles/.test(await page.textContent('#settingsZone')),
    await page.textContent('#settingsZone'));

  // Back to the phone's time.
  await Promise.all([page.waitForNavigation(), page.selectOption('#clockZone', '')]);
  await page.waitForTimeout(400);
  ok('back on the phone\'s time, nothing is kept', (await page.evaluate(() =>
    localStorage.getItem('baby-tracker-clock'))) === null);
  ok('and the line is gone', !(await page.isVisible('#clockBanner')));
  hist = await history(page);
  ok('with the history redrawn in the phone\'s time, and nothing lost',
    hist.reduce((n, d) => n + d.times.length, 0) === 3 && hist.some(d => d.times.indexOf('18:00') >= 0), hist);

  // Over to Honolulu by choosing it.
  await page.click('#settingsOpen');
  await Promise.all([page.waitForNavigation(), page.selectOption('#clockZone', 'Pacific/Honolulu')]);
  await page.waitForTimeout(400);
  ok('any zone can be chosen', /Honolulu time, 00:00/.test(await page.textContent('#clockBannerText')),
    await page.textContent('#clockBannerText'));
  await ctx.close();

  // ---- chosen at home, before leaving ----
  ({ ctx, page } = await open('Europe/London', 'Europe/London'));
  ok('chosen in the zone the phone is in, there is no line', !(await page.isVisible('#clockBanner')));
  await page.click('#settingsOpen');
  await page.waitForTimeout(200);
  ok('the setting remembers it and says it waits for the phone to move',
    (await page.inputValue('#clockZone')) === 'Europe/London' && /until its clock moves/.test(await page.textContent('#clockHint')),
    await page.textContent('#clockHint'));
  await ctx.close();

  ok('no page errors', errs.length === 0, errs);
  await b.close();
  t.done();
})().catch(e => { console.error(e); process.exit(1); });
