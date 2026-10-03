/**
 * Keyboard order on narrow screens (PERF-07): the closed mobile menu and the
 * collapsed footer lists leave the tab order; opening the menu moves focus into
 * it and Tab stays there; the toggle names the panel it controls. Anchors clear
 * the fixed nav; footer headings no longer skip levels.
 *
 * Drives the real scripts (business-hours.js + attribution.js + app.js) in jsdom.
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
const { renderNav, renderFooter } = require('../scripts/shared-templates');

const OFFICE = { street: 'PO Box 187', city: 'Owensboro', state: 'KY', zip: '42302', phone: '(502) 413-5335', email: 'hello@thewayagency.com' };

async function load(width) {
  const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>${renderNav()}<main id="main"><a id="content-link" href="#x">x</a></main>${renderFooter(OFFICE, { rating: '5.0', count: 1 })}</body></html>`, {
    url: 'https://www.thewayagency.com/personal/auto', runScripts: 'outside-only', pretendToBeVisual: true,
    beforeParse(w) {
      Object.defineProperty(w, 'innerWidth', { value: width, configurable: true, writable: true });
      w.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.scrollTo = () => {};
    },
  });
  const w = dom.window;
  w.eval(APP);
  await new Promise((r) => (w.document.readyState === 'complete' ? r() : w.addEventListener('load', () => r())));
  return w;
}
const $ = (w, s) => w.document.querySelector(s);
const tab = (w, shiftKey = false) => w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }));

describe('mobile menu (390 px)', () => {
  test('closed: the panel is inert; the toggle has aria-controls and aria-expanded=false', async () => {
    const w = await load(390);
    try {
      assert.ok($(w, '#navLinks').hasAttribute('inert'));
      assert.equal($(w, '#navToggle').getAttribute('aria-controls'), 'navLinks');
      assert.equal($(w, '#navToggle').getAttribute('aria-expanded'), 'false');
    } finally { w.close(); }
  });

  test('open: not inert, focus moves into the panel, collapsed sub-menus stay inert; Escape restores', async () => {
    const w = await load(390);
    try {
      $(w, '#navToggle').click();
      assert.equal($(w, '#navLinks').hasAttribute('inert'), false);
      assert.equal($(w, '#navToggle').getAttribute('aria-expanded'), 'true');
      assert.ok($(w, '#navLinks').contains(w.document.activeElement), 'focus moved into the menu');
      const menus = [...w.document.querySelectorAll('.nav__dropdown-menu')];
      assert.ok(menus.length > 0 && menus.every((m) => m.hasAttribute('inert')), 'collapsed sub-menus are not tab stops');
      // Expanding one sub-menu makes only it reachable.
      const first = $(w, '.nav__dropdown > .nav__link');
      first.click();
      assert.equal(first.parentElement.querySelector('.nav__dropdown-menu').hasAttribute('inert'), false);
      assert.ok(menus.slice(1).every((m) => m.hasAttribute('inert')));
      w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert.ok($(w, '#navLinks').hasAttribute('inert'));
      assert.equal(w.document.activeElement, $(w, '#navToggle'));
    } finally { w.close(); }
  });

  test('open: Tab from the last menu item returns to the toggle, and from the toggle into the menu', async () => {
    const w = await load(390);
    try {
      $(w, '#navToggle').click();
      const items = [...$(w, '#navLinks').querySelectorAll('a[href], button')].filter((el) => !el.closest('[inert]'));
      items[items.length - 1].focus();
      tab(w);
      assert.equal(w.document.activeElement, $(w, '#navToggle'));
      tab(w);
      assert.equal(w.document.activeElement, items[0]);
      tab(w, true); // shift+Tab from the first item goes back to the toggle
      assert.equal(w.document.activeElement, $(w, '#navToggle'));
    } finally { w.close(); }
  });

  test('the menu carries no tel:-only link: the call/text pair comes from the HTML', async () => {
    const w = await load(390);
    try { assert.equal($(w, '#navLinks a[href^="tel:"]'), null); } finally { w.close(); }
  });
});

describe('desktop (1366 px)', () => {
  test('menu and sub-menus are never inert', async () => {
    const w = await load(1366);
    try {
      assert.equal($(w, '#navLinks').hasAttribute('inert'), false);
      assert.equal(w.document.querySelectorAll('.nav__dropdown-menu[inert]').length, 0);
      assert.equal(w.document.querySelectorAll('.footer__link-list[inert]').length, 0);
      assert.equal(w.document.querySelectorAll('.footer__heading[role]').length, 0);
    } finally { w.close(); }
  });
});

describe('footer', () => {
  test('headings are h2 (no skip after content h2s), in the template and every handcrafted page', () => {
    assert.doesNotMatch(renderFooter(OFFICE, {}), /<h4 class="footer__heading"/);
    const pages = [];
    (function walk(d) {
      for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
        const rel = path.join(d, e.name);
        if (e.isDirectory()) walk(rel); else if (e.name.endsWith('.html')) pages.push(rel);
      }
    })('src');
    for (const p of pages) assert.doesNotMatch(read(p), /<h4 class="footer__heading"/, p);
  });

  test('mobile: collapsed lists are inert; a heading is a button that opens its list', async () => {
    const w = await load(390);
    try {
      const h = $(w, '.footer__heading');
      const list = h.nextElementSibling;
      assert.equal(h.getAttribute('role'), 'button');
      assert.equal(h.getAttribute('aria-expanded'), 'false');
      assert.equal(h.getAttribute('aria-controls'), list.id);
      assert.ok(list.hasAttribute('inert'));
      h.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      assert.equal(h.getAttribute('aria-expanded'), 'true');
      assert.equal(list.hasAttribute('inert'), false);
    } finally { w.close(); }
  });
});

describe('anchors and headings in CSS and templates', () => {
  test('scroll-padding clears the fixed nav (base.css and the six compliance pages)', () => {
    assert.match(read('src/css/base.css'), /html\{scroll-padding-top:calc\(var\(--nav-height\) \+ 16px\)\}/);
    for (const n of ['privacy', 'terms', 'disclosures', 'privacy-notice', 'ai-disclosure', 'information-security']) {
      assert.match(read(`src/pages/${n}.html`), /html\{scroll-padding-top:calc\(var\(--nav-height\) \+ 16px\)\}/, n);
    }
  });

  test('/blog/ has an h2 between the h1 and the card h3s', () => {
    assert.match(read('scripts/generate-blog.js'), /<h2 class="sr-only">All articles<\/h2>\s*<div class="grid grid--3" id="blogGrid">/);
  });

  test('the build adds aria-controls/aria-expanded to every menu toggle once', () => {
    const { createInjectVersion } = require('../scripts/builders/seo');
    const inject = createInjectVersion({ buildVersion: 't', gitInfo: { branch: 'b' }, buildDate: 'd', reviews: { count: 1 }, renderHead_GTM: () => '', renderBody_GTM: () => '' });
    for (const btn of ['<button class="nav__toggle" id="navToggle" aria-label="Toggle menu">', '<button class="nav__toggle" id="navToggle" aria-label="Toggle menu" aria-expanded="false">']) {
      const html = `<html><head></head><body><nav><div class="nav__links" id="navLinks"><a href="/intake/" class="btn btn--primary">Get a Quote</a></div>${btn}</nav>gtm.js</body></html>`;
      const out = inject(html, '/x.html').match(/<button[^>]*navToggle[^>]*>/)[0];
      assert.equal((out.match(/aria-controls="navLinks"/g) || []).length, 1, out);
      assert.equal((out.match(/aria-expanded=/g) || []).length, 1, out);
    }
  });
});
