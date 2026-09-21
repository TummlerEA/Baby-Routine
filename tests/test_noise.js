"use strict";

// The white noise. Nothing here is stored or worked out, so what can go wrong
// is different in kind from the rest of the app: a sound that is not the sound
// it says it is, a loop that clicks once every ten seconds all night, a timer
// that never stops, or a blob thrown away while something is still reading it.
//
// The spectrum checks are the point of this file. "It played" is not the same
// claim as "it played brown noise", and only one of them is worth making.

const h = require('./helpers');
const t = h.tally();
const ok = t.ok;
const APP = h.APP;

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
// Where it is measured matters. Brown is made by leaking an integrator, which
// is flat below about 140Hz and only reaches its full 6dB an octave well
// above that — so measured from 200Hz it reads nearer 5.5, and that is the
// filter being what it is rather than anything being wrong.
function slope(samples, rate, lowHz, highHz) {
  const octaves = Math.log2(highHz / lowHz);
  return 10 * Math.log10(band(samples, rate, highHz) / band(samples, rate, lowHz)) / octaves;
}

function readWav(bytes) {
  const buf = Buffer.from(bytes);
  const count = (buf.length - 44) / 2;
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) samples[i] = buf.readInt16LE(44 + i * 2) / 32768;
  return {
    riff: buf.toString('ascii', 0, 4),
    wave: buf.toString('ascii', 8, 12),
    format: buf.readUInt16LE(20),
    channels: buf.readUInt16LE(22),
    rate: buf.readUInt32LE(24),
    bits: buf.readUInt16LE(34),
    declared: buf.readUInt32LE(40),
    actual: count * 2,
    samples: samples
  };
}

(async () => {
  const b = await h.launch();
  const ctx = await b.newContext({
    viewport: { width: 390, height: 950 },
    timezoneId: 'UTC'
  });
  await ctx.clock.install({ time: new Date('2026-09-21T20:00:00Z') });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('ERR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
  page.setDefaultTimeout(8000);

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
      seconds: Math.round(a.duration || 0),
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

  // The bytes the browser is actually being asked to play, fetched back out
  // of the blob. Nothing is inferred from what the code meant to make.
  const wavBytes = () => page.evaluate(async () => {
    const r = await fetch(document.getElementById('noisePlayer').src);
    return Array.from(new Uint8Array(await r.arrayBuffer()));
  });

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

  const measured = {};
  for (const sound of ['brown', 'pink', 'white']) {
    await page.click(`#noiseSounds .nz-chip[data-value="${sound}"]`);
    await page.waitForTimeout(120);
    await page.click('#noisePlay');
    await page.waitForTimeout(700);
    const wav = readWav(await wavBytes());
    measured[sound] = wav;
    await page.click('#noisePlay');
    await page.waitForTimeout(200);
  }

  const brown = measured.brown, pink = measured.pink, white = measured.white;

  ok('what is handed to the player is a WAV',
    brown.riff === 'RIFF' && brown.wave === 'WAVE', [brown.riff, brown.wave]);
  ok('uncompressed 16-bit mono at 44.1kHz',
    brown.format === 1 && brown.channels === 1 && brown.bits === 16 && brown.rate === 44100,
    { format: brown.format, channels: brown.channels, bits: brown.bits, rate: brown.rate });
  ok('the header declares the length the file actually has',
    brown.declared === brown.actual, [brown.declared, brown.actual]);
  ok('the loop is ten seconds long',
    Math.round(brown.samples.length / brown.rate) === 10, brown.samples.length / brown.rate);

  // -3dB and -6dB an octave are what the words pink and brown mean. A sound
  // labelled "deep" that measured flat would be a bug nobody would ever find
  // by looking at it.
  const wSlope = slope(white.samples, white.rate, 200, 3200);
  const pSlope = slope(pink.samples, pink.rate, 200, 3200);
  const bSlope = slope(brown.samples, brown.rate, 200, 3200);
  const bHigh = slope(brown.samples, brown.rate, 800, 6400);

  ok('white is flat', Math.abs(wSlope) < 0.4, wSlope.toFixed(2));
  ok('pink falls 3dB an octave', Math.abs(pSlope + 3) < 0.4, pSlope.toFixed(2));
  ok('brown falls 6dB an octave, once clear of its own knee',
    Math.abs(bHigh + 6) < 0.5, bHigh.toFixed(2));
  ok('brown is steeper than pink across the middle of the range',
    bSlope < pSlope - 2, [bSlope.toFixed(2), pSlope.toFixed(2)]);
  ok('the three are in order, deepest first', bSlope < pSlope && pSlope < wSlope - 2,
    [bSlope.toFixed(2), pSlope.toFixed(2), wSlope.toFixed(2)]);

  function rms(s) {
    let sum = 0;
    for (let i = 0; i < s.length; i++) sum += s[i] * s[i];
    return Math.sqrt(sum / s.length);
  }
  function peak(s) {
    let p = 0;
    for (let i = 0; i < s.length; i++) p = Math.max(p, Math.abs(s[i]));
    return p;
  }

  // Levelled by RMS so the three are about as loud as each other. Brown noise
  // wanders far from zero, and matching peaks instead would make it the
  // quietest of the three by some way.
  const levels = [rms(brown.samples), rms(pink.samples), rms(white.samples)];
  ok('the three sounds are within a hair of the same loudness',
    Math.max.apply(null, levels) / Math.min.apply(null, levels) < 1.1,
    levels.map(v => v.toFixed(3)));
  ok('none of them clips',
    [brown, pink, white].every(w => peak(w.samples) < 0.99),
    [brown, pink, white].map(w => peak(w.samples).toFixed(2)));

  // The join is crossfaded, so the step from the last sample back to the
  // first is an ordinary step and not a click.
  function seamRatio(s) {
    let typical = 0;
    for (let i = 1; i < 20000; i++) typical += Math.abs(s[i] - s[i - 1]);
    typical /= 20000;
    return Math.abs(s[0] - s[s.length - 1]) / typical;
  }
  ok('the loop does not click where it joins',
    [brown, pink, white].every(w => seamRatio(w.samples) < 4),
    [brown, pink, white].map(w => seamRatio(w.samples).toFixed(2)));

  // ---------- volume is in the file, because iOS ignores it anywhere else ----------

  await page.click('#noiseSounds .nz-chip[data-value="brown"]');
  await page.waitForTimeout(120);
  const atLevel = {};
  for (const level of ['1', '4']) {
    await page.click(`#noiseLevels .nz-chip[data-value="${level}"]`);
    await page.waitForTimeout(120);
    await page.click('#noisePlay');
    await page.waitForTimeout(700);
    atLevel[level] = rms(readWav(await wavBytes()).samples);
    await page.click('#noisePlay');
    await page.waitForTimeout(200);
  }
  ok('the volume is written into the samples, not left to the element',
    atLevel['4'] / atLevel['1'] > 5, [atLevel['1'].toFixed(4), atLevel['4'].toFixed(4)]);
  ok('the quietest setting is still audible', atLevel['1'] > 0.005, atLevel['1'].toFixed(4));

  await page.click('#noiseLevels .nz-chip[data-value="2"]');
  await page.waitForTimeout(120);

  // ---------- playing, stopping, and the shortcut ----------

  await page.click('#noisePlay');
  await page.waitForTimeout(700);
  let state = await player();
  ok('play starts something', state.playing, state);
  ok('and it loops', state.loop);
  ok('the button turns into a stop', await page.textContent('#noisePlayLabel') === 'Stop');
  ok('the screen counts down', /45 min left/.test(await page.textContent('#noisePlayNote')),
    await page.textContent('#noisePlayNote'));

  let shortcut = await fab();
  ok('the shortcut comes back while the sound is running', !shortcut.hidden);
  ok('and lights up', shortcut.playing);
  ok('and carries the minutes left', shortcut.left === '45m', shortcut.left);

  await page.click('#noiseBack');
  await page.waitForTimeout(250);
  ok('the shortcut follows onto the main screen', !(await fab()).hidden);

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
  ok('the shortcut goes quiet with it', !(await fab()).playing);
  ok('and hides again once it is off and we are elsewhere', (await fab()).hidden);

  await page.click('#journalBack');
  await page.waitForTimeout(250);
  ok('back on the main screen it is offered again, dimmed',
    !(await fab()).hidden && !(await fab()).playing);
  await page.click('#noiseFab');
  await page.waitForTimeout(700);
  ok('and one tap starts it', (await player()).playing);
  await page.click('#noiseFab');
  await page.waitForTimeout(300);

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

  // ---------- the timer ----------

  await page.click('#noiseTimers .nz-chip[data-value="15"]');
  await page.waitForTimeout(120);
  await page.click('#noisePlay');
  await page.waitForTimeout(700);
  ok('the timer is counted from the moment it starts',
    (await fab()).left === '15m', (await fab()).left);

  // Ten and a half minutes, not ten: at exactly ten the count sits on the
  // boundary between four-and-a-bit and five minutes left, and which side it
  // lands is a question about rounding rather than about the timer.
  await ctx.clock.runFor('10:30');
  await page.waitForTimeout(400);
  ok('the count comes down as the time goes', (await fab()).left === '5m', (await fab()).left);
  ok('and it is still the loop', (await player()).loop);

  await ctx.clock.runFor('05:00');
  await page.waitForTimeout(600);
  state = await player();
  ok('when the time is up it fades rather than cutting out',
    state.playing && !state.loop, state);
  ok('the fade is half a minute long', state.seconds === 30, state.seconds);
  ok('and the screen says so', await page.textContent('#noisePlayNote') === 'Fading out');

  // The tail is a real thirty seconds of audio, so rather than wait it out,
  // drop the needle a quarter-second from the end.
  await page.evaluate(() => {
    const a = document.getElementById('noisePlayer');
    a.currentTime = a.duration - 0.25;
  });
  await page.waitForTimeout(2200);
  state = await player();
  ok('and when the fade runs out it stops itself', !state.playing, state);
  ok('and lets go of the source', state.src === null);
  ok('the screen is back to offering to play', await page.textContent('#noisePlayLabel') === 'Play');
  ok('the shortcut is dark again', !(await fab()).playing);

  // "No limit" has to mean no limit, however long the clock is run on.
  await page.click('#noiseTimers .nz-chip[data-value="0"]');
  await page.waitForTimeout(120);
  ok('with no limit the screen says it will keep going',
    await page.textContent('#noisePlayNote') === 'Deep · Until I stop it',
    await page.textContent('#noisePlayNote'));
  await page.click('#noisePlay');
  await page.waitForTimeout(700);
  ok('no limit means no countdown on the shortcut', (await fab()).left === null);
  await ctx.clock.runFor('02:00:00');
  await page.waitForTimeout(500);
  state = await player();
  ok('and two hours later it is still going', state.playing && state.loop, state);

  // ---------- changing it mid-flight ----------

  await page.click('#noiseSounds .nz-chip[data-value="white"]');
  await page.waitForTimeout(800);
  state = await player();
  ok('changing the sound while it plays keeps it playing', state.playing, state);
  const swapped = readWav(await wavBytes());
  ok('and it really is the other sound now',
    Math.abs(slope(swapped.samples, swapped.rate, 200, 800)) < 0.7,
    slope(swapped.samples, swapped.rate, 200, 800).toFixed(2));

  await page.click('#noiseTimers .nz-chip[data-value="30"]');
  await page.waitForTimeout(400);
  ok('setting a timer on a sound already running starts the clock from now',
    (await fab()).left === '30m', (await fab()).left);
  await page.click('#noisePlay');
  await page.waitForTimeout(300);

  // ---------- following the sleep button ----------

  await fresh();
  await page.click('#btnSleep');
  await page.waitForTimeout(600);
  ok('logging a sleep makes no noise by default', !(await player()).playing);
  await page.click('#btnSleep');
  await page.waitForTimeout(400);

  await openNoise();
  await page.check('#noiseAuto');
  await page.click('#noiseBack');
  await page.waitForTimeout(250);

  await page.click('#btnSleep');
  await page.waitForTimeout(800);
  ok('switched on, the sleep button starts it with no second tap',
    (await player()).playing);
  ok('and the shortcut shows the timer running', (await fab()).left === '45m');

  await page.click('#btnSleep');
  await page.waitForTimeout(500);
  ok('and the wake-up stops it', !(await player()).playing);

  await page.click('#btnWakeChangeFeed');
  await page.waitForTimeout(500);
  ok('the combined wake button counts as a wake-up too', !(await player()).playing);

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
