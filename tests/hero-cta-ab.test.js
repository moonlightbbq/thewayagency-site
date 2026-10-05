/**
 * The homepage hero button test is 'hero-cta-v2': "Get a Quote" (control) vs
 * "Get a Free Quote". It replaced 'hero-cta', whose third arm "Compare Rates Now"
 * promised a live comparison the intake form does not do. The two tests share
 * button labels, so every signal names the test and arm itself rather than
 * leaning on the cut-over date: the ab_exposure event, the cta_click event, and
 * the intake link (ab=<test>.<arm>, which SAGE keeps in the lead's lead_page).
 *
 * Drives the real scripts (business-hours.js + attribution.js + app.js, as the
 * build concatenates them) in jsdom. No network: fetch is stubbed.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const APP = ['src/js/business-hours.js', 'src/js/attribution.js', 'src/js/app.js'].map(read).join('\n;\n');

const HERO = '<section class="hero"><div class="hero__actions">'
  + '<a href="/intake/?src=hero" class="btn btn--primary btn--lg" data-ab-test="hero-cta">Get a Quote</a>'
  + '<a href="/about/" class="btn btn--outline-white btn--lg">Learn About Us</a></div></section>'
  + '<footer><a href="/intake/?src=footer" id="footerQuote">Get a Quote</a></footer>';

async function loadHome(query = '', width = 1280) {
  const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>${HERO}</body></html>`, {
    url: 'https://www.thewayagency.com/' + query, runScripts: 'outside-only', pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(), // jsdom logs "navigation not implemented" on a link click
    beforeParse(w) {
      Object.defineProperty(w, 'innerWidth', { value: width, configurable: true });
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
const button = (w) => w.document.querySelector('[data-ab-test="hero-cta"]');
const events = (w, name) => (w.dataLayer || []).filter((e) => e.event === name);

describe('hero-cta-v2', () => {
  for (const [arm, label] of [['control', 'Get a Quote'], ['free-quote', 'Get a Free Quote']]) {
    test(`${arm}: label, exposure, click and intake link all name hero-cta-v2.${arm}`, async () => {
      const w = await loadHome('?force_variant=' + arm);
      try {
        const b = button(w);
        assert.equal(b.textContent.trim(), label);
        assert.equal(b.getAttribute('href'), `/intake/?src=hero&ab=hero-cta-v2.${arm}`);

        const exp = events(w, 'ab_exposure');
        assert.equal(JSON.stringify(exp.map((e) => [e.test_name, e.variant])), JSON.stringify([['hero-cta-v2', arm]]));

        w.document.addEventListener('click', (e) => e.preventDefault());
        b.click();
        const clicks = events(w, 'cta_click');
        assert.equal(clicks.length, 1);
        assert.equal(clicks[0].test_name, 'hero-cta-v2');
        assert.equal(clicks[0].variant, arm);
        assert.equal(clicks[0].cta_text, label);
      } finally { w.close(); }
    });
  }

  test('the old "compare" arm is gone: forcing it falls back to a hashed v2 arm', async () => {
    const w = await loadHome('?force_variant=compare');
    try {
      assert.ok(['Get a Quote', 'Get a Free Quote'].includes(button(w).textContent.trim()));
      assert.match(button(w).getAttribute('href'), /[?&]ab=hero-cta-v2\.(control|free-quote)$/);
      assert.ok(!events(w, 'ab_exposure').some((e) => e.test_name === 'hero-cta'));
    } finally { w.close(); }
    // No variant still swaps the label in (the replacing comment may name it).
    assert.doesNotMatch(read('src/js/app.js'), /:\s*'Compare Rates Now'/);
  });

  test('a quote link no test owns keeps its href and clicks without test_name', async () => {
    const w = await loadHome('?force_variant=free-quote');
    try {
      w.document.addEventListener('click', (e) => e.preventDefault());
      const footer = w.document.getElementById('footerQuote');
      assert.equal(footer.getAttribute('href'), '/intake/?src=footer');
      footer.click();
      const clicks = events(w, 'cta_click');
      assert.equal(clicks.length, 1);
      assert.equal('test_name' in clicks[0], false);
      assert.equal('variant' in clicks[0], false);
    } finally { w.close(); }
  });

  test('the mobile sticky bar copies the hero context but not its A/B tag', async () => {
    const w = await loadHome('?force_variant=free-quote', 390);
    try {
      const q = w.document.querySelector('#stickyMobileCTA .sticky-cta__link--primary');
      assert.equal(q.getAttribute('href'), '/intake/?src=sticky');
      assert.equal(q.dataset.abExperiment, undefined);
    } finally { w.close(); }
  });
});
