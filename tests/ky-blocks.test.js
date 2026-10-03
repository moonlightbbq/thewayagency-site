/**
 * Kentucky blocks, Kentucky titles and line-hub intros (CONT-01, CONT-02).
 *
 * data/ky-blocks.json holds drafts that render nothing until the owner gate is
 * approved and a licensed reviewer has signed the entry. These tests check the
 * file against its rules, prove that the drafts render nothing today, and prove
 * the gate opens only with both signatures.
 *
 * Pages are rendered in-process from the real data and generators; nothing here
 * runs scripts/build.js or reads build/.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const load = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

const ky = require('../scripts/lib/ky-blocks');
const pages = require('../scripts/builders/pages');
const shared = require('../scripts/shared-templates');

const data = load('ky-blocks.json');
const products = load('products.json');
const team = load('team.json');
const locations = load('locations.json');
const office = locations.offices[0];
const reviews = { rating: locations.agency.google_rating, count: locations.agency.google_review_count };
let richContent = {};
for (const f of ['content-personal.json', 'content-commercial.json', 'content-life.json', 'content-health.json']) {
  if (fs.existsSync(path.join(DATA, f))) Object.assign(richContent, load(f));
}

const LINES = ['personal', 'commercial', 'life', 'health'];
const allProducts = LINES.flatMap((l) => (products[l] || []).map((p) => ({ ...p, line: l })));
const byUrl = (url) => allProducts.find((p) => p.url === url);
const vctx = {
  pages: new Set(allProducts.map((p) => p.url)),
  hubs: new Set(['/personal/', '/commercial/', '/life/', '/health/']),
  teamSlugs: new Set(team.team.map((m) => m.slug)),
  today: '2026-10-03',
};
const WAVE1 = ['/personal/home', '/personal/auto', '/personal/renters', '/personal/umbrella', '/personal/motorcycle', '/personal/boat',
  '/personal/flood', '/commercial/general-liability', '/commercial/commercial-property', '/commercial/commercial-auto',
  '/commercial/workers-compensation', '/commercial/bonds', '/life/term-life'];

function makeCtx(kyData) {
  return {
    products, office, agency: locations.agency, team, knowledgeBase: load('knowledge-base.json'), carriers: load('carriers.json'),
    testimonials: load('testimonials.json'), testimonialsBlocklist: { blocked: [] }, reviews, richContent,
    landingData: load('landing-pages.json'), internalLinks: load('internal-links.json'), seoData: load('seo.json'),
    publishedBlog: new Set(), kyBlocks: kyData,
    renderNav: shared.renderNav, renderFooter: () => shared.renderFooter(office, reviews), renderScripts: shared.renderScripts,
  };
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const product = (url, kyData) => {
  const p = byUrl(url);
  return pages.generateProductPage(p, 'Line', p.line, p.line, makeCtx(kyData));
};
const titleOf = (html) => /<title>([^<]*)<\/title>/.exec(html)[1];
const h1Of = (html) => /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)[1].trim();
const sign = (e) => Object.assign(e, { reviewer: 'audrey-lillpop', reviewed_on: '2026-10-03' });
const approve = (d, gate) => Object.assign(d.owner_gates[gate], { approved_by: 'Zz Privacycheck', approved_on: '2026-10-03' });

describe('data/ky-blocks.json', () => {
  test('passes its own validation', () => {
    assert.deepEqual(ky.validate(data, vctx), []);
  });

  test('is entirely unsigned: no owner approval, no reviewer, no date', () => {
    for (const g of Object.values(data.owner_gates)) assert.equal(g.approved_by, null);
    for (const e of [...data.statements, ...data.titles, ...data.hubs, ...data.hubs.flatMap((h) => h.intro || [])]) {
      assert.equal(e.reviewer, null);
      assert.equal(e.reviewed_on, null);
    }
  });

  test('drafts a Kentucky title for each of the 13 wave-1 pages', () => {
    assert.deepEqual(data.titles.map((t) => t.page).sort(), [...WAVE1].sort());
  });

  test('every statement cites a Kentucky statute on apps.legislature.ky.gov with a section number', () => {
    for (const s of data.statements) {
      assert.match(s.source_url, /^https:\/\/apps\.legislature\.ky\.gov\/law\/statutes\/statute\.aspx\?id=\d+$/, s.id);
      assert.match(s.cite, /^KRS \d+[A-Z]?\.\d/, s.id);
    }
  });

  test('says nothing about Medicare and nothing on the flood page (no Kentucky flood rule sourced)', () => {
    assert.ok(!JSON.stringify(data).match(/medicare/i));
    assert.ok(!data.statements.some((s) => s.page === '/personal/flood'));
  });
});

describe('render gate', () => {
  test('today nothing renders: no Kentucky block, titles and H1s unchanged on every wave-1 page', () => {
    for (const url of WAVE1) {
      const html = product(url, data);
      const p = byUrl(url);
      assert.doesNotMatch(html, /If you live in Kentucky/, url);
      assert.equal(titleOf(html), p.title_tag, url);
      assert.equal(h1Of(html), p.h1 || p.name, url);
    }
  });

  test('a signed statement does not render while the owner gate is closed', () => {
    const d = clone(data);
    d.statements.filter((s) => s.page === '/personal/auto').forEach(sign);
    d.titles.filter((t) => t.page === '/personal/auto').forEach(sign);
    const html = product('/personal/auto', d);
    assert.doesNotMatch(html, /If you live in Kentucky/);
    assert.equal(titleOf(html), byUrl('/personal/auto').title_tag);
  });

  test('an approved gate renders nothing unsigned', () => {
    const d = clone(data);
    approve(d, 'product_blocks');
    const html = product('/personal/auto', d);
    assert.doesNotMatch(html, /If you live in Kentucky/);
    assert.equal(titleOf(html), byUrl('/personal/auto').title_tag);
  });

  test('approved gate plus signatures render only the signed statements, with link and as-of date', () => {
    const d = clone(data);
    approve(d, 'product_blocks');
    sign(d.statements.find((s) => s.id === 'auto-2'));
    sign(d.titles.find((t) => t.page === '/personal/auto'));
    const html = product('/personal/auto', d);
    assert.match(html, /<h2 id="ky-block-h">If you live in Kentucky<\/h2>/);
    assert.match(html, /href="https:\/\/apps\.legislature\.ky\.gov\/law\/statutes\/statute\.aspx\?id=46758" rel="noopener">KRS 304\.39-110\(1\)\(a\)<\/a>; text as of October 3, 2026/);
    assert.doesNotMatch(html, /KRS 304\.39-080\(5\)/, 'unsigned auto-1 must not render');
    assert.equal(titleOf(html), 'Kentucky Auto Insurance Quotes &amp; Coverage | The Way Agency');
    assert.equal(h1Of(html), 'What auto insurance do you need in Kentucky?');
    const block = /<section class="ky-block"[\s\S]*?<\/section>/.exec(html)[0];
    assert.doesNotMatch(block, /Reviewed by|audrey|lillpop/i, 'the reviewer is never printed');
    assert.doesNotMatch(html, /Reviewed by/);
    // The block sits right after the direct answer.
    assert.ok(html.indexOf('ky-block-h') < html.indexOf('We\'re not just selling insurance'));
  });

  test('a signed Kentucky H1 waits for at least one signed statement on the page', () => {
    const d = clone(data);
    approve(d, 'product_blocks');
    sign(d.titles.find((t) => t.page === '/personal/auto'));
    const html = product('/personal/auto', d);
    assert.equal(titleOf(html), 'Kentucky Auto Insurance Quotes &amp; Coverage | The Way Agency');
    assert.equal(h1Of(html), byUrl('/personal/auto').h1);
  });
});

describe('validation catches', () => {
  const bad = (mutate) => { const d = clone(data); mutate(d); return ky.validate(d, vctx).join('\n'); };
  test('an em dash, a non-primary source, a half signature, an unknown reviewer, a future date', () => {
    assert.match(bad((d) => { d.statements[0].statement += ' — x'; }), /em dash/);
    assert.match(bad((d) => { d.statements[0].source_url = 'https://example.com/krs'; }), /not a primary-source host/);
    assert.match(bad((d) => { d.statements[0].reviewer = 'audrey-lillpop'; }), /set together/);
    assert.match(bad((d) => { Object.assign(d.statements[0], { reviewer: 'nobody', reviewed_on: '2026-10-01' }); }), /not a data\/team\.json slug/);
    assert.match(bad((d) => { Object.assign(d.statements[0], { reviewer: 'jill-boone', reviewed_on: '2027-01-01' }); }), /not a past/);
  });
  test('"free" on a life page, a long or non-Kentucky title, a Kentucky H1 with no statement, Medicare copy', () => {
    assert.match(bad((d) => { d.statements.find((s) => s.page === '/life/term-life').statement += ' It is free to return.'; }), /"free"/);
    assert.match(bad((d) => { d.titles[0].title = 'Kentucky ' + 'x'.repeat(60); }), /max 60/);
    assert.match(bad((d) => { d.titles[0].title = 'Home Insurance | The Way Agency'; }), /must contain "Kentucky"/);
    assert.match(bad((d) => { d.titles.find((t) => t.page === '/personal/flood').h1 = 'Is flood insurance required in Kentucky?'; }), /needs a Kentucky statement/);
    assert.match(bad((d) => { d.statements[0].statement += ' Medicare too.'; }), /Medicare/);
  });
});
