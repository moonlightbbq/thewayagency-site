/**
 * Google Maps loads on /intake/ only once the visitor leaves step 1, once, and
 * binds each address input once (PERF-06, above-the-fold spec Step 3).
 *
 * Drives the real page in jsdom. jsdom never fetches the Maps script, so the
 * test plays Google's part: a stub google.maps.places.Autocomplete that counts
 * bindings, and a call to the page's own callback.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'src', 'intake.html'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadIntake() {
  const configCalls = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', url: 'https://www.thewayagency.com/intake/',
    beforeParse(w) {
      w.fetch = (u) => {
        const url = String(u);
        if (url.includes('/api/config')) { configCalls.push(url); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ googleMapsKey: 'test-key-test-key-test-key' }) }); }
        if (url.includes('/api/intake/rules')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ serviceStates: ['KY', 'IN', 'TN'], stateNames: { KY: 'Kentucky' } }) });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.scrollTo = () => {};
      Object.defineProperty(w.HTMLElement.prototype, 'scrollIntoView', { value: () => {} });
    },
  });
  const w = dom.window;
  await sleep(60);
  return { w, configCalls };
}
const mapsScripts = (w) => w.document.querySelectorAll('script[src*="maps.googleapis.com"]');
function installGoogle(w) {
  const bound = [];
  w.google = { maps: { places: { Autocomplete: class { constructor(input) { bound.push(input.id); } addListener() {} } } } };
  return bound;
}

describe('/intake/ Google Maps on demand', () => {
  test('no Maps script while only step 1 has been shown', async () => {
    const { w } = await loadIntake();
    try {
      await sleep(100);
      assert.equal(mapsScripts(w).length, 0);
    } finally { w.close(); }
  });

  test('step 2 adds exactly one async loading=async script; repeat visits add none', async () => {
    const { w, configCalls } = await loadIntake();
    try {
      w.showStep(2);
      await sleep(30);
      const s = mapsScripts(w);
      assert.equal(s.length, 1);
      assert.ok(s[0].async);
      assert.match(s[0].src, /loading=async/);
      assert.match(s[0].src, /callback=_initIntakeAutocomplete/);
      w.showStep(1); w.showStep(2); w.showStep(3);
      await sleep(30);
      assert.equal(mapsScripts(w).length, 1);
      assert.equal(configCalls.length, 1, 'Turnstile and Maps share one /api/config request');
    } finally { w.close(); }
  });

  test('callback binds the inputs on screen; 3 -> 2 -> 3 binds the re-rendered property address once and never re-binds the mailing address', async () => {
    const { w } = await loadIntake();
    try {
      w.eval("selectedProducts = ['homeowners']");
      w.showStep(2);
      await sleep(30);
      const bound = installGoogle(w);
      w._initIntakeAutocomplete();
      assert.deepEqual(bound, ['i_address'], 'only the mailing address exists before step 3');
      w.showStep(3);
      const afterFirst = bound.slice();
      assert.ok(w.document.getElementById('i_ho_address'), 'homeowners renders the property address');
      assert.deepEqual(afterFirst, ['i_address', 'i_ho_address']);
      w.showStep(2);
      w.showStep(3); // renderProductQuestions() re-creates #i_ho_address
      assert.deepEqual(bound, ['i_address', 'i_ho_address', 'i_ho_address'], 'the new property input binds once; the mailing input never twice');
      w.showStep(3);
      assert.equal(bound.filter((id) => id === 'i_address').length, 1);
    } finally { w.close(); }
  });

  test('a failed config request is retried on the next step change', async () => {
    let fail = true;
    const dom = new JSDOM(HTML, {
      runScripts: 'dangerously', url: 'https://www.thewayagency.com/intake/',
      beforeParse(w) {
        w.fetch = (u) => {
          if (String(u).includes('/api/config')) {
            if (fail) return Promise.reject(new TypeError('offline'));
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ googleMapsKey: 'test-key-test-key-test-key' }) });
          }
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
        };
        w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
        w.scrollTo = () => {};
        w.console.warn = () => {};
        Object.defineProperty(w.HTMLElement.prototype, 'scrollIntoView', { value: () => {} });
      },
    });
    const w = dom.window;
    try {
      await sleep(40);
      w.showStep(2);
      await sleep(30);
      assert.equal(mapsScripts(w).length, 0);
      fail = false;
      w.showStep(3);
      await sleep(30);
      assert.equal(mapsScripts(w).length, 1);
    } finally { w.close(); }
  });
});
