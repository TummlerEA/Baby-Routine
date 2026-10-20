"use strict";

// The app keeping its own guesses — when she'll sleep, wake and want a feed —
// and checking them against what is logged afterwards, with the result under
// Statistics. The first guess after each starting point is the one kept;
// one checked against an entry made late, one still waiting and one that
// missed by hours are left out.

const h = require('./helpers');
const t = h.tally();
const ok = t.ok;

const FIXED = (() => { const d = new Date(); d.setHours(16, 0, 0, 0); return d; })();
const MIN = 60e3;

(async () => {
  const b = await h.launch();
  const errs = [];

  async function open(seed) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 900 } });
    await ctx.clock.setFixedTime(FIXED);
    await ctx.addInitScript(([s]) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      for (const k of Object.keys(s)) localStorage.setItem(k, JSON.stringify(s[k]));
    }, [seed]);
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push('ERR ' + e.message));
    await page.goto(h.APP);
    await page.waitForTimeout(400);
    return { ctx, page };
  }
  const ev = (id, type, minsAgo) => ({ id, type, time: new Date(+FIXED - minsAgo * MIN).toISOString(),
    updatedAt: FIXED.toISOString() });
  const guesses = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('baby-tracker-guesses') || '[]'));

  // ---- what it keeps ----
  let { ctx, page } = await open({ 'baby-tracker-events': [
    ev('f1', 'feed', 60), ev('s1', 'sleep_start', 150), ev('w1', 'sleep_end', 30)] });
  let g = await guesses(page);
  const feed = g.find(x => x.k === 'feed');
  const sleep = g.find(x => x.k === 'sleep');
  ok('the next feed is kept, counted from the last one', feed && feed.a === 'f1' &&
    feed.p === +FIXED + 120 * MIN && feed.by === 'interval', g);
  ok('and when she will be ready to sleep, counted from the wake-up', sleep && sleep.a === 'w1', g);
  ok('with when it was made', feed && feed.m === +FIXED);
  await page.reload();
  await page.waitForTimeout(300);
  ok('opened again, the same guesses are not kept twice', (await guesses(page)).length === g.length);
  await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('baby-tracker-events'));
    list.push({ id: 'f2', type: 'feed', time: new Date(Date.now() - 5 * 60e3).toISOString(),
      updatedAt: new Date().toISOString() });
    localStorage.setItem('baby-tracker-events', JSON.stringify(list));
  });
  await page.reload();
  await page.waitForTimeout(300);
  g = await guesses(page);
  ok('a new feed starts a new guess, and the old one stays to be checked',
    g.filter(x => x.k === 'feed').map(x => x.a).join() === 'f1,f2', g);
  await ctx.close();

  // ---- asleep with no routine: kept, though not shown ----
  const naps = [];
  for (let d = 1; d <= 4; d++) {
    const at = new Date(FIXED); at.setDate(at.getDate() - d); at.setHours(15, 0, 0, 0);
    naps.push({ id: 'ns' + d, type: 'sleep_start', time: at.toISOString(), updatedAt: FIXED.toISOString() });
    naps.push({ id: 'ne' + d, type: 'sleep_end', time: new Date(+at + 45 * MIN).toISOString(), updatedAt: FIXED.toISOString() });
  }
  ({ ctx, page } = await open({ 'baby-tracker-events': naps.concat([ev('s9', 'sleep_start', 10)]) }));
  g = await guesses(page);
  const wake = g.find(x => x.k === 'wake');
  ok('asleep in the day, her usual nap gives a wake-up guess', wake && wake.a === 's9' &&
    wake.p === +FIXED - 10 * MIN + 45 * MIN && wake.by === 'baby', g);
  ok('marked as not shown, since no routine line says it', wake && wake.s === 0, wake);
  await ctx.close();

  // ---- checked against what happened ----
  // Five feeds, each guessed three hours on and each answered: 10m late,
  // 20m early, 5m late, 40m late, 10m early. Then three that do not count.
  const events = [], kept = [];
  for (let i = 0; i < 5; i++) {
    const from = 24 * 60 - i * 240;
    const miss = [10, -20, 5, 40, -10][i];
    events.push(ev('a' + i, 'feed', from));
    events.push(ev('b' + i, 'feed', from - 180 - miss));
    kept.push({ k: 'feed', a: 'a' + i, p: +FIXED - (from - 180) * MIN, m: +FIXED - (from - 1) * MIN, by: 'interval', s: 1 });
  }
  // Answered six hours out, by the first of the five: a missed entry, not a
  // bad guess.
  events.push(ev('c0', 'feed', 2000));
  kept.push({ k: 'feed', a: 'c0', p: +FIXED - (2000 - 180) * MIN, m: +FIXED - 1999 * MIN, by: 'interval', s: 1 });
  // Guessed after the next feed had already happened: logged late.
  kept.push({ k: 'feed', a: 'a1', p: 0, m: +FIXED, by: 'interval', s: 1 });
  // Counted from an entry since deleted.
  kept.push({ k: 'sleep', a: 'gone', p: +FIXED, m: +FIXED - 60 * MIN, by: 'interval', s: 1 });
  ({ ctx, page } = await open({ 'baby-tracker-events': events, 'baby-tracker-guesses': kept }));
  await page.click('#statsOpen');
  await page.waitForTimeout(300);
  ok('Statistics show how close the guesses are', await page.isVisible('#guessSection'));
  const tile = await page.textContent('[data-guess="feed"]');
  ok('feeds: typically off by 10m', /±10m/.test(tile), tile);
  ok('three of five within a quarter of an hour', /60% within 15m/.test(tile), tile);
  ok('and the way it leans', /she runs 5m later/.test(tile), tile);
  ok('counting only the five that are fair', /5 checked/.test(tile), tile);
  const sleepTile = await page.textContent('[data-guess="sleep"]');
  ok('a kind with too few says so', /nothing checked yet|checked so far/.test(sleepTile), sleepTile);
  await ctx.close();

  ok('no page errors', errs.length === 0, errs);
  await b.close();
  t.done();
})().catch(e => { console.error(e); process.exit(1); });
