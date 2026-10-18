/**
 * A/B 'intake-short-form': control is today's four-step quote form; the short
 * arm submits from step 2 (contact + verified home address on step 1, coverage
 * on step 2, "Get My Quote"). 47% of sessions that start the form never finish
 * it; the owner wants abandonment-vs-lead-quality data before shortening it for
 * everyone, so this ships as a 50/50 test, not a straight change.
 *
 * Drives the REAL src/intake.html in jsdom with src/js/attribution.js inlined and
 * google.maps.places mocked; every fetch is answered locally (nothing reaches
 * SAGE). Synthetic values only.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'src', 'intake.html'), 'utf8');
const ATTR = fs.readFileSync(path.join(ROOT, 'src', 'js', 'attribution.js'), 'utf8');
const ATTR_TAG = '<script src="/src/js/attribution.js"></script>';
const PAGE = HTML.replace(ATTR_TAG, '<script>' + ATTR + '</script>');

// GET /api/intake/rules as SAGE serves it. special_event is COMMERCIAL here and
// absent from the page's local COMMERCIAL_PRODUCTS list.
const RULES = {
  serviceStates: ['KY', 'IN', 'TN'],
  productLines: { auto: 'personal', homeowners: 'personal', renters: 'personal', bop: 'commercial', special_event: 'commercial' },
  stateNames: { KY: 'Kentucky', OH: 'Ohio' }, declineTemplate: "We aren't licensed in {{STATE}}.", stateToken: '{{STATE}}',
};

// The page's bucket, reimplemented independently: 32-bit string hash of
// 'vid:intake-short-form' through the murmur3 fmix32 finalizer, % 2.
function bucket(vid) {
  const str = vid + ':intake-short-form';
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) % 2;
}
function vidFor(arm) {
  for (let i = 0; ; i++) { const vid = 'testvid' + i; if (['control', 'short'][bucket(vid)] === arm) return vid; }
}

function place({ num = '100', route = 'Main St', city = 'Louisville', state = 'KY', zip = '40202' } = {}) {
  return {
    address_components: [
      { long_name: num, short_name: num, types: ['street_number'] },
      { long_name: route.replace('St', 'Street'), short_name: route, types: ['route'] },
      { long_name: city, short_name: city, types: ['locality', 'political'] },
      { long_name: state, short_name: state, types: ['administrative_area_level_1', 'political'] },
      { long_name: zip, short_name: zip, types: ['postal_code'] },
      { long_name: 'United States', short_name: 'US', types: ['country', 'political'] },
    ],
    formatted_address: `${num} ${route}, ${city}, ${state} ${zip}, USA`,
    place_id: 'ChIJ_test_place_1',
  };
}

async function loadIntake({ arm, query = '' } = {}) {
  const posts = [], renders = [], autocompletes = [];
  const dom = new JSDOM(PAGE, {
    runScripts: 'dangerously',
    url: 'https://www.thewayagency.com/intake/' + query,
    beforeParse(w) {
      if (arm) w.localStorage.setItem('twa_vid', vidFor(arm));
      w.google = { maps: { places: { Autocomplete: class {
        constructor(input) { this.input = input; this.listeners = {}; this._place = {}; autocompletes.push(this); }
        addListener(ev, fn) { this.listeners[ev] = fn; }
        getPlace() { return this._place; }
      } } } };
      w.fetch = (input, init) => {
        const href = String(input);
        if (href.includes('/api/intake/rules')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(RULES) });
        if (href.includes('/api/intake/track')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, sessionId: 's1' }) });
        if (href.endsWith('/api/intake')) {
          posts.push(JSON.parse(init.body));
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, reference: 'TEST' }) });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.scrollTo = () => {};
      Object.defineProperty(w.HTMLElement.prototype, 'scrollIntoView', { value: () => {} });
      w.turnstile = { render(sel) { renders.push(sel); return 'w1'; }, reset() {} };
    },
  });
  const w = dom.window;
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 5));
    if (w.serviceStateNames && w.serviceStateNames()) break;
  }
  w.eval("_turnstileSiteKey = 'test-key-test-key-test-key'");
  w.bindIntakeAutocompletes();
  const homeAc = () => autocompletes.find((a) => a.input.id === 'i_address');
  return { w, posts, renders, homeAc };
}

const $ = (w, id) => w.document.getElementById(id);
function fill(w, values) { for (const [id, val] of Object.entries(values)) $(w, id).value = val; }
function pick(homeAc, p) { const ac = homeAc(); ac._place = p; ac.listeners.place_changed(); }
async function throughStep1(w, homeAc, p = place()) {
  fill(w, { i_fname: 'Zz', i_lname: 'Shorttest', i_email: 'zz.shorttest@example.com', i_phone: '(555) 555-0123' });
  pick(homeAc, p);
  w.showStep(1);
  await w.nextStep(1);
  return { advanced: !$(w, 'step-2').classList.contains('hidden'), error: $(w, 'step1-error').textContent };
}
const exposures = (w) => (w.dataLayer || []).filter((e) => e && e.event === 'ab_exposure' && e.test_name === 'intake-short-form');
const gtagEvents = (w) => (w.dataLayer || []).filter((e) => e && e[0] === 'event').map((e) => [e[1], JSON.parse(JSON.stringify(e[2] || {}))]);

describe('assignment and exposure', () => {
  test('a visitor is bucketed by fmix32(hash(vid:test)) % 2, with one exposure', async () => {
    for (const arm of ['control', 'short']) {
      const { w } = await loadIntake({ arm });
      try {
        assert.equal(w.getShortFormArm(), arm);
        const ex = exposures(w);
        assert.equal(ex.length, 1);
        assert.equal(ex[0].variant, arm);
        assert.equal(ex[0].visitor_id, vidFor(arm));
      } finally { w.close(); }
    }
  });

  test('the arm is independent of dob-required and intake-call-or-text (each cell 25% ± 2%)', async () => {
    const { w } = await loadIntake({ arm: 'control' });
    try {
      for (const other of ['dob-required', 'intake-call-or-text']) {
        const cells = [0, 0, 0, 0];
        const N = 40000;
        for (let i = 0; i < N; i++) {
          const vid = 'v' + i.toString(36) + 'x' + (i * 7919).toString(36);
          cells[bucket(vid) * 2 + w.TWA.hashAssign(vid, other, 2)]++;
        }
        for (const c of cells) assert.ok(Math.abs(c / N - 0.25) < 0.02, `${other}: ${cells.join('/')}`);
      }
    } finally { w.close(); }
  });

  test('the id the four-step-form harnesses pin (tests/helpers/intake-arm.js) buckets to control', () => {
    assert.equal(bucket(require('./helpers/intake-arm').CONTROL_VID), 0);
  });

  test('?force_variant= and ?twa_form= pin either arm', async () => {
    for (const [query, arm] of [['?force_variant=short', 'short'], ['?force_variant=control', 'control'], ['?twa_form=short', 'short'], ['?twa_form=long', 'control']]) {
      const { w } = await loadIntake({ arm: arm === 'short' ? 'control' : 'short', query });
      try { assert.equal(w.getShortFormArm(), arm, query); } finally { w.close(); }
    }
  });
});

describe('what each arm sees', () => {
  test('control: today\'s page (no class, business name on step 1, Continue and quick lead on step 2)', async () => {
    const { w } = await loadIntake({ arm: 'control' });
    try {
      assert.equal(w.document.body.classList.contains('twa-intake-short'), false);
      assert.ok($(w, 'biz-name-step1-group').closest('#step-1'));
      assert.notEqual(w.getComputedStyle($(w, 'short-submit')).display, 'block');
      assert.ok($(w, 'quick-lead-link'));
    } finally { w.close(); }
  });

  test('short: the step-2 submit shows, Continue and steps 3-4 do not, business name moves to step 2', async () => {
    const { w } = await loadIntake({ arm: 'short' });
    try {
      assert.equal(w.document.body.classList.contains('twa-intake-short'), true);
      assert.equal(w.getComputedStyle($(w, 'short-submit')).display, 'block');
      assert.equal(w.getComputedStyle(w.document.querySelector('#step-2 > .btn-row')).display, 'none');
      assert.equal(w.getComputedStyle(w.document.querySelector('.progress-label[data-step="3"]')).display, 'none');
      assert.ok($(w, 'biz-name-step1-group').closest('#step-2'));
    } finally { w.close(); }
  });

  test('short: Turnstile renders on step 2, visibly; control still renders on step 4', async () => {
    // showStep(>=2) starts the async Maps prefetch; let it settle before close().
    const settle = () => new Promise((r) => setTimeout(r, 50));
    let { w, renders } = await loadIntake({ arm: 'short' });
    try { w.showStep(2); await settle(); assert.deepEqual(renders, ['#turnstile-step2']); } finally { w.close(); }
    ({ w, renders } = await loadIntake({ arm: 'control' }));
    try {
      w.showStep(2); await settle(); assert.deepEqual(renders, []);
      w.eval("selectedProducts = ['renters']");
      w.showStep(4); await settle(); assert.deepEqual(renders, ['#turnstile-container']);
    } finally { w.close(); }
  });
});

describe('the short submit', () => {
  test('step 1 then "Get My Quote" posts the lead from step 2, tagged with the arm', async () => {
    const { w, posts, homeAc } = await loadIntake({ arm: 'short' });
    try {
      const r = await throughStep1(w, homeAc);
      assert.equal(r.advanced, true, r.error);
      w.eval("selectedProducts = ['renters']; turnstileToken = 'test-token-test-token-test-token-test-token'");
      await w.submitShort();
      assert.equal(posts.length, 1);
      const body = posts[0];
      assert.equal(body.formData.ab_test, 'intake-short-form.short');
      assert.deepEqual(body.products, ['renters']);
      assert.equal(body.address, '100 Main St');
      assert.equal(body.state, 'KY');
      assert.equal(body.zip, '40202');
      assert.equal($(w, 'step-2').classList.contains('hidden'), true);
      assert.equal($(w, 'step-confirm').classList.contains('hidden'), false);
    } finally { w.close(); }
  });

  test('control\'s step-4 submit is untagged', async () => {
    const { w, posts, homeAc } = await loadIntake({ arm: 'control' });
    try {
      const r = await throughStep1(w, homeAc);
      assert.equal(r.advanced, true, r.error);
      w.eval("selectedProducts = ['renters']; turnstileToken = 'test-token-test-token-test-token-test-token'");
      w.showStep(4);
      await w.submitIntake();
      assert.equal(posts.length, 1);
      assert.ok(!('ab_test' in posts[0].formData));
    } finally { w.close(); }
  });

  test('an empty cart holds the visitor on step 2 with the error on screen', async () => {
    const { w, posts, homeAc } = await loadIntake({ arm: 'short' });
    try {
      await throughStep1(w, homeAc);
      await w.submitShort();
      assert.equal(posts.length, 0);
      assert.match($(w, 'step2-error').textContent, /at least one type of coverage/);
      assert.equal($(w, 'step2-error').classList.contains('hidden'), false);
    } finally { w.close(); }
  });

  test('a cart only the server calls commercial asks for the business name, then sends it', async () => {
    const { w, posts, homeAc } = await loadIntake({ arm: 'short' });
    try {
      await throughStep1(w, homeAc);
      w.eval("selectedProducts = ['special_event']; turnstileToken = 'test-token-test-token-test-token-test-token'");
      await w.submitShort();
      assert.equal(posts.length, 0);
      assert.match($(w, 'step2-error').textContent, /business name/);
      assert.notEqual($(w, 'biz-name-step1-group').style.display, 'none');
      fill(w, { i_biz_name_1: 'Fixture Events LLC' });
      await w.submitShort();
      assert.equal(posts.length, 1);
      assert.equal(posts[0].businessName, 'Fixture Events LLC');
    } finally { w.close(); }
  });

  test('a personal cart is never asked for a business name', async () => {
    const { w, posts, homeAc } = await loadIntake({ arm: 'short' });
    try {
      await throughStep1(w, homeAc);
      w.eval("selectedProducts = ['auto']; turnstileToken = 'test-token-test-token-test-token-test-token'");
      await w.submitShort();
      assert.equal(posts.length, 1);
      assert.ok(!posts[0].businessName);
    } finally { w.close(); }
  });

  test('an out-of-area personal cart is declined at the step-2 submit, nothing posted', async () => {
    const { w, posts, homeAc } = await loadIntake({ arm: 'short' });
    try {
      // A bare /intake/ visitor has no line at step 1, so Ohio passes step 1 and the
      // cart is the first thing that can decide it.
      const r = await throughStep1(w, homeAc, place({ city: 'Columbus', state: 'OH', zip: '43004' }));
      assert.equal(r.advanced, true, r.error);
      w.eval("selectedProducts = ['renters']; turnstileToken = 'test-token-test-token-test-token-test-token'");
      await w.submitShort();
      assert.equal(posts.length, 0);
      assert.equal($(w, 'step-confirm').classList.contains('hidden'), true);
    } finally { w.close(); }
  });
});

describe('analytics carry the arm', () => {
  test('intake_* funnel events carry ab_short_form', async () => {
    const { w, homeAc } = await loadIntake({ arm: 'short' });
    try {
      await throughStep1(w, homeAc);
      const evs = gtagEvents(w).filter(([n]) => /^intake_/.test(n));
      assert.ok(evs.length > 0);
      for (const [name, params] of evs) assert.equal(params.ab_short_form, 'short', name);
    } finally { w.close(); }
  });

  test('the conversion push carries ab_short_form', async () => {
    const { w, homeAc } = await loadIntake({ arm: 'short' });
    try {
      await throughStep1(w, homeAc);
      w.eval("selectedProducts = ['renters']; turnstileToken = 'test-token-test-token-test-token-test-token'");
      await w.submitShort();
      const conv = (w.dataLayer || []).find((e) => e && e.event === 'conversion' && e.conversion_type === 'quote_request');
      assert.ok(conv);
      assert.equal(conv.ab_short_form, 'short');
    } finally { w.close(); }
  });
});
