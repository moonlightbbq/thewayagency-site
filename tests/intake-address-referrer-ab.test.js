/**
 * A/B 'intake-address-referrer' (owner decision 2026-10-07).
 *
 * control      = today's step 3, today's validation, today's POST body.
 * full-address = Street Address + REQUIRED visible City and ZIP, plus an
 *                optional "Who referred you?" block whose values go to SAGE as
 *                referredByName / referredByEmail / referredByPhone
 *                (sage-server #1067).
 *
 * Drives the REAL src/intake.html in jsdom with src/js/attribution.js inlined,
 * every fetch answered locally (nothing reaches SAGE). Synthetic values only.
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
const TEST = 'intake-address-referrer';

const RULES = {
  serviceStates: ['KY', 'IN', 'TN'],
  productLines: { auto: 'personal', homeowners: 'personal', renters: 'personal' },
  stateNames: { KY: 'Kentucky' }, declineTemplate: "We aren't licensed in {{STATE}}.", stateToken: '{{STATE}}',
};

// Today's (pre-test) final-submit body keys, in order. Control must send exactly these.
const CONTROL_KEYS = ['sessionId', 'firstName', 'lastName', 'email', 'phone', 'address', 'city', 'state', 'zip',
  'products', 'formData', 'notes', 'agent', '_hp_company', 'cfToken', 'twa_vid', '_tracking', 'attribution'];

async function loadIntake({ query = '', vid, offline = false } = {}) {
  const posts = [];
  const dom = new JSDOM(PAGE, {
    runScripts: 'dangerously',
    url: 'https://www.thewayagency.com/intake/' + query,
    beforeParse(w) {
      if (vid) w.localStorage.setItem('twa_vid', vid);
      w.fetch = (input, init) => {
        const href = String(input);
        if (href.includes('/api/intake/rules')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(RULES) });
        if (href.endsWith('/api/intake')) {
          if (offline) return Promise.reject(new TypeError('Failed to fetch'));
          posts.push(JSON.parse(init.body));
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, reference: 'TEST' }) });
        }
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
  return { w, posts };
}

const $ = (w, id) => w.document.getElementById(id);
function fill(w, values) {
  for (const [id, val] of Object.entries(values)) $(w, id).value = val;
}
function fillContact(w) {
  fill(w, { i_fname: 'Zz', i_lname: 'Abtest', i_email: 'zz.abtest@example.com', i_phone: '(555) 555-0123', i_state: 'KY' });
  w.eval("selectedProducts = ['renters']");
}
const exposures = (w) => (w.dataLayer || []).filter((e) => e && e.event === 'ab_exposure' && e.test_name === TEST);
const plain = (o) => JSON.parse(JSON.stringify(o));

// Reference copies, kept here on purpose (a test that imported the page's own
// function would agree with any bug in it). hashAssign is attribution.js's
// live assignment for the other intake tests; refBucket is this test's.
function h32(str) { let h = 0; for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; } return h; }
const hashAssign = (vid, test, n) => Math.abs(h32(vid + ':' + test)) % n;
function refBucket(vid) {
  let h = h32(vid + ':' + TEST);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) % 2;
}
// Visitor ids shaped like attribution.js makes them (random base36 + time base36).
function fakeVid(i) { return (i * 2654435761 >>> 0).toString(36) + (i * 40503 % 99991).toString(36) + (1790000000000 + i * 7919).toString(36); }

describe('assignment and exposure', () => {
  test('a visitor is bucketed by fmix32(hash(vid:test)) % 2, deterministically, with one exposure', async () => {
    const seen = new Set();
    for (const vid of ['vid-alpha-001', 'vid-bravo-002', 'vid-charlie-003', 'vid-delta-004', 'vid-echo-005', 'vid-fox-006']) {
      const { w } = await loadIntake({ vid });
      try {
        const expected = ['control', 'full-address'][refBucket(vid)];
        assert.equal(w.eval('getAddrRefArm()'), expected, vid);
        assert.equal(w.addrRefBucket(vid), refBucket(vid), vid);
        const ex = exposures(w);
        assert.equal(ex.length, 1);
        assert.deepEqual(plain(ex[0]), { event: 'ab_exposure', test_name: TEST, variant: expected, visitor_id: vid });
        seen.add(expected);
      } finally { w.close(); }
    }
    assert.equal(seen.size, 2, 'six fixed visitors should land in both arms');
  });

  test('a returning visitor keeps their arm across page loads', async () => {
    for (const vid of ['vid-return-001', 'vid-return-002', 'vid-return-003']) {
      const a = await loadIntake({ vid }); const armA = a.w.eval('getAddrRefArm()'); a.w.close();
      const b = await loadIntake({ vid }); const armB = b.w.eval('getAddrRefArm()'); b.w.close();
      assert.equal(armA, armB, vid);
    }
  });

  test('the arm is independent of dob-required and intake-call-or-text (each cell 25% ± 2%)', async () => {
    const { w } = await loadIntake();
    try {
      const N = 40000;
      for (const other of ['dob-required', 'intake-call-or-text']) {
        const cells = [0, 0, 0, 0];
        for (let i = 0; i < N; i++) {
          const vid = fakeVid(i);
          assert.equal(w.addrRefBucket(vid), refBucket(vid));
          // The live tests' assignment, from the page's own attribution.js.
          cells[refBucket(vid) * 2 + w.TWA.hashAssign(vid, other, 2)]++;
        }
        for (const c of cells) assert.ok(Math.abs(c / N - 0.25) <= 0.02, other + ' cross-tab ' + cells.join('/'));
      }
      // Guard the premise: the old assignment really was confounded, so a
      // revert to TWA.assignVariant would fail the cross-tab above.
      let same = 0;
      for (let i = 0; i < 2000; i++) { const vid = fakeVid(i); if (hashAssign(vid, TEST, 2) === hashAssign(vid, 'dob-required', 2)) same++; }
      assert.ok(same === 0 || same === 2000, 'hashAssign % 2 is parity-locked across tests (' + same + '/2000)');
    } finally { w.close(); }
  });

  test('the hash split is roughly uniform (two arms, no weights)', async () => {
    const { w } = await loadIntake();
    try {
      let variant = 0;
      for (let i = 0; i < 4000; i++) variant += w.addrRefBucket(fakeVid(i));
      assert.ok(variant > 1700 && variant < 2300, 'variant share ' + variant + '/4000');
    } finally { w.close(); }
  });

  test('?force_variant= pins either arm', async () => {
    for (const arm of ['control', 'full-address']) {
      const { w } = await loadIntake({ query: '?force_variant=' + arm });
      try { assert.equal(exposures(w)[0].variant, arm); } finally { w.close(); }
    }
  });
});

describe('what each arm sees', () => {
  test('control: the step-3 markup is today\'s (hidden city/ZIP, no referrer block)', async () => {
    const { w } = await loadIntake({ query: '?force_variant=control' });
    try {
      assert.equal($(w, 'i_city').type, 'hidden');
      assert.equal($(w, 'i_zip').type, 'hidden');
      assert.equal($(w, 'ab-addr-row').hidden, true);
      assert.equal($(w, 'ab-referrer').hidden, true);
      assert.match(w.document.querySelector('label[for="i_address"]').textContent, /^Mailing Address/);
      assert.equal($(w, 'i_address').getAttribute('autocomplete'), 'off');
      assert.ok(!w.document.body.classList.contains('twa-ab-full-address'));
    } finally { w.close(); }
  });

  test('variant: labelled, required street/city/ZIP with address autocomplete tokens; optional referrer', async () => {
    const { w } = await loadIntake({ query: '?force_variant=full-address' });
    try {
      assert.match(w.document.querySelector('label[for="i_address"]').textContent, /^Street Address \*/);
      assert.equal($(w, 'i_address').getAttribute('autocomplete'), 'address-line1');
      for (const [id, token, label] of [['i_city', 'address-level2', /^City \*/], ['i_zip', 'postal-code', /^ZIP Code \*/]]) {
        const el = $(w, id);
        assert.equal(el.type, 'text', id);
        assert.equal(el.required, true, id);
        assert.equal(el.getAttribute('autocomplete'), token, id);
        assert.match(w.document.querySelector(`label[for="${id}"]`).textContent, label);
        assert.ok(el.closest('#ab-addr-row'), id + ' sits in the visible row');
      }
      assert.equal($(w, 'ab-addr-row').hidden, false);
      const ref = $(w, 'ab-referrer');
      assert.equal(ref.hidden, false);
      assert.match(ref.querySelector('legend').textContent, /Who referred you\? \(optional\)/);
      for (const id of ['i_ref_name', 'i_ref_contact']) {
        assert.equal($(w, id).required, false, id + ' is optional');
        assert.ok(w.document.querySelector(`label[for="${id}"]`), id + ' has a label');
        assert.doesNotMatch(w.document.querySelector(`label[for="${id}"]`).textContent, /\*/);
      }
    } finally { w.close(); }
  });

  test('the referrer fields never land in the saved draft', () => {
    const ids = HTML.match(/const DRAFT_FIELD_IDS = \[([\s\S]*?)\];/)[1];
    assert.doesNotMatch(ids, /i_ref_/);
  });
});

describe('step-3 validation', () => {
  async function tryStep3(arm, values) {
    const { w } = await loadIntake({ query: '?force_variant=' + arm });
    fillContact(w);
    w.showStep(3);
    // force_variant=full-address leaves 'dob-required' hash-assigned (its arms
    // are control/required), so give a DOB to keep that test out of the way.
    // Its 'required' arm turns #i_dob into type=date, which wants ISO.
    const dob = $(w, 'i_dob').type === 'date' ? '1980-01-01' : '01/01/1980';
    fill(w, { i_dob: dob, ...values });
    await w.nextStep(3);
    return { w, advanced: !$(w, 'step-4').classList.contains('hidden'), error: $(w, 'step3-error').textContent };
  }

  test('control advances with only the one address box (today\'s rule)', async () => {
    const { w, advanced } = await tryStep3('control', { i_address: '100 Main St, Louisville, KY 40202' });
    try { assert.equal(advanced, true); } finally { w.close(); }
  });

  test('variant blocks a missing city, then a missing or malformed ZIP', async () => {
    let r = await tryStep3('full-address', { i_address: '100 Main St', i_zip: '40202' });
    try { assert.equal(r.advanced, false); assert.match(r.error, /city/); } finally { r.w.close(); }
    r = await tryStep3('full-address', { i_address: '100 Main St', i_city: 'Louisville' });
    try { assert.equal(r.advanced, false); assert.match(r.error, /ZIP/); } finally { r.w.close(); }
    r = await tryStep3('full-address', { i_address: '100 Main St', i_city: 'Louisville', i_zip: '4020' });
    try { assert.equal(r.advanced, false); assert.match(r.error, /ZIP/); } finally { r.w.close(); }
    r = await tryStep3('full-address', { i_city: 'Louisville', i_zip: '40202' });
    try { assert.equal(r.advanced, false); assert.match(r.error, /street address/); } finally { r.w.close(); }
  });

  test('variant advances with street, city and ZIP; referrer left blank', async () => {
    const r = await tryStep3('full-address', { i_address: '100 Main St', i_city: 'Louisville', i_zip: '40202-1234' });
    try { assert.equal(r.advanced, true, r.error); } finally { r.w.close(); }
  });

  test('variant: a referrer phone with no name asks for the name; an email alone is fine', async () => {
    const base = { i_address: '100 Main St', i_city: 'Louisville', i_zip: '40202' };
    let r = await tryStep3('full-address', { ...base, i_ref_contact: '555-555-0100' });
    try { assert.equal(r.advanced, false); assert.match(r.error, /name of the person who referred you/); } finally { r.w.close(); }
    r = await tryStep3('full-address', { ...base, i_ref_contact: 'ref.person@example.com' });
    try { assert.equal(r.advanced, true, r.error); } finally { r.w.close(); }
  });

  test('variant: typing in the street box keeps the visitor\'s city and ZIP (control still clears them)', async () => {
    for (const [arm, kept] of [['full-address', true], ['control', false]]) {
      const { w } = await loadIntake({ query: '?force_variant=' + arm });
      try {
        fill(w, { i_city: 'Louisville', i_zip: '40202', i_address: '100 Main' });
        w._onAddrInput($(w, 'i_address'));
        assert.equal($(w, 'i_city').value, kept ? 'Louisville' : '', arm);
        assert.equal($(w, 'i_zip').value, kept ? '40202' : '', arm);
      } finally { w.close(); }
    }
  });
});

describe('the /api/intake payload', () => {
  async function submit(arm, values) {
    const { w, posts } = await loadIntake({ query: '?force_variant=' + arm });
    fillContact(w);
    fill(w, values);
    w.showStep(4);
    await w.submitIntake();
    return { w, posts };
  }

  test('control sends exactly today\'s body: no referrer keys, no ab tag', async () => {
    const { w, posts } = await submit('control', { i_address: '100 Main St, Louisville, KY 40202' });
    try {
      assert.equal(posts.length, 1);
      assert.deepEqual(Object.keys(posts[0]), CONTROL_KEYS);
      assert.equal(posts[0].address, '100 Main St, Louisville, KY 40202');
      assert.ok(!('ab_test' in posts[0].formData));
      assert.doesNotMatch(JSON.stringify(posts[0]), /referredBy/);
    } finally { w.close(); }
  });

  test('variant sends street/city/state/zip, the referrer (email) and the ab tag', async () => {
    const { w, posts } = await submit('full-address', {
      i_address: '100 Main St', i_city: 'Louisville', i_zip: '40202',
      i_ref_name: 'Jane Referrer', i_ref_contact: 'jane.ref@example.com',
    });
    try {
      assert.equal(posts.length, 1);
      const b = posts[0];
      assert.deepEqual(Object.keys(b), [...CONTROL_KEYS, 'referredByName', 'referredByEmail']);
      assert.equal(b.address, '100 Main St');
      assert.equal(b.city, 'Louisville');
      assert.equal(b.state, 'KY');
      assert.equal(b.zip, '40202');
      assert.equal(b.referredByName, 'Jane Referrer');
      assert.equal(b.referredByEmail, 'jane.ref@example.com');
      assert.equal(b.formData.ab_test, TEST + '.full-address');
      // The HTTP page referrer is still its own field, never the person.
      assert.equal(b.formData.lead_referrer, 'direct');
    } finally { w.close(); }
  });

  test('variant: a phone goes to referredByPhone; a blank referrer sends no referredBy keys', async () => {
    let r = await submit('full-address', { i_address: '1 A St', i_city: 'X', i_zip: '40202', i_ref_name: 'Pat', i_ref_contact: '(502) 555-0100' });
    try {
      assert.equal(r.posts[0].referredByPhone, '(502) 555-0100');
      assert.ok(!('referredByEmail' in r.posts[0]));
    } finally { r.w.close(); }
    r = await submit('full-address', { i_address: '1 A St', i_city: 'X', i_zip: '40202' });
    try { assert.deepEqual(Object.keys(r.posts[0]), CONTROL_KEYS); } finally { r.w.close(); }
  });

  test('quick lead (step 2): variant formData is tagged, control\'s is not', async () => {
    for (const [arm, tagged] of [['full-address', true], ['control', false]]) {
      const { w, posts } = await loadIntake({ query: '?force_variant=' + arm });
      try {
        fillContact(w);
        await w.submitQuickLead();
        assert.equal(posts.length, 1, arm);
        assert.equal(posts[0].formData.ab_test, tagged ? TEST + '.full-address' : undefined, arm);
        assert.doesNotMatch(JSON.stringify(posts[0]), /referredBy/);
      } finally { w.close(); }
    }
  });

  test('no referrer value ever reaches localStorage: draft, offline queue, anything', async () => {
    const REF_NAME = 'Qq Referrerstorage', REF_EMAIL = 'qq.refstorage@example.com', REF_PHONE = '(502) 555-0177';
    for (const contact of [REF_EMAIL, REF_PHONE]) {
      const { w, posts } = await loadIntake({ query: '?force_variant=full-address', offline: true });
      try {
        fillContact(w);
        fill(w, { i_address: '100 Main St', i_city: 'Louisville', i_zip: '40202', i_ref_name: REF_NAME, i_ref_contact: contact });
        w.saveDraft();
        w.showStep(4);
        await w.submitIntake();
        assert.equal(posts.length, 0, 'the POST failed, so the offline path ran');
        const queued = JSON.parse(w.localStorage.getItem('twa_intake_queue'));
        assert.ok(queued && queued.payload, 'the submission was queued offline');
        assert.equal(queued.payload.city, 'Louisville', 'the address still rides the queue');
        assert.doesNotMatch(JSON.stringify(queued), /referredBy/);
        let all = '';
        for (let i = 0; i < w.localStorage.length; i++) all += w.localStorage.key(i) + '=' + w.localStorage.getItem(w.localStorage.key(i)) + '\n';
        for (const needle of ['Referrerstorage', 'refstorage', '555-0177', '5550177']) assert.ok(!all.includes(needle), 'localStorage holds ' + needle);
      } finally { w.close(); }
    }
  });

  test('the autosave (trackPartial -> /api/intake/track) never carries referrer fields', () => {
    const body = HTML.slice(HTML.indexOf('async function trackPartial('), HTML.indexOf('async function checkTakeover('));
    assert.ok(body.length > 100);
    assert.doesNotMatch(body, /referr(edBy|erFields)/);
  });
});

describe('analytics carry the arm', () => {
  test('intake_* funnel events and the conversion push carry ab_addr_ref (not generic test_name/variant)', async () => {
    const { w } = await submit2();
    try {
      const gtagEvents = w.dataLayer.filter((e) => e && e[0] === 'event').map((e) => [e[1], plain(e[2])]);
      const complete = gtagEvents.find(([n]) => n === 'intake_complete');
      assert.ok(complete, 'intake_complete fired');
      for (const [name, params] of gtagEvents.filter(([n]) => /^intake_/.test(n))) {
        assert.equal(params.ab_addr_ref, 'full-address', name + ' carries the arm');
        assert.ok(!('test_name' in params) && !('variant' in params), name + ' has no generic test_name/variant');
      }
      const conv = w.dataLayer.find((e) => e && e.event === 'conversion' && e.conversion_type === 'quote_request');
      assert.equal(conv.ab_addr_ref, 'full-address');
      assert.ok(!('test_name' in conv) && !('variant' in conv));
      // Exposure stays on the framework's ab_exposure event.
      assert.equal(exposures(w).length, 1);
      assert.equal(exposures(w)[0].variant, 'full-address');
    } finally { w.close(); }
  });

  async function submit2() {
    const { w } = await loadIntake({ query: '?force_variant=full-address' });
    fillContact(w);
    fill(w, { i_address: '100 Main St', i_city: 'Louisville', i_zip: '40202' });
    w.showStep(4);
    await w.submitIntake();
    return { w };
  }
});
