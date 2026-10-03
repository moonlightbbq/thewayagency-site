/**
 * llms.txt and llms-full.txt generated from data (AEO-05; url-hygiene spec 3.8,
 * Appendix D). Renders from the repository's data files in memory; nothing
 * here runs scripts/build.js or writes build/.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const data = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const llms = require('../scripts/builders/llms');
const { claimProblems, urlProblems, siteUrls, redirectMatcher, FILE_RULES, PROSE_RULES } = require('../scripts/lib/llms-check');
const { SITE_ORIGIN, canonicalHref } = require('../scripts/lib/site-urls');

function ctxFrom(over = {}) {
  const locations = data('locations.json');
  return {
    agency: locations.agency,
    office: locations.offices[0],
    locations,
    landingData: data('landing-pages.json'),
    products: data('products.json'),
    team: data('team.json'),
    entity: data('entity.json'),
    ...over,
  };
}

const section = (text, heading) => {
  const m = text.match(new RegExp(`^## ${heading}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'));
  return m ? m[1] : '';
};

describe('llms files from the repository data', () => {
  const ctx = ctxFrom();
  const { manifest, full } = llms.render(ctx);
  const productNames = Object.values(ctx.products).flat().map((p) => p.name);

  test('no forbidden claim in either file', () => {
    assert.deepEqual(claimProblems(manifest, { productNames }), []);
    assert.deepEqual(claimProblems(full, { productNames }), []);
  });

  test('every hub in landing-pages.json is listed once, extensionless, grouped by state', () => {
    const hubs = [...ctx.landingData.cities, ...ctx.landingData.counties];
    assert.equal(hubs.length, 26);
    const got = siteUrls(section(manifest, 'Service-area pages'));
    assert.deepEqual([...got].sort(), hubs.map((h) => `${SITE_ORIGIN}/insurance/${h.slug}`).sort());
    const states = [...section(manifest, 'Service-area pages').matchAll(/^### (.+)$/gm)].map((m) => m[1]);
    assert.deepEqual(states, ['Kentucky', 'Indiana', 'Tennessee']);
  });

  test('the priority list is the hub_tiers "priority" hubs', () => {
    const want = Object.entries(ctx.locations.hub_tiers).filter(([k, v]) => k !== '_doc' && v === 'priority').map(([k]) => `${SITE_ORIGIN}/insurance/${k}`);
    assert.deepEqual(siteUrls(section(manifest, 'Priority service areas')).sort(), want.sort());
  });

  test('coverage is exactly products.json, through canonicalHref', () => {
    const want = Object.values(ctx.products).flat().map((p) => SITE_ORIGIN + canonicalHref(p.url));
    assert.deepEqual(siteUrls(section(manifest, 'Coverage')), want);
    assert.ok(!/\.html\b/.test(manifest + full), 'no .html URL');
  });

  test('summary: legal name, licensed states from entity.json, no founding, no base city', () => {
    const summary = manifest.split('\n').find((l) => l.startsWith('> '));
    assert.equal(summary, `> ${ctx.agency.legal_name}, doing business as The Way Agency, is an independent insurance agency licensed in Kentucky, Indiana and Tennessee. It is a service-area business with no public storefront.`);
    assert.ok(!/founded/i.test(manifest));
  });

  test('a documented founding fact prints; an undocumented one does not', () => {
    const withEvidence = llms.render(ctxFrom({ entity: { ...ctx.entity, founding: { date: '2022-01-01', evidence: 'test record' } } })).manifest;
    assert.match(withEvidence, /agency, founded 2022, licensed in/);
    const noEvidence = llms.render(ctxFrom({ entity: { ...ctx.entity, founding: { date: '1998', evidence: null } } })).manifest;
    assert.ok(!/1998|founded/.test(noEvidence));
  });

  test('Medicare appears only as a product link', () => {
    const lines = (manifest + full).split('\n').filter((l) => /Medicare|Medigap/.test(l));
    assert.deepEqual(lines, [`- [Medicare](${SITE_ORIGIN}/health/medicare)`, `- [Medicare](${SITE_ORIGIN}/health/medicare)`]);
  });

  test('the three hard-coded specialty lines are gone', () => {
    assert.ok(!/Farm insurance for Daviess|Distillery and craft beverage|multi-peril crop/i.test(manifest + full));
  });

  test('contact: call or text, the one hours constant, the mail-only label', () => {
    const c = section(manifest, 'Contact');
    assert.match(c, /^- Call or text: \(502\) 413-5335$/m);
    assert.match(c, /^- Hours: Monday to Friday, 9:00 AM to 5:00 PM ET$/m);
    assert.match(c, /^- Mailing address \(mail only\): PO Box 187, Owensboro, KY 42302$/m);
  });

  test('team names and titles link to their cards on /about/team', () => {
    const t = section(manifest, 'Team');
    for (const m of ctx.team.team) assert.ok(t.includes(`- [${m.name}](${SITE_ORIGIN}/about/team#${m.slug}): ${m.title}`), m.slug);
  });

  test('llms-full.txt is the manifest plus the priority hubs as plain text', () => {
    assert.ok(full.startsWith(manifest));
    const priority = Object.entries(ctx.locations.hub_tiers).filter(([, v]) => v === 'priority').length;
    assert.equal((full.match(/^## Insurance in /gm) || []).length, priority);
    assert.ok(!/<[a-z]/i.test(full.slice(manifest.length)), 'no markup in hub copy');
  });
});

describe('hub copy gate', () => {
  const base = ctxFrom();
  const hub = (over) => ({
    cities: [{ city: 'Testville', state: 'KY', slug: 'owensboro-ky', context: 'Testville sits on a river.', context_sections: [], faqs: [], ...over }],
    counties: [],
  });

  test('a paragraph that breaks a rule is left out whole; clean ones stay', () => {
    const landingData = hub({
      context_sections: [
        { heading: 'Medicare in Testville', body: 'When we compare Medicare Advantage plans, we look at networks.' },
        { heading: 'Flood in Testville', body: 'Flood is a separate policy. See <a href="/personal/flood">flood</a> &amp; more.' },
      ],
      context_closing: 'Testville is our home base.',
      faqs: [{ question: 'Do you have a Testville office?', answer: 'Mail only.' }, { question: 'Is flood separate?', answer: 'Yes.' }],
    });
    const r = llms.render({ ...base, landingData, locations: { ...base.locations, hub_tiers: { 'owensboro-ky': 'priority' } } });
    const block = r.full.slice(r.manifest.length);
    assert.match(block, /### Flood in Testville\n\nFlood is a separate policy\. See flood & more\./);
    assert.match(block, /\*\*Q\. Is flood separate\?\*\*/);
    assert.ok(!/Medicare|home base|office/.test(block));
    assert.deepEqual(r.omitted.map((o) => o.kind), ['section', 'closing', 'faq']);
  });
});

describe('llms-check rules', () => {
  const positives = {
    founding: 'The agency was founded 1998.',
    count: 'We work with 40+ carriers.',
    'top-rated': 'Top-rated carriers.',
    headquarters: 'Headquartered in Owensboro (HQ).',
    office: 'Visit our Owensboro office.',
    'base-locality': 'Owensboro is our home base.',
    'local-agents': 'Local agents who know Memphis.',
    'medicare-compare': 'We compare Medicare Advantage plans.',
    'in-person': 'We meet in person.',
    'response-promise': 'We respond the same business day.',
    'em-dash': 'Coverage — explained.',
    specialty: 'Distillery and craft beverage coverage.',
    'medicare-prose': 'Medicare questions? Ask us.',
    'meeting-modes': 'We meet by video.',
    'html-link': 'See <a href="/x">x</a>.',
  };
  test('every rule has a positive case', () => {
    assert.deepEqual([...FILE_RULES, ...PROSE_RULES].map((r) => r.id).filter((id) => !(id in positives)), []);
  });
  for (const [id, text] of Object.entries(positives)) {
    test(`${id} fires`, () => {
      assert.ok(claimProblems(text, { prose: true }).some((p) => p.rule === id), text);
    });
  }
  test('prose rules apply only to hub copy', () => {
    assert.deepEqual(claimProblems('- [Medicare](https://www.thewayagency.com/health/medicare)'), []);
  });
  test('honest text passes', () => {
    for (const t of ['What is home insurance?', 'Service-area business. No public storefront.', 'Mailing address (mail only): PO Box 187, Owensboro, KY 42302', 'Kentucky minimum liability is 25/50/25.', 'Kentucky Farm Bureau is a captive carrier.']) {
      assert.deepEqual(claimProblems(t, { prose: true }), [], t);
    }
  });
  test('the specialty rule lifts once products.json names the line', () => {
    assert.deepEqual(claimProblems('Farm insurance for rural operations.', { productNames: ['Farm Insurance'] }), []);
  });
});

describe('llms-check URLs', () => {
  const routes = new Set(['/', '/about/team', '/insurance/owensboro-ky', '/old-page']);
  const idsOf = (r) => new Set(r === '/about/team' ? ['jill-boone'] : []);
  const isRedirected = redirectMatcher('# comment\n/old-page /about/team 301\n/life-health/* /life/ 301\n');

  test('built, extensionless, not redirected, fragment present: no problem', () => {
    assert.deepEqual(urlProblems('[a](https://www.thewayagency.com/about/team#jill-boone) https://www.thewayagency.com/ https://www.thewayagency.com/insurance/owensboro-ky.', { routes, isRedirected, idsOf }), []);
  });
  test('each failure is reported', () => {
    const text = ['https://www.thewayagency.com/about/team.html', 'https://www.thewayagency.com/missing', 'https://www.thewayagency.com/old-page', 'https://www.thewayagency.com/about/team#nobody'].join('\n');
    const p = urlProblems(text, { routes, isRedirected, idsOf });
    assert.equal(p.length, 4);
    assert.match(p[0], /\.html/);
    assert.match(p[1], /not a built page/);
    assert.match(p[2], /_redirects source/);
    assert.match(p[3], /no id="nobody"/);
  });
  test('splat rules match', () => {
    assert.ok(isRedirected('/life-health/term'));
    assert.ok(!isRedirected('/life/term-life'));
  });
});

describe('generate writes both files', () => {
  test('into the directory it is given', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llms-'));
    try {
      llms.generate(dir, ctxFrom());
      assert.ok(fs.readFileSync(path.join(dir, 'llms.txt'), 'utf8').startsWith('# The Way Agency\n'));
      assert.ok(fs.existsSync(path.join(dir, 'llms-full.txt')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
