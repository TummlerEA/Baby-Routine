"use strict";

// Speaking to the helper: 🎤 beside the box, or 💬 held in the top bar. Asked
// once before the first time, since the browser's recogniser may send the
// sound away; then what it hears is asked or offered for logging exactly as
// if typed. Leaving, typing or tapping 🎤 again puts the microphone down. A
// browser with no recogniser gets the keyboard instead.
//
// The recogniser here is a stand-in that says what it is told to: a real one
// needs a microphone and, in Chromium, Google's servers.

const h = require('./helpers');
const t = h.tally();
const ok = t.ok;

(async () => {
  const b = await h.launch();
  const errs = [];

  async function open(supported) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 900 } });
    await ctx.addInitScript((yes) => {
      if (!yes) {
        delete window.SpeechRecognition;
        delete window.webkitSpeechRecognition;
        window.SpeechRecognition = undefined;
        window.webkitSpeechRecognition = undefined;
        return;
      }
      window.__recs = [];
      class FakeRec {
        constructor() { window.__recs.push(this); }
        start() { this.started = true; }
        stop() { this.end(); }
        abort() { this.aborted = true; this.end(); }
        end() {
          if (this.ended) return;
          this.ended = true;
          setTimeout(() => this.onend && this.onend(), 0);
        }
        say(text, final) {
          this.onresult && this.onresult({ results: [{ 0: { transcript: text }, isFinal: !!final, length: 1 }] });
        }
        fail(code) {
          this.onerror && this.onerror({ error: code });
          this.end();
        }
      }
      window.SpeechRecognition = FakeRec;
      window.webkitSpeechRecognition = FakeRec;
    }, supported);
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push('ERR ' + e.message));
    await page.goto(h.APP);
    await page.waitForTimeout(300);
    return { ctx, page };
  }

  const hold = async (page, ms) => {
    const box = await page.locator('#helperTopOpen').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(ms);
    await page.mouse.up();
    await page.waitForTimeout(150);
  };
  const recs = (page) => page.evaluate(() => window.__recs.map(r => ({ lang: r.lang, started: !!r.started,
    aborted: !!r.aborted, ended: !!r.ended })));
  const rec = (page, js) => page.evaluate(js);
  const last = (page) => page.evaluate(() => {
    const bot = [...document.querySelectorAll('.helper-bot')].pop();
    return { topic: bot && bot.getAttribute('data-topic'), text: bot ? bot.textContent : '' };
  });
  const yous = (page) => page.$$eval('.helper-you', xs => xs.map(x => x.textContent));
  const listening = (page) => page.evaluate(() => document.getElementById('helperMic').classList.contains('listening') &&
    !document.getElementById('helperVoice').hidden);
  const pref = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('baby-tracker-helper-voice') || 'null'));

  let { ctx, page } = await open(true);

  // ---- a tap is still a tap ----
  await hold(page, 100);
  ok('a short tap on 💬 opens the helper', await page.isVisible('#screenHelper'));
  ok('without listening', (await recs(page)).length === 0);
  ok('and 🎤 sits beside the box', await page.isVisible('#helperMic'));
  await page.click('#helperBack');

  // ---- held, the first time ----
  await hold(page, 700);
  ok('held, 💬 opens the helper', await page.isVisible('#screenHelper'));
  ok('the tap a hold ends with does not open it twice',
    (await page.$$eval('.helper-bot', xs => xs.filter(x => /Ask where something is/.test(x.textContent)).length)) === 1);
  let a = await last(page);
  ok('the first time it asks before listening', a.topic === 'voice' && /Apple/.test(a.text) && /Google/.test(a.text), a.text);
  ok('nothing is listening yet', (await recs(page)).length === 0);
  ok('nothing is kept yet', (await pref(page)) === null);

  await page.click('.helper-bot:last-child .helper-action >> text=Turn on and speak');
  await page.waitForTimeout(100);
  let r = await recs(page);
  ok('allowed, it listens', r.length === 1 && r[0].started && r[0].lang === 'en-GB', r);
  ok('and remembers it was allowed', (await pref(page)).on === true);
  ok('the microphone shows it is on', await listening(page));
  ok('in English, with Russian a tap away', /speak English/.test(await page.textContent('#helperVoiceState')) &&
    (await page.textContent('#helperVoiceLang')) === 'По-русски');

  await page.click('#helperVoiceLang');
  await page.waitForTimeout(100);
  r = await recs(page);
  ok('switching language starts again in Russian', r.length === 2 && r[0].aborted && r[1].lang === 'ru-RU', r);
  ok('and the language is remembered', (await pref(page)).lang === 'ru');
  ok('said so on screen', /по-русски/.test(await page.textContent('#helperVoiceState')));
  ok('the old one, put down, asks nothing', (await yous(page)).length === 0);

  await rec(page, () => window.__recs[1].say('покормила левой', false));
  ok('what is heard so far shows in the box', (await page.inputValue('#helperInput')) === 'покормила левой');
  await rec(page, () => window.__recs[1].say('покормила левой 15 минут', true));
  await page.click('#helperMic');
  await page.waitForTimeout(150);
  ok('🎤 again finishes it: the sentence is asked', (await yous(page)).join('|') === 'покормила левой 15 минут',
    await yous(page));
  a = await last(page);
  ok('and offered for logging, as if typed', a.topic === 'log' && /левая грудь, 15 мин/.test(a.text), a.text);
  ok('the microphone is off again', !(await listening(page)));
  ok('the box is empty again', (await page.inputValue('#helperInput')) === '');

  // ---- allowed now, so straight in ----
  await page.click('#helperMic');
  await page.waitForTimeout(80);
  r = await recs(page);
  ok('🎤 listens straight away now', r.length === 3 && r[2].started && r[2].lang === 'ru-RU', r);
  await rec(page, () => window.__recs[2].fail('not-allowed'));
  await page.waitForTimeout(80);
  a = await last(page);
  ok('a refused microphone is explained', a.topic === 'voice' && /Микрофон не разрешён/.test(a.text), a.text);
  ok('and the button is no longer lit', !(await listening(page)));

  await page.click('#helperMic');
  await page.waitForTimeout(50);
  await rec(page, () => window.__recs[3].stop());
  await page.waitForTimeout(80);
  a = await last(page);
  ok('silence says it heard nothing', /Ничего не расслышал/.test(a.text), a.text);

  // ---- put down without asking ----
  const asked = (await yous(page)).length;
  await page.click('#helperMic');
  await page.waitForTimeout(50);
  await rec(page, () => window.__recs[4].say('поменяла подгу', false));
  await page.click('#helperBack');
  await page.waitForTimeout(100);
  ok('leaving the helper puts the microphone down', (await recs(page))[4].aborted);
  ok('and asks nothing half-heard', (await yous(page)).length === asked);

  await page.click('#helperOpen');
  await page.click('#helperMic');
  await page.waitForTimeout(50);
  await page.fill('#helperInput', 'when was the last feed');
  await page.press('#helperInput', 'Enter');
  await page.waitForTimeout(100);
  ok('typing while it listens: the typed question wins', (await recs(page))[5].aborted &&
    (await yous(page)).slice(-1)[0] === 'when was the last feed' && (await last(page)).topic === 'feed');
  await page.click('#helperBack');

  // ---- held again: no second asking ----
  const asks = () => page.$$eval('.helper-bot[data-topic="voice"]', xs => xs.filter(x => /Apple/.test(x.textContent)).length);
  await hold(page, 700);
  r = await recs(page);
  ok('held again, it is listening at once', r.length === 7 && r[6].started && !r[6].ended, r);
  ok('without asking again', (await asks()) === 1);
  ok('in the language last spoken', r[6].lang === 'ru-RU');
  await page.click('#helperBack');

  // ---- Settings ----
  await page.click('#settingsOpen');
  await page.waitForTimeout(150);
  ok('Settings show it is on', await page.isChecked('#helperVoiceOn'));
  await page.uncheck('#helperVoiceOn');
  ok('and turn it off', (await pref(page)).on === false);
  await page.click('#settingsBack');
  await page.click('#helperOpen');
  await page.click('#helperMic');
  await page.waitForTimeout(80);
  ok('off, 🎤 asks first again', (await recs(page)).length === 7 && (await asks()) === 2);
  await ctx.close();

  // ---- no recogniser at all ----
  ({ ctx, page } = await open(false));
  await hold(page, 700);
  ok('with no recogniser, holding 💬 still opens the helper', await page.isVisible('#screenHelper'));
  ok('with the box ready for the keyboard\'s microphone',
    await page.evaluate(() => document.activeElement && document.activeElement.id === 'helperInput'));
  ok('and no 🎤 that could not work', !(await page.isVisible('#helperMic')));
  await page.click('#helperBack');
  await page.click('#settingsOpen');
  await page.waitForTimeout(150);
  ok('Settings say why it cannot be turned on', await page.isDisabled('#helperVoiceOn') &&
    /keyboard/.test(await page.textContent('#helperVoiceHint')));
  await ctx.close();

  ok('no page errors', errs.length === 0, errs);
  await b.close();
  t.done();
})().catch(e => { console.error(e); process.exit(1); });
