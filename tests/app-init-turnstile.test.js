/**
 * app.js sets up the page when it runs, and Turnstile loads only where a widget
 * renders (PERF-02, above-the-fold spec Step 2).
 *
 * Every page used to load the Turnstile script deferred ahead of app.js, and app.js
 * wired the menu, forms, sticky bar, chat and click tracking at DOMContentLoaded,
 * which waits for every deferred script. A slow Turnstile request (3 s in the audit's
 * fault test) held all of it on 179 pages that never render a widget.
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
const APP = read('src/js/attribution.js') + '\n;\n' + read('src/js/app.js');
const WIDGET_PAGES = ['src/pages/contact.html', 'src/pages/about/careers/apply.html', 'src/pages/forrest-frank-2026.html'];

function makeDom() {
  const requests = [];
  const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>
    <nav class="nav" id="nav"><button class="nav__toggle" id="navToggle"></button><div class="nav__links" id="navLinks"></div></nav>
    <section class="hero"><h1 class="hero__title">t</h1></section></body></html>`, {
    url: 'https://www.thewayagency.com/insurance/owensboro-ky',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = (u) => { requests.push(String(u)); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ chatEnabled: false }) }); };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.scrollTo = () => {};
    },
  });
  return { w: dom.window, requests };
}
const loaded = (w) => new Promise((r) => (w.document.readyState === 'complete' ? r() : w.addEventListener('load', () => r())));

describe('app.js initialises when it runs', () => {
  test('when evaluated after DOMContentLoaded has already fired', async () => {
    const { w, requests } = makeDom();
    try {
      await loaded(w);
      assert.notEqual(w.document.readyState, 'loading');
      w.eval(APP);
      assert.ok(w.document.querySelector('.nav__backdrop'), 'initNav did not run');
      assert.ok(requests.some((u) => u.includes('/api/status')), 'initChatWidget did not run');
    } finally { w.close(); }
  });

  test('when evaluated while the document is still loading, exactly once', async () => {
    const { w, requests } = makeDom();
    try {
      assert.equal(w.document.readyState, 'loading');
      w.eval(APP);
      await loaded(w);
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(w.document.querySelectorAll('.nav__backdrop').length, 1);
      assert.equal(requests.filter((u) => u.includes('/api/status')).length, 1);
    } finally { w.close(); }
  });
});

describe('Turnstile loads only where a widget renders', () => {
  test('generated pages carry no Turnstile loader or challenges preconnect', () => {
    const { renderScripts } = require('../scripts/shared-templates');
    assert.doesNotMatch(renderScripts(), /challenges\.cloudflare\.com/);
    assert.match(renderScripts(), /<script src="\/src\/js\/app\.js" defer><\/script>/);
    for (const f of ['scripts/builders/pages.js', 'scripts/generate-blog.js']) {
      assert.doesNotMatch(read(f), /challenges\.cloudflare\.com/, f);
    }
  });

  test('handcrafted pages: only the three widget pages load it, async, without a crossorigin preconnect', () => {
    const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.html') ? [path.join(dir, e.name)] : []));
    for (const rel of walk('src/pages')) {
      const html = read(rel);
      const loaders = html.match(/<script\b[^>]*challenges\.cloudflare\.com\/turnstile[^>]*>/g) || [];
      if (WIDGET_PAGES.includes(rel)) {
        assert.equal(loaders.length, 1, rel);
        assert.match(loaders[0], /\sasync>/, rel);
        assert.doesNotMatch(loaders[0], /\sdefer/, rel);
        assert.match(html, /<link rel="preconnect" href="https:\/\/challenges\.cloudflare\.com">/, rel);
      } else {
        assert.doesNotMatch(html, /challenges\.cloudflare\.com/, rel);
      }
      assert.doesNotMatch(html, /preconnect" href="https:\/\/challenges\.cloudflare\.com" crossorigin/, rel);
      for (const tag of html.match(/<script\b[^>]*src="\/src\/js\/app\.js"[^>]*>/g) || []) {
        assert.match(tag, /\sdefer/, `${rel}: app.js must be deferred`);
      }
    }
  });

  test('the widget pages still render their widget whichever script loads first', () => {
    for (const rel of WIDGET_PAGES) {
      const html = read(rel);
      // Rendering is guarded by window.turnstile and re-tried at submit; the loader
      // either calls back (?onload=) or the page listens for its load event.
      assert.match(html, /if \(window\.turnstile\) \{ initTurnstile\(\); \}/, rel);
      assert.ok(/onload=_\w+TurnstileReady/.test(html) || /addEventListener\('load', initTurnstile\)/.test(html), rel);
    }
  });

  test('/intake/ is unchanged: its widget renders at step 4', () => {
    assert.match(read('src/intake.html'), /<script src="https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit" defer><\/script>/);
  });
});
