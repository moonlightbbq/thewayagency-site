/**
 * Priority hubs linked from every page; one breadcrumb trail; /industries/;
 * local-proof modules that render nothing until verified data exists
 * (LOCAL-01, TECH-01, BLOG-03, LOCAL-05, MKT-04; priority-hubs section 4).
 *
 * Pages are rendered in-process from the real data and generators, and the
 * hand-made pages are read from src/. Nothing here runs scripts/build.js or
 * reads build/ (node --test runs files in parallel; build-gate-wiring.test.js
 * owns build/).
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const load = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const pages = require('../scripts/builders/pages');
const shared = require('../scripts/shared-templates');
const { createSchemaInjector } = require('../scripts/builders/schema-generator');
const { renderHubTeam, renderHubCarriers, renderRatingLine, staffForPlace } = require('../scripts/builders/hub-proof');
const { guidesFor } = require('../scripts/builders/internal-links');
const { jsonLdNodes } = require('../scripts/lib/link-structure-check');

const locations = load('locations.json');
const office = locations.offices[0];
const agency = locations.agency;
const landingData = load('landing-pages.json');
const products = load('products.json');
const internalLinks = load('internal-links.json');
const reviews = { rating: agency.google_rating, count: agency.google_review_count };

let richContent = {};
for (const f of ['content-personal.json', 'content-commercial.json', 'content-life.json', 'content-health.json']) {
  if (fs.existsSync(path.join(DATA, f))) Object.assign(richContent, load(f));
}

// Every guide slug that has a source file counts as rendered, unless a test says otherwise.
const allGuideSlugs = new Set(Object.values(internalLinks.guides).flat().map((g) => g.slug));
function makeCtx(extra = {}) {
  return {
    products, office, agency, team: load('team.json'), knowledgeBase: load('knowledge-base.json'), carriers: load('carriers.json'),
    testimonials: load('testimonials.json'), testimonialsBlocklist: { blocked: [] }, reviews, richContent, landingData, internalLinks,
    seoData: load('seo.json'), publishedBlog: new Set(allGuideSlugs),
    renderNav: shared.renderNav, renderFooter: () => shared.renderFooter(office, reviews), renderScripts: shared.renderScripts,
    ...extra,
  };
}
const ctx = makeCtx();
const city = (slug) => landingData.cities.find((c) => c.slug === slug);
const county = (slug) => landingData.counties.find((c) => c.slug === slug);
const main = (html) => { const m = /<main id="main">([\s\S]*?)<\/main>/.exec(html); assert.ok(m, 'no <main>'); return m[1]; };
const hrefs = (html) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
const HUBS = ['owensboro-ky', 'daviess-county-ky', 'mt-washington-ky', 'shepherdsville-ky'];
const HANDMADE = (() => {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const rel = path.join(d, e.name);
      if (e.isDirectory()) walk(rel); else if (e.name.endsWith('.html')) out.push(rel);
    }
  })('src/pages');
  return out.filter((rel) => read(rel).includes('<h4 class="footer__heading">Company</h4>'));
})();

describe('no internal link to the .html form of a hub or industry page (LOCAL-01, TECH-01)', () => {
  test('data, hand-made pages and generators', () => {
    const files = ['data/landing-pages.json', 'data/products.json', 'data/internal-links.json',
      ...fs.readdirSync(DATA).filter((f) => /^content-.*\.json$/.test(f)).map((f) => `data/${f}`),
      ...HANDMADE,
      ...fs.readdirSync(path.join(ROOT, 'scripts/builders')).map((f) => `scripts/builders/${f}`)];
    for (const rel of files) assert.doesNotMatch(read(rel), /href=\\?"\/(insurance|industries)\/[a-z0-9-]+\.html/, rel);
  });
});

describe('/about/locations lists every hub (TECH-01 d)', () => {
  test('its /insurance/ links are exactly the cities and counties, extensionless', () => {
    const got = new Set(hrefs(read('src/pages/about/locations.html')).filter((h) => h.startsWith('/insurance/')));
    const want = new Set([...landingData.cities, ...landingData.counties].map((c) => `/insurance/${c.slug}`));
    assert.deepEqual([...got].sort(), [...want].sort());
    assert.equal(got.size, 26);
  });
});

describe('the "Service Areas" footer group (LOCAL-01)', () => {
  const block = shared.renderServiceAreasColumn();
  test('renderFooter carries the group with the three extensionless links, before Company', () => {
    const footer = shared.renderFooter(office, reviews);
    assert.equal(footer.split('data-footer-group="service-areas"').length - 1, 1);
    for (const h of ['/insurance/owensboro-ky', '/insurance/mt-washington-ky', '/about/locations']) assert.ok(footer.includes(`href="${h}"`), h);
    assert.ok(footer.indexOf('data-footer-group="service-areas"') < footer.indexOf('footer__heading">Company'));
  });
  test('all 34 hand-made footers carry the same block once, before Company', () => {
    assert.equal(HANDMADE.length, 34);
    const norm = (s) => s.split('\n').map((l) => l.trim()).join('\n');
    for (const rel of HANDMADE) {
      const html = read(rel);
      assert.equal(html.split('data-footer-group="service-areas"').length - 1, 1, rel);
      const at = html.indexOf('<div data-footer-group="service-areas">');
      assert.ok(at > 0 && at < html.indexOf('footer__heading">Company'), rel);
      assert.ok(norm(html).includes(norm(block)), `${rel}: the block differs from renderServiceAreasColumn()`);
    }
  });
});

describe('homepage (LOCAL-01 rec 1; RW-D1; D7)', () => {
  const html = read('src/pages/index.html');
  const body = main(html);
  test('<main> links the four priority hubs, /about/locations and /health/', () => {
    for (const h of [...HUBS.map((s) => `/insurance/${s}`), '/about/locations', '/health/']) assert.ok(hrefs(body).includes(h), h);
  });
  test('the title, the hero H1 and the hero subtitle are unchanged', () => {
    assert.match(html, /<title>The Way Agency \| Independent Insurance in KY, IN &amp; TN<\/title>/);
    assert.match(html, /<h1 class="hero__title"[^>]*>The Way Insurance<br>Gets Done<\/h1>/);
    assert.match(html, /<p class="hero__subtitle"[^>]*>Insurance shouldn't be confusing or one-size-fits-all\./);
  });
  test('the "Areas we serve" section is below the hero and makes no storefront, contact or Medicare claim', () => {
    const m = /<section[^>]*id="areas-we-serve"[\s\S]*?<\/section>/.exec(html);
    assert.ok(m);
    assert.ok(html.indexOf(m[0]) > html.indexOf('hero__title'));
    assert.doesNotMatch(m[0], /office|visit|stop by|headquarter|based in|tel:|sms:|medicare|since 19|top-rated/i);
    // Spec R1-3 / rewrites.md: video and in-person wait on owner D1 (OA-21 item 7).
    assert.match(m[0], /We do not operate a public storefront\. We work with clients by phone, text and email\./);
    assert.doesNotMatch(m[0], /video|in person/i);
    // TRUST-05: only lines with confirmed appointments; no life carriers are verified yet.
    assert.doesNotMatch(m[0], /\blife coverage\b/i);
  });
});

describe('hubs (LOCAL-01, TECH-01, MKT-04)', () => {
  const injectSchema = createSchemaInjector({ agency, office, entity: load('entity.json') });
  test('Owensboro links Daviess County; Daviess links Owensboro; no raw-URL anchor text', () => {
    const o = main(pages.generateCityPage(city('owensboro-ky'), ctx));
    const d = main(pages.generateCountyPage(county('daviess-county-ky'), ctx));
    assert.ok(hrefs(o).includes('/insurance/daviess-county-ky'));
    assert.ok(hrefs(d).includes('/insurance/owensboro-ky'));
    for (const h of [o, d]) assert.doesNotMatch(h, /<a [^>]*>\s*\/insurance\//);
  });
  test('Mt Washington links Shepherdsville and Louisville (MKT-04); Shepherdsville links Mt Washington', () => {
    const m = main(pages.generateCityPage(city('mt-washington-ky'), ctx));
    const s = main(pages.generateCityPage(city('shepherdsville-ky'), ctx));
    assert.ok(hrefs(m).includes('/insurance/shepherdsville-ky'));
    assert.ok(hrefs(m).includes('/insurance/louisville-ky'));
    assert.ok(hrefs(s).includes('/insurance/mt-washington-ky'));
  });
  test('each priority hub has unique ids; the pinned section ids survive', () => {
    for (const slug of HUBS) {
      const hub = city(slug) || county(slug);
      const html = hub.county_name ? pages.generateCountyPage(hub, ctx) : pages.generateCityPage(hub, ctx);
      const ids = [...main(html).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
      assert.equal(new Set(ids).size, ids.length, `${slug}: duplicate ids ${ids}`);
    }
    for (const slug of ['owensboro-ky', 'mt-washington-ky']) {
      const ids = new Set([...main(pages.generateCityPage(city(slug), ctx)).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
      for (const id of ['homeowners', 'auto', 'commercial', 'medicare']) assert.ok(ids.has(id), `${slug}#${id}`);
    }
  });
  test('one BreadcrumbList on a city and a county hub, parent /about/locations; the injector adds none', () => {
    for (const [html, type, context] of [
      [pages.generateCityPage(city('owensboro-ky'), ctx), 'city', { city: city('owensboro-ky') }],
      [pages.generateCountyPage(county('daviess-county-ky'), ctx), 'county', { county: county('daviess-county-ky') }],
    ]) {
      const out = injectSchema(html, type, context);
      const lists = jsonLdNodes(out).filter((n) => n['@type'] === 'BreadcrumbList');
      assert.equal(lists.length, 1, type);
      assert.equal(lists[0].itemListElement[1].item, 'https://www.thewayagency.com/about/locations');
      assert.match(out, /<nav aria-label="Breadcrumb"/);
    }
  });
  test('industry and product pages carry one trail; the injector adds none', () => {
    const ind = landingData.industries[0];
    const indOut = injectSchema(pages.generateIndustryPage(ind, ctx), 'industry', ind);
    const indLists = jsonLdNodes(indOut).filter((n) => n['@type'] === 'BreadcrumbList');
    assert.equal(indLists.length, 1);
    assert.deepEqual(indLists[0].itemListElement.map((i) => i.item).filter(Boolean),
      ['https://www.thewayagency.com/', 'https://www.thewayagency.com/commercial/', 'https://www.thewayagency.com/industries/']);
    const auto = products.personal.find((p) => p.id === 'auto');
    const prodOut = injectSchema(pages.generateProductPage(auto, 'Personal Insurance', 'personal', 'personal', ctx), 'product', { product: auto });
    assert.equal(jsonLdNodes(prodOut).filter((n) => n['@type'] === 'BreadcrumbList').length, 1);
  });
});

describe('product, line-hub and industry links (CONT-01 c, BLOG-03, TECH-01)', () => {
  const auto = products.personal.find((p) => p.id === 'auto');
  test('every product page links both priority hubs and /about/locations, with no contact link in the block', () => {
    for (const [lineKey, list] of Object.entries(products)) {
      if (!Array.isArray(list)) continue;
      for (const p of list) {
        const body = main(pages.generateProductPage(p, 'Line', lineKey, lineKey, ctx));
        for (const h of ['/insurance/owensboro-ky', '/insurance/mt-washington-ky', '/about/locations']) assert.ok(hrefs(body).includes(h), `${p.id}: ${h}`);
        const block = /<section class="link-block local-help"[\s\S]*?<\/section>/.exec(body)[0];
        assert.doesNotMatch(block, /tel:|sms:|intake/);
      }
    }
  });
  test('a guide renders only when its post was built in this build', () => {
    const without = makeCtx({ publishedBlog: new Set([...allGuideSlugs].filter((s) => s !== 'liability-limits-how-much-enough')) });
    assert.ok(!main(pages.generateProductPage(auto, 'Personal Insurance', 'personal', 'personal', without)).includes('/blog/liability-limits-how-much-enough'));
    assert.ok(main(pages.generateProductPage(auto, 'Personal Insurance', 'personal', 'personal', ctx)).includes('href="/blog/liability-limits-how-much-enough"'));
    const none = makeCtx({ publishedBlog: new Set() });
    assert.doesNotMatch(main(pages.generateProductPage(auto, 'Personal Insurance', 'personal', 'personal', none)), /data-links="guides"/);
  });
  test('a blocked or Medicare post never renders as a guide, even if listed', () => {
    const listed = makeCtx({ internalLinks: { ...internalLinks, guides: { '/personal/auto': [{ slug: 'after-car-accident-kentucky', anchor: 'After an accident' }, { slug: 'kentucky-auto-insurance-guide', anchor: 'KY auto' }] } }, publishedBlog: new Set(['after-car-accident-kentucky', 'kentucky-auto-insurance-guide']) });
    assert.deepEqual(guidesFor('/personal/auto', listed), []);
    for (const g of Object.values(internalLinks.guides).flat()) {
      assert.doesNotMatch(g.slug, /medicare|workers-comp|hvac|electrical|after-car-accident/, g.slug);
    }
  });
  test('/commercial/ and /industries/ link the index and all 8 industry pages; the index pairs call and text', () => {
    const hub = main(pages.generateHubPage('commercial', ctx));
    const index = pages.generateIndustriesIndex(landingData.industries, ctx);
    assert.equal(landingData.industries.length, 8);
    assert.ok(hrefs(hub).includes('/industries/'));
    for (const i of landingData.industries) {
      assert.ok(hrefs(hub).includes(`/industries/${i.slug}`), i.slug);
      assert.ok(hrefs(main(index)).includes(`/industries/${i.slug}`), i.slug);
    }
    assert.match(index, /href="tel:\+15024135335"/);
    assert.match(index, /href="sms:\+15024135335"/);
    assert.match(index, /<link rel="canonical" href="https:\/\/www\.thewayagency\.com\/industries\/">/);
    assert.doesNotMatch(index, /top-rated|\d+\+/i);
    // ky_notes are unsourced until content-accuracy WP-G2: the index vouches for no rules.
    assert.doesNotMatch(index, /rules we know/i);
  });
  test('each industry page links /industries/', () => {
    for (const i of landingData.industries) assert.ok(hrefs(main(pages.generateIndustryPage(i, ctx))).includes('/industries/'), i.slug);
  });
});

describe('local proof renders nothing until verified data exists (LOCAL-05; claims PR-3, D4, D5)', () => {
  const TODAY = '2026-10-03';
  const lic = (over) => ({ state: 'KY', number: '000000', lines_of_authority: ['Property', 'Casualty'], verified_on: '2026-10-01', expires: '2027-03-31', source: 'KY DOI Licensee Search', ...over });
  const team = (licenses, areas = ['Owensboro']) => ({ team: [{ slug: 'zz-privacycheck', name: 'Zz Privacycheck', title: 'Licensed Agent', photo: '/src/assets/images/team/none.webp', service_areas: areas, licenses }] });
  const owensboro = city('owensboro-ky');
  test('today: no hub renders a people, carrier or rating module', () => {
    for (const hub of [...landingData.cities, ...landingData.counties]) {
      const html = hub.county_name ? pages.generateCountyPage(hub, ctx) : pages.generateCityPage(hub, ctx);
      assert.doesNotMatch(html, /class="hub-team|class="hub-carriers|class="hub-rating/, hub.slug);
    }
  });
  test('a verified, unexpired licence renders the person with title, licence number and the official lookup', () => {
    const html = renderHubTeam(owensboro, { team: team([lic()]), landingData }, TODAY);
    assert.match(html, /Zz Privacycheck/);
    assert.match(html, /Licensed Agent/);
    assert.match(html, /Kentucky license no\. 000000/);
    assert.match(html, /href="https:\/\/insurance\.ky\.gov\/ppc\/Agent\/Default\.aspx"/);
    assert.match(html, /href="\/about\/team#zz-privacycheck"/);
    assert.doesNotMatch(html, /\blocal\b|specializ|focuses on|ALDetails/i);
  });
  test('an expired licence, a missing verified_on, no matching area, or the wrong state renders nothing', () => {
    assert.equal(renderHubTeam(owensboro, { team: team([lic({ expires: '2026-09-30' })]), landingData }, TODAY), '');
    assert.equal(renderHubTeam(owensboro, { team: team([lic({ verified_on: undefined })]), landingData }, TODAY), '');
    assert.equal(renderHubTeam(owensboro, { team: team([lic()], ['Lexington']), landingData }, TODAY), '');
    assert.equal(renderHubTeam(city('evansville-in'), { team: team([lic()], ['Evansville']), landingData }, TODAY), '');
    assert.equal(renderHubTeam(owensboro, { team: { team: [{ slug: 'x', name: 'X', title: 'Intern', service_areas: ['Owensboro'] }] }, landingData }, TODAY), '');
  });
  test('a county hub matches its county and its parent city', () => {
    const daviess = county('daviess-county-ky');
    assert.equal(staffForPlace(team([lic()], ['Owensboro']), ['Daviess County', 'Owensboro'], 'KY', TODAY).length, 1);
    assert.match(renderHubTeam(daviess, { team: team([lic()], ['Daviess County']), landingData }, TODAY), /Zz Privacycheck/);
  });
  test('carriers: only verified insurers appointed in the hub state, by line; never intermediaries, counts or health', () => {
    const carriers = {
      personal: [
        { name: 'Insurer A', slug: 'a', type: 'insurer', states: ['KY'], lines: ['home', 'auto'], appointment_verified_on: '2026-10-01' },
        { name: 'Insurer B', slug: 'b', type: 'insurer', states: ['TN'], lines: ['home'], appointment_verified_on: '2026-10-01' },
        { name: 'Insurer C', slug: 'c', type: 'insurer', states: ['KY'], lines: ['home'] },
      ],
      commercial: [
        { name: 'BTIS', slug: 'btis', type: 'wholesaler', states: ['KY'], lines: ['general-liability'], appointment_verified_on: '2026-10-01' },
        { name: 'CRC Group', slug: 'crc', type: 'mga', states: ['KY'], lines: ['general-liability'], appointment_verified_on: '2026-10-01' },
        { name: 'Insurer A', slug: 'a', type: 'insurer', states: ['KY'], lines: ['general-liability'], appointment_verified_on: '2026-10-01' },
      ],
    };
    const html = renderHubCarriers(owensboro, { carriers });
    assert.match(html, /Insurance companies we're appointed with in Kentucky/);
    assert.match(html, /Insurer A/);
    assert.doesNotMatch(html, /Insurer B|Insurer C|BTIS|CRC Group|\bISC\b|\bRPS\b|\d+\+|top-rated|Medicare|Health/);
    assert.equal(renderHubCarriers(owensboro, { carriers: load('carriers.json') }), '');
  });
  test('rating line: names Google, matches the data, links the listing; hidden when stale or without a listing URL', () => {
    const fresh = { google_rating: '5.0', google_review_count: '31', google_reviews_last_updated: '2026-09-30T10:08:07.138Z', google_maps_url: 'https://g.page/r/listing-id' };
    const now = new Date('2026-10-03T12:00:00Z');
    assert.equal(renderRatingLine({ agency: fresh }, now).trim(), '<p class="hub-rating">Rated 5.0 on Google from 31 reviews · <a href="https://g.page/r/listing-id" rel="noopener">Read the reviews on Google</a></p>');
    assert.equal(renderRatingLine({ agency: { ...fresh, google_reviews_last_updated: '2026-08-01T00:00:00Z' } }, now), '');
    assert.equal(renderRatingLine({ agency: { ...fresh, google_maps_url: undefined } }, now), '');
    assert.equal(renderRatingLine({ agency: { ...fresh, google_maps_url: 'https://g.page/r/listing-id/review' } }, now), '');
    assert.equal(renderRatingLine({ agency }, now), '', 'locations.json has no google_maps_url yet');
  });
});

describe('one tier field (LOCAL-04 criterion (c); priority-hubs D12)', () => {
  test('exactly the four priority hubs are priority; nothing else is tiered yet', () => {
    const tiers = Object.fromEntries(Object.entries(locations.hub_tiers).filter(([k]) => !k.startsWith('_')));
    assert.deepEqual(tiers, { 'owensboro-ky': 'priority', 'daviess-county-ky': 'priority', 'mt-washington-ky': 'priority', 'shepherdsville-ky': 'priority' });
  });
});
