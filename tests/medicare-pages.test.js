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
