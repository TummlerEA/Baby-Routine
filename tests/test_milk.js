"use strict";

// The freezer ledger. Most of what can go wrong here is arithmetic that
// looks right on the day it is written and drifts a week later, so the
// checks run the balance forward through a made-up fortnight rather than
// tapping buttons and trusting the total on screen.

const h = require('./helpers');
const t = h.tally();
const ok = t.ok;
const APP = h.APP;

// A fixed "now", so a run at 23:58 lands in the same day as one at noon.
const NOW = '2026-03-12T10:00:00Z';

// Records are written straight into storage: the point of most of these is
// what the maths does with a week that is already there.
function record(kind, bags, ml, daysAgo, hour) {
  return { kind, bags, ml, daysAgo: daysAgo, hour: hour === undefined ? 9 : hour };
}

(async () => {
  const b = await h.launch();
  const ctx = await b.newContext({
    viewport: { width: 390, height: 950 },
    timezoneId: 'UTC'
  });
  await ctx.clock.install({ time: new Date(NOW) });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('ERR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
  page.setDefaultTimeout(8000);

  // Seeds the ledger and opens the screen on it. daysAgo counts calendar
  // days back from today, built the way the app builds them.
  async function seed(records) {
    await page.goto(APP);
    await page.waitForTimeout(300);
    await page.evaluate(rows => {
      localStorage.clear();
      const out = rows.map((r, i) => {
        const now = new Date();
        const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() - r.daysAgo,
          r.hour, 0, 0, 0);
        return {
          id: 'seed-' + i, kind: r.kind, bags: r.bags, ml: r.ml,
          at: at.toISOString(), updatedAt: at.toISOString()
        };
      });
      localStorage.setItem('baby-tracker-milk', JSON.stringify(out));
    }, records);
    await page.goto(APP);
    await page.waitForTimeout(300);
    await page.click('#moreOpen');
    await page.waitForTimeout(200);
    await page.click('#milkOpen');
    await page.waitForTimeout(400);
  }

  function head() {
    return page.evaluate(() => ({
      bags: document.getElementById('milkNowBags').textContent,
      ml: document.getElementById('milkNowMl').textContent,
      avg: document.getElementById('milkAvg').textContent,
      rate: document.getElementById('milkRate').textContent,
      warn: !document.getElementById('milkWarn').hidden,
      charts: !document.getElementById('milkCharts').hidden,
      empty: !document.getElementById('milkEmpty').hidden,
      rows: document.querySelectorAll('.milk-entry').length
    }));
  }

  // ---------- an empty freezer ----------

  await seed([]);
  let s = await head();
  ok('an empty freezer says nothing is in it', /empty/i.test(s.avg), s.avg);
  ok('an empty freezer draws no charts', s.charts === false, s);
  ok('an empty freezer says how to start', s.empty === true, s);
  ok('an empty freezer has no rows', s.rows === 0, s.rows);

  // ---------- freezing and taking out ----------

  await seed([
    record('in', 4, 480, 6),
    record('in', 2, 300, 4),
    record('out', 1, 120, 2),
    record('out', 1, 120, 1)
  ]);
  s = await head();
  ok('four in, two in, two out leaves four bags', /\b4 bags\b/.test(s.bags), s.bags);
  ok('the millilitres follow the bags', /\b540 ml\b/.test(s.ml), s.ml);
  ok('the average is the freezer as it stands', /135/.test(s.avg), s.avg);
  ok('the charts appear once there is something to draw', s.charts === true, s);
  ok('every record has a row', s.rows === 4, s.rows);

  // Two bags went out in the last two days, spread over the seven calendar
  // days the log covers: 240 ml over seven days, not over two.
  ok('the rate names the days it averaged over', /\b7 days\b/.test(s.rate), s.rate);
  ok('the rate is what went out, spread over the log', /\b34 ml\b/.test(s.rate), s.rate);
  ok('the rate says how long it lasts', /lasts about \d+ more days/.test(s.rate), s.rate);

  // ---------- a stocktake overwrites everything before it ----------

  await seed([
    record('in', 20, 2400, 10),
    record('out', 5, 600, 8),
    record('set', 3, 330, 5),
    record('in', 1, 100, 1)
  ]);
  s = await head();
  ok('a stocktake wipes out the history before it', /\b4 bags\b/.test(s.bags), s.bags);
  ok('a stocktake sets the millilitres too', /\b430 ml\b/.test(s.ml), s.ml);

  // ---------- a stocktake of nothing ----------

  await seed([
    record('in', 6, 720, 4),
    record('set', 0, 0, 2)
  ]);
  s = await head();
  ok('a stocktake may be zero', /\b0 bags\b/.test(s.bags), s.bags);
  ok('an emptied freezer says so', /empty/i.test(s.avg), s.avg);

  // ---------- the balance going below zero ----------

  await seed([
    record('in', 1, 120, 5),
    record('out', 1, 120, 3),
    record('out', 1, 120, 2)
  ]);
  s = await head();
  ok('a missed entry shows as a negative balance', /-1 bags?/.test(s.bags), s.bags);
  ok('a negative balance is named, not hidden', s.warn === true, s);

  // A negative day draws nothing rather than a bar below the rail.
  const belowRail = await page.evaluate(() => {
    const svg = document.querySelector('#milkDailyChart svg');
    const rects = [].slice.call(svg.querySelectorAll('rect'));
    return rects.some(r => Number(r.getAttribute('height')) < 0);
  });
  ok('no bar is drawn below the rail', belowRail === false);

  // ---------- the charts ----------

  await seed([record('in', 5, 600, 20), record('out', 1, 120, 3)]);
  const charts = await page.evaluate(() => {
    const bars = sel => document.querySelectorAll(sel + ' svg rect').length;
    return { daily: bars('#milkDailyChart'), weekly: bars('#milkWeeklyChart') };
  });
  ok('the daily chart has a bar a day for a fortnight', charts.daily === 14, charts);
  ok('the weekly chart has ten', charts.weekly === 10, charts);

  // The last daily bar is today, and today is after the bag came out.
  const lastBar = await page.evaluate(() => {
    const rects = document.querySelectorAll('#milkDailyChart svg rect');
    return rects[rects.length - 1].querySelector('title').textContent;
  });
  ok('the last daily bar is where the freezer stands now', /4 bags/.test(lastBar), lastBar);

  // A bar from before the first record is empty, not backfilled.
  const firstBar = await page.evaluate(() => {
    const rects = document.querySelectorAll('#milkWeeklyChart svg rect');
    return rects[0].querySelector('title').textContent;
  });
  ok('a week before anything was frozen is empty', /0 bags/.test(firstBar), firstBar);

  // ---------- the buttons ----------

  await seed([]);
  await page.fill('#milkMl', '150');
  await page.fill('#milkBags', '3');
  await page.click('#milkAdd');
  await page.waitForTimeout(400);
  s = await head();
  ok('freezing three bags of 150 stores 450 ml', /\b450 ml\b/.test(s.ml), s.ml);
  ok('freezing three bags stores three bags', /\b3 bags\b/.test(s.bags), s.bags);
  ok('the bag count resets to one after a batch',
    await page.inputValue('#milkBags') === '1');

  await page.fill('#milkMl', '150');
  await page.click('#milkUse');
  await page.waitForTimeout(400);
  s = await head();
  ok('taking one out leaves two', /\b2 bags\b/.test(s.bags), s.bags);
  ok('taking one out leaves 300 ml', /\b300 ml\b/.test(s.ml), s.ml);

  await page.fill('#milkMl', '100');
  await page.fill('#milkBags', '9');
  await page.click('#milkSet');
  await page.waitForTimeout(400);
  s = await head();
  ok('a stocktake from the form overwrites the balance', /\b9 bags\b/.test(s.bags), s.bags);
  ok('a stocktake from the form sets the millilitres', /\b900 ml\b/.test(s.ml), s.ml);

  // Deleting leaves a tombstone rather than dropping the row, or the other
  // phone would hand it straight back.
  await page.click('.milk-entry .milk-entry-del');
  await page.waitForTimeout(400);
  const afterDelete = await page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('baby-tracker-milk') || '[]');
    return { total: all.length, tombstones: all.filter(r => r.deleted).length,
      carries: all.filter(r => r.deleted && (r.kind || r.ml)).length };
  });
  ok('deleting keeps the id as a tombstone', afterDelete.tombstones === 1, afterDelete);
  ok('a tombstone drops the record nobody wanted kept',
    afterDelete.carries === 0, afterDelete);
  ok('deleting does not shorten the ledger', afterDelete.total === 3, afterDelete);

  // ---------- the form refuses nonsense ----------

  await seed([]);
  await page.fill('#milkMl', '');
  await page.click('#milkAdd');
  await page.waitForTimeout(300);
  let stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('baby-tracker-milk') || '[]').length);
  ok('freezing with no millilitres saves nothing', stored === 0, stored);

  await page.fill('#milkMl', '9999');
  await page.fill('#milkBags', '1');
  await page.click('#milkAdd');
  await page.waitForTimeout(300);
  stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('baby-tracker-milk') || '[]').length);
  ok('a bag of nine litres is refused', stored === 0, stored);

  await page.fill('#milkMl', '120');
  await page.fill('#milkBags', '0');
  await page.click('#milkAdd');
  await page.waitForTimeout(300);
  stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('baby-tracker-milk') || '[]').length);
  ok('freezing nought bags is refused', stored === 0, stored);

  // ---------- what arrives from another phone ----------

  // Sync and a restored backup both go through the normaliser, and what it
  // refuses is the whole of the app's defence: a record with a kind nobody
  // has heard of, or a volume that is not a number, must not reach the
  // ledger and silently become part of the balance.
  await seed([]);
  const imported = await page.evaluate(() => {
    const now = new Date().toISOString();
    const payload = {
      // No events array at all: a backup of a freezer and nothing else is a
      // real thing to have, and it has to come back in.
      milk: [
        { id: 'good', kind: 'in', bags: 2, ml: 240, at: now, updatedAt: now },
        { id: 'bad-kind', kind: 'melted', bags: 1, ml: 100, at: now, updatedAt: now },
        { id: 'bad-numbers', kind: 'in', bags: -4, ml: 'lots', at: now, updatedAt: now },
        { id: 'no-time', kind: 'in', bags: 1, ml: 100 },
        { id: 'no-id', kind: 'in', bags: 1, ml: 100, at: now, updatedAt: now },
        { id: 'buried', deleted: true, at: now, updatedAt: now }
      ]
    };
    delete payload.milk[4].id;
    // The file-restore path, reached the way the file input reaches it.
    const file = new File([JSON.stringify(payload)], 'backup.json',
      { type: 'application/json' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById('importFile');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  });
  ok('a backup is handed to the file input', imported === true);
  await page.waitForTimeout(700);
  const landed = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('baby-tracker-milk') || '[]'));
  const ids = landed.map(r => r.id).sort();
  ok('only the sound records and the tombstone survive the import',
    JSON.stringify(ids) === JSON.stringify(['buried', 'good']), ids);
  ok('the one sound record kept its numbers',
    landed.some(r => r.id === 'good' && r.bags === 2 && r.ml === 240), landed);

  // ---------- the summary that goes to an AI ----------

  await seed([
    record('in', 10, 1200, 9),
    record('out', 1, 120, 2),
    record('out', 1, 120, 1)
  ]);
  await page.click('#milkBack');
  await page.waitForTimeout(300);
  // Asking an AI is off until somebody switches it on, and the row only
  // appears once there is a log to summarise — so both have to be true.
  await page.evaluate(() =>
    localStorage.setItem('baby-tracker-ai', JSON.stringify({ on: true, name: false })));
  await page.reload();
  await page.waitForTimeout(400);
  await page.click('#btnFeed');
  await page.waitForTimeout(400);
  await page.click('#aiOpen');
  await page.waitForTimeout(500);
  const summary = await page.evaluate(() => document.getElementById('aiPreview').value);
  ok('the summary says what is in the freezer',
    /Frozen milk in the freezer: 8 bags, 960 ml/.test(summary), summary.slice(-400));
  ok('the summary says how fast it is going',
    /Taken out of the freezer/.test(summary), summary.slice(-400));
  ok('the summary never mentions a sync token',
    !/ghp_|github_pat_|token/i.test(summary));

  // ---------- one language ----------

  // The handover and the shopping list are read by whoever is holding the
  // phone, so they carry a language switch. These two are not: the rest of
  // the app is English and a row of chips on every screen is clutter
  // charged to every reader to serve none of them.
  await seed([]);
  const chrome = await page.evaluate(() => ({
    chips: document.querySelectorAll('#screenMilk .ho-chip-lang').length,
    label: !!document.getElementById('milkLangLabel'),
    heading: document.getElementById('milkTitle').textContent
  }));
  ok('the screen offers no language switch', chrome.chips === 0, chrome);
  ok('and has no label left behind for one', chrome.label === false, chrome);
  ok('the heading is the English one', /Milk stash/.test(chrome.heading), chrome);

  // ---------- nothing threw ----------

  ok('the console stayed quiet', errs.length === 0, errs.slice(0, 4));

  await b.close();
  t.done();
})();
