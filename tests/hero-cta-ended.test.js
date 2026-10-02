/**
 * The homepage hero label never changes after first paint (PERF-04, above-the-fold
 * spec Step 1.4, owner decision D1).
 *
 * The 'hero-cta' A/B test swapped the hero button label inside initABTests(), which
 * runs after first paint, and pushed an ab_exposure that reached neither GA4 nor SAGE.
 * With the hero fade gone the swap would be visible, so the test is ended: the
 * homepage keeps the control label and no hero-cta exposure is pushed.
 *
 *   node --test tests/          (npm test)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'src', 'js', 'attribution.js'), 'utf8') + '\n;\n'
  + fs.readFileSync(path.join(ROOT, 'src', 'js', 'app.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'index.html'), 'utf8');
const HERO_ACTIONS = INDEX.match(/<div class="hero__actions">[\s\S]*?<\/div>/)[0];

for (const variant of ['', 'free-quote', 'compare']) {
  test(`hero label stays as authored${variant ? ` with ?force_variant=${variant}` : ''}`, async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body><section class="hero">${HERO_ACTIONS}</section></body></html>`, {
      url: 'https://www.thewayagency.com/' + (variant ? `?force_variant=${variant}` : ''),
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      beforeParse(w) {
        w.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ chatEnabled: false }) });
        w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
        w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
        w.scrollTo = () => {};
      },
    });
    const w = dom.window;
    const before = w.document.querySelector('.hero__actions').textContent;
    w.eval(APP);
    await new Promise((r) => (w.document.readyState === 'complete' ? r() : w.addEventListener('load', () => r())));
    await new Promise((r) => setTimeout(r, 20));
    try {
      assert.equal(w.document.querySelector('.hero__actions').textContent, before);
      assert.match(before, /Get a Quote/);
      const exposures = (w.dataLayer || []).filter((e) => e && e.event === 'ab_exposure' && e.test_name === 'hero-cta');
      assert.equal(exposures.length, 0, JSON.stringify(exposures));
    } finally { w.close(); }
  });
}
