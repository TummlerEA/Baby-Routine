"use strict";

// A song of the parent's own, played in place of the white noise. What can go
// wrong is mostly about keeping: a song that is not there after the app is
// opened again, one that comes back after being removed, or one that is quietly
// carried off in a backup. And about playing: it has to loop, the corner button
// has to start it with one tap, and a timer has to let it finish rather than
// leave it running all night.

const fs = require('fs');
const os = require('os');
const path = require('path');
const h = require('./helpers');
const t = h.tally();
const ok = t.ok;
const APP = h.APP;

// Two seconds of a quiet A, as a WAV: short, so a test can hear it end.
function wav(seconds) {
  const rate = 22050;
  const count = Math.round(rate * seconds);
  const buf = Buffer.alloc(44 + count * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + count * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) {
    buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 6000), 44 + i * 2);
  }
  return buf;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-music-'));
const song = path.join(dir, 'Brahms_Lullaby.wav');
fs.writeFileSync(song, wav(2));
const junk = path.join(dir, 'not-a-song.mp3');
fs.writeFileSync(junk, Buffer.from('this is not audio at all, just words '.repeat(200)));

(async () => {
  const b = await h.launch();
  const ctx = await b.newContext({ viewport: { width: 375, height: 900 }, timezoneId: 'UTC' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('ERR ' + e.message));
  page.setDefaultTimeout(15000);

  await page.goto(APP);
  await page.evaluate(() => localStorage.clear());
  await page.goto(APP);
  await page.waitForLoadState('load');

  await page.click('#noiseOpen');
  await page.waitForSelector('#screenNoise:not([hidden])');
  ok('the list starts empty', /No songs yet/.test(await page.textContent('#musicList')));

  // ---------- a file that is not a song ----------
  await page.setInputFiles('#musicFile', junk);
  await page.waitForFunction(() => !document.getElementById('musicError').hidden);
  ok('a file the phone cannot play is turned away',
    /can't play that file/.test(await page.textContent('#musicError')),
    await page.textContent('#musicError'));
  ok('and nothing is kept of it',
    await page.evaluate(() => JSON.parse(localStorage.getItem('baby-tracker-music') || '[]').length) === 0);

  // ---------- adding one ----------
  await page.setInputFiles('#musicFile', song);
  await page.waitForSelector('.mu-row');
  const row = await page.evaluate(() => ({
    name: document.querySelector('.mu-row .mu-name').textContent,
    meta: document.querySelector('.mu-row .mu-meta').textContent,
    error: document.getElementById('musicError').hidden
  }));
  ok('it is listed under a name made from the file', row.name === 'Brahms Lullaby', row);
  ok('with its length and size', /^0:02 · 0\.\d MB$/.test(row.meta), row);
  ok('and the earlier error is gone', row.error);
  const chip = await page.evaluate(() => {
    const c = document.querySelector('#noiseSounds .mu-chip');
    return c && { on: c.classList.contains('on'), text: c.textContent };
  });
  ok('it joins the sounds, chosen', chip && chip.on && /Brahms Lullaby/.test(chip.text), chip);
  ok('the volume steps give way to the phone\'s buttons', await page.evaluate(() =>
    document.getElementById('noiseLevels').hidden && !document.getElementById('noiseMusicVolume').hidden));
  ok('the play button says it loops',
    /Brahms Lullaby · on a loop · 45 min/.test(await page.textContent('#noisePlayNote')),
    await page.textContent('#noisePlayNote'));

  // ---------- playing it ----------
  const player = () => page.evaluate(() => {
    const a = document.getElementById('noisePlayer');
    return { playing: !a.paused, loop: a.loop, src: a.getAttribute('src') || '',
      fab: document.getElementById('noiseFabIcon').textContent };
  });
  await page.click('#noisePlay');
  await page.waitForFunction(() => !document.getElementById('noisePlayer').paused);
  let p = await player();
  ok('play starts the song, looped, from this phone', p.playing && p.loop && /^blob:/.test(p.src), p);
  ok('the corner button shows a song is on', p.fab === '🎵', p);
  ok('its row in the list says so', await page.evaluate(() =>
    document.querySelector('.mu-row').classList.contains('playing') &&
    document.querySelector('.mu-row .mu-play').textContent === '⏹'));
  await page.waitForTimeout(2600);
  p = await player();
  ok('and it goes round again rather than ending', p.playing, p);
  await page.click('#noisePlay');
  p = await player();
  ok('stop stops it', !p.playing && !p.src, p);

  // ---------- kept, and one tap ----------
  await page.reload();
  await page.waitForLoadState('load');
  await page.waitForTimeout(300);
  await page.click('#noiseFab');
  await page.waitForFunction(() => !document.getElementById('noisePlayer').paused);
  p = await player();
  ok('after the app is opened again, one tap on the corner button plays the song',
    p.playing && p.loop && p.fab === '🎵', p);
  await page.click('#noiseFab');
  ok('and a second tap stops it', !(await player()).playing);

  // ---------- noise still there ----------
  await page.click('#noiseOpen');
  await page.waitForSelector('#screenNoise:not([hidden])');
  await page.click('#noiseSounds .nz-chip[data-value="brown"]');
  await page.click('#noisePlay');
  await page.waitForFunction(() => !document.getElementById('noisePlayer').paused);
  p = await player();
  ok('the white noise is untouched', p.fab === '🔊' && !p.loop, p);
  await page.click('#noisePlay');
  ok('and the volume steps are back for it', await page.evaluate(() =>
    !document.getElementById('noiseLevels').hidden && document.getElementById('noiseMusicVolume').hidden));

  // ---------- the row's own play button ----------
  await page.click('.mu-row .mu-play');
  await page.waitForFunction(() => !document.getElementById('noisePlayer').paused);
  p = await player();
  ok('the ▶ beside a song chooses it and plays it', p.fab === '🎵' && await page.evaluate(() =>
    document.querySelector('#noiseSounds .mu-chip').classList.contains('on')), p);
  await page.click('.mu-row .mu-play');
  ok('and stops it again', !(await player()).playing);

  // ---------- never carried off ----------
  const stored = await page.evaluate(() => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    return keys;
  });
  ok('only the list of names is in localStorage, not the sound',
    (await page.evaluate(() => localStorage.getItem('baby-tracker-music').length)) < 500, stored);
  const idbCount = () => page.evaluate(() => new Promise(resolve => {
    const req = indexedDB.open('baby-tracker-music', 1);
    req.onsuccess = () => {
      const r = req.result.transaction('tracks').objectStore('tracks').count();
      r.onsuccess = () => resolve(r.result);
    };
    req.onerror = () => resolve(-1);
  }));
  ok('the sound itself is in IndexedDB', await idbCount() === 1);
  const source = h.source('app.js');
  const backup = source.slice(source.indexOf('el.exportJson.addEventListener'),
    source.indexOf('el.exportJson.addEventListener') + 2500);
  ok('the backup does not name the songs', !/music/i.test(backup));

  // ---------- removing ----------
  await page.click('.mu-row .mu-del');
  ok('removing takes it off the list and the sounds', await page.evaluate(() =>
    !document.querySelector('.mu-row') && !document.querySelector('#noiseSounds .mu-chip')));
  ok('and the noise is chosen in its place', await page.evaluate(() =>
    document.querySelector('#noiseSounds .nz-chip[data-value="brown"]').classList.contains('on')));
  await page.click('#toastAction');
  ok('undo brings it back, chosen', await page.evaluate(() =>
    !!document.querySelector('.mu-row') &&
    document.querySelector('#noiseSounds .mu-chip').classList.contains('on')));
  await page.waitForTimeout(8500);
  ok('and its sound was not thrown away', await idbCount() === 1);
  await page.click('.mu-row .mu-del');
  await page.waitForTimeout(8500);
  ok('removed for good, the sound goes too', await idbCount() === 0);
  await page.reload();
  await page.waitForLoadState('load');
  ok('and it does not come back', await page.evaluate(() =>
    JSON.parse(localStorage.getItem('baby-tracker-music')).length === 0 &&
    JSON.parse(localStorage.getItem('baby-tracker-noise')).sound === 'brown'));

  // ---------- a timer lets the song finish ----------
  const tctx = await b.newContext({ viewport: { width: 375, height: 900 }, timezoneId: 'UTC' });
  await tctx.clock.install({ time: new Date('2026-11-13T19:00:00Z') });
  const tp = await tctx.newPage();
  tp.on('pageerror', e => errs.push('ERR ' + e.message));
  tp.setDefaultTimeout(15000);
  await tp.goto(APP);
  await tp.evaluate(() => localStorage.clear());
  await tp.goto(APP);
  await tp.waitForLoadState('load');
  await tp.click('#noiseOpen');
  await tp.setInputFiles('#musicFile', song);
  await tp.waitForSelector('.mu-row');
  await tp.click('#noiseTimers .nz-chip[data-value="15"]');
  await tp.click('#noisePlay');
  await tp.waitForFunction(() => !document.getElementById('noisePlayer').paused);
  ok('with a timer the song still loops at first',
    await tp.evaluate(() => document.getElementById('noisePlayer').loop));
  ok('and the minutes left are counted',
    /15 min left/.test(await tp.textContent('#noisePlayNote')), await tp.textContent('#noisePlayNote'));
  await tp.clock.fastForward('15:30');
  await tp.waitForFunction(() => !document.getElementById('noisePlayer').loop);
  ok('once the time is up it plays to the end of this time round',
    /finishing this time round/.test(await tp.textContent('#noisePlayNote')),
    await tp.textContent('#noisePlayNote'));
  await tp.waitForFunction(() => document.getElementById('noisePlayer').paused, null, { timeout: 8000 });
  ok('and then stops, by its timer', /Stopped by its timer/.test(await tp.textContent('#noiseAwakeWhy')),
    await tp.textContent('#noiseAwakeWhy'));
  ok('the corner button is off again',
    await tp.evaluate(() => !document.getElementById('noiseFab').classList.contains('playing')));

  ok('no page errors', errs.length === 0, errs);
  await b.close();
  fs.rmSync(dir, { recursive: true, force: true });
  t.done();
})().catch(e => { console.error(e); process.exit(1); });
