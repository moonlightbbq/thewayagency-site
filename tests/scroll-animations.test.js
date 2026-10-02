/**
 * Scroll animations never hide what is already on screen (PERF-04, above-the-fold
 * spec Step 1.5).
 *
 * initScrollAnimations() set opacity:0 on every .card, .step, .testimonial-card,
 * .section-header and .lob-card at init and waited for an IntersectionObserver to
 * fade them back in, so content in the first viewport blinked out after first paint.
 * It now skips elements that are already in view (or scrolled past), and does nothing
 * for visitors who ask for reduced motion.
 *
 * Drives the real src/js/app.js (with attribution.js prepended, as the build does) in
 * jsdom. jsdom has no layout, so each element's top comes from a data-top attribute.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'src', 'js', 'attribution.js'), 'utf8') + '\n;\n'
  + fs.readFileSync(path.join(ROOT, 'src', 'js', 'app.js'), 'utf8');

const PAGE = `<!DOCTYPE html><html><head></head><body>
  <section class="hero"><h1 class="hero__title">Title</h1></section>
  <div class="section-header" id="head-in-view" data-top="420"></div>
  <div class="card" id="card-in-view" data-top="600"></div>
  <div class="card" id="card-scrolled-past" data-top="-900"></div>
  <div class="card" id="card-below" data-top="1900"></div>
  <div class="step" id="step-below" data-top="2600"></div>
  <div class="product-content"><div class="card" id="card-in-article" data-top="3000"></div></div>
</body></html>`;

async function loadApp({ reduce = false } = {}) {
  const observed = [];
  const dom = new JSDOM(PAGE, {
    url: 'https://www.thewayagency.com/insurance/owensboro-ky',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    beforeParse(w) {
      Object.defineProperty(w, 'innerHeight', { value: 800, configurable: true });
      Object.defineProperty(w, 'innerWidth', { value: 1366, configurable: true });
      w.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ chatEnabled: false }) });
      w.matchMedia = (q) => ({ matches: reduce && /prefers-reduced-motion:\s*reduce/.test(q), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.IntersectionObserver = class {
        constructor(cb, opts) { this.opts = opts || {}; }
        observe(el) { observed.push({ id: el.id, rootMargin: this.opts.rootMargin }); }
        unobserve() {}
        disconnect() {}
      };
      w.Element.prototype.getBoundingClientRect = function () {
        const top = Number(this.getAttribute('data-top') || 0);
        return { top, bottom: top + 100, left: 0, right: 100, width: 100, height: 100, x: 0, y: top };
      };
      w.scrollTo = () => {};
    },
  });
  const w = dom.window;
  w.eval(APP); // like a script at the end of <body>: DOMContentLoaded has not fired yet
  await new Promise((resolve) => {
    if (w.document.readyState === 'complete') return resolve();
    w.addEventListener('load', () => resolve());
  });
  await new Promise((r) => setTimeout(r, 20));
  return { w, observed };
}

// The scroll-animation observer is the one with rootMargin '0px 0px -40px 0px'.
const scrollObserved = (observed) => observed.filter((o) => o.rootMargin === '0px 0px -40px 0px').map((o) => o.id);

describe('initScrollAnimations', () => {
  test('never hides an element that is already in view or scrolled past', async () => {
    const { w, observed } = await loadApp();
    try {
      for (const id of ['head-in-view', 'card-in-view', 'card-scrolled-past']) {
        const el = w.document.getElementById(id);
        assert.equal(el.style.opacity, '', `${id} was hidden`);
        assert.equal(el.style.transform, '', `${id} was moved`);
      }
      assert.ok(!scrollObserved(observed).includes('card-in-view'));
    } finally { w.close(); }
  });

  test('still animates elements below the fold, and leaves article cards alone', async () => {
    const { w, observed } = await loadApp();
    try {
      for (const id of ['card-below', 'step-below']) {
        assert.equal(w.document.getElementById(id).style.opacity, '0', `${id} should start hidden until it scrolls in`);
      }
      assert.deepEqual(scrollObserved(observed).sort(), ['card-below', 'step-below']);
      assert.equal(w.document.getElementById('card-in-article').style.opacity, '');
    } finally { w.close(); }
  });

  test('does nothing for visitors who prefer reduced motion', async () => {
    const { w, observed } = await loadApp({ reduce: true });
    try {
      for (const el of w.document.querySelectorAll('.card, .step, .section-header')) {
        assert.equal(el.style.opacity, '', `${el.id} was hidden under reduced motion`);
      }
      assert.deepEqual(scrollObserved(observed), []);
    } finally { w.close(); }
  });
});
