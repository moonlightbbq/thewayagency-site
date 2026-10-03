/**
 * The mobile sticky bar pairs Call with Text and keeps the page's quote context;
 * the mobile menu's call/text pair is in the HTML, not injected by app.js
 * (CONV-04, above-the-fold spec Step 6.1-6.2).
 *
 * Drives the real scripts (business-hours.js + attribution.js + app.js, as the
 * build concatenates them) in jsdom at phone width. No network: fetch is stubbed.
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
const { injectNavContact, NAV_CONTACT_HTML } = require('../scripts/builders/seo');

const NAV = '<nav class="nav" id="nav"><div class="nav__inner"><button id="navToggle" class="nav__toggle"></button>'
  + '<div class="nav__links" id="navLinks"><a href="/blog/" class="nav__link">Blog</a><a href="/intake/" class="btn btn--primary">Get a Quote</a></div></div></nav>';

async function loadApp({ url, body = '', width = 390, readyState } = {}) {
  const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>${NAV}${body}</body></html>`, {
    url, runScripts: 'outside-only', pretendToBeVisual: true,
    beforeParse(w) {
      Object.defineProperty(w, 'innerWidth', { value: width, configurable: true });
      w.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.scrollTo = () => {};
    },
  });
  const w = dom.window;
  if (readyState === 'complete') {
    await new Promise((r) => (w.document.readyState === 'complete' ? r() : w.addEventListener('load', () => r())));
  }
  w.eval(APP);
  await new Promise((r) => (w.document.readyState === 'complete' ? r() : w.addEventListener('load', () => r())));
  return w;
}
const hero = (href) => `<section class="hero"><div class="hero__actions"><a href="${href}" class="btn btn--primary btn--lg">Get a Quote</a></div></section>`;
const bar = (w) => w.document.getElementById('stickyMobileCTA');

describe('sticky bar (390 px)', () => {
  const cases = [
    ['/personal/auto', hero('/intake/?product=auto'), '/intake/?product=auto&src=sticky'],
    ['/insurance/owensboro-ky', hero('/intake/?city=Owensboro&state=KY'), '/intake/?city=Owensboro&state=KY&src=sticky'],
    ['/industries/restaurants', hero('/intake/?line=commercial&industry=restaurants'), '/intake/?line=commercial&industry=restaurants&src=sticky'],
    ['/blog/earthquake-insurance', '<article>no hero</article>', '/intake/?src=sticky'],
    // No hero link: the extensionless fallback still carries context.
    ['/personal/auto', '<div></div>', '/intake/?product=auto&src=sticky'],
    ['/insurance/mt-washington-ky', '<div></div>', '/intake/?city=Mt+Washington&state=KY&src=sticky'],
    ['/insurance/daviess-county-ky', '<div></div>', '/intake/?county=Daviess&state=KY&src=sticky'],
    ['/industries/restaurants.html', '<div></div>', '/intake/?line=commercial&industry=restaurants&src=sticky'],
  ];
  for (const [p, body, want] of cases) {
    test(`${p} ${body.includes('hero') ? '(hero)' : '(fallback)'} -> ${want}`, async () => {
      const w = await loadApp({ url: 'https://www.thewayagency.com' + p, body });
      try {
        const q = bar(w).querySelector('.sticky-cta__link--primary');
        assert.equal(q.getAttribute('href'), want);
        assert.equal(q.textContent.trim(), 'Get a Quote');
      } finally { w.close(); }
    });
  }

  test('one tel: and one sms: link, both the agency number, no sms body, built without innerHTML', async () => {
    const w = await loadApp({ url: 'https://www.thewayagency.com/personal/auto', body: hero('/intake/?product=auto') });
    try {
      const links = [...bar(w).querySelectorAll('a')].map((a) => a.getAttribute('href'));
      assert.deepEqual(links.filter((h) => h.startsWith('tel:')), ['tel:+15024135335']);
      assert.deepEqual(links.filter((h) => h.startsWith('sms:')), ['sms:+15024135335']);
      assert.ok(!links.some((h) => /body=/.test(h)));
      assert.equal([...bar(w).querySelectorAll('a')].map((a) => a.textContent.trim()).join('|'), 'Call|Text|Get a Quote');
    } finally { w.close(); }
  });

  test('no sticky bar on desktop widths', async () => {
    const w = await loadApp({ url: 'https://www.thewayagency.com/personal/auto', width: 1366 });
    try { assert.equal(bar(w), null); } finally { w.close(); }
  });

  test('init also runs when app.js is evaluated after DOMContentLoaded', async () => {
    const w = await loadApp({ url: 'https://www.thewayagency.com/personal/auto', body: hero('/intake/?product=auto'), readyState: 'complete' });
    try { assert.ok(bar(w)); } finally { w.close(); }
  });
});

describe('mobile menu', () => {
  test('app.js no longer injects a tel:-only .nav__phone', async () => {
    const w = await loadApp({ url: 'https://www.thewayagency.com/personal/auto' });
    try {
      assert.equal(w.document.querySelectorAll('#navLinks a[href^="tel:"]').length, 0);
    } finally { w.close(); }
  });

  test('injectNavContact puts the pair right before the menu\'s Get a Quote button, once', () => {
    const html = `<html><body>${NAV}</body></html>`;
    const out = injectNavContact(html, '/x.html');
    assert.ok(out.includes(NAV_CONTACT_HTML + '<a href="/intake/" class="btn btn--primary">Get a Quote</a>'));
    assert.equal(injectNavContact(out, '/x.html'), out, 'idempotent');
    assert.match(NAV_CONTACT_HTML, /href="tel:\+15024135335"/);
    assert.match(NAV_CONTACT_HTML, /href="sms:\+15024135335"/);
    assert.doesNotMatch(NAV_CONTACT_HTML, /body=/);
  });

  test('a page with #navLinks but no Get a Quote button fails the build', () => {
    assert.throws(() => injectNavContact('<div id="navLinks"><a href="/blog/">Blog</a></div></nav>', '/bad.html'), /bad\.html/);
  });

  test('pages without the site nav are left alone', () => {
    const html = '<html><body><nav id="nav-phone"></nav></body></html>';
    assert.equal(injectNavContact(html, '/intake/index.html'), html);
  });
});

describe('page type', () => {
  for (const p of ['/contact', '/contact.html']) {
    test(`${p} reports page_type contact`, async () => {
      const w = await loadApp({ url: 'https://www.thewayagency.com' + p, width: 1366 });
      try {
        const ctx = (w.dataLayer || []).find((e) => e && e.event === 'page_context');
        assert.equal(ctx && ctx.page_type, 'contact');
      } finally { w.close(); }
    });
  }
});
