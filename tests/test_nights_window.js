// The nights section measures something no other card on this screen does: a
// stretch that starts in the evening and ends the next morning, so midnight
// falls in the middle of it. Two things follow, and both were wrong.
//
// The window has to be the one the chips promise — the same days the feed and
// nappy charts draw — or "best night" names a day the chosen period does not
// contain. And the night just gone has to appear in the morning, because that
// is the hour this screen is opened to look at it.
//
// Every case here pins the clock. Nothing about a night can be tested from
// whatever time it happens to be when the suite runs.
const h = require('./helpers');
const t = h.tally();
const APP = h.APP;
const check = (n, ok, d) => t.ok(n, ok, d || undefined);

(async () => {
  const b = await h.launch();
  const errs = [];

  // The page runs in UTC so a time written here means the same there, and the
  // seeded nights fall on the clock hours they say they do.
  const at = (d, h, m) => Date.UTC(2026, 8, d, h, m, 0);

  // asleep: the last stretch of the night now ending has no "woke up" yet.
  // through: how many evenings to seed, 1st up to and including this.
  const open = async (when, opts) => {
    opts = opts || {};
    const ctx = await b.newContext({ viewport: { width: 390, height: 950 }, timezoneId: 'UTC' });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(when + ': ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push(when + ': ' + m.text()); });
    page.setDefaultTimeout(8000);
    await page.clock.install({ time: new Date(when) });
    await page.goto(APP); await page.waitForTimeout(250);
    await page.evaluate((o) => {
      localStorage.clear();
      const ev = []; let n = 0;
      const mk = (type, ms) => ev.push({ id: 'e' + (n++), type,
        time: new Date(ms).toISOString(), updatedAt: new Date(ms).toISOString() });
      const at = (d, h, m) => Date.UTC(2026, 8, d, h, m, 0);
      // Nights beginning the 1st through the 7th. Three stretches each: 4h,
      // then 2h 30m, then 2h 30m, so "times up in the night" is 2 and the
      // longest unbroken stretch is 4h.
      for (let d = 1; d <= 7; d++) {
        const last = d === 7 && o.asleep;
        mk('sleep_start', at(d, 21, 30)); mk('sleep_end', at(d + 1, 1, 30));
        mk('sleep_start', at(d + 1, 2, 0)); mk('sleep_end', at(d + 1, 4, 30));
        mk('sleep_start', at(d + 1, 5, 0));
        if (!last) mk('sleep_end', at(d + 1, 7, 30));
      }
      // Feeds on every calendar day the charts could draw, so the day window
      // is never the thing that is short.
      for (let d = 1; d <= 8; d++) for (let i = 0; i < 6; i++) mk('feed', at(d, 6 + i * 2, 0));
      localStorage.setItem('baby-tracker-events', JSON.stringify(ev));
      localStorage.setItem('baby-tracker-night', JSON.stringify(o.night || { start: 21, end: 8 }));
    }, { asleep: !!opts.asleep, night: opts.night });
    await page.goto(APP); await page.waitForTimeout(450);
    await page.click('#statsOpen'); await page.waitForTimeout(500);
    return { ctx, page };
  };

  const read = (page) => page.evaluate(() => {
    const ticks = id => Array.from(document.querySelectorAll('#' + id + ' text.ho-tick'))
      .map(t => Number(t.textContent));
    return {
      window: document.getElementById('statsNightWindow').textContent,
      nights: ticks('statsLongestChart'),
      wakings: ticks('statsWakingsChart'),
      days: ticks('statsFeedChart'),
      best: document.getElementById('statsLongestSummary').textContent
    };
  });
  // On the longer periods the chart thins its date labels, so the bars have to
  // be counted rather than read off the ticks. The average line carries a
  // little plate behind its label, which is a rect and is not a bar.
  const bars = (page, id) => page.evaluate(i =>
    document.querySelectorAll('#' + i + ' rect:not(.stats-avg-plate)').length, id);
  const pick = async (page, days) => {
    await page.click(`#statsPeriodChips button:has-text("${days} days")`);
    await page.waitForTimeout(400);
  };

  // ---- the morning in the report: ten to eight, baby up ----
  let { ctx, page } = await open('2026-09-08T07:49:00Z');
  let r = await read(page);
  check('the night just gone is on the chart before eight',
        r.nights.indexOf(7) >= 0, r.nights.join(','));
  check('the nights start where the days start',
        r.nights[0] === r.days[0], r.nights.join(',') + ' vs ' + r.days.join(','));
  check('and no night is outside the days drawn beside it',
        r.nights.every(d => r.days.indexOf(d) >= 0), r.nights.join(',') + ' vs ' + r.days.join(','));
  check('the best night named is one of the nights shown',
        /2 Sep|3 Sep|4 Sep|5 Sep|6 Sep|7 Sep/.test(r.best) && !/1 Sep/.test(r.best), r.best);
  check('the two night charts draw the same nights',
        r.nights.join(',') === r.wakings.join(','), r.nights.join(',') + ' vs ' + r.wakings.join(','));
  check('the count under the heading matches the bars',
        r.window.indexOf(r.nights.length + ' nights') > 0, r.window);
  await ctx.close();

  // ---- eight o'clock must not change the answer ----
  ({ ctx, page } = await open('2026-09-08T08:05:00Z'));
  const past8 = await read(page);
  check('nothing appears or vanishes as the window shuts',
        past8.nights.join(',') === r.nights.join(','),
        past8.nights.join(',') + ' vs ' + r.nights.join(','));
  await ctx.close();

  // ---- still asleep: the night really is unfinished ----
  ({ ctx, page } = await open('2026-09-08T07:49:00Z', { asleep: true }));
  const sleeping = await read(page);
  check('a night still being slept through is not counted early',
        sleeping.nights.indexOf(7) === -1, sleeping.nights.join(','));
  check('and the nights before it are all still there',
        sleeping.nights.length === r.nights.length - 1,
        sleeping.nights.join(',') + ' vs ' + r.nights.join(','));
  await ctx.close();

  // ---- too early in the morning ----
  ({ ctx, page } = await open('2026-09-08T06:00:00Z'));
  check('up at six is too early to call the night done',
        (await read(page)).nights.indexOf(7) === -1);
  await ctx.close();
  ({ ctx, page } = await open('2026-09-08T06:35:00Z'));
  check('within the last stretch of it, and up, it counts',
        (await read(page)).nights.indexOf(7) >= 0);
  await ctx.close();

  // ---- the middle of the night changes nothing ----
  ({ ctx, page } = await open('2026-09-08T02:00:00Z', { asleep: true }));
  const middle = await read(page);
  check('at two in the morning the night in progress is not on the chart',
        middle.nights.indexOf(7) === -1, middle.nights.join(','));
  check('and the evening yet to come is not either',
        middle.nights.indexOf(8) === -1, middle.nights.join(','));
  await ctx.close();

  // ---- the same rule on the longer periods ----
  ({ ctx, page } = await open('2026-09-08T07:49:00Z'));
  for (const days of [7, 14, 30]) {
    await pick(page, days);
    const long = await read(page);
    const nightBars = await bars(page, 'statsLongestChart');
    const dayBars = await bars(page, 'statsFeedChart');
    check(`${days} days: the nights still start where the days start`,
          long.nights[0] === long.days[0], long.nights.join(',') + ' vs ' + long.days.join(','));
    // One fewer, always: the night beginning this evening has not happened, so
    // a window of N days holds N - 1 nights that have.
    check(`${days} days: one night for every day but tonight`,
          nightBars === dayBars - 1, nightBars + ' nights vs ' + dayBars + ' days');
    check(`${days} days: and the count under the heading says so`,
          long.window.indexOf(nightBars + ' nights') > 0, long.window);
    check(`${days} days: the night just gone is the last of them`,
          long.nights[long.nights.length - 1] === 7, long.nights.join(','));
  }
  await ctx.close();

  // ---- a short night window cannot be swallowed by the grace ----
  // Counting early is capped at half the night, so a one-hour window cannot be
  // declared over the moment it opens.
  ({ ctx, page } = await open('2026-09-08T22:10:00Z', { night: { start: 22, end: 23 } }));
  check('ten minutes into a one-hour night, it is not over yet',
        (await read(page)).nights.indexOf(8) === -1);
  await ctx.close();
  ({ ctx, page } = await open('2026-09-08T22:40:00Z', { night: { start: 22, end: 23 } }));
  check('forty minutes in, past halfway and up, it is',
        (await read(page)).nights.indexOf(8) >= 0);
  await ctx.close();

  check('no page errors', errs.length === 0, errs.join(' | '));

  await b.close();
  t.done();
})();
