/**
 * Medicare and health pages as the build renders them (TRUST-01, TRUST-04,
 * BLOG-02; specs/medicare-health-compliance.md section 4).
 *
 * Renders through the real templates with fixtures, never by running
 * scripts/build.js or writing build/ (suites run in parallel, and
 * tests/build-gate-wiring.test.js already builds). Counts in the fixtures are
 * test data, never site data: data/medicare-tpmo.json is pending_owner.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SITE_TPMO = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'medicare-tpmo.json'), 'utf8'));
const { generateBlogPost, postSources, markdownToHtml } = require('../scripts/generate-blog');

/** An active Branch A record with Daviess and Bullitt counts (test data). */
function activeTpmo() {
  const t = JSON.parse(JSON.stringify(SITE_TPMO));
  Object.assign(t, { status: 'active', branch: 'A', variant: 'not_all', as_of: '2026-10-07', signed_record: 'compliance-log TEST #1' });
  t.areas.KY.counties['Daviess County'] = { organizations: 3, products: 12 };
  t.areas.KY.counties['Bullitt County'] = { organizations: 4, products: 15 };
  return t;
}

const BODY = markdownToHtml('Intro paragraph.\n\n## One\n\nText.\n\n## Two\n\nText.\n\n## Three\n\nText.\n\n## Four\n\nText.');
const medicareMeta = (patch = {}) => ({
  title: 'SYNTHETIC Medicare post', slug: 'synthetic-medicare-post', description: 'SYNTHETIC description',
  date: '2026-07-22', modified: '2026-10-02', tags: 'medicare, open enrollment, kentucky', ...patch,
});
const otherMeta = (patch = {}) => ({
  title: 'SYNTHETIC flood post', slug: 'synthetic-flood-post', description: 'SYNTHETIC description',
  date: '2026-05-30', tags: 'flood insurance, kentucky', related_page: '/personal/flood.html', ...patch,
});

describe('blog template: Medicare posts (spec 3.7)', () => {
  test('a Medicare post prints the TPMO statement right after .blog-meta, before .blog-share', () => {
    const html = generateBlogPost(medicareMeta(), BODY, [], { tpmo: activeTpmo() });
    const meta = html.indexOf('class="blog-meta"');
    const stmt = html.indexOf('id="tpmo-disclaimer"');
    const share = html.indexOf('class="blog-share"');
    assert.ok(meta > 0 && stmt > meta && share > stmt, 'statement between the byline and the share buttons');
    assert.ok(html.includes('Currently we represent 3 organizations which offer 12 products in your area.'));
    assert.ok(html.includes('24 hours a day, 7 days a week'));
    assert.ok(!/href="tel:[^"]*(633-?4227|MEDICARE)/i.test(html), '1-800-MEDICARE is never a tel: link');
  });

  test('the site record (pending_owner) prints no statement, and a non-Medicare post never does', () => {
    assert.ok(!generateBlogPost(medicareMeta(), BODY, [], { tpmo: SITE_TPMO }).includes('tpmo-disclaimer'));
    assert.ok(!generateBlogPost(medicareMeta(), BODY, []).includes('tpmo-disclaimer'), 'the default record is the site record');
    assert.ok(!generateBlogPost(otherMeta(), BODY, [], { tpmo: activeTpmo() }).includes('tpmo-disclaimer'));
  });

  test('the Medicare CTA makes no carrier-shopping claim and sends readers to the Medicare intake', () => {
    const html = generateBlogPost(medicareMeta({ category: 'health' }), BODY, [], { tpmo: SITE_TPMO });
    assert.ok(html.includes('Talk with a licensed agent about your Medicare options.'));
    assert.ok(!html.includes('We shop top-rated carriers for you.'));
    assert.ok(html.includes('href="/intake/?product=medicare"'), 'no related_page: the Medicare intake');
    const other = generateBlogPost(otherMeta(), BODY, [], { tpmo: SITE_TPMO });
    assert.ok(other.includes('We compare the insurance companies we represent for you.'), 'other posts keep their CTA');
    assert.ok(other.includes('href="/intake/?product=flood"'));
  });
});

describe('blog template: Sources block (BLOG-02)', () => {
  const sources = ['CMS CY2027 Rate Announcement | https://www.cms.gov/files/document/2027-announcement.pdf',
    'https://www.medicare.gov/plan-compare',
    'Not a URL | http://example.com/insecure',
    'javascript:alert(1)',
    'Quoted | https://example.com/a"b'];

  test('both forms are read; only https URLs are kept; bare URLs are labelled host and path', () => {
    assert.deepEqual(postSources({ sources }), [
      { label: 'CMS CY2027 Rate Announcement', url: 'https://www.cms.gov/files/document/2027-announcement.pdf' },
      { label: 'medicare.gov/plan-compare', url: 'https://www.medicare.gov/plan-compare' },
    ]);
    assert.deepEqual(postSources({}), []);
  });

  test('the Sources list renders after the FAQ, and the Article JSON-LD gets citation', () => {
    const faqs = [{ question: 'SYNTHETIC question?', answer: 'SYNTHETIC answer.' }];
    const html = generateBlogPost(medicareMeta({ sources }), BODY, faqs, { tpmo: SITE_TPMO });
    const faq = html.indexOf('class="faq-section"');
    const src = html.indexOf('class="blog-sources"');
    assert.ok(faq > 0 && src > faq, 'Sources after the FAQ');
    assert.match(html, /<section class="blog-sources" aria-labelledby="sources-heading">\s*<h2 id="sources-heading">Sources<\/h2>/);
    assert.ok(html.includes('<li><a href="https://www.cms.gov/files/document/2027-announcement.pdf" rel="noopener">CMS CY2027 Rate Announcement</a></li>'));
    assert.ok(!html.includes('http://example.com/insecure') && !html.includes('javascript:alert'));
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    const article = ld.find((d) => d['@type'] === 'Article');
    assert.deepEqual(article.citation, ['https://www.cms.gov/files/document/2027-announcement.pdf', 'https://www.medicare.gov/plan-compare']);
    const toc = html.match(/<nav aria-label="Table of contents"[\s\S]*?<\/nav>/);
    assert.ok(toc && !toc[0].includes('Sources'), 'Sources is not in the table of contents');
  });

  test('a post without sources prints no block and no citation', () => {
    const html = generateBlogPost(otherMeta(), BODY, [], { tpmo: SITE_TPMO });
    assert.ok(!html.includes('blog-sources'));
    assert.ok(!html.includes('"citation"'));
  });
});

// ─── Product pages (TRUST-04 figures; spec 3.5) ───────────────────────────────

const pages = require('../scripts/builders/pages');
const shared = require('../scripts/shared-templates');

/** The build's shared context (scripts/build.js), read from the repo's data. */
function buildCtx(patch = {}) {
  const data = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
  const locations = data('locations.json');
  const office = locations.offices[0];
  const reviews = { rating: locations.agency.google_rating || '5.0', count: locations.agency.google_review_count || '20+' };
  const richContent = {};
  for (const f of ['content-personal.json', 'content-commercial.json', 'content-life.json', 'content-health.json']) Object.assign(richContent, data(f));
  return {
    products: data('products.json'), office, team: data('team.json'), knowledgeBase: data('knowledge-base.json'),
    tpmo: SITE_TPMO, healthFacts: data('health-facts.json'), carriers: data('carriers.json'), testimonials: data('testimonials.json'),
    reviews, richContent, landingData: data('landing-pages.json'), seoData: data('seo.json'),
    renderNav: shared.renderNav, renderFooter: () => shared.renderFooter(office, reviews), renderScripts: shared.renderScripts,
    ...patch,
  };
}
const LINES = { personal: 'Personal Insurance', commercial: 'Commercial Insurance', life: 'Life Insurance', health: 'Health Insurance' };
function productPage(id, ctx = buildCtx()) {
  for (const [lineKey, list] of Object.entries(ctx.products)) {
    const p = (list || []).find((x) => x.id === id);
    if (p) return pages.generateProductPage(p, LINES[lineKey], lineKey, lineKey, ctx);
  }
  throw new Error(`no product ${id}`);
}
/** Visible text: scripts and styles dropped, tags stripped, entities decoded. */
function visibleText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}
function faqLd(html) {
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    const d = JSON.parse(m[1]);
    if (d['@type'] === 'FAQPage') return d.mainEntity;
  }
  return [];
}

describe('product pages: 2026 and 2027 figures (TRUST-04)', () => {
  test('/health/medicare states the 2026 CMS amounts and both Part D years, and none of the stale ones', () => {
    const html = productPage('medicare');
    const text = visibleText(html);
    for (const s of ['$202.90 a month in 2026', '$1,736 per benefit period', '$283 a year in 2026', '$2,100 in 2026 and $2,400 in 2027', '$615 in 2026 and $700 in 2027']) {
      assert.ok(text.includes(s), s);
    }
    for (const s of ['$185', '$1,632', '$257', '$2,000 for Medicare Part D', 'save thousands of dollars']) assert.ok(!text.includes(s), s);
    const partD = faqLd(html).find((q) => q.name === 'Does Medicare cover prescription drugs?');
    assert.ok(partD, 'Part D FAQ in FAQPage');
    assert.ok(text.includes(partD.acceptedAnswer.text), 'the FAQPage answer is the visible answer');
    assert.ok(partD.acceptedAnswer.text.includes('$2,100') && partD.acceptedAnswer.text.includes('$2,400'));
  });

  test('Marketplace pages read the dated plan year 2027 enrollment fact; no token or enhanced-subsidy claim survives', () => {
    for (const id of ['individual_health', 'family_health']) {
      const product = Object.values(buildCtx().products).flat().find((p) => p.id === id || p.slug === id.replace('_', '-'));
      const html = pages.generateProductPage(product, 'Health Insurance', 'health', 'health', buildCtx());
      const text = visibleText(html);
      assert.ok(text.includes('As of October 2026, open enrollment for 2027 coverage runs November 1, 2026 to January 15, 2027'), id);
      assert.ok(!html.includes('{{fact:'), `${id}: no unresolved token`);
      assert.ok(!/enhanced subsidies/i.test(html), id);
      assert.ok(!/through January 15(?!, 20)/.test(text), `${id}: no undated January 15`);
      for (const q of faqLd(html)) assert.ok(!q.acceptedAnswer.text.includes('{{fact:'), `${id}: JSON-LD token resolved`);
    }
  });

  test('Medicaid, group health and family health carry the 2026 values', () => {
    const products = Object.values(buildCtx().products).flat();
    const page = (slug) => visibleText(pages.generateProductPage(products.find((p) => p.slug === slug), 'Health Insurance', 'health', 'health', buildCtx()));
    const medicaid = page('medicaid');
    assert.ok(medicaid.includes('$22,025') && medicaid.includes('$29,863') && medicaid.includes('$37,702'));
    assert.ok(medicaid.includes('Tennessee has not expanded Medicaid'));
    assert.ok(!/\$(20,783|28,208|35,632)/.test(medicaid));
    const group = page('group-health');
    assert.ok(group.includes('$1,700 for self-only') && group.includes('$4,400 for self-only') && group.includes('$8,750 for family'));
    const family = page('family-health');
    assert.ok(family.includes('$21,200 for a family plan in 2026') && family.includes('$24,000 in 2027'));
    assert.ok(!family.includes('$18,900'));
    const individual = page('individual-health');
    assert.ok(!individual.includes('$60,240'), 'no 400% dollar figure until the reviewer confirms it');
  });
});

// ─── Frozen legacy guide (spec 3.10) ─────────────────────────────────────────

describe('legacy Medicare guide', () => {
  const { copyBlogPages } = require('../scripts/builders/blog-helpers');
  const { LEGACY_BLOG_PAGES, legacyPageHash } = require('../scripts/lib/legacy-blog-pages');
  const SRC_PAGE = path.join(ROOT, 'src', 'pages', 'blog', 'medicare-enrollment-guide.html');

  test('the edited page matches its pin and carries one TPMO placeholder under the byline', () => {
    const src = fs.readFileSync(SRC_PAGE, 'utf8');
    assert.equal(legacyPageHash(src), LEGACY_BLOG_PAGES['medicare-enrollment-guide.html']);
    assert.equal(src.split('<!--TPMO-DISCLAIMER-->').length - 1, 1);
    assert.ok(src.indexOf('class="blog-meta"') < src.indexOf('<!--TPMO-DISCLAIMER-->'));
  });

  test('copyBlogPages fills the placeholder from the record: nothing while pending, the statement when active', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'medicare-legacy-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src', 'pages', 'blog'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'src', 'blog'), { recursive: true });
      fs.copyFileSync(SRC_PAGE, path.join(tmp, 'src', 'pages', 'blog', 'medicare-enrollment-guide.html'));
      const SRC = path.join(tmp, 'src');
      const BUILD = path.join(tmp, 'build');
      const out = () => fs.readFileSync(path.join(BUILD, 'blog', 'medicare-enrollment-guide.html'), 'utf8');
      copyBlogPages(SRC, BUILD, (c) => c, SITE_TPMO);
      assert.ok(!out().includes('<!--TPMO-DISCLAIMER-->') && !out().includes('tpmo-disclaimer'), 'pending: placeholder removed, no statement');
      copyBlogPages(SRC, BUILD, (c) => c, activeTpmo());
      const html = out();
      assert.ok(html.includes('id="tpmo-disclaimer"') && html.includes('Currently we represent 3 organizations which offer 12 products in your area.'));
      assert.ok(html.indexOf('class="blog-meta"') < html.indexOf('id="tpmo-disclaimer"'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
