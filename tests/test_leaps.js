const DOB = '2026-08-08';

const h = require('./helpers');
const t = h.tally();
const ok = t.ok;
const APP = h.APP;

// day N after DOB, at 09:00 UTC
function dayToIso(n) {
  const d = new Date(Date.UTC(2026, 7, 8 + n, 9, 0, 0));
  return d.toISOString().replace(/\.\d+Z$/, 'Z');
}

async function openLeaps(page) {
  await page.click('#moreOpen');
  await page.waitForTimeout(120);
  await page.click('#leapOpen');
  await page.waitForTimeout(250);
}

(async () => {
  const b = await h.launch();

  async function at(day, opts) {
    opts = opts || {};
    const ctx = await b.newContext({ viewport: { width: 390, height: 950 }, timezoneId: 'UTC', serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push('ERR ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
    page.setDefaultTimeout(6000);
    await page.clock.install({ time: new Date(dayToIso(day)) });
    await page.goto(APP);
    await page.evaluate(() => localStorage.clear());
    if (!opts.noDob) await page.evaluate(d => localStorage.setItem('baby-tracker-dob', d), DOB);
    await page.goto(APP);
    await page.waitForTimeout(250);
    return { ctx, page, errs };
  }

  async function bannerAt(day, opts) {
    const { ctx, page, errs } = await at(day, opts);
    const out = await page.evaluate(() => {
      const el = document.getElementById('leapBanner');
      return {
        hidden: el.hidden,
        cls: el.className,
        line: document.getElementById('leapLine').textContent,
        sub: document.getElementById('leapSub').textContent,
        icon: document.getElementById('leapIcon').innerHTML.length
      };
    });
    out.errs = errs;
    await ctx.close();
    return out;
  }

  // ---------- 1. no date of birth: silent ----------
  {
    const { ctx, page, errs } = await at(41, { noDob: true });
    const r = await page.evaluate(() => ({
      banner: document.getElementById('leapBanner').hidden,
      panel: document.getElementById('leapPanel').hidden
    }));
    ok('no dob → no banner', r.banner === true, r);
    ok('no dob → no panel', r.panel === true, r);
    ok('no dob → no errors', errs.length === 0, errs);
    await ctx.close();
  }

  // ---------- 2. the banner, day by day ----------
  const cases = [
    { day: 31, on: false, why: 'four days before the first band' },
    { day: 32, on: true,  kind: 'soon',  needs: 'from about 12 September' },
    { day: 34, on: true,  kind: 'soon',  needs: 'from about 12 September' },
    { day: 35, on: true,  kind: 'peak',  needs: 'at its worst about now' },
    { day: 39, on: true,  kind: 'peak',  needs: 'at its worst about now' },
    { day: 40, on: true,  kind: 'in',    needs: 'to about 19 September' },
    { day: 41, on: true,  kind: 'in',    needs: 'to about 19 September' },
    { day: 42, on: true,  kind: 'easing', needs: 'should be easing off' },
    { day: 45, on: true,  kind: 'easing', needs: 'should be easing off' },
    { day: 46, on: false, why: 'past the easing window' },
    { day: 52, on: false, why: 'four days before the second band' },
    { day: 53, on: true,  kind: 'soon',  needs: '8-week leap from about 3 October' },
    { day: 56, on: true,  kind: 'peak',  needs: 'at its worst about now' },
    { day: 62, on: true,  kind: 'in',    needs: 'to about 17 October' },
    { day: 65, on: true,  kind: 'in',    needs: 'to about 17 October' },
    { day: 66, on: false, why: 'ten days in, band still on — the quiet rule' },
    { day: 69, on: false, why: 'still inside the band, still quiet' },
    { day: 70, on: true,  kind: 'easing', needs: 'should be easing off' },
    // the long fifth band: 23–29 weeks, 161–203 days
    { day: 165, on: true, kind: 'in',    needs: '26-week leap' },
    { day: 175, on: false, why: 'a six-week band does not hold the screen for six weeks' },
    { day: 195, on: false, why: 'still inside the long band, still quiet' },
    // the 29-week exception wins over leap five easing off
    { day: 203, on: true, kind: 'settling', needs: 'not a leap' },
    { day: 210, on: true, kind: 'settling', needs: 'not a leap' },
    { day: 213, on: false, why: 'ten days into the settling band' },
    // off the end of the chart
    { day: 600, on: false, why: 'past 84 weeks' }
  ];

  for (const c of cases) {
    const r = await bannerAt(c.day);
    if (!c.on) {
      ok('day ' + c.day + ' silent (' + c.why + ')', r.hidden === true, r.line);
    } else {
      ok('day ' + c.day + ' shows', r.hidden === false, r);
      ok('day ' + c.day + ' says "' + c.needs + '"',
        (r.line + ' ' + r.sub).toLowerCase().indexOf(c.needs.toLowerCase()) !== -1, r.line + ' | ' + r.sub);
      ok('day ' + c.day + ' has an icon', r.icon > 40, r.icon);
    }
    ok('day ' + c.day + ' clean console', r.errs.length === 0, r.errs);
  }

  // ---------- 3. tones ----------
  {
    const a = await bannerAt(41), c = await bannerAt(43), d = await bannerAt(33), e = await bannerAt(205);
    ok('in-band tone is storm', /tone-storm/.test(a.cls), a.cls);
    ok('easing tone is sun', /tone-sun/.test(c.cls), c.cls);
    ok('notice tone is calm', /tone-calm/.test(d.cls), d.cls);
    ok('not-a-leap tone is calm', /tone-calm/.test(e.cls), e.cls);
  }

  // ---------- 4. the screen and the chart ----------
  {
    const { ctx, page, errs } = await at(41);
    await openLeaps(page);
    const shown = await page.evaluate(() => ({
      screen: document.getElementById('screenLeaps').hidden,
      panel: document.getElementById('leapPanel').hidden,
      noDob: document.getElementById('leapNoDob').hidden,
      rows: document.querySelectorAll('#leapChart .leap-row').length,
      here: document.querySelectorAll('#leapChart .leap-here').length,
      nowRow: document.querySelectorAll('#leapChart .leap-row-now').length,
      storms: document.querySelectorAll('#leapChart .leap-mark-storm').length,
      suns: document.querySelectorAll('#leapChart .leap-mark-sun').length,
      hatch: document.querySelectorAll('#leapChart .leap-band-hatch').length,
      nums: document.querySelectorAll('#leapChart .leap-num').length,
      say: document.getElementById('leapSay').textContent,
      legend: document.getElementById('leapLegend').hidden,
      width: document.querySelector('#leapChart .leap-track').getBoundingClientRect().width
    }));
    ok('the dots menu opens the leaps screen', shown.screen === false, shown);
    ok('the chart shows', shown.panel === false, shown);
    ok('no empty-state note', shown.noDob === true, shown);
    ok('all twelve rows at once', shown.rows === 12, shown);
    ok('today is marked once', shown.here === 1, shown);
    ok('exactly one row is named as now', shown.nowRow === 1, shown);
    ok('ten storm markers', shown.storms === 10, shown);
    ok('ten sun markers', shown.suns === 10, shown);
    ok('the 29-week hatch is drawn', shown.hatch >= 1, shown);
    ok('sentence names the age', /5 weeks 6 days today/.test(shown.say), shown.say);
    ok('sentence names the band end', /19 September/.test(shown.say), shown.say);
    ok('legend is always there now', shown.legend === false, shown);
    ok('the strip fits the phone', shown.width > 240 && shown.width < 340, shown.width);
    ok('week numbers do not crowd', shown.nums >= 48 && shown.nums <= 60, shown.nums);
    ok('no expand button is left', await page.locator('#leapExpand').count() === 0);
    ok('the diary no longer carries it', await page.evaluate(() =>
      document.getElementById('screenPlan').contains(document.getElementById('leapPanel'))) === false);
    ok('screen clean console', errs.length === 0, errs);
    await ctx.close();
  }

  // ---------- 4b. the empty states ----------
  {
    const { ctx, page } = await at(41, { noDob: true });
    await openLeaps(page);
    const r = await page.evaluate(() => ({
      panel: document.getElementById('leapPanel').hidden,
      note: document.getElementById('leapNoDob').hidden,
      unset: document.getElementById('leapUnset').hidden,
      past: document.getElementById('leapPast').hidden
    }));
    ok('no dob: chart hidden, note shown', r.panel === true && r.note === false, r);
    ok('no dob: it is the "set a date" note', r.unset === false && r.past === true, r);
    await ctx.close();
  }
  {
    const { ctx, page } = await at(600);
    await openLeaps(page);
    const r = await page.evaluate(() => ({
      panel: document.getElementById('leapPanel').hidden,
      unset: document.getElementById('leapUnset').hidden,
      past: document.getElementById('leapPast').hidden
    }));
    ok('past 84 weeks: chart hidden', r.panel === true, r);
    ok('past 84 weeks: it says so', r.past === false && r.unset === true, r);
    await ctx.close();
  }

  // ---------- 4c. a week sitting exactly on a row edge ----------
  {
    // day 49 is exactly week 7 — the boundary between row 0 and row 1
    const { ctx, page } = await at(49);
    await openLeaps(page);
    const r = await page.evaluate(() => ({
      here: document.querySelectorAll('#leapChart .leap-here').length,
      nowRow: document.querySelectorAll('#leapChart .leap-row-now').length
    }));
    ok('a week on a row edge is marked once, not twice', r.here === 1 && r.nowRow === 1, r);
    await ctx.close();
  }

  // ---------- 5. the band the baby is in, row by row ----------
  {
    const { ctx, page } = await at(41);
    await openLeaps(page);
    const perRow = await page.evaluate(() =>
      [].map.call(document.querySelectorAll('#leapChart .leap-row'),
        r => r.querySelectorAll('.leap-band').length));
    // rows 0..11 = weeks 0-7, 7-14, 14-21, 21-28, 28-35, 35-42, 42-49,
    // 49-56, 56-63, 63-70, 70-77, 77-84
    ok('bands per row', JSON.stringify(perRow) === JSON.stringify([1, 2, 1, 1, 2, 1, 1, 1, 1, 1, 1, 0]), perRow);
    await ctx.close();
  }

  // ---------- 6. the sentence when nothing is due ----------
  {
    const { ctx, page } = await at(50);
    await openLeaps(page);
    const say = await page.evaluate(() => document.getElementById('leapSay').textContent);
    ok('quiet weeks name the next band', /Nothing due\. The 8-week leap starts about 3 October/.test(say), say);
    await ctx.close();
  }

  // ---------- 7. tapping the banner opens the leaps screen ----------
  {
    const { ctx, page } = await at(41);
    await page.click('#leapBanner');
    await page.waitForTimeout(250);
    const r = await page.evaluate(() => ({
      leaps: document.getElementById('screenLeaps').hidden,
      plan: document.getElementById('screenPlan').hidden,
      main: document.getElementById('screenMain').hidden
    }));
    ok('the line opens the leaps screen, not the diary', r.leaps === false && r.main === true && r.plan === true, r);
    await page.click('#leapBack');
    await page.waitForTimeout(200);
    ok('back returns to the main screen',
      await page.evaluate(() => document.getElementById('screenMain').hidden) === false);
    await ctx.close();
  }

  // ---------- 8. nothing was written to storage ----------
  {
    const { ctx, page } = await at(41);
    await openLeaps(page);
    const keys = await page.evaluate(() => Object.keys(localStorage).sort());
    ok('leaps store nothing', keys.filter(k => /leap/i.test(k)).length === 0, keys);
    ok('only the dob is there', JSON.stringify(keys) === JSON.stringify(['baby-tracker-dob']), keys);
    await ctx.close();
  }

  await b.close();
  t.done();
})();
