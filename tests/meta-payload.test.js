/**
 * Meta receives no product, line, health signal or contact data (TRUST-12).
 *
 * Meta's Business Tools Terms (1.h, 1.a.i) bar health information, including
 * through event parameters or the criteria an event fires on, and unhashed
 * contact information. The Lead event used to carry content_name = the selected
 * products (medicare, term_life, ...) and attribution.js called
 * fbq('setUserProperties') with plain-text email, phone, name and ZIP.
 *
 * This file covers both specs that own the edit, which is made once:
 * pii-and-privacy §4 tests/meta-payload.test.js and medicare-health-compliance
 * §4 tests/meta-pixel-params.test.js (source level) plus its "Meta Lead" row.
 * Health carts send no Lead at all (owner decision for medicare D-10, applied
 * whenever the pixel runs).
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const INTAKE = fs.readFileSync(path.join(SRC, 'intake.html'), 'utf8');
const APP = fs.readFileSync(path.join(SRC, 'js', 'app.js'), 'utf8');
const ATTR = fs.readFileSync(path.join(SRC, 'js', 'attribution.js'), 'utf8');
const ATTR_TAG = '<script src="/src/js/attribution.js"></script>';
const PAGE = INTAKE.replace(ATTR_TAG, '<script>' + ATTR + '</script>');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('source: no product data and no advanced matching sent to Meta', () => {
  test('no Lead call carries content_name (intake, app.js)', () => {
    assert.doesNotMatch(INTAKE, /content_name:\s*selectedProducts/);
    assert.doesNotMatch(INTAKE, /['"]Lead['"]\s*,\s*\{[^}]*content_name/);
    assert.doesNotMatch(APP, /['"]Lead['"]\s*,\s*\{[^}]*content_name/);
  });

  test('no setUserProperties anywhere under src/', () => {
    const hits = walk(SRC).filter((f) => fs.readFileSync(f, 'utf8').includes('setUserProperties'));
    assert.deepEqual(hits.map((f) => path.relative(ROOT, f)), []);
  });

  test('no pixel-ID constant in attribution.js and no fbPixelId in app.js', () => {
    assert.doesNotMatch(ATTR, /FB_PIXEL_ID/);
    assert.doesNotMatch(ATTR, /['"]\d{15,17}['"]/, 'a pixel-ID-shaped literal is back in attribution.js');
    assert.doesNotMatch(APP, /fbPixelId/);
  });
});

/** The intake with fbq stubbed; every fetch answered locally. */
async function loadIntake() {
  const calls = [];
  const dom = new JSDOM(PAGE, {
    runScripts: 'dangerously',
    url: 'https://www.thewayagency.com/intake/',
    beforeParse(w) {
      w.fbq = (...args) => calls.push(args);
      w.fetch = (input) => {
        const href = String(input);
        if (href.endsWith('/api/intake')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, reference: 'TEST' }) });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.scrollTo = () => {};
      Object.defineProperty(w.HTMLElement.prototype, 'scrollIntoView', { value: () => {} });
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  return { w: dom.window, calls };
}

const leadCalls = (calls) => calls.filter((c) => c[0] === 'track' && c[1] === 'Lead');
// Objects built inside the jsdom realm have that realm's prototypes.
const plain = (o) => JSON.parse(JSON.stringify(o));

describe('behaviour: the Lead event on full submit (trackSubmitSuccess)', () => {
  test('a P&C cart sends one Lead with no product or line', async () => {
    const { w, calls } = await loadIntake();
    try {
      w.eval("selectedProducts = ['auto', 'homeowners']");
      w.trackSubmitSuccess('TEST', 2);
      const leads = leadCalls(calls);
      assert.equal(leads.length, 1);
      assert.deepEqual(plain(leads[0][2]), { content_category: 'quote_request', currency: 'USD' });
      assert.deepEqual(plain(leads[0][3]), { eventID: 'TEST' });
      assert.ok(!JSON.stringify(calls).match(/auto|homeowners|personal/), 'product or line reached fbq');
    } finally { w.close(); }
  });

  test('a cart with any health product sends no Lead at all (and nothing names medicare)', async () => {
    const { w, calls } = await loadIntake();
    try {
      w.eval("selectedProducts.push('medicare')");
      w.trackSubmitSuccess('TEST', 1);
      assert.equal(leadCalls(calls).length, 0);
      assert.ok(!JSON.stringify(calls).includes('medicare'));
      w.eval("selectedProducts = ['auto', 'dental_vision']");
      w.trackSubmitSuccess('TEST', 2);
      assert.equal(leadCalls(calls).length, 0, 'a mixed cart with a health tile is still a health signal');
    } finally { w.close(); }
  });

  test('every health tile in PRODUCTS suppresses the Lead', async () => {
    const { w, calls } = await loadIntake();
    try {
      const healthIds = JSON.parse(w.eval("JSON.stringify(PRODUCTS.filter(p => p.line === 'health').map(p => p.id))"));
      assert.deepEqual(healthIds.sort(), ['dental_vision', 'family_health', 'group_health', 'individual_health', 'medicaid', 'medicare', 'supplemental_health']);
      for (const id of healthIds) {
        w.eval(`selectedProducts = ['${id}']`);
        assert.equal(w.sendMetaLead(), false, id);
      }
      w.eval("selectedProducts = ['term_life']");
      assert.equal(w.sendMetaLead(), true, 'life carts send a product-free Lead (D-10 covers health)');
    } finally { w.close(); }
  });
});

describe('behaviour: the Lead event on the quick lead (submitQuickLead)', () => {
  test('a P&C quick lead sends one product-free Lead with the reference as eventID', async () => {
    const { w, calls } = await loadIntake();
    try {
      w.eval("selectedProducts = ['auto']");
      await w.submitQuickLead();
      const leads = leadCalls(calls);
      assert.equal(leads.length, 1);
      assert.deepEqual(plain(leads[0][2]), { content_category: 'quick_lead', currency: 'USD' });
      assert.deepEqual(plain(leads[0][3]), { eventID: 'TEST' });
      assert.ok(!JSON.stringify(calls).includes('auto'));
    } finally { w.close(); }
  });

  test('a Medicare quick lead sends no Lead', async () => {
    const { w, calls } = await loadIntake();
    try {
      w.eval("selectedProducts = ['medicare']");
      await w.submitQuickLead();
      assert.equal(w.document.getElementById('ref-number').textContent, 'Reference: #TEST', 'the quick lead itself succeeded');
      assert.equal(leadCalls(calls).length, 0);
      assert.ok(!JSON.stringify(calls).includes('medicare'));
    } finally { w.close(); }
  });
});

describe('behaviour: enhanced conversions reach the dataLayer hashed, and Meta not at all', () => {
  test('TWA.pushEnhancedConversion makes zero fbq calls', async () => {
    const calls = [];
    const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
      url: 'https://www.thewayagency.com/contact',
      runScripts: 'dangerously',
      beforeParse(w) { w.fbq = (...args) => calls.push(args); },
    });
    const w = dom.window;
    try {
      const s = w.document.createElement('script');
      s.textContent = ATTR;
      w.document.head.appendChild(s);
      await w.TWA.pushEnhancedConversion({ email: 'zz.privacycheck@example.com', phone: '5555550123', firstName: 'Zz', lastName: 'Privacycheck', zip: '40202' });
      assert.equal(calls.length, 0, 'fbq was called');
      const ec = (w.dataLayer || []).find((e) => e && e.event === 'enhanced_conversion');
      if (ec) {
        // jsdom may lack crypto.subtle; when present, the values must be hashes.
        const flat = JSON.stringify(ec);
        assert.ok(!flat.includes('zz.privacycheck@example.com') && !flat.includes('5555550123') && !flat.includes('Privacycheck'));
      }
    } finally { w.close(); }
  });
});
