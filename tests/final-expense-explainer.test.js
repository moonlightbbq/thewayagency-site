/**
 * CONT-03 (content-accuracy WP-F): /life/final-expense answers the "$25,000
 * benefit for seniors" question in a visible H2 that debunks it, shows no
 * unsourced prices or funeral-cost figures, and never says "free" (KRS
 * 304.15-712(3)(b), conservative reading). The final-expense guide carries no
 * funeral-cost figure either. Nothing here reads or writes build/.
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
const pages = require('../scripts/builders/pages');
const shared = require('../scripts/shared-templates');

const locations = load('locations.json');
const office = locations.offices[0];
const agency = locations.agency;
const products = load('products.json');
const reviews = { rating: agency.google_rating, count: agency.google_review_count };
const richContent = {};
for (const f of ['content-personal.json', 'content-commercial.json', 'content-life.json', 'content-health.json']) {
  if (fs.existsSync(path.join(DATA, f))) Object.assign(richContent, load(f));
}
const internalLinks = load('internal-links.json');
const ctx = {
  products, office, agency, team: load('team.json'), knowledgeBase: load('knowledge-base.json'), carriers: load('carriers.json'),
  testimonials: load('testimonials.json'), testimonialsBlocklist: { blocked: [] }, reviews, richContent,
  landingData: load('landing-pages.json'), internalLinks, seoData: load('seo.json'),
  publishedBlog: new Set(Object.values(internalLinks.guides).flat().map((g) => g.slug)),
  renderNav: shared.renderNav, renderFooter: () => shared.renderFooter(office, reviews), renderScripts: shared.renderScripts,
};
const main = (html) => { const m = /<main id="main">([\s\S]*?)<\/main>/.exec(html); assert.ok(m, 'no <main>'); return m[1]; };
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const fe = products.life.find((p) => p.id === 'final-expense');
const page = () => pages.generateProductPage(fe, 'Life Insurance', 'life', 'life', ctx);

// Funeral-cost figures (any of the three conflicting ones), monthly prices, NFDA citations.
const FUNERAL_OR_PRICE = /\$\s?7,\d{3}|\$\s?\d[\d,]*\s*(?:-|–|to)\s*\$?\s?\d[\d,]*\s*(?:\/|per |a )month|\/month|NFDA|National Funeral Directors/i;

describe('/life/final-expense (CONT-03)', () => {
  test('a visible H2 asks the $25,000 question outside the collapsed FAQ, right after the direct answer', () => {
    const body = main(page());
    const h2 = body.indexOf('<h2>Is there a $25,000 final expense benefit for seniors?</h2>');
    assert.ok(h2 > 0, 'explainer H2 present');
    const faq = body.indexOf('class="faq-section"');
    assert.ok(faq === -1 || h2 < faq, 'explainer comes before the FAQ accordion');
    assert.ok(h2 < body.indexOf('<h2>Who needs final expense?</h2>'), 'explainer sits right under the direct answer');
  });

  test('the explainer debunks rather than echoes: $25,000 appears only as the question or a policy size, never as an available benefit', () => {
    const section = richContent['final-expense'].answer_sections[0];
    assert.match(section.html, /No government program pays seniors \$25,000 for final expenses\./);
    assert.match(section.html, /private final expense insurance/);
    assert.match(section.html, /apply for and pay premiums on/);
    assert.match(section.html, /immediate/);
    assert.match(section.html, /graded/);
    for (const m of section.html.matchAll(/\$25,000/g)) {
      const around = section.html.slice(Math.max(0, m.index - 60), m.index + 40);
      assert.match(around, /No government program pays|\$5,000 to \$25,000/, around);
    }
  });

  test('no "free", no prices and no funeral-cost figure anywhere on the page body', () => {
    const t = text(main(page()));
    assert.doesNotMatch(t, /\bfree\b/i);
    assert.doesNotMatch(t, FUNERAL_OR_PRICE);
    assert.doesNotMatch(t, /top-rated/i);
  });

  test('the cost section links the guide; the unsourced price fields are gone', () => {
    const body = main(page());
    assert.match(body, /<h2>What does final expense cost\?<\/h2>\s*<p>[^<]*[\s\S]*?<a href="\/blog\/final-expense-insurance-guide">/);
    assert.equal(fe.typical_cost_range, undefined);
    assert.doesNotMatch(fe.requirement, /\$/);
    assert.doesNotMatch(JSON.stringify(richContent['final-expense']), FUNERAL_OR_PRICE);
  });

  test('answer_sections escape their heading; a section without heading or html is skipped', () => {
    const product = { ...fe, id: 'zz-synthetic-product' };
    const html = main(pages.generateProductPage(product, 'Life Insurance', 'life', 'life', {
      ...ctx,
      richContent: { 'zz-synthetic-product': { direct_answer: 'Synthetic answer.', answer_sections: [{ heading: 'Q <b>&</b>?', html: '<p>A.</p>' }, { heading: 'Empty' }] } },
    }));
    assert.match(html, /<h2>Q &lt;b&gt;&amp;&lt;\/b&gt;\?<\/h2>\s*<p>A\.<\/p>/);
    assert.doesNotMatch(html, /<h2>Empty<\/h2>/);
  });

  test('the knowledge base and the calendar carry no funeral-cost figure for final expense', () => {
    const kb = fs.readFileSync(path.join(DATA, 'knowledge-base.json'), 'utf8');
    const fev = /"id": "final-expense-vs-whole-life",\s*"question": "[^"]*",\s*"answer": "([^"]*)"/.exec(kb);
    assert.ok(fev, 'final-expense-vs-whole-life entry present');
    assert.doesNotMatch(fev[1], /\$7,000|on average/);
    const cal = fs.readFileSync(path.join(DATA, 'content-calendar.json'), 'utf8');
    assert.doesNotMatch(cal, /\$7,000-\$12,000 bill/);
  });
});

describe('/blog/final-expense-insurance-guide (CONT-03)', () => {
  const md = fs.readFileSync(path.join(ROOT, 'src/blog/final-expense-insurance-guide.md'), 'utf8');
  test('no funeral-cost figure, no monthly prices, no "top-rated", no em dash, no tax claims', () => {
    assert.doesNotMatch(md, FUNERAL_OR_PRICE);
    assert.doesNotMatch(md, /\$\d+ to \$\d+ per month/);
    assert.doesNotMatch(md, /top-rated/i);
    assert.doesNotMatch(md, /—/);
    assert.doesNotMatch(md, /tax-deductible|income tax/i);
    assert.doesNotMatch(md, /\bfree\b/i);
  });
  test('the guide links the product page that answers the $25,000 question', () => {
    assert.match(md, /\[final expense insurance page\]\(\/life\/final-expense\.html\)/);
    assert.match(md, /not a government benefit/);
  });
});
