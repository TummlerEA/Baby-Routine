"use strict";

// The helper. Nothing in it is generated, so what is checked is the picking:
// a question in either language lands on the right written answer or on the
// log's own figures, the button under it goes where it says, and a question
// it cannot place is handed on rather than guessed at. Also that versions
// 110 to 113's downloaded model is cleared away.

const h = require('./helpers');
const t = h.tally();
const ok = t.ok;

// A question and the topic it must land on.
const QUESTIONS = [
  ['When was the last feed?', 'feed'], ['Когда было последнее кормление?', 'feed'],
  ['когда она ела', 'feed'], ['сколько раз кормили сегодня', 'feed'],
  ['how many nappies today', 'nappy'], ['сколько подгузников сегодня', 'nappy'],
  ['когда последний раз какал', 'nappy'],
  ['How much sleep today?', 'sleep'], ['Сколько спал сегодня?', 'sleep'],
  ['сколько спала ночью', 'sleep'], ['is the baby asleep', 'sleep'],
  ["What's next?", 'next'], ['Что дальше?', 'next'],
  ['how is today going', 'today'], ['сводка за день', 'today'],
  ['how old is the baby', 'age'], ['сколько недель малышу', 'age'], ['какой вес', 'weight'],
  ['How do I turn on white noise?', 'noise'], ['Как включить белый шум?', 'noise'], ['где шум', 'noise'],
  ['How do I share with my partner?', 'share'], ['Как поделиться с партнёром?', 'share'],
  ['как отправить мужу записи', 'share'],
  ['how do I log a feed', 'log-feed'], ['как записать кормление', 'log-feed'],
  ['как отметить подгузник', 'log-nappy'],
  ['I forgot to log a feed earlier', 'backdate'], ['забыла записать кормление', 'backdate'],
  ['как удалить запись', 'edit'], ['ошиблась, как исправить', 'edit'],
  ['backup', 'backup'], ['как сделать резервную копию', 'backup'],
  ['sync two phones', 'sync'], ['синхронизация с github', 'sync'],
  ['where are statistics', 'stats'], ['где графики', 'stats'],
  ['daily routine', 'routine'], ['режим дня', 'routine'], ['напоминание', 'remind'],
  ['shopping list', 'shop'], ['список покупок', 'shop'], ['дневник', 'diary'],
  ['молоко в морозилке', 'milk'], ['скачки развития', 'leaps'],
  ['appointment with GP', 'plan'], ['прививки', 'plan'],
  ['handover to nanny', 'handover'], ['передать бабушке', 'handover'], ['график няни', 'rota'],
  ['change interval between feeds', 'intervals'], ['как поменять интервал кормления', 'intervals'],
  ['when does night start', 'night'], ['how to add to home screen', 'install'],
  ['как обновить приложение', 'update'], ['русский язык', 'language'],
  ['baby is not breathing', 'urgent'], ['у малыша жар', 'urgent'],
  ['change baby name', 'baby'], ['как поменять имя', 'baby'],
  ['add weight', 'measure'], ['как записать температуру', 'measure'],
  ['what is the weather', 'none'], ['расскажи анекдот', 'none'],
  ['ask chatgpt', 'ai'], ['как спросить нейросеть', 'ai'],
  ['woke nappy feed button', 'combo'], ['help', 'help'],
  ['Is it normal that she cries every evening?', 'health'], ['почему он так часто плачет', 'health'],
  ['is the baby feeding enough', 'health']
];

(async () => {
  const b = await h.launch();
  const errs = [];
  const away = [];

  async function open(opts) {
    opts = opts || {};
    const ctx = await b.newContext({ viewport: { width: 390, height: 900 } });
    await ctx.addInitScript((o) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      const now = Date.now();
      const H = 3600e3;
      const ev = [];
      const add = (type, ago, extra) => ev.push(Object.assign({ id: 'e' + ev.length, type,
        time: new Date(now - ago).toISOString(), updatedAt: new Date(now).toISOString() }, extra || {}));
      if (!o.empty) {
        for (let i = 0; i < 7; i++) add('feed', (1 + i * 3) * H, { fedMinutes: 15 });
        for (let i = 0; i < 6; i++) add('diaper', (1.2 + i * 3.4) * H, { nappy: i % 2 ? 'wet' : 'both' });
        add('sleep_start', 6 * H); add('sleep_end', 4 * H);
        add('weight', 48 * H, { value: 4100 }); add('weight', 2 * H, { value: 4350 });
      }
      localStorage.setItem('baby-tracker-events', JSON.stringify(ev));
      localStorage.setItem('baby-tracker-ai', JSON.stringify({ on: !!o.ai }));
      if (o.legacy) localStorage.setItem('baby-tracker-local-ai', JSON.stringify({ on: true, ready: true }));
    }, opts);
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push('ERR ' + e.message));
    // Nothing the helper does goes anywhere: no request but the app's own files.
    page.on('request', r => { if (!/^file:/.test(r.url())) away.push(r.url()); });
    await page.goto(h.APP);
    await page.waitForTimeout(400);
    return { ctx, page };
  }

  async function ask(page, q) {
    await page.fill('#helperInput', q);
    await page.press('#helperInput', 'Enter');
    await page.waitForTimeout(40);
    return page.evaluate(() => {
      const last = [...document.querySelectorAll('.helper-bot')].pop();
      return { topic: last.getAttribute('data-topic'), text: last.textContent };
    });
  }

  let { ctx, page } = await open();
  ok('a helper button on the main screen', await page.isVisible('#helperOpen'));
  await page.click('#helperOpen');
  await page.waitForTimeout(200);
  ok('opens its own screen', await page.isVisible('#screenHelper'));
  ok('saying hello, and that Russian is fine', /по-русски/.test(await page.textContent('#helperLog')));
  ok('with questions to tap', (await page.$$('#helperChips .ai-chip')).length >= 4);

  // ---- every question lands where it should ----
  const missed = [];
  for (const [q, want] of QUESTIONS) {
    const got = await ask(page, q);
    if (got.topic !== want) missed.push(q + ' → ' + got.topic + ' (wanted ' + want + ')');
  }
  ok('all ' + QUESTIONS.length + ' questions find their answer', missed.length === 0, missed);

  // ---- the log's own figures, in the language asked ----
  let a = await ask(page, 'When was the last feed?');
  ok('feeds are counted from the log', /7 feeds/.test(a.text), a.text);
  ok('with when the next one is due', /Due next/.test(a.text), a.text);
  ok('over a stretch it names', /last 24 hours/.test(a.text), a.text);
  a = await ask(page, 'Когда было последнее кормление?');
  ok('asked in Russian, answered in Russian', /7 кормлений/.test(a.text) && /За последние 24 часа/.test(a.text), a.text);
  ok('though the app itself stays English', await page.evaluate(() => localStorage.getItem('baby-tracker-lang')) !== 'ru');
  a = await ask(page, 'how many nappies today');
  ok('"today" means since midnight', /Since midnight/.test(a.text), a.text);
  a = await ask(page, 'какой вес');
  ok('the latest weight', /4\.35 kg/.test(a.text) && /\+250 g/.test(a.text), a.text);
  a = await ask(page, 'how old is the baby');
  ok('no date of birth is said plainly', /no date of birth/.test(a.text), a.text);
  a = await ask(page, 'When was the last feed?');
  ok('figures offer the matching how-to as well', /Logging a feed/.test(a.text), a.text);

  // ---- the button goes there ----
  await ask(page, 'Как включить белый шум?');
  await page.click('.helper-bot:last-child .helper-action');
  await page.waitForTimeout(300);
  ok('Open on white noise opens white noise', await page.isVisible('#screenNoise'));
  await page.click('#helperMenuOpen').catch(() => {});
  await page.evaluate(() => document.getElementById('helperMenuOpen').click());
  await page.waitForTimeout(200);
  ok('the helper is behind ⋯ too, and keeps the conversation',
    await page.isVisible('#screenHelper') && (await page.$$('.helper-you')).length > 10);
  await ask(page, 'sync two phones');
  await page.click('.helper-bot:last-child .helper-action');
  await page.waitForTimeout(300);
  ok('a setting opens Settings', await page.isVisible('#screenSettings'));
  ok('with the setting lit up', await page.evaluate(() =>
    !!document.querySelector('.helper-spot') && document.querySelector('.helper-spot').contains(document.getElementById('syncRepo'))));
  await page.evaluate(() => document.getElementById('helperMenuOpen').click());
  await page.waitForTimeout(200);
  await ask(page, 'как удалить запись');
  await page.click('.helper-bot:last-child .helper-action');
  await page.waitForTimeout(300);
  ok('something on the main screen goes there', await page.isVisible('#screenMain') &&
    await page.evaluate(() => document.getElementById('logToggle').classList.contains('helper-spot')));

  // ---- what it can't answer ----
  await page.click('#helperOpen');
  await page.waitForTimeout(200);
  a = await ask(page, 'what is the weather');
  ok('a question it cannot place is said to be one', /can't help/.test(a.text), a.text);
  ok('with Ask an AI off, it points at the setting', /Turn on Ask an AI/.test(a.text), a.text);
  await page.click('.helper-bot:last-child .helper-action');
  await page.waitForTimeout(300);
  ok('which it opens', await page.isVisible('#screenSettings') && await page.evaluate(() =>
    !!document.querySelector('.helper-spot') && document.querySelector('.helper-spot').contains(document.getElementById('aiEnabled'))));
  await page.click('#settingsBack');
  await page.click('#helperOpen');
  a = await ask(page, 'у малыша жар');
  ok('worry gets the numbers to ring first', /999/.test(a.text) && /не медицинский совет/.test(a.text), a.text);
  await ctx.close();

  ({ ctx, page } = await open({ ai: true }));
  await page.click('#helperOpen');
  await page.waitForTimeout(200);
  a = await ask(page, 'Is it normal that she cries every evening?');
  ok('with Ask an AI on, it offers to ask', /Ask a bigger AI/.test(a.text), a.text);
  await page.click('.helper-bot:last-child .helper-action');
  await page.waitForTimeout(300);
  ok('and opens it with the question carried across', await page.isVisible('#screenAi') &&
    await page.inputValue('#aiQuestion') === 'Is it normal that she cries every evening?');
  await ctx.close();

  // ---- nothing logged ----
  ({ ctx, page } = await open({ empty: true }));
  await page.click('#helperOpen');
  await page.waitForTimeout(200);
  a = await ask(page, 'сколько подгузников сегодня');
  ok('an empty log says so', /Пока ничего не записано/.test(a.text), a.text);
  a = await ask(page, 'как включить белый шум');
  ok('and how-tos still work', a.topic === 'noise');
  await ctx.close();

  // ---- what versions 110 to 113 left behind ----
  ({ ctx, page } = await open({ legacy: true }));
  await page.evaluate(async () => {
    await (await caches.open('webllm/model')).put('https://huggingface.co/x/params_shard_0.bin', new Response('x'));
    await caches.open('webllm/wasm');
  });
  await page.reload();
  await page.waitForTimeout(600);
  ok('the downloaded model is deleted',
    (await page.evaluate(() => caches.keys())).filter(n => n.indexOf('webllm/') === 0).length === 0);
  ok('and its setting forgotten', await page.evaluate(() => localStorage.getItem('baby-tracker-local-ai')) === null);
  ok('no trace of it in Settings', !(await page.$('#localAiOn')));
  await ctx.close();

  const sw = h.source('sw.js');
  ok('an update clears every cache but its own', /name === CACHE \? null : caches\.delete\(name\)/.test(sw));

  ok('nothing was fetched from anywhere', away.length === 0, away);
  ok('no page errors', errs.length === 0, errs);
  await b.close();
  t.done();
})().catch(e => { console.error(e); process.exit(1); });
