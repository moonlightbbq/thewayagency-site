/**
 * The out-of-area decline, driven through the REAL src/intake.html (ticket c2cc96ea).
 *
 * These load the actual page in jsdom and click through it. That matters: the last
 * round of this ticket was "fixed and tested" against logic that the live form did
 * not reach — the tests posted a payload the client never sends. So nothing here
 * reimplements the gate; it drives the page and reads what a customer would see.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'src', 'intake.html'), 'utf8');

// GET /api/intake/rules, exactly as SAGE serves it (src/lib/product-lines.js).
// The two products that started this: 'dwelling_fire' is PERSONAL here and sits
// under Commercial in this page's product grid; 'special_event' is COMMERCIAL here
// and the server used not to know the id at all. The page must take BOTH answers
// from this payload and none from its own grid.
const RULES = {
  serviceStates: ['KY', 'IN', 'TN'],
  productLines: {
    auto: 'personal', homeowners: 'personal', renters: 'personal', umbrella: 'personal',
    flood: 'personal', motorcycle: 'personal', boat: 'personal', rv: 'personal',
    earthquake: 'personal', pet: 'personal', dwelling_fire: 'personal',
    bop: 'commercial', cgl: 'commercial', commercial_auto: 'commercial',
    workers_comp: 'commercial', cyber: 'commercial', eo: 'commercial', bonds: 'commercial',
    builders_risk: 'commercial', farm_ranch: 'commercial', commercial_property: 'commercial',
    special_event: 'commercial',
    term_life: 'life', whole_life: 'life', final_expense: 'life', annuities: 'life',
    disability: 'life',
    medicare: 'health', medicaid: 'health', individual_health: 'health',
    family_health: 'health', group_health: 'health', supplemental_health: 'health',
    dental_vision: 'health',
  },
  stateNames: { CA: 'California', TX: 'Texas', KY: 'Kentucky', IN: 'Indiana', TN: 'Tennessee' },
  declineTemplate: "We're really sorry, but we aren't licensed to write personal insurance in "
    + '{{STATE}}. We can only take care of folks in Kentucky, Indiana and Tennessee right now, so '
    + "we can't help with this one. We hate to turn you away, and we hope you find great coverage.",
  stateToken: '{{STATE}}',
};

/** Load the page, with /api/intake/rules answered (or not). */
async function loadPage({ serveRules = true, url = 'https://thewayagency.com/intake/' } = {}) {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url,
    beforeParse(w) {
      w.fetch = (input) => {
        const href = String(input);
        if (href.includes('/api/intake/rules')) {
          return serveRules
            ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(RULES) })
            : Promise.reject(new Error('offline'));
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.scrollTo = () => {};
      Object.defineProperty(w.HTMLElement.prototype, 'scrollIntoView', { value: () => {} });
    },
  });
  const w = dom.window;
  // The rules land asynchronously. serviceStateNames() is empty until they do, so
  // it doubles as the "are we ready" signal without reaching into script scope.
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 5));
    if (!serveRules || w.serviceStateNames()) break;
  }
  return w;
}

const setState = (w, code) => {
  w.document.getElementById('i_state').value = code;
  w.onStateChange();
};
const pick = (w, pid) => {
  const tile = w.document.querySelector(`.product-opt[data-pid="${pid}"]`);
  assert.ok(tile, `no product tile for ${pid} — the grid no longer offers it`);
  w.toggleProd(tile);
};
const oosText = (w) => w.document.getElementById('state-oos').textContent;
const stepErr = (w, n) => w.document.getElementById(`step${n}-error`);

// ─────────────────────────────────────────────────────────────────────────────
describe('the licence question is answered by the SERVER, not by the product grid', () => {
  let w;
  before(async () => { w = await loadPage(); });
  beforeEach(() => { w.document.querySelectorAll('.product-opt.selected').forEach((e) => w.toggleProd(e)); });

  // THE cross-repo defect. Both of these tiles sit under "Commercial" in the grid
  // (PRODUCTS[].line === 'commercial'), because that is where a landlord and an
  // event organiser go looking for them. But only ONE of them is commercial as far
  // as our licence is concerned. Classifying them from the grid — which is what
  // this page used to do — gets dwelling_fire wrong in Texas, every time.
  test('dwelling_fire is PERSONAL: a Texas landlord is declined, though the grid files it under Commercial', () => {
    assert.equal(w.getProductLine('dwelling_fire'), 'commercial', 'grid placement (display) unchanged');
    setState(w, 'TX');
    pick(w, 'dwelling_fire');
    assert.equal(w.currentStateRule(), 'required');
    assert.equal(w.mustDecline(), true);
  });

  test('special_event is COMMERCIAL: a Texas visitor is written, not declined', () => {
    setState(w, 'TX');
    pick(w, 'special_event');
    assert.equal(w.currentStateRule(), 'exempt');
    assert.equal(w.mustDecline(), false, 'we write commercial anywhere — this is the whole point');
  });

  test("the 'other' catch-all is never a decline — we cannot tell, so a human looks", () => {
    setState(w, 'TX');
    pick(w, 'other');
    assert.equal(w.mustDecline(), false);
  });

  // The real invariant, stated once: for every tile the form offers, the page's
  // answer must equal the server's. Anything else is the bug we are fixing.
  test('every product tile agrees with the server map', () => {
    for (const [pid, line] of Object.entries(RULES.productLines)) {
      if (!w.document.querySelector(`.product-opt[data-pid="${pid}"]`)) continue;
      w.document.querySelectorAll('.product-opt.selected').forEach((e) => w.toggleProd(e));
      setState(w, 'TX');
      pick(w, pid);
      const expected = (line === 'personal' || line === 'life' || line === 'health');
      assert.equal(w.mustDecline(), expected,
        `${pid} is '${line}' on the server; the page disagrees about whether Texas is a decline`);
    }
  });

  test('an in-area personal lead is never declined', () => {
    setState(w, 'KY');
    pick(w, 'auto');
    assert.equal(w.mustDecline(), false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the decline is taken back when the applicant corrects their state', () => {
  let w;
  before(async () => { w = await loadPage(); });

  // REPRODUCED before the fix: hideOutOfArea() hid #state-oos and stopped, leaving
  // the copy showOutOfArea() had written into step2-error on screen. A Kentucky
  // customer went on reading that we could not write them.
  test('CA + Auto declines, then switching to Kentucky clears every trace of it', () => {
    w.showStep(2);
    setState(w, 'CA');
    pick(w, 'auto');

    assert.match(oosText(w), /really sorry/, 'the step-1 box carries the decline');
    assert.match(stepErr(w, 2).textContent, /really sorry/, 'and so does the step the applicant is on');
    assert.equal(stepErr(w, 2).classList.contains('hidden'), false);

    setState(w, 'KY');   // "Back", and correct the state

    assert.equal(w.mustDecline(), false);
    assert.equal(oosText(w), '', 'step-1 decline cleared');
    assert.equal(stepErr(w, 2).textContent, '', 'step-2 decline cleared — this is the one that was left behind');
    assert.equal(stepErr(w, 2).classList.contains('hidden'), true);
  });

  test('a genuine validation message is NOT swallowed by hideOutOfArea', () => {
    w.showStep(2);
    setState(w, 'CA');
    pick(w, 'auto');                       // decline on screen
    const err = stepErr(w, 2);
    err.textContent = 'Please select at least one type of coverage.';   // a real one, over the top
    setState(w, 'KY');
    assert.equal(err.textContent, 'Please select at least one type of coverage.',
      'hideOutOfArea cleared a message that was not its own');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the applicant actually reads the decline on submit', () => {
  let w;
  before(async () => { w = await loadPage(); });

  // The server answers a rejected submit with 400 {code:'OUT_OF_AREA', error:<words>}.
  // Both submit handlers used to throw on !res.ok, and the catch rendered "Network
  // error. Please check your connection" — so the applicant read either "Submission
  // failed" or a lie about their wifi. The wording IS this ticket.
  test('a 400 OUT_OF_AREA renders the server words verbatim, not "Submission failed"', () => {
    w.showStep(4);
    const err = stepErr(w, 4);
    const words = "We're really sorry, but we aren't licensed to write personal insurance in California. "
      + 'We can only take care of folks in Kentucky, Indiana and Tennessee right now.';

    w.renderSubmitError(err, 400, { error: words, code: 'OUT_OF_AREA', field: 'state' });

    assert.equal(oosText(w), words, 'the decline is shown, word for word as the server wrote it');
    assert.doesNotMatch(oosText(w), /Submission failed|Network error/);
    assert.doesNotMatch(oosText(w), /commercial/i, 'and it must never pitch commercial');
  });

  test('an ordinary server error still reports as an error', () => {
    w.showStep(4);
    const err = stepErr(w, 4);
    w.renderSubmitError(err, 500, { error: 'Something broke' });
    assert.equal(err.textContent, 'Something broke');
    assert.equal(err.classList.contains('hidden'), false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('when the rules cannot be loaded, we decline nobody', () => {
  let w;
  before(async () => { w = await loadPage({ serveRules: false }); });

  // Fail OPEN, deliberately. The server makes the same decision on /track and again
  // on the final submit, and both hand back the words. The worst outcome here is
  // that the bad news arrives a moment later — never that we turn away a customer
  // we could have helped on a guess we had no data for.
  test('an out-of-area personal lead is not declined by the browser', () => {
    setState(w, 'CA');
    pick(w, 'auto');
    assert.equal(w.mustDecline(), false);
    assert.equal(w.currentStateRule(), 'unknown');
  });

  test('and no half-written decline copy is invented locally', () => {
    assert.equal(w.outOfAreaCopy('CA'), '', 'a local fallback string is just the duplicate list again');
  });
});
