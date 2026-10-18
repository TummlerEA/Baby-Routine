"use strict";

// Ask an AI through the share menu. A page cannot type into another app, and
// the assistants' apps drop the question a link carries, so the share menu is
// the one road that lands the text in their message box. Checked here with a
// stand-in for the menu: what it is handed, and that it is only offered where
// the phone has one.

const h = require('./helpers');
const t = h.tally();
const ok = t.ok;

(async () => {
  const b = await h.launch();
  const errs = [];

  async function open(withShare, refuse) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 900 } });
    await ctx.addInitScript(([withShare, refuse]) => {
      window.__shared = [];
      if (withShare) {
        navigator.share = function (data) {
          window.__shared.push(data);
          return refuse ? Promise.reject(Object.assign(new Error('no'), { name: refuse }))
            : Promise.resolve();
        };
      } else {
        try { delete Navigator.prototype.share; } catch (e) { /* not there */ }
        navigator.share = undefined;
      }
      localStorage.setItem('baby-tracker-ai', JSON.stringify({ on: true, name: false }));
    }, [withShare, refuse || null]);
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push('ERR ' + e.message));
    await page.goto(h.APP);
    await page.waitForTimeout(500);
    await page.click('#btnFeed');
    await page.waitForTimeout(300);
    await page.click('#aiOpen');
    await page.waitForTimeout(400);
    return { ctx, page };
  }

  let { ctx, page } = await open(true);
  ok('with a share menu, the button is offered', await page.isVisible('#aiShare'));
  ok('and says what it is for', await page.isVisible('#aiShareHint'));
  ok('above the per-service links, which stay',
    (await page.$$('#aiTargets .ai-target')).length === 3);
  await page.click('#aiShare');
  await page.waitForTimeout(300);
  const shared = await page.evaluate(() => window.__shared);
  const preview = await page.evaluate(() => document.getElementById('aiPreview').value);
  ok('one tap opens the menu once', shared.length === 1, shared);
  ok('handing it exactly the text on screen', shared[0] && shared[0].text === preview);
  ok('as text alone, so the apps put it in the message box',
    shared[0] && !shared[0].url && !shared[0].files, shared[0]);
  ok('the text is the summary with its question',
    /--- summary ---/.test(preview) && /My question:/.test(preview));
  ok('and never carries a sync token', !/ghp_|github_pat_/.test(preview));
  await ctx.close();

  ({ ctx, page } = await open(true, 'AbortError'));
  await page.click('#aiShare');
  await page.waitForTimeout(400);
  const toastAfter = () => page.evaluate(() => {
    const t = document.getElementById('toastText');
    return t && !t.closest('[hidden]') ? t.textContent : '';
  });
  ok('closing the menu is not treated as a failure', !/Couldn't/.test(await toastAfter()),
    await toastAfter());
  await ctx.close();

  ({ ctx, page } = await open(true, 'NotAllowedError'));
  await page.click('#aiShare');
  await page.waitForTimeout(400);
  ok('a menu the phone refuses falls back to the clipboard, and says so',
    /Couldn't open the share menu/.test(await toastAfter()), await toastAfter());
  await ctx.close();

  ({ ctx, page } = await open(false));
  ok('without a share menu, the button stays out of the way',
    await page.isHidden('#aiShare') && await page.isHidden('#aiShareHint'));
  ok('and the links are still there', (await page.$$('#aiTargets .ai-target')).length === 3);
  await ctx.close();

  ok('nothing threw', errs.length === 0, errs);
  await b.close();
  t.done();
})();
