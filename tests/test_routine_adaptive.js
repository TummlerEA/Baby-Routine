"use strict";

// The next sleep follows how long she has been awake, not the routine's next
// hour, when the two are far apart. A two-month-old who woke at 14:20 from a
// nap the routine never had is due down again at about 15:40 — not at the
// 18:00 nap the routine has next. Her own usual awake stretch is used when
// the log has enough of them, kept inside the range for her age, and the
// middle of that range otherwise. Where the routine's own gap is a sensible
// one for her age, the routine still wins, and at night it always does.

const h = require('./helpers');
const t = h.tally();
const ok = t.ok;

// 14:36 today, wherever the run is.
const FIXED = (() => { const d = new Date(); d.setHours(14, 36, 0, 0); return d; })();

// A routine like the one that showed the problem: a nap at noon and the next
// one not until six, five hours after the noon nap ends.
const ROUTINE = { on: true, slots: [
  { time: '06:00', kind: 'feed' },
  { time: '09:00', until: '10:30', kind: 'sleep' },
  { time: '10:30', kind: 'feed' },
  { time: '12:00', until: '13:00', kind: 'sleep' },
  { time: '14:30', kind: 'feed' },
  { time: '18:00', until: '19:00', kind: 'sleep' },
  { time: '19:30', kind: 'feed' },
  { time: '21:00', until: '06:00', kind: 'sleep' }
] };

(async () => {
  const b = await h.launch();
  const errs = [];

  // opts.dobDays: her age in days, or none. opts.history: a week of daytime
  // awake stretches this many minutes long. opts.today: [asleep, woke] as
  // "HH:MM" clock times today.
  async function open(opts) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 900 } });
    await ctx.clock.setFixedTime(opts.at || FIXED);
    await ctx.addInitScript(([o, routine]) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      const now = new Date();
      const ev = [];
      const add = (type, at) => ev.push({ id: 'e' + ev.length, type, time: at.toISOString(),
        updatedAt: now.toISOString() });
      const clock = (dayOffset, hm) => {
        const d = new Date(now); d.setDate(d.getDate() + dayOffset);
        const [hh, mm] = hm.split(':').map(Number); d.setHours(hh, mm, 0, 0); return d;
      };
      if (o.history) {
        for (let day = -7; day <= -1; day++) {
          // Three daytime naps, each after the same awake stretch.
          let woke = clock(day, '08:00');
          add('sleep_end', woke);
          for (let i = 0; i < 3; i++) {
            const down = new Date(+woke + o.history * 60e3);
            add('sleep_start', down);
            woke = new Date(+down + 60 * 60e3);
            add('sleep_end', woke);
          }
          add('sleep_start', clock(day, '20:30'));
        }
      }
      add('sleep_end', clock(0, o.morning || '06:30'));
      if (o.today) { add('sleep_start', clock(0, o.today[0])); add('sleep_end', clock(0, o.today[1])); }
      localStorage.setItem('baby-tracker-events', JSON.stringify(ev));
      localStorage.setItem('baby-tracker-routine', JSON.stringify(routine));
      if (o.dobDays !== undefined) {
        const dob = new Date(now); dob.setDate(dob.getDate() - o.dobDays);
        localStorage.setItem('baby-tracker-dob', dob.getFullYear() + '-' +
          String(dob.getMonth() + 1).padStart(2, '0') + '-' + String(dob.getDate()).padStart(2, '0'));
      }
    }, [opts, ROUTINE]);
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push('ERR ' + e.message));
    await page.goto(h.APP);
    await page.waitForTimeout(400);
    const read = async () => ({
      line: await page.textContent('#routineLine'),
      sub: await page.textContent('#routineSub'),
      tally: await page.textContent('#routineTally'),
      strip: await page.$$eval('#routineStripList .routine-step', xs => xs.map(x =>
        (x.classList.contains('extra') ? 'EXTRA ' : '') + x.textContent)),
      forecast: await page.textContent('#forecastList')
    });
    return { ctx, page, read };
  }

  // ---- her own usual stretch ----
  let { ctx, read } = await open({ dobDays: 62, history: 80, today: ['13:30', '14:20'] });
  let r = await read();
  ok('woke at 14:20 after an extra nap: down again at 15:40, not 18:00', /Nap at 15:40/.test(r.line), r.line);
  ok('said why: her own usual stretch', /her usual 1h 20m awake/.test(r.sub), r.sub);
  ok('and where the routine is', /routine's next sleep is 18:00/.test(r.sub), r.sub);
  ok('no "back on the routine" for a nap the routine never had', !/back on it/.test(r.sub), r.sub);
  ok('What\'s next says the same hour', /expected 15:40/.test(r.forecast) && !/expected 18:00/.test(r.forecast),
    r.forecast);
  const extra = r.strip.findIndex(x => /^EXTRA .*Nap.*extra/.test(x));
  const six = r.strip.findIndex(x => /18:00/.test(x));
  ok('the day\'s list has the extra nap in its place', extra >= 0 && /15:40/.test(r.strip[extra]) &&
    (six < 0 || extra < six), r.strip);
  ok('the feed whose hour has only just gone is still the one in hand', /🍼 due now/.test(r.tally), r.tally);
  await ctx.close();

  // ---- a stretch outside her age is kept inside it ----
  ({ ctx, read } = await open({ dobDays: 62, history: 150, today: ['13:30', '14:20'] }));
  r = await read();
  ok('an awake stretch too long for two months is held to the most for her age', /Nap at 15:50/.test(r.line) &&
    /her usual 1h 30m awake/.test(r.sub), [r.line, r.sub]);
  await ctx.close();

  // ---- nothing of her own yet: the middle of the range for her age ----
  ({ ctx, read } = await open({ dobDays: 62, today: ['13:30', '14:20'] }));
  r = await read();
  ok('with no week behind her, the usual for her age', /Nap at 15:35/.test(r.line) &&
    /1h 15m awake usual at 6 to 12 weeks/.test(r.sub), [r.line, r.sub]);
  await ctx.close();

  // ---- a sensible gap in the routine still wins ----
  const morning = (() => { const d = new Date(FIXED); d.setHours(10, 40, 0, 0); return d; })();
  ({ ctx, read } = await open({ dobDays: 62, history: 80, today: ['09:00', '10:30'], at: morning }));
  r = await read();
  ok('a routine gap that suits her age is kept: 12:00 by the routine', /Sleep at 12:00 by the routine/.test(r.line),
    r.line);
  ok('and no extra nap is invented', !r.strip.some(x => /^EXTRA/.test(x)), r.strip);
  await ctx.close();

  // ---- with no age, the routine as before ----
  ({ ctx, read } = await open({ today: ['13:30', '14:20'] }));
  r = await read();
  ok('without a date of birth, the routine\'s own gap as before', /19:20/.test(r.line) && !/Nap at/.test(r.line) &&
    /this routine allows|the routine had/.test(r.sub), [r.line, r.sub]);
  await ctx.close();

  ok('no page errors', errs.length === 0, errs);
  await b.close();
  t.done();
})().catch(e => { console.error(e); process.exit(1); });
