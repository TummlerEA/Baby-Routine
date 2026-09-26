"use strict";

// The white noise. Nothing here is stored or worked out, so what can go wrong
// is different in kind from the rest of the app: a sound that is not the sound
// it says it is, a join that dips, a file that is not the length the timer
// promised, or a blob thrown away while something is still reading it.
//
// Two things are worth stating plainly, because the design only makes sense
// against them. A phone stops running a page's JavaScript once the screen is
// off, which is exactly when this sound matters — so once play() is called,
// nothing in app.js may need to run again. And Safari leaves a hole most of a
// second wide wherever a media element loops, so a timed sound never loops:
// its file is the whole session, ending in a fade, and the timer going off is
// the file running out.
//
// The spectrum checks are the point of this file. "It played" is not the same
// claim as "it played brown noise", and only one of them is worth making.

const h = require('./helpers');
const t = h.tally();
const ok = t.ok;
const APP = h.APP;

const RATE = 8820;
const BLOCK = 30;
const BLOCK_BYTES = RATE * BLOCK * 2;

// Power around one frequency, by Goertzel: nine neighbouring bins averaged
// together, over blocks that overlap by half. Both are there to hold the
// estimate steady — one bin of one block of noise varies by several dB from
// draw to draw. Five bins and no overlap was not enough and failed a true
// check in the wild; this holds a fresh draw to about a third of a decibel.
function band(samples, rate, hz) {
  const N = 4096;
  const centre = Math.round(N * hz / rate);
  let acc = 0;
  for (let d = -4; d <= 4; d++) {
    const w = 2 * Math.PI * (centre + d) / N;
    const c = 2 * Math.cos(w);
    let total = 0, blocks = 0;
    for (let off = 0; off + N <= samples.length; off += N / 2) {
      let s1 = 0, s2 = 0;
      for (let i = 0; i < N; i++) {
        const v = samples[off + i] + c * s1 - s2;
        s2 = s1;
        s1 = v;
      }
      total += s1 * s1 + s2 * s2 - c * s1 * s2;
      blocks++;
    }
    acc += total / blocks;
  }
  return acc / 9;
}

// A slope in dB per octave. White is flat, pink falls 3, brown falls 6.
//
// Where it is measured matters. Brown is made by leaking an integrator and
// only reaches its full 6dB an octave well above the leak; and the averaging
// that drops the rate to 8820Hz rolls the very top off by a few tenths of a
// decibel, which over three octaves shows up as a slight extra tilt.
function slope(samples, rate, lowHz, highHz) {
  const octaves = Math.log2(highHz / lowHz);
  return 10 * Math.log10(band(samples, rate, highHz) / band(samples, rate, lowHz)) / octaves;
}

function toSamples(bytes, from) {
  const buf = Buffer.from(bytes);
  const count = (buf.length - from) / 2;
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = buf.readInt16LE(from + i * 2) / 32768;
  return out;
}

function readHeader(bytes) {
  const buf = Buffer.from(bytes);
  return {
    riff: buf.toString('ascii', 0, 4),
    wave: buf.toString('ascii', 8, 12),
    format: buf.readUInt16LE(20),
    channels: buf.readUInt16LE(22),
    rate: buf.readUInt32LE(24),
    byteRate: buf.readUInt32LE(28),
    align: buf.readUInt16LE(32),
    bits: buf.readUInt16LE(34),
    riffSize: buf.readUInt32LE(4),
    dataSize: buf.readUInt32LE(40)
  };
}

function rms(s, from, count) {
  let sum = 0;
  const n = count === undefined ? s.length : count;
  const start = from || 0;
  for (let i = 0; i < n; i++) sum += s[start + i] * s[start + i];
  return Math.sqrt(sum / n);
}

(async () => {
  const b = await h.launch();
  const ctx = await b.newContext({
    viewport: { width: 390, height: 950 },
    timezoneId: 'UTC'
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('ERR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
  page.setDefaultTimeout(15000);

  async function fresh() {
    await page.goto(APP);
    await page.waitForTimeout(300);
    await page.evaluate(() => localStorage.clear());
    await page.goto(APP);
    await page.waitForTimeout(300);
  }

  // Idempotent on purpose. Sections get added and reordered, and one of them
  // asking for a screen that is already up should not be a broken run.
  async function openNoise() {
    if (await page.isVisible('#screenNoise')) return;
    await page.click('#moreOpen');
    await page.waitForTimeout(150);
    await page.click('#noiseOpen');
    await page.waitForTimeout(250);
  }

  const player = () => page.evaluate(() => {
    const a = document.getElementById('noisePlayer');
    return {
      playing: !a.paused,
      loop: a.loop,
      minutes: a.duration ? +(a.duration / 60).toFixed(2) : 0,
      at: a.currentTime,
      src: a.getAttribute('src')
    };
  });

  const fab = () => page.evaluate(() => {
    const f = document.getElementById('noiseFab');
    const left = document.getElementById('noiseFabLeft');
    return {
      hidden: f.hidden,
      playing: f.classList.contains('playing'),
      left: left.hidden ? null : left.textContent
    };
  });

  // The file is up to forty-odd megabytes, so it is read a slice at a time
  // rather than hauled across whole.
  const fileSize = () => page.evaluate(async () =>
    (await (await fetch(document.getElementById('noisePlayer').src)).blob()).size);

  const firstBlock = () => page.evaluate(async (bytes) => {
    const blob = await (await fetch(document.getElementById('noisePlayer').src)).blob();
    const part = await blob.slice(0, 44 + bytes).arrayBuffer();
    return Array.from(new Uint8Array(part));
  }, BLOCK_BYTES);

  const lastOf = (n) => page.evaluate(async (count) => {
    const blob = await (await fetch(document.getElementById('noisePlayer').src)).blob();
    const part = await blob.slice(blob.size - count).arrayBuffer();
    return Array.from(new Uint8Array(part));
  }, n);

  // ---------- where it lives ----------

  await fresh();

  ok('the shortcut is on the main screen from the start',
    await page.isVisible('#noiseFab'));
  ok('the shortcut says it is off', !(await fab()).playing);

  await page.click('#moreOpen');
  await page.waitForTimeout(150);
  const menu = await page.$$eval('.more-item', n => n.map(x => x.id));
  ok('the ⋯ menu offers the noise screen first', menu[0] === 'noiseOpen', menu);
  await page.click('#noiseOpen');
  await page.waitForTimeout(250);

  ok('the screen opens', await page.isVisible('#screenNoise'));
  ok('the shortcut stays out of the way on another screen while it is silent',
    (await fab()).hidden);
  ok('the screen is in English only, like every screen added since',
    (await page.$$('#screenNoise .ho-chip-lang')).length === 0);
  ok('there is one player, not a rig of them',
    (await page.$$('audio')).length === 1);

  const chips = row => page.$$eval(row + ' .nz-chip', n => n.map(x => x.dataset.value));
  ok('three sounds and a silent fourth',
    (await chips('#noiseSounds')).join() === 'brown,pink,white,standby');
  ok('either watch button can be turned off or given one of three jobs',
    (await chips('#noisePrev')).join() === ',feed,diaper,sleep' &&
    (await chips('#noiseNext')).join() === ',feed,diaper,sleep');
  ok('four volumes', (await chips('#noiseLevels')).join() === '1,2,3,4');
  ok('a no-limit option sits with the timers',
    (await chips('#noiseTimers')).join() === '15,30,45,60,0');

  const picked = row => page.$eval(row + ' .nz-chip.on', n => n.dataset.value);
  ok('the default sound is the deep one', await picked('#noiseSounds') === 'brown');
  ok('the default volume is low', await picked('#noiseLevels') === '2');
  ok('the default timer is 45 minutes', await picked('#noiseTimers') === '45');
  ok('it does not follow the sleep button until asked',
    !(await page.isChecked('#noiseAuto')));
  ok('the right-hand watch button logs a feed to begin with',
    await picked('#noiseNext') === 'feed');
  ok('and the left-hand one the sleep', await picked('#noisePrev') === 'sleep');
  ok('the button says what it will do',
    (await page.textContent('#noisePlayNote')) === 'Deep · 45 min');

  // ---------- the sound itself ----------

  await page.click('#noiseTimers .nz-chip[data-value="15"]');
  await page.waitForTimeout(120);

  const measured = {};
  for (const sound of ['brown', 'pink', 'white']) {
    await page.click(`#noiseSounds .nz-chip[data-value="${sound}"]`);
    await page.waitForTimeout(120);
    await page.click('#noisePlay');
    await page.waitForTimeout(900);
    measured[sound] = {
      head: readHeader(await firstBlock()),
      samples: toSamples(await firstBlock(), 44)
    };
    await page.click('#noisePlay');
    await page.waitForTimeout(250);
  }

  const brown = measured.brown, pink = measured.pink, white = measured.white;

  ok('what is handed to the player is a WAV',
    brown.head.riff === 'RIFF' && brown.head.wave === 'WAVE',
    [brown.head.riff, brown.head.wave]);
  ok('uncompressed 16-bit mono at 8820Hz',
    brown.head.format === 1 && brown.head.channels === 1 &&
    brown.head.bits === 16 && brown.head.rate === RATE, brown.head);
  ok('the rate, the byte rate and the block align agree with one another',
    brown.head.byteRate === RATE * 2 && brown.head.align === 2, brown.head);
  ok('the header declares a length thirty-six bytes short of the whole file',
    brown.head.riffSize === brown.head.dataSize + 36, brown.head);
  ok('a block is thirty seconds long',
    Math.round(brown.samples.length / RATE) === BLOCK, brown.samples.length / RATE);

  const wSlope = slope(white.samples, RATE, 200, 1600);
  const pSlope = slope(pink.samples, RATE, 200, 1600);
  const bSlope = slope(brown.samples, RATE, 200, 1600);
  const bHigh = slope(brown.samples, RATE, 400, 3200);

  ok('white is flat', Math.abs(wSlope) < 0.45, wSlope.toFixed(2));
  ok('pink falls 3dB an octave', Math.abs(pSlope + 3.1) < 0.45, pSlope.toFixed(2));
  // Six and a fifth rather than six: averaging five samples to drop the rate
  // rolls the very top off, and over three octaves that reads as a little
  // extra tilt. It is the decimation being what it is, not the noise being
  // wrong, so the check is against what the filter really produces.
  ok('brown falls 6dB an octave, once clear of its own leak',
    Math.abs(bHigh + 6.2) < 0.7, bHigh.toFixed(2));
  ok('the three are in order, deepest first', bSlope < pSlope - 2 && pSlope < wSlope - 2,
    [bSlope.toFixed(2), pSlope.toFixed(2), wSlope.toFixed(2)]);

  // Levelled by RMS so the three are about as loud as each other. Brown noise
  // wanders far from zero, and matching peaks instead would make it the
  // quietest of the three by some way.
  const levels = [rms(brown.samples), rms(pink.samples), rms(white.samples)];
  ok('the three sounds are within a hair of the same loudness',
    Math.max.apply(null, levels) / Math.min.apply(null, levels) < 1.1,
    levels.map(v => v.toFixed(3)));
  ok('none of them clips',
    [brown, pink, white].every(w => {
      let p = 0;
      for (let i = 0; i < w.samples.length; i++) p = Math.max(p, Math.abs(w.samples[i]));
      return p < 0.99;
    }));

  // ---------- the join between one block and the next ----------

  // The file is one block repeated, so every thirty seconds the end of the
  // block meets its own beginning. The last half second is crossfaded across
  // the first half second on a quarter-cosine: noise is uncorrelated, so it
  // is powers that add, and sin² + cos² = 1 holds the level. A straight-line
  // fade would dip 3dB in the middle of it, heard as a breath.
  const seam = Math.round(RATE * 0.5);
  const inside = rms(white.samples, 5 * RATE, 4 * RATE);
  const across = rms(white.samples, 0, seam);
  const drift = 20 * Math.log10(across / inside);
  ok('the crossfaded join holds the same level as the rest of the block',
    Math.abs(drift) < 0.5, drift.toFixed(2));

  // And the step from the last sample back to the first has to be an
  // ordinary step, or the join is a click however flat the level is.
  const n = white.samples.length;
  let typical = 0;
  for (let i = 1; i < 20000; i++) typical += Math.abs(white.samples[i] - white.samples[i - 1]);
  typical /= 20000;
  const jump = Math.abs(white.samples[0] - white.samples[n - 1]);
  ok('and it does not click where it wraps', jump / typical < 4,
    (jump / typical).toFixed(2));

  // ---------- the file is the whole session ----------

  await page.click('#noiseSounds .nz-chip[data-value="brown"]');
  await page.waitForTimeout(120);

  for (const minutes of [15, 45]) {
    await page.click(`#noiseTimers .nz-chip[data-value="${minutes}"]`);
    await page.waitForTimeout(120);
    await page.click('#noisePlay');
    await page.waitForTimeout(1200);
    const state = await player();
    const size = await fileSize();
    ok(`a ${minutes} minute timer makes a file ${minutes} minutes long plus its fade`,
      Math.abs(state.minutes - (minutes + BLOCK / 60)) < 0.05, state.minutes);
    ok(`and nothing is asked to loop it`, !state.loop);
    ok(`its size is what that many seconds of 8820Hz comes to`,
      Math.abs(size - (44 + (minutes * 60 + BLOCK) * RATE * 2)) < 4 * RATE,
      [size, 44 + (minutes * 60 + BLOCK) * RATE * 2]);
    await page.click('#noisePlay');
    await page.waitForTimeout(250);
  }

  await page.click('#noiseTimers .nz-chip[data-value="15"]');
  await page.waitForTimeout(120);
  await page.click('#noisePlay');
  await page.waitForTimeout(1000);

  // The timer going off is the file running out, so the fade has to be in the
  // bytes rather than in anything that would have to be running at the time.
  const tail = toSamples(await lastOf(BLOCK_BYTES), 0);
  const fadeAt = x => rms(tail, Math.round((tail.length - RATE) * x), RATE);
  const opens = fadeAt(0), quarter = fadeAt(0.25), midway = fadeAt(0.5), shuts = fadeAt(0.995);
  ok('the last block of the file is the fade, and it starts at full level',
    opens > 0.02, opens.toFixed(4));
  ok('it comes down all the way through', quarter < opens * 0.95 && midway < quarter * 0.8 &&
    shuts < midway * 0.1, [opens, quarter, midway, shuts].map(v => v.toFixed(4)));
  ok('the file ends in silence', shuts < opens * 0.02,
    [opens.toFixed(4), shuts.toFixed(5)]);
  // A raised cosine is half way down at half way through. A straight line
  // would be too, but would not leave as quietly at either end.
  ok('and it gets there on a curve, not a cliff or a ramp',
    Math.abs(midway / opens - 0.5) < 0.12, (midway / opens).toFixed(3));

  await page.click('#noisePlay');
  await page.waitForTimeout(250);

  // ---------- with no timer, and only then, it loops ----------

  await page.click('#noiseTimers .nz-chip[data-value="0"]');
  await page.waitForTimeout(120);
  ok('with no limit the screen says it will keep going',
    await page.textContent('#noisePlayNote') === 'Deep · Until I stop it',
    await page.textContent('#noisePlayNote'));
  await page.click('#noisePlay');
  await page.waitForTimeout(1200);
  let state = await player();
  ok('no limit is the one case that loops', state.loop);
  ok('and it loops a quarter of an hour, not a few seconds',
    Math.abs(state.minutes - 15) < 0.05, state.minutes);
  ok('no limit means no countdown on the shortcut', (await fab()).left === null);
  await page.click('#noisePlay');
  await page.waitForTimeout(250);

  // ---------- volume is in the file, because iOS ignores it anywhere else ----------

  await page.click('#noiseTimers .nz-chip[data-value="15"]');
  await page.waitForTimeout(120);
  const atLevel = {};
  for (const level of ['1', '4']) {
    await page.click(`#noiseLevels .nz-chip[data-value="${level}"]`);
    await page.waitForTimeout(120);
    await page.click('#noisePlay');
    await page.waitForTimeout(900);
    atLevel[level] = rms(toSamples(await firstBlock(), 44));
    await page.click('#noisePlay');
    await page.waitForTimeout(250);
  }
  ok('the volume is written into the samples, not left to the element',
    atLevel['4'] / atLevel['1'] > 5, [atLevel['1'].toFixed(4), atLevel['4'].toFixed(4)]);
  ok('the quietest setting is still audible', atLevel['1'] > 0.005, atLevel['1'].toFixed(4));

  await page.click('#noiseLevels .nz-chip[data-value="2"]');
  await page.waitForTimeout(120);

  // ---------- playing, stopping, and the shortcut ----------

  await page.click('#noisePlay');
  await page.waitForTimeout(1000);
  state = await player();
  ok('play starts something', state.playing, state);
  ok('the button turns into a stop', await page.textContent('#noisePlayLabel') === 'Stop');
  ok('the screen counts down', /15 min left/.test(await page.textContent('#noisePlayNote')),
    await page.textContent('#noisePlayNote'));

  let shortcut = await fab();
  ok('the shortcut comes back while the sound is running', !shortcut.hidden);
  ok('and lights up', shortcut.playing);
  ok('and carries the minutes left', shortcut.left === '15m', shortcut.left);

  // The count is read off the element, so winding it on is enough to move it.
  await page.evaluate(() => { document.getElementById('noisePlayer').currentTime = 10 * 60; });
  await page.waitForTimeout(500);
  ok('the count comes down as the file plays out', (await fab()).left === '5m',
    (await fab()).left);

  await page.evaluate(() => {
    const a = document.getElementById('noisePlayer');
    a.currentTime = a.duration - 20;
  });
  await page.waitForTimeout(500);
  ok('and the last half minute is named as the fade',
    await page.textContent('#noisePlayNote') === 'Fading out',
    await page.textContent('#noisePlayNote'));

  await page.evaluate(() => {
    const a = document.getElementById('noisePlayer');
    a.currentTime = a.duration - 0.3;
  });
  await page.waitForTimeout(2000);
  state = await player();
  ok('the file running out is the timer going off', !state.playing, state);
  ok('and it lets go of the source', state.src === null);
  ok('the screen is back to offering to play',
    await page.textContent('#noisePlayLabel') === 'Play');
  ok('the shortcut is dark again', !(await fab()).playing);

  // ---------- the shortcut ----------

  await page.click('#noiseBack');
  await page.waitForTimeout(250);
  await page.click('#noiseFab');
  await page.waitForTimeout(1000);
  ok('one tap on the shortcut starts it', (await player()).playing);
  ok('and the shortcut follows onto the main screen', !(await fab()).hidden);

  await page.click('#moreOpen');
  await page.waitForTimeout(150);
  await page.click('#journalOpen');
  await page.waitForTimeout(250);
  ok('and onto every other screen, so stopping it is never a journey',
    !(await fab()).hidden);

  await page.click('#noiseFab');
  await page.waitForTimeout(400);
  state = await player();
  ok('one tap on the shortcut stops it', !state.playing);
  ok('and lets go of the source', state.src === null, state.src);
  ok('and hides again once it is off and we are elsewhere', (await fab()).hidden);

  await page.click('#journalBack');
  await page.waitForTimeout(250);
  ok('back on the main screen it is offered again, dimmed',
    !(await fab()).hidden && !(await fab()).playing);

  // ---------- holding it opens the screen instead ----------

  const box = await page.$eval('#noiseFab', n => {
    const r = n.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
  await page.waitForTimeout(300);
  ok('holding the shortcut opens the screen', await page.isVisible('#screenNoise'));
  ok('and holding it does not also start the sound', !(await player()).playing);

  // ---------- the watch ----------

  // A phone hands whatever it is playing to a paired watch, with a button
  // either side of play, and those two are given something better to do than
  // skip a track. None of it can be tested on a watch from here, so what is
  // tested is everything on this side of the system: that the handlers are
  // registered, that calling one logs the right entry, and that what goes
  // back for the watch to display says what just happened.

  await fresh();
  await page.evaluate(() => {
    // Keep hold of what the page hands to the system, and of the handlers it
    // registers, so a press can be made without a watch.
    window.__titles = [];
    const own = Object.getOwnPropertyDescriptor(MediaSession.prototype, 'metadata');
    Object.defineProperty(navigator.mediaSession, 'metadata', {
      set(v) {
        window.__titles.push(v ? { title: v.title, artist: v.artist } : null);
        own.set.call(navigator.mediaSession, v);
      },
      get() { return own.get.call(navigator.mediaSession); }
    });
    window.__press = {};
    const real = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
    navigator.mediaSession.setActionHandler = (name, fn) => {
      window.__press[name] = fn;
      real(name, fn);
    };
  });

  await openNoise();
  await page.click('#noiseSounds .nz-chip[data-value="standby"]');
  await page.click('#noiseTimers .nz-chip[data-value="0"]');
  await page.waitForTimeout(150);

  ok('the remote has nothing to set the volume of', await page.isHidden('#noiseLevels'));
  ok('and says as much before it starts',
    await page.textContent('#noisePlayNote') === 'Standby, no sound · Until I stop it',
    await page.textContent('#noisePlayNote'));

  await page.click('#noisePlay');
  await page.waitForTimeout(1200);
  ok('the remote plays like anything else', (await player()).playing);

  // Inaudible, but not nothing: a file of digital silence is a file a phone
  // may decide is not worth keeping alive, and then there is no Now Playing
  // and no buttons.
  const quiet = rms(toSamples(await firstBlock(), 44));
  const quietDb = 20 * Math.log10(quiet);
  ok('the remote is far too quiet to hear', quietDb < -60, quietDb.toFixed(0));
  ok('but it is a real signal rather than silence', quietDb > -85, quietDb.toFixed(0));

  const handlers = () => page.evaluate(() =>
    Object.keys(window.__press).filter(k => window.__press[k]));
  ok('both of the watch buttons are claimed',
    (await handlers()).indexOf('nexttrack') !== -1 &&
    (await handlers()).indexOf('previoustrack') !== -1, await handlers());

  const shown = () => page.evaluate(() => window.__titles[window.__titles.length - 1]);
  const logged = () => page.evaluate(() =>
    JSON.parse(localStorage.getItem('baby-tracker-events') || '[]')
      .filter(e => !e.deleted).map(e => e.type));
  const press = (button) => page.evaluate(b => window.__press[b](), button);

  ok('with nothing logged the watch is told the app name',
    (await shown()).title === 'Baby Tracker', await shown());
  ok('and which of the sounds is running',
    /standby/.test((await shown()).artist), await shown());

  await press('nexttrack');
  await page.waitForTimeout(400);
  ok('the right-hand button logs a feed', (await logged()).join() === 'feed', await logged());
  ok('and the watch is told what it just did',
    /^Fed \d\d:\d\d$/.test((await shown()).title), await shown());
  ok('and so is the phone, for when it is next looked at',
    /From the watch: Fed/.test(await page.textContent('#toastText')),
    await page.textContent('#toastText'));

  // Sleep is one button because it is a toggle: which way it goes depends on
  // whether anyone is asleep at the time.
  await press('previoustrack');
  await page.waitForTimeout(400);
  ok('the left-hand button puts the baby down',
    (await logged()).join() === 'feed,sleep_start', await logged());
  ok('and says so', (await shown()).title.indexOf('Asleep') === 0, await shown());

  await press('previoustrack');
  await page.waitForTimeout(400);
  ok('and pressed again it is the waking up',
    (await logged()).join() === 'feed,sleep_start,sleep_end', await logged());
  ok('and says that instead', (await shown()).title.indexOf('Woke') === 0, await shown());

  // A mis-press from a pocket is the obvious failure here, so it has to be
  // undoable from the phone like anything else.
  await page.click('#toastAction');
  await page.waitForTimeout(400);
  ok('a press can be taken back', (await logged()).join() === 'feed,sleep_start',
    await logged());

  // Once it stops saying what happened it goes back to saying how things are.
  await page.evaluate(() => {
    const now = Date.now;
    Date.now = () => now() + 60000;
  });
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); });
  await page.waitForTimeout(400);
  ok('after a while the watch goes back to how things stand',
    /^Fed /.test((await shown()).title), await shown());
  ok('and carries the sleep alongside it',
    /asleep/.test((await shown()).title), await shown());

  await page.click('#noisePrev .nz-chip[data-value=""]');
  await page.waitForTimeout(300);
  ok('a button set to Off is handed back to the phone',
    await page.evaluate(() => window.__press.previoustrack === null));

  await page.click('#noiseNext .nz-chip[data-value="diaper"]');
  await page.waitForTimeout(300);
  await press('nexttrack');
  await page.waitForTimeout(400);
  ok('and one given another job does that job instead',
    (await logged()).join() === 'feed,sleep_start,diaper', await logged());
  ok('changing which button does what does not interrupt the sound',
    (await player()).playing);

  await page.click('#noisePlay');
  await page.waitForTimeout(300);

  // ---------- following the sleep button ----------

  await fresh();
  await page.click('#btnSleep');
  await page.waitForTimeout(700);
  ok('logging a sleep makes no noise by default', !(await player()).playing);
  await page.click('#btnSleep');
  await page.waitForTimeout(400);

  await openNoise();
  await page.check('#noiseAuto');
  await page.click('#noiseTimers .nz-chip[data-value="15"]');
  await page.click('#noiseBack');
  await page.waitForTimeout(250);

  await page.click('#btnSleep');
  await page.waitForTimeout(1200);
  ok('switched on, the sleep button starts it with no second tap',
    (await player()).playing);
  ok('and the shortcut shows the timer running', (await fab()).left === '15m');

  await page.click('#btnSleep');
  await page.waitForTimeout(500);
  ok('and the wake-up stops it', !(await player()).playing);

  await page.click('#btnWakeChangeFeed');
  await page.waitForTimeout(500);
  ok('the combined wake button counts as a wake-up too', !(await player()).playing);

  // ---------- the remote is not a sleep aid ----------

  // Following the sleep button is for a sound that helps a baby off. The
  // remote is a set of buttons, and stopping it on a wake-up would take away
  // the very control that had just been used.
  await fresh();
  await openNoise();
  await page.check('#noiseAuto');
  await page.click('#noiseSounds .nz-chip[data-value="standby"]');
  await page.click('#noiseTimers .nz-chip[data-value="0"]');
  await page.waitForTimeout(150);
  await page.click('#noisePlay');
  await page.waitForTimeout(1200);
  ok('the remote is running', (await player()).playing);

  await page.click('#noiseBack');
  await page.waitForTimeout(250);
  await page.click('#btnSleep');
  await page.waitForTimeout(600);
  ok('logging a sleep leaves the remote alone', (await player()).playing);
  await page.click('#btnSleep');
  await page.waitForTimeout(600);
  ok('and so does waking up, or the buttons would vanish when used',
    (await player()).playing);

  // A sound that is a sound still follows it, and still is not restarted
  // from the top just because another sleep was logged.
  await openNoise();
  await page.click('#noiseSounds .nz-chip[data-value="brown"]');
  await page.click('#noiseTimers .nz-chip[data-value="15"]');
  await page.waitForTimeout(150);
  await page.click('#noisePlay');
  await page.waitForTimeout(1200);
  await page.evaluate(() => { document.getElementById('noisePlayer').currentTime = 120; });
  await page.click('#noiseBack');
  await page.waitForTimeout(250);
  await page.click('#btnSleep');
  await page.waitForTimeout(700);
  ok('a sound already playing is not started again by another sleep',
    (await player()).at > 100, (await player()).at);
  await page.click('#btnSleep');
  await page.waitForTimeout(500);
  ok('but waking up does stop it', !(await player()).playing);

  // ---------- how much of it the app was awake for ----------

  // The count that says whether this phone goes on running timers with the
  // screen off. Here nothing is asleep and the run lasts seconds, so what is
  // checked is that the two numbers are recorded and shown, not what they are.
  await fresh();
  await openNoise();
  await page.click('#noiseTimers .nz-chip[data-value="15"]');
  await page.waitForTimeout(150);
  await page.click('#noisePlay');
  await page.waitForTimeout(1000);
  await page.evaluate(() => { document.getElementById('noisePlayer').currentTime = 3 * 60; });
  await page.waitForTimeout(300);
  await page.click('#noisePlay');
  await page.waitForTimeout(400);

  const awake = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('baby-tracker-noise-awake') || 'null'));
  ok('the minutes played are taken from the element, which always knows',
    awake && awake.played === 3, awake);
  ok('and the minutes the app was awake for are counted separately',
    awake && awake.awake === 0, awake);

  // What it says is the point of it, so what it says is what is checked. A
  // run watched the whole way through answers nothing, and has to admit so
  // rather than read as a pass.
  const reading = () => page.evaluate(() => ({
    hidden: document.getElementById('noiseAwake').hidden,
    count: document.getElementById('noiseAwakeCount').textContent,
    verdict: document.getElementById('noiseAwakeVerdict').textContent
  }));

  async function seedAwake(record) {
    await page.evaluate(r => localStorage.setItem('baby-tracker-noise-awake', r), record);
    await page.reload();
    await page.waitForTimeout(400);
    await openNoise();
    return reading();
  }

  let says = await seedAwake('{"played":7,"awake":7,"dark":0,"darkAwake":0}');
  ok('a run with the screen on says it proves nothing',
    /says nothing yet/.test(says.verdict), says.verdict);

  says = await seedAwake('{"played":45,"awake":44,"dark":40,"darkAwake":39}');
  ok('a previous night is still there the next morning',
    /45 min of sound.*screen off for 40.*running for 39/.test(says.count), says.count);
  ok('and a phone that kept running is told so',
    /would arrive on time/.test(says.verdict), says.verdict);

  says = await seedAwake('{"played":45,"awake":25,"dark":40,"darkAwake":20}');
  ok('a phone that only slowed down is told that instead',
    /but late/.test(says.verdict), says.verdict);

  // The tolerance has to be a share of the run. Four marks missing out of two
  // hundred and forty-eight is a night the phone kept; the first version
  // measured it against a flat one minute and called that a phone that slows
  // the app down, while the reminder it was doubting had in fact arrived.
  says = await seedAwake(
    '{"played":248,"awake":244,"dark":248,"darkAwake":244,"lag":34}');
  ok('a long run a few marks short is still a phone that kept running',
    /would arrive on time/.test(says.verdict), says.verdict);
  ok('and its minutes of sound are not capped at a quarter of an hour',
    /248 min of sound/.test(says.count), says.count);

  // Nearly all the marks landed, but one gap ran to a quarter of an hour —
  // which is what the answer is actually about, so it is named.
  says = await seedAwake(
    '{"played":60,"awake":60,"dark":60,"darkAwake":58,"lag":900}');
  ok('one long gap is enough to call it late, however many marks landed',
    /but late|late\./.test(says.verdict), says.verdict);
  ok('and how late it would be is named rather than left to the imagination',
    /up to 15m late/.test(says.verdict), says.verdict);

  says = await seedAwake('{"played":45,"awake":8,"dark":40,"darkAwake":3}');
  ok('and one that stopped the app is told the idea will not work',
    /not possible without a server/.test(says.verdict), says.verdict);

  await page.evaluate(() => localStorage.setItem('baby-tracker-noise-awake', 'rubbish'));
  await page.reload();
  await page.waitForTimeout(400);
  await openNoise();
  ok('and rubbish in its place says nothing rather than breaking the screen',
    await page.isHidden('#noiseAwake'));

  await page.click('#noiseBack');
  await page.waitForTimeout(250);

  // ---------- catching up on what happened while nobody was running ----------

  // The screen being off means none of this code ran, so the sound can have
  // finished without anything here noticing. Opening the app again has to
  // put the screen right.
  await openNoise();
  await page.click('#noisePlay');
  await page.waitForTimeout(1000);
  ok('playing again', (await player()).playing);
  await page.evaluate(() => {
    // what a phone does on its own while nothing here is listening
    const a = document.getElementById('noisePlayer');
    const ended = a.onended;
    a.onended = null;
    a.pause();
    a.currentTime = a.duration;
    a.onended = ended;
  });
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); });
  await page.waitForTimeout(400);
  ok('a sound that stopped while the app was away is noticed on the way back',
    !(await fab()).playing);
  ok('and the screen agrees', await page.textContent('#noisePlayLabel') === 'Play');

  // ---------- what is remembered, and where ----------

  await openNoise();
  await page.check('#noiseAuto');
  await page.waitForTimeout(150);
  await page.reload();
  await page.waitForTimeout(500);
  await openNoise();
  ok('the choice survives a reload', await page.isChecked('#noiseAuto'));

  await page.click('#noiseSounds .nz-chip[data-value="pink"]');
  await page.click('#noiseLevels .nz-chip[data-value="4"]');
  await page.click('#noiseTimers .nz-chip[data-value="60"]');
  await page.waitForTimeout(200);
  await page.reload();
  await page.waitForTimeout(500);
  await openNoise();
  ok('so do the sound, the volume and the timer',
    (await picked('#noiseSounds')) === 'pink' &&
    (await picked('#noiseLevels')) === '4' &&
    (await picked('#noiseTimers')) === '60');

  const stored = await page.evaluate(() => localStorage.getItem('baby-tracker-noise'));
  ok('kept under its own key', JSON.parse(stored).sound === 'pink', stored);

  // Which sound suits the room is this phone's business. It has no place in
  // a backup meant for another phone, and none at all in a link.
  await page.click('#noiseBack');
  await page.waitForTimeout(250);
  await page.click('#btnFeed');
  await page.waitForTimeout(400);
  await page.click('#nextUpClose');
  await page.waitForTimeout(250);
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
  ok('and it carries nothing about the noise',
    typeof backup === 'string' && backup.indexOf('noise') === -1);

  // ---------- rubbish in storage ----------

  await page.evaluate(() => localStorage.setItem('baby-tracker-noise',
    '{"sound":"trombone","level":99,"timer":7,"auto":"yes"}'));
  await page.reload();
  await page.waitForTimeout(500);
  await openNoise();
  ok('a sound that does not exist falls back to the default',
    (await picked('#noiseSounds')) === 'brown');
  ok('so does a volume out of range', (await picked('#noiseLevels')) === '2');
  ok('and a timer nobody offered', (await picked('#noiseTimers')) === '45');
  ok('and only a real true switches the sleep button on',
    !(await page.isChecked('#noiseAuto')));

  // It was called "remote" before the notification became the point of it. A
  // phone that had chosen it must not quietly come back making a noise.
  await page.evaluate(() => localStorage.setItem('baby-tracker-noise',
    '{"sound":"remote","level":2,"timer":45,"auto":false}'));
  await page.reload();
  await page.waitForTimeout(500);
  await openNoise();
  ok('a phone that chose it under its old name still has it chosen',
    (await picked('#noiseSounds')) === 'standby');
  ok('and it is still silent', await page.isHidden('#noiseLevels'));

  await page.evaluate(() => localStorage.setItem('baby-tracker-noise', 'not json at all'));
  await page.reload();
  await page.waitForTimeout(500);
  await openNoise();
  ok('rubbish in place of the settings is survivable',
    (await picked('#noiseSounds')) === 'brown');

  ok('nothing threw along the way', errs.length === 0, errs);

  // ---------- the screen-off bookkeeping ----------

  // Its own context, because it needs a clock that can be wound on: the marks
  // are a minute apart and the stretch is measured off the wall clock, and
  // neither can be watched for real in a test. Headless Chromium will not
  // report itself hidden either, so the events are delivered by hand — what
  // is being checked is this app's arithmetic, not the browser's honesty.
  const dark = await b.newContext({ viewport: { width: 390, height: 950 }, timezoneId: 'UTC' });
  await dark.clock.install({ time: new Date('2026-09-23T22:00:00Z') });
  const dim = await dark.newPage();
  dim.on('pageerror', e => errs.push('ERR ' + e.message));
  await dim.goto(APP);
  await dim.waitForTimeout(300);
  await dim.evaluate(() => {
    let away = false;
    Object.defineProperty(document, 'hidden', { get: () => away });
    window.__screen = off => {
      away = off;
      document.dispatchEvent(new Event('visibilitychange'));
    };
  });
  await dim.click('#moreOpen');
  await dim.waitForTimeout(150);
  await dim.click('#noiseOpen');
  await dim.waitForTimeout(250);
  await dim.click('#noiseTimers .nz-chip[data-value="60"]');
  await dim.waitForTimeout(150);
  await dim.click('#noisePlay');
  await dim.waitForTimeout(900);

  await dim.evaluate(() => window.__screen(true));
  await dark.clock.runFor('10:00');
  await dim.evaluate(() => window.__screen(false));
  await dark.clock.runFor('02:00');
  await dim.evaluate(() => { document.getElementById('noisePlayer').currentTime = 12 * 60; });
  await dim.waitForTimeout(300);
  await dim.click('#noisePlay');
  await dim.waitForTimeout(400);

  const book = await dim.evaluate(() =>
    JSON.parse(localStorage.getItem('baby-tracker-noise-awake') || 'null'));
  ok('the stretch with the screen off is measured on its own',
    book && book.dark === 10, book);
  ok('and only the marks made during it are counted against it',
    book && book.darkAwake === 10, book);
  ok('while the total counts the lit minutes too',
    book && book.awake === 12, book);
  ok('and the sound itself is measured off the element, not the clock',
    book && book.played === 12, book);
  ok('which reads as a phone that keeps running',
    /would arrive on time/.test(await dim.textContent('#noiseAwakeVerdict')),
    await dim.textContent('#noiseAwakeVerdict'));

  // A run that is still in the dark when it is stopped must not lose the
  // stretch it was half way through.
  await dim.click('#noisePlay');
  await dim.waitForTimeout(900);
  await dim.evaluate(() => window.__screen(true));
  await dark.clock.runFor('06:00');
  await dim.evaluate(() => { document.getElementById('noisePlayer').currentTime = 6 * 60; });
  await dim.evaluate(() => {
    document.getElementById('noisePlayer').dispatchEvent(new Event('ended'));
  });
  await dim.waitForTimeout(300);
  const ended = await dim.evaluate(() =>
    JSON.parse(localStorage.getItem('baby-tracker-noise-awake') || 'null'));
  ok('a run that ends while the screen is still off keeps its stretch',
    ended && ended.dark === 6 && ended.darkAwake === 6, ended);

  // With no limit the file is looped, and the element goes back to nought at
  // every pass. Read off the element a four-hour night reported twelve
  // minutes, so with no limit the clock is what counts the sound.
  await dim.click('#noiseTimers .nz-chip[data-value="0"]');
  await dim.waitForTimeout(150);
  await dim.click('#noisePlay');
  await dim.waitForTimeout(900);
  await dark.clock.runFor('08:00');
  await dim.evaluate(() => { document.getElementById('noisePlayer').currentTime = 20; });
  await dim.waitForTimeout(200);
  await dim.click('#noisePlay');
  await dim.waitForTimeout(400);
  const looped = await dim.evaluate(() =>
    JSON.parse(localStorage.getItem('baby-tracker-noise-awake') || 'null'));
  ok('a looped run counts the passes rather than the position in the file',
    looped && looped.played === 8, looped);

  // The gaps between the marks, which is what "would it be late" really asks.
  await dim.click('#noisePlay');
  await dim.waitForTimeout(900);
  await dim.evaluate(() => window.__screen(true));
  await dark.clock.runFor('04:00');
  await dark.clock.fastForward('10:00');
  await dim.evaluate(() => window.__screen(false));
  await dim.waitForTimeout(200);
  await dim.click('#noisePlay');
  await dim.waitForTimeout(400);
  const lagged = await dim.evaluate(() =>
    JSON.parse(localStorage.getItem('baby-tracker-noise-awake') || 'null'));
  ok('a stretch the phone slept through is measured as the gap it was',
    lagged && lagged.lag >= 9 * 60, lagged);
  ok('and the screen says how late the reminder would have been',
    /up to 9m late|up to 10m late/.test(
      await dim.textContent('#noiseAwakeVerdict')),
    await dim.textContent('#noiseAwakeVerdict'));

  // ---------- the phone pausing it is not the end of it ----------

  // A notification's chime, a message, another app's sound: the phone pauses
  // whatever is playing, and nothing here asked for it. That used to be taken
  // for the end, and a night's Standby went off at the first message anybody
  // sent — which from the outside looked like the other phone's entries
  // switching it off.
  const on = () => dim.evaluate(() =>
    document.getElementById('noisePlayLabel').textContent !== 'Play');
  const book2 = () => dim.evaluate(() =>
    JSON.parse(localStorage.getItem('baby-tracker-noise-awake') || 'null'));
  await dim.click('#noisePlay');
  await dim.waitForTimeout(900);
  await dark.clock.runFor('03:00');
  await dim.evaluate(() => document.getElementById('noisePlayer').pause());
  await dim.waitForTimeout(100);
  await dark.clock.runFor('00:05');
  await dim.waitForTimeout(300);
  ok('a pause the phone made is taken back rather than taken as the end',
    !(await dim.evaluate(() => document.getElementById('noisePlayer').paused)));
  await dark.clock.runFor('02:00');
  await dim.waitForTimeout(200);
  ok('and the session goes on', await on());
  await dim.click('#noisePlay');
  await dim.waitForTimeout(400);
  let rec = await book2();
  ok('stopped by hand, it is recorded as stopped in the app',
    rec && rec.why === 'app', rec);
  ok('along with the pause it came back from', rec && rec.resumed === 1, rec);
  ok('and the screen says both, with the time',
    /^Stopped in the app at \d\d:\d\d\. The phone paused it once along the way, and it carried on\.$/
      .test(await dim.textContent('#noiseAwakeWhy')),
    await dim.textContent('#noiseAwakeWhy'));

  // A phone call is not a chime, and is not worth fighting for long.
  await dim.click('#noisePlay');
  await dim.waitForTimeout(900);
  await dark.clock.runFor('03:00');
  await dim.evaluate(() => {
    const a = document.getElementById('noisePlayer');
    a.play = () => Promise.reject(new Error('the phone is busy'));
    a.pause();
  });
  await dim.waitForTimeout(100);
  await dark.clock.runFor('01:00');
  await dim.waitForTimeout(200);
  ok('while the phone refuses, it is given a couple of minutes', await on());
  await dark.clock.runFor('02:00');
  await dim.waitForTimeout(300);
  ok('after which the session is called over', !(await on()));
  rec = await book2();
  ok('and put down to the phone', rec && rec.why === 'phone', rec);
  ok('in words', /^Stopped by the phone/.test(await dim.textContent('#noiseAwakeWhy')),
    await dim.textContent('#noiseAwakeWhy'));
  await dim.evaluate(() => { delete document.getElementById('noisePlayer').play; });

  // Each of the other ways out names itself too.
  await dim.click('#noiseTimers .nz-chip[data-value="15"]');
  await dim.waitForTimeout(150);
  await dim.click('#noisePlay');
  await dim.waitForTimeout(900);
  await dark.clock.runFor('03:00');
  await dim.evaluate(() => {
    const a = document.getElementById('noisePlayer');
    a.currentTime = 3 * 60;
    a.dispatchEvent(new Event('ended'));
  });
  await dim.waitForTimeout(300);
  rec = await book2();
  ok('a timer running out says so', rec && rec.why === 'timer', rec);

  ok('and nothing threw in the dark either', errs.length === 0, errs);

  await b.close();
  t.done();
})();
