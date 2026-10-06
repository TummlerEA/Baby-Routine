"use strict";

// Feed → wake splits, at the top of the statistics screen: one row per
// wake-up with the time since the last feed, the figures over them, a flag on
// a wake-up that looks like a feed went unlogged, and the button that adds it.

const h = require('./helpers');
const t = h.tally();
const ok = t.ok;
const APP = h.APP;
const TZ = process.env.TZ || 'UTC';

(async () => {
  const b = await h.launch();
  const errs = [];

  const at = (d, hh, mm) => +new Date(2026, 8, d, hh, mm || 0);

  // Two settled days to learn from: four feeds a day, asleep 45 minutes after
  // each, awake two hours after it.
  const seed = [];
  [18, 19].forEach(d => [8, 11, 14, 17].forEach(hh => {
    seed.push(['feed', at(d, hh)], ['sleep_start', at(d, hh, 45)], ['sleep_end', at(d, hh + 2)]);
  }));
  // Today: 2h, then 3h 30m with two and a half hours awake and unfed before
  // the sleep — the flagged one — then 3h.
  seed.push(['feed', at(20, 6)], ['sleep_start', at(20, 6, 45)], ['sleep_end', at(20, 8)]);
  seed.push(['feed', at(20, 9)], ['sleep_start', at(20, 11, 30)], ['sleep_end', at(20, 12, 30)]);
  seed.push(['feed', at(20, 13)], ['sleep_start', at(20, 13, 30)], ['sleep_end', at(20, 16)]);

  const ctx = await b.newContext({ viewport: { width: 390, height: 950 }, timezoneId: TZ });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message));
  page.setDefaultTimeout(8000);
  await page.clock.install({ time: new Date(at(20, 20)) });
  await page.goto(APP); await page.waitForTimeout(250);
  await page.evaluate(list => {
    localStorage.clear();
    localStorage.setItem('baby-tracker-dob', '2026-09-01');
    localStorage.setItem('baby-tracker-events', JSON.stringify(list.map((e, i) => ({
      id: 'e' + i, type: e[0], time: new Date(e[1]).toISOString(),
      updatedAt: new Date(e[1]).toISOString() }))));
  }, seed);
  await page.goto(APP); await page.waitForTimeout(400);

  const read = () => page.evaluate(() => ({
    sectionShown: !document.getElementById('splitsSection').hidden,
    bodyShown: !document.getElementById('splitsBody').hidden,
    first: document.querySelector('#screenStats main').firstElementChild.id,
    tiles: Array.from(document.querySelectorAll('#splitsTiles .sp-tile')).map(x => x.textContent),
    flagged: (document.querySelector('#splitsTiles .sp-flagged') || {}).textContent || '',
    rows: Array.from(document.querySelectorAll('#splitsList .sp-row:not(.sp-row-head)')).map(r => ({
      id: r.getAttribute('data-id'), suspect: r.classList.contains('sp-suspect'),
      gap: r.querySelector('.sp-gap').textContent, slept: r.querySelector('.sp-slept').textContent })),
    fixes: document.querySelectorAll('#splitsList .sp-fix').length,
    empty: (document.querySelector('#splitsList .sp-empty') || {}).textContent || '',
    dots: document.querySelectorAll('#splitsAgeChart .sp-dot').length,
    hollow: document.querySelectorAll('#splitsAgeChart .sp-dot-suspect').length,
    weeks: Array.from(document.querySelectorAll('#splitsWeeks tbody tr')).map(r => r.textContent),
    dayBars: Array.from(document.querySelectorAll('#splitsDayChart rect title')).map(x => x.textContent),
    note: document.getElementById('splitsAgeNote').textContent
  }));
  const chip = async (box, label) => {
    await page.locator('#' + box + ' .ho-chip', { hasText: label }).first().click();
    await page.waitForTimeout(200);
  };

  await page.click('#statsOpen'); await page.waitForTimeout(400);
  let s = await read();
  ok('the section is first on the screen, open', s.first === 'splitsSection' && s.sectionShown && s.bodyShown, s);
  ok('a week of wake-ups by default', s.rows.length === 11, s.rows);
  ok('newest first', s.rows[0].gap === '3h' && s.rows[1].gap === '3h 30m', s.rows);
  ok('every wake-up is a dot by age', s.dots === 11 && s.hollow === 1, s);
  ok('weeks of age tabled', s.weeks.length === 1 && /^Week 2/.test(s.weeks[0]), s.weeks);
  ok('today\'s bar is the median of its believable wake-ups', /: 2h30$/.test(s.dayBars[s.dayBars.length - 1] || ''), s.dayBars);

  await chip('splitsRangeChips', 'Today');
  s = await read();
  ok('today has three wake-ups', s.rows.length === 3, s.rows);
  ok('the one awake and unfed for hours is flagged', s.rows[1].suspect && !s.rows[0].suspect && !s.rows[2].suspect, s.rows);
  ok('with a button to add the feed', s.fixes === 1);
  ok('and is said to be left out', /^⚠ 1 wake-up looks like a feed was missed/.test(s.flagged), s.flagged);
  ok('median of the rest', /^Median2h 30m2 wake-ups/.test(s.tiles[0]), s.tiles);
  ok('longest and shortest', /^Longest3h/.test(s.tiles[1]) && /^Shortest2h/.test(s.tiles[2]), s.tiles);
  ok('the slept column is the sleep', s.rows[0].slept === '2h 30m' && s.rows[1].slept === '1h', s.rows);

  await chip('splitsPartChips', '🌙 Night');
  s = await read();
  ok('no night wake-ups today', s.rows.length === 0 && /No wake-ups/.test(s.empty), s);
  await chip('splitsPartChips', 'Day and night');

  // Add the missing feed from the flag.
  await page.click('#splitsList .sp-fix'); await page.waitForTimeout(400);
  const form = await page.evaluate(() => ({
    main: !document.getElementById('screenMain').hidden,
    panel: !document.getElementById('manualPanel').hidden,
    type: document.getElementById('manualType').value,
    time: document.getElementById('manualDateTime').value,
    title: document.getElementById('manualTitle').textContent
  }));
  ok('the flag opens the form for a feed at the time the sleep began',
    form.main && form.panel && form.type === 'feed' && form.time === '2026-09-20T11:30' && form.title === 'Missing feed', form);
  await page.fill('#manualDateTime', '2026-09-20T11:00');
  await page.click('#manualSubmit'); await page.waitForTimeout(300);
  await page.click('#statsOpen'); await page.waitForTimeout(400);
  s = await read();
  ok('once added, nothing is flagged', s.fixes === 0 && !s.flagged && s.rows.every(r => !r.suspect), s);
  ok('and the wake-up counts from it', s.rows[1].gap === '1h 30m' && /^Median2h3 wake-ups/.test(s.tiles[0]), s);

  // Folded away, and it stays folded.
  await page.click('#splitsToggle'); await page.waitForTimeout(200);
  await page.click('#statsBack'); await page.waitForTimeout(200);
  await page.click('#statsOpen'); await page.waitForTimeout(300);
  s = await read();
  ok('folds away and stays folded', s.sectionShown && !s.bodyShown, s);
  await page.click('#splitsToggle'); await page.waitForTimeout(200);

  // No date of birth: the chart asks for it.
  await page.evaluate(() => localStorage.removeItem('baby-tracker-dob'));
  await page.goto(APP); await page.waitForTimeout(400);
  await page.click('#statsOpen'); await page.waitForTimeout(400);
  s = await read();
  ok('without a date of birth the age chart asks for one', s.dots === 0 && /date of birth/.test(s.note), s.note);

  await page.screenshot({ path: process.env.SHOT || '/dev/null', fullPage: false }).catch(() => {});
  await ctx.close();

  ok('no page errors', errs.length === 0, errs);
  await b.close();
  t.done();
})();
