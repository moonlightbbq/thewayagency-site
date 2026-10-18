/**
 * The short quote form (owner, 2026-10-18: "no need for a b, go shorter route
 * every time"). Every /intake/ visitor submits from step 2: contact + verified
 * home address on step 1, coverage on step 2, "Get My Quote". There is no A/B:
 * no assignment, no ab_exposure, no ab_short_form param, no formData.ab_test.
 * ?twa_form=long restores the four-step form for one visit (QA / rollback), and
 * must behave exactly as the four-step form always did.
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
const LONG = '?twa_form=long';
const TOKEN = 'test-token-test-token-test-token-test-token';

// GET /api/intake/rules as SAGE serves it. special_event is COMMERCIAL here and
// absent from the page's local COMMERCIAL_PRODUCTS list. SERVER_ONLY_CL is a
// made-up id SAGE calls commercial that is in NEITHER local list (a product SAGE
// added before the site mirror caught up): only RULES.productLines can flag it.
const SERVER_ONLY_CL = 'zz_server_only_cl';
const RULES = {
  serviceStates: ['KY', 'IN', 'TN'],
  productLines: { auto: 'personal', homeowners: 'personal', renters: 'personal', bop: 'commercial', special_event: 'commercial', [SERVER_ONLY_CL]: 'commercial' },
  stateNames: { KY: 'Kentucky', OH: 'Ohio' }, declineTemplate: "We aren't licensed in {{STATE}}.", stateToken: '{{STATE}}',
};

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

// vid: a twa_vid to seed (the form must not depend on it). postFails: POST
// /api/intake rejects with a network error (the offline-queue path). holdPost:
// POST /api/intake stays pending until release(status) answers it. siteKey:
// false leaves _turnstileSiteKey unset (the config has not arrived yet).
// tracks: every /api/intake/track body, in order.
async function loadIntake({ vid, query = '', rules = true, stub = false, postFails = false, holdPost = false, siteKey = true, draft } = {}) {
  const posts = [], tracks = [], renders = [], autocompletes = [];
  let release = null;
  // stub: the page as served without attribution.js (the resilience stub runs).
  const dom = new JSDOM(stub ? HTML : PAGE, {
    runScripts: 'dangerously',
    url: 'https://www.thewayagency.com/intake/' + query,
    beforeParse(w) {
      if (vid) w.localStorage.setItem('twa_vid', vid);
      if (draft) w.localStorage.setItem('twa_intake_draft', JSON.stringify(draft));
      w.google = { maps: { places: { Autocomplete: class {
        constructor(input) { this.input = input; this.listeners = {}; this._place = {}; autocompletes.push(this); }
        addListener(ev, fn) { this.listeners[ev] = fn; }
        getPlace() { return this._place; }
      } } } };
      w.fetch = (input, init) => {
        const href = String(input);
        if (href.includes('/api/intake/rules')) return rules ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(RULES) }) : Promise.reject(new TypeError('offline'));
        if (href.includes('/api/intake/track')) tracks.push(JSON.parse(init.body));
        if (href.includes('/api/intake/track')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, sessionId: 's1' }) });
        if (href.endsWith('/api/intake')) {
          posts.push(JSON.parse(init.body));
          if (postFails) return Promise.reject(new TypeError('Failed to fetch'));
          if (holdPost) {
            return new Promise((resolve) => {
              // body: what SAGE answers (default: a reference on 200, an error otherwise).
              release = (status = 200, body) => resolve(status === 200
                ? { ok: true, status, json: () => Promise.resolve(body || { ok: true, reference: 'TEST' }) }
                : { ok: false, status, json: () => Promise.resolve(body || { ok: false, error: 'Server error' }) });
            });
          }
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
    if (!rules || (w.serviceStateNames && w.serviceStateNames())) break;
  }
  if (siteKey) w.eval("_turnstileSiteKey = 'test-key-test-key-test-key'");
  w.bindIntakeAutocompletes();
  const homeAc = () => autocompletes.find((a) => a.input.id === 'i_address');
  return { w, posts, tracks, renders, homeAc, release: (status, body) => release(status, body) };
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
// Wait (bounded) for a condition the page reaches asynchronously.
async function until(cond, what) {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(cond(), 'timed out waiting for ' + what);
}
const shortExposures = (w) => (w.dataLayer || []).filter((e) => e && e.event === 'ab_exposure' && e.test_name === 'intake-short-form');
// The step_number of every gtag event called `name`.
const stepsOf = (w, name, msg) => [...gtagEvents(w)].filter(([n, p]) => n === name && (!msg || p.error_message === msg)).map(([, p]) => p.step_number);
const gtagEvents = (w) => (w.dataLayer || []).filter((e) => e && e[0] === 'event').map((e) => [e[1], JSON.parse(JSON.stringify(e[2] || {}))]);
const isShortPage = (w) => w.document.body.classList.contains('twa-intake-short')
  && w.getComputedStyle($(w, 'short-submit')).display === 'block'
  && !!$(w, 'biz-name-step1-group').closest('#step-2');

describe('every visitor gets the short form (no A/B)', () => {
  test('a fixed, a random, no visitor id and the no-attribution.js stub all get the short form', async () => {
    const cases = [{ vid: 'test-vid-control-2' }, { vid: 'testvid0' }, { vid: 'testvid1' },
      { vid: 'rand-' + Math.random().toString(36).slice(2) }, {}, { stub: true }];
    for (const c of cases) {
      const { w } = await loadIntake(c);
      try {
        assert.equal(w.isShortForm(), true, JSON.stringify(c));
        assert.equal(isShortPage(w), true, JSON.stringify(c));
      } finally { w.close(); }
    }
  });

  test('no assignment and no ab_exposure for intake-short-form', async () => {
    const { w } = await loadIntake({ vid: 'testvid1' });
    try {
      assert.equal(shortExposures(w).length, 0);
      for (const fn of ['getShortFormArm', 'isShortFormArm', 'shortFormBucket', 'tagShortFormData']) assert.equal(typeof w[fn], 'undefined', fn);
      // The step-1/2 test still exposes.
      const ex = (w.dataLayer || []).filter((e) => e && e.event === 'ab_exposure').map((e) => e.test_name);
      assert.ok(ex.includes('intake-call-or-text'));
      assert.doesNotMatch(HTML, /ab_short_form|formData\.ab_test\s*=|pushExposure\('intake-short-form'|fmix32/);
    } finally { w.close(); }
  });

  // 'dob-required' only changes the step-3 DOB field, which the short form never
  // shows: exposing default visitors would log them into an arm that changes
  // nothing they see. It stays live on the four-step form only.
  test('dob-required assigns and exposes only on ?twa_form=long', async () => {
    const dobExposures = (w) => (w.dataLayer || []).filter((e) => e && e.event === 'ab_exposure' && e.test_name === 'dob-required');
    for (const vid of ['testvid0', 'testvid1', 'testvid2', 'testvid3', 'testvid4', 'testvid5']) {
      const { w } = await loadIntake({ vid });
      try {
        assert.equal(dobExposures(w).length, 0, vid);
        assert.equal(w.document.body.classList.contains('twa-ab-dob-required'), false, vid);
      } finally { w.close(); }
    }
    const { w } = await loadIntake({ query: LONG });
    try { assert.equal(dobExposures(w).length, 1); } finally { w.close(); }
  });

  test('?force_variant= no longer picks a form', async () => {
    for (const query of ['?force_variant=control', '?force_variant=short']) {
      const { w } = await loadIntake({ query });
      try { assert.equal(isShortPage(w), true, query); } finally { w.close(); }
    }
  });

  test('sage-server\'s contract test still finds the short form by its submit function', () => {
    assert.match(HTML, /function submitShort\(/);
  });

  test('the step-2 submit shows, Continue, quick lead and steps 3-4 do not, business name sits on step 2', async () => {
    const { w } = await loadIntake();
    try {
      assert.equal(w.getComputedStyle($(w, 'short-submit')).display, 'block');
      assert.equal(w.getComputedStyle(w.document.querySelector('#step-2 > .btn-row')).display, 'none');
      assert.equal(w.getComputedStyle($(w, 'quick-lead-link')).display, 'none');
      for (const sel of ['.progress-label[data-step="3"]', '.progress-label[data-step="4"]', '.progress-seg[data-step="3"]', '.progress-seg[data-step="4"]']) {
        assert.equal(w.getComputedStyle(w.document.querySelector(sel)).display, 'none', sel);
      }
      assert.ok($(w, 'biz-name-step1-group').closest('#step-2'));
    } finally { w.close(); }
  });

  test('Turnstile renders on step 2, visibly', async () => {
    const { w, renders } = await loadIntake();
    // showStep(>=2) starts the async Maps prefetch; let it settle before close().
    try { w.showStep(2); await new Promise((r) => setTimeout(r, 50)); assert.deepEqual(renders, ['#turnstile-step2']); } finally { w.close(); }
  });

  test('a site key that arrives after step 2 is shown still mounts the step-2 widget (the bounded retry)', async () => {
    const { w, renders } = await loadIntake({ siteKey: false });
    try {
      w.showStep(2);
      await new Promise((r) => setTimeout(r, 50));
      assert.deepEqual(renders, [], 'nothing can render without a site key');
      w.eval("_turnstileSiteKey = 'test-key-test-key-test-key'");
      await until(() => renders.length > 0, 'the step-2 widget');
      assert.deepEqual(renders, ['#turnstile-step2']);
    } finally { w.close(); }
  });

  test('the time estimate counts two steps, not four, from the first screen', async () => {
    const { w } = await loadIntake();
    try {
      // No showStep(1) here: the first screen is whatever the page shows at load.
      assert.equal($(w, 'step-1').classList.contains('hidden'), false);
      assert.equal($(w, 'time-estimate').textContent, 'About 1 minute left');
      w.showStep(2);
      await new Promise((r) => setTimeout(r, 50));
      assert.equal($(w, 'time-estimate').textContent, 'Almost done!');
      w.showStep(1);
      assert.equal($(w, 'time-estimate').textContent, 'About 1 minute left');
    } finally { w.close(); }
  });
});

describe('the short submit', () => {
  test('step 1 then "Get My Quote" posts the lead from step 2, with no test tag', async () => {
    const { w, posts, homeAc } = await loadIntake();
    try {
      const r = await throughStep1(w, homeAc);
      assert.equal(r.advanced, true, r.error);
      w.eval(`selectedProducts = ['renters']; turnstileToken = '${TOKEN}'`);
      await w.submitShort();
      assert.equal(posts.length, 1);
      const body = posts[0];
      assert.ok(!('ab_test' in body.formData));
      assert.deepEqual(body.products, ['renters']);
      assert.equal(body.address, '100 Main St');
      assert.equal(body.state, 'KY');
      assert.equal(body.zip, '40202');
      assert.equal($(w, 'step-2').classList.contains('hidden'), true);
      assert.equal($(w, 'step-confirm').classList.contains('hidden'), false);
    } finally { w.close(); }
  });

  test('an empty cart holds the visitor on step 2 with the error on screen', async () => {
    const { w, posts, homeAc } = await loadIntake();
    try {
      await throughStep1(w, homeAc);
      await w.submitShort();
      assert.equal(posts.length, 0);
      assert.match($(w, 'step2-error').textContent, /at least one type of coverage/);
      assert.equal($(w, 'step2-error').classList.contains('hidden'), false);
    } finally { w.close(); }
  });

  test('a cart only the server calls commercial asks for the business name, then sends it', async () => {
    const { w, posts, homeAc } = await loadIntake();
    try {
      // Only RULES.productLines can decide this cart: neither local list has the id.
      assert.equal(w.eval('SAGE_CL_PRODUCTS').includes(SERVER_ONLY_CL), false);
      assert.equal(w.eval('COMMERCIAL_PRODUCTS').includes(SERVER_ONLY_CL), false);
      await throughStep1(w, homeAc);
      w.eval(`selectedProducts = ['${SERVER_ONLY_CL}']; turnstileToken = '${TOKEN}'`);
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
    const { w, posts, homeAc } = await loadIntake();
    try {
      await throughStep1(w, homeAc);
      w.eval(`selectedProducts = ['auto']; turnstileToken = '${TOKEN}'`);
      await w.submitShort();
      assert.equal(posts.length, 1);
      assert.ok(!posts[0].businessName);
    } finally { w.close(); }
  });

  test('clicking "Get My Quote" posts once and holds the button disabled until SAGE answers', async () => {
    const { w, posts, homeAc, release } = await loadIntake({ holdPost: true });
    try {
      await throughStep1(w, homeAc);
      w.eval(`selectedProducts = ['renters']; turnstileToken = '${TOKEN}'`);
      const btn = $(w, 'submit-btn-short');
      btn.click();
      await until(() => posts.length === 1, 'the POST');
      assert.equal(btn.disabled, true);
      assert.equal(btn.textContent, 'Submitting...');
      btn.click(); // a second click while pending does not post again
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(posts.length, 1);
      release(200);
      await until(() => !$(w, 'step-confirm').classList.contains('hidden'), 'the confirmation');
      assert.equal(posts.length, 1);
    } finally { w.close(); }
  });

  test('after a failed submit the button is back as "Get My Quote", enabled, with the error on step 2', async () => {
    const { w, posts, homeAc, release } = await loadIntake({ holdPost: true });
    try {
      await throughStep1(w, homeAc);
      w.eval(`selectedProducts = ['renters']; turnstileToken = '${TOKEN}'`);
      const btn = $(w, 'submit-btn-short');
      btn.click();
      await until(() => posts.length === 1, 'the POST');
      release(500);
      await until(() => !btn.disabled, 'the button to re-enable');
      assert.equal(btn.textContent, 'Get My Quote');
      assert.equal($(w, 'step2-error').classList.contains('hidden'), false);
      assert.equal($(w, 'step-confirm').classList.contains('hidden'), true);
    } finally { w.close(); }
  });

  test('the Back button beside "Get My Quote" returns to step 1', async () => {
    const { w, homeAc } = await loadIntake();
    try {
      await throughStep1(w, homeAc);
      w.document.querySelector('#short-submit [data-action="prev-step"]').click();
      assert.equal($(w, 'step-1').classList.contains('hidden'), false);
      assert.equal($(w, 'step-2').classList.contains('hidden'), true);
    } finally { w.close(); }
  });

  test('an out-of-area personal cart is declined at the step-2 submit, nothing posted', async () => {
    const { w, posts, homeAc } = await loadIntake();
    try {
      // A bare /intake/ visitor has no line at step 1, so Ohio passes step 1 and the
      // cart is the first thing that can decide it.
      const r = await throughStep1(w, homeAc, place({ city: 'Columbus', state: 'OH', zip: '43004' }));
      assert.equal(r.advanced, true, r.error);
      w.eval(`selectedProducts = ['renters']; turnstileToken = '${TOKEN}'`);
      await w.submitShort();
      assert.equal(posts.length, 0);
      assert.equal($(w, 'step-confirm').classList.contains('hidden'), true);
      assert.match($(w, 'step2-error').textContent, /aren't licensed in Ohio/);
    } finally { w.close(); }
  });
});

describe('the short form\'s business name', () => {
  test('picking a commercial tile shows the field; leaving the cart personal hides it again', async () => {
    const { w, homeAc } = await loadIntake();
    try {
      await throughStep1(w, homeAc);
      const tile = (pid) => w.document.querySelector(`.product-opt[data-pid="${pid}"]`);
      assert.equal($(w, 'biz-name-step1-group').style.display, 'none');
      w.toggleProd(tile('bop'));
      assert.notEqual($(w, 'biz-name-step1-group').style.display, 'none');
      w.toggleProd(tile('bop'));
      assert.equal($(w, 'biz-name-step1-group').style.display, 'none');
    } finally { w.close(); }
  });

  test('with the rules fetch down, a special-event cart shows the field on step 2, then posts the name', async () => {
    const { w, posts, homeAc } = await loadIntake({ rules: false });
    try {
      await throughStep1(w, homeAc);
      w.eval(`selectedProducts = ['special_event']; turnstileToken = '${TOKEN}'`);
      await w.submitShort();
      assert.equal(posts.length, 0);
      assert.match($(w, 'step2-error').textContent, /business name/);
      const grp = $(w, 'biz-name-step1-group');
      assert.notEqual(grp.style.display, 'none');
      assert.ok(grp.closest('#step-2'), 'the field the error asks for is on the step the visitor is on');
      fill(w, { i_biz_name_1: 'Fixture Fairs LLC' });
      await w.submitShort();
      assert.equal(posts.length, 1);
      assert.equal(posts[0].businessName, 'Fixture Fairs LLC');
    } finally { w.close(); }
  });

  // Commercial arrivals see the field from page load and, as on the four-step
  // form, give it on step 1: the step-1 lead SAGE pages a producer for (and opens
  // a commercial sales card from) must already carry the business name.
  test('a ?product=bop arrival is asked for the name on step 1, and the step-1 lead carries it', async () => {
    const { w, posts, tracks, homeAc } = await loadIntake({ query: '?product=bop' });
    try {
      const grp = $(w, 'biz-name-step1-group');
      assert.notEqual(grp.style.display, 'none');
      assert.ok(grp.closest('#step-1'));
      let r = await throughStep1(w, homeAc);
      assert.equal(r.advanced, false);
      assert.match(r.error, /business name/);
      fill(w, { i_biz_name_1: 'Fixture Bop LLC' });
      r = await throughStep1(w, homeAc);
      assert.equal(r.advanced, true, r.error);
      await until(() => tracks.some((t) => t.notify && t.businessName === 'Fixture Bop LLC'), 'step-1 /track with the business name');
      w.eval(`if (!selectedProducts.includes('bop')) selectedProducts = ['bop']; turnstileToken = '${TOKEN}'`);
      await w.submitShort();
      assert.equal(posts.length, 1);
      assert.equal(posts[0].businessName, 'Fixture Bop LLC');
    } finally { w.close(); }
  });

  test('a commercial arrival resumed on step 2 is asked for the name ON step 2 (the draft never keeps it)', async () => {
    const a = await loadIntake({ query: '?product=bop' });
    let saved;
    try {
      fill(a.w, { i_biz_name_1: 'Fixture Bop LLC' });
      const r = await throughStep1(a.w, a.homeAc);
      assert.equal(r.advanced, true, r.error);
      a.w.eval("if (!selectedProducts.includes('bop')) selectedProducts = ['bop']");
      a.w.saveDraft();
      saved = JSON.parse(a.w.localStorage.getItem('twa_intake_draft'));
      assert.equal(saved.step, 2);
      assert.doesNotMatch(JSON.stringify(saved), /Fixture Bop/);
    } finally { a.w.close(); }
    const { w, posts } = await loadIntake({ query: '?product=bop', draft: saved });
    try {
      $(w, 'draft-resume-btn').click();
      assert.equal($(w, 'step-2').classList.contains('hidden'), false);
      const grp = $(w, 'biz-name-step1-group');
      assert.ok(grp.closest('#step-2'), 'the field is on the step the visitor is on');
      assert.notEqual(grp.style.display, 'none');
      w.eval(`turnstileToken = '${TOKEN}'`);
      await w.submitShort();
      assert.equal(posts.length, 0);
      assert.match($(w, 'step2-error').textContent, /business name/);
      fill(w, { i_biz_name_1: 'Fixture Bop LLC' });
      await w.submitShort();
      assert.equal(posts.length, 1);
      assert.equal(posts[0].businessName, 'Fixture Bop LLC');
    } finally { w.close(); }
  });

  test('a ?line=commercial arrival keeps the field on step 1 through tile toggles and sends the name for any cart', async () => {
    const { w, posts, homeAc } = await loadIntake({ query: '?line=commercial' });
    try {
      fill(w, { i_biz_name_1: 'Fixture Landlord LLC' });
      const r = await throughStep1(w, homeAc);
      assert.equal(r.advanced, true, r.error);
      const grp = $(w, 'biz-name-step1-group');
      assert.ok(grp.closest('#step-1'));
      // dwelling_fire is offered under commercial but needs no name in SAGE.
      const tile = () => w.document.querySelector('.product-opt[data-pid="dwelling_fire"]');
      assert.ok(tile());
      w.toggleProd(tile());
      assert.notEqual(grp.style.display, 'none', 'on');
      w.toggleProd(tile());
      assert.notEqual(grp.style.display, 'none', 'off');
      w.toggleProd(tile());
      w.eval(`turnstileToken = '${TOKEN}'`);
      await w.submitShort();
      assert.equal(posts.length, 1);
      assert.deepEqual(posts[0].products, ['dwelling_fire']);
      assert.equal(posts[0].businessName, 'Fixture Landlord LLC');
    } finally { w.close(); }
  });

  test('a name typed for a commercial cart is not sent once the cart is personal (POST, autosave, exit flush)', async () => {
    const { w, posts, tracks, homeAc } = await loadIntake();
    try {
      await throughStep1(w, homeAc);
      fill(w, { i_biz_name_1: 'Fixture Shop LLC' });
      // Commercial cart: the autosave carries the name (the control).
      w.eval("selectedProducts = ['bop']");
      await w.trackPartial(false, 0);
      assert.equal(tracks.at(-1).businessName, 'Fixture Shop LLC');
      // The cart turns personal: the autosave and the pagehide flush drop it.
      w.eval("selectedProducts = ['auto']");
      await w.trackPartial(false, 0);
      assert.ok(!tracks.at(-1).businessName, 'autosave sent the stale business name');
      const before = tracks.length;
      w.document.dispatchEvent(new w.Event('input', { bubbles: true }));
      w.dispatchEvent(new w.Event('pagehide'));
      assert.equal(tracks.length, before + 1, 'the exit flush posted');
      assert.ok(!tracks.at(-1).businessName, 'exit flush sent the stale business name');
      w.eval(`turnstileToken = '${TOKEN}'`);
      await w.submitShort();
      assert.equal(posts.length, 1);
      assert.ok(!posts[0].businessName);
    } finally { w.close(); }
  });

  test('offline at "Get My Quote": the queued lead keeps the step-2 business name, and only for a commercial cart', async () => {
    const queued = async (cart) => {
      const { w, posts, homeAc } = await loadIntake({ postFails: true });
      try {
        await throughStep1(w, homeAc);
        fill(w, { i_biz_name_1: 'Fixture Bop LLC' });
        w.eval(`selectedProducts = ${JSON.stringify(cart)}; turnstileToken = '${TOKEN}'`);
        await w.submitShort();
        assert.equal(posts.length, 1);
        const q = JSON.parse(w.localStorage.getItem('twa_intake_queue'));
        assert.ok(q && q.payload, 'queued');
        assert.deepEqual(stepsOf(w, 'intake_validation_error', 'submit_queued_offline'), [2]);
        assert.equal($(w, 'step2-error').classList.contains('hidden'), false);
        return q.payload;
      } finally { w.close(); }
    };
    // SAGE refuses a commercial cart with no business name on replay: the lead would be lost.
    assert.equal((await queued(['bop'])).businessName, 'Fixture Bop LLC');
    assert.ok(!(await queued(['auto'])).businessName);
  });

  // SAGE_CL_PRODUCTS mirrors CL_PRODUCTS in sage-server src/lib/product-lines.js
  // (SAGE refuses a commercial cart without a business name). Every commercial
  // tile the form offers must either be in it, or be listed here with the reason
  // SAGE does not need a business name for it. A new commercial tile fails this
  // test until someone decides which.
  const OFFERED_COMMERCIAL_NOT_SAGE_CL = {
    // The catalog groups Dwelling Fire (DP-1/DP-3 landlord policy on a 1-4 family
    // home) under commercial, but SAGE's CL_PRODUCTS treats it as PERSONAL, so
    // SAGE requires no business name for it.
    dwelling_fire: 'personal in SAGE',
  };
  test('SAGE_CL_PRODUCTS covers COMMERCIAL_PRODUCTS and every commercial tile the form offers', async () => {
    const { w } = await loadIntake();
    try {
      const sageCl = w.eval('SAGE_CL_PRODUCTS');
      const local = w.eval('COMMERCIAL_PRODUCTS');
      for (const id of local) assert.ok(sageCl.includes(id), `COMMERCIAL_PRODUCTS has ${id}, SAGE_CL_PRODUCTS does not`);
      const offered = w.eval("PRODUCTS.filter((p) => p.line === 'commercial').map((p) => p.id)");
      assert.ok(offered.length > 0);
      for (const id of offered) {
        assert.ok(sageCl.includes(id) || id in OFFERED_COMMERCIAL_NOT_SAGE_CL,
          `commercial tile '${id}' is in neither SAGE_CL_PRODUCTS nor the exception list: decide whether SAGE needs a business name for it`);
      }
      // The exceptions stay true exceptions (offered as commercial, not in the mirror).
      for (const id of Object.keys(OFFERED_COMMERCIAL_NOT_SAGE_CL)) {
        assert.ok(offered.includes(id) && !sageCl.includes(id), `stale exception '${id}'`);
      }
    } finally { w.close(); }
  });
});

describe('analytics carry no test param', () => {
  test('intake_* funnel events carry no ab_short_form', async () => {
    const { w, homeAc } = await loadIntake();
    try {
      await throughStep1(w, homeAc);
      const evs = gtagEvents(w).filter(([n]) => /^intake_/.test(n));
      assert.ok(evs.length > 0);
      for (const [name, params] of evs) assert.ok(!('ab_short_form' in params), name);
    } finally { w.close(); }
  });

  test('the conversion push carries no ab_short_form, and the submit completes step 2', async () => {
    const { w, homeAc } = await loadIntake();
    try {
      await throughStep1(w, homeAc);
      w.eval(`selectedProducts = ['renters']; turnstileToken = '${TOKEN}'`);
      await w.submitShort();
      const conv = (w.dataLayer || []).find((e) => e && e.event === 'conversion' && e.conversion_type === 'quote_request');
      assert.ok(conv);
      assert.ok(!('ab_short_form' in conv));
      // The submit completes step 2, the default form's last step; there is no step 4.
      assert.deepEqual(stepsOf(w, 'intake_step_complete'), [1, 2]);
    } finally { w.close(); }
  });

  test('a lead SAGE answers without ok logs its validation error on step 2, not step 4', async () => {
    const { w, posts, homeAc, release } = await loadIntake({ holdPost: true });
    try {
      await throughStep1(w, homeAc);
      w.eval(`selectedProducts = ['renters']; turnstileToken = '${TOKEN}'`);
      const btn = $(w, 'submit-btn-short');
      btn.click();
      await until(() => posts.length === 1, 'the POST');
      release(200, { ok: false, error: 'Server error' });
      await until(() => !btn.disabled, 'the button to re-enable');
      assert.deepEqual(stepsOf(w, 'intake_validation_error', 'submit_failed_server'), [2]);
      assert.deepEqual(stepsOf(w, 'intake_step_complete'), [1]);
    } finally { w.close(); }
  });
});

describe('?twa_form=long: the four-step form, as it always was', () => {
  test('no class, business name on step 1, Continue and quick lead on step 2, four-step time estimate', async () => {
    const { w } = await loadIntake({ query: LONG });
    try {
      assert.equal(w.isShortForm(), false);
      assert.equal(w.document.body.classList.contains('twa-intake-short'), false);
      assert.ok($(w, 'biz-name-step1-group').closest('#step-1'));
      assert.notEqual(w.getComputedStyle($(w, 'short-submit')).display, 'block');
      assert.notEqual(w.getComputedStyle(w.document.querySelector('#step-2 > .btn-row')).display, 'none');
      assert.notEqual(w.getComputedStyle($(w, 'quick-lead-link')).display, 'none');
      assert.equal($(w, 'time-estimate').textContent, 'About 3 minutes left');
      w.showStep(1);
      assert.equal($(w, 'time-estimate').textContent, 'About 3 minutes left');
    } finally { w.close(); }
  });

  test('Turnstile renders on step 4, not step 2', async () => {
    const settle = () => new Promise((r) => setTimeout(r, 50));
    const { w, renders } = await loadIntake({ query: LONG });
    try {
      w.showStep(2); await settle(); assert.deepEqual(renders, []);
      w.eval("selectedProducts = ['renters']");
      w.showStep(4); await settle(); assert.deepEqual(renders, ['#turnstile-container']);
    } finally { w.close(); }
  });

  test('the step-4 submit is untagged', async () => {
    const { w, posts, homeAc } = await loadIntake({ query: LONG });
    try {
      const r = await throughStep1(w, homeAc);
      assert.equal(r.advanced, true, r.error);
      w.eval(`selectedProducts = ['renters']; turnstileToken = '${TOKEN}'`);
      w.showStep(4);
      await w.submitIntake();
      assert.equal(posts.length, 1);
      assert.ok(!('ab_test' in posts[0].formData));
      assert.ok(stepsOf(w, 'intake_step_complete').includes(4));
    } finally { w.close(); }
  });

  test('a step-1 business name on a PERSONAL cart is still sent on the live POST', async () => {
    const { w, posts, homeAc } = await loadIntake({ query: LONG });
    try {
      await throughStep1(w, homeAc);
      fill(w, { i_biz_name_1: 'Fixture Longform LLC' });
      w.eval(`selectedProducts = ['auto']; turnstileToken = '${TOKEN}'`);
      w.showStep(4);
      await w.submitIntake();
      assert.equal(posts.length, 1);
      assert.equal(posts[0].businessName, 'Fixture Longform LLC');
    } finally { w.close(); }
  });

  test('the offline-queue payload sends businessName only from the step-3 field', async () => {
    // cart, step-1 name, step-3 name (null: the field is not on the page)
    const queued = async (cart, biz1, biz3) => {
      const { w, posts, homeAc } = await loadIntake({ query: LONG, postFails: true });
      try {
        await throughStep1(w, homeAc);
        fill(w, { i_biz_name_1: biz1 });
        w.eval(`selectedProducts = ${JSON.stringify(cart)}; turnstileToken = '${TOKEN}'`);
        w.showStep(3);
        if (biz3 !== null) fill(w, { i_biz_name: biz3 });
        else assert.equal($(w, 'i_biz_name'), null);
        w.showStep(4);
        await w.submitIntake();
        assert.equal(posts.length, 1);
        const q = JSON.parse(w.localStorage.getItem('twa_intake_queue'));
        assert.ok(q && q.payload, 'queued');
        return { live: posts[0], queued: q.payload };
      } finally { w.close(); }
    };
    // Personal cart: the live POST sent the step-1 name, the queue does not.
    const personal = await queued(['auto'], 'Fixture Step1 LLC', null);
    assert.equal(personal.live.businessName, 'Fixture Step1 LLC');
    assert.ok(!personal.queued.businessName);
    // Commercial cart: the queue sends the step-3 field, not the step-1 one.
    const commercial = await queued(['bop'], 'Fixture Step1 LLC', 'Fixture Step3 LLC');
    assert.equal(commercial.live.businessName, 'Fixture Step3 LLC');
    assert.equal(commercial.queued.businessName, 'Fixture Step3 LLC');
  });
});
