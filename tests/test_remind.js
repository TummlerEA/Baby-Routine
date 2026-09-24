"use strict";

// The nudge when the wake window is up. The first thing this app has ever
// done at a particular minute rather than when somebody looked at it, and it
// only works on a knife edge: a phone suspends a page's timers once the
// screen is off, except while that page is playing audio. So the nudge rides
// on the same thing the white noise does, and logging a wake-up starts a
// silent remote to pay for it.
//
// Most of what is checked here is therefore the honesty of one line: whether
// the screen ever says the nudge will arrive when it will not.

const h = require('./helpers');
const t = h.tally();
const ok = t.ok;
const APP = h.APP;

(async () => {
  const b = await h.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 950 }, timezoneId: 'UTC' });
  await ctx.clock.install({ time: new Date('2026-09-24T09:00:00Z') });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('ERR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
  page.setDefaultTimeout(10000);

  // A phone that will show notifications, and a record of what it was asked
  // to show. Both have to be put in place before the app reads them.
  async function standIn(permission) {
    await page.addInitScript(perm => {
      window.__sent = [];
      if (perm === null) {
        try { delete window.Notification; } catch (e) { window.Notification = undefined; }
        return;
      }
      window.Notification = function () {};
      window.Notification.permission = perm;
      window.Notification.requestPermission = () => Promise.resolve(perm);
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        get: () => ({ ready: Promise.resolve({
          showNotification: (title, opts) => { window.__sent.push({ title, body: opts.body }); }
        }) })
      });
    }, permission);
  }

  const state = () => page.evaluate(() => ({
    hidden: document.getElementById('remindState').hidden,
    line: document.getElementById('remindState').textContent,
    ready: document.getElementById('remindState').classList.contains('rm-ready')
  }));
  const sent = () => page.evaluate(() => window.__sent || []);
  const playing = () => page.evaluate(() => !document.getElementById('noisePlayer').paused);
  const openRoutine = async () => {
    if (await page.isVisible('#screenRoutine')) return;
    await page.click('#routineOpen');
    await page.waitForTimeout(250);
  };
  const back = async () => {
    if (await page.isVisible('#screenMain')) return;
    await page.click('#routineBack');
    await page.waitForTimeout(250);
  };
  // The card that opens after a log would sit over the next tap.
  const clearCard = async () => {
    if (await page.isVisible('#nextUpClose')) {
      await page.click('#nextUpClose');
      await page.waitForTimeout(200);
    }
  };

  async function fresh() {
    await page.goto(APP);
    await page.waitForTimeout(300);
    await page.evaluate(() => localStorage.clear());
    await page.goto(APP);
    await page.waitForTimeout(400);
  }

  // ---------- off, and saying nothing ----------

  await standIn('granted');
  await fresh();
  await openRoutine();
  ok('the nudge is off to begin with', !(await page.isChecked('#remindOn')));
  ok('and says nothing while it is off', (await state()).hidden);
  ok('nor offers a warning time', await page.isHidden('#remindLeads'));

  // ---------- the ladder of things that have to be true ----------

  await page.check('#remindOn');
  await page.waitForTimeout(400);
  ok('turned on, it offers four warning times',
    (await page.$$eval('#remindLeads .nz-chip', n => n.map(x => x.dataset.value))).join() === '0,5,10,15');
  ok('five minutes to begin with',
    await page.$eval('#remindLeads .nz-chip.on', n => n.dataset.value) === '5');

  let says = await state();
  ok('with the routine off it says so rather than claiming to be ready',
    /Follow this routine/.test(says.line) && !says.ready, says.line);

  await page.check('#routineEnabled');
  await page.waitForTimeout(400);
  says = await state();
  ok('with nothing playing it says it is waiting, and does not claim ready',
    /Waiting/.test(says.line) && !says.ready, says.line);

  // ---------- a wake-up pays for the clock ----------

  await back();
  await page.click('#btnSleep');
  await page.waitForTimeout(600);
  await clearCard();
  ok('putting her down starts nothing by itself', !(await playing()));

  await page.click('#btnSleep');
  await page.waitForTimeout(900);
  await clearCard();
  ok('but a wake-up starts the silent remote, which is what keeps the clock',
    await playing());
  ok('and it is silent', await page.textContent('#noiseFabIcon') === '\uD83D\uDCAC');

  // The remote was borrowed, not chosen: the sound this phone prefers is
  // untouched, and comes back the moment it is played on purpose.
  const pref = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('baby-tracker-noise') || '{}').sound);
  ok('without changing which sound this phone prefers', pref !== 'remote', pref);

  await openRoutine();
  says = await state();
  ok('now it says it is ready, and names the minute',
    says.ready && /nudged at \d\d:\d\d/.test(says.line), says.line);

  // ---------- and it arrives ----------

  let fired = null;
  for (let i = 0; i < 8; i++) {
    await ctx.clock.runFor('20:00');
    await page.waitForTimeout(250);
    const out = await sent();
    if (out.length) { fired = out; break; }
  }
  ok('the nudge arrives', fired && fired.length === 1, fired);
  ok('and says what it is for', fired && fired[0].title === 'Time for a nap', fired);
  ok('and how long she has been up', fired && /Awake \d/.test(fired[0].body), fired);
  ok('and the name is left out of it, because a lock screen is not private',
    fired && !/Baby/.test(fired[0].body + fired[0].title), fired);

  await ctx.clock.runFor('40:00');
  await page.waitForTimeout(300);
  ok('and it does not go on arriving', (await sent()).length === 1, await sent());

  // ---------- putting her down ends the window ----------

  await back();
  await page.click('#btnSleep');
  await page.waitForTimeout(700);
  await clearCard();
  ok('putting her down stops the thing that was only keeping time',
    !(await playing()));

  // ---------- a nudge nobody was there for ----------

  // Opening the app at teatime must not fire a notification about a nap that
  // was due at eleven.
  await fresh();
  await page.evaluate(() => {
    localStorage.setItem('baby-tracker-remind', '{"on":true,"lead":5,"done":0}');
    const routine = JSON.parse(localStorage.getItem('baby-tracker-routine') || '{}');
    routine.on = true;
    localStorage.setItem('baby-tracker-routine', JSON.stringify(routine));
  });
  await page.goto(APP);
  await page.waitForTimeout(400);
  await page.click('#btnSleep');
  await page.waitForTimeout(500);
  await clearCard();
  await page.click('#btnSleep');
  await page.waitForTimeout(800);
  await clearCard();
  // fastForward rather than runFor: runFor replays every tick in between, so
  // the app would live through the moment and be right to speak. This is the
  // phone asleep and waking up six hours later with the moment long gone.
  await ctx.clock.fastForward('06:00:00');
  await page.waitForTimeout(600);
  ok('a moment six hours gone is not announced', (await sent()).length === 0, await sent());

  // ---------- what a phone that cannot notify is told ----------

  await standIn(null);
  await fresh();
  await openRoutine();
  await page.check('#routineEnabled');
  await page.check('#remindOn');
  await page.waitForTimeout(400);
  says = await state();
  ok('a browser with no notifications says so instead of failing quietly',
    /Home Screen|cannot show notifications/.test(says.line) && !says.ready, says.line);

  // Refused permission cannot be asked for again from a web page — it is a
  // trip to iOS Settings — so the switch goes back off rather than sitting
  // there on and doing nothing.
  await standIn('denied');
  await fresh();
  await openRoutine();
  await page.check('#routineEnabled');
  await page.click('#remindOn');
  await page.waitForTimeout(600);
  ok('a refusal puts the switch back rather than leaving it on and useless',
    !(await page.isChecked('#remindOn')));
  ok('and says why', /not allowed/i.test(await page.textContent('#errorText')),
    await page.textContent('#errorText'));

  // Granted once and then taken away in iOS Settings: the switch is still on,
  // and the line has to admit the nudge will not come.
  await standIn('denied');
  await page.goto(APP);
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    localStorage.setItem('baby-tracker-remind', '{"on":true,"lead":5,"done":0}');
  });
  await page.goto(APP);
  await page.waitForTimeout(400);
  await openRoutine();
  says = await state();
  ok('permission taken away later is admitted to',
    /not allowed/.test(says.line) && !says.ready, says.line);

  // ---------- what is remembered ----------

  await standIn('granted');
  await fresh();
  await openRoutine();
  await page.check('#routineEnabled');
  await page.check('#remindOn');
  await page.waitForTimeout(300);
  await page.click('#remindLeads .nz-chip[data-value="15"]');
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForTimeout(500);
  await openRoutine();
  ok('the switch survives a reload', await page.isChecked('#remindOn'));
  ok('and so does the warning time',
    await page.$eval('#remindLeads .nz-chip.on', n => n.dataset.value) === '15');

  // Whether this phone is the one that gets nudged is its own business.
  await page.click('#routineBack');
  await page.waitForTimeout(250);
  await page.click('#btnFeed');
  await page.waitForTimeout(400);
  await clearCard();
  const backup = await page.evaluate(() => {
    const el = document.getElementById('exportJson');
    let captured = null;
    const real = URL.createObjectURL;
    URL.createObjectURL = blob => { captured = blob; return real.call(URL, blob); };
    el.click();
    URL.createObjectURL = real;
    return captured ? captured.text() : null;
  });
  ok('a backup was produced', typeof backup === 'string' && backup.length > 2);
  ok('and carries nothing about being nudged',
    typeof backup === 'string' && backup.indexOf('remind') === -1);

  await page.evaluate(() => localStorage.setItem('baby-tracker-remind', 'rubbish'));
  await page.reload();
  await page.waitForTimeout(500);
  await openRoutine();
  ok('rubbish in its place leaves the nudge off rather than breaking the screen',
    !(await page.isChecked('#remindOn')));

  // ---------- the other phone's wake-up ----------

  // The nudge is for whoever is not looking at their phone, so the phone that
  // did not log the wake-up has to hear about it. Polling used to stop dead
  // with the screen off; now it goes on at half the rate, and only while
  // something is playing — which is both when the timers run at all and the
  // sign this phone meant to be on duty.
  await page.addInitScript(() => {
    window.__polls = 0;
    let away = false;
    Object.defineProperty(document, 'hidden', { get: () => away });
    window.__screen = off => {
      away = off;
      document.dispatchEvent(new Event('visibilitychange'));
    };
    const real = window.fetch;
    window.fetch = (...args) => {
      if (String(args[0]).indexOf('api.github.com') !== -1) {
        window.__polls++;
        return Promise.reject(new Error('no network in these checks'));
      }
      return real(...args);
    };
  });
  await standIn('granted');
  await fresh();
  await page.evaluate(() => localStorage.setItem('baby-tracker-sync',
    JSON.stringify({ repo: 'someone/log', token: 'x', sha: null })));
  await page.goto(APP);
  await page.waitForTimeout(600);

  const polls = () => page.evaluate(() => window.__polls);
  const pollsOver = async (minutes) => {
    const before = await polls();
    await ctx.clock.runFor(minutes);
    await page.waitForTimeout(500);
    return (await polls()) - before;
  };

  await page.evaluate(() => window.__screen(true));
  ok('with the screen off and nothing playing it does not poll at all',
    (await pollsOver('10:00')) === 0);

  await page.evaluate(() => window.__screen(false));
  await page.waitForTimeout(300);
  const lit = await pollsOver('10:00');
  ok('with the screen on it polls every minute', lit > 0, lit);

  await openRoutine();
  await page.click('#routineBack');
  await page.waitForTimeout(200);
  await page.click('#moreOpen');
  await page.waitForTimeout(150);
  await page.click('#noiseOpen');
  await page.waitForTimeout(250);
  await page.click('#noiseSounds .nz-chip[data-value="standby"]');
  await page.click('#noiseTimers .nz-chip[data-value="0"]');
  await page.waitForTimeout(150);
  await page.click('#noisePlay');
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.__screen(true));
  await page.waitForTimeout(200);
  const dim = await pollsOver('10:00');
  ok('with the screen off but something playing it polls again', dim > 0, dim);
  ok('and at half the rate it would lit', Math.abs(dim * 2 - lit) <= 2, [dim, lit]);

  // ---------- going on duty ----------

  await page.evaluate(() => window.__screen(false));
  await page.waitForTimeout(300);
  await page.click('#noiseFab');
  await page.waitForTimeout(400);
  ok('nothing is playing to begin with', !(await playing()));

  await standIn('granted');
  await fresh();
  await openRoutine();
  await page.check('#routineEnabled');
  await page.check('#remindOn');
  await page.waitForTimeout(400);
  ok('while it is waiting there is a way to start the clock by hand',
    await page.isVisible('#remindStart'));
  await page.click('#remindStart');
  await page.waitForTimeout(1000);
  ok('one tap starts the silent remote', await playing());
  ok('and it really is the silent one',
    await page.textContent('#noiseFabIcon') === '\uD83D\uDCAC');
  ok('the offer goes once it is running', await page.isHidden('#remindStart'));
  ok('and the line says it is ready now',
    (await state()).ready, (await state()).line);

  // ---------- the table may put the nap off, never bring it forward ----------

  // Within half an hour either way the screen quotes the routine's own hour
  // rather than the stretch awake, so a household hears the same times every
  // day. Fired as a notification that was plainly wrong: a phone announcing a
  // nap to somebody holding a baby who had been up forty minutes of an hour.
  // The nudge now waits for the later of the two.
  //
  // Everything here is built around the clock as it stands rather than
  // written in local hours, so the same arithmetic holds in any timezone.
  async function stage(plan) {
    await fresh();
    const marks = await page.evaluate(p => {
      const now = Date.now();
      const pad = n => String(n).padStart(2, '0');
      const clock = m => {
        const d = new Date(now + m * 60000);
        return pad(d.getHours()) + ':' + pad(d.getMinutes());
      };
      localStorage.setItem('baby-tracker-remind',
        JSON.stringify({ on: true, lead: 5, done: 0 }));
      // Naps an hour long and an hour apart, so every gap in the table is
      // the same hour and "the next sleep" is always a real one. A table
      // with a single nap in it is not a routine, and the app would measure
      // the window against tomorrow morning.
      const slots = [];
      for (let k = -2; k <= 2; k++) {
        const at = p.planned + k * 120;
        slots.push({ time: clock(at), until: clock(at + 60), kind: 'sleep' });
      }
      localStorage.setItem('baby-tracker-routine', JSON.stringify({ on: true, slots: slots }));
      localStorage.setItem('baby-tracker-events', JSON.stringify([
        { id: 'd1', type: 'sleep_start', time: new Date(now - 90 * 60000).toISOString() },
        { id: 'w1', type: 'sleep_end', time: new Date(now).toISOString() }
      ]));
      // The clock times these checks expect, worked out before anything is
      // wound on — afterwards "now" is a different minute.
      const marks = {};
      [35, 55, 60, 75, 80].forEach(m => { marks[m] = clock(m); });
      return marks;
    }, plan);
    await page.reload();
    await page.waitForTimeout(500);
    await openRoutine();
    // The line only names a minute once something is playing to keep time by.
    if (await page.isVisible('#remindStart')) {
      await page.click('#remindStart');
      await page.waitForTimeout(1000);
    }
    return marks;
  }

  // The window runs to +60. The table wants the nap at +40, which is inside
  // the half hour the screen is allowed to round by — this is the case from
  // the lock screen that started it.
  let mark = await stage({ planned: 40 });
  says = await state();
  ok('the nudge is named for the end of the window, not the table\'s hour',
    says.line.indexOf(mark[55]) !== -1, [says.line, mark[55], mark[35]]);

  await ctx.clock.runFor('45:00');
  await page.waitForTimeout(300);
  ok('and nothing arrives while the baby is still inside her window',
    (await sent()).length === 0, await sent());

  await ctx.clock.runFor('15:00');
  await page.waitForTimeout(300);
  let late = await sent();
  ok('it arrives once the window is up', late.length === 1, late);
  ok('and names the end of the window rather than the hour in the table',
    late.length === 1 && late[0].body.indexOf('due at ' + mark[60]) !== -1,
    [late, mark[60]]);
  ok('five minutes early, which is the warning that was asked for',
    late.length === 1 && /Awake 55m/.test(late[0].body), late);

  // The other direction is left alone: a baby who woke early is held to the
  // table, because pulling a day back onto its hours is what a routine is
  // for. The window is up at +60 and the table does not want her down until
  // +80.
  mark = await stage({ planned: 80 });
  says = await state();
  ok('a nap the table puts off is still nudged at the table\'s hour',
    says.line.indexOf(mark[75]) !== -1, [says.line, mark[75], mark[55]]);

  await ctx.clock.runFor('01:05:00');
  await page.waitForTimeout(300);
  ok('so the end of the window on its own does not fire it',
    (await sent()).length === 0, await sent());

  await ctx.clock.runFor('11:00');
  await page.waitForTimeout(300);
  late = await sent();
  ok('and it arrives at the hour the routine asked for', late.length === 1, late);
  ok('naming that hour, not the minute the window ran out',
    late.length === 1 && late[0].body.indexOf('due at ' + mark[80]) !== -1,
    [late, mark[80], mark[60]]);

  // And once that hour goes by, the app stops holding the day to it and
  // measures from the stretch awake again — which moves the minute the nudge
  // was for backwards. A minute already nudged for is not nudged for twice.
  await ctx.clock.runFor('20:00');
  await page.waitForTimeout(300);
  ok('the same window is not nudged for a second time as the hour passes',
    (await sent()).length === 1, await sent());

  ok('nothing threw along the way', errs.length === 0, errs);

  await b.close();
  t.done();
})();
