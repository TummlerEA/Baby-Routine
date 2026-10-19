"use strict";

// What the helper says unasked when it opens — a feed the plan says is due,
// no dirty nappy for two days, sleep entries with no pair, no backup on this
// phone — and the list it keeps of what it could not place, copied from
// Settings and cleared there.

const h = require('./helpers');
const t = h.tally();
const ok = t.ok;

const FIXED = (() => { const d = new Date(); d.setHours(16, 0, 0, 0); return d; })();

(async () => {
  const b = await h.launch();
  const errs = [];

  // opts.lastFeedH: hours since the last feed. opts.dirty: a dirty nappy
  // within the last day. opts.unpaired: a wake-up with nothing before it.
  // opts.days: how far back the log goes.
  async function open(opts) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 900 } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    await ctx.clock.setFixedTime(FIXED);
    await ctx.addInitScript((o) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      const now = Date.now();
      const H = 3600e3;
      const ev = [];
      const add = (type, ago, extra) => ev.push(Object.assign({ id: 'e' + ev.length, type,
        time: new Date(now - ago).toISOString(), updatedAt: new Date(now).toISOString() }, extra || {}));
      for (let hrs = o.lastFeedH; hrs < o.days * 24; hrs += 3) add('feed', hrs * H);
      for (let hrs = 1; hrs < o.days * 24; hrs += 4) add('diaper', hrs * H, { nappy: 'wet' });
      if (o.dirty) add('diaper', 5 * H, { nappy: 'dirty' });
      if (o.unpaired) add('sleep_end', 7 * H);
      localStorage.setItem('baby-tracker-events', JSON.stringify(ev));
    }, opts);
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push('ERR ' + e.message));
    await page.goto(h.APP);
    await page.waitForTimeout(400);
    return { ctx, page };
  }

  const hints = (page) => page.evaluate(() => {
    const bubbles = [...document.querySelectorAll('.helper-bot[data-topic="hints"]')];
    const last = bubbles.pop();
    return { count: bubbles.length + (last ? 1 : 0),
      ids: last ? [...last.querySelectorAll('[data-hint]')].map(x => x.getAttribute('data-hint')) : [],
      text: last ? last.textContent : '' };
  });

  // ---- everything at once, three at most ----
  let { ctx, page } = await open({ lastFeedH: 5, days: 20, unpaired: true });
  await page.click('#helperOpen');
  await page.waitForTimeout(200);
  let got = await hints(page);
  ok('opening says what is worth knowing', got.count === 1, got);
  ok('a feed the plan says is due', got.ids[0] === 'feed' && /5h ago/.test(got.text), got.text);
  ok('no dirty nappy for two days and more', got.ids.indexOf('dirty') >= 0 && /No dirty nappy for \d+ days/.test(got.text), got.text);
  ok('sleep entries with no pair', got.ids.indexOf('unpaired') >= 0, got.ids);
  ok('three lines at most', got.ids.length === 3 && got.ids.indexOf('backup') < 0, got.ids);
  await page.click('#helperBack');
  await page.click('#helperOpen');
  await page.waitForTimeout(200);
  ok('opened again with nothing changed, not said twice', (await hints(page)).count === 1);
  await page.click('.helper-bot[data-topic="hints"] .helper-action >> nth=1');
  await page.waitForTimeout(300);
  ok('Show me on the unpaired sleeps goes to them', await page.isVisible('#screenMain') &&
    await page.evaluate(() => document.getElementById('fixUps').classList.contains('helper-spot')));
  await page.click('#helperOpen');
  await page.waitForTimeout(150);
  await page.fill('#helperInput', 'когда последнее кормление');
  await page.press('#helperInput', 'Enter');
  await page.click('#helperBack');
  await page.click('#helperOpen');
  await page.waitForTimeout(200);
  got = await hints(page);
  ok('after a question in Russian, they come in Russian', /Последнее кормление было 5 ч назад/.test(got.text) &&
    /Грязного подгузника не было/.test(got.text), got.text);
  await ctx.close();

  // ---- the backup, on its own ----
  ({ ctx, page } = await open({ lastFeedH: 1, days: 20, dirty: true }));
  await page.click('#helperOpen');
  await page.waitForTimeout(200);
  got = await hints(page);
  ok('a month-old log with no backup on this phone says so', got.ids.join() === 'backup' &&
    /hasn't saved a backup/.test(got.text), got);
  await page.click('.helper-bot[data-topic="hints"] .helper-action');
  await page.waitForTimeout(300);
  ok('Show me goes to Download JSON', await page.isVisible('#screenSettings') &&
    await page.evaluate(() => document.getElementById('exportJson').classList.contains('helper-spot')));
  await Promise.all([page.waitForEvent('download').catch(() => null), page.click('#exportJson')]);
  await page.waitForTimeout(200);
  await page.click('#settingsBack');
  await page.click('#helperOpen');
  await page.waitForTimeout(200);
  ok('the backup is remembered', !!(await page.evaluate(() => localStorage.getItem('baby-tracker-backup-at'))));
  ok('and after it, nothing new to say', (await hints(page)).count === 1);
  await ctx.close();

  // ---- a quiet day says nothing ----
  ({ ctx, page } = await open({ lastFeedH: 1, days: 1, dirty: true }));
  await page.click('#helperOpen');
  await page.waitForTimeout(200);
  ok('nothing worth saying, nothing said', (await hints(page)).count === 0);
  ok('a young log is not nagged about a backup or about poo', (await hints(page)).count === 0);

  // ---- what it could not place ----
  const ask = async (q) => {
    await page.fill('#helperInput', q);
    await page.press('#helperInput', 'Enter');
    await page.waitForTimeout(40);
  };
  await ask('what is the weather');
  await ask('What is the weather');
  await ask('покормила левой 15 минут');
  await page.click('.helper-bot:last-child .helper-action >> text=Не то');
  await ask('когда последнее кормление');
  const misses = await page.evaluate(() => JSON.parse(localStorage.getItem('baby-tracker-helper-misses') || '[]'));
  ok('questions it could not place are kept', misses.some(m => /weather/.test(m.q)), misses);
  ok('once each, however they were capitalised', misses.filter(m => /weather/i.test(m.q)).length === 1, misses);
  ok('and a sentence it read wrongly', misses.some(m => /покормила левой/.test(m.q)), misses);
  ok('but not one it answered', !misses.some(m => /последнее кормление/.test(m.q)), misses);
  await page.click('#helperBack');
  await page.click('#settingsOpen');
  await page.waitForTimeout(200);
  ok('Settings say how many', /2 questions it didn't understand/.test(await page.textContent('#helperMissesState')));
  await page.click('#helperMissesCopy');
  await page.waitForTimeout(200);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  ok('Copy puts the list on the clipboard', /didn't understand/.test(copied) && /What is the weather/.test(copied) &&
    /покормила левой 15 минут/.test(copied), copied);
  await page.click('#helperMissesClear');
  await page.waitForTimeout(150);
  ok('Clear empties it', /Nothing it didn't understand/.test(await page.textContent('#helperMissesState')) &&
    !(await page.isVisible('#helperMissesCopy')));
  ok('and forgets it', await page.evaluate(() => localStorage.getItem('baby-tracker-helper-misses')) === null);
  await ctx.close();

  ok('no page errors', errs.length === 0, errs);
  await b.close();
  t.done();
})().catch(e => { console.error(e); process.exit(1); });
