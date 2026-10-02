/**
 * One agency entity, no invented locations, no self-serving ratings
 * (SCHEMA-01..05, TRUST-02 foundingDate, LOCAL-06 markup).
 *
 * The owner's posture: a service-area business with no storefront. PO Box 187,
 * Owensboro is mail only. So the JSON-LD may name a city only as a place the
 * agency serves (Service.areaServed), never as a place it is
 * (LocalBusiness.address, geo, opening hours). The one fully described agency
 * node is on the homepage; every other page refers to it by @id.
 *
 * Every page type is rendered in-process from the real data files and the real
 * generators, and the hand-made pages are read from src/. Nothing here reads
 * build/: node --test runs suites in parallel and build-gate-wiring.test.js
 * rebuilds it. scripts/build.js (step 11a) and scripts/validate-build.js (7d)
 * run the same guard over build/.
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

const { entitySchemaProblems, guardOptions, ldBlocks } = require('../scripts/lib/entity-schema-guard');
const { ORG_ID, agencyNode, orgRef } = require('../scripts/lib/entity');
const { createSchemaInjector, _readPage } = require('../scripts/builders/schema-generator');
const pages = require('../scripts/builders/pages');
const shared = require('../scripts/shared-templates');
const { generateBlogPost, markdownToHtml, parseFrontMatter } = require('../scripts/generate-blog');

const locations = load('locations.json');
const entity = load('entity.json');
const agency = locations.agency;
const office = locations.offices[0];
const landingData = load('landing-pages.json');
const products = load('products.json');
const carriers = load('carriers.json');
const OPTS = guardOptions(entity);
const BASE = OPTS.baseLocality;

const injectSchema = createSchemaInjector({ agency, office, entity });
const reviews = { rating: agency.google_rating, count: agency.google_review_count };
const ctx = {
  products, office, team: load('team.json'), knowledgeBase: load('knowledge-base.json'), carriers,
  testimonials: load('testimonials.json'), reviews, richContent: {}, landingData, seoData: load('seo.json'),
  renderNav: shared.renderNav, renderFooter: () => shared.renderFooter(office, reviews), renderScripts: shared.renderScripts,
};

/** Every node in every ld+json block on a page. */
function nodes(html) {
  const out = [];
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') { out.push(v); Object.values(v).forEach(walk); }
  };
  ldBlocks(html).forEach((b) => { assert.ok(!b.error, b.error); walk(b.json); });
  return out;
}
const tops = (html) => ldBlocks(html).map((b) => b.json);
const typesOf = (n) => [].concat(n['@type'] || []);
const clean = (html, rel) => assert.deepEqual(entitySchemaProblems(html, rel, OPTS), [], rel);
const LOCATION_KEYS = ['streetAddress', 'postalCode', 'geo', 'openingHoursSpecification', 'openingHours', 'priceRange', 'aggregateRating', 'review', 'foundingDate'];
const noLocationClaims = (html, rel) => {
  for (const n of nodes(html)) {
    assert.ok(!typesOf(n).some((t) => /LocalBusiness|InsuranceAgency|FinancialService|ProfessionalService/.test(t)), `${rel}: a LocalBusiness-family node`);
    for (const k of LOCATION_KEYS) assert.ok(!(k in n), `${rel}: "${k}" in the JSON-LD`);
  }
};
/** Visible text: tags dropped, the entities the pages use decoded, whitespace collapsed. */
const text = (s) => String(s).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

describe('data/entity.json holds only owner-verified facts', () => {
  test('a fact only the owner can confirm carries her sign-off', () => {
    const ownerOnly = entity.base_locality || (entity.founding && entity.founding.date) || entity.mailing_contact_point;
    if (ownerOnly) assert.ok(entity.verified_by && /^\d{4}-\d{2}-\d{2}$/.test(String(entity.verified_on)), 'base_locality, founding.date or mailing_contact_point needs verified_by and verified_on (YYYY-MM-DD)');
  });
  test('sameAs holds absolute https URLs, each listed once', () => {
    const list = entity.same_as || [];
    for (const u of list) assert.match(u, /^https:\/\/\S+$/, u);
    assert.equal(new Set(list).size, list.length);
  });
  test('a founding date is published only with its evidence', () => {
    const f = entity.founding || {};
    assert.ok(!f.date || (f.evidence && /^\d{4}(-\d{2}-\d{2})?$/.test(f.date)), 'founding.date needs founding.evidence and an ISO date');
    assert.equal(agencyNode({ agency, office, entity: { ...entity, founding: { date: '2022-11-11', evidence: null } } }).foundingDate, undefined, 'no evidence, no foundingDate');
    assert.equal(agencyNode({ agency, office, entity: { ...entity, founding: { date: '2022-11-11', evidence: 'KY SOS record' } } }).foundingDate, '2022-11-11');
  });
  test('an approved base locality adds the city only, and the PO box only as a mailing contact point', () => {
    const node = agencyNode({ agency, office, entity: { ...entity, base_locality: { addressLocality: 'Owensboro', addressRegion: 'KY' }, mailing_contact_point: { post_office_box_number: '187' } } });
    assert.equal(node['@type'], 'InsuranceAgency');
    assert.deepEqual(node.address, { '@type': 'PostalAddress', addressLocality: 'Owensboro', addressRegion: 'KY', addressCountry: 'US' });
    const mail = node.contactPoint.find((c) => c['@type'] === 'PostalAddress');
    assert.equal(mail.postOfficeBoxNumber, '187');
    assert.equal(mail.streetAddress, undefined);
    assert.deepEqual(entitySchemaProblems(`<script type="application/ld+json">${JSON.stringify(node)}</script>`, 'index.html', { baseLocality: 'Owensboro' }), []);
  });
  test('no hand-made page or template hard-codes foundingDate', () => {
    const files = ['scripts/builders/pages.js', 'scripts/builders/schema-generator.js', 'scripts/generate-blog.js'].map((f) => path.join(ROOT, f));
    (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (f.endsWith('.html')) files.push(f); } })(path.join(ROOT, 'src'));
    assert.deepEqual(files.filter((f) => /"foundingDate"/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(ROOT, f)), []);
  });
});

describe('injectSchema writes JSON-LD byte for byte', () => {
  test("'$$', '$&' and \"$'\" in a value survive (String.replace replacement patterns)", () => {
    const html = injectSchema('<html><head></head><body></body></html>', 'industry', { name: "A $$ B $& C $' D", slug: 'x', description: 'd' });
    const svc = tops(html).find((j) => j['@type'] === 'Service');
    assert.equal(svc.name, "Insurance for A $$ B $& C $' D");
    assert.match(html, /<\/script>\n {2}<\/head><body><\/body><\/html>$/);
  });
  test('a value cannot close the script element', () => {
    const html = injectSchema('<html><head></head><body></body></html>', 'industry', { name: 'X</script><script>alert(1)</script>', slug: 'x' });
    assert.equal(ldBlocks(html).length, 2);
    assert.equal(tops(html).find((j) => j['@type'] === 'Service').name, 'Insurance for X</script><script>alert(1)</script>');
  });
});

describe('homepage: the one fully described agency node', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'index.html'), 'utf8');
  const html = injectSchema(src, 'homepage');
  const described = nodes(html).filter((n) => n['@id'] === ORG_ID && Object.keys(n).length > 4);
  const org = described[0];
  test('exactly one, guard-clean, and the hand-made page carries none of its own', () => {
    assert.equal(described.length, 1);
    clean(html, 'index.html');
    assert.equal(nodes(src).filter((n) => n['@id'] === ORG_ID && Object.keys(n).length > 1).length, 0);
  });
  test('typed InsuranceAgency only with an approved base locality, and then only that city', () => {
    if (BASE) {
      assert.equal(org['@type'], 'InsuranceAgency');
      assert.deepEqual(org.address, { '@type': 'PostalAddress', addressLocality: BASE, addressRegion: entity.base_locality.addressRegion, addressCountry: 'US' });
    } else {
      assert.equal(org['@type'], 'Organization');
      assert.equal(org.address, undefined);
    }
  });
  test('the facts: sameAs is the owner-confirmed list, phone with country code, legal name as the footer prints it', () => {
    assert.deepEqual(org.sameAs || [], entity.same_as);
    assert.equal(org.telephone, '+1-502-413-5335');
    assert.ok(text(src).includes(`${org.legalName} dba The Way Agency`), 'legalName is the visible footer form (entity-schema D9)');
    assert.equal(org.foundingDate, OPTS.foundingDate || undefined);
  });
  test('hours are when the phone is answered (contactPoint), never a place\'s opening hours', () => {
    assert.deepEqual(org.contactPoint[0].hoursAvailable, [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '09:00', closes: '17:00' }]);
    for (const k of ['openingHoursSpecification', 'geo', 'priceRange', 'aggregateRating', 'review', 'hasMap']) assert.equal(org[k], undefined, k);
  });
  test('the FAQPage answers equal the visible answers, word for word', () => {
    const faq = tops(html).find((j) => j['@type'] === 'FAQPage');
    const visible = new Map(src.split('<div class="faq-item">').slice(1).map((chunk) => [
      text(chunk.match(/<button[^>]*>([\s\S]*?)<\/button>/)[1]),
      text(chunk.match(/<div class="faq-item__answer-inner">([\s\S]*?)<\/div>/)[1]),
    ]));
    assert.equal(faq.mainEntity.length, 4);
    for (const q of faq.mainEntity) {
      assert.ok(visible.has(q.name), `question not visible: ${q.name}`);
      assert.equal(q.acceptedAnswer.text.replace(/\s+/g, ' '), visible.get(q.name), q.name);
    }
  });
  test('WebSite carries no alternateName (Google site names: a commonly recognized short name only)', () => {
    assert.equal(tops(html).find((j) => j['@type'] === 'WebSite').alternateName, undefined);
  });
});

describe('city and county hubs name the place only as an area served', () => {
  for (const city of landingData.cities) {
    test(city.slug, () => {
      const html = injectSchema(pages.generateCityPage(city, ctx), 'city', { city });
      const rel = `insurance/${city.slug}.html`;
      clean(html, rel);
      noLocationClaims(html, rel);
      const page = _readPage(html);
      const services = tops(html).filter((j) => j['@type'] === 'Service');
      assert.equal(services.length, 1);
      const [svc] = services;
      const web = tops(html).find((j) => j['@type'] === 'WebPage');
      // Every value comes from the page itself.
      assert.equal(web.name, page.title);
      assert.equal(svc.name, page.h1);
      assert.ok(page.h1.includes(city.city), 'the H1 names the city');
      assert.deepEqual(svc.serviceType, page.lineCards);
      assert.ok(svc.serviceType.length >= 3);
      assert.equal(web.mainEntity['@id'], svc['@id']);
      assert.equal(web.url, `https://www.thewayagency.com/insurance/${city.slug}`);
      // The city, and its county where the page names it, only as areas served.
      assert.deepEqual(svc.areaServed[0], { '@type': 'City', name: `${city.city}, ${city.state}`, containedInPlace: { '@type': 'State', name: { KY: 'Kentucky', IN: 'Indiana', TN: 'Tennessee' }[city.state] } });
      assert.equal(svc.areaServed.length, 2);
      assert.deepEqual(svc.areaServed[1], { '@type': 'AdministrativeArea', name: `${city.county}, ${city.state}`, containedInPlace: svc.areaServed[0].containedInPlace });
      assert.ok(page.mainText.includes(city.county));
      assert.deepEqual(svc.provider, orgRef());
      // Call and text, paired.
      assert.deepEqual(svc.availableChannel.servicePhone, { '@type': 'ContactPoint', telephone: '+1-502-413-5335' });
      assert.deepEqual(svc.availableChannel.serviceSmsNumber, { '@type': 'ContactPoint', telephone: '+1-502-413-5335' });
    });
  }
  for (const county of landingData.counties || []) {
    test(county.slug, () => {
      const html = injectSchema(pages.generateCountyPage(county, ctx), 'county', { county });
      clean(html, `insurance/${county.slug}.html`);
      noLocationClaims(html, `insurance/${county.slug}.html`);
      const svc = tops(html).find((j) => j['@type'] === 'Service');
      assert.deepEqual(svc.areaServed, [{ '@type': 'AdministrativeArea', name: `${county.county_name}, ${county.state}`, containedInPlace: { '@type': 'State', name: 'Kentucky' } }]);
      assert.equal(svc.name, _readPage(html).h1);
    });
  }
  test('the markup follows the copy: a county the page does not name is not claimed, a new H1 and card list are picked up', () => {
    const city = landingData.cities.find((c) => c.slug === 'owensboro-ky');
    const base = pages.generateCityPage(city, ctx);
    const svc = (html, c = city) => tops(injectSchema(html, 'city', { city: c })).find((j) => j['@type'] === 'Service');
    assert.equal(svc(base, { ...city, county: 'Zzexample County' }).areaServed.length, 1, 'an unnamed county is not an area served');
    const rewritten = base.replace(/<h1 class="hero__title">[\s\S]*?<\/h1>/, '<h1 class="hero__title">Owensboro, KY insurance, by phone or text</h1>')
      .replace(/<a href="\/health\/" class="card"[\s\S]*?<\/a>/, '');
    assert.equal(svc(rewritten).name, 'Owensboro, KY insurance, by phone or text');
    assert.deepEqual(svc(rewritten).serviceType, ['Personal Insurance', 'Commercial Insurance', 'Life Insurance']);
  });
});

describe('product, line, industry and carrier pages refer to the agency, never describe it', () => {
  const lineMap = { personal: 'Personal Insurance', commercial: 'Commercial Insurance', life: 'Life Insurance', health: 'Health Insurance' };
  for (const [lineKey, lineName] of Object.entries(lineMap)) {
    test(`/${lineKey}/ and its products`, () => {
      const hub = pages.generateHubPage(lineKey, ctx);
      clean(hub, `${lineKey}/index.html`);
      noLocationClaims(hub, `${lineKey}/index.html`);
      assert.deepEqual(tops(hub).map((j) => j['@type']), ['Service', 'ItemList', 'BreadcrumbList']);
      for (const product of products[lineKey] || []) {
        const html = injectSchema(pages.generateProductPage(product, lineName, lineKey, lineKey, ctx), 'product', { product, lineName, lineSlug: lineKey });
        const rel = `${lineKey}/${product.slug}.html`;
        clean(html, rel);
        noLocationClaims(html, rel);
        const types = tops(html).map((j) => j['@type']);
        assert.equal(types.filter((t) => t === 'Service').length, 1, `${rel}: one Service`);
        assert.equal(types.filter((t) => t === 'BreadcrumbList').length, 1, `${rel}: one BreadcrumbList`);
        const svc = tops(html).find((j) => j['@type'] === 'Service');
        assert.equal(svc.name, product.name);
        assert.deepEqual(svc.provider, orgRef());
      }
    });
  }
  test('industries', () => {
    for (const ind of landingData.industries) {
      const html = injectSchema(pages.generateIndustryPage(ind, ctx), 'industry', ind);
      clean(html, `industries/${ind.slug}.html`);
      noLocationClaims(html, `industries/${ind.slug}.html`);
      assert.equal(tops(html).filter((j) => j['@type'] === 'Service').length, 1);
    }
  });
  test('carriers and the carriers index', () => {
    for (const line of ['personal', 'commercial']) for (const c of carriers[line] || []) if (c.description) clean(injectSchema(pages.generateCarrierPage(c, line, ctx), 'carrier', c), `carriers/${c.slug}.html`);
    const index = pages.generateCarriersIndex(carriers, ctx);
    clean(index, 'carriers/index.html');
    noLocationClaims(index, 'carriers/index.html');
  });
});

describe('hand-made pages', () => {
  test('every hand-made page under src/pages is guard-clean (the homepage after injection, above)', () => {
    const problems = [];
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) { walk(f); continue; }
        const rel = path.relative(path.join(ROOT, 'src', 'pages'), f).split(path.sep).join('/');
        if (!f.endsWith('.html') || rel === 'index.html') continue;
        problems.push(...entitySchemaProblems(fs.readFileSync(f, 'utf8'), rel, OPTS));
        noLocationClaims(fs.readFileSync(f, 'utf8'), rel);
      }
    })(path.join(ROOT, 'src', 'pages'));
    assert.deepEqual(problems, []);
  });
  test('the team page: one WebPage about the agency, and each Person identified by its card on /about/team', () => {
    const html = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'about', 'team.html'), 'utf8');
    const blocks = tops(html);
    assert.equal(blocks[0]['@type'], 'WebPage');
    assert.deepEqual(blocks[0].about, orgRef());
    const people = blocks.filter((j) => j['@type'] === 'Person');
    assert.ok(people.length >= 1);
    for (const p of people) {
      const slug = p['@id'].replace('https://www.thewayagency.com/about/team#', '');
      assert.equal(p['@id'], `https://www.thewayagency.com/about/team#${slug}`);
      assert.equal(p.url, p['@id']);
      assert.ok(html.includes(`id="${slug}"`), `${slug}: the fragment names an element on the page`);
      assert.deepEqual(p.worksFor, orgRef());
    }
  });
});

describe('blog Article markup (SCHEMA-04)', () => {
  const TEAM_URL = 'https://www.thewayagency.com/about/team#';
  const teamHtml = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'about', 'team.html'), 'utf8');
  test('the frozen hand-made posts: @id, url and mainEntityOfPage are the canonical URL, publisher by @id, one person as author, full dates', () => {
    const dir = path.join(ROOT, 'src', 'pages', 'blog');
    const posts = fs.readdirSync(dir).filter((x) => x.endsWith('.html') && x !== 'index.html');
    assert.equal(posts.length, 12);
    for (const f of posts) {
      const html = fs.readFileSync(path.join(dir, f), 'utf8');
      const url = `https://www.thewayagency.com/blog/${f.replace(/\.html$/, '')}`;
      assert.ok(html.includes(`<link rel="canonical" href="${url}">`), f);
      const a = tops(html)[0];
      assert.equal(a['@type'], 'Article', f);
      assert.equal(a['@id'], `${url}#article`, f);
      assert.equal(a.url, url, f);
      assert.deepEqual(a.mainEntityOfPage, { '@type': 'WebPage', '@id': url, url }, f);
      assert.deepEqual(a.publisher, orgRef(), f);
      assert.ok(a.author.url.startsWith(TEAM_URL) && a.author['@id'] === a.author.url, f);
      assert.ok(teamHtml.includes(`id="${a.author.url.slice(TEAM_URL.length)}"`), `${f}: the author fragment names a team card`);
      assert.match(a.datePublished, /^\d{4}-\d{2}-\d{2}$/, f);
      // No real date of the last body edit is known (entity-schema D5): dateModified = datePublished, no visible "Last updated".
      assert.equal(a.dateModified, a.datePublished, f);
      assert.ok(!/Last updated: March 2026/.test(html), f);
      assert.equal(a.image, undefined, f);
    }
  });
  test('every markdown post carries date: and modified: as YYYY-MM-DD', () => {
    const dir = path.join(ROOT, 'src', 'blog');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md') && x !== 'README.md')) {
      const { meta } = parseFrontMatter(fs.readFileSync(path.join(dir, f), 'utf8'));
      assert.match(String(meta.date), /^\d{4}-\d{2}-\d{2}$/, `${f} date`);
      if (meta.modified !== undefined) assert.match(String(meta.modified), /^\d{4}-\d{2}-\d{2}$/, `${f} modified`);
    }
  });
  test('a generated post: Article first, linked to its page, publisher by @id, author IRI identifies the person, no image without front matter', () => {
    const team = [{ name: 'Test Author Q', slug: 'test-author-q', title: 'Licensed Test Agent' }];
    const body = markdownToHtml(Array.from({ length: 240 }, (_, i) => `word${i}`).join(' '));
    for (const meta of [
      { title: 'SYNTHETIC t', slug: 'test-entity', description: 'd', author_slug: 'test-author-q', date: '2026-01-07' },
      { title: 'SYNTHETIC t', slug: 'test-entity', description: 'd', date: '2026-01-07', modified: '2026-02-03' },
    ]) {
      const html = generateBlogPost(meta, body, [], { team });
      clean(html, 'blog/test-entity.html');
      const a = tops(html)[0];
      assert.equal(a['@type'], 'Article');
      assert.equal(a['@id'], 'https://www.thewayagency.com/blog/test-entity#article');
      assert.deepEqual(a.mainEntityOfPage, { '@type': 'WebPage', '@id': 'https://www.thewayagency.com/blog/test-entity', url: 'https://www.thewayagency.com/blog/test-entity' });
      assert.deepEqual(a.publisher, orgRef());
      assert.doesNotMatch(a.author.url, /\.html/);
      if (meta.author_slug) assert.equal(a.author['@id'], `${TEAM_URL}test-author-q`);
      else assert.deepEqual(a.author, orgRef());
      assert.equal(a.dateModified, meta.modified || meta.date);
      assert.equal(a.image, undefined, 'no image without a front-matter image (never the logo)');
      assert.equal(a.reviewedBy, undefined);
    }
  });
  test('a front-matter image becomes the Article image', () => {
    const html = generateBlogPost({ title: 'SYNTHETIC t', slug: 'test-img', description: 'd', date: '2026-01-07', image: '/src/assets/images/blog/test.jpg' }, markdownToHtml('x'), [], { team: [] });
    assert.deepEqual(tops(html)[0].image, ['https://www.thewayagency.com/src/assets/images/blog/test.jpg']);
  });
});
