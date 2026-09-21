"use strict";

// The cheapest check there is, and the one that has caught the most: open the
// app, log one of everything, walk every screen, and insist the console stayed
// quiet. It knows almost nothing about what the app should say — only that
// nothing threw on the way.
//
// It was a probe that printed what it saw and left the reading to a person.
// Printing is not checking, so it now asserts.

const h = require('./helpers');
const t = h.tally();
const ok = t.ok;
const APP = h.APP;

(async () => {
  const b = await h.launch();
  const page = await b.newPage({ viewport: { width: 390, height: 950 } });
  const errs = [];
  page.on('pageerror', e => errs.push('ERR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
  page.setDefaultTimeout(8000);

  await page.goto(APP);
  await page.waitForTimeout(400);
  await page.evaluate(() => localStorage.clear());
  await page.goto(APP);
  await page.waitForTimeout(400);

  // Feed, nappy, asleep, awake. Four taps, four entries.
  for (const sel of ['#btnFeed', '#btnDiaper', '#btnSleep', '#btnSleep']) {
    await page.click(sel);
    await page.waitForTimeout(350);
  }
  const logged = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('baby-tracker-events') || '[]').length);
  ok('four taps save four entries', logged === 4, logged);

  // Every screen reachable from the top bar, opened and closed again.
  const screens = [
    ['#statsOpen', '#statsBack', '#screenStats', 'statistics'],
    ['#handoverOpen', '#handoverBack', '#screenHandover', 'handover'],
    ['#planOpen', '#planBack', '#screenPlan', 'the diary'],
    ['#rotaOpen', '#rotaBack', '#screenRota', 'the carer rota'],
    ['#routineOpen', '#routineBack', '#screenRoutine', 'the daily routine'],
    ['#settingsOpen', '#settingsBack', '#screenSettings', 'settings']
  ];
  for (const [open, back, screen, name] of screens) {
    ok(name + ' has a button', await page.locator(open).count() === 1);
    await page.click(open);
    await page.waitForTimeout(400);
    ok(name + ' opens', await page.isVisible(screen));
    await page.click(back);
    await page.waitForTimeout(300);
    ok(name + ' closes again', await page.isVisible('#screenMain'));
  }

  // And every screen behind the dots.
  const behindDots = [
    ['#journalOpen', '#journalBack', '#screenJournal', 'the diary'],
    ['#milkOpen', '#milkBack', '#screenMilk', 'the milk stash'],
    ['#leapOpen', '#leapBack', '#screenLeaps', 'leaps'],
    ['#shopOpen', '#shopBack', '#screenShop', 'the shopping list'],
    ['#infoOpen', '#infoBack', '#screenInfo', 'help']
  ];
  for (const [open, back, screen, name] of behindDots) {
    await page.click('#moreOpen');
    await page.waitForTimeout(250);
    await page.click(open);
    await page.waitForTimeout(400);
    ok(name + ' opens from the dots menu', await page.isVisible(screen));
    await page.click(back);
    await page.waitForTimeout(300);
    ok(name + ' closes again', await page.isVisible('#screenMain'));
  }

  // The top line carries the name, then the date, then the age, and no clock
  // of its own — the phone has one an inch above it.
  const topline = await page.evaluate(() => {
    const status = document.querySelector('.topbar-status');
    const kids = [].map.call(status.children, el => el.id || el.className);
    const name = document.getElementById('babyNameDisplay');
    return {
      order: kids,
      clock: !!document.getElementById('topClock'),
      nameRow: !!document.querySelector('.name-row'),
      nameIsButton: name ? name.tagName : null,
      nameHeight: name ? Math.round(name.getBoundingClientRect().height) : 0,
      date: document.getElementById('topDate').textContent
    };
  });
  ok('the name comes first on the top line, then the date',
    JSON.stringify(topline.order) === JSON.stringify(['babyNameDisplay', 'topDate']), topline.order);
  ok('the app keeps no clock of its own', topline.clock === false, topline);
  ok('the name has no row of its own any more', topline.nameRow === false, topline);
  ok('the name is not a button', topline.nameIsButton === 'SPAN', topline.nameIsButton);
  ok('the name is the small one', topline.nameHeight > 0 && topline.nameHeight < 40, topline.nameHeight);

  // The age is abbreviated here and nowhere else: this line holds three things.
  const dob = new Date();
  dob.setDate(dob.getDate() - 41);
  await page.evaluate(d => localStorage.setItem('baby-tracker-dob', d),
    dob.getFullYear() + '-' + String(dob.getMonth() + 1).padStart(2, '0') +
    '-' + String(dob.getDate()).padStart(2, '0'));
  await page.reload();
  await page.waitForTimeout(400);
  const dated = await page.evaluate(() => document.getElementById('topDate').textContent);
  ok('the age on the top line is the short form', /\b5w 6d\b/i.test(dated), dated);

  // Shallower, but never below what a finger needs.
  const targets = await page.evaluate(() => {
    const h = s => Math.round(document.querySelector(s).getBoundingClientRect().height);
    return { action: h('.action-btn'), combo: h('.combo-btn') };
  });
  ok('the action buttons are still a comfortable target', targets.action >= 44, targets);
  ok('the combo button is still a comfortable target', targets.combo >= 44, targets);

  // Today's routine shows four steps, two either side of now — not six.
  await page.evaluate(() =>
    localStorage.setItem('baby-tracker-routine', JSON.stringify({ on: true, slots: [] })));
  await page.reload();
  await page.waitForTimeout(500);
  const strip = await page.evaluate(() => ({
    shown: !document.getElementById('routineStrip').hidden,
    rows: document.querySelectorAll('#routineStripList > *').length
  }));
  ok('the routine strip appears when the routine is on', strip.shown === true, strip);
  ok('and shows four steps, not six', strip.rows === 4, strip);

  await page.click('#logToggle');
  await page.waitForTimeout(400);
  const rows = await page.evaluate(() => document.querySelectorAll('#logList > *').length);
  ok('the history lists what was logged', rows >= 1, rows);

  const shown = (await page.textContent('#appVersion')).trim();
  const declared = JSON.parse(h.source('version.json')).version;
  ok('the version on screen is the one in version.json', shown === 'v' + declared,
    { shown: shown, declared: declared });

  ok('nothing threw and nothing was logged to the console', errs.length === 0, errs);

  await b.close();
  t.done();
})();
