/**
 * Y-76: Condo, Landlord and RV pages under Personal, and the Condo tile on the
 * quote form (owner ruling via Y0 11/14).
 *
 *  - The three pages build from data/products.json + data/content-personal.json;
 *    their "Get a quote" preselects the SAGE product ids condo, dwelling_fire, rv.
 *  - Their copy names no carrier (carriers.json lists none for these lines), no
 *    staff, no state list and no dollar figure.
 *  - The Personal nav lists them (the frozen hand-made blog pages keep theirs).
 *  - /intake/?product=condo selects a Condo tile, and the condo path asks no more
 *    than the homeowners path (the same property card; owner 10/18 "go shorter
 *    route every time").
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const products = JSON.parse(read('data', 'products.json'));
const content = JSON.parse(read('data', 'content-personal.json'));
const carriers = JSON.parse(read('data', 'carriers.json'));
const team = JSON.parse(read('data', 'team.json'));

const NEW = [
  { id: 'condo', slug: 'condo' },
  { id: 'dwelling_fire', slug: 'landlord' },
  { id: 'rv', slug: 'rv' },
];

describe('Y-76 the three personal pages', () => {
  test('each is a personal product with its own page and content, keyed by the SAGE product id', () => {
    for (const { id, slug } of NEW) {
      const p = products.personal.find((x) => x.id === id);
      assert.ok(p, id);
      assert.equal(p.slug, slug);
      assert.equal(p.url, `/personal/${slug}`);
      assert.ok(p.meta_description.length <= 160, `${id} meta description`);
      const c = content[id];
      assert.ok(c && c.direct_answer && c.who_needs_it && c.what_it_covers.length && c.what_it_doesnt_cover.length && c.faqs.length >= 3, id);
    }
  });

  test('the generator renders each page with a quote button that preselects the SAGE product id', () => {
    const { generateProductPage } = require('../scripts/builders/pages');
    const data = (f) => JSON.parse(read('data', f));
    const locations = data('locations.json');
    const ctx = {
      products, office: locations.offices[0], agency: locations.agency, team, knowledgeBase: data('knowledge-base.json'), carriers,
      testimonials: data('testimonials.json'), testimonialsBlocklist: [], reviews: null, richContent: content,
      landingData: data('landing-pages.json'), internalLinks: data('internal-links.json'), seoData: data('seo.json'),
      renderNav: () => '', renderFooter: () => '', renderScripts: () => '',
    };
    for (const { id } of NEW) {
      const html = generateProductPage(products.personal.find((x) => x.id === id), 'Personal Insurance', 'personal', 'personal', ctx);
      assert.match(html, new RegExp(`/intake/\\?product=${id}"`), id);
    }
  });

  test('the copy names no carrier, no staff member, no state list and no dollar figure', () => {
    const carrierNames = [...carriers.personal, ...carriers.commercial].map((c) => c.name);
    const staff = (Array.isArray(team) ? team : team.members || team.team || []).flatMap((m) => [m.name, m.first_name, m.last_name].filter(Boolean));
    for (const { id } of NEW) {
      const text = JSON.stringify([content[id], products.personal.find((x) => x.id === id)]);
      for (const n of carrierNames) assert.ok(!text.includes(n), `${id} names carrier ${n}`);
      for (const n of staff) assert.ok(!new RegExp(`\\b${n}\\b`).test(text), `${id} names ${n}`);
      assert.doesNotMatch(text, /Kentucky|Indiana|Tennessee|Ohio|\b(KY|IN|TN|OH)\b/, id);
      assert.doesNotMatch(text, /\$\d/, `${id} prints a dollar figure`);
    }
  });

  test('Landlord sends a 5+ unit or business-owned building to commercial property; RV covers motorhomes and towables', () => {
    assert.match(content.dwelling_fire.who_needs_it, /five or more units/);
    assert.match(content.dwelling_fire.who_needs_it, /LLC/);
    assert.match(content.dwelling_fire.who_needs_it, /commercial property/);
    for (const t of ['Class A', 'B and C', 'travel trailers', 'fifth wheels', 'pop-up']) assert.ok(content.rv.direct_answer.includes(t), t);
  });

  test('the Personal nav lists Condo, Landlord and RV in the shared template', () => {
    const nav = read('scripts', 'shared-templates.js');
    for (const { slug } of NEW) assert.match(nav, new RegExp(`href="/personal/${slug}" class="nav__dropdown-item"`), slug);
  });
});

describe('Y-76 the Condo tile on the quote form', () => {
  async function load(query) {
    const dom = new JSDOM(read('src', 'intake.html'), {
      runScripts: 'dangerously', url: 'https://www.thewayagency.com/intake/' + query,
      beforeParse(w) {
        w.fetch = (input) => String(input).includes('/api/intake/rules')
          ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ serviceStates: ['KY'], productLines: { homeowners: 'personal', condo: 'personal' }, stateNames: { KY: 'Kentucky' }, declineTemplate: 'x {{STATE}}', stateToken: '{{STATE}}' }) })
          : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
        w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
        w.scrollTo = () => {};
        w.google = { maps: { places: { Autocomplete: class { addListener() {} getPlace() { return {}; } } } } };
      },
    });
    await new Promise((r) => setTimeout(r, 30));
    return dom.window;
  }
  const fieldsOf = (w, key) => [...w.document.querySelectorAll(`[data-qcard="${key}"] input:not([type=hidden]), [data-qcard="${key}"] select, [data-qcard="${key}"] .toggle-btn`)].map((e) => e.id || e.dataset.action);

  test('?product=condo selects the Condo tile (a personal product)', async () => {
    const w = await load('?product=condo');
    assert.ok(w.document.querySelector('.product-opt.selected[data-pid="condo"]'));
    assert.deepEqual(JSON.parse(w.eval('JSON.stringify(selectedProducts)')), ['condo']);
    assert.equal(w.eval("getProductLine('condo')"), 'personal');
  });

  test('the condo path asks exactly what the homeowners path asks, never more', async () => {
    const home = await load('?product=homeowners');
    home.eval('renderProductQuestions()');
    const condo = await load('?product=condo');
    condo.eval('renderProductQuestions()');
    const h = fieldsOf(home, 'homeowners');
    const c = fieldsOf(condo, 'condo');
    assert.ok(h.length >= 3, `homeowners card: ${h}`);
    assert.deepEqual(c, h);
    assert.match(condo.document.querySelector('[data-qcard="condo"]').textContent, /Estimated Unit Value/);
  });

  test('home and condo together share one property card', async () => {
    const w = await load('?product=homeowners');
    w.eval("selectedProducts.push('condo'); renderProductQuestions()");
    assert.equal(w.document.querySelectorAll('#i_ho_value').length, 1);
  });
});
