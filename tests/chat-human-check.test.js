/**
 * The chat widget sends a Cloudflare Turnstile token with a message that carries
 * contact details (SAGE BL-26 / AIA-017).
 *
 * SAGE creates a lead, pages an agent or emails the visitor only for a chat that
 * passed the human check; without a token it holds the request for a person to
 * call back. So: a message with an email or a phone number goes with a fresh
 * token bound to this chat session (cData) and to the chat (action); other
 * messages carry none; once SAGE says the session is verified no more tokens are
 * fetched; the Turnstile script loads only at that moment (PERF-02) and a
 * blocked script is not waited for twice; the widget shows only when Cloudflare
 * needs an interaction, with a polite live status; a failed check never stops
 * the message; and only a lead SAGE created counts as a lead conversion.
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

/** A stub Turnstile: render() calls back with `token` (or throws / errors / asks for a click). */
function stubTurnstile(w, { token = 'TEST-turnstile-token', mode = 'ok' } = {}) {
  const calls = { render: [], remove: [] };
  w.turnstile = {
    render(el, opts) {
      calls.render.push({ el, opts });
      if (mode === 'throw') throw new Error('stub render failure');
      if (mode === 'interactive') {
        setTimeout(() => opts['before-interactive-callback'](), 5);
        setTimeout(() => opts.callback(token), 40);
      } else {
        setTimeout(() => (mode === 'error' ? opts['error-callback']() : opts.callback(token)), 5);
      }
      return 'widget-1';
    },
    remove(id) { calls.remove.push(id); },
  };
  return calls;
}

/**
 * The page with the widget open. `final(body)` is SAGE's final SSE event for a
 * posted message (default: done, not verified, no action).
 */
async function loadApp({ turnstile, final = () => ({ done: true, sessionId: 'tst-session' }), storage = {} } = {}) {
  const posts = [];
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><section class="hero"><h1 class="hero__title">t</h1></section></body></html>', {
    url: 'https://www.thewayagency.com/auto-insurance', runScripts: 'outside-only', pretendToBeVisual: true,
    beforeParse(w) {
      for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
      w.TextDecoder = TextDecoder;
      w.fetch = (u, opts = {}) => {
        const url = String(u);
        if (url.includes('/api/chat/message')) {
          const body = JSON.parse(opts.body);
          posts.push(body);
          const fin = { sessionId: body.sessionId || 'tst-session', ...final(body), done: true };
          const sse = new TextEncoder().encode(`data: {"text":"Thanks!"}\n\ndata: ${JSON.stringify(fin)}\n\n`);
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
  await sleep(30);
  return posts[posts.length - 1];
}

const turnstileScripts = (w) => w.document.querySelectorAll('script[src*="challenges.cloudflare.com/turnstile"]');
const events = (w, name) => (w.dataLayer || []).filter((e) => e && e.event === name);

describe('chat human check (BL-26)', () => {
  test('a message with an email or a phone number goes with a fresh token bound to the session and the chat; the widget shows only for an interaction', async () => {
    const { w, posts, calls } = await loadApp({ turnstile: {} });
    try {
      const withEmail = await say(w, posts, 'Jordan Testcase, jordan@example.com');
      assert.equal(withEmail.cfToken, 'TEST-turnstile-token');
      assert.equal(calls.render.length, 1);
      const opts = calls.render[0].opts;
      assert.equal(opts.appearance, 'interaction-only');
      assert.equal(opts.action, 'chat');
      assert.ok(opts.sitekey, 'no site key');
      // A brand-new chat gets its session id before its first token, and the
      // message carries the same id the token names.
      assert.match(opts.cData, /^[A-Za-z0-9_-]{8,100}$/);
      assert.equal(withEmail.sessionId, opts.cData);
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

  test('a token is skipped only on the word of a reply for the same session on this page; never from storage, never after SAGE replaced the id', async () => {
    // SAGE: a session is verified from the first message whose token checked out.
    const verifiedSessions = new Set();
    const final = (b) => { if (b.cfToken) verifiedSessions.add(b.sessionId); return { verified: verifiedSessions.has(b.sessionId) }; };
    const { w, posts, calls } = await loadApp({ turnstile: {}, final });
    try {
      await say(w, posts, 'jordan@example.com');
      assert.equal(calls.render.length, 1);
      const next = await say(w, posts, 'and 502-555-0142');
      assert.equal('cfToken' in next, false);          // the last reply, same session: verified
      assert.equal(calls.render.length, 1);
      assert.equal(w.localStorage.getItem('twa_chat_verified'), null);
    } finally { w.close(); }

    // A reload trusts nothing stored: the next contact message carries a token
    // (SAGE skips the check itself when the session is still verified).
    const again = await loadApp({ turnstile: {}, storage: { twa_chat_sid: 'tst-known', twa_chat_verified: 'tst-known', twa_chat_messages: '[]' } });
    try {
      const body = await say(again.w, again.posts, 'jordan@example.com');
      assert.equal(body.sessionId, 'tst-known');
      assert.equal(body.cfToken, 'TEST-turnstile-token');
      assert.equal(again.w.localStorage.getItem('twa_chat_verified'), null, 'the old flag is cleared');
    } finally { again.w.close(); }

    // SAGE replaced the (day-old) id and says the new session is not verified:
    // the next contact message carries a token.
    let n = 0;
    const replaced = await loadApp({ turnstile: {}, final: () => (++n === 1 ? { sessionId: 'tst-old', verified: true } : { sessionId: 'tst-new', verified: false }) });
    try {
      await say(replaced.w, replaced.posts, 'jordan@example.com');
      await say(replaced.w, replaced.posts, 'hello');
      const body = await say(replaced.w, replaced.posts, '502-555-0142');
      assert.equal(body.sessionId, 'tst-new');
      assert.equal(body.cfToken, 'TEST-turnstile-token');
    } finally { replaced.w.close(); }
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

  test('when Cloudflare needs a click, a polite live status says why', async () => {
    const { w, posts } = await loadApp({ turnstile: { mode: 'interactive' } });
    try {
      const input = w.document.querySelector('.twa-cb-panel input');
      input.value = 'jordan@example.com';
      w.document.querySelector('.twa-cb-input button').click();
      await sleep(20);
      const status = w.document.querySelector('.twa-cb-verify .twa-cb-verify-msg');
      assert.ok(status, 'no status element');
      assert.equal(status.getAttribute('role'), 'status');
      assert.equal(status.getAttribute('aria-live'), 'polite');
      assert.match(status.textContent, /quick check/);
      for (let i = 0; i < 100 && posts.length === 0; i++) await sleep(10);
      assert.equal(posts[0].cfToken, 'TEST-turnstile-token');
      assert.equal(w.document.querySelectorAll('.twa-cb-verify').length, 0);
    } finally { w.close(); }
  });

  test('the Turnstile script is not loaded with the page, only when contact details are sent', async () => {
    const { w, posts } = await loadApp();
    try {
      assert.equal(turnstileScripts(w).length, 0);
      await say(w, posts, 'Hello there');
      assert.equal(turnstileScripts(w).length, 0);
      // jsdom does not fetch the script: install the API as its load would.
      const pending = say(w, posts, 'jordan@example.com');
      await sleep(30);
      assert.equal(turnstileScripts(w).length, 1);
      const s = turnstileScripts(w)[0];
      assert.match(s.getAttribute('src'), /render=explicit/);
      assert.equal(s.async, true);
      stubTurnstile(w);
      const body = await pending;
      assert.equal(body.cfToken, 'TEST-turnstile-token');
    } finally { w.close(); }
  });

  test('a blocked script is remembered: the next contact message is sent at once', async () => {
    const { w, posts } = await loadApp();
    try {
      const pending = say(w, posts, 'jordan@example.com');
      await sleep(30);
      turnstileScripts(w)[0].dispatchEvent(new w.Event('error'));
      const first = await pending;
      assert.equal('cfToken' in first, false);
      const started = Date.now();
      const second = await say(w, posts, 'and 502-555-0142');
      assert.equal('cfToken' in second, false);
      assert.ok(Date.now() - started < 1500, 'waited for a script already known to be blocked');
      assert.equal(turnstileScripts(w).length, 1);
    } finally { w.close(); }
  });

  test('only a lead SAGE created (it carries a reference) counts as chatbot_lead_submitted; a held request is its own event; a redrawn card is not tracked', async () => {
    let n = 0;
    const final = () => (++n === 1
      ? { action: 'connect_agent', data: { name: 'Jordan' } }                         // held: no reference
      : { action: 'connect_agent', data: { name: 'Jordan' }, reference: 'TST-REF-1' }); // a lead
    const { w, posts } = await loadApp({ turnstile: {}, final });
    try {
      await say(w, posts, 'jordan@example.com');
      assert.equal(events(w, 'chatbot_lead_submitted').length, 0);
      assert.equal(events(w, 'chatbot_request_received').length, 1);
      await say(w, posts, '502-555-0142');
      assert.equal(events(w, 'chatbot_lead_submitted').length, 1);
    } finally { w.close(); }

    const history = JSON.stringify([{ role: 'bot', text: 'Thanks!', action: { name: 'Jordan', reference: 'TST-REF-1' } }]);
    const reload = await loadApp({ storage: { twa_chat_sid: 'tst-session', twa_chat_messages: history } });
    try {
      await sleep(30);
      assert.ok(reload.w.document.body.textContent.includes('Info submitted'), 'the card was not redrawn');
      assert.equal(events(reload.w, 'chatbot_lead_submitted').length, 0);
      assert.equal(events(reload.w, 'chatbot_request_received').length, 0);
    } finally { reload.w.close(); }
  });
});
