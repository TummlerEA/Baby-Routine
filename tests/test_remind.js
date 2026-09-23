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
  ok('and it is silent', await page.textContent('#noiseFabIcon') === '\uD83C\uDF9B');

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

  ok('nothing threw along the way', errs.length === 0, errs);

  await b.close();
  t.done();
})();
