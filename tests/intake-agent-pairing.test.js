/**
 * WAITS ON OA-18 (D11). On /intake/?agent=, the call links switch to the
 * producer's line and the text links stay on the agency line (502) 413-5335.
 * Runs the real page in jsdom; the producer is synthetic.
 *
 *   node --test tests/          (npm test)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'src', 'intake.html'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('?agent=: call goes to the producer, every text link stays on the agency number', async () => {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', url: 'https://www.thewayagency.com/intake/?agent=zz-privacycheck',
    beforeParse(w) {
      w.fetch = (u) => {
        const url = String(u);
        if (url.includes('/api/intake/agent/')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ name: 'Zz Privacycheck', phone: '5555550123', email: 'zz.privacycheck@example.com' }) });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.scrollTo = () => {};
      Object.defineProperty(w.HTMLElement.prototype, 'scrollIntoView', { value: () => {} });
    },
  });
  const w = dom.window;
  try {
    await sleep(80);
    const d = w.document;
    assert.equal(d.getElementById('nav-phone').getAttribute('href'), 'tel:+15555550123');
    assert.equal(d.getElementById('nav-text').getAttribute('href'), 'sms:+15024135335');
    assert.equal(d.getElementById('intake-help-call').getAttribute('href'), 'tel:+15555550123');
    assert.equal(d.getElementById('intake-help-text').getAttribute('href'), 'sms:+15024135335');
    assert.match(d.getElementById('intake-help-float').textContent.replace(/\s+/g, ' '), /Need help\? Call Zz or text \(502\) 413-5335/);
    const card = d.getElementById('agent-contact');
    assert.ok(card.querySelector('a[href="tel:+15555550123"]'));
    assert.ok(card.querySelector('a[href="sms:+15024135335"]'));
    for (const a of d.querySelectorAll('a[href^="sms:"]')) assert.equal(a.getAttribute('href'), 'sms:+15024135335');
  } finally { w.close(); }
});
