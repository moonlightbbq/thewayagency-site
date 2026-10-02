/**
 * The after-hours chat never opens itself, never takes focus and never takes the
 * visitor's keystrokes (CONV-01, above-the-fold spec Step 5).
 *
 * After hours, desktop used to open a 360x480 chat 3 s after load and move focus into
 * it, so typing on /contact landed in the chat. Now: no auto-open on any width, a
 * non-modal teaser instead, no teaser on form pages or once the visitor interacts,
 * focus moves only on a click, and chatbot_opened is pushed only after a click.
 *
 * Drives the real scripts, concatenated as the build does (business-hours.js +
 * attribution.js + app.js), in jsdom with an emulated clock.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const APP = ['src/js/business-hours.js', 'src/js/attribution.js', 'src/js/app.js'].map(read).join('\n;\n');

const AFTER_HOURS = '2026-10-04T02:00:00Z'; // Sat 22:00 ET (21:00 CT)
const IN_HOURS = '2026-10-06T16:00:00Z'; // Tue 12:00 ET
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadApp({ url = 'https://www.thewayagency.com/insurance/owensboro-ky', body = '', width = 1366, now = AFTER_HOURS } = {}) {
  const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body><section class="hero"><h1 class="hero__title">t</h1></section>${body}</body></html>`, {
    url, runScripts: 'outside-only', pretendToBeVisual: true,
    beforeParse(w) {
      Object.defineProperty(w, 'innerWidth', { value: width, configurable: true });
      w.fetch = (u) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(String(u).includes('/api/status') ? { chatEnabled: true } : {}) });
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.scrollTo = () => {};
      const D = w.Date;
      w.Date = class extends D {
        constructor(...a) { super(...(a.length ? a : [now])); }
        static now() { return new D(now).getTime(); }
      };
    },
  });
  const w = dom.window;
  w.eval(APP);
  await new Promise((r) => (w.document.readyState === 'complete' ? r() : w.addEventListener('load', () => r())));
  for (let i = 0; i < 50 && !w.document.querySelector('.twa-cb-bubble'); i++) await sleep(10);
  assert.ok(w.document.querySelector('.twa-cb-bubble'), 'chat bubble did not render');
  return w;
}
const panelOpen = (w) => w.document.querySelector('.twa-cb-panel').classList.contains('open');
const teaser = (w) => !!w.document.querySelector('.twa-cb-teaser');
const chatInput = (w) => w.document.querySelector('.twa-cb-panel input, .twa-cb-panel textarea');
const opened = (w) => (w.dataLayer || []).filter((e) => e && e.event === 'chatbot_opened');

describe('after-hours chat', () => {
  test('desktop, non-form page: no auto-open and no focus after 3.5 s; the teaser shows', async () => {
    const w = await loadApp();
    try {
      await sleep(3500);
      assert.equal(panelOpen(w), false);
      assert.notEqual(w.document.activeElement, chatInput(w));
      assert.equal(opened(w).length, 0, 'chatbot_opened without a click');
      assert.equal(teaser(w), true);
    } finally { w.close(); }
  });

  test('mobile width: teaser, never an open panel', async () => {
    const w = await loadApp({ width: 390 });
    try {
      await sleep(800);
      assert.equal(teaser(w), true);
      assert.equal(panelOpen(w), false);
    } finally { w.close(); }
  });

  for (const [name, opts] of [
    ['/contact', { url: 'https://www.thewayagency.com/contact', body: '<form id="contactForm"><input id="c_fname"></form>' }],
    ['/contact.html', { url: 'https://www.thewayagency.com/contact.html' }],
    ['a page with an inline quote form', { body: '<form class="inline-quote-form"><input name="x"></form>' }],
    ['the careers application', { url: 'https://www.thewayagency.com/about/careers/apply', body: '<form id="applyForm"></form>' }],
    ['the giveaway', { url: 'https://www.thewayagency.com/forrest-frank-2026', body: '<form id="giveawayForm"></form>' }],
  ]) {
    test(`no teaser on ${name}`, async () => {
      const w = await loadApp(opts);
      try {
        await sleep(800);
        assert.equal(teaser(w), false);
        assert.equal(panelOpen(w), false);
      } finally { w.close(); }
    });
  }

  test('no teaser once the visitor has interacted (pointerdown before 500 ms)', async () => {
    const w = await loadApp();
    try {
      w.dispatchEvent(new w.Event('pointerdown'));
      await sleep(800);
      assert.equal(teaser(w), false);
    } finally { w.close(); }
  });

  test('inside business hours: no teaser', async () => {
    const w = await loadApp({ now: IN_HOURS });
    try {
      await sleep(800);
      assert.equal(teaser(w), false);
      assert.equal(panelOpen(w), false);
    } finally { w.close(); }
  });

  test('a bubble click opens the chat, focuses its input, and records trigger "click"', async () => {
    const w = await loadApp();
    try {
      w.document.querySelector('.twa-cb-bubble').click();
      assert.equal(panelOpen(w), true);
      assert.equal(w.document.activeElement, chatInput(w));
      assert.equal(opened(w).map((e) => e.trigger).join(','), 'click');
    } finally { w.close(); }
  });

  test('a teaser click opens the chat with focus', async () => {
    const w = await loadApp();
    try {
      await sleep(700);
      w.document.querySelector('.twa-cb-teaser').click();
      assert.equal(panelOpen(w), true);
      assert.equal(w.document.activeElement, chatInput(w));
    } finally { w.close(); }
  });
});
