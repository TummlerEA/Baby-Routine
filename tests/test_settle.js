"use strict";

// How hard it was to settle: the five-segment strip under a "fell asleep" in
// the history and the edit form, the optional `settle` field it writes, and
// the evening average on each day's summary line.

const h = require('./helpers');
const t = h.tally();
const ok = t.ok;
const APP = h.APP;
const TZ = process.env.TZ || 'UTC';

(async () => {
  const b = await h.launch();
  const errs = [];
  const at = (d, hh, mm) => +new Date(2026, 8, d, hh, mm || 0);
  const iso = ms => new Date(ms).toISOString();

  const ctx = await b.newContext({ viewport: { width: 390, height: 950 }, timezoneId: TZ, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message));
  page.setDefaultTimeout(8000);
  await page.clock.install({ time: new Date(at(20, 23)) });
  await page.goto(APP); await page.waitForTimeout(250);

  // Old data: no settle anywhere, plus junk values a hand-edited or older
  // file might carry. All of it has to open as before, unrated.
  const stamp = iso(at(20, 21));
  await page.evaluate(list => {
    localStorage.clear();
    localStorage.setItem('baby-tracker-events', JSON.stringify(list));
  }, [
    { id: 'n1', type: 'sleep_start', time: iso(at(20, 13)), updatedAt: stamp, settle: 5 },
    { id: 'n1e', type: 'sleep_end', time: iso(at(20, 14)), updatedAt: stamp },
    { id: 'e1', type: 'sleep_start', time: iso(at(20, 19)), updatedAt: stamp },
    { id: 'e1e', type: 'sleep_end', time: iso(at(20, 20)), updatedAt: stamp },
    { id: 'e2', type: 'sleep_start', time: iso(at(20, 20, 30)), updatedAt: stamp, settle: 'x' },
    { id: 'e2e', type: 'sleep_end', time: iso(at(20, 22)), updatedAt: stamp },
    { id: 'y1', type: 'sleep_start', time: iso(at(19, 19)), updatedAt: stamp, settle: 9 },
    { id: 'y1e', type: 'sleep_end', time: iso(at(19, 21)), updatedAt: stamp }
  ]);
  await page.goto(APP); await page.waitForTimeout(400);
  await page.click('#logToggle'); await page.waitForTimeout(300);

  const stored = id => page.evaluate(id => JSON.parse(localStorage.getItem('baby-tracker-events'))
    .filter(e => e.id === id)[0], id);
  const strip = id => page.evaluate(id => {
    const s = document.querySelector('.settle[data-id="' + id + '"]');
    if (!s) return null;
    return { v: s.getAttribute('data-v'), on: s.querySelectorAll('.settle-seg.on').length,
      tip: s.querySelector('.settle-tip').classList.contains('show') ? s.querySelector('.settle-tip').textContent : '' };
  }, id);
  const summary = () => page.evaluate(() =>
    Array.from(document.querySelectorAll('.log-day-summary')).map(x => x.textContent));
  const seg = (id, v) => '.settle[data-id="' + id + '"] .settle-seg[data-v="' + v + '"]';

  let s = await strip('e1');
  ok('an old sleep shows an empty strip', s && s.v === '0' && s.on === 0, s);
  const counts = await page.evaluate(() => ({ strips: document.querySelectorAll('.log-item .settle').length,
    sleeps: document.querySelectorAll('.log-item').length, ids: Array.from(document.querySelectorAll('.log-item')).map(r => r.getAttribute('data-id')) }));
  ok('only sleeps get one', counts.strips * 2 === counts.sleeps, counts);
  ok('a junk value reads as unrated', (await strip('e2')).v === '0');
  let sum = await summary();
  ok('the only rating today is at 13:00, outside the evening — no line', sum[0].indexOf('settling') === -1, sum);

  // Tap: rate it 3.
  await page.click(seg('e1', 3)); await page.waitForTimeout(150);
  let e = await stored('e1');
  s = await strip('e1');
  ok('a tap rates the sleep', e.settle === 3 && s.v === '3' && s.on === 3, { e, s });
  ok('and moves updatedAt on', e.updatedAt > stamp, e);
  ok('the hint shows only while choosing', s.tip === '~30 min', s);
  await page.waitForTimeout(1500);
  ok('then goes', (await strip('e1')).tip === '', null);
  ok('the row did not open for editing', await page.evaluate(() => document.getElementById('manualPanel').hidden));

  // Swipe along the strip from 1 to 4.
  const box1 = await page.locator(seg('e2', 1)).boundingBox();
  const box4 = await page.locator(seg('e2', 4)).boundingBox();
  await page.mouse.move(box1.x + box1.width / 2, box1.y + box1.height / 2);
  await page.mouse.down();
  await page.mouse.move(box4.x + box4.width / 2, box4.y + box4.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  ok('a swipe rates it where the finger lifts', (await stored('e2')).settle === 4, await stored('e2'));

  sum = await summary();
  ok('the day line gives the evening average and count', sum[0].indexOf('settling 3.5 (n=2)') !== -1, sum);
  ok('a day with no evening rating says nothing', sum[1].indexOf('settling') === -1, sum);

  // Tap the chosen value again: cleared.
  const before = (await stored('e2')).updatedAt;
  await page.click(seg('e2', 4)); await page.waitForTimeout(150);
  e = await stored('e2');
  ok('tapping the chosen value clears it', !('settle' in e) && e.updatedAt > before && (await strip('e2')).v === '0', e);
  sum = await summary();
  ok('and the average follows', sum[0].indexOf('settling 3.0 (n=1)') !== -1, sum);

  // An old, earlier day can be rated as well.
  if (!(await strip('y1'))) { await page.click('.log-day-header[data-index="1"]'); await page.waitForTimeout(200); }
  await page.click(seg('y1', 2)); await page.waitForTimeout(150);
  ok('a sleep from an earlier day can be rated', (await stored('y1')).settle === 2);

  // Survives a reload.
  await page.goto(APP); await page.waitForTimeout(400);
  await page.click('#logToggle'); await page.waitForTimeout(300);
  ok('the rating survives a reload', (await strip('e1')).v === '3');

  // The edit form: the same strip, applied on Save.
  await page.click('.log-item[data-id="e1"] .l-type'); await page.waitForTimeout(300);
  let form = await page.evaluate(() => ({
    shown: !document.getElementById('manualSettleField').hidden,
    v: document.querySelector('#manualSettleField .settle').getAttribute('data-v') }));
  ok('editing a sleep shows its rating', form.shown && form.v === '3', form);
  await page.click('#manualSettleField .settle-seg[data-v="5"]'); await page.waitForTimeout(100);
  ok('nothing is saved before Save', (await stored('e1')).settle === 3);
  await page.click('#manualSubmit'); await page.waitForTimeout(300);
  ok('Save writes the new rating', (await stored('e1')).settle === 5);
  await page.click('.log-item[data-id="e1"] .l-type'); await page.waitForTimeout(300);
  await page.click('#manualSettleField .settle-seg[data-v="5"]'); await page.waitForTimeout(100);
  await page.click('#manualSubmit'); await page.waitForTimeout(300);
  ok('and clearing it in the form removes it', !('settle' in (await stored('e1'))));

  // Not a sleep: no strip, and turning a sleep into something else drops it.
  await page.click(seg('e1', 2)); await page.waitForTimeout(150);
  await page.click('.log-item[data-id="e1"] .l-type'); await page.waitForTimeout(300);
  await page.selectOption('#manualType', 'sleep_end'); await page.waitForTimeout(100);
  ok('the field hides for anything but a sleep', await page.evaluate(() => document.getElementById('manualSettleField').hidden));
  await page.click('#manualCancel'); await page.waitForTimeout(200);

  // A new past sleep rated straight from the form.
  await page.evaluate(() => { if (document.getElementById('manualPanel').hidden) document.getElementById('manualToggle').click(); });
  await page.selectOption('#manualType', 'sleep_start'); await page.waitForTimeout(100);
  await page.fill('#manualDateTime', '2026-09-18T19:30');
  await page.click('#manualSettleField .settle-seg[data-v="4"]'); await page.waitForTimeout(100);
  await page.click('#manualSubmit'); await page.waitForTimeout(300);
  const added = await page.evaluate(() => JSON.parse(localStorage.getItem('baby-tracker-events'))
    .filter(e => e.type === 'sleep_start' && e.time.indexOf('2026-09-18') === 0));
  ok('a new entry from the form keeps its rating', added.length === 1 && added[0].settle === 4, added);

  // In the JSON backup.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => document.getElementById('exportJson').click())
  ]);
  const backup = JSON.parse(require('fs').readFileSync(await download.path(), 'utf8'));
  const inBackup = backup.events.filter(e => e.id === 'e1')[0];
  ok('the backup carries it', inBackup && inBackup.settle === 2, inBackup);

  // From another phone: newer wins, junk is dropped, and only on a sleep.
  await page.evaluate(stamp => {
    const later = new Date(Date.parse(stamp) + 3600e3 * 5).toISOString();
    const payload = { events: [
      { id: 'e1', type: 'sleep_start', time: '2026-09-20T19:00:00', updatedAt: later, settle: 1 },
      { id: 'e2', type: 'sleep_start', time: '2026-09-20T20:30:00', updatedAt: later, settle: 7 },
      { id: 'e1e', type: 'sleep_end', time: '2026-09-20T20:00:00', updatedAt: later, settle: 3 }
    ] };
    const file = new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById('importFile');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, stamp);
  await page.waitForTimeout(700);
  ok('a newer rating from elsewhere wins', (await stored('e1')).settle === 1, await stored('e1'));
  ok('an out-of-range one is dropped', !('settle' in (await stored('e2'))), await stored('e2'));
  ok('a wake-up never carries one', !('settle' in (await stored('e1e'))), await stored('e1e'));

  // Deleting strips it from the tombstone; undo puts it back.
  await page.evaluate(() => { if (document.querySelector('.log-list').hidden) document.getElementById('logToggle').click(); });
  await page.waitForTimeout(200);
  await page.click('.l-delete[data-id="e1"]'); await page.waitForTimeout(200);
  e = await stored('e1');
  ok('a tombstone carries no rating', e.deleted === true && !('settle' in e), e);

  ok('no page errors', errs.length === 0, errs);
  await ctx.close();
  await b.close();
  t.done();
})();
