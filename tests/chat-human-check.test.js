/**
 * The chat widget sends a Cloudflare Turnstile token with a message that carries
 * contact details (SAGE BL-26 / AIA-017).
 *
 * SAGE creates a lead, pages an agent or emails the visitor only for a chat that
 * passed the human check; without a token it holds the request for a person to
 * call back. So: a message with an email or a phone number goes with a fresh
 * token; other messages carry none; the Turnstile script loads only at that
 * moment (PERF-02), the widget shows only when Cloudflare needs an interaction,
 * and a failed check never stops the message.
 *
 * Drives the real scripts, concatenated as the build does (business-hours.js +
 * attribution.js + app.js), in jsdom. Turnstile and SAGE are stubbed.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IN_HOURS = '2026-10-06T16:00:00Z'; // Tue 12:00 ET: no after-hours teaser

/** A stub Turnstile: render() calls back with `token` (or throws / errors). */
function stubTurnstile(w, { token = 'TEST-turnstile-token', mode = 'ok' } = {}) {
  const calls = { render: [], remove: [] };
  w.turnstile = {
    render(el, opts) {
      calls.render.push({ el, opts });
      if (mode === 'throw') throw new Error('stub render failure');
      setTimeout(() => (mode === 'error' ? opts['error-callback']() : opts.callback(token)), 5);
      return 'widget-1';
    },
    remove(id) { calls.remove.push(id); },
  };
  return calls;
}

async function loadApp({ turnstile } = {}) {
  const posts = [];
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><section class="hero"><h1 class="hero__title">t</h1></section></body></html>', {
    url: 'https://www.thewayagency.com/auto-insurance', runScripts: 'outside-only', pretendToBeVisual: true,
    beforeParse(w) {
      w.TextDecoder = TextDecoder;
      w.fetch = (u, opts = {}) => {
        const url = String(u);
        if (url.includes('/api/chat/message')) {
          posts.push(JSON.parse(opts.body));
          const sse = new TextEncoder().encode('data: {"text":"Thanks!"}\n\ndata: {"done":true,"sessionId":"tst-session"}\n\n');
          let sent = false;
          return Promise.resolve({
            ok: true, status: 200,
            body: { getReader: () => ({ read: () => Promise.resolve(sent ? { done: true } : ((sent = true), { done: false, value: sse })) }) },
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(url.includes('/api/status') ? { chatEnabled: true } : {}) });
      };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.scrollTo = () => {};
      const D = w.Date;
      w.Date = class extends D {
        constructor(...a) { super(...(a.length ? a : [IN_HOURS])); }
        static now() { return new D(IN_HOURS).getTime(); }
      };
    },
  });
  const w = dom.window;
  const calls = turnstile ? stubTurnstile(w, turnstile) : null;
  w.eval(APP);
  await new Promise((r) => (w.document.readyState === 'complete' ? r() : w.addEventListener('load', () => r())));
  for (let i = 0; i < 50 && !w.document.querySelector('.twa-cb-bubble'); i++) await sleep(10);
  assert.ok(w.document.querySelector('.twa-cb-bubble'), 'chat bubble did not render');
  w.document.querySelector('.twa-cb-bubble').click();
  return { w, posts, calls };
}

async function say(w, posts, text) {
  const before = posts.length;
  const input = w.document.querySelector('.twa-cb-panel input');
  input.value = text;
  w.document.querySelector('.twa-cb-input button').click();
  for (let i = 0; i < 200 && posts.length === before; i++) await sleep(10);
  assert.equal(posts.length, before + 1, 'the message was not sent');
  await sleep(20);
  return posts[posts.length - 1];
}

const turnstileScripts = (w) => w.document.querySelectorAll('script[src*="challenges.cloudflare.com/turnstile"]').length;

describe('chat human check (BL-26)', () => {
  test('a message with an email or a phone number goes with a fresh token; the widget shows only for an interaction', async () => {
    const { w, posts, calls } = await loadApp({ turnstile: {} });
    try {
      const withEmail = await say(w, posts, 'Jordan Testcase, jordan@example.com');
      assert.equal(withEmail.cfToken, 'TEST-turnstile-token');
      assert.equal(calls.render.length, 1);
      assert.equal(calls.render[0].opts.appearance, 'interaction-only');
      assert.ok(calls.render[0].opts.sitekey, 'no site key');
      assert.equal(calls.remove.length, 1, 'the widget was not removed after use');
      assert.equal(w.document.querySelectorAll('.twa-cb-verify').length, 0);

      const withPhone = await say(w, posts, 'my number is (502) 555-0142');
      assert.equal(withPhone.cfToken, 'TEST-turnstile-token');
      assert.equal(calls.render.length, 2);
    } finally { w.close(); }
  });

  test('a message without contact details carries no token and runs no check', async () => {
    const { w, posts, calls } = await loadApp({ turnstile: {} });
    try {
      const body = await say(w, posts, 'Hi, I need a quote for my car.');
      assert.equal('cfToken' in body, false);
      assert.equal(calls.render.length, 0);
    } finally { w.close(); }
  });

  test('a check that fails or cannot render never stops the message (SAGE holds it for a person)', async () => {
    for (const mode of ['throw', 'error']) {
      const { w, posts } = await loadApp({ turnstile: { mode } });
      try {
        const body = await say(w, posts, 'jordan@example.com 502-555-0142');
        assert.equal('cfToken' in body, false, mode);
        assert.equal(body.message, 'jordan@example.com 502-555-0142');
      } finally { w.close(); }
    }
  });

  test('the Turnstile script is not loaded with the page, only when contact details are sent', async () => {
    const { w, posts } = await loadApp();
    try {
      assert.equal(turnstileScripts(w), 0);
      await say(w, posts, 'Hello there');
      assert.equal(turnstileScripts(w), 0);
      // jsdom does not fetch the script: install the API as its load would.
      const pending = say(w, posts, 'jordan@example.com');
      await sleep(30);
      assert.equal(turnstileScripts(w), 1);
      const s = w.document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]');
      assert.match(s.getAttribute('src'), /render=explicit/);
      assert.equal(s.async, true);
      stubTurnstile(w);
      const body = await pending;
      assert.equal(body.cfToken, 'TEST-turnstile-token');
    } finally { w.close(); }
  });
});
