"use strict";

// The suggested day, graded by age.
//
// There is no wake-window setting in this app — the window is the gap between
// one sleep ending and the next beginning, read off the routine table. That
// is a good arrangement right up until the baby outgrows the table, which
// happens about six times in two years and happens silently: the app goes on
// nudging for a nap at an hour that stopped being right weeks ago.
//
// So the table the reset button offers now depends on the date of birth, and
// a line above it says what the current table asks for against what is usual
// at this age. What is checked here is that the tables are arithmetically
// whole days, that the right one is offered at each age, and that nothing is
// ever changed without being asked for.

const h = require('./helpers');
const t = h.tally();
const ok = t.ok;
const APP = h.APP;

// Clock time to minutes past midnight.
const mins = s => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

(async () => {
  const b = await h.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 950 }, timezoneId: 'UTC' });
  await ctx.clock.install({ time: new Date('2026-09-24T09:00:00Z') });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('ERR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
  page.setDefaultTimeout(10000);

  await page.goto(APP);
  await page.waitForTimeout(300);

  const openRoutine = async () => {
    if (await page.isVisible('#screenRoutine')) return;
    await page.click('#routineOpen');
    await page.waitForTimeout(250);
  };
  const closeRoutine = async () => {
    if (!(await page.isVisible('#screenRoutine'))) return;
    await page.click('#routineBack');
    await page.waitForTimeout(250);
  };

  // Everything the screen says about the table, and the table itself as it is
  // actually rendered — the times in the boxes, not the constants behind them.
  const screen = () => page.evaluate(() => ({
    button: document.getElementById('routineReset').textContent,
    hidden: document.getElementById('routineWindow').hidden,
    line: document.getElementById('routineWindow').textContent,
    grown: document.getElementById('routineWindow').classList.contains('rt-grown'),
    slots: Array.from(document.querySelectorAll('#routineSlots .routine-slot')).map(row => ({
      kind: row.classList.contains('is-sleep') ? 'sleep' : 'feed',
      time: row.querySelector('[data-field="time"]').value,
      until: (row.querySelector('[data-field="until"]') || {}).value || ''
    }))
  }));

  // A date of birth is set the way the app stores it, then the page is
  // reloaded, because the age is read once when the screen is drawn.
  async function aged(dob) {
    await page.evaluate(d => {
      if (d) localStorage.setItem('baby-tracker-dob', d);
      else localStorage.removeItem('baby-tracker-dob');
    }, dob);
    await page.reload();
    await page.waitForTimeout(400);
    await openRoutine();
    return screen();
  }

  // Replace the table with whatever is suggested now. Two taps, because
  // throwing away a tuned routine asks for a second thought.
  async function takeTheSuggestion() {
    await page.click('#routineReset');
    await page.waitForTimeout(150);
    await page.click('#routineReset');
    await page.waitForTimeout(400);
    return screen();
  }

  // ---------- with no age to go on, nothing moves ----------

  let says = await aged(null);
  ok('with no date of birth the button does not claim to know an age',
    /Back to the suggested routine/.test(says.button), says.button);
  ok('and the line asks for one rather than guessing',
    /date of birth/.test(says.line), says.line);
  ok('the day it falls back to is the one the app shipped with',
    says.slots.length === 14 && says.slots[0].time === '01:30', says.slots.length);

  // ---------- the six tables are whole days ----------

  // Each suggestion has to close: every hour of the twenty-four is either
  // slept or awake. A table that does not add up would put the app's own
  // wake windows somewhere a day cannot reach.
  const bands = [
    { dob: '2026-09-10', label: 'up to 6 weeks', window: '45m' },
    { dob: '2026-08-01', label: '6 weeks to 4 months', window: '1h' },
    { dob: '2026-04-20', label: '4 to 7 months', window: '1h 45m' },
    { dob: '2025-12-20', label: '7 to 11 months', window: '3h' },
    { dob: '2025-09-01', label: '11 to 15 months', window: '3h 30m' },
    { dob: '2025-01-10', label: '15 months and up', window: '5h 30m' }
  ];

  for (const band of bands) {
    await aged(band.dob);
    const after = await takeTheSuggestion();
    ok('the day offered at ' + band.label + ' is the one named on the button',
      after.button.indexOf(band.label) !== -1, after.button);

    const sleeps = after.slots.filter(s => s.kind === 'sleep');
    ok('every sleep in the ' + band.label + ' day says when it is meant to end',
      sleeps.every(s => s.until), sleeps);

    // Hours asleep plus hours awake, round the clock.
    const slept = sleeps.reduce((sum, s) =>
      sum + ((mins(s.until) - mins(s.time) + 1440) % 1440), 0);
    const awake = sleeps.reduce((sum, s) => {
      const gaps = sleeps
        .filter(o => o !== s)
        .map(o => (mins(s.time) - mins(o.until) + 1440) % 1440)
        .filter(g => g > 0);
      return sum + Math.min.apply(null, gaps);
    }, 0);
    ok('and the ' + band.label + ' day closes on twenty-four hours',
      slept + awake === 1440, { label: band.label, slept, awake });

    ok('the line names the stretch that day asks for at ' + band.label,
      after.line.indexOf('about ' + band.window + ' awake') !== -1, after.line);
    ok('and calls it usual, because it is the suggestion itself',
      /about usual at/.test(after.line) && !after.grown, after.line);
  }

  // ---------- outgrowing a table ----------

  // The case the whole thing exists for: the routine stays exactly as it was
  // and the baby gets older. Nothing may change by itself — but the screen
  // has to say so.
  await aged('2026-08-01');
  await takeTheSuggestion();
  const before = await screen();
  ok('a two-month-old on the two-month day is told it is about right',
    /about 1h awake/.test(before.line) && /about usual/.test(before.line), before.line);

  says = await aged('2026-04-20');
  ok('the same table five months on is still the same table',
    says.slots.length === before.slots.length && says.slots[4].time === before.slots[4].time,
    [says.slots.length, before.slots.length]);
  ok('but the line now says what this age usually asks for',
    /about 1h awake/.test(says.line) && /4 to 7 months allows about 1h 45m/.test(says.line),
    says.line);
  ok('and it is lit, because this is the day it is worth reading',
    says.grown, says.line);
  ok('while the button offers the day that would fix it',
    /4 to 7 months/.test(says.button), says.button);

  const swapped = await takeTheSuggestion();
  ok('taking it widens the stretch the routine asks for',
    /about 1h 45m awake/.test(swapped.line), swapped.line);
  ok('and the line stops being lit once the two agree',
    !swapped.grown && /about usual at 4 to 7 months/.test(swapped.line), swapped.line);

  // ---------- and the window the app actually nudges on follows ----------

  // The line is only a description. What matters is that the same table now
  // drives the nudge, which reads the gap before the next sleep rather than
  // any median. A wake-up at 07:00 on the four-month day is due down at 08:45.
  await closeRoutine();
  await page.evaluate(() => {
    const on = { on: true, slots: JSON.parse(localStorage.getItem('baby-tracker-routine')).slots };
    localStorage.setItem('baby-tracker-routine', JSON.stringify(on));
  });
  await ctx.clock.setFixedTime(new Date('2026-09-24T07:30:00Z'));
  await page.reload();
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const events = [{ id: 'w1', type: 'sleep_end', time: '2026-09-24T07:00:00.000Z' },
      { id: 's1', type: 'sleep_start', time: '2026-09-24T05:00:00.000Z' }];
    localStorage.setItem('baby-tracker-events', JSON.stringify(events));
  });
  await page.reload();
  await page.waitForTimeout(500);
  const banner = await page.textContent('#routineNow');
  ok('a wake-up at seven on the four-month day is due down at a quarter to nine',
    /08:45/.test(banner), banner);

  ok('nothing threw along the way', errs.length === 0, errs);

  await b.close();
  t.done();
})();
