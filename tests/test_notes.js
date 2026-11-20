"use strict";

// Diary notes: short lines through the day, signed by whoever holds the phone,
// each one its own Markdown file in the private repository. What matters:
// a note reaches the other phone, keeps its exact words, is corrected or
// removed only by its own author, waits safely while there is no signal,
// lands on the right baby-day, and never leaks into the log, the backup or
// anything else that leaves the phone.

const crypto = require('crypto');
const h = require('./helpers');
const t = h.tally();
const ok = t.ok;
const APP = h.APP;

const LOG = 'baby-tracker-log.json';
// Midday, 20 November. London is on GMT then, so local time is UTC.
const NOW = new Date('2026-11-20T12:00:00Z');

// ---------- a GitHub in miniature, with folders and deletes ----------
const gh = { files: {}, n: 0, gets: [], down: false };

function setFile(path, text) {
  gh.n++;
  gh.files[path] = { text, sha: 'sha' + gh.n };
}

function treeSha(prefix) {
  const shas = Object.keys(gh.files).filter(p => p.indexOf(prefix + '/') === 0).sort()
    .map(p => gh.files[p].sha);
  return shas.length ? 'tree-' + crypto.createHash('sha1').update(shas.join(',')).digest('hex').slice(0, 12) : null;
}

function answer(url, method, body) {
  if (gh.down) return { down: true };
  const reply = (status, obj) => ({ status, body: JSON.stringify(obj) });
  const m = /\/contents\/([^?]*)/.exec(url);
  const path = m ? decodeURIComponent(m[1]).replace(/\/$/, '') : '';
  if (method === 'GET') {
    const prefix = path ? path + '/' : '';
    const isDir = !gh.files[path] && Object.keys(gh.files).some(p => p.indexOf(prefix) === 0);
    if (path === '' || isDir) {
      const seen = {};
      const out = [];
      Object.keys(gh.files).filter(p => p.indexOf(prefix) === 0).forEach(p => {
        const rest = p.slice(prefix.length);
        const slash = rest.indexOf('/');
        if (slash === -1) out.push({ type: 'file', name: rest, sha: gh.files[p].sha });
        else if (!seen[rest.slice(0, slash)]) {
          seen[rest.slice(0, slash)] = true;
          out.push({ type: 'dir', name: rest.slice(0, slash), sha: treeSha(prefix + rest.slice(0, slash)) });
        }
      });
      gh.gets.push('LIST ' + path);
      return reply(200, out);
    }
    const f = gh.files[path];
    if (!f) return reply(404, {});
    gh.gets.push(path);
    return reply(200, { name: path, sha: f.sha, size: f.text.length, encoding: 'base64',
      content: Buffer.from(f.text).toString('base64') });
  }
  if (method === 'PUT') {
    const sent = JSON.parse(body);
    const f = gh.files[path];
    if (f && !sent.sha) return reply(422, {});
    if (f ? sent.sha !== f.sha : !!sent.sha) return reply(409, {});
    setFile(path, Buffer.from(sent.content, 'base64').toString('utf8'));
    return reply(200, { content: { sha: gh.files[path].sha } });
  }
  if (method === 'DELETE') {
    const sent = JSON.parse(body);
    const f = gh.files[path];
    if (!f) return reply(404, {});
    if (sent.sha !== f.sha) return reply(409, {});
    delete gh.files[path];
    return reply(200, {});
  }
  return reply(404, {});
}

const errs = [];

// A night from 21:30 to 06:40 this morning, so today began at 06:40.
const NIGHT = [
  { id: 'n1', type: 'sleep_start', time: '2026-11-19T21:30:00.000Z', updatedAt: '2026-11-19T21:30:00.000Z' },
  { id: 'n2', type: 'sleep_end', time: '2026-11-20T06:40:00.000Z', updatedAt: '2026-11-20T06:40:00.000Z' }
];

async function phone(b, author) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, timezoneId: 'Europe/London' });
  await ctx.clock.install({ time: NOW });
  await ctx.exposeFunction('__gh', (url, method, body) => answer(url, method, body));
  await ctx.addInitScript(() => {
    const real = window.fetch;
    window.fetch = (url, o) => {
      url = String(url);
      if (url.indexOf('api.github.com') === -1) return real(url, o);
      return window.__gh(url, (o && o.method) || 'GET', (o && o.body) || null)
        .then(r => r.down ? Promise.reject(new TypeError('offline')) : new Response(r.body, { status: r.status }));
    };
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', e => errs.push('ERR ' + e.message));
  await page.goto(APP);
  await page.evaluate(([author, night]) => {
    localStorage.clear();
    localStorage.setItem('baby-tracker-sync', JSON.stringify({ repo: 'us/log', token: 'x', sha: null }));
    localStorage.setItem('baby-tracker-events', JSON.stringify(night));
    if (author) localStorage.setItem('baby-tracker-author', author);
  }, [author, NIGHT]);
  await page.goto(APP);
  await page.waitForLoadState('load');
  await synced(page);
  await page.click('#journalOpen').catch(async () => {
    await page.click('#moreOpen');
    await page.click('#journalOpen');
  });
  await page.waitForSelector('#screenJournal:not([hidden])');
  return page;
}

const synced = p => p.waitForFunction(() =>
  /last synced/.test(document.getElementById('syncStatus').textContent) &&
  !/Syncing/.test(document.getElementById('syncStatus').textContent));
const syncNow = async p => {
  await p.evaluate(() => {
    document.getElementById('syncStatus').textContent = '';
    document.getElementById('syncNow').click();
  });
  await synced(p);
  await p.waitForTimeout(150);
};
const shown = p => p.evaluate(() => [...document.querySelectorAll('#dnList .dn-item')].map(r => ({
  meta: r.querySelector('.dn-meta').textContent,
  text: r.querySelector('.dn-text').textContent,
  editable: !!r.querySelector('.dn-act')
})));
const noteFiles = () => Object.keys(gh.files).filter(p => p.indexOf('journal/notes/') === 0).sort();
const addNote = async (p, text) => {
  await p.fill('#dnText', text);
  await p.click('#dnSave');
};

(async () => {
  const b = await h.launch();
  setFile(LOG, JSON.stringify({ app: 'baby-tracker', version: 4, meta: {}, events: NIGHT }));

  const a = await phone(b, 'Женя');
  const w = await phone(b, 'Аня');

  // ---------- one note, from one phone to the other ----------
  ok('the day on screen starts at this morning\'s wake',
    /Today · from 06:40/.test(await a.textContent('#dnDay')), await a.textContent('#dnDay'));
  ok('and it says who is writing', /Signed as Женя/.test(await a.textContent('#dnWho')));
  const words = 'Проснулась в хорошем настроении.\nПокормили, улыбается.';
  await addNote(a, words);
  let list = await shown(a);
  ok('a note is on screen at once', list.length === 1 && list[0].text === words &&
    /12:00 · Женя/.test(list[0].meta), list);
  await syncNow(a);
  let files = noteFiles();
  ok('and goes up as its own file, named in English letters',
    files.length === 1 && /^journal\/notes\/2026\/11\/20261120T1200\d\dZ__zhenya__[A-Za-z0-9-]+\.md$/.test(files[0]), files);
  const file = gh.files[files[0]].text;
  ok('holding the author, the time and the exact words',
    /^---\nid: [^\n]+\nauthor: Женя\nat: 2026-11-20T12:00:\d\dZ\nupdated: [^\n]+\nsource: app\n---\n/.test(file) &&
    file.indexOf(words) !== -1, file);
  ok('not in the log file', gh.files[LOG].text.indexOf('хорошем') === -1);

  await syncNow(w);
  list = await shown(w);
  ok('the other phone shows it, signed', list.length === 1 && /Женя/.test(list[0].meta) && list[0].text === words, list);
  ok('but cannot change it', !list[0].editable);

  // ---------- both writing ----------
  await w.clock.setSystemTime(new Date('2026-11-20T12:30:00Z'));
  await addNote(w, 'Долго укладывали, минут сорок.');
  await syncNow(w);
  await syncNow(a);
  list = await shown(a);
  ok('both phones\' notes, in order of time', list.length === 2 &&
    /Женя/.test(list[0].meta) && /Аня/.test(list[1].meta), list.map(x => x.meta));

  // ---------- corrected, then removed ----------
  await a.click('#dnList .dn-item .dn-act');   // Edit, on its own note
  ok('editing puts the words back in the box', (await a.inputValue('#dnText')) === words);
  await a.fill('#dnText', words + ' Спала 40 минут.');
  await a.click('#dnSave');
  await syncNow(a);
  ok('a correction rewrites the same file', noteFiles().length === 2 &&
    gh.files[files[0]] && gh.files[files[0]].text.indexOf('Спала 40 минут.') !== -1);
  await syncNow(w);
  ok('and reaches the other phone', (await shown(w)).some(x => /Спала 40 минут/.test(x.text)));

  await a.click('#dnList .dn-item .dn-act:nth-child(2)');   // Delete
  ok('deleting takes it off the screen', (await shown(a)).length === 1);
  await syncNow(a);
  ok('and out of the repository', !gh.files[files[0]] && noteFiles().length === 1, noteFiles());
  await syncNow(w);
  ok('and off the other phone', (await shown(w)).length === 1);

  // ---------- no signal ----------
  gh.down = true;
  await a.clock.setSystemTime(new Date('2026-11-20T13:00:00Z'));
  await addNote(a, 'Без связи: поела 120 мл.');
  await a.evaluate(() => document.getElementById('syncNow').click());
  await a.waitForTimeout(400);
  list = await shown(a);
  ok('with no signal the note stays, marked as not sent yet',
    list.some(x => /Без связи/.test(x.text) && /not sent yet/.test(x.meta)), list.map(x => x.meta));
  gh.down = false;
  await syncNow(a);
  ok('and goes up once there is', noteFiles().some(p => /Без связи/.test(gh.files[p].text)) &&
    !(await shown(a)).some(x => /not sent yet/.test(x.meta)));

  // ---------- nothing new, nothing fetched ----------
  await syncNow(a);
  gh.gets = [];
  await syncNow(a);
  ok('a sync with nothing new in the journal fetches no notes',
    !gh.gets.some(g => g.indexOf('journal/') !== -1 && g.indexOf('LIST ') !== 0) &&
    !gh.gets.some(g => g === 'LIST journal/notes/2026/11'), gh.gets);

  // ---------- which day a note belongs to ----------
  const id1 = crypto.randomUUID();
  setFile('journal/notes/2026/11/20261120T020000Z__zhenya__' + id1 + '.md',
    '---\nid: ' + id1 + '\nauthor: Женя\nat: 2026-11-20T02:00:00Z\nupdated: 2026-11-20T02:00:00Z\nsource: chat\n---\nНочью просыпалась, покачали.\n');
  await syncNow(w);
  list = await shown(w);
  ok('a note at 02:00 is not part of today', !list.some(x => /Ночью/.test(x.text)), list.map(x => x.text));
  await w.click('#dnPrev');
  list = await shown(w);
  ok('it is part of the night before', list.some(x => /Ночью/.test(x.text)) &&
    /Thu, 19 Nov/.test(await w.textContent('#dnDay')), [await w.textContent('#dnDay'), list.map(x => x.text)]);
  ok('one written by the diary chat reads like any other', list.some(x => /02:00 · Женя/.test(x.meta)));
  await w.click('#dnNext');

  // ---------- never leaves the phone any other way ----------
  const source = h.source('app.js');
  const at = name => source.indexOf(name);
  const slice = (from, len) => source.slice(at(from), at(from) + len);
  const exportCode = slice('el.exportJson.addEventListener', 2500);
  ok('the backup does not carry notes, the author or the calendar link',
    !/DNOTES_KEY|AUTHOR_KEY|CALENDAR_KEY|dnotes/.test(exportCode));
  const docCode = slice('function localDocument()', 1500);
  ok('nor does the synced log', !/dnotes|AUTHOR_KEY|CALENDAR_KEY/.test(docCode));
  ok('the log up there has none of the words', !Object.keys(gh.files).filter(p => p.indexOf('journal/') !== 0)
    .some(p => /Долго укладывали|Без связи/.test(gh.files[p].text)));

  // ---------- this phone's own settings ----------
  await a.click('#journalBack');
  await a.click('#settingsOpen');
  await a.fill('#authorName', '  Евгений  ');
  await a.dispatchEvent('#authorName', 'change');
  ok('the name is kept for this phone', (await a.evaluate(() => localStorage.getItem('baby-tracker-author'))) === 'Евгений');
  await a.fill('#calendarUrl', 'http://example.com/cal');
  await a.dispatchEvent('#calendarUrl', 'change');
  ok('a calendar link that is not https is refused',
    !(await a.evaluate(() => localStorage.getItem('baby-tracker-calendar-url'))));
  await a.fill('#calendarUrl', 'https://calendar.google.com/calendar/u/0?cid=abc');
  await a.dispatchEvent('#calendarUrl', 'change');
  await a.click('#settingsBack');
  await a.click('#journalOpen').catch(async () => {
    await a.click('#moreOpen');
    await a.click('#journalOpen');
  });
  await a.waitForSelector('#screenJournal:not([hidden])');
  const cal = await a.evaluate(() => {
    const l = document.getElementById('calendarOpen');
    return { hidden: l.hidden, href: l.getAttribute('href'), rel: l.getAttribute('rel'), target: l.getAttribute('target') };
  });
  ok('the Diary offers the baby calendar', !cal.hidden && cal.href === 'https://calendar.google.com/calendar/u/0?cid=abc' &&
    cal.rel === 'noopener' && cal.target === '_blank', cal);
  ok('the calendar link is not sent anywhere', !Object.keys(gh.files)
    .some(p => gh.files[p].text.indexOf('cid=abc') !== -1));

  ok('no page errors', errs.length === 0, errs);
  await b.close();
  t.done();
})().catch(e => { console.error(e); process.exit(1); });
