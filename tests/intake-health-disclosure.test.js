/**
 * The Medicare/health lead disclosure on the REAL src/intake.html (TRUST-01;
 * specs/medicare-health-compliance.md 3.11 and section 4), driven in jsdom with
 * every network call stubbed (nothing reaches SAGE).
 *
 * The page carries a mirror of scripts/lib/medicare-disclaimer.js
 * leadDisclosureText() (it loads no Node modules); the drift tests below fail
 * when the two ever produce different text.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const M = require('../scripts/lib/medicare-disclaimer');
const { tpmoDataElement, TPMO_DATA_ELEMENT } = require('../scripts/builders/assets');

const ROOT = path.join(__dirname, '..');
const SRC_HTML = fs.readFileSync(path.join(ROOT, 'src', 'intake.html'), 'utf8');
const SITE_TPMO = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'medicare-tpmo.json'), 'utf8'));

/** The page as the build ships it: #tpmo-data filled from `tpmo` (the site record by default). */
function builtHtml(tpmo = SITE_TPMO) {
  assert.ok(SRC_HTML.includes(TPMO_DATA_ELEMENT), 'src/intake.html carries the #tpmo-data placeholder');
  return SRC_HTML.split(TPMO_DATA_ELEMENT).join(tpmoDataElement(tpmo));
}

async function loadPage({ url = 'https://thewayagency.com/intake/', html = builtHtml() } = {}) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url,
    beforeParse(w) {
      // Every request is answered locally: no lead, no autosave, nothing leaves the process.
      w.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.scrollTo = () => {};
      Object.defineProperty(w.HTMLElement.prototype, 'scrollIntoView', { value: () => {} });
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  return dom.window;
}
const $ = (w, id) => w.document.getElementById(id);
const visible = (el) => Boolean(el) && !el.hidden;
const pick = (w, pid) => {
  const tile = w.document.querySelector(`.product-opt[data-pid="${pid}"]`);
  assert.ok(tile, `no tile ${pid}`);
  w.toggleProd(tile);
};

describe('intake: the lead disclosure before the first field', () => {
  test('?product=medicare: step 1 shows the Medicare text above #i_fname at 14px, and the subtitle names a licensed insurance agent', async () => {
    const w = await loadPage({ url: 'https://thewayagency.com/intake/?product=medicare' });
    const box = $(w, 'health-disclosure-step1');
    assert.ok(visible(box));
    assert.equal(box.textContent, M.leadDisclosureText(SITE_TPMO, { context: 'medicare' }));
    assert.ok(box.compareDocumentPosition($(w, 'i_fname')) & w.Node.DOCUMENT_POSITION_FOLLOWING, 'the disclosure precedes the first field');
    assert.ok(parseFloat(box.style.fontSize) >= 13, 'at least 13px');
    assert.equal($(w, 'intake-subtitle').textContent, 'A licensed insurance agent will contact you about your Medicare request.');
    assert.ok(visible($(w, 'health-disclosure-step2')) && visible($(w, 'health-disclosure-step4')));
  });

  test('?line=health: the health_line text and subtitle', async () => {
    const w = await loadPage({ url: 'https://thewayagency.com/intake/?line=health' });
    assert.equal($(w, 'health-disclosure-step1').textContent, M.leadDisclosureText(SITE_TPMO, { context: 'health_line' }));
    assert.ok(visible($(w, 'health-disclosure-step1')));
    assert.equal($(w, 'intake-subtitle').textContent, 'A licensed insurance agent will contact you about your Medicare or health insurance request.');
  });

  test('plain /intake/: nothing until a health tile is picked, then step 2 shows it above Continue; deselecting hides it again', async () => {
    const w = await loadPage();
    const base = $(w, 'intake-subtitle').textContent;
    assert.ok(!visible($(w, 'health-disclosure-step1')) && !visible($(w, 'health-disclosure-step2')));
    pick(w, 'individual_health');
    assert.ok(visible($(w, 'health-disclosure-step2')));
    assert.equal($(w, 'health-disclosure-step2').textContent, M.leadDisclosureText(SITE_TPMO, { context: 'health' }));
    pick(w, 'medicare');
    assert.equal($(w, 'health-disclosure-step2').textContent, M.leadDisclosureText(SITE_TPMO, { context: 'medicare' }));
    const step2 = $(w, 'health-disclosure-step2');
    const cont = w.document.querySelector('#step-2 [data-action="next-step"]');
    assert.ok(step2.compareDocumentPosition(cont) & w.Node.DOCUMENT_POSITION_FOLLOWING, 'above Continue to Quote Details');
    assert.ok(step2.compareDocumentPosition($(w, 'quick-lead-link')) & w.Node.DOCUMENT_POSITION_FOLLOWING, 'above the quick-lead link');
    pick(w, 'medicare');
    pick(w, 'individual_health');
    assert.ok(!visible($(w, 'health-disclosure-step2')));
    assert.equal($(w, 'intake-subtitle').textContent, base, 'the subtitle comes back');
  });

  test('a personal-lines visit never shows it', async () => {
    const w = await loadPage({ url: 'https://thewayagency.com/intake/?product=auto' });
    assert.ok(!visible($(w, 'health-disclosure-step1')));
    pick(w, 'homeowners');
    assert.ok(!visible($(w, 'health-disclosure-step2')));
  });

  test('step 4: the disclosure sits directly above Submit Quote Request', async () => {
    const w = await loadPage({ url: 'https://thewayagency.com/intake/?product=medicare' });
    const box = $(w, 'health-disclosure-step4');
    assert.ok(visible(box));
    assert.ok(box.compareDocumentPosition($(w, 'submit-btn')) & w.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.ok($(w, 'review-summary').compareDocumentPosition(box) & w.Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

describe('intake: the mirror equals scripts/lib/medicare-disclaimer.js (drift)', () => {
  const fixtures = (() => {
    const branchA = JSON.parse(JSON.stringify(SITE_TPMO));
    branchA.lead_disclosure.contact_entities = ['The Way Agency'];
    const branchB = JSON.parse(JSON.stringify(SITE_TPMO));
    branchB.lead_disclosure.contact_entities = ['The Way Agency', 'Test Partner Agency LLC'];
    branchB.lead_disclosure.medicare_products_label = 'Medicare Supplement (Medigap), Medicare Advantage or Part D plans';
    branchB.lead_disclosure.tcpa = true;
    return { site: SITE_TPMO, branchA, branchB, none: null };
  })();

  test('every context and form gives the same text in the page as in the module', async () => {
    const w = await loadPage();
    for (const [name, data] of Object.entries(fixtures)) {
      for (const context of M.LEAD_CONTEXTS) {
        for (const form of [undefined, 'inline']) {
          assert.equal(w.leadDisclosureText(data, { context, form }), M.leadDisclosureText(data, { context, form }), `${name} ${context} ${form || 'intake'}`);
        }
      }
    }
  });

  test('the injected record drives the page: Branch B names both entities and the TCPA sentence', async () => {
    const w = await loadPage({ url: 'https://thewayagency.com/intake/?product=medicare', html: builtHtml(fixtures.branchB) });
    assert.equal($(w, 'health-disclosure-step1').textContent, M.leadDisclosureText(fixtures.branchB, { context: 'medicare' }));
    assert.equal($(w, 'intake-subtitle').textContent, 'A licensed insurance agent with The Way Agency or Test Partner Agency LLC will contact you about your Medicare request.');
  });

  test('HEALTH_PRODUCT_IDS is exactly the health tiles in PRODUCTS', async () => {
    const w = await loadPage();
    const ids = JSON.parse(w.eval('JSON.stringify(HEALTH_PRODUCT_IDS)'));
    const fromGrid = JSON.parse(w.eval("JSON.stringify(PRODUCTS.filter(p => p.line === 'health').map(p => p.id))"));
    assert.deepEqual(ids, fromGrid);
    assert.deepEqual([...ids].sort(), ['dental_vision', 'family_health', 'group_health', 'individual_health', 'medicaid', 'medicare', 'supplemental_health']);
  });

  test('the shipped page carries only the public record (no signed_record, no _doc)', () => {
    const t = JSON.parse(JSON.stringify(SITE_TPMO));
    t.signed_record = 'compliance-log TEST #1';
    const el = tpmoDataElement(t);
    assert.ok(!el.includes('signed_record') && !el.includes('_doc') && !el.includes('compliance-log'));
  });
});
