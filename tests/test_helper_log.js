"use strict";

// The helper writing to the log when told what happened, and answering about
// a stretch other than the last 24 hours — yesterday, last night, the week —
// against what is usual, with short follow-ups that carry the subject or the
// stretch over from the answer before.

const h = require('./helpers');
const t = h.tally();
const ok = t.ok;

// Four in the afternoon, today, wherever the run is: "last night" is then
// over, "by this time of day" has a morning behind it, and the answers do not
// change with the hour the checks happen to run at.
const FIXED = (() => { const d = new Date(); d.setHours(16, 0, 0, 0); return d; })();

(async () => {
  const b = await h.launch();
  const errs = [];

  // weeks: how many days of a steady routine to seed before today.
  async function open(weeks) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 900 } });
    await ctx.clock.setFixedTime(FIXED);
    await ctx.addInitScript((days) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      const now = Date.now();
      const H = 3600e3;
      const ev = [];
      const add = (type, time, extra) => ev.push(Object.assign({ id: 'e' + ev.length, type,
        time: new Date(time).toISOString(), updatedAt: new Date(now).toISOString() }, extra || {}));
      for (let d = 0; d < days; d++) {
        const midnight = new Date(now - d * 24 * H);
        midnight.setHours(0, 0, 0, 0);
        // Eight feeds and eight wet nappies a day, three hours apart from 01:00.
        for (let i = 0; i < 8; i++) {
          add('feed', +midnight + (1 + i * 3) * H, { fedMin: 15 });
          add('diaper', +midnight + (1.2 + i * 3) * H, { nappy: 'wet' });
        }
        // Down at 21:00 the evening before until 04:00, a nap 13:00 to 15:00.
        add('sleep_start', +midnight - 3 * H); add('sleep_end', +midnight + 4 * H);
        add('sleep_start', +midnight + 13 * H); add('sleep_end', +midnight + 15 * H);
      }
      localStorage.setItem('baby-tracker-events', JSON.stringify(ev.filter(e => +new Date(e.time) < now - 60e3)));
    }, weeks);
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push('ERR ' + e.message));
    await page.goto(h.APP);
    await page.waitForTimeout(400);
    await page.click('#helperOpen');
    await page.waitForTimeout(200);
    return { ctx, page };
  }

  async function say(page, q) {
    await page.fill('#helperInput', q);
    await page.press('#helperInput', 'Enter');
    await page.waitForTimeout(40);
    return page.evaluate(() => {
      const last = [...document.querySelectorAll('.helper-bot')].pop();
      return { topic: last.getAttribute('data-topic'), window: last.getAttribute('data-window'),
        text: last.textContent };
    });
  }

  const stored = (page) => page.evaluate(() =>
    JSON.parse(localStorage.getItem('baby-tracker-events') || '[]').filter(e => !e.deleted));
  const newest = async (page) => (await stored(page)).sort((a, c) => new Date(c.time) - new Date(a.time));
  const tap = (page, label) => page.click('.helper-bot:last-child .helper-action >> text=' + label);

  let { ctx, page } = await open(9);

  // ---- telling it what happened ----
  const before = (await stored(page)).length;
  const fresh = async (page, had) => (await stored(page)).filter(e => had.indexOf(e.id) < 0);
  let had = (await stored(page)).map(e => e.id);
  let a = await say(page, 'покормила левой 15 минут 10 минут назад');
  ok('a feed said is offered for logging', a.topic === 'log', a);
  ok('read back: the side and the length', /левая грудь, 15 мин/.test(a.text), a.text);
  ok('and when', /10 мин назад/.test(a.text), a.text);
  ok('nothing is written before it is confirmed', (await stored(page)).length === before);
  await tap(page, '✓ Записать');
  await page.waitForTimeout(150);
  let added = await fresh(page, had);
  let feed = added[0];
  ok('a tap writes one entry', added.length === 1, added);
  ok('the feed it was told', feed && feed.side === 'L' && feed.fedMin === 15 && feed.fedWith === 'breast', feed);
  ok('at the time it was told', feed && Math.abs(+FIXED - 10 * 60e3 - +new Date(feed.time)) < 90e3, feed && feed.time);
  ok('and says so, with an undo', /Записано/.test(await page.textContent('.helper-bot:last-child')));
  await tap(page, 'Отменить');
  await page.waitForTimeout(150);
  ok('undo takes it back out', (await stored(page)).length === before);
  ok('and says nothing was logged', /Отменено/.test(await page.textContent('.helper-bot:last-child')));

  a = await say(page, 'поменяла подгузник, покакал');
  await tap(page, 'Не то');
  await page.waitForTimeout(100);
  ok('"not that" writes nothing', (await stored(page)).length === before);

  a = await say(page, 'поменяла подгузник, покакал');
  ok('a nappy with what was in it', /Подгузник — покакал/.test(a.text), a.text);
  await tap(page, '✓ Записать');
  await page.waitForTimeout(150);
  ok('written as a dirty nappy', (await newest(page))[0].nappy === 'dirty', (await newest(page))[0]);

  const hm = await page.evaluate(() => {
    const d = new Date(Date.now() - 65 * 60e3);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  });
  a = await say(page, 'fed on the right with formula 90 ml at ' + hm);
  ok('in English too', /Feed — right side, 90 ml/.test(a.text), a.text);
  await tap(page, '✓ Log it');
  await page.waitForTimeout(150);
  feed = (await stored(page)).filter(e => e.type === 'feed' && e.fedMl === 90)[0];
  ok('a clock time is today\'s', feed && Math.abs(+FIXED - 65 * 60e3 - +new Date(feed.time)) < 61e3, feed && feed.time);

  a = await say(page, 'проснулся, поменяла подгузник и покормила');
  ok('three at once, read back in order',
    /Проснулся.*Подгузник.*Кормление/.test(a.text), a.text);
  ok('a wake-up with no sleep under way is warned about', /не будет пары/.test(a.text), a.text);
  had = (await stored(page)).map(e => e.id);
  await tap(page, '✓ Записать');
  await page.waitForTimeout(150);
  const three = (await newest(page)).filter(e => had.indexOf(e.id) < 0);
  ok('all three written', three.length === 3);
  ok('five minutes apart, ending now', three[0].type === 'feed' && three[1].type === 'diaper' &&
    three[2].type === 'sleep_end' &&
    Math.round((new Date(three[0].time) - new Date(three[2].time)) / 60e3) === 10, three.map(e => e.type + ' ' + e.time));

  a = await say(page, 'уснула');
  await tap(page, '✓ Записать');
  await page.waitForTimeout(150);
  await page.click('#helperBack');
  await page.waitForTimeout(150);
  ok('a sleep said is a sleep under way on the main screen', /Wake/i.test(await page.textContent('#sleepLabel')),
    await page.textContent('#sleepLabel'));
  await page.click('#helperOpen');
  await page.waitForTimeout(150);
  a = await say(page, 'уснул');
  ok('a second "asleep" in a row is warned about', /уже идёт/.test(a.text), a.text);
  await tap(page, 'Не то');

  // ---- what is a question, not a log ----
  for (const [q, want] of [['когда покормила', 'feed'], ['как записать кормление', 'log-feed'],
    ['забыла записать кормление', 'backdate'], ['is the baby asleep', 'sleep'],
    ['woke nappy feed button', 'combo'], ['сколько спал', 'sleep']]) {
    a = await say(page, q);
    ok('"' + q + '" is asked, not logged', a.topic === want, a.topic);
  }

  // ---- other stretches, against what is usual ----
  a = await say(page, 'сколько спал вчера');
  ok('yesterday is yesterday', a.window === 'yesterday' && /Вчера/.test(a.text), a);
  ok('set against a usual day', /В обычный день — около 9 ч/.test(a.text), a.text);
  ok('with nothing due, since yesterday is over', !/Дальше по плану/.test(a.text), a.text);
  a = await say(page, 'а подгузники?');
  ok('"а подгузники?" keeps yesterday', a.topic === 'nappy' && a.window === 'yesterday', a);
  ok('counted', /8 подгузников/.test(a.text) && /около 8/.test(a.text), a.text);
  a = await say(page, 'а за неделю?');
  ok('"а за неделю?" keeps the nappies', a.topic === 'nappy' && a.window === 'week', a);
  ok('a week gives a daily average', /В среднем 8 в день/.test(a.text), a.text);
  a = await say(page, 'когда покормила');
  ok('a whole new question starts afresh', a.topic === 'feed' && a.window === 'day', a);
  a = await say(page, 'а вчера?');
  ok('"а вчера?" keeps the feeds', a.topic === 'feed' && a.window === 'yesterday', a);
  a = await say(page, 'how many feeds today');
  ok('today is since midnight, against this time of day', a.window === 'today' &&
    /By this time of day it's usually about/.test(a.text), a.text);
  a = await say(page, 'how much sleep last night');
  ok('last night is the night', a.window === 'night' && /night/i.test(a.text), a.text);
  ok('against a usual night', /On a usual night — about 7h/.test(a.text), a.text);
  a = await say(page, 'and nappies?');
  ok('"and nappies?" keeps the night', a.topic === 'nappy' && a.window === 'night', a);
  await ctx.close();

  // ---- too new a log to say what's usual ----
  ({ ctx, page } = await open(2));
  a = await say(page, 'сколько кормлений вчера');
  ok('two days are too few for "usual"', a.window === 'yesterday' && !/обычн/i.test(a.text), a.text);
  await ctx.close();

  ok('no page errors', errs.length === 0, errs);
  await b.close();
  t.done();
})().catch(e => { console.error(e); process.exit(1); });
