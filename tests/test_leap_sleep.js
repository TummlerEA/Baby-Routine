const DOB = '2026-08-08';

const h = require('./helpers');
const t = h.tally();
const ok = t.ok;
const APP = h.APP;

// today is day 41 (18 Sep 2026) unless a case says otherwise
function dayIso(dayNo, h, m) {
  return new Date(Date.UTC(2026, 7, 8 + dayNo, h, m || 0, 0)).toISOString();
}

// naps: [[startH, endH], ...] on each of the given day numbers
function seed(days, naps, withNight) {
  const out = [];
  let n = 0;
  days.forEach(d => {
    naps.forEach(([a, b]) => {
      out.push({ id: 's' + (n++), type: 'sleep_start', time: dayIso(d, Math.floor(a), Math.round((a % 1) * 60)) });
      out.push({ id: 's' + (n++), type: 'sleep_end', time: dayIso(d, Math.floor(b), Math.round((b % 1) * 60)) });
    });
    if (withNight) {
      out.push({ id: 's' + (n++), type: 'sleep_start', time: dayIso(d, 19) });
      out.push({ id: 's' + (n++), type: 'sleep_end', time: dayIso(d + 1, 7) });
    }
  });
  return out;
}

const range = (from, to) => { const a = []; for (let i = from; i <= to; i++) a.push(i); return a; };

(async () => {
  const b = await h.launch();

  async function run(today, events) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 950 }, timezoneId: 'UTC', serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push('ERR ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
    page.setDefaultTimeout(6000);
    await page.clock.install({ time: new Date(dayIso(today, 9)) });
    await page.goto(APP);
    await page.evaluate(() => localStorage.clear());
    await page.evaluate(([d, ev]) => {
      localStorage.setItem('baby-tracker-dob', d);
      localStorage.setItem('baby-tracker-events', JSON.stringify(ev));
    }, [DOB, events]);
    await page.goto(APP);
    await page.waitForTimeout(300);
    const banner = await page.evaluate(() => ({
      hidden: document.getElementById('leapBanner').hidden,
      line: document.getElementById('leapLine').textContent,
      sub: document.getElementById('leapSub').textContent
    }));
    await page.click('#moreOpen');
    await page.waitForTimeout(120);
    await page.click('#leapOpen');
    await page.waitForTimeout(250);
    const say = await page.evaluate(() => document.getElementById('leapSay').textContent);
    await ctx.close();
    return { banner, say, errs };
  }

  // day 41 = 18 Sep 2026, inside the 5-week band. recent = days 34..40, prior = 27..33
  const RECENT = range(34, 40), PRIOR = range(27, 33);

  // ---------- A. sleep down, the chart agrees ----------
  {
    const r = await run(41, seed(PRIOR, [[10, 12], [14, 16]], true).concat(seed(RECENT, [[10, 12]], true)));
    ok('A banner shows', r.banner.hidden === false, r.banner);
    ok('A sub says the log agrees', /The log agrees: daytime sleep is down 2h a day on the week before\./.test(r.banner.sub), r.banner.sub);
    ok('A diary gives both figures', /Daytime sleep is down 2h a day on the week before, at 2h a day\./.test(r.say), r.say);
    ok('A names the band', /The 5-week leap runs to about 19 September\./.test(r.say), r.say);
    ok('A clean console', r.errs.length === 0, r.errs);
  }

  // ---------- B. sleeping normally through a leap ----------
  {
    const r = await run(41, seed(PRIOR.concat(RECENT), [[10, 12], [14, 16]], true));
    ok('B sub contradicts the chart', /sleeping about as much as usual, though\./.test(r.banner.sub), r.banner.sub);
    ok('B diary says holding', /Daytime sleep is holding at about 4h a day, the same as the week before\./.test(r.say), r.say);
  }

  // ---------- C. sleeping more ----------
  {
    const r = await run(41, seed(PRIOR, [[10, 12]], true).concat(seed(RECENT, [[10, 12], [14, 16]], true)));
    ok('C sub says more', /sleeping more than the week before, though\./.test(r.banner.sub), r.banner.sub);
    ok('C diary says up 2h', /Daytime sleep is up 2h a day on the week before, at 4h a day\./.test(r.say), r.say);
  }

  // ---------- D. not enough logged: the generic line comes back ----------
  {
    const r = await run(41, seed(PRIOR, [[10, 12], [14, 16]], true).concat(seed(range(38, 40), [[10, 12]], true)));
    ok('D falls back to the generic sub', /Daytime sleep is usually the first thing to go\./.test(r.banner.sub), r.banner.sub);
    ok('D diary says nothing about sleep', /daytime sleep/i.test(r.say) === false, r.say);
  }

  // ---------- E. missing days must not fake a drop ----------
  {
    // five logged days in the recent week at the SAME nap length as all seven before
    const r = await run(41, seed(PRIOR, [[10, 12], [14, 16]], true).concat(seed(range(36, 40), [[10, 12], [14, 16]], true)));
    ok('E two unlogged days read as level, not as a drop', /sleeping about as much as usual/.test(r.banner.sub), r.banner.sub);
    ok('E diary does not claim a drop', /is down/.test(r.say) === false, r.say);
  }

  // ---------- F. off the chart and sleeping less ----------
  {
    // day 50 = 27 Sep, between the 5-week and 8-week bands
    const R2 = range(43, 49), P2 = range(36, 42);
    const r = await run(50, seed(P2, [[10, 12], [14, 16]], true).concat(seed(R2, [[10, 12]], true)));
    ok('F the main screen stays quiet', r.banner.hidden === true, r.banner);
    ok('F the diary says it anyway', /Daytime sleep is down 2h a day on the week before, though the chart has nothing here\./.test(r.say), r.say);
    ok('F the diary still names the next band', /Nothing due\. The 8-week leap starts about 3 October\./.test(r.say), r.say);
  }

  // ---------- G. a small wobble is not news ----------
  {
    // 4h → 3h 40m: twenty minutes, under the floor
    const r = await run(41, seed(PRIOR, [[10, 12], [14, 16]], true).concat(seed(RECENT, [[10, 12], [14, 15.6667]], true)));
    ok('G a 20-minute dip reads as level', /sleeping about as much as usual/.test(r.banner.sub), r.banner.sub);
  }

  // ---------- H. the share threshold, where the floor alone would pass ----------
  {
    // 8h → 7h 25m: 35 minutes clears the floor but is only 7% of the baseline
    const r = await run(41, seed(PRIOR, [[9, 13], [14, 18]], true).concat(seed(RECENT, [[9, 13], [14, 17.4167]], true)));
    ok('H 35m off a long day is not a change', /sleeping about as much as usual/.test(r.banner.sub), r.banner.sub);
  }
  {
    // 1h → 25m: 35 minutes off a short day is more than half of it
    const r = await run(41, seed(PRIOR, [[10, 11]], true).concat(seed(RECENT, [[10, 10.4167]], true)));
    ok('H 35m off a short day is a change', /down 35m a day/.test(r.banner.sub), r.banner.sub);
  }

  // ---------- I. the night is not counted ----------
  {
    // identical naps both weeks, but the recent week's nights are four hours shorter
    const long = seed(PRIOR, [[10, 12], [14, 16]], true);
    const short = [];
    let n = 9000;
    RECENT.forEach(d => {
      short.push({ id: 'n' + (n++), type: 'sleep_start', time: dayIso(d, 10) });
      short.push({ id: 'n' + (n++), type: 'sleep_end', time: dayIso(d, 12) });
      short.push({ id: 'n' + (n++), type: 'sleep_start', time: dayIso(d, 14) });
      short.push({ id: 'n' + (n++), type: 'sleep_end', time: dayIso(d, 16) });
      short.push({ id: 'n' + (n++), type: 'sleep_start', time: dayIso(d, 21) });
      short.push({ id: 'n' + (n++), type: 'sleep_end', time: dayIso(d + 1, 5) });
    });
    const r = await run(41, long.concat(short));
    ok('I a shorter night does not move a daytime figure', /sleeping about as much as usual/.test(r.banner.sub), r.banner.sub);
  }

  // ---------- J. no sleep logged at all: v78 behaviour is untouched ----------
  {
    const r = await run(41, []);
    ok('J generic sub with no log', /Daytime sleep is usually the first thing to go\./.test(r.banner.sub), r.banner.sub);
    ok('J diary sentence unchanged', /^5 weeks 6 days today\. The 5-week leap runs to about 19 September\.$/.test(r.say), r.say);
  }

  // ---------- K. the peak wording keeps its date and gains the figure ----------
  {
    const P3 = range(21, 27), R3 = range(28, 34);
    const r = await run(35, seed(P3, [[10, 12], [14, 16]], true).concat(seed(R3, [[10, 12]], true)));
    ok('K peak line', /at its worst about now/.test(r.banner.line), r.banner.line);
    ok('K peak keeps the date and adds the log', /Unsettled until roughly 19 September\. The log agrees: daytime sleep is down 2h a day on the week before\./.test(r.banner.sub), r.banner.sub);
  }

  // ---------- L. nothing new in storage ----------
  {
    const ctx = await b.newContext({ timezoneId: 'UTC', serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.clock.install({ time: new Date(dayIso(41, 9)) });
    await page.goto(APP);
    await page.evaluate(() => localStorage.clear());
    await page.evaluate(([d, ev]) => {
      localStorage.setItem('baby-tracker-dob', d);
      localStorage.setItem('baby-tracker-events', JSON.stringify(ev));
    }, [DOB, seed(range(27, 40), [[10, 12]], true)]);
    await page.goto(APP);
    await page.click('#moreOpen');
    await page.waitForTimeout(120);
    await page.click('#leapOpen');
    await page.waitForTimeout(300);
    const keys = await page.evaluate(() => Object.keys(localStorage).sort());
    ok('L stores nothing new', JSON.stringify(keys) === JSON.stringify(['baby-tracker-dob', 'baby-tracker-events']), keys);
    await ctx.close();
  }

  await b.close();
  t.done();
})();
