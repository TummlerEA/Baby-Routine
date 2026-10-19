"use strict";

// The AI on this phone. A test browser has neither the library nor a graphics
// chip that could run the model, so both are stood in for: the stand-in
// records what it was asked and answers the way the real engine streams. What
// is checked is everything around it — what it is handed, where the answer
// lands, what happens when the phone can't, and that 700 MB is never thrown
// away by an update or by the "fetch the latest version" escape.

const h = require('./helpers');
const t = h.tally();
const ok = t.ok;

(async () => {
  const errs = [];

  // ---- 700 MB survives the escape hatch ----
  // What is asked to be deleted, rather than what is gone afterwards: the
  // page moves on after 400 ms whether or not the deleting has finished, and
  // the test browser's caches.keys() does not always answer inside that. The
  // list is handed over at once, so what is checked is the choice alone.
  const b2 = await h.launch();
  let ctx = await b2.newContext();
  let page = await ctx.newPage();
  page.on('pageerror', e => errs.push('ERR ' + e.message));
  await page.goto(h.APP);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    caches.keys = () => Promise.resolve(['webllm/model', 'webllm/baby-tracker-lib', 'baby-tracker-1']);
    caches.delete = (name) => {
      sessionStorage.setItem('deleted', (sessionStorage.getItem('deleted') || '') + name + ';');
      return Promise.resolve(true);
    };
  });
  await page.click('#appVersion');
  await page.waitForURL(/\?r=\d+/);
  await page.waitForTimeout(300);
  const asked = (await page.evaluate(() => sessionStorage.getItem('deleted') || '')).split(';');
  ok('fetching the latest version clears the app\'s own copy', asked.indexOf('baby-tracker-1') >= 0, asked);
  ok('but keeps the downloaded model and its library',
    asked.indexOf('webllm/model') < 0 && asked.indexOf('webllm/baby-tracker-lib') < 0, asked);
  await b2.close();

  const b = await h.launch();

  // gpu: 'f16' (can run), 'plain' (a chip without the feature), or null.
  // fail: what the engine's creation throws, if anything.
  async function open(opts) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 900 } });
    await ctx.addInitScript((o) => {
      window.__engine = { created: 0, asked: [], unloaded: 0, interrupted: 0 };
      // The free space the phone reports, fixed so the test machine's own disk
      // does not decide whether a download is allowed.
      const free = o.freeMb === undefined ? 4000 : o.freeMb;
      navigator.storage.estimate = () => Promise.resolve({ quota: free * 1024 * 1024, usage: 0 });
      if (o.gpu) {
        const features = new Set(o.gpu === 'f16' ? ['shader-f16'] : []);
        Object.defineProperty(navigator, 'gpu', { configurable: true,
          value: { requestAdapter: () => Promise.resolve({ features }) } });
      } else {
        Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined });
      }
      if (o.noStandIn) {
        localStorage.setItem('baby-tracker-ai', JSON.stringify({ on: true }));
        if (o.local) localStorage.setItem('baby-tracker-local-ai', JSON.stringify(o.local));
        return;
      }
      window.__localAiStandIn = {
        CreateMLCEngine(id, config) {
          window.__engine.created++;
          window.__engine.id = id;
          window.__engine.config = config;
          if (o.fail) return Promise.reject(new TypeError(o.fail));
          // The way the real one fails: everything fetched, then the load
          // into memory gives out part of the way through.
          if (o.failAfterLoad && !(o.failOnce && window.__engine.created > 1)) {
            config.initProgressCallback({ progress: 1, text: 'Fetching param cache[2/2]: 700MB fetched.' });
            config.initProgressCallback({ progress: 0.4, text: 'Loading model from cache[1/2]: 280MB loaded.' });
            return Promise.reject(new Error(o.failAfterLoad + '\nat somewhere deep'));
          }
          if (o.hold) {
            config.initProgressCallback({ progress: 1, text: 'Fetching param cache[2/2]: 700MB fetched.' });
            window.__step = () => config.initProgressCallback({ progress: 0.25,
              text: 'Loading model from cache[1/2]: 175MB loaded.' });
            return new Promise(resolve => { window.__go = () => resolve(window.__made()); });
          }
          config.initProgressCallback({ progress: 0.5, text: 'half' });
          return Promise.resolve(window.__made());
        }
      };
      window.__made = () => ({
            chat: { completions: { create(req) {
              window.__engine.asked.push(req);
              const pieces = ['**Feeds** look', ' regular.\n\n* Nappies', ' are fine.'];
              return Promise.resolve({
                [Symbol.asyncIterator]() {
                  let i = 0;
                  return { next: () => Promise.resolve(i < pieces.length
                    ? { done: false, value: { choices: [{ delta: { content: pieces[i++] } }] } }
                    : { done: true }) };
                }
              });
            } } },
            interruptGenerate() { window.__engine.interrupted++; },
            unload() { window.__engine.unloaded++; return Promise.resolve(); }
      });
      localStorage.setItem('baby-tracker-ai', JSON.stringify({ on: !o.aiOff }));
      if (o.local) localStorage.setItem('baby-tracker-local-ai', JSON.stringify(o.local));
      // A sync token in storage, to prove it never reaches the model either.
      if (o.token) {
        localStorage.setItem('baby-tracker-sync', JSON.stringify({ repo: 'me/log', token: 'ghp_SECRETSECRET' }));
      }
    }, opts);
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push('ERR ' + e.message));
    await page.goto(h.APP);
    await page.waitForTimeout(500);
    await page.click('#btnFeed');
    await page.waitForTimeout(300);
    return { ctx, page };
  }

  // Done when the button can be pressed again, however long the stand-in took.
  async function answered(page) {
    await page.waitForFunction(() => window.__engine.created > 0 &&
      !document.getElementById('localAiAsk').disabled, null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(100);
  }

  async function toAi(page) {
    await page.click('#aiOpen');
    await page.waitForTimeout(400);
  }

  async function toSettings(page) {
    await page.click('#settingsOpen');
    await page.waitForTimeout(300);
  }

  // ---- off, as it starts ----
  ({ ctx, page } = await open({ gpu: 'f16', token: true }));
  await toAi(page);
  ok('off by default, the AI screen has no phone answer', !(await page.isVisible('#localAiBlock')));
  ok('and says, as before, that nothing here answers', await page.isVisible('#aiIntroCloud'));
  ok('nothing is created while it is off', await page.evaluate(() => window.__engine.created) === 0);
  await page.click('#aiBack');
  await toSettings(page);
  ok('settings say it is off and nothing is downloaded',
    /Off\. Nothing is downloaded/.test(await page.textContent('#localAiStatus')));
  ok('and offer neither a download nor a removal',
    !(await page.isVisible('#localAiDownload')) && !(await page.isVisible('#localAiRemove')));

  // ---- switched on ----
  await page.check('#localAiOn');
  await page.waitForTimeout(300);
  ok('switching it on is remembered',
    await page.evaluate(() => JSON.parse(localStorage.getItem('baby-tracker-local-ai')).on) === true);
  ok('and offers the download, which is not started by itself',
    await page.isVisible('#localAiDownload') && await page.evaluate(() => window.__engine.created) === 0);
  ok('status says it is not downloaded yet',
    /Not downloaded yet/.test(await page.textContent('#localAiStatus')));
  await page.click('#settingsBack');
  await page.waitForTimeout(200);
  await toAi(page);
  ok('the AI screen now offers an answer on the phone', await page.isVisible('#localAiAsk'));
  ok('naming the download, since it is not there yet',
    /Download it \(about 700 MB\)/.test(await page.textContent('#localAiAsk')));
  ok('and marks where the part that leaves the phone begins', await page.isVisible('#aiCloudHeading'));
  ok('above the bigger AIs, which all stay', (await page.$$('#aiTargets .ai-target')).length === 3);
  ok('the intro says the phone answers first', await page.isVisible('#aiIntroLocal') &&
    !(await page.isVisible('#aiIntroCloud')));

  await page.click('.ai-chip');
  await page.click('#localAiAsk');
  await answered(page);
  const eng = await page.evaluate(() => window.__engine);
  ok('one tap makes one engine', eng.created === 1, eng.created);
  ok('for Gemma 3 1B', eng.id === 'gemma3-1b-it-q4f16_1-MLC', eng.id);
  ok('with the engine pinned by its fingerprint',
    /^sha384-/.test(eng.config.appConfig.model_list[0].integrity.model_lib));
  // The library refuses both a full window and Gemma's own sliding one, and
  // only says so once all 700 MB are in memory.
  const over = eng.config.appConfig.model_list[0].overrides;
  ok('with a full window and the sliding one off, never both',
    over.context_window_size > 0 && over.sliding_window_size === -1, over);
  ok('asked once, as a single message from the user',
    eng.asked.length === 1 && eng.asked[0].messages.length === 1 &&
    eng.asked[0].messages[0].role === 'user', eng.asked);
  const sent = eng.asked[0].messages[0].content;
  ok('handed the same summary a bigger AI would get',
    /--- summary ---/.test(sent) && sent.indexOf(await page.inputValue('#aiPreview')) === 0);
  ok('with the question that was picked', sent.indexOf(await page.inputValue('#aiQuestion')) > 0);
  ok('and never the sync token', !/ghp_|SECRET/.test(sent));
  ok('streamed, and kept short', eng.asked[0].stream === true && eng.asked[0].max_tokens <= 500);
  const answer = await page.textContent('#localAiAnswer');
  ok('the answer lands on the screen', await page.isVisible('#localAiAnswer') && /regular/.test(answer), answer);
  ok('as plain sentences, not Markdown', !/\*/.test(answer) && /• Nappies/.test(answer), answer);
  ok('marked as written on the phone and fallible', await page.isVisible('#localAiNote'));
  ok('the download is remembered as finished',
    await page.evaluate(() => JSON.parse(localStorage.getItem('baby-tracker-local-ai')).ready) === true);
  ok('so the button no longer warns of one',
    (await page.textContent('#localAiAsk')).trim() === '📱 Ask the AI on this phone');

  await page.click('#aiBack');
  await page.waitForTimeout(200);
  ok('leaving the screen gives its memory back',
    await page.evaluate(() => window.__engine.unloaded) === 1);
  await toAi(page);
  ok('coming back starts with a clean slate', !(await page.isVisible('#localAiAnswer')));
  await page.click('#localAiAsk');
  await answered(page);
  ok('and asking again wakes it again', await page.evaluate(() => window.__engine.created) === 2);
  await page.click('#aiBack');
  await page.waitForTimeout(200);

  // ---- removal ----
  await toSettings(page);
  ok('settings say it is ready', /Downloaded and ready/.test(await page.textContent('#localAiStatus')));
  ok('and offer to remove it', await page.isVisible('#localAiRemove'));
  await page.evaluate(() => Promise.all([caches.open('webllm/model'), caches.open('webllm/wasm')]));
  await page.click('#localAiRemove');
  await page.waitForTimeout(400);
  ok('removing it clears every cache it kept',
    (await page.evaluate(() => caches.keys())).filter(n => n.indexOf('webllm/') === 0).length === 0);
  ok('and forgets that it was downloaded',
    await page.evaluate(() => JSON.parse(localStorage.getItem('baby-tracker-local-ai')).ready) === false);
  ok('while staying switched on', await page.isChecked('#localAiOn'));
  await ctx.close();

  // ---- a phone that can't ----
  ({ ctx, page } = await open({ gpu: null, local: { on: true } }));
  await toAi(page);
  ok('with no WebGPU, the button is not offered', !(await page.isVisible('#localAiAsk')));
  const why = await page.textContent('#localAiProgress');
  ok('it says why, and that iOS 26 is the line', /no WebGPU/.test(why) && /iOS 26/.test(why), why);
  ok('and points to the bigger AIs, which still work',
    /bigger AI below/.test(why) && (await page.$$('#aiTargets .ai-target')).length === 3);
  ok('nothing was created', await page.evaluate(() => window.__engine.created) === 0);
  await ctx.close();

  ({ ctx, page } = await open({ gpu: 'plain', local: { on: true } }));
  await toAi(page);
  ok('a chip without half-precision is turned away too',
    /lacks a feature/.test(await page.textContent('#localAiProgress')));
  await ctx.close();

  // ---- a download that fails ----
  ({ ctx, page } = await open({ gpu: 'f16', local: { on: true }, fail: 'Failed to fetch' }));
  await toAi(page);
  await page.click('#localAiAsk');
  await answered(page);
  const failed = await page.textContent('#localAiProgress');
  ok('a dropped connection is named as one', /download stopped/.test(failed), failed);
  ok('with the way out', /bigger AI below/.test(failed));
  ok('and the button works again', !(await page.isDisabled('#localAiAsk')));
  ok('nothing is marked downloaded',
    !(await page.evaluate(() => JSON.parse(localStorage.getItem('baby-tracker-local-ai')).ready)));
  await ctx.close();

  // ---- the two stretches are named apart ----
  ({ ctx, page } = await open({ gpu: 'f16', local: { on: true }, hold: true }));
  await toAi(page);
  await page.click('#localAiAsk');
  await page.waitForFunction(() => typeof window.__step === 'function');
  await page.waitForTimeout(100);
  const fetched = await page.textContent('#localAiProgress');
  ok('while fetching, it says downloading', /^Downloading the model — 100%/.test(fetched), fetched);
  await page.evaluate(() => window.__step());
  await page.waitForTimeout(100);
  const loadingLine = await page.textContent('#localAiProgress');
  ok('loading into memory is not called a download',
    /Loading it into the phone's memory — 25%/.test(loadingLine) && !/Downloading/.test(loadingLine), loadingLine);
  ok('and says the download is done', /^Downloaded\./.test(loadingLine), loadingLine);
  await page.evaluate(() => window.__go());
  await answered(page);
  ok('then it answers', /regular/.test(await page.textContent('#localAiAnswer')));
  await ctx.close();

  // ---- a load that gives out after the download ----
  ({ ctx, page } = await open({ gpu: 'f16', local: { on: true }, failAfterLoad: 'GPUDevice was lost', failOnce: true }));
  await toAi(page);
  await page.click('#localAiAsk');
  await answered(page);
  const lost = await page.textContent('#localAiProgress');
  ok('a load that fails says so, in the library\'s own words', /GPUDevice was lost/.test(lost), lost);
  ok('just the first line of them', !/somewhere deep/.test(lost), lost);
  ok('and only once', lost.split('GPUDevice was lost').length === 2, lost);
  ok('and it is kept, not just shown',
    /GPUDevice was lost/.test(await page.evaluate(() => JSON.parse(localStorage.getItem('baby-tracker-local-ai')).error)));
  await page.click('#aiBack');
  await toSettings(page);
  ok('settings show the last try', /Last try: .*GPUDevice was lost/.test(await page.textContent('#localAiStatus')));
  await page.click('#settingsBack');
  await page.waitForTimeout(200);
  await toAi(page);
  ok('so does the AI screen, opened again',
    /Last try didn't work: .*GPUDevice was lost/.test(await page.textContent('#localAiProgress')));
  await page.click('#localAiAsk');
  await answered(page);
  ok('a try that works answers', /regular/.test(await page.textContent('#localAiAnswer')));
  ok('and forgets the failure',
    !(await page.evaluate(() => JSON.parse(localStorage.getItem('baby-tracker-local-ai')).error)));
  ok('with nothing left on the line', !(await page.isVisible('#localAiProgress')));
  await ctx.close();

  // ---- downloaded means the files are there ----
  // The real check, with no stand-in: the list of pieces and every piece on it.
  ({ ctx, page } = await open({ gpu: 'f16', local: { on: true }, noStandIn: true }));
  const base = 'https://huggingface.co/mlc-ai/gemma3-1b-it-q4f16_1-MLC/resolve/main/';
  await page.evaluate(async (base) => {
    const c = await caches.open('webllm/model');
    await c.put(base + 'tensor-cache.json', new Response(JSON.stringify({ records: [
      { dataPath: 'params_shard_0.bin' }, { dataPath: 'params_shard_1.bin' }] })));
    await c.put(base + 'params_shard_0.bin', new Response('x'));
    await c.put(base + 'params_shard_1.bin', new Response('y'));
  }, base);
  await toSettings(page);
  const filed = await page.textContent('#localAiStatus');
  ok('every piece there reads as downloaded, though it has never run',
    /^Downloaded\. It hasn't run on this phone yet/.test(filed), filed);
  ok('so no second download is offered', !(await page.isVisible('#localAiDownload')));
  ok('and it can be removed', await page.isVisible('#localAiRemove'));
  await page.click('#settingsBack');
  await page.waitForTimeout(200);
  await toAi(page);
  ok('the AI screen asks rather than downloads',
    (await page.textContent('#localAiAsk')).trim() === '📱 Ask the AI on this phone');
  await page.click('#aiBack');
  await page.evaluate(async (base) => {
    await (await caches.open('webllm/model')).delete(base + 'params_shard_1.bin');
  }, base);
  await toSettings(page);
  ok('a piece missing reads as not downloaded',
    /^Not downloaded yet/.test(await page.textContent('#localAiStatus')));
  await page.uncheck('#localAiOn');
  await page.waitForTimeout(200);
  ok('switched off with nothing whole on the phone, it says so',
    /^Off\. Nothing is downloaded/.test(await page.textContent('#localAiStatus')));
  await ctx.close();

  // ---- a phone that is full ----
  ({ ctx, page } = await open({ gpu: 'f16', local: { on: true }, freeMb: 500 }));
  await toAi(page);
  await page.click('#localAiAsk');
  await page.waitForTimeout(500);
  const full = await page.textContent('#localAiProgress');
  ok('a phone short of space is told so before anything downloads',
    /enough free storage/.test(full) && await page.evaluate(() => window.__engine.created) === 0, full);
  await ctx.close();

  // ---- switching it on shows the button it lives behind ----
  ({ ctx, page } = await open({ gpu: 'f16', aiOff: true }));
  ok('with Ask an AI off, its button is hidden', !(await page.isVisible('#aiOpen')));
  await toSettings(page);
  await page.check('#localAiOn');
  await page.waitForTimeout(200);
  ok('switching the phone AI on turns the button on with it', await page.isChecked('#aiEnabled'));
  await ctx.close();

  // ---- and survives an update ----
  const sw = h.source('sw.js');
  const keep = new Function(sw.match(/function isLocalAi[\s\S]*?\n}/)[0] + '; return isLocalAi;')();
  ok('an update keeps the model\'s caches', keep('webllm/model') && keep('webllm/baby-tracker-lib'));
  ok('and still clears old copies of the app', !keep('baby-tracker-108'));
  ok('the worker actually asks before deleting', /CACHE \|\| isLocalAi\(name\)/.test(sw));

  // ---- pinned, not floating ----
  const app = h.source('app.js');
  ok('the library is an exact version', /web-llm@\d+\.\d+\.\d+\/lib\/index\.js/.test(app));
  ok('and has a fingerprint to match', /LOCAL_AI_LIB_SRI = "sha384-[A-Za-z0-9+/]{64}"/.test(app));

  ok('no page errors', errs.length === 0, errs);
  await b.close();
  t.done();
})().catch(e => { console.error(e); process.exit(1); });
