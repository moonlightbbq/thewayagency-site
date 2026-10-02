/**
 * /intake/ takes contact details from this tab's sessionStorage, never from the
 * URL, and scrubs legacy URLs before any tag can read them (TRUST-08). The
 * wizard's echo containers are masked for Clarity (TRUST-12).
 *
 * Drives the REAL src/intake.html in jsdom, with src/js/attribution.js inlined
 * (jsdom does not fetch <script src>), as tests/intake-gate.test.js does.
 * Synthetic values only.
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
assert.ok(HTML.includes(ATTR_TAG), 'intake.html no longer loads attribution.js the way this test inlines it');
const PAGE = HTML.replace(ATTR_TAG, '<script>' + ATTR + '</script>');

const NAME = 'Zz Privacycheck';
const EMAIL = 'zz.privacycheck@example.com';
const PHONE = '5555550123';
const MARKERS = ['Privacycheck', 'privacycheck', EMAIL, encodeURIComponent(EMAIL), PHONE];

const RULES = {
  serviceStates: ['KY', 'IN', 'TN'],
  productLines: { auto: 'personal', homeowners: 'personal', bop: 'commercial', medicare: 'health' },
  stateNames: { KY: 'Kentucky', IN: 'Indiana', TN: 'Tennessee' },
  declineTemplate: "We aren't licensed in {{STATE}}.",
  stateToken: '{{STATE}}',
};

/**
 * Load the intake at `url`. `seed(w)` runs before any page script (storage
 * seeding). Every fetch is recorded; nothing leaves the process.
 */
async function loadIntake(url, { seed } = {}) {
  const calls = [];
  const dom = new JSDOM(PAGE, {
    runScripts: 'dangerously',
    url,
    beforeParse(w) {
      if (seed) seed(w);
      w.fetch = (input, init) => {
        const href = String(input);
        calls.push({ url: href, method: (init && init.method) || 'GET', body: init && init.body });
        if (href.includes('/api/intake/rules')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(RULES) });
        if (href.includes('/api/intake/track')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, sessionId: 'test-session-test-session' }) });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.scrollTo = () => {};
      Object.defineProperty(w.HTMLElement.prototype, 'scrollIntoView', { value: () => {} });
    },
  });
  const w = dom.window;
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 5));
    if (w.serviceStateNames && w.serviceStateNames()) break;
  }
  w.__calls = calls;
  return w;
}
const val = (w, id) => w.document.getElementById(id).value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('a legacy hand-off URL is scrubbed before anything reads it', () => {
  const LEGACY = 'https://www.thewayagency.com/intake/?product=auto&line=personal&name=Zz+Privacycheck'
    + '&email=zz.privacycheck%40example.com&phone=5555550123&src=inline';

  test('the address bar keeps only page context, and the fields are prefilled from storage', async () => {
    const w = await loadIntake(LEGACY);
    try {
      assert.equal(w.location.search, '?product=auto&line=personal&src=inline');
      assert.equal(w.location.pathname, '/intake/');
      assert.equal(val(w, 'i_fname'), 'Zz');
      assert.equal(val(w, 'i_lname'), 'Privacycheck');
      assert.equal(val(w, 'i_email'), EMAIL);
      assert.equal(val(w, 'i_phone'), PHONE);
      assert.equal(w.sessionStorage.getItem('twa_inline_prefill'), null, 'the stash is one-shot');
      assert.ok(w._prefilledThisLoad, 'prefill flag set');
    } finally { w.close(); }
  });

  test('no dataLayer event carries the identity (intake_start reads location.href after the scrub)', async () => {
    const w = await loadIntake(LEGACY);
    try {
      const pushed = JSON.stringify(w.dataLayer, (k, v) => (v && typeof v === 'object' && 'length' in v && !Array.isArray(v) ? Array.from(v) : v));
      assert.ok(pushed.includes('intake_start'), 'intake_start was not pushed');
      for (const m of MARKERS) assert.ok(!pushed.includes(m), `dataLayer carries ${m}`);
    } finally { w.close(); }
  });

  test('the SAGE autosave keeps src=inline as lead_source and a lead_page without identity', async () => {
    const w = await loadIntake(LEGACY);
    try {
      w.document.getElementById('i_state').value = 'KY';
      await w.trackPartial(false);
      const track = w.__calls.find((c) => c.url.includes('/api/intake/track'));
      assert.ok(track, 'no /api/intake/track call');
      const body = JSON.parse(track.body);
      assert.equal(body.lead_source, 'inline');
      assert.equal(body.lead_page, '/intake/?product=auto&line=personal&src=inline');
      assert.equal(body.firstName, 'Zz', 'SAGE itself still receives the contact details');
      assert.equal(body.email, EMAIL);
      for (const m of MARKERS) assert.ok(!String(body.attribution && JSON.stringify(body.attribution)).includes(m), `attribution carries ${m}`);
      for (const c of w.__calls) {
        for (const m of MARKERS) assert.ok(!c.url.includes(m), `a request URL carries ${m}: ${c.url}`);
      }
    } finally { w.close(); }
  });

  test('first_name/last_name legacy keys are joined into one name', async () => {
    const w = await loadIntake('https://www.thewayagency.com/intake/?first_name=Zz&last_name=Privacycheck&src=inline');
    try {
      assert.equal(w.location.search, '?src=inline');
      assert.equal(val(w, 'i_fname'), 'Zz');
      assert.equal(val(w, 'i_lname'), 'Privacycheck');
    } finally { w.close(); }
  });

  test('a URL without sensitive keys is left exactly as it was', async () => {
    const w = await loadIntake('https://www.thewayagency.com/intake/?product=auto&utm_source=test&src=inline');
    try {
      assert.equal(w.location.search, '?product=auto&utm_source=test&src=inline');
      assert.equal(val(w, 'i_fname'), '');
    } finally { w.close(); }
  });

  test('blocked storage: the URL is still scrubbed and the values are dropped, not kept in the URL', async () => {
    const w = await loadIntake(LEGACY, {
      seed(win) { Object.defineProperty(win, 'sessionStorage', { configurable: true, get() { throw new Error('storage blocked'); } }); },
    });
    try {
      assert.equal(w.location.search, '?product=auto&line=personal&src=inline');
      assert.equal(val(w, 'i_fname'), '', 'nothing to prefill from');
    } finally { w.close(); }
  });
});

describe('the inline-form hand-off (clean URL plus a sessionStorage stash)', () => {
  const CLEAN = 'https://www.thewayagency.com/intake/?product=auto&line=personal&src=inline';
  // A cross-visit draft in the current format (v2: allowlisted fields only).
  const DRAFT = JSON.stringify({ v: 2, fields: { i_state: 'KY' }, products: ['homeowners'], vehicles: [], step: 2, hoSameAddr: true, savedAt: Date.now() - 60 * 1000 });

  test('fields are prefilled, and an older draft does not raise the resume toast', async () => {
    const w = await loadIntake(CLEAN, {
      seed(win) {
        win.sessionStorage.setItem('twa_inline_prefill', JSON.stringify({ v: 1, at: Date.now(), name: NAME, email: EMAIL, phone: PHONE }));
        win.localStorage.setItem('twa_intake_draft', DRAFT);
      },
    });
    try {
      assert.equal(val(w, 'i_fname'), 'Zz');
      assert.equal(val(w, 'i_lname'), 'Privacycheck');
      assert.equal(val(w, 'i_email'), EMAIL);
      assert.equal(val(w, 'i_phone'), PHONE);
      await sleep(400);
      assert.ok(!w.document.getElementById('draft-toast').classList.contains('visible'), 'resume toast shown over a fresh hand-off');
    } finally { w.close(); }
  });

  test('without a hand-off the resume toast still appears for a saved draft', async () => {
    const w = await loadIntake(CLEAN, { seed(win) { win.localStorage.setItem('twa_intake_draft', DRAFT); } });
    try {
      await sleep(400);
      assert.ok(w.document.getElementById('draft-toast').classList.contains('visible'));
    } finally { w.close(); }
  });

  test('a stale stash (over 30 minutes) is ignored', async () => {
    const w = await loadIntake(CLEAN, {
      seed(win) { win.sessionStorage.setItem('twa_inline_prefill', JSON.stringify({ v: 1, at: Date.now() - 31 * 60 * 1000, name: NAME, email: EMAIL })); },
    });
    try {
      assert.equal(val(w, 'i_fname'), '');
      assert.equal(val(w, 'i_email'), '');
    } finally { w.close(); }
  });
});

describe('source order and masks', () => {
  test('the Google Places suggestion list (appended to <body>) is masked, also when it appears later', async () => {
    const w = await loadIntake('https://www.thewayagency.com/intake/?product=auto&src=inline');
    try {
      // A stand-in for the classic Places Autocomplete: it appends .pac-container to <body>.
      w.google = { maps: { places: { Autocomplete: class {
        constructor() { const d = w.document.createElement('div'); d.className = 'pac-container'; d.textContent = '1 Test St, Testville, KY'; w.document.body.appendChild(d); }
        addListener() {}
      } } } };
      w._bindPlacesAutocomplete('i_address', 'i_address_street', 'i_city', 'i_state', 'i_zip');
      const first = w.document.querySelector('.pac-container');
      assert.equal(first.getAttribute('data-clarity-mask'), 'True');
      assert.equal(first.closest('main'), null, 'the list sits outside the masked wizard, so it needs its own mask');
      const late = w.document.createElement('div'); late.className = 'pac-container'; w.document.body.appendChild(late);
      w.document.getElementById('i_address').dispatchEvent(new w.Event('focus'));
      assert.equal(late.getAttribute('data-clarity-mask'), 'True');
    } finally { w.close(); }
  });

  test('twa-url-scrub is the first script in <head>, before every stylesheet and attribution.js', () => {
    const head = HTML.slice(0, HTML.indexOf('</head>'));
    const scrubAt = head.indexOf('twa-url-scrub');
    assert.ok(scrubAt > 0, 'no twa-url-scrub in <head>');
    assert.equal(head.search(/<script\b/), head.lastIndexOf('<script', scrubAt), 'another <script> precedes the scrub');
    assert.ok(scrubAt < head.search(/<link[^>]+rel="stylesheet"/), 'the scrub must precede the first stylesheet');
    assert.ok(scrubAt < head.indexOf(ATTR_TAG), 'the scrub must precede attribution.js');
    assert.ok(head.indexOf('<meta charset="UTF-8">') < scrubAt, 'keep <meta charset> first');
  });

  test('the intake never reads name/email/phone from URL parameters', () => {
    assert.doesNotMatch(HTML, /params\.get\(\s*['"](name|email|phone)['"]\s*\)/);
    assert.doesNotMatch(HTML, /fill\(\s*['"](email|phone)['"]/);
  });

  test('Clarity masks: the wizard container, #draft-toast, #review-summary and #step-confirm', () => {
    const dom = new JSDOM(HTML); // parse only, no scripts
    const d = dom.window.document;
    const masked = [...d.querySelectorAll('[data-clarity-mask="True"]')];
    const want = [d.getElementById('draft-toast'), d.querySelector('main > .container'), d.getElementById('review-summary'), d.getElementById('step-confirm')];
    for (const el of want) {
      assert.ok(el, 'expected element missing');
      assert.ok(masked.includes(el), `${el.id || el.className} is not masked`);
    }
    // Everything that echoes what the visitor typed sits inside a masked element.
    for (const id of ['review-summary', 'confirm-message', 'ref-number', 'draft-toast-detail', 'takeover-ref']) {
      assert.ok(d.getElementById(id).closest('[data-clarity-mask="True"]'), `#${id} is outside every Clarity mask`);
    }
  });
});
