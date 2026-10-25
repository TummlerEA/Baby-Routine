"use strict";

// The morning the clocks went back. On 25 October 2026 London's day is 25
// hours long, and two things went wrong on it.
//
// A baby who went down at 07:15, a quarter of an hour before the night's
// last sleep was due to end, was held to that end: "the routine has her up
// at 07:30", then "1h 17m past the planned wake-up". That was not the clock
// change at all — a sleep begun with less of the night left than one of her
// naps is the morning's first nap, and is timed like one.
//
// And anything counting a day as 24 hours landed an hour out: tomorrow's
// routine steps came out as a second copy of today's, so after the last
// sleep of the evening nothing was next; a day's sleep total stopped at
// 23:00; the night ended at 06:00.

const h = require('./helpers');
const t = h.tally();
const ok = t.ok;

// Three sleeps overnight, four naps through the day.
const ROUTINE = { on: true, slots: [
  { time: '19:30', until: '23:00', kind: 'sleep' },
  { time: '23:00', kind: 'feed' },
  { time: '23:30', until: '03:00', kind: 'sleep' },
  { time: '03:00', kind: 'feed' },
  { time: '03:30', until: '07:30', kind: 'sleep' },
  { time: '07:30', kind: 'feed' },
  { time: '09:00', until: '10:30', kind: 'sleep' },
  { time: '11:00', kind: 'feed' },
  { time: '12:30', until: '14:00', kind: 'sleep' },
  { time: '14:30', kind: 'feed' },
  { time: '16:00', until: '17:00', kind: 'sleep' },
  { time: '18:00', until: '18:40', kind: 'sleep' },
  { time: '19:00', kind: 'feed' }
] };

(async () => {
  const b = await h.launch();
  const errs = [];

  // at: the instant to stand at. opts.naps: a week of 08:30 naps this many
  // minutes long. opts.events: [type, ISO] pairs for the day itself.
  async function open(at, opts) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, timezoneId: 'Europe/London' });
    await ctx.clock.setFixedTime(new Date(at));
    await ctx.addInitScript(([o, routine]) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      const ev = [];
      const add = (type, iso) => ev.push({ id: 'e' + ev.length, type, time: new Date(iso).toISOString(),
        updatedAt: new Date(iso).toISOString() });
      if (o.naps) {
        for (let d = 17; d <= 23; d++) {
          add('sleep_start', `2026-10-${d}T08:30:00+01:00`);
          add('sleep_end', new Date(+new Date(`2026-10-${d}T08:30:00+01:00`) + o.naps * 60e3).toISOString());
        }
      }
      (o.events || []).forEach(([type, iso]) => add(type, iso));
      localStorage.setItem('baby-tracker-events', JSON.stringify(ev));
      localStorage.setItem('baby-tracker-routine', JSON.stringify(routine));
      localStorage.setItem('baby-tracker-night', JSON.stringify({ start: 19, end: 8 }));
    }, [opts || {}, ROUTINE]);
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push('ERR ' + e.message));
    await page.goto(h.APP);
    await page.waitForTimeout(400);
    return { ctx, page };
  }
  const line = (page) => page.evaluate(() =>
    document.getElementById('routineLine').textContent + ' | ' + document.getElementById('routineSub').textContent);

  // Clocks back at 02:00 BST: 07:15 that morning is 07:15Z.
  const NIGHT = [['sleep_start', '2026-10-24T19:40:00+01:00'], ['sleep_end', '2026-10-24T23:00:00+01:00'],
    ['sleep_start', '2026-10-24T23:40:00+01:00'], ['sleep_end', '2026-10-25T06:30:00Z']];
  const DOWN = ['sleep_start', '2026-10-25T07:15:00Z'];

  // ---- the screenshot: down at 07:15, the night due to end at 07:30 ----
  let { ctx, page } = await open('2026-10-25T07:40:00Z', { naps: 90, events: NIGHT.concat([DOWN]) });
  let l = await line(page);
  ok('down at 07:15, she is not due up at 07:30', !/07:30/.test(l), l);
  ok('but after one of her usual naps', /likely up about 08:45/.test(l) && /in 1h 5m/.test(l), l);
  await ctx.close();

  ({ ctx, page } = await open('2026-10-25T07:40:00Z', { events: NIGHT.concat([DOWN]) }));
  l = await line(page);
  ok('with no naps of her own, as long as the routine\'s next nap', /up at 08:45/.test(l) && !/past the planned/.test(l), l);
  await ctx.close();

  // Down at 05:00, with most of the night still to go: the night's hour stands.
  ({ ctx, page } = await open('2026-10-25T05:30:00Z', { naps: 90, events: [NIGHT[0], NIGHT[1], NIGHT[2],
    ['sleep_end', '2026-10-25T04:40:00Z'], ['sleep_start', '2026-10-25T05:00:00Z']] }));
  l = await line(page);
  ok('down in the small hours, the routine still has her up at 07:30', /up at 07:30/.test(l), l);
  await ctx.close();

  // ---- the evening of the long day: what comes next is tomorrow's ----
  ({ ctx, page } = await open('2026-10-25T23:45:00Z', { events: [
    ['sleep_start', '2026-10-25T19:35:00Z'], ['sleep_end', '2026-10-25T23:05:00Z'],
    ['sleep_start', '2026-10-25T23:10:00Z'], ['sleep_end', '2026-10-25T23:40:00Z']] }));
  await page.click('#routineStripToggle');
  const strip = await page.$$eval('#routineStripList .routine-step', xs => xs.map(x =>
    x.querySelector('.rst-time').textContent + ' ' + x.querySelector('.rst-detail').textContent));
  ok('late on the day the clocks went back, tomorrow\'s steps are still ahead',
    strip.some(s => /^03:00 in 3h 15m/.test(s)), strip);
  ok('and today\'s are not listed twice', new Set(strip.map(s => s.slice(0, 5))).size === strip.length, strip);
  l = await line(page);
  ok('the line names a sleep still to come', /\d\d:\d\d/.test(l) && !/—/.test(l), l);

  // The day was 25 hours long, and the 40 minutes after 23:00 were part of it.
  await page.click('#logToggle');
  await page.waitForTimeout(200);
  const today = await page.$eval('.log-day', d => d.textContent);
  ok('today\'s sleep counts the sleep after 23:00', /🌙 4h(?! ?\d)/u.test(today), today);
  await ctx.close();

  ok('no page errors', errs.length === 0, errs);
  await b.close();
  t.done();
})().catch(e => { console.error(e); process.exit(1); });
