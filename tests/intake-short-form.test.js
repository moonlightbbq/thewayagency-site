/**
 * The seven-input quote form, driven through the REAL src/intake.html.
 *
 * 47% of sessions that started the old ten-input form never finished it, and 31 of
 * those left no contact behind at all. This is the cut: first, last, email, phone,
 * state, mailing address, coverage — then submit. Everything else is offered after
 * the lead exists.
 *
 * Nothing here re-implements the page's logic, for the same reason
 * intake-gate.test.js doesn't: the bugs this file is guarding against were all
 * invisible to a test that posted a payload the browser never sends.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'src', 'intake.html'), 'utf8');

// GET /api/intake/rules as SAGE serves it. special_event is COMMERCIAL here and is
// absent from the page's local COMMERCIAL_PRODUCTS list — that gap is the bug in
// "a commercial cart the old list did not know about" below.
const RULES = {
  serviceStates: ['KY', 'IN', 'TN'],
  productLines: {
    auto: 'personal', homeowners: 'personal', life: 'life', medicare: 'health',
    bop: 'commercial', cgl: 'commercial',
    special_event: 'commercial', commercial_property: 'commercial', farm_ranch: 'commercial',
  },
  stateNames: { KY: 'Kentucky', IN: 'Indiana', TN: 'Tennessee', CA: 'California' },
  declineTemplate: "We aren't licensed to write personal insurance in {{STATE}}.",
  stateToken: '{{STATE}}',
};

async function loadPage({ serveRules = true, url = 'https://thewayagency.com/intake/' } = {}) {
  const posted = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url,
    beforeParse(w) {
      w.fetch = (input, init) => {
        const href = String(input);
        if (href.includes('/api/intake/rules')) {
          return serveRules
            ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(RULES) })
            : Promise.reject(new Error('offline'));
        }
        if (init && init.body) {
          try { posted.push({ href, body: JSON.parse(init.body) }); } catch (e) { /* not json */ }
        }
        if (href.includes('/api/intake/track')) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ sessionId: 'sess-fixture' }) });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ reference: 'AB12C' }) });
      };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.scrollTo = () => {};
      Object.defineProperty(w.HTMLElement.prototype, 'scrollIntoView', { value: () => {} });
    },
  });
  const w = dom.window;
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 5));
    if (!serveRules || w.serviceStateNames()) break;
  }
  w.__posted = posted;
  return w;
}

const set = (w, id, val) => { w.document.getElementById(id).value = val; };
const fillStep1 = (w, { state = 'KY', address = '12 Oak St, Owensboro, KY 42301' } = {}) => {
  set(w, 'i_fname', 'Testy'); set(w, 'i_lname', 'Fixture');
  set(w, 'i_email', 'testy@example.test'); set(w, 'i_phone', '5025550123');
  set(w, 'i_state', state); w.onStateChange();
  set(w, 'i_address', address);
};
const pick = (w, pid) => {
  const tile = w.document.querySelector(`.product-opt[data-pid="${pid}"]`);
  assert.ok(tile, `product tile ${pid} should exist`);
  w.toggleProd(tile);
};
const visible = (w, id) => {
  const el = w.document.getElementById(id);
  return !!el && el.style.display !== 'none';
};

describe('the short form asks for seven things and then submits', () => {
  let w;
  before(async () => { w = await loadPage(); });
  after(() => w && w.close());

  test('the flag is on by default, and the long-form chrome is hidden', () => {
    assert.equal(w.INTAKE_FLAGS.shortForm, true);
    assert.ok(w.document.body.classList.contains('twa-intake-short'));
  });

  test('step 1 carries the address, beside the state it has to agree with', () => {
    const step1 = w.document.getElementById('step-1');
    for (const id of ['i_fname', 'i_lname', 'i_email', 'i_phone', 'i_state', 'i_address']) {
      assert.ok(step1.querySelector('#' + id), `${id} belongs on step 1`);
    }
  });

  test('the old quick-lead escape hatch is gone — this IS the path now', () => {
    assert.equal(typeof w.submitQuickLead, 'undefined');
    assert.equal(w.document.getElementById('quick-lead-link'), null);
    assert.ok(w.document.getElementById('submit-btn-short'), 'step 2 submits');
  });

  test('a missing address holds the visitor on step 1', async () => {
    fillStep1(w, { address: '' });
    await w.nextStep(1);
    assert.ok(!w.document.getElementById('step-1').classList.contains('hidden'),
      'still on step 1 with no address');
  });
});

describe('what actually reaches SAGE', () => {
  let w;
  before(async () => {
    w = await loadPage();
    fillStep1(w);
    await w.nextStep(1);
    pick(w, 'auto');
    await w.submitIntake();
    await new Promise((r) => setTimeout(r, 30));
  });
  after(() => w && w.close());

  test('the submit carries address and state, not just contact details', () => {
    const submit = w.__posted.find((p) => /\/api\/intake$/.test(p.href));
    assert.ok(submit, 'the form posted to /api/intake');
    const b = submit.body;
    assert.equal(b.firstName, 'Testy');
    assert.equal(b.lastName, 'Fixture');
    assert.ok(b.email && b.phone, 'BOTH channels — contactChannelError rejects one-channel leads');
    assert.equal(b.state, 'KY', 'the licensing gate needs this');
    assert.ok(String(b.address || '').includes('Oak St'), 'address survived the move to step 1');
    assert.ok(Array.isArray(b.products) && b.products.length >= 1,
      'no product means SAGE creates no pipeline card at all');
  });
});

describe('a commercial cart the old list did not know about', () => {
  // special_event, commercial_property and farm_ranch are commercial to SAGE but
  // were absent from the page's local COMMERCIAL_PRODUCTS. The client waved them
  // through, the server refused them, and the visitor read "Validation failed"
  // with no business-name field anywhere on screen. Every one of those was a lost
  // lead, in production, silently.
  for (const pid of ['special_event', 'commercial_property', 'farm_ranch']) {
    test(`${pid} asks for the business name instead of dead-ending`, async () => {
      const w = await loadPage();
      fillStep1(w);
      await w.nextStep(1);
      pick(w, pid);

      assert.equal(w.needsBusinessName([pid]), true, 'decided by RULES.productLines, not a local copy');
      assert.ok(visible(w, 'biz-name-step1-group'), 'the field appears as soon as the cart turns commercial');

      await w.submitIntake();
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(w.__posted.filter((p) => /\/api\/intake$/.test(p.href)).length, 0,
        'refused on the client, where the visitor can still fix it');
      const err = w.document.getElementById('step2-error');
      assert.match(err.textContent, /business name/i);
      assert.ok(!err.classList.contains('hidden'));
      w.close();
    });
  }

  test('a personal cart is never asked for one', async () => {
    const w = await loadPage();
    fillStep1(w);
    await w.nextStep(1);
    pick(w, 'auto');
    assert.equal(w.needsBusinessName(['auto']), false);
    w.close();
  });
});

describe('the decline still happens, at every gate that is left', () => {
  test('an out-of-area personal lead is refused on step 1', async () => {
    // Arrive from a product page, so the line IS known at step 1. A bare /intake/
    // visit deliberately cannot be judged yet — that is the step-2 case below.
    const w = await loadPage({ url: 'https://thewayagency.com/intake/?product=auto' });
    fillStep1(w, { state: 'CA' });
    await w.nextStep(1);
    assert.match(w.document.getElementById('state-oos').textContent, /California/);
    w.close();
  });

  test('and on step 2, once an empty cart finally says what it wants', async () => {
    const w = await loadPage();
    fillStep1(w, { state: 'CA' });
    // A bare /intake/ arrival has no line at step 1, so nothing can be judged yet.
    await w.nextStep(1);
    pick(w, 'auto');
    await w.nextStep(2);
    assert.ok(w.mustDecline(), 'the cart is what makes this judgeable');
    w.close();
  });
});

describe('the long form is one config edit away', () => {
  test('?twa_form=long restores the four-step flow without a code change', async () => {
    const w = await loadPage({ url: 'https://thewayagency.com/intake/?twa_form=long' });
    assert.equal(w.INTAKE_FLAGS.shortForm, false);
    assert.ok(!w.document.body.classList.contains('twa-intake-short'));
    assert.ok(w.document.getElementById('step-3'), 'step 3 never left the DOM');
    assert.ok(w.document.getElementById('step-4'));
    w.showStep(4);
    assert.ok(!w.document.getElementById('step-4').classList.contains('hidden'));
    w.close();
  });
});
