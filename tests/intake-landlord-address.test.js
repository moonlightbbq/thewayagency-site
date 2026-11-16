/**
 * Y-95: the landlord (dwelling fire) card's "Property Address (if different
 * from mailing)" gets the homeowners property address's Google prefill and
 * structured parts, and the request carries them as df_addr / df_city /
 * df_state / df_zip (the keys SAGE's dwelling-fire form and ACORD builder read).
 * Without a Places pick (Maps unavailable, or the visitor just types) the typed
 * line is the street and the parts stay empty: never the mailing city/state/zip.
 *
 * Drives the real page in jsdom with a stub google.maps.places.Autocomplete.
 * Synthetic addresses only.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'src', 'intake.html'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadLandlordStep() {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', url: 'https://www.thewayagency.com/intake/?twa_form=long',
    beforeParse(w) {
      w.fetch = (u) => {
        const url = String(u);
        if (url.includes('/api/config')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ googleMapsKey: 'test-key-test-key-test-key' }) });
        if (url.includes('/api/intake/rules')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ serviceStates: ['KY', 'IN', 'TN'], stateNames: { KY: 'Kentucky' } }) });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.scrollTo = () => {};
      Object.defineProperty(w.HTMLElement.prototype, 'scrollIntoView', { value: () => {} });
    },
  });
  const w = dom.window;
  await sleep(60);
  // The mailing address, so a test can tell its parts were never borrowed.
  for (const [id, v] of [['i_address', '1 Mailing Way, Testville, KY 40299'], ['i_address_street', '1 Mailing Way'], ['i_city', 'Testville'], ['i_zip', '40299']]) {
    const el = w.document.getElementById(id); if (el) el.value = v;
  }
  w.eval("selectedProducts = ['dwelling_fire']");
  return w;
}
// A stub Places Autocomplete: records which inputs bind and keeps each one's place_changed handler.
function installGoogle(w) {
  const acs = {};
  w.google = { maps: { places: { Autocomplete: class {
    constructor(input) { this.input = input; acs[input.id] = this; }
    addListener(ev, fn) { if (ev === 'place_changed') this.fire = fn; }
    getPlace() { return this.place; }
  } } } };
  return acs;
}
const $ = (w, id) => w.document.getElementById(id);
// The Autocomplete bound to the landlord address (asserted, so a missing binding fails as an assertion).
const dfAc = (acs) => { assert.ok(acs.i_df_address, 'Google prefill binds to the landlord address'); return acs.i_df_address; };
const type = (w, id, value) => { const el = $(w, id); el.value = value; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
const formData = (w) => w.buildRiskFormData();
const RENTAL_PLACE = { address_components: [
  { types: ['street_number'], long_name: '77' }, { types: ['route'], long_name: 'Rental Rd' },
  { types: ['locality'], long_name: 'Testburg' }, { types: ['administrative_area_level_1'], short_name: 'KY', long_name: 'Kentucky' },
  { types: ['postal_code'], long_name: '40211' },
] };

describe('/intake/ landlord property address (Y-95)', () => {
  test('the landlord card renders the address with hidden street/city/state/zip parts, and Places binds to it', async () => {
    const w = await loadLandlordStep();
    try {
      w.showStep(2);
      await sleep(30);
      const acs = installGoogle(w);
      w._initIntakeAutocomplete();
      w.showStep(3);
      assert.ok($(w, 'i_df_address'), 'the landlord property address is on the card');
      for (const id of ['i_df_address_street', 'i_df_city', 'i_df_state', 'i_df_zip']) assert.equal($(w, id) && $(w, id).type, 'hidden', id);
      assert.ok(acs.i_df_address, 'Google prefill binds to the landlord address');
      assert.equal($(w, 'i_df_address').getAttribute('autocomplete'), 'off');
    } finally { await sleep(50); w.close(); } // let the page's Maps config request settle first
  });

  test('MUST-FAIL: a Places pick posts the structured df_addr / df_city / df_state / df_zip', async () => {
    const w = await loadLandlordStep();
    try {
      w.showStep(2);
      await sleep(30);
      const acs = installGoogle(w);
      w._initIntakeAutocomplete();
      w.showStep(3);
      dfAc(acs).place = RENTAL_PLACE;
      dfAc(acs).fire();
      assert.equal($(w, 'i_df_address').value, '77 Rental Rd, Testburg, KY 40211');
      const fd = formData(w);
      assert.equal(fd.df_addr, '77 Rental Rd');
      assert.equal(fd.df_city, 'Testburg');
      assert.equal(fd.df_state, 'KY');
      assert.equal(fd.df_zip, '40211');
      assert.equal(fd.i_df_address, '77 Rental Rd, Testburg, KY 40211', 'the typed line still goes too (SAGE reads it when no parts come)');
    } finally { await sleep(50); w.close(); } // let the page's Maps config request settle first
  });

  test('MUST-FAIL: without Maps the typed line is the street, the parts stay empty, and the mailing parts are never borrowed', async () => {
    const w = await loadLandlordStep();
    try {
      w.showStep(3); // no google object: the plain-text fallback
      type(w, 'i_df_address', '77 Rental Rd, Testburg, KY 40211');
      const fd = formData(w);
      assert.equal(fd.df_addr, '77 Rental Rd, Testburg, KY 40211');
      assert.equal(fd.df_city, undefined);
      assert.equal(fd.df_state, undefined);
      assert.equal(fd.df_zip, undefined);
    } finally { await sleep(50); w.close(); } // let the page's Maps config request settle first
  });

  test('editing the line after a pick drops the picked parts', async () => {
    const w = await loadLandlordStep();
    try {
      w.showStep(2);
      await sleep(30);
      const acs = installGoogle(w);
      w._initIntakeAutocomplete();
      w.showStep(3);
      dfAc(acs).place = RENTAL_PLACE;
      dfAc(acs).fire();
      type(w, 'i_df_address', '79 Rental Rd');
      const fd = formData(w);
      assert.equal(fd.df_addr, '79 Rental Rd');
      assert.equal(fd.df_city, undefined, 'a part from the old pick would describe another address');
      assert.equal(fd.df_zip, undefined);
    } finally { await sleep(50); w.close(); } // let the page's Maps config request settle first
  });

  test('left blank: no df_ keys at all (SAGE then uses the mailing address)', async () => {
    const w = await loadLandlordStep();
    try {
      w.showStep(3);
      const fd = formData(w);
      for (const k of ['df_addr', 'df_city', 'df_state', 'df_zip', 'i_df_address']) assert.equal(fd[k], undefined, k);
    } finally { await sleep(50); w.close(); } // let the page's Maps config request settle first
  });

  test('the parts survive a re-render and are kept in the saved draft', async () => {
    const w = await loadLandlordStep();
    try {
      w.showStep(2);
      await sleep(30);
      const acs = installGoogle(w);
      w._initIntakeAutocomplete();
      w.showStep(3);
      dfAc(acs).place = RENTAL_PLACE;
      dfAc(acs).fire();
      w.showStep(2);
      w.showStep(3); // renderProductQuestions() re-creates the card
      assert.equal($(w, 'i_df_city').value, 'Testburg');
      const draft = w.collectDraft();
      const fields = draft.fields || draft;
      for (const [id, v] of [['i_df_address_street', '77 Rental Rd'], ['i_df_city', 'Testburg'], ['i_df_state', 'KY'], ['i_df_zip', '40211']]) assert.equal(fields[id], v, id);
    } finally { await sleep(50); w.close(); } // let the page's Maps config request settle first
  });
});
