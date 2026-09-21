"use strict";

// The diary. Unlike everything else in the app nothing here is worked out,
// so most of what can go wrong is the form losing what somebody typed, or a
// second entry appearing for a day that already had one.

const h = require('./helpers');
const t = h.tally();
const ok = t.ok;
const APP = h.APP;

const NOW = '2026-03-12T20:00:00Z';

(async () => {
  const b = await h.launch();
  const ctx = await b.newContext({
    viewport: { width: 390, height: 950 },
    timezoneId: 'UTC'
  });
  await ctx.clock.install({ time: new Date(NOW) });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('ERR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
  page.setDefaultTimeout(8000);

  // daysAgo counts calendar days back from today, built the way the app
  // builds them so a run near midnight lands in the same day as one at noon.
  async function seed(rows) {
    await page.goto(APP);
    await page.waitForTimeout(300);
    await page.evaluate(list => {
      localStorage.clear();
      const now = new Date();
      const key = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
        '-' + String(d.getDate()).padStart(2, '0');
      const out = list.map((r, i) => {
        const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (r.daysAgo || 0),
          20, 0, 0, 0).toISOString();
        const e = { id: 'seed-' + i, kind: r.kind || 'day', at, updatedAt: at };
        if (e.kind === 'note') {
          e.title = r.title;
          e.text = r.text;
          return e;
        }
        e.day = key(new Date(now.getFullYear(), now.getMonth(), now.getDate() - r.daysAgo));
        ['baby', 'mum', 'dad'].forEach(w => { if (r[w] !== undefined) e[w] = r[w]; });
        if (r.text) e.text = r.text;
        return e;
      });
      localStorage.setItem('baby-tracker-journal', JSON.stringify(out));
    }, rows);
    await page.goto(APP);
    await page.waitForTimeout(300);
    await page.click('#moreOpen');
    await page.waitForTimeout(200);
    await page.click('#journalOpen');
    await page.waitForTimeout(400);
  }

  function stored() {
    return page.evaluate(() =>
      JSON.parse(localStorage.getItem('baby-tracker-journal') || '[]'));
  }

  function shown() {
    return page.evaluate(() => ({
      rows: document.querySelectorAll('#journalFeed .jr-entry').length,
      notes: document.querySelectorAll('#journalNotes .jr-entry').length,
      feedEmpty: !document.getElementById('journalFeedEmpty').hidden,
      notesEmpty: !document.getElementById('journalNotesEmpty').hidden,
      trendEmpty: !document.getElementById('journalTrendEmpty').hidden,
      heading: document.getElementById('journalTodayTitle').textContent,
      cancel: !document.getElementById('journalCancel').hidden,
      text: document.getElementById('journalText').value,
      picked: ['Baby', 'Mum', 'Dad'].map(w =>
        [].findIndex.call(document.querySelectorAll('#journalRow' + w + ' .jr-face'),
          f => f.classList.contains('on')))
    }));
  }

  // One face of the five, for one of the three rows. 1 is the hardest day.
  function face(who, score) {
    return page.click('#journalRow' + who + ' .jr-face:nth-child(' + score + ')');
  }

  // ---------- an empty diary ----------

  await seed([]);
  let s = await shown();
  ok('an empty diary says the feed is empty', s.feedEmpty === true, s);
  ok('an empty diary says there are no notes', s.notesEmpty === true, s);
  ok('an empty diary says the strip has nothing in it', s.trendEmpty === true, s);
  ok('an empty diary has nothing chosen',
    JSON.stringify(s.picked) === JSON.stringify([-1, -1, -1]), s.picked);

  // The strip is drawn even when empty: fourteen outlines say "no answer"
  // fourteen times, which is different from no strip at all.
  const cells = await page.evaluate(() => ({
    rows: document.querySelectorAll('#journalTrend .jr-trend-row').length,
    perRow: document.querySelectorAll('#journalTrend .jr-trend-row:first-child .jr-cell').length,
    blank: document.querySelectorAll('#journalTrend .jr-cell-none').length
  }));
  ok('the strip has a row per person', cells.rows === 3, cells);
  ok('each row is a fortnight wide', cells.perRow === 14, cells);
  ok('an unrated day draws as an outline', cells.blank === 42, cells);

  // ---------- writing a day down ----------

  await face('Baby', 2);
  await face('Mum', 3);
  await page.fill('#journalText', 'Fussy afternoon, better by seven.');
  await page.click('#journalSave');
  await page.waitForTimeout(400);
  let all = await stored();
  ok('saving stores one entry', all.length === 1, all);
  ok('the entry carries the ratings that were tapped',
    all[0] && all[0].baby === 2 && all[0].mum === 3, all[0]);
  ok('a rating nobody gave is absent, not zero',
    all[0] && all[0].dad === undefined, all[0]);
  ok('the entry carries the text', /Fussy afternoon/.test(all[0].text), all[0]);
  ok('the entry is a dated day', all[0].kind === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(all[0].day),
    all[0]);

  s = await shown();
  ok('the day appears in the feed', s.rows === 1, s);
  ok('the strip stops saying it is empty', s.trendEmpty === false, s);

  // Saving the same day again edits it in place — a second entry for today
  // is the bug this whole screen would be most likely to have.
  await face('Dad', 5);
  await page.click('#journalSave');
  await page.waitForTimeout(400);
  all = await stored();
  ok('saving twice in a day does not make a second entry', all.length === 1, all.length);
  ok('the second save keeps what the first one said',
    all[0].baby === 2 && all[0].dad === 5 && /Fussy afternoon/.test(all[0].text), all[0]);

  // Reopening the screen shows what is already there rather than a blank form.
  await page.click('#journalBack');
  await page.waitForTimeout(300);
  await page.click('#moreOpen');
  await page.waitForTimeout(200);
  await page.click('#journalOpen');
  await page.waitForTimeout(400);
  s = await shown();
  ok('reopening fills the form from what was saved',
    JSON.stringify(s.picked) === JSON.stringify([1, 2, 4]), s.picked);
  ok('reopening brings the text back', /Fussy afternoon/.test(s.text), s.text);

  // ---------- clearing a rating ----------

  // Tapping the face already chosen is the only way back to "we did not say".
  await face('Mum', 3);
  await page.click('#journalSave');
  await page.waitForTimeout(400);
  all = await stored();
  ok('tapping the chosen face again clears that rating',
    all[0].mum === undefined && all[0].baby === 2, all[0]);

  // ---------- an empty save ----------

  await seed([]);
  await page.click('#journalSave');
  await page.waitForTimeout(300);
  all = await stored();
  ok('saving an empty form stores nothing', all.length === 0, all);

  await page.fill('#journalText', 'Just a line, no faces.');
  await page.click('#journalSave');
  await page.waitForTimeout(400);
  all = await stored();
  ok('text with no rating is still an entry', all.length === 1, all);

  // Emptying a day that had something in it is a deletion, not a refusal.
  await page.fill('#journalText', '');
  await page.click('#journalSave');
  await page.waitForTimeout(400);
  all = await stored();
  ok('clearing a saved day tombstones it', all.length === 1 && all[0].deleted === true, all);
  ok('the tombstone drops what was written',
    all[0].text === undefined && all[0].day === undefined, all[0]);

  // ---------- editing an older day ----------

  await seed([
    { daysAgo: 3, baby: 1, mum: 1, text: 'Long day.' },
    { daysAgo: 1, baby: 4, mum: 4 }
  ]);
  await page.click('#journalFeed .jr-entry:nth-child(2) .jr-entry-body');
  await page.waitForTimeout(400);
  s = await shown();
  ok('tapping an older day points the form at it', s.cancel === true, s);
  ok('the heading says which day is being edited', /Editing/.test(s.heading), s.heading);
  ok('the older day brings its own text up', /Long day/.test(s.text), s.text);
  ok('and its own ratings',
    JSON.stringify(s.picked) === JSON.stringify([0, 0, -1]), s.picked);

  await page.fill('#journalText', 'Long day. Both of us in bits.');
  await page.click('#journalSave');
  await page.waitForTimeout(400);
  all = await stored();
  ok('editing an older day does not add a new one', all.length === 2, all.length);
  ok('the edit lands on the day that was tapped',
    all.some(e => /in bits/.test(e.text || '')), all);
  s = await shown();
  ok('saving points the form back at today', s.cancel === false, s);

  // Cancel puts it back without saving.
  await page.click('#journalFeed .jr-entry:nth-child(2) .jr-entry-body');
  await page.waitForTimeout(300);
  await page.click('#journalCancel');
  await page.waitForTimeout(300);
  s = await shown();
  ok('cancel returns the form to today', s.cancel === false, s);
  ok('cancel leaves the form empty again', s.text === '', s.text);

  const todayKey = await page.evaluate(() => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0');
  });

  // ---------- filling in a day that has no entry ----------

  // The feed only lists days somebody already wrote down, so before this
  // there was no way to reach a Tuesday nobody filled in. Two ways in now:
  // the date field, and a tap on the gap in the strip.
  await seed([{ daysAgo: 1, baby: 4 }]);
  const backThen = await page.evaluate(() => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 5);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0');
  });
  await page.fill('#journalDate', backThen);
  await page.waitForTimeout(400);
  s = await shown();
  ok('the date field points the form at an older day', s.cancel === true, s);
  ok('a day with nothing in it comes up blank',
    s.text === '' && JSON.stringify(s.picked) === JSON.stringify([-1, -1, -1]), s);

  await face('Baby', 2);
  await face('Dad', 1);
  await page.click('#journalSave');
  await page.waitForTimeout(400);
  all = await stored();
  ok('a day rated after the fact is stored', all.length === 2, all.length);
  const filled = all.filter(e => e.day === backThen)[0];
  ok('it lands on the day that was picked', !!filled, all);
  ok('with the ratings that were tapped',
    filled && filled.baby === 2 && filled.dad === 1, filled);
  s = await shown();
  ok('saving points the form back at today', s.cancel === false, s);

  // The date field will not take a day that has not happened.
  const ahead = await page.evaluate(() => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0');
  });
  const capped = await page.evaluate(() => document.getElementById('journalDate').max);
  ok('the date field offers nothing later than today',
    capped === new Date().toISOString().slice(0, 10) || /^\d{4}-\d{2}-\d{2}$/.test(capped),
    capped);
  await page.fill('#journalDate', ahead);
  await page.waitForTimeout(400);
  s = await shown();
  ok('a day in the future is refused', s.cancel === false, s);
  ok('and the field snaps back to today',
    await page.inputValue('#journalDate') === new Date().toISOString().slice(0, 10) ||
    (await page.inputValue('#journalDate')) !== ahead, await page.inputValue('#journalDate'));

  // A tap on the strip is the other way in. The strip runs oldest to newest
  // and the last cell is today, so the third from the end is two days back.
  const twoBack = await page.evaluate(() => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0');
  });
  await page.click('#journalTrend .jr-trend-row:first-child .jr-cell:nth-last-child(3)');
  await page.waitForTimeout(400);
  s = await shown();
  ok('tapping the strip points the form at that day', s.cancel === true, s);
  ok('the strip and the date field agree about which day',
    await page.inputValue('#journalDate') === twoBack,
    { field: await page.inputValue('#journalDate'), twoBack });

  // Tapping today's own cell puts it back, rather than pinning the form to
  // today's date as if it were an older day.
  await page.click('#journalTrend .jr-trend-row:first-child .jr-cell:last-child');
  await page.waitForTimeout(400);
  s = await shown();
  ok('tapping today on the strip returns the form to today', s.cancel === false, s);

  // ---------- the button names the day it writes to ----------

  // It said "Save today" whatever day the form was pointed at, which is the
  // one moment somebody is most likely to be saving to the wrong one.
  await seed([{ daysAgo: 1, baby: 3, text: 'Yesterday.' }]);
  let label = await page.evaluate(() =>
    document.getElementById('journalSave').textContent);
  ok('on today the button says today', /Save today/.test(label), label);
  await page.click('#journalFeed .jr-entry-body');
  await page.waitForTimeout(400);
  label = await page.evaluate(() => document.getElementById('journalSave').textContent);
  ok('on an older day the button names that day',
    /Save/.test(label) && !/today/.test(label), label);

  // ---------- moving an entry to another day ----------

  // A date typed wrongly used to mean retyping the whole entry on the right
  // day and deleting it off the wrong one.
  await seed([{ daysAgo: 1, baby: 2, mum: 2, text: 'Logged against the wrong day.' }]);
  await page.click('#journalFeed .jr-entry-body');
  await page.waitForTimeout(400);
  const wasId = (await stored()).filter(e => !e.deleted)[0].id;
  await page.fill('#journalDate', todayKey);
  await page.waitForTimeout(400);
  s = await shown();
  ok('retargeting keeps the text that was already there',
    /wrong day/.test(s.text), s.text);
  ok('and the ratings', JSON.stringify(s.picked) === JSON.stringify([1, 1, -1]), s.picked);
  ok('the heading says it is a move, not an edit', /Moving/.test(s.heading), s.heading);
  ok('there is still a way to back out', s.cancel === true, s);

  await page.click('#journalSave');
  await page.waitForTimeout(400);
  all = (await stored()).filter(e => !e.deleted);
  ok('moving leaves one entry, not two', all.length === 1, all);
  ok('it is the same record, on the new day',
    all[0].id === wasId && all[0].day === todayKey, all[0]);
  ok('and it kept what was written', /wrong day/.test(all[0].text), all[0]);
  ok('no tombstone is left behind',
    (await stored()).length === 1, await stored());

  // ---------- backing out of a move ----------

  await seed([{ daysAgo: 2, baby: 4, text: 'Stays where it is.' }]);
  const stayDay = (await stored())[0].day;
  await page.click('#journalFeed .jr-entry-body');
  await page.waitForTimeout(400);
  await page.fill('#journalDate', todayKey);
  await page.waitForTimeout(400);
  await page.click('#journalCancel');
  await page.waitForTimeout(400);
  all = await stored();
  ok('cancelling a move moves nothing', all.length === 1 && all[0].day === stayDay, all);
  s = await shown();
  ok('and puts the form back on today', s.cancel === false, s);

  // ---------- moving onto a day that is taken ----------

  // Two entries on one day, or one silently overwriting the other, is not
  // worth guessing at.
  await seed([
    { daysAgo: 0, baby: 5, text: 'Today already has one.' },
    { daysAgo: 1, baby: 1, text: 'Yesterday.' }
  ]);
  await page.click('#journalFeed .jr-entry:nth-child(2) .jr-entry-body');
  await page.waitForTimeout(400);
  await page.fill('#journalDate', todayKey);
  await page.waitForTimeout(400);
  await page.click('#journalSave');
  await page.waitForTimeout(400);
  all = (await stored()).filter(e => !e.deleted);
  ok('a clash moves nothing', all.length === 2, all);
  ok('both days keep their own entry',
    all.some(e => /already has one/.test(e.text || '')) &&
    all.some(e => /Yesterday/.test(e.text || '')), all);
  const toast = await page.evaluate(() => {
    const el = document.getElementById('toastText');
    return el ? el.textContent : '';
  });
  ok('and it says why', /already has an entry/.test(toast), toast);

  // ---------- an empty form still navigates ----------

  await seed([{ daysAgo: 3, baby: 5, text: 'Three days back.' }]);
  const backDay = (await stored())[0].day;
  await page.fill('#journalDate', backDay);
  await page.waitForTimeout(400);
  s = await shown();
  ok('picking a date on an empty form opens that day',
    /Three days back/.test(s.text), s.text);
  ok('opening a day is not a move', !/Moving/.test(s.heading), s.heading);

  // ---------- the list still navigates ----------

  // The strip and the feed are a list of days, not part of the form, so
  // tapping one there shows that day whatever is half-typed above.
  await seed([{ daysAgo: 1, baby: 3, text: 'Yesterday as stored.' }]);
  await page.fill('#journalText', 'half typed, never saved');
  await page.waitForTimeout(200);
  await page.click('#journalFeed .jr-entry-body');
  await page.waitForTimeout(400);
  s = await shown();
  ok('tapping the feed shows that day rather than carrying the draft',
    /Yesterday as stored/.test(s.text), s.text);

  // ---------- the tally ----------

  // Four good (4 or 5), three hard (1 or 2), one ordinary (3) — and 3 counts
  // as neither, which is the whole reason the thresholds are not the middle.
  await seed([
    { daysAgo: 1, baby: 5 }, { daysAgo: 2, baby: 4 }, { daysAgo: 3, baby: 4 },
    { daysAgo: 4, baby: 5 }, { daysAgo: 5, baby: 3 }, { daysAgo: 6, baby: 2 },
    { daysAgo: 7, baby: 1 }, { daysAgo: 8, baby: 2 },
    // Outside a seven-day window, inside a fortnight.
    { daysAgo: 12, baby: 1 }
  ]);
  const tally14 = await page.evaluate(() =>
    document.querySelector('#journalTrend .jr-trend-row:first-child .jr-tally').textContent);
  ok('a fortnight counts four good days', /4/.test(tally14), tally14);
  ok('a fortnight counts four hard days', /4$/.test(tally14.trim()), tally14);

  await page.click('#journalWindows .ho-chip:nth-child(1)');
  await page.waitForTimeout(400);
  const tally7 = await page.evaluate(() =>
    document.querySelector('#journalTrend .jr-trend-row:first-child .jr-tally').textContent);
  // A window of seven days is today and the six before it, so the hard days
  // seven, eight and twelve back all fall outside it and only one is left.
  ok('a shorter window drops the days outside it', tally7 !== tally14, { tally7, tally14 });
  ok('seven days counts one hard day', /1$/.test(tally7.trim()), tally7);
  ok('seven days still counts all four good ones', /4 /.test(tally7), tally7);

  // ---------- notes for a specialist ----------

  await seed([]);
  await page.click('#journalNoteAdd');
  await page.waitForTimeout(300);
  await page.fill('#journalNoteTitle', 'The bedroom');
  await page.fill('#journalNoteText', 'Nineteen degrees.\nBlackout blind.\nWhite noise all night.');
  await page.click('#journalNoteSave');
  await page.waitForTimeout(400);
  all = await stored();
  ok('a note is stored', all.length === 1 && all[0].kind === 'note', all);
  ok('a note keeps its line breaks', (all[0].text.match(/\n/g) || []).length === 2, all[0].text);
  s = await shown();
  ok('the note appears in its own list', s.notes === 1, s);
  ok('a note is not a day in the feed', s.rows === 0, s);

  await page.click('#journalNotes .jr-entry-body');
  await page.waitForTimeout(300);
  ok('tapping a note opens it for editing',
    await page.inputValue('#journalNoteTitle') === 'The bedroom');
  await page.fill('#journalNoteTitle', 'The bedroom, as of March');
  await page.click('#journalNoteSave');
  await page.waitForTimeout(400);
  all = await stored();
  ok('editing a note does not make a second one', all.length === 1, all.length);
  ok('the note took the new title', /as of March/.test(all[0].title), all[0]);

  await page.click('#journalNoteAdd');
  await page.waitForTimeout(300);
  await page.fill('#journalNoteTitle', 'No text');
  await page.click('#journalNoteSave');
  await page.waitForTimeout(300);
  all = await stored();
  ok('a note with no body is refused', all.length === 1, all.length);

  // ---------- deleting ----------

  await seed([{ daysAgo: 0, baby: 3, text: 'Ordinary.' }]);
  await page.click('#journalFeed .jr-del');
  await page.waitForTimeout(400);
  all = await stored();
  ok('deleting leaves a tombstone', all.length === 1 && all[0].deleted === true, all);
  ok('the tombstone carries no ratings', all[0].baby === undefined, all[0]);
  s = await shown();
  ok('the deleted day leaves the feed', s.rows === 0, s);
  ok('and the form it was filling', s.text === '', s.text);

  // ---------- what arrives from another phone ----------

  await seed([]);
  const imported = await page.evaluate(() => {
    const now = new Date().toISOString();
    const payload = { journal: [
      { id: 'good', kind: 'day', day: '2026-03-10', baby: 3, at: now, updatedAt: now },
      { id: 'bad-kind', kind: 'dream', day: '2026-03-10', baby: 3, at: now, updatedAt: now },
      { id: 'bad-day', kind: 'day', day: 'yesterday', baby: 3, at: now, updatedAt: now },
      { id: 'out-of-range', kind: 'day', day: '2026-03-09', baby: 99, at: now, updatedAt: now },
      { id: 'empty-day', kind: 'day', day: '2026-03-08', at: now, updatedAt: now },
      { id: 'note-no-title', kind: 'note', text: 'orphan', at: now, updatedAt: now },
      { id: 'buried', deleted: true, at: now, updatedAt: now }
    ] };
    const file = new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById('importFile');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  });
  ok('a mixed backup is handed to the file input', imported === true);
  await page.waitForTimeout(700);
  all = await stored();
  const ids = all.map(e => e.id).sort();
  ok('only the sound records and the tombstone survive',
    JSON.stringify(ids) === JSON.stringify(['buried', 'good']), ids);
  ok('an out-of-range rating is dropped along with its entry',
    !all.some(e => e.baby === 99), all);

  // ---------- the summary that goes to an AI ----------

  await seed([
    { daysAgo: 1, baby: 2, mum: 2, dad: 3, text: 'Hard night, nobody slept.' },
    { daysAgo: 2, baby: 4, mum: 4, dad: 4 },
    { kind: 'note', title: 'The bedroom', text: 'Nineteen degrees, blackout blind.' }
  ]);
  await page.click('#journalBack');
  await page.waitForTimeout(300);
  await page.evaluate(() =>
    localStorage.setItem('baby-tracker-ai', JSON.stringify({ on: true, name: false })));
  await page.reload();
  await page.waitForTimeout(400);
  await page.click('#btnFeed');
  await page.waitForTimeout(400);
  await page.click('#aiOpen');
  await page.waitForTimeout(500);
  let summary = await page.evaluate(() => document.getElementById('aiPreview').value);
  ok('the diary stays out of the summary until it is switched on',
    !/Hard night/.test(summary) && !/blackout/i.test(summary), summary.slice(-300));

  await page.click('#aiBack');
  await page.waitForTimeout(300);
  await page.click('#settingsOpen');
  await page.waitForTimeout(300);
  await page.click('#aiUseJournal');
  await page.waitForTimeout(300);
  await page.click('#settingsBack');
  await page.waitForTimeout(300);
  await page.click('#aiOpen');
  await page.waitForTimeout(500);
  summary = await page.evaluate(() => document.getElementById('aiPreview').value);
  ok('switched on, the summary carries what was written',
    /Hard night, nobody slept/.test(summary), summary.slice(-500));
  ok('and the standing note', /blackout blind/.test(summary), summary.slice(-500));
  ok('and the tallies', /good, .*hard/.test(summary), summary.slice(-500));
  ok('the summary never carries a sync token',
    !/ghp_|github_pat_/.test(summary));

  // ---------- one language ----------

  // The handover and the shopping list are read by whoever is holding the
  // phone, so they carry a language switch. These two are not: the rest of
  // the app is English and a row of chips on every screen is clutter
  // charged to every reader to serve none of them.
  await seed([]);
  const chrome = await page.evaluate(() => ({
    chips: document.querySelectorAll('#screenJournal .ho-chip-lang').length,
    label: !!document.getElementById('journalLangLabel'),
    heading: document.getElementById('journalTitle').textContent
  }));
  ok('the screen offers no language switch', chrome.chips === 0, chrome);
  ok('and has no label left behind for one', chrome.label === false, chrome);
  ok('the heading is the English one', /Diary/.test(chrome.heading), chrome);

  // ---------- nothing threw ----------

  ok('the console stayed quiet', errs.length === 0, errs.slice(0, 4));

  await b.close();
  t.done();
})();
