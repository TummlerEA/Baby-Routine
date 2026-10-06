"use strict";

// How long since the last feed, seen from a wake-up: on the card that opens
// when "Wake up" is tapped and on the wake-up's own row in the history. The
// statistics screen's view of the same figure is in test_splits.js.

const h = require('./helpers');
const t = h.tally();
const ok = t.ok;
const APP = h.APP;
const TZ = process.env.TZ || 'UTC';

(async () => {
  const b = await h.launch();
  const errs = [];

  // Local clock times, so every zone the suite runs in puts them on the day
  // they say they are on.
  const at = (d, hh, mm) => +new Date(2026, 8, d, hh, mm || 0);

  const open = async (now, seed) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 950 }, timezoneId: TZ });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(e.message));
    page.setDefaultTimeout(8000);
    await page.clock.install({ time: new Date(now) });
    await page.goto(APP); await page.waitForTimeout(250);
    await page.evaluate(list => {
      localStorage.clear();
      localStorage.setItem('baby-tracker-events', JSON.stringify(list.map((e, i) => ({
        id: 'e' + i, type: e[0], time: new Date(e[1]).toISOString(),
        updatedAt: new Date(e[1]).toISOString() }))));
    }, seed);
    await page.goto(APP); await page.waitForTimeout(400);
    return { ctx, page };
  };

  // ---- the wake-up card ----
  {
    const { ctx, page } = await open(at(3, 4, 0), [
      ['feed', at(3, 1, 0)],
      ['sleep_start', at(3, 1, 30)]
    ]);
    await page.click('#btnSleep'); await page.waitForTimeout(300);
    const card = await page.evaluate(() => ({
      title: document.getElementById('nextUpTitle').textContent,
      hidden: document.getElementById('nextUpFed').hidden,
      text: document.getElementById('nextUpFed').textContent
    }));
    ok('wake card opens', /^Woke up at 04:00/.test(card.title), card);
    ok('wake card says how long since the feed', !card.hidden &&
      card.text.indexOf('3h since the last feed, at 01:00') !== -1, card);

    // Moving the wake-up back moves the figure with it.
    await page.fill('#timeScroll', '03:30'); await page.waitForTimeout(300);
    const moved = await page.evaluate(() => document.getElementById('nextUpFed').textContent);
    ok('the figure follows the corrected time', moved.indexOf('2h 30m since the last feed') !== -1, moved);

    // A feed's own card has no such line.
    await page.click('#nextUpClose'); await page.waitForTimeout(200);
    await page.click('#btnFeed'); await page.waitForTimeout(300);
    const feedCard = await page.evaluate(() => document.getElementById('nextUpFed').hidden);
    ok('a feed card does not show it', feedCard === true);
    await ctx.close();
  }

  // ---- a wake-up with no feed before it ----
  {
    const { ctx, page } = await open(at(3, 4, 0), [['sleep_start', at(3, 1, 30)]]);
    await page.click('#btnSleep'); await page.waitForTimeout(300);
    const hidden = await page.evaluate(() => document.getElementById('nextUpFed').hidden);
    ok('no feed logged, no line', hidden === true);
    await ctx.close();
  }

  // ---- the history rows ----
  {
    const { ctx, page } = await open(at(3, 12, 0), [
      ['feed', at(1, 2, 0)],
      ['sleep_start', at(2, 6, 0)], ['sleep_end', at(2, 9, 0)],   // feed 31h before: none
      ['feed', at(3, 1, 0)],
      ['sleep_start', at(3, 1, 30)], ['sleep_end', at(3, 4, 45)]   // 3h 45m
    ]);
    await page.click('#logToggle'); await page.waitForTimeout(300);
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.log-item'))
      .map(r => ({ id: r.getAttribute('data-id'),
        gap: (r.querySelector('.l-fedgap') || {}).textContent || '' })));
    const by = id => (rows.find(r => r.id === id) || { gap: '' }).gap;
    ok('wake-up row says how long since the feed', by('e5') === '3h 45m since the last feed', rows);
    ok('a feed a day and more back is not quoted', by('e2') === '', rows);
    ok('only wake-ups carry it', rows.filter(r => r.gap).length === 1, rows);
    await ctx.close();
  }

  ok('no page errors', errs.length === 0, errs);
  await b.close();
  t.done();
})();
