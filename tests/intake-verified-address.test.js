/**
 * Step 3 of /intake/: ONE Google-verified "Home address" line + optional
 * "Who referred you?" (owner, 2026-10-07; promoted to 100%, so every visitor
 * gets it and the 'intake-address-referrer' A/B is concluded).
 *
 * - The address counts only once a Places suggestion that is a full US street
 *   address is picked (street_number + route + locality/postal_town + state +
 *   postal_code). Typing, or editing after a pick, does not count.
 * - Places unavailable (load failure, auth/quota failure, never bound) degrades
 *   to a plain required line sent with formData.address_verified = false.
 * - A verified state that differs from step 1 replaces it and re-runs the
 *   out-of-area decline.
 * - Referrer details go on the live POST only: never localStorage, never the
 *   /track autosave.
 *
 * Drives the REAL src/intake.html in jsdom with src/js/attribution.js inlined
 * and google.maps.places mocked; every fetch is answered locally (nothing
 * reaches SAGE). Synthetic values only.
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

const RULES = {
  serviceStates: ['KY', 'IN', 'TN'],
  productLines: { auto: 'personal', homeowners: 'personal', renters: 'personal' },
  stateNames: { KY: 'Kentucky', OH: 'Ohio' }, declineTemplate: "We aren't licensed in {{STATE}}.", stateToken: '{{STATE}}',
};

// The final-submit body keys before referrer fields (origin/main shape).
const BASE_KEYS = ['sessionId', 'firstName', 'lastName', 'email', 'phone', 'address', 'city', 'state', 'zip',
  'products', 'formData', 'notes', 'agent', '_hp_company', 'cfToken', 'twa_vid', '_tracking', 'attribution'];

/** A Places result shaped like google.maps.places.PlaceResult. */
function place({ num = '100', route = 'Main St', city = 'Louisville', state = 'KY', zip = '40202', sub, cityType = 'locality', id = 'ChIJ_test_place_1' } = {}) {
  const comps = [];
  if (num) comps.push({ long_name: num, short_name: num, types: ['street_number'] });
  if (route) comps.push({ long_name: route.replace('St', 'Street'), short_name: route, types: ['route'] });
  if (sub) comps.push({ long_name: sub, short_name: sub, types: ['subpremise'] });
  if (city) comps.push({ long_name: city, short_name: city, types: [cityType, 'political'] });
  if (state) comps.push({ long_name: state, short_name: state, types: ['administrative_area_level_1', 'political'] });
  if (zip) comps.push({ long_name: zip, short_name: zip, types: ['postal_code'] });
  comps.push({ long_name: 'United States', short_name: 'US', types: ['country', 'political'] });
  const formatted = [num && route ? `${num} ${route}${sub ? ' #' + sub : ''}` : route, city, [state, zip].filter(Boolean).join(' '), 'USA'].filter(Boolean).join(', ');
  return { address_components: comps, formatted_address: formatted, place_id: id };
}

async function loadIntake({ places = true, offline = false, draft } = {}) {
  const posts = [], tracks = [], autocompletes = [];
  const dom = new JSDOM(PAGE, {
    runScripts: 'dangerously',
    url: 'https://www.thewayagency.com/intake/',
    beforeParse(w) {
      if (draft) w.localStorage.setItem('twa_intake_draft', JSON.stringify(draft));
      if (places) {
        w.google = { maps: { places: { Autocomplete: class {
          constructor(input, opts) { this.input = input; this.opts = opts; this.listeners = {}; this._place = {}; autocompletes.push(this); }
          addListener(ev, fn) { this.listeners[ev] = fn; }
          getPlace() { return this._place; }
        } } } };
      }
      w.fetch = (input, init) => {
        const href = String(input);
        if (href.includes('/api/intake/rules')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(RULES) });
        if (href.includes('/api/intake/track')) { tracks.push(JSON.parse(init.body)); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, sessionId: 's1' }) }); }
        if (href.endsWith('/api/intake')) {
          if (offline) return Promise.reject(new TypeError('Failed to fetch'));
          posts.push(JSON.parse(init.body));
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, reference: 'TEST' }) });
        }
        // /api/intake/config etc.: no Maps key, so a real Maps load never starts.
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.scrollTo = () => {};
      Object.defineProperty(w.HTMLElement.prototype, 'scrollIntoView', { value: () => {} });
      w.turnstile = { render() { return 'w1'; }, reset() {} };
    },
  });
  const w = dom.window;
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 5));
    if (w.serviceStateNames && w.serviceStateNames()) break;
  }
  w.eval("_turnstileSiteKey = 'test-key-test-key-test-key'; turnstileToken = 'test-token-test-token-test-token-test-token'");
  // What the Maps callback does once the script loads.
  if (places) w.bindIntakeAutocompletes();
  const homeAc = () => autocompletes.find((a) => a.input.id === 'i_address');
  return { w, posts, tracks, homeAc };
}

const $ = (w, id) => w.document.getElementById(id);
function fill(w, values) { for (const [id, val] of Object.entries(values)) $(w, id).value = val; }
function type(w, text) { const el = $(w, 'i_address'); el.value = text; w._onAddrInput(el); }
function pick(homeAc, p) { const ac = homeAc(); ac._place = p; ac.listeners.place_changed(); }
function fillContact(w) {
  fill(w, { i_fname: 'Zz', i_lname: 'Addrtest', i_email: 'zz.addrtest@example.com', i_phone: '(555) 555-0123', i_state: 'KY' });
  w.eval("selectedProducts = ['renters']");
}
async function step3(w, values = {}) {
  w.showStep(3);
  // 'dob-required' stays a live hash-assigned test; give it a DOB in either shape.
  fill(w, { i_dob: $(w, 'i_dob').type === 'date' ? '1980-01-01' : '01/01/1980', ...values });
  await w.nextStep(3);
  return { advanced: !$(w, 'step-4').classList.contains('hidden'), error: $(w, 'step3-error').textContent };
}
const gtagEvents = (w) => (w.dataLayer || []).filter((e) => e && e[0] === 'event').map((e) => [e[1], JSON.parse(JSON.stringify(e[2] || {}))]);
const plain = (o) => JSON.parse(JSON.stringify(o));

describe('every visitor gets the new step 3 (the A/B is concluded)', () => {
  test('one required "Home address" line with the pick hint, and the optional referrer box', async () => {
    const { w } = await loadIntake();
    try {
      assert.match(w.document.querySelector('label[for="i_address"]').textContent, /^Home address \*/);
      assert.equal($(w, 'i_address').required, true);
      assert.equal($(w, 'addr-verify-hint').hidden, false);
      assert.equal($(w, 'addr-verify-msg').hidden, true);
      assert.equal($(w, 'i_city').type, 'hidden');
      assert.equal($(w, 'i_zip').type, 'hidden');
      assert.equal($(w, 'ab-addr-row'), null, 'the separate city/ZIP row is gone');
      const ref = $(w, 'referrer-box');
      assert.equal(ref.hidden, false);
      assert.match(ref.querySelector('legend').textContent, /Who referred you\? \(optional\)/);
      for (const id of ['i_ref_name', 'i_ref_contact']) {
        assert.equal($(w, id).required, false);
        assert.doesNotMatch(w.document.querySelector(`label[for="${id}"]`).textContent, /\*/);
      }
    } finally { w.close(); }
  });

  test('no assignment, exposure or param for intake-address-referrer; the other intake tests still expose', async () => {
    const { w } = await loadIntake();
    try {
      const ex = (w.dataLayer || []).filter((e) => e && e.event === 'ab_exposure').map((e) => e.test_name);
      assert.ok(!ex.includes('intake-address-referrer'));
      assert.ok(ex.includes('dob-required') && ex.includes('intake-call-or-text'));
      assert.equal(typeof w.getAddrRefArm, 'undefined');
      for (const [name, params] of gtagEvents(w)) assert.ok(!('ab_addr_ref' in params), name);
      assert.doesNotMatch(HTML, /ab_addr_ref:\s|formData\.ab_test\s*=|assignVariant\('intake-address-referrer'/);
    } finally { w.close(); }
  });

  test('Places is bound US-only, type address, with the fields the check reads', async () => {
    const { w, homeAc } = await loadIntake();
    try {
      assert.deepEqual(plain(homeAc().opts), { types: ['address'], componentRestrictions: { country: 'us' }, fields: ['address_components', 'formatted_address', 'place_id'] });
    } finally { w.close(); }
  });
});

describe('verification', () => {
  test('picking a full street address passes and fills the hidden SAGE fields', async () => {
    const { w, homeAc } = await loadIntake();
    try {
      fillContact(w);
      type(w, '100 Ma');
      pick(homeAc, place());
      assert.equal($(w, 'i_address').value, '100 Main St, Louisville, KY 40202');
      assert.equal($(w, 'i_address_street').value, '100 Main St');
      assert.equal($(w, 'i_city').value, 'Louisville');
      assert.equal($(w, 'i_zip').value, '40202');
      assert.equal($(w, 'i_state').value, 'KY');
      const r = await step3(w);
      assert.equal(r.advanced, true, r.error);
      const ev = gtagEvents(w).filter(([n]) => n === 'intake_step_complete').pop();
      assert.equal(ev[1].address_verified, 'verified');
    } finally { w.close(); }
  });

  test('typed only (no pick) fails with the inline "pick from the suggestions" message', async () => {
    const { w } = await loadIntake();
    try {
      fillContact(w);
      type(w, '100 Main St, Louisville, KY 40202');
      const r = await step3(w);
      assert.equal(r.advanced, false);
      assert.match(r.error, /Please pick your address from the suggestions/);
      assert.equal($(w, 'addr-verify-msg').hidden, false);
      assert.match($(w, 'addr-verify-msg').textContent, /pick your address/);
      assert.equal($(w, 'i_address').getAttribute('aria-invalid'), 'true');
    } finally { w.close(); }
  });

  test('editing the text after a pick invalidates it until a suggestion is picked again', async () => {
    const { w, homeAc } = await loadIntake();
    try {
      fillContact(w);
      pick(homeAc, place());
      type(w, '100 Main St, Louisville, KY 40203');
      assert.equal($(w, 'i_city').value, '', 'the verified city is cleared');
      let r = await step3(w);
      assert.equal(r.advanced, false);
      assert.match(r.error, /pick your address/);
      pick(homeAc, place({ zip: '40203' }));
      r = await step3(w);
      assert.equal(r.advanced, true, r.error);
    } finally { w.close(); }
  });

  test('a place missing street_number, postal_code or a city fails; Enter with no pick fails', async () => {
    for (const bad of [place({ num: '' }), place({ zip: '' }), place({ city: '' }), { name: '100 Main' }]) {
      const { w, homeAc } = await loadIntake();
      try {
        fillContact(w);
        type(w, '100 Main');
        pick(homeAc, bad);
        assert.equal($(w, 'i_city').value, '');
        const r = await step3(w);
        assert.equal(r.advanced, false, JSON.stringify(bad).slice(0, 80));
        assert.match(r.error, /pick (a full street address|your address)/);
      } finally { w.close(); }
    }
  });

  test('postal_town counts as the city; a unit rides the street line; ZIP+4 is cut to 5', async () => {
    const { w, homeAc } = await loadIntake();
    try {
      fillContact(w);
      pick(homeAc, place({ cityType: 'postal_town', sub: '4B', zip: '40202-1234' }));
      assert.equal($(w, 'i_city').value, 'Louisville');
      assert.equal($(w, 'i_address_street').value, '100 Main St #4B');
      assert.equal($(w, 'i_zip').value, '40202');
    } finally { w.close(); }
  });

  test('a verified state that differs from step 1 replaces it and gets the out-of-area decline', async () => {
    const { w, homeAc } = await loadIntake();
    try {
      fillContact(w);
      assert.equal($(w, 'i_state').value, 'KY');
      pick(homeAc, place({ city: 'Cincinnati', state: 'OH', zip: '45202' }));
      assert.equal($(w, 'i_state').value, 'OH');
      const r = await step3(w);
      assert.equal(r.advanced, false);
      assert.match(r.error, /aren't licensed in Ohio/);
    } finally { w.close(); }
  });

  test('a referrer phone with no name asks for the name; an email alone is fine', async () => {
    for (const [contact, ok] of [['555-555-0100', false], ['ref.person@example.com', true]]) {
      const { w, homeAc } = await loadIntake();
      try {
        fillContact(w);
        pick(homeAc, place());
        const r = await step3(w, { i_ref_contact: contact });
        assert.equal(r.advanced, ok, r.error);
        if (!ok) assert.match(r.error, /name of the person who referred you/);
      } finally { w.close(); }
    }
  });
});

describe('fallback: Google never blocks a lead', () => {
  test('Places never loads: a typed line passes, flagged and tracked', async () => {
    const { w, posts } = await loadIntake({ places: false });
    try {
      fillContact(w);
      type(w, '100 Main St, Louisville, KY 40202');
      const r = await step3(w);
      assert.equal(r.advanced, true, r.error);
      const names = gtagEvents(w).map(([n]) => n);
      assert.ok(names.includes('intake_address_fallback'));
      const fb = gtagEvents(w).find(([n]) => n === 'intake_address_fallback')[1];
      assert.match(fb.reason, /^(maps_load_failed|places_unavailable)$/);
      assert.equal($(w, 'addr-verify-hint').hidden, true);
      assert.equal(gtagEvents(w).filter(([n]) => n === 'intake_step_complete').pop()[1].address_verified, 'fallback');
      await w.submitIntake();
      assert.equal(posts.length, 1);
      assert.equal(posts[0].address, '100 Main St, Louisville, KY 40202');
      assert.equal(posts[0].formData.address_verified, false);
      assert.ok(posts[0].formData.address_fallback_reason);
      assert.ok(!('place_id' in posts[0].formData));
    } finally { w.close(); }
  });

  test('fallback still requires the line', async () => {
    const { w } = await loadIntake({ places: false });
    try {
      fillContact(w);
      const r = await step3(w);
      assert.equal(r.advanced, false);
      assert.match(r.error, /enter your home address/);
    } finally { w.close(); }
  });

  test('a Maps auth/quota failure (gm_authFailure) switches to the plain line', async () => {
    const { w } = await loadIntake();
    try {
      fillContact(w);
      w.gm_authFailure();
      type(w, '100 Main St, Louisville, KY 40202');
      const r = await step3(w);
      assert.equal(r.advanced, true, r.error);
      assert.equal(gtagEvents(w).find(([n]) => n === 'intake_address_fallback')[1].reason, 'maps_auth_failure');
    } finally { w.close(); }
  });

  test('Places up, nothing picked: a plausible typed line passes on the third address-only attempt, flagged', async () => {
    const { w, posts } = await loadIntake();
    try {
      fillContact(w);
      type(w, '9 New Build Ln, Louisville, KY 40299');
      let r = await step3(w);
      assert.equal(r.advanced, false);
      assert.match(r.error, /^Please pick your address from the suggestions\.$/);
      assert.equal((await step3(w)).advanced, false);
      r = await step3(w);
      assert.equal(r.advanced, true, r.error);
      assert.equal(gtagEvents(w).find(([n]) => n === 'intake_address_fallback')[1].reason, 'no_pick_after_retries');
      assert.equal($(w, 'addr-verify-note').hidden, false, 'told the agency will confirm it');
      assert.match($(w, 'addr-verify-note').textContent, /agent will confirm/);
      await w.submitIntake();
      assert.equal(posts[0].formData.address_verified, false);
      assert.equal(posts[0].formData.address_fallback_reason, 'no_pick_after_retries');
      assert.equal(posts[0].address, '9 New Build Ln, Louisville, KY 40299');
    } finally { w.close(); }
  });

  test('after the no-pick escape, editing to junk is refused; another plausible line passes with the note again', async () => {
    const { w, posts } = await loadIntake();
    try {
      fillContact(w);
      type(w, '9 New Build Ln, Louisville, KY 40299');
      await step3(w); await step3(w);
      assert.equal((await step3(w)).advanced, true, 'escape granted');
      w.showStep(3);
      type(w, 'junk');
      assert.equal($(w, 'addr-verify-note').hidden, true, 'the note goes with the edit');
      let r = await step3(w);
      assert.equal(r.advanced, false);
      assert.equal(r.error, 'Please pick your address from the suggestions, or type the full address with house number and ZIP.');
      type(w, '11 New Build Ln, Louisville, KY 40299');
      r = await step3(w);
      assert.equal(r.advanced, true, 'plausibility re-checked at once (attempts stay above 2)');
      assert.equal($(w, 'addr-verify-note').hidden, false);
      await w.submitIntake();
      assert.equal(posts[0].address, '11 New Build Ln, Louisville, KY 40299');
      assert.equal(posts[0].formData.address_verified, false);
      assert.equal(posts[0].formData.address_fallback_reason, 'no_pick_after_retries');
    } finally { w.close(); }
  });

  test('a Google-unavailable fallback stays sticky across edits', async () => {
    const { w } = await loadIntake();
    try {
      fillContact(w);
      w.gm_authFailure();
      type(w, 'anything typed');
      type(w, 'edited again');
      const r = await step3(w);
      assert.equal(r.advanced, true, r.error);
      assert.equal(w.eval('addrVerify.reason'), 'maps_auth_failure');
    } finally { w.close(); }
  });

  test('other step-3 errors never use up address attempts', async () => {
    const { w } = await loadIntake();
    try {
      fillContact(w);
      type(w, '9 New Build Ln, Louisville, KY 40299');
      for (let i = 0; i < 5; i++) {
        const r = await step3(w, { i_ref_contact: '555-555-0100' });   // referrer phone with no name
        assert.equal(r.advanced, false);
      }
      assert.equal(w.eval('addrVerify.blocked'), 0, 'no attempt counted while another field was wrong');
      // Other field fixed: the address now gets its full two refusals.
      assert.equal((await step3(w, { i_ref_contact: '' })).advanced, false);
      assert.equal((await step3(w)).advanced, false);
      assert.equal((await step3(w)).advanced, true);
    } finally { w.close(); }
  });

  test('junk never passes, however many attempts', async () => {
    for (const junk of ['junk', 'Main St Louisville KY', '40202 Main St', '12 Main St Louisville KY']) {
      const { w } = await loadIntake();
      try {
        fillContact(w);
        type(w, junk);
        let r;
        for (let i = 0; i < 6; i++) r = await step3(w);
        assert.equal(r.advanced, false, junk);
        assert.equal(r.error, 'Please pick your address from the suggestions, or type the full address with house number and ZIP.');
        assert.ok(!gtagEvents(w).some(([n]) => n === 'intake_address_fallback'), junk);
      } finally { w.close(); }
    }
  });

  test('overlapping "Checking address" waits never leave the button stuck busy', async () => {
    const { w } = await loadIntake({ places: false });
    try {
      fillContact(w);
      w.ensureIntakeMaps = () => new Promise(() => {});
      w.showStep(3);
      fill(w, { i_dob: $(w, 'i_dob').type === 'date' ? '1980-01-01' : '01/01/1980' });
      type(w, '100 Main St, Louisville, KY 40202');
      const btn = w.document.querySelector('#step-3 [data-action="next-step"]');
      const label = btn.textContent;
      w.ADDR_MAPS_WAIT_MS = 120;
      const first = w.homeAddressProblem(true);
      await new Promise((r) => setTimeout(r, 40));
      w.ADDR_MAPS_WAIT_MS = 200;
      const second = w.homeAddressProblem(true);   // starts while the first is busy
      await first;
      assert.equal(btn.textContent, 'Checking address…', 'still busy while the second waits');
      assert.equal(btn.disabled, true);
      await second;
      assert.equal(btn.textContent, label);
      assert.equal(btn.disabled, false);
      assert.equal(btn.getAttribute('aria-busy'), null);
    } finally { w.close(); }
  });

  test('a slow Maps load shows "Checking address…" on a disabled button, then falls back', async () => {
    const { w } = await loadIntake({ places: false });
    try {
      fillContact(w);
      w.ensureIntakeMaps = () => new Promise(() => {});   // never settles
      w.ADDR_MAPS_WAIT_MS = 150;
      w.showStep(3);
      fill(w, { i_dob: $(w, 'i_dob').type === 'date' ? '1980-01-01' : '01/01/1980' });
      type(w, '100 Main St, Louisville, KY 40202');
      const btn = w.document.querySelector('#step-3 [data-action="next-step"]');
      const label = btn.textContent;
      const pending = w.nextStep(3);
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(btn.disabled, true);
      assert.equal(btn.textContent, 'Checking address…');
      assert.equal(btn.getAttribute('aria-busy'), 'true');
      await pending;
      assert.equal(btn.disabled, false);
      assert.equal(btn.textContent, label);
      assert.equal(gtagEvents(w).find(([n]) => n === 'intake_address_fallback')[1].reason, 'places_unavailable');
      assert.equal($(w, 'step-4').classList.contains('hidden'), false);
    } finally { w.close(); }
  });
});

describe('the /api/intake payload', () => {
  test('a verified lead sends street/city/state/zip, address_verified + place_id + formatted_address, and the referrer', async () => {
    const { w, posts, homeAc } = await loadIntake();
    try {
      fillContact(w);
      pick(homeAc, place({ sub: '2' }));
      fill(w, { i_ref_name: 'Jane Referrer', i_ref_contact: 'jane.ref@example.com' });
      w.renderReview();
      assert.match($(w, 'review-summary').textContent, /Home Address100 Main St #2, Louisville, KY 40202/);
      await w.submitIntake();
      assert.equal(posts.length, 1);
      const b = posts[0];
      assert.deepEqual(Object.keys(b), [...BASE_KEYS, 'referredByName', 'referredByEmail']);
      assert.equal(b.address, '100 Main St #2');
      assert.equal(b.city, 'Louisville');
      assert.equal(b.state, 'KY');
      assert.equal(b.zip, '40202');
      assert.equal(b.formData.address_verified, true);
      assert.equal(b.formData.place_id, 'ChIJ_test_place_1');
      assert.equal(b.formData.formatted_address, '100 Main St #2, Louisville, KY 40202');
      assert.ok(!('ab_test' in b.formData));
      assert.equal(b.referredByName, 'Jane Referrer');
      assert.equal(b.referredByEmail, 'jane.ref@example.com');
      assert.equal(b.formData.lead_referrer, 'direct', 'the HTTP referrer is still its own field');
    } finally { w.close(); }
  });

  test('a referrer phone goes to referredByPhone; a blank referrer sends no referredBy keys', async () => {
    for (const [ref, keys] of [[{ i_ref_name: 'Pat', i_ref_contact: '(502) 555-0100' }, ['referredByName', 'referredByPhone']], [{}, []]]) {
      const { w, posts, homeAc } = await loadIntake();
      try {
        fillContact(w);
        pick(homeAc, place());
        fill(w, ref);
        await w.submitIntake();
        assert.deepEqual(Object.keys(posts[0]), [...BASE_KEYS, ...keys]);
      } finally { w.close(); }
    }
  });

  test('the quick lead carries no ab tag and no referrer', async () => {
    const { w, posts } = await loadIntake();
    try {
      fillContact(w);
      await w.submitQuickLead();
      assert.equal(posts.length, 1);
      assert.ok(!('ab_test' in posts[0].formData));
      assert.doesNotMatch(JSON.stringify(posts[0]), /referredBy/);
    } finally { w.close(); }
  });

  test('no referrer value ever reaches localStorage (draft + offline queue) or the /track autosave', async () => {
    const REF_NAME = 'Qq Referrerstorage';
    for (const contact of ['qq.refstorage@example.com', '(502) 555-0177']) {
      const { w, posts, tracks, homeAc } = await loadIntake({ offline: true });
      try {
        fillContact(w);
        pick(homeAc, place());
        fill(w, { i_ref_name: REF_NAME, i_ref_contact: contact });
        w.saveDraft();
        await w.trackPartial(false);
        w.showStep(4);
        await w.submitIntake();
        assert.equal(posts.length, 0, 'offline path ran');
        const queued = JSON.parse(w.localStorage.getItem('twa_intake_queue'));
        assert.ok(queued && queued.payload);
        assert.equal(queued.payload.city, 'Louisville', 'the address still rides the queue');
        assert.equal(queued.payload.formData.address_verified, true);
        let all = '';
        for (let i = 0; i < w.localStorage.length; i++) all += w.localStorage.key(i) + '=' + w.localStorage.getItem(w.localStorage.key(i)) + '\n';
        const sent = JSON.stringify(tracks);
        for (const needle of ['Referrerstorage', 'refstorage', '555-0177', 'referredBy']) {
          assert.ok(!all.includes(needle), 'localStorage holds ' + needle);
          assert.ok(!sent.includes(needle), '/track carried ' + needle);
        }
      } finally { w.close(); }
    }
  });
});

describe('draft and accessibility', () => {
  const VA = { street: '100 Main St', city: 'Louisville', state: 'KY', zip: '40202', formatted: '100 Main St, Louisville, KY 40202', placeId: 'ChIJ_test_place_1' };
  function draftWith(fields, verifiedAddress) {
    return { fields: { i_fname: 'Zz', i_lname: 'Addrtest', i_email: 'zz.addrtest@example.com', i_phone: '(555) 555-0123', i_state: 'KY', ...fields },
      products: ['renters'], vehicles: [], step: 2, hoSameAddr: true, verifiedAddress, savedAt: Date.now() };
  }
  async function resume(draft) {
    const ctx = await loadIntake({ draft });
    ctx.w.document.getElementById('draft-resume-btn').click();
    return ctx;
  }

  test('the draft saves the verified place (never the referrer) and a resumed, unedited address stays verified', async () => {
    const a = await loadIntake();
    let saved;
    try {
      fillContact(a.w);
      pick(a.homeAc, place());
      fill(a.w, { i_ref_name: 'Qq Referrerdraft', i_ref_contact: 'qq.refdraft@example.com' });
      a.w.saveDraft();
      saved = JSON.parse(a.w.localStorage.getItem('twa_intake_draft'));
      assert.deepEqual(saved.verifiedAddress, VA);
      assert.doesNotMatch(JSON.stringify(saved), /Referrerdraft|refdraft|i_ref_/);
    } finally { a.w.close(); }
    const { w, posts } = await resume(saved);
    try {
      assert.equal($(w, 'i_address').value, VA.formatted);
      assert.equal($(w, 'i_city').value, 'Louisville');
      const r = await step3(w);
      assert.equal(r.advanced, true, r.error);
      await w.submitIntake();
      assert.equal(posts[0].formData.address_verified, true);
      assert.equal(posts[0].formData.place_id, VA.placeId);
      assert.equal(posts[0].address, '100 Main St');
    } finally { w.close(); }
  });

  test('a resumed verified address that is then edited must be picked again', async () => {
    const { w } = await resume(draftWith({ i_address: VA.formatted }, VA));
    try {
      type(w, VA.formatted + ' Apt 9');
      const r = await step3(w);
      assert.equal(r.advanced, false);
      assert.match(r.error, /pick your address/);
    } finally { w.close(); }
  });

  test('a draft whose box text does not match the saved place, or a malformed place, is not verified', async () => {
    for (const d of [draftWith({ i_address: '1 Other Rd, Louisville, KY 40202' }, VA), draftWith({ i_address: VA.formatted }, { ...VA, zip: 'x' })]) {
      const { w } = await resume(d);
      try {
        assert.equal(w.eval('addrVerify.place'), null);
        assert.equal((await step3(w)).advanced, false);
      } finally { w.close(); }
    }
  });

  test('the address message is not a second live alert (step3-error announces it)', async () => {
    const { w } = await loadIntake();
    try {
      assert.equal($(w, 'addr-verify-msg').getAttribute('role'), null);
      assert.equal($(w, 'step3-error').getAttribute('role'), 'alert');
      assert.match($(w, 'i_address').getAttribute('aria-describedby'), /addr-verify-msg/);
    } finally { w.close(); }
  });
});
