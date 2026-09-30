"use strict";

// Crying heard in the nursery. The listening is done by the phone left in
// there, with its own Sound Recognition, and all it does is drop a "cry" file
// into the voice queue. What is checked here is the other end: that every
// phone which syncs hears it once, says so without saying it too often, never
// turns it into an entry, and clears it out only when it is old news.

const h = require('./helpers');
const t = h.tally();
const ok = t.ok;
const APP = h.APP;

(async () => {
  const b = await h.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 950 }, timezoneId: 'UTC' });
  await ctx.clock.install({ time: new Date('2026-09-30T01:00:00Z') });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('ERR ' + e.message));
  page.setDefaultTimeout(10000);

  // A phone that shows notifications, and a GitHub that holds nothing but a
  // voice queue this script fills by hand.
  await page.addInitScript(() => {
    window.__sent = [];
    window.__queue = JSON.parse(sessionStorage.getItem('__queue') || '[]');
    window.__deleted = [];
    window.__polls = 0;
    let away = false;
    Object.defineProperty(document, 'hidden', { get: () => away });
    window.__screen = off => { away = off; document.dispatchEvent(new Event('visibilitychange')); };
    window.Notification = function () {};
    window.Notification.permission = 'granted';
    window.Notification.requestPermission = () => Promise.resolve('granted');
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      get: () => ({ ready: Promise.resolve({
        showNotification: (title, opts) => { window.__sent.push({ title, body: opts.body }); }
      }) })
    });
    const reply = (status, body) => Promise.resolve(new Response(JSON.stringify(body), { status }));
    const real = window.fetch;
    window.fetch = (url, opts) => {
      url = String(url);
      if (url.indexOf('api.github.com') === -1) return real(url, opts);
      const method = (opts && opts.method) || 'GET';
      if (/\/contents\/voice-queue\?/.test(url)) {
        window.__polls++;
        return reply(200, window.__queue.map(name => ({ type: 'file', name, sha: 'sha-' + name })));
      }
      if (/\/contents\/voice-queue\//.test(url) && method === 'DELETE') {
        const name = decodeURIComponent(url.split('/voice-queue/')[1]);
        window.__deleted.push(name);
        window.__queue = window.__queue.filter(n => n !== name);
        return reply(200, {});
      }
      if (method === 'PUT') return reply(200, { content: { sha: 'doc-sha' } });
      return reply(404, {});
    };
  });

  const stamp = (msAgo) => page.evaluate(ago => {
    const d = new Date(Date.now() - ago);
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  }, msAgo);
  let n = 0;
  const cryFile = async (minsAgo, noTime) => {
    n++;
    const name = noTime ? 'cry__c' + n + '.json' : 'cry__c' + n + '__' + (await stamp(minsAgo * 60000)) + '.json';
    await page.evaluate(nm => window.__queue.push(nm), name);
    return name;
  };
  const sync = async () => {
    await page.evaluate(() => document.getElementById('syncNow').click());
    await page.waitForTimeout(500);
  };
  const sent = () => page.evaluate(() => window.__sent);
  const banner = () => page.evaluate(() => ({
    hidden: document.getElementById('cryBanner').hidden,
    line: document.getElementById('cryLine').textContent,
    sub: document.getElementById('crySub').textContent
  }));
  const clock = (minsAgo) => page.evaluate(ago => {
    const d = new Date(Date.now() - ago * 60000);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }, minsAgo);
  const entries = () => page.evaluate(() =>
    JSON.parse(localStorage.getItem('baby-tracker-events') || '[]').length);

  await page.goto(APP);
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('baby-tracker-sync', JSON.stringify({ repo: 'us/log', token: 'x', sha: null }));
  });
  await page.goto(APP);
  await page.waitForTimeout(800);

  // ---------- the switch, and what it says it needs ----------

  await page.click('#moreOpen');
  await page.waitForTimeout(150);
  await page.click('#noiseOpen');
  await page.waitForTimeout(250);
  ok('off to begin with', !(await page.isChecked('#cryOn')));
  ok('and says nothing while off', await page.isHidden('#cryState'));
  await page.check('#cryOn');
  await page.waitForTimeout(300);
  let line = await page.textContent('#cryState');
  ok('on, with nothing playing, it says it only hears with the screen on',
    /Ready while the screen is on/.test(line), line);
  await page.click('#noisePlay');
  await page.waitForTimeout(700);
  line = await page.textContent('#cryState');
  ok('with something playing it says it is ready',
    /^Ready\. This phone checks every minute/.test(line), line);
  await page.click('#noisePlay');
  await page.waitForTimeout(300);
  await page.click('#noiseBack');
  await page.waitForTimeout(200);

  // ---------- heard ----------

  const before = await entries();
  const first = await cryFile(1);
  const heardAt = await clock(1);
  await sync();
  let out = await sent();
  ok('a cry in the queue puts a notification up', out.length === 1, out);
  ok('saying what it is', out[0] && out[0].title === 'Crying in the nursery', out);
  ok('and when it was heard', out[0] && out[0].body === 'Heard at ' + heardAt, out);
  let bn = await banner();
  ok('and the main screen says it too',
    !bn.hidden && bn.line === 'Crying heard at ' + heardAt, bn);
  ok('it is not an entry in the log', (await entries()) === before);
  ok('and it is left in the queue for the other phones',
    !(await page.evaluate(() => window.__deleted)).includes(first));

  await sync();
  ok('heard once, not once a sync', (await sent()).length === 1, await sent());

  // Crying goes on: the nursery phone fires again a minute later.
  await ctx.clock.runFor('01:00');
  await cryFile(0);
  await sync();
  ok('still crying a minute later does not buzz again', (await sent()).length === 1, await sent());
  bn = await banner();
  ok('but the count goes up', bn.sub === '2 times since ' + (await clock(2)), bn);

  await ctx.clock.runFor('03:00');
  await cryFile(0);
  await sync();
  out = await sent();
  ok('three minutes on, it buzzes again', out.length === 2, out);
  ok('and says how long it has gone on',
    out[1] && /^Heard 3 times since \d\d:\d\d, last at \d\d:\d\d$/.test(out[1].body), out);
  ok('without the name on a lock screen',
    !/Baby/.test(out.map(o => o.title + o.body).join()), out);

  // ---------- a tap puts it away ----------

  await page.click('#cryBanner');
  await page.waitForTimeout(200);
  ok('a tap on the banner puts it away', (await banner()).hidden);

  // ---------- old news ----------

  await ctx.clock.runFor('20:00');
  await cryFile(25);
  await sync();
  ok('a cry already old when first seen is not announced', (await sent()).length === 2, await sent());
  ok('nor put on the main screen', (await banner()).hidden);

  await ctx.clock.runFor('15:00');
  await sync();
  const deleted = await page.evaluate(() => window.__deleted);
  ok('half an hour on, the old files are cleared out', deleted.includes(first), deleted);

  // ---------- a nursery phone that cannot say when ----------

  await cryFile(0, true);
  await sync();
  out = await sent();
  ok('a file with no time in its name is heard as now', out.length === 3, out);
  ok('and starts a new count after a quiet spell', /^Heard at /.test((out[2] || {}).body || ''), out);

  // ---------- off ----------

  await page.click('#moreOpen');
  await page.waitForTimeout(150);
  await page.click('#noiseOpen');
  await page.waitForTimeout(250);
  await page.uncheck('#cryOn');
  await page.click('#noiseBack');
  await page.waitForTimeout(200);
  await ctx.clock.runFor('05:00');
  await cryFile(0);
  await sync();
  ok('switched off, this phone is not notified', (await sent()).length === 3, await sent());
  ok('but the main screen still says it', !(await banner()).hidden);

  // ---------- the queue still does its old job ----------

  await page.evaluate(nm => window.__queue.push(nm), 'feed__f1__' + (await stamp(0)) + '.json');
  const had = await entries();
  await sync();
  ok('a feed in the same queue still becomes an entry', (await entries()) === had + 1);
  ok('and is cleared out at once',
    (await page.evaluate(() => window.__deleted)).some(x => /^feed__f1/.test(x)));

  // ---------- in a pocket ----------

  // With the screen off the app only runs while something plays, and then it
  // polls at half the rate — except while it is listening for the nursery,
  // where the minute is the point.
  const pollsOver = async (mins) => {
    const was = await page.evaluate(() => window.__polls);
    await ctx.clock.runFor(mins);
    await page.waitForTimeout(400);
    return (await page.evaluate(() => window.__polls)) - was;
  };
  await page.click('#noiseFab');
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__screen(true));
  const slow = await pollsOver('10:00');
  await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('baby-tracker-cry'));
    c.on = true;
    localStorage.setItem('baby-tracker-cry', JSON.stringify(c));
  });
  await page.evaluate(() => window.__screen(false));
  await page.reload();
  await page.waitForTimeout(800);
  await page.click('#noiseFab');
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__screen(true));
  const fast = await pollsOver('10:00');
  ok('listening for crying, a phone in a pocket polls twice as often',
    fast >= slow * 2 - 1 && fast > slow, [slow, fast]);

  // ---------- kept to this phone ----------

  await page.evaluate(() => window.__screen(false));
  const backup = await page.evaluate(() => {
    const real = URL.createObjectURL;
    let captured = null;
    URL.createObjectURL = blob => { captured = blob; return 'blob:x'; };
    document.getElementById('exportJson').click();
    URL.createObjectURL = real;
    return captured ? captured.text() : null;
  });
  ok('the backup carries nothing about crying',
    typeof backup === 'string' && backup.indexOf('baby-tracker-cry') === -1 &&
      backup.indexOf('"cry') === -1, backup && backup.slice(0, 200));

  ok('nothing threw', errs.length === 0, errs);
  await b.close();
  t.done();
})();
