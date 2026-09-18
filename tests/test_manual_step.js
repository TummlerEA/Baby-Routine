// The manual form records something that already happened, and asking for the
// time to the minute meant dragging a wheel past thirty numbers to say "half an
// hour ago". It now moves in fives. The buttons on the main screen are
// untouched: "just now" still lands on the minute it was tapped.
//
// The part worth testing is not the step. It is everything the step could have
// broken: an entry that does not sit on the grid, a time nobody meant to
// change, a guard that refuses the future, and the order two sleep entries end
// up in.
const fs = require('fs');
const h = require('./helpers');
const t = h.tally();
const APP = h.APP;
const check = (n, ok, d) => t.ok(n, ok, d || undefined);

const DAY = Date.UTC(2026, 8, 15);
const NOW = '2026-09-15T12:43:37Z';

(async () => {
  const b = await h.launch();
  const errs = [];

  const open = async (seed) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 950 }, timezoneId: 'UTC' });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    page.setDefaultTimeout(8000);
    await page.clock.install({ time: new Date(NOW) });
    await page.goto(APP); await page.waitForTimeout(250);
    await page.evaluate((rows) => {
      localStorage.clear();
      if (rows.length) localStorage.setItem('baby-tracker-events', JSON.stringify(rows));
    }, seed || []);
    await page.goto(APP); await page.waitForTimeout(450);
    return { ctx, page };
  };
  const ev = (type, ms, extra) => Object.assign({
    id: type + ms, type, time: new Date(ms).toISOString(), updatedAt: new Date(ms).toISOString()
  }, extra || {});
  const field = page => page.evaluate(() => {
    const i = document.getElementById('manualDateTime');
    return { step: i.step, value: i.value };
  });
  // Saving redraws the screen, which can fold the history away again, so the
  // rows are always fetched fresh rather than held across a save.
  const historyRows = async (page) => {
    if (!(await page.isVisible('.log-item'))) {
      await page.click('#logToggle'); await page.waitForTimeout(400);
    }
    return page.$$('.log-item .l-body');
  };
  const times = page => page.evaluate(() =>
    JSON.parse(localStorage.getItem('baby-tracker-events') || '[]')
      .filter(e => !e.deleted).map(e => e.time).sort());

  // ---- the step is declared where it can be seen, not only set in code ----
  const html = h.source('index.html');
  check('the manual time field carries the step in the markup',
        /id="manualDateTime"[^>]*step="300"/.test(html));
  check('the button-logged time field does not',
        !/id="timeScroll"[^>]*step=/.test(html));

  // ---- a new entry ----
  let { ctx, page } = await open();
  await page.click('#manualToggle'); await page.waitForTimeout(400);
  let f = await field(page);
  check('a new entry gets the five-minute wheel', f.step === '300', JSON.stringify(f));
  // 12:43 rounds back to 12:40, not on to 12:45: an entry is written after the
  // thing happened, and the line ahead would be a time that has not arrived.
  check('and opens on the grid line behind now', f.value === '2026-09-15T12:40', f.value);
  check('which is in the past', new Date(f.value + 'Z').getTime() < Date.parse(NOW), f.value);

  // ---- the button path is untouched ----
  await page.click('#btnFeed'); await page.waitForTimeout(500);
  const scroll = await page.evaluate(() => {
    const i = document.getElementById('timeScroll');
    return { step: i.step, value: i.value };
  });
  check('a tapped button still offers every minute',
        scroll.step === '' || scroll.step === '60', JSON.stringify(scroll));
  check('and records the minute it was tapped', scroll.value === '12:43', scroll.value);
  const logged = await times(page);
  // Not truncated to the minute: two taps in the same minute have to keep the
  // order they were made in, and only the seconds say what that was.
  check('with its seconds kept', /T12:43:[0-5]\d/.test(logged.join(' ')) &&
        !/T12:43:00\.000/.test(logged.join(' ')), logged.join(' '));
  await ctx.close();

  // ---- editing ----
  ({ ctx, page } = await open([
    ev('feed', DAY + 10 * 3600000 + 43 * 60000 + 37000),          // 10:43:37, off the grid
    ev('diaper', DAY + 11 * 3600000 + 30 * 60000, { nappy: 'wet' }) // 11:30:00, on it
  ]));
  let rows = await historyRows(page);
  await rows[1].click(); await page.waitForTimeout(500);
  f = await field(page);
  check('an entry between two grid lines is edited to the minute',
        f.step === '60', JSON.stringify(f));
  check('and shows the time it actually has', f.value === '2026-09-15T10:43', f.value);

  const before = (await times(page)).join(' | ');
  await page.click('#manualSubmit'); await page.waitForTimeout(700);
  check('saving it untouched moves nothing, seconds and all',
        (await times(page)).join(' | ') === before, before + '  ->  ' + (await times(page)).join(' | '));

  rows = await historyRows(page);
  await rows[0].click(); await page.waitForTimeout(500);
  f = await field(page);
  check('an entry already on the grid keeps the coarse wheel',
        f.step === '300', JSON.stringify(f));
  await ctx.close();

  // ---- the future guard ----
  ({ ctx, page } = await open());
  await page.click('#manualToggle'); await page.waitForTimeout(400);
  const submit = async (value) => {
    await page.evaluate(v => {
      const i = document.getElementById('manualDateTime');
      i.value = v;
      i.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
    await page.click('#manualSubmit'); await page.waitForTimeout(600);
    return page.evaluate(() => {
      const n = document.getElementById('manualError');
      return n.hidden ? '' : n.textContent.trim();
    });
  };
  // The grid is worth two and a half minutes either way, so the line just
  // ahead of now has to be reachable or half the entries would be refused.
  check('the next grid line up is accepted, though it is minutes ahead',
        (await submit('2026-09-15T12:45')) === '');
  check('and it was really saved', (await times(page)).some(t => /12:45/.test(t)),
        (await times(page)).join(' '));
  check('a time well ahead is still turned away',
        /future/i.test(await submit('2026-09-15T13:30')));
  check('and a date next week too',
        /future/i.test(await submit('2026-09-22T09:00')));
  await ctx.close();

  // ---- the order of events ----
  // The question the step raises: a woken-up rounded back onto the grid can
  // land before the falling-asleep it belongs to. It can — and the app already
  // says so rather than counting a sleep of minus three minutes.
  ({ ctx, page } = await open([
    ev('sleep_start', DAY + 9 * 3600000 + 43 * 60000),   // fell asleep 09:43
    ev('sleep_end',   DAY + 9 * 3600000 + 40 * 60000),   // "woke" 09:40, three minutes before
    ev('sleep_start', DAY + 10 * 3600000),               // a sound pair after it
    ev('sleep_end',   DAY + 11 * 3600000)
  ]));
  check('an inverted pair is shown as needing fixing', await page.isVisible('#fixUps'));
  const fix = await page.evaluate(() => Array.from(document.querySelectorAll('#fixUps .fixup-item'))
    .map(n => n.textContent.replace(/\s+/g, ' ')).join(' | '));
  check('both halves are named', /No matching .Woke up./.test(fix) && /No matching .Fell asleep./.test(fix), fix);
  check('and no negative sleep is counted anywhere',
        !(await page.evaluate(() => document.body.textContent)).match(/-\d+m|−\d+m/));
  await historyRows(page);
  const summary = await page.evaluate(() => {
    const n = document.querySelector('.log-day-summary');
    return n ? n.textContent.trim() : '';
  });
  // The hour from the pair that makes sense, and nothing from the one that
  // does not — not the hour minus three minutes.
  check('the sound pair beside it is still counted in full',
        /🌙 1h$/.test(summary), summary);
  await ctx.close();

  // ---- two entries landing on the same grid line ----
  ({ ctx, page } = await open([
    ev('feed', DAY + 8 * 3600000),
    ev('diaper', DAY + 8 * 3600000, { nappy: 'wet' })
  ]));
  const both = await historyRows(page);
  check('two entries at the very same minute both appear', both.length === 2, String(both.length));
  await ctx.close();

  check('no page errors', errs.length === 0, errs.join(' | '));

  await b.close();
  t.done();
})();
