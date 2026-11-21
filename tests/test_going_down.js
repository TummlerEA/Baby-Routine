"use strict";

// How she went down, beside how long it took: the rows on the card that opens
// after "Sleep" and in the edit form, the optional `how` and `marks` they
// write on the sleep, and where those turn up afterwards. Then the goals at
// the top of the daily routine.

const h = require('./helpers');
const t = h.tally();
const ok = t.ok;
const APP = h.APP;
const TZ = process.env.TZ || 'UTC';

(async () => {
  const b = await h.launch();
  const errs = [];
  const at = (d, hh, mm) => +new Date(2026, 10, d, hh, mm || 0);
  const iso = ms => new Date(ms).toISOString();

  const ctx = await b.newContext({ viewport: { width: 390, height: 950 }, timezoneId: TZ, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message));
  page.setDefaultTimeout(8000);
  await page.clock.install({ time: new Date(at(21, 19, 30)) });
  await page.goto(APP); await page.waitForTimeout(250);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('baby-tracker-ai', JSON.stringify({ on: true, name: false }));
  });
  await page.goto(APP); await page.waitForTimeout(400);

  const all = () => page.evaluate(() => JSON.parse(localStorage.getItem('baby-tracker-events') || '[]'));
  const stored = id => all().then(list => list.filter(e => e.id === id)[0]);
  const lastSleep = () => all().then(list => list.filter(e => e.type === 'sleep_start').pop());
  const chips = sel => page.evaluate(sel => Array.from(document.querySelectorAll(sel + ' .go-chip')).map(c => ({
    how: c.getAttribute('data-how'), mark: c.getAttribute('data-mark'), on: c.classList.contains('selected'),
    top: Math.round(c.getBoundingClientRect().top)
  })), sel);

  // ---------- the card after "Sleep" ----------
  await page.click('#btnSleep'); await page.waitForTimeout(250);
  const card = await page.evaluate(() => ({
    shown: !document.getElementById('nextUp').hidden,
    block: !document.getElementById('goDownBlock').hidden,
    strip: !!document.querySelector('#goDownSettle .settle')
  }));
  ok('after Sleep the card asks how she went down', card.shown && card.block && card.strip, card);
  let c = await chips('#goDownChips');
  ok('five ways and four marks, none chosen', c.filter(x => x.how).length === 5 &&
    c.filter(x => x.mark).length === 4 && !c.some(x => x.on), c);
  const rows = Array.from(new Set(c.map(x => x.top)));
  ok('in two rows on a phone, not more', rows.length === 2, rows);
  let sleep = await lastSleep();
  ok('nothing is recorded until a tap', !('how' in sleep) && !('marks' in sleep), sleep);

  const before = sleep.updatedAt;
  await page.clock.runFor(1000);
  await page.click('#goDownChips .go-chip[data-how="self"]'); await page.waitForTimeout(150);
  sleep = await lastSleep();
  ok('a tap saves the way at once', JSON.stringify(sleep.how) === '["self"]' && sleep.updatedAt > before, sleep);
  await page.click('#goDownChips .go-chip[data-how="self"]'); await page.waitForTimeout(150);
  ok('a second tap clears it', !('how' in (await lastSleep())));
  await page.click('#goDownChips .go-chip[data-how="breast"]'); await page.waitForTimeout(100);
  await page.click('#goDownChips .go-chip[data-how="rocked"]'); await page.waitForTimeout(150);
  ok('more than one way, kept in the list\'s own order', JSON.stringify((await lastSleep()).how) === '["rocked","breast"]',
    await lastSleep());

  await page.click('#goDownChips .go-chip[data-mark="cried"]'); await page.waitForTimeout(100);
  await page.click('#goDownChips .go-chip[data-mark="dummy"]'); await page.waitForTimeout(150);
  sleep = await lastSleep();
  ok('marks add up, kept in the list\'s own order', JSON.stringify(sleep.marks) === '["dummy","cried"]', sleep);
  c = await chips('#goDownChips');
  ok('and the chips say so', c.filter(x => x.on).map(x => x.how || x.mark).join() === 'rocked,breast,dummy,cried', c);

  await page.click('#goDownSettle .settle-seg[data-v="2"]'); await page.waitForTimeout(150);
  ok('the strip on the card rates how long it took', (await lastSleep()).settle === 2);
  ok('and the card is still open after all that', await page.isVisible('#nextUp'));
  const id = sleep.id;

  // ---------- in the history ----------
  await page.click('#nextUpClose');
  await page.click('#logToggle'); await page.waitForTimeout(250);
  const line = await page.evaluate(id => Array.from(document.querySelectorAll('.log-item[data-id="' + id + '"] .l-detail'))
    .map(x => x.textContent).join('|'), id);
  ok('the history says it under the sleep', line.indexOf('Rocked · Breast · Dummy · Cried') !== -1, line);

  // ---------- waking up ----------
  await page.clock.runFor(40 * 60000);
  await page.click('#btnSleep'); await page.waitForTimeout(250);
  ok('the wake-up card does not ask it', await page.evaluate(() =>
    !document.getElementById('nextUp').hidden && document.getElementById('goDownBlock').hidden));
  await page.click('#nextUpClose');

  // ---------- put down to the app's own white noise ----------
  await page.click('#noiseOpen'); await page.waitForTimeout(250);
  await page.click('#noiseSounds .nz-chip[data-value="brown"]'); await page.waitForTimeout(100);
  await page.click('#noisePlay'); await page.waitForTimeout(600);
  ok('the white noise is playing', await page.evaluate(() => !document.getElementById('noisePlayer').paused));
  await page.click('#noiseBack'); await page.waitForTimeout(200);
  await page.click('#btnSleep'); await page.waitForTimeout(250);
  sleep = await lastSleep();
  ok('white noise from the app is ticked already', JSON.stringify(sleep.marks) === '["noise"]', sleep);
  c = await chips('#goDownChips');
  ok('and shown ticked on the card', c.filter(x => x.on).map(x => x.mark).join() === 'noise', c);
  await page.click('#nextUpClose');
  await page.clock.runFor(30 * 60000);
  await page.click('#btnSleep'); await page.waitForTimeout(200);
  await page.click('#nextUpClose');

  // ---------- the edit form ----------
  await page.evaluate(() => { if (document.querySelector('.log-list').hidden) document.getElementById('logToggle').click(); });
  await page.waitForTimeout(200);
  await page.click('.log-item[data-id="' + id + '"] .l-type'); await page.waitForTimeout(300);
  c = await chips('#manualGoDown');
  ok('editing a sleep shows what was chosen', await page.isVisible('#manualGoDown') &&
    c.filter(x => x.on).map(x => x.how || x.mark).join() === 'rocked,breast,dummy,cried', c);
  await page.click('#manualGoDown .go-chip[data-how="breast"]');
  await page.click('#manualGoDown .go-chip[data-how="held"]');
  await page.click('#manualGoDown .go-chip[data-mark="cried"]');
  await page.click('#manualGoDown .go-chip[data-mark="quiet"]');
  ok('nothing is saved before Save', JSON.stringify((await stored(id)).how) === '["rocked","breast"]');
  await page.click('#manualSubmit'); await page.waitForTimeout(300);
  sleep = await stored(id);
  ok('Save writes it', JSON.stringify(sleep.how) === '["rocked","held"]' &&
    JSON.stringify(sleep.marks) === '["dummy","quiet"]', sleep);
  await page.click('.log-item[data-id="' + id + '"] .l-type'); await page.waitForTimeout(300);
  await page.selectOption('#manualType', 'sleep_end'); await page.waitForTimeout(100);
  ok('the rows hide for anything but a sleep', await page.isHidden('#manualGoDown'));
  await page.click('#manualCancel'); await page.waitForTimeout(200);

  // A past sleep added from the form keeps them.
  await page.evaluate(() => { if (document.getElementById('manualPanel').hidden) document.getElementById('manualToggle').click(); });
  await page.selectOption('#manualType', 'sleep_start'); await page.waitForTimeout(100);
  await page.fill('#manualDateTime', '2026-11-20T13:00');
  await page.click('#manualGoDown .go-chip[data-how="self"]');
  await page.click('#manualGoDown .go-chip[data-mark="noise"]');
  await page.click('#manualSubmit'); await page.waitForTimeout(300);
  const added = (await all()).filter(e => e.type === 'sleep_start' && e.time.indexOf('2026-11-20') === 0)[0];
  ok('a new sleep from the form keeps them', added && JSON.stringify(added.how) === '["self"]' &&
    JSON.stringify(added.marks) === '["noise"]', added);

  // ---------- backup, CSV, and another phone ----------
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => document.getElementById('exportJson').click())
  ]);
  const backup = JSON.parse(require('fs').readFileSync(await download.path(), 'utf8'));
  const inBackup = backup.events.filter(e => e.id === id)[0];
  ok('the backup carries both', inBackup && inBackup.how.join() === 'rocked,held' && inBackup.marks.join() === 'dummy,quiet', inBackup);

  const later = iso(at(21, 23));
  await page.evaluate(later => {
    const payload = { events: [
      { id: 'x1', type: 'sleep_start', time: '2026-11-19T19:00:00', updatedAt: later, how: 'magic', marks: ['cried', 'cried', 'x', 'dummy'] },
      { id: 'x2', type: 'sleep_start', time: '2026-11-19T21:00:00', updatedAt: later, how: 'held' },
      { id: 'x3', type: 'sleep_start', time: '2026-11-19T23:00:00', updatedAt: later, how: ['held', 'magic', 'self', 'self'] },
      { id: 'x1e', type: 'sleep_end', time: '2026-11-19T20:00:00', updatedAt: later, how: 'self', marks: ['dummy'] }
    ] };
    const file = new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById('importFile');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, later);
  await page.waitForTimeout(700);
  const x1 = await stored('x1');
  ok('from elsewhere, an unknown way is dropped and marks are cleaned', x1 && !('how' in x1) &&
    JSON.stringify(x1.marks) === '["dummy","cried"]', x1);
  ok('a single way as 137 wrote it reads as a list of one', JSON.stringify((await stored('x2')).how) === '["held"]',
    await stored('x2'));
  ok('a list is cleaned and put in order', JSON.stringify((await stored('x3')).how) === '["self","held"]',
    await stored('x3'));
  const x1e = await stored('x1e');
  ok('a wake-up never carries them', x1e && !('how' in x1e) && !('marks' in x1e), x1e);

  // Deleting strips them from the tombstone.
  await page.evaluate(() => { if (document.querySelector('.log-list').hidden) document.getElementById('logToggle').click(); });
  await page.waitForTimeout(200);
  await page.evaluate(() => { const hdr = document.querySelector('.log-day-header[data-index="2"]'); if (hdr) hdr.click(); });
  await page.waitForTimeout(200);
  await page.click('.l-delete[data-id="x1"]'); await page.waitForTimeout(200);
  const gone = await stored('x1');
  ok('a tombstone carries neither', gone.deleted === true && !('how' in gone) && !('marks' in gone), gone);

  // ---------- goals ----------
  await page.evaluate(() => document.getElementById('routineOpen').click());
  await page.waitForTimeout(300);
  ok('the routine opens with no goals and an invitation', await page.isVisible('#goalEmpty') &&
    (await page.$$('#goalSuggest .goal-chip')).length === 4);
  await page.click('#goalSuggest .goal-chip[data-goal="Self-settling"]'); await page.waitForTimeout(150);
  await page.fill('#goalText', '  Bedtime   by 19:30 ');
  await page.press('#goalText', 'Enter'); await page.waitForTimeout(150);
  await page.fill('#goalText', 'self-settling');
  await page.click('#goalAdd'); await page.waitForTimeout(150);
  const goals = () => page.evaluate(() => (JSON.parse(localStorage.getItem('baby-tracker-routine')) || {}).goals || []);
  let g = await goals();
  ok('goals are added, tidied, and never twice', JSON.stringify(g) === '["Self-settling","Bedtime by 19:30"]', g);
  ok('a suggestion already taken is no longer offered', (await page.$$('#goalSuggest .goal-chip')).length === 3);
  await page.click('.goal-btn[data-act="up"][data-index="1"]'); await page.waitForTimeout(150);
  g = await goals();
  ok('↑ changes which comes first', g[0] === 'Bedtime by 19:30', g);
  ok('the first is marked out', await page.evaluate(() =>
    document.querySelector('.goal-item.goal-first .goal-text').textContent) === 'Bedtime by 19:30');

  // Changing the day leaves them alone.
  await page.click('#routineEnabled'); await page.waitForTimeout(150);
  await page.click('#routineAddFeed'); await page.waitForTimeout(150);
  g = await goals();
  ok('switching the routine on and adding a step keeps the goals', g.length === 2, g);

  await page.click('.goal-btn[data-act="del"][data-index="0"]'); await page.waitForTimeout(150);
  g = await goals();
  ok('✕ removes one', JSON.stringify(g) === '["Self-settling"]', g);
  await page.goto(APP); await page.waitForTimeout(400);
  await page.evaluate(() => document.getElementById('routineOpen').click());
  await page.waitForTimeout(300);
  ok('they survive a reload', await page.evaluate(() =>
    Array.from(document.querySelectorAll('.goal-text')).map(x => x.textContent).join()) === 'Self-settling');

  // ---------- the AI summary ----------
  await page.evaluate(() => document.getElementById('routineBack').click());
  await page.click('#aiOpen'); await page.waitForTimeout(400);
  const prompt = await page.evaluate(() => document.getElementById('aiPreview').value);
  ok('the AI summary lists the goals', prompt.indexOf('Our goals, most important first: 1. Self-settling') !== -1, prompt);
  ok('and counts how she went down', /How she went down, on the \d+ sleeps where it was noted: self 2, rocked 1, held 3, dummy 1/.test(prompt) &&
    prompt.indexOf('dummy 1') !== -1, prompt.split('\n').filter(l => /went down/.test(l)));

  ok('no page errors', errs.length === 0, errs);
  await ctx.close();
  await b.close();
  t.done();
})();
