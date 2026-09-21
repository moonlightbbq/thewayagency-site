/**
 * The intake funnel actually dispatches its events.
 *
 * Every intake_* event on this page runs through trackIntake(), which opens with
 * `if (!window.gtag) return;`. GTM is injected into /intake/ at build time and
 * creates window.dataLayer — but it never creates window.gtag. That helper lives
 * in src/js/app.js, which this page deliberately does not load. So for as long as
 * nobody defined it here, the whole funnel — starts, step views, field friction,
 * validation errors, abandonment, completions — fired into nothing in production,
 * silently, while looking fully instrumented in the source.
 *
 * These drive the REAL page rather than re-implementing the dispatcher, for the
 * same reason intake-gate.test.js does: the last version of this bug was invisible
 * precisely because nothing exercised the path a browser takes.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'src', 'intake.html'), 'utf8');

const RULES = {
  serviceStates: ['KY', 'IN', 'TN'],
  productLines: { auto: 'personal', homeowners: 'personal', bop: 'commercial' },
  stateNames: { KY: 'Kentucky', IN: 'Indiana', TN: 'Tennessee' },
  declineTemplate: "We aren't licensed in {{STATE}}.",
  stateToken: '{{STATE}}',
};

async function loadPage() {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://thewayagency.com/intake/',
    beforeParse(w) {
      w.fetch = (input) => String(input).includes('/api/intake/rules')
        ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(RULES) })
        : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.scrollTo = () => {};
      Object.defineProperty(w.HTMLElement.prototype, 'scrollIntoView', { value: () => {} });
    },
  });
  const w = dom.window;
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 5));
    if (w.serviceStateNames()) break;
  }
  return w;
}

// gtag pushes an `arguments` object, so an event is ['event', name, params].
const eventsIn = (w) => (w.dataLayer || [])
  .filter((entry) => entry && entry[0] === 'event')
  .map((entry) => entry[1]);

describe('the intake funnel reaches the dataLayer', () => {
  let w;
  before(async () => { w = await loadPage(); });

  test('window.gtag exists without app.js being loaded', () => {
    assert.equal(typeof w.gtag, 'function', 'trackIntake() returns early without this');
    assert.ok(Array.isArray(w.dataLayer), 'GTM would create this, but the page must not depend on load order');
  });

  test('intake_start fires on page load', () => {
    assert.ok(eventsIn(w).includes('intake_start'),
      'the denominator of every conversion-rate comparison');
  });

  test('advancing a step reports the step view and the completion', () => {
    w.showStep(2);
    const seen = eventsIn(w);
    assert.ok(seen.includes('intake_step_view'), 'step views are how we see where people stop');
    assert.ok(seen.includes('intake_step_complete'));
  });

  test('a validation failure is reported, not just shown', () => {
    const before = eventsIn(w).length;
    w.trackValidationError(1, 'missing_email');
    const seen = eventsIn(w);
    assert.equal(seen.length, before + 1);
    assert.equal(seen[seen.length - 1], 'intake_validation_error');
  });

  test('abandonment is reported', () => {
    w.trackAbandonment();
    assert.ok(eventsIn(w).includes('intake_abandoned'),
      'without this, 47% of sessions leave no trace in analytics');
  });
});
