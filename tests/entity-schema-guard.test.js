/**
 * The entity schema guard catches what the 2026-10-02 audit found live
 * (SCHEMA-01..04): per-city LocalBusiness "branches" at the PO-box ZIP with an
 * Owensboro geo pin and office hours, the PO box as a streetAddress, the
 * agency's own Google rating as aggregateRating and Review nodes, a hard-coded
 * foundingDate, and 405 agency nodes of which only 2 pages carried an @id.
 *
 * These are fixtures, not build output: node --test runs suites in parallel and
 * build-gate-wiring.test.js rebuilds build/ (see blog-byline-honesty.test.js).
 * scripts/build.js (step 11a) and scripts/validate-build.js (7d) run the same
 * guard over build/.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { entitySchemaProblems, guardOptions, ORG_ID } = require('../scripts/lib/entity-schema-guard');
const { orgRef } = require('../scripts/lib/entity');

const page = (...nodes) => `<html><head>${nodes.map((n) => `<script type="application/ld+json">${JSON.stringify(n)}</script>`).join('\n')}</head></html>`;
const OPTS = { baseLocality: 'Owensboro' };
const ok = (html, rel = 'personal/auto.html', opts = OPTS) => assert.deepEqual(entitySchemaProblems(html, rel, opts), []);
const flags = (html, re, rel = 'insurance/memphis-tn.html', opts = OPTS) => {
  const got = entitySchemaProblems(html, rel, opts);
  assert.ok(got.some((p) => re.test(p)), `expected ${re} in ${JSON.stringify(got)}`);
};

// What /insurance/memphis-tn served on 2026-10-02 (audit crawl), trimmed. The
// live coordinates are withheld (they resolve to a residential street): any geo
// trips the guard.
const LIVE_HUB_BRANCH = {
  '@context': 'https://schema.org', '@type': ['LocalBusiness', 'InsuranceAgency'],
  name: 'The Way Agency — Memphis, TN', url: 'https://www.thewayagency.com/insurance/memphis-tn',
  address: { '@type': 'PostalAddress', addressLocality: 'Memphis', addressRegion: 'TN', postalCode: '42302', addressCountry: 'US' },
  geo: { '@type': 'GeoCoordinates', latitude: 0, longitude: 0 },
  openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', dayOfWeek: 'Monday', opens: '09:00', closes: '17:00' }],
  priceRange: '$',
  aggregateRating: { '@type': 'AggregateRating', ratingValue: '5.0', reviewCount: '31', bestRating: '5', worstRating: '1' },
};
// The D1 = yes shape: InsuranceAgency with the approved base city only.
const CANONICAL = {
  '@context': 'https://schema.org', '@type': 'InsuranceAgency', '@id': ORG_ID, name: 'The Way Agency', url: 'https://www.thewayagency.com/',
  telephone: '+1-502-413-5335', address: { '@type': 'PostalAddress', addressLocality: 'Owensboro', addressRegion: 'KY', addressCountry: 'US' },
};
const { address: _unused, ...NO_ADDRESS } = CANONICAL;
const ORGANIZATION = { ...NO_ADDRESS, '@type': 'Organization' }; // the default while D1 is unanswered

describe('the guard fails what the audit found live', () => {
  test('a LocalBusiness whose addressLocality is not the approved base', () => flags(page(LIVE_HUB_BRANCH), /addressLocality "Memphis"/));
  test('a per-city agency name', () => flags(page(LIVE_HUB_BRANCH), /per-location agency name "The Way Agency — Memphis, TN"/));
  test('geo, opening hours and priceRange on an agency node', () => {
    for (const re of [/agency node has geo/, /agency node has openingHoursSpecification/, /agency node has priceRange/]) flags(page(LIVE_HUB_BRANCH), re);
  });
  test('an aggregateRating on the agency, and any AggregateRating or Review node', () => {
    flags(page(LIVE_HUB_BRANCH), /agency node has aggregateRating/);
    flags(page({ ...CANONICAL, aggregateRating: { '@type': 'AggregateRating', ratingValue: '5.0', reviewCount: '31' } }), /AggregateRating node/, 'index.html');
    flags(page({ '@context': 'https://schema.org', '@type': 'Review', itemReviewed: { '@type': 'InsuranceAgency', name: 'The Way Agency' } }), /Review node/, 'index.html');
  });
  test('the PO box as a streetAddress, and the PO-box ZIP, on a nested provider (the product-page shape)', () => {
    const svc = { '@context': 'https://schema.org', '@type': 'Service', name: 'Auto Insurance',
      provider: { '@type': 'InsuranceAgency', name: 'The Way Agency', address: { '@type': 'PostalAddress', streetAddress: 'PO Box 187', addressLocality: 'Owensboro', postalCode: '42302' } } };
    flags(page(svc), /\$\.provider: agency address has streetAddress/, 'personal/auto.html');
    flags(page(svc), /agency address has postalCode/, 'personal/auto.html');
    flags(page(svc), /agency node without @id/, 'personal/auto.html');
    flags(page(svc), /the PO box as a streetAddress/, 'personal/auto.html');
  });
  test('the PO box as a streetAddress on any node, agency or not', () => {
    flags(page({ '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Agent', hiringOrganization: orgRef(),
      jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', streetAddress: 'P.O. Box 187', addressLocality: 'Owensboro' } } }), /the PO box as a streetAddress \("P\.O\. Box 187"\)/, 'about/careers/intern.html');
  });
  test('an InsuranceAgency-typed reference elsewhere (a LocalBusiness subtype without the base address)', () => {
    flags(page({ '@context': 'https://schema.org', '@type': 'Article', publisher: { '@type': 'InsuranceAgency', '@id': ORG_ID, name: 'The Way Agency', url: 'https://www.thewayagency.com/' } }), /InsuranceAgency with addressLocality undefined/, 'blog/x.html');
  });
  test('a described agency node anywhere but the homepage, and two on the homepage', () => {
    flags(page(ORGANIZATION), /describes the agency/, 'contact.html', { baseLocality: null });
    flags(page(ORGANIZATION, ORGANIZATION), /2 described agency nodes/, 'index.html', { baseLocality: null });
  });
  test('an agency node under its legal name, without the @id', () => {
    flags(page({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Way Associates, Inc', url: 'https://www.thewayagency.com/' }), /agency node without @id/, 'about/index.html');
  });
  test('a bare @id reference with no definition on the page', () => {
    flags(page({ '@context': 'https://schema.org', '@type': 'WebSite', publisher: { '@id': ORG_ID } }), /referenced but not defined/, 'about/index.html');
  });
  test('when the owner approves no base locality, any LocalBusiness-family node', () => {
    flags(page(CANONICAL), /no base locality is approved/, 'index.html', { baseLocality: null });
  });
  test('a foundingDate the owner has not documented (the hard-coded "1998")', () => {
    flags(page({ ...ORGANIZATION, foundingDate: '1998' }), /foundingDate "1998" is not the documented one \(none documented/, 'index.html', { baseLocality: null });
    flags(page({ ...ORGANIZATION, foundingDate: '1998' }), /foundingDate "1998" is not the documented one \("2022-11-11"\)/, 'index.html', { baseLocality: null, foundingDate: '2022-11-11' });
  });
  test('an owner placeholder in any JSON-LD, even inside valid JSON', () => {
    flags(page({ ...CANONICAL, address: { ...CANONICAL.address, addressLocality: '[OWNER VERIFY: base city]' } }), /owner placeholder \("\[OWNER VERIFY"\)/, 'index.html');
    flags(page({ '@context': 'https://schema.org', '@type': 'Article', headline: 'x [LICENSED AGENT VERIFY: figure]' }), /owner placeholder/, 'blog/x.html');
  });
  test('invalid JSON-LD', () => flags('<script type="application/ld+json">{"a": </script>', /invalid JSON-LD/, 'x.html'));
  test('a block written with another spelling of the tag is checked too', () => {
    flags(`<script data-x="1" type='application/ld+json'>${JSON.stringify(LIVE_HUB_BRANCH)}</script>`, /agency node has geo/);
  });
});

describe('the guard passes the intended shapes', () => {
  test('the Organization-typed canonical node on the homepage (the default: no base locality approved), referenced by @id from FAQPage and WebSite', () => {
    ok(page(ORGANIZATION,
      { '@context': 'https://schema.org', '@type': 'FAQPage', about: { '@id': ORG_ID }, mainEntity: [] },
      { '@context': 'https://schema.org', '@type': 'WebSite', '@id': 'https://www.thewayagency.com/#website', publisher: { '@id': ORG_ID }, about: { '@id': ORG_ID }, creator: { '@type': 'Organization', name: 'WaiveFlow', url: 'https://waiveflow.com/' } }),
    'index.html', { baseLocality: null });
  });
  test('the InsuranceAgency node with only the approved base city (D1 = yes)', () => ok(page(CANONICAL), 'index.html'));
  test('a documented foundingDate equal to data/entity.json', () => ok(page({ ...ORGANIZATION, foundingDate: '2022-11-11' }), 'index.html', { baseLocality: null, foundingDate: '2022-11-11' }));
  test('the PO box as a mailing contact point (D2): postOfficeBoxNumber, never streetAddress', () => {
    ok(page({ ...ORGANIZATION, contactPoint: [{ '@type': 'PostalAddress', contactType: 'mailing address', postOfficeBoxNumber: '187', addressLocality: 'Owensboro', addressRegion: 'KY', postalCode: '42302', addressCountry: 'US' }] }), 'index.html', { baseLocality: null });
  });
  test('a hub WebPage + Service naming the city only in areaServed, provider = orgRef()', () => {
    const url = 'https://www.thewayagency.com/insurance/memphis-tn';
    ok(page(
      { '@context': 'https://schema.org', '@type': 'WebPage', '@id': `${url}#webpage`, url, name: 'Insurance Agency in Memphis, TN | The Way Agency', mainEntity: { '@id': `${url}#service` } },
      { '@context': 'https://schema.org', '@type': 'Service', '@id': `${url}#service`, name: 'Insurance in Memphis, TN', provider: orgRef(),
        areaServed: [{ '@type': 'City', name: 'Memphis, TN', containedInPlace: { '@type': 'State', name: 'Tennessee' } }, { '@type': 'AdministrativeArea', name: 'Shelby County, TN' }] }),
    'insurance/memphis-tn.html', { baseLocality: null });
  });
  test('JobPosting.hiringOrganization with name, sameAs and logo next to the @id', () => {
    ok(page({ '@context': 'https://schema.org', '@type': 'JobPosting', hiringOrganization: { ...orgRef(), sameAs: 'https://www.thewayagency.com', logo: 'https://www.thewayagency.com/src/assets/images/logo-social.jpg' } }), 'about/careers/intern.html');
  });
  test('a carrier\'s own Organization node is not the agency', () => {
    ok(page({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Travelers', description: 'Travelers insurance carrier represented by The Way Agency.' }), 'carriers/travelers.html');
  });
  test('a hub FAQ answer that names the PO box as the mailing address (visible text, not an address node)', () => {
    ok(page({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: 'Do you have a Memphis storefront?', acceptedAnswer: { '@type': 'Answer', text: 'No. Our mailing address is PO Box 187, Owensboro, KY 42302.' } }] }), 'insurance/memphis-tn.html');
  });
  test('guardOptions reads data/entity.json the same way for every caller', () => {
    assert.deepEqual(guardOptions({ base_locality: null, founding: { date: null, evidence: null } }), { baseLocality: null, foundingDate: null });
    assert.deepEqual(guardOptions({ base_locality: { addressLocality: 'Owensboro', addressRegion: 'KY' }, founding: { date: '2022-11-11', evidence: 'KY SOS record' } }), { baseLocality: 'Owensboro', foundingDate: '2022-11-11' });
    assert.deepEqual(guardOptions({ founding: { date: '2022-11-11', evidence: null } }), { baseLocality: null, foundingDate: null }, 'no evidence, no founding date');
  });
});
