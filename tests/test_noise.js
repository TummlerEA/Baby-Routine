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

// Power around one frequency, by Goertzel: every block of the buffer, and
// five neighbouring bins averaged together. Both of those are there to hold
// the estimate steady — one bin of one block of noise varies by several dB
// from run to run, which is enough to fail a true check every few days.
function band(samples, rate, hz) {
  const N = 4096;
  const centre = Math.round(N * hz / rate);
  let acc = 0;
  for (let d = -2; d <= 2; d++) {
    const w = 2 * Math.PI * (centre + d) / N;
    const c = 2 * Math.cos(w);
    let total = 0, blocks = 0;
    for (let off = 0; off + N <= samples.length; off += N) {
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
  return acc / 5;
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

  async function openNoise() {
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
  ok('three sounds', (await chips('#noiseSounds')).join() === 'brown,pink,white');
  ok('four volumes', (await chips('#noiseLevels')).join() === '1,2,3,4');
  ok('a no-limit option sits with the timers',
    (await chips('#noiseTimers')).join() === '15,30,45,60,0');

  const picked = row => page.$eval(row + ' .nz-chip.on', n => n.dataset.value);
  ok('the default sound is the deep one', await picked('#noiseSounds') === 'brown');
  ok('the default volume is low', await picked('#noiseLevels') === '2');
  ok('the default timer is 45 minutes', await picked('#noiseTimers') === '45');
  ok('it does not follow the sleep button until asked',
    !(await page.isChecked('#noiseAuto')));
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

  ok('white is flat', Math.abs(wSlope) < 0.5, wSlope.toFixed(2));
  ok('pink falls 3dB an octave', Math.abs(pSlope + 3) < 0.5, pSlope.toFixed(2));
  ok('brown falls 6dB an octave, once clear of its own leak',
    Math.abs(bHigh + 6) < 0.6, bHigh.toFixed(2));
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
    a.currentTime = a.duration - 0.05;
    a.onended = ended;
  });
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); });
  await page.waitForTimeout(400);
  ok('a sound that stopped while the app was away is noticed on the way back',
    !(await fab()).playing);
  ok('and the screen agrees', await page.textContent('#noisePlayLabel') === 'Play');

  // ---------- what is remembered, and where ----------

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

  await page.evaluate(() => localStorage.setItem('baby-tracker-noise', 'not json at all'));
  await page.reload();
  await page.waitForTimeout(500);
  await openNoise();
  ok('rubbish in place of the settings is survivable',
    (await picked('#noiseSounds')) === 'brown');

  ok('nothing threw along the way', errs.length === 0, errs);

  await b.close();
  t.done();
})();
