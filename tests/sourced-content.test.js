/**
 * CONT-04 (industry pages), CONT-05 (carrier pages) and MKT-02 (priority-hub
 * line sections): sourced content rendered from data, with the copy rules the
 * 2026-10 remediation enforces.
 *
 * Pages are rendered in-process from the real data and generators. Nothing here
 * runs scripts/build.js or reads build/ (build-gate-wiring.test.js owns build/).
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const load = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

const pages = require('../scripts/builders/pages');
const shared = require('../scripts/shared-templates');
const sourced = require('../scripts/builders/sourced-content');
const { carrierHasPage } = require('../scripts/lib/carrier-pages');

const locations = load('locations.json');
const office = locations.offices[0];
const agency = locations.agency;
const landingData = load('landing-pages.json');
const carriers = load('carriers.json');
const carrierProfiles = load('carrier-profiles.json');
const hubSections = load('hub-sections.json');
const reviews = { rating: agency.google_rating, count: agency.google_review_count };

function makeCtx(extra = {}) {
  return {
    products: load('products.json'), office, agency, team: load('team.json'), knowledgeBase: load('knowledge-base.json'), carriers, carrierProfiles, hubSections,
    testimonials: load('testimonials.json'), testimonialsBlocklist: { blocked: [] }, reviews, richContent: {}, landingData, internalLinks: load('internal-links.json'),
    seoData: load('seo.json'), publishedBlog: new Set(),
    renderNav: shared.renderNav, renderFooter: () => shared.renderFooter(office, reviews), renderScripts: shared.renderScripts,
    ...extra,
  };
}
const ctx = makeCtx();
const main = (html) => { const m = /<main id="main">([\s\S]*?)<\/main>/.exec(html); assert.ok(m, 'no <main>'); return m[1]; };
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

// Statute ids on apps.legislature.ky.gov, each fetched and read on 2026-10-03.
const STATUTE_IDS = {
  '198B.668': '46948', '227A.060': '55092', '318.030': '31186', '324.395': '49034',
  '342.012': '44523', '342.340': '43318', '342.610': '47623', '342.630': '32533',
  '342.640': '43049', '342.650': '51336', '45A.185': '22367', '45A.190': '54631',
  '304.39-110': '46758', '304.39-320': '54466',
};
// Copy rules (PROMPT.md section 7; AGENT-RULES): none of these in new copy.
const BANNED = [
  [/—/, 'em dash'], [/\bfree\b/i, '"free"'], [/top-rated/i, 'top-rated'], [/since 1998/i, 'since 1998'],
  [/\b40\+/, '40+'], [/(?<!principal )\boffice\b/i, 'office'], [/\bvisit\b/i, 'visit'], [/based in/i, 'based in'],
  [/stop by/i, 'stop by'], [/\bheadquarters\b/i, 'headquarters'], [/medicare/i, 'Medicare'],
  [/\blocal agent/i, 'local agent'], [/we('| a)re appointed with (?!for)/i, 'appointment claim'],
];
function assertCopyRules(label, s) {
  for (const [re, name] of BANNED) assert.doesNotMatch(s, re, `${label}: ${name}`);
}
/** Every statute link names the statute its id belongs to. */
function assertStatuteLinks(label, html) {
  for (const m of html.matchAll(/<a href="https:\/\/apps\.legislature\.ky\.gov\/law\/statutes\/statute\.aspx\?id=(\d+)">([^<]*)<\/a>/g)) {
    const krs = /^KRS ([0-9A-Z]+\.[0-9]+(?:-[0-9]+)?)/.exec(m[2]);
    assert.ok(krs, `${label}: link text "${m[2]}" names no KRS section`);
    assert.equal(STATUTE_IDS[krs[1]], m[1], `${label}: "${m[2]}" links id ${m[1]}`);
  }
}

describe('industry pages (CONT-04)', () => {
  test('every industry leads with statute-linked Kentucky requirements; no ky_notes remain', () => {
    assert.equal(landingData.industries.length, 8);
    for (const ind of landingData.industries) {
      assert.equal(ind.ky_notes, undefined, `${ind.slug}: ky_notes (unsourced) still in data`);
      assert.ok(ind.ky_requirements.length >= 3, ind.slug);
      for (const r of ind.ky_requirements) {
        assert.ok(r.cites.length >= 1, `${ind.slug}: requirement without a citation`);
        for (const c of r.cites) assert.match(c.url, /^https:\/\/apps\.legislature\.ky\.gov\/law\/statutes\/statute\.aspx\?id=\d+$/, `${ind.slug}: ${c.label}`);
        assert.match(r.as_of, /^\d{4}-\d{2}-\d{2}$/);
      }
      const body = main(pages.generateIndustryPage(ind, ctx));
      const firstH2 = /<h2[^>]*>([^<]*)<\/h2>/.exec(body);
      assert.match(firstH2[1], /^Kentucky requirements for /, `${ind.slug}: the body must lead with the Kentucky requirements`);
      assertStatuteLinks(ind.slug, body);
    }
  });

  test('HVAC, electrical and plumbing state the license insurance amounts from the statute', () => {
    const page = (slug) => text(main(pages.generateIndustryPage(landingData.industries.find((i) => i.slug === slug), ctx)));
    assert.match(page('hvac-contractors'), /general liability insurance of at least \$500,000 and property damage insurance of at least \$300,000/);
    assert.match(page('electrical-contractors'), /general liability insurance policy of not less than \$1,000,000/);
    assert.match(page('plumbing-contractors'), /general liability insurance of not less than \$250,000/);
  });

  test('template boilerplate is gone: no experience, carrier-access or advocacy claims', () => {
    for (const ind of landingData.industries) {
      const body = text(main(pages.generateIndustryPage(ind, ctx)));
      for (const re of [/Based on our experience/, /specialty markets/, /generalist agencies/, /push back on the carrier/, /we make it happen/, /carriers that specialize/, /Why choose The Way Agency/]) {
        assert.doesNotMatch(body, re, `${ind.slug}: ${re}`);
      }
    }
  });

  test('examples are labelled fictional, FAQs are visible and carry no FAQPage markup', () => {
    for (const ind of landingData.industries) {
      const html = pages.generateIndustryPage(ind, ctx);
      assert.match(main(html), /<em>Fictional example for illustration\.<\/em>/, ind.slug);
      assert.ok(ind.faqs.length >= 3 && ind.faqs.length <= 5, ind.slug);
      for (const f of ind.faqs) assert.ok(main(html).includes(f.question.replace(/&/g, '&amp;').replace(/'/g, '&#39;')), `${ind.slug}: ${f.question}`);
      assert.doesNotMatch(html, /"FAQPage"/, ind.slug);
    }
  });

  test('industry copy follows the content rules and names no carrier', () => {
    const names = [...carriers.personal, ...carriers.commercial].map((c) => c.name);
    for (const ind of landingData.industries) {
      const body = text(main(pages.generateIndustryPage(ind, ctx)));
      assertCopyRules(ind.slug, body + ' ' + ind.description);
      for (const n of names) assert.ok(!body.includes(n), `${ind.slug}: names carrier ${n}`);
      assert.doesNotMatch(body + ind.description, /six-figure|highest-risk|\(high rates\)/i, ind.slug);
    }
  });

  test('renderer escapes plain fields and drops non-https citation links', () => {
    const html = sourced.renderIndustryRequirements({ name: 'Zz Trades', ky_requirements: [{ text: '<script>x</script> rule.', cites: [{ label: 'KRS 1', url: 'javascript:alert(1)' }], as_of: '2026-10-03' }] });
    assert.doesNotMatch(html, /<script>|javascript:/);
    assert.match(html, /&lt;script&gt;x&lt;\/script&gt; rule \(KRS 1\)\./);
    assert.equal(sourced.renderIndustryRequirements({ name: 'Zz', ky_requirements: [{ text: 'no cite', cites: [] }] }), '');
  });
});

describe('carrier pages (CONT-05)', () => {
  const all = [...carriers.personal, ...carriers.commercial];
  const KEPT = ['berkshire-guard', 'steadily', 'obie', 'hartford', 'liberty-mutual'];
  const byslug = (slug) => all.find((c) => c.slug === slug);

  test('the five D6 pages are standalone_page and have sourced profiles', () => {
    assert.deepEqual([...new Set(all.filter((c) => c.standalone_page === true).map((c) => c.slug))].sort(), [...KEPT].sort());
    for (const slug of KEPT) {
      const p = carrierProfiles[slug];
      assert.ok(p && p.summary && p.facts.length >= 3, slug);
      for (const f of p.facts) {
        assert.match(f.source_url, /^https:\/\//, `${slug}: ${f.text}`);
        assert.match(f.as_of, /^\d{4}-\d{2}-\d{2}$/, `${slug}: ${f.text}`);
      }
      assert.ok(p.links.length >= 1, `${slug}: official claims link`);
    }
  });

  test('a rating prints only with an as-of date and the carrier\'s source; GUARD shows A+ as of Aug 12, 2026', () => {
    for (const [slug, p] of Object.entries(carrierProfiles)) {
      if (slug.startsWith('_') || !p.am_best) continue;
      assert.match(p.am_best.as_of, /^\d{4}-\d{2}-\d{2}$/, slug);
      assert.match(p.am_best.source_url, /^https:\/\//, slug);
    }
    const guard = main(pages.generateCarrierPage(byslug('berkshire-guard'), 'commercial', ctx));
    assert.match(guard, /AM Best financial strength rating: A\+ \(Superior\), as of August 12, 2026/);
    assert.doesNotMatch(guard, /A\+\+/);
    assert.equal(sourced.ratingLine({ rating: 'A', source_url: 'https://example.com/' }), '');
    assert.equal(sourced.ratingLine({ rating: 'A', as_of: '2026-01-01', source_url: 'http://example.com/' }), '');
    for (const c of all) {
      if (!carrierHasPage(c) || carrierProfiles[c.slug]) continue;
      assert.doesNotMatch(main(pages.generateCarrierPage(c, 'personal', ctx)), /AM Best/, c.slug);
    }
  });

  test('no carrier page claims an appointment or recommends the carrier until D6 verifies it', () => {
    for (const c of all) {
      if (!carrierHasPage(c)) continue;
      const html = pages.generateCarrierPage(c, 'personal', ctx);
      const body = text(main(html));
      assert.doesNotMatch(body, /lines we place with|Why we recommend|we represent|including [A-Z][\w ]+\.$/, c.slug);
      assert.doesNotMatch(body, /local, independent agent|strength and backing/, c.slug);
      assert.doesNotMatch(html, /—/, c.slug);
      assertCopyRules(c.slug, body);
    }
    const verified = { ...byslug('hartford'), appointment_verified_on: '2026-10-03' };
    assert.match(main(pages.generateCarrierPage(verified, 'commercial', ctx)), /Coverage lines we place with The Hartford/);
  });

  test('GUARD page says we are not GUARD, links its official pages and prints no carrier phone number', () => {
    const guard = main(pages.generateCarrierPage(byslug('berkshire-guard'), 'commercial', ctx));
    assert.match(guard, /We're an independent agency, not Berkshire Hathaway GUARD\./);
    assert.match(guard, /href="https:\/\/www\.guard\.com\/claims\/"/);
    const phones = [...guard.matchAll(/\(?\d{3}\)?[ .-]\d{3}-\d{4}/g)].map((m) => m[0]);
    assert.ok(phones.every((p) => p.includes('413-5335')), `carrier phone printed: ${phones}`);
  });

  test('/carriers/ gives every carrier an anchor (the 301 targets) and features only the kept five', () => {
    const index = main(pages.generateCarriersIndex(carriers, ctx));
    for (const c of all) assert.match(index, new RegExp(`<li id="${c.slug}"`), c.slug);
    const featured = [...index.matchAll(/<a href="\/carriers\/([a-z0-9-]+)" class="card"/g)].map((m) => m[1]).sort();
    assert.deepEqual(featured, [...KEPT].sort());
    assert.doesNotMatch(index, /All carriers we represent|featured partners|we have access to these carriers/);
  });
});

describe('priority-hub line sections (MKT-02)', () => {
  const hubs = hubSections.hubs;
  const cityOf = (slug) => landingData.cities.find((c) => c.slug === slug);

  test('drafts cover the sections owner D9 lists, each with a source, a product link and no sign-off yet', () => {
    assert.deepEqual(hubs['owensboro-ky'].map((s) => s.slug), ['auto', 'homeowners', 'commercial', 'workers-comp', 'life']);
    assert.deepEqual(hubs['mt-washington-ky'].map((s) => s.slug), ['auto', 'homeowners', 'life', 'bullitt-county-contractors']);
    for (const [hub, list] of Object.entries(hubs)) {
      for (const s of list) {
        const label = `${hub}#${s.slug}`;
        assert.ok(s.sources.length >= 1, label);
        for (const src of s.sources) {
          assert.match(src.url, /^https:\/\//, label);
          assert.match(src.accessed, /^\d{4}-\d{2}-\d{2}$/, label);
        }
        assert.ok(s.product_links.length >= 1, label);
        const html = s.paragraphs_html.join(' ');
        for (const l of s.product_links) assert.ok(html.includes(`href="${l}"`), `${label}: product link ${l} not in the copy`);
        assert.equal(s.signoff, null, `${label}: sign-off is recorded by the licensed reviewer, never by this PR`);
        if (s.replaces) assert.ok(cityOf(hub).context_sections.some((e) => e.heading === s.replaces), `${label}: replaces an existing heading`);
        assertCopyRules(label, s.heading + ' ' + text(html));
        assertStatuteLinks(label, html);
      }
    }
  });

  test('unsigned drafts render nothing: both hubs are unchanged', () => {
    for (const slug of Object.keys(hubs)) {
      const withDrafts = pages.generateCityPage(cityOf(slug), ctx);
      const without = pages.generateCityPage(cityOf(slug), makeCtx({ hubSections: { hubs: {} } }));
      assert.equal(withDrafts, without, slug);
    }
  });

  test('a signed section replaces its heading in place, new ones follow, and sources render', () => {
    const signed = JSON.parse(JSON.stringify(hubSections));
    for (const s of signed.hubs['owensboro-ky']) s.signoff = { reviewer: 'Zz Privacycheck', license_line: 'Property and casualty', date: '2026-10-03' };
    const body = main(pages.generateCityPage(cityOf('owensboro-ky'), makeCtx({ hubSections: signed })));
    assert.ok(!body.includes('<h3 id="auto">Auto insurance in Owensboro</h3>\n        <p>Daviess County drivers'), 'old auto section replaced');
    assert.match(body, /<h3 id="workers-comp">Workers&#39; compensation for Daviess County employers<\/h3>/);
    assert.ok(body.indexOf('id="life"') < body.indexOf('id="medicare"'), 'new sections sit before the Medicare section');
    assert.match(body, /Sources: <a href="https:\/\/www\.census\.gov\/quickfacts\//);
    assert.doesNotMatch(body, /one of the higher uninsured-driver rates in the region/);
    // A sign-off missing the license line or the date does not count.
    assert.equal(sourced.isSigned({ signoff: { reviewer: 'Zz Privacycheck', date: '2026-10-03' } }), false);
    assert.equal(sourced.isSigned({ signoff: { reviewer: 'Zz Privacycheck', license_line: 'P&C', date: 'soon' } }), false);
  });
});
