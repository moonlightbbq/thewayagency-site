/**
 * BLOG-01 (content-accuracy WP-A2, A4): markdown pipe tables render as one
 * accessible <table>, and seo_title sets the document title without touching
 * the H1. Nothing here reads or writes build/.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { markdownToHtml, generateBlogPost, parseFrontMatter } = require('../scripts/generate-blog');
const { splitRow, pipeTableBlock, wrapPipeTables } = require('../scripts/lib/markdown-tables');

const ROOT = path.join(__dirname, '..');

describe('pipe tables (WP-A2)', () => {
  test('a header, delimiter and body rows become one table inside a focusable scroll region', () => {
    const html = markdownToHtml('Intro line.\n\n| Requirement | Rule |\n|---|---|\n| Liability | 25/50/25 |\n| PIP | $10,000 |\n\nAfter.');
    assert.equal((html.match(/<table>/g) || []).length, 1);
    assert.match(html, /<div class="table-wrap" role="region" aria-label="Table" tabindex="0"><table>/);
    assert.match(html, /<thead><tr><th scope="col">Requirement<\/th><th scope="col">Rule<\/th><\/tr><\/thead>/);
    assert.match(html, /<tr><td>Liability<\/td><td>25\/50\/25<\/td><\/tr>/);
    assert.match(html, /<tr><td>PIP<\/td><td>\$10,000<\/td><\/tr>/);
    assert.match(html, /<p>Intro line\.<\/p>/);
    assert.match(html, /<p>After\.<\/p>/);
    assert.doesNotMatch(html, /\|/, 'no raw pipe text is left');
    assert.doesNotMatch(html, /<p>\s*<div/, 'the table is never wrapped in a paragraph');
  });

  test('a table directly under a text line (no blank line) still renders apart from it', () => {
    const html = markdownToHtml('Costs by line:\n| A | B |\n|---|---|\n| 1 | 2 |\nNext line.');
    assert.match(html, /<p>Costs by line:<\/p>/);
    assert.match(html, /<table>/);
    assert.match(html, /<p>Next line\.<\/p>/);
  });

  test('cells keep bold, italic and links, and a pipe inside an href never splits a cell', () => {
    const html = markdownToHtml('| Statute | Note |\n|---|---|\n| [KRS 304.39-110](https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=46758) | **bold** and *it* |');
    assert.match(html, /<td><a href="https:\/\/apps\.legislature\.ky\.gov\/law\/statutes\/statute\.aspx\?id=46758">KRS 304\.39-110<\/a><\/td>/);
    assert.match(html, /<td><strong>bold<\/strong> and <em>it<\/em><\/td>/);
    assert.deepEqual(splitRow('| <a href="/x?a=1|2">t</a> | b |'), ['<a href="/x?a=1|2">t</a>', 'b']);
    assert.deepEqual(splitRow('| a \\| b | c |'), ['a | b', 'c']);
  });

  test('cell text stays escaped: markup typed in a cell prints as text', () => {
    const html = markdownToHtml('| A | B |\n|---|---|\n| <script>x</script> | "q" |');
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
    assert.match(html, /&quot;q&quot;/);
  });

  test('alignment colons become ta-c / ta-r classes, never inline styles', () => {
    const html = markdownToHtml('| L | C | R |\n|:---|:---:|---:|\n| a | b | c |');
    assert.match(html, /<th scope="col">L<\/th><th scope="col" class="ta-c">C<\/th><th scope="col" class="ta-r">R<\/th>/);
    assert.match(html, /<td>a<\/td><td class="ta-c">b<\/td><td class="ta-r">c<\/td>/);
    assert.doesNotMatch(html, /style=/);
  });

  test('short rows are padded, long rows trimmed to the header width', () => {
    const html = markdownToHtml('| A | B | C |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |');
    assert.match(html, /<tr><td>1<\/td><td><\/td><td><\/td><\/tr>/);
    assert.match(html, /<tr><td>1<\/td><td>2<\/td><td>3<\/td><\/tr>/);
    assert.doesNotMatch(html, />4</);
  });

  test('an empty header cell prints as <td></td>, not an empty <th>', () => {
    const html = markdownToHtml('| | Replacement Cost | Actual Cash Value |\n|---|---|---|\n| Cost | $1 | $1 |');
    assert.match(html, /<thead><tr><td><\/td><th scope="col">Replacement Cost<\/th>/);
    assert.doesNotMatch(html, /<th[^>]*><\/th>/);
  });

  test('pipe lines without a delimiter row are left as they were', () => {
    const md = '| not | a table |\n| still | not |';
    assert.equal(pipeTableBlock(md), md);
    assert.equal(wrapPipeTables(md), md);
    assert.doesNotMatch(markdownToHtml(md), /<table/);
    assert.doesNotMatch(markdownToHtml('A | B in prose is fine.'), /<table/);
  });

  test('two tables in one post render as two tables; lists around them are unaffected', () => {
    const html = markdownToHtml('- one\n- two\n\n| A |\n|---|\n| 1 |\n\nMiddle.\n\n| B |\n|---|\n| 2 |');
    assert.equal((html.match(/<table>/g) || []).length, 2);
    assert.match(html, /<ul>\n<li>one<\/li>\n<li>two<\/li>\n<\/ul>/);
    assert.match(html, /<p>Middle\.<\/p>/);
  });

  test('both posts that showed raw pipe text on main now render a table', () => {
    for (const slug of ['mt-washington-business-insurance', 'replacement-cost-vs-actual-cash-value']) {
      const { body } = parseFrontMatter(fs.readFileSync(path.join(ROOT, 'src/blog', `${slug}.md`), 'utf8'));
      const html = markdownToHtml(body);
      assert.equal((html.match(/<table>/g) || []).length, 1, slug);
      assert.doesNotMatch(html, /<p>\|/, `${slug}: no raw pipe paragraph`);
    }
  });

  test('blog.css styles the wrapper so the page never scrolls sideways', () => {
    const css = fs.readFileSync(path.join(ROOT, 'src/css/blog.css'), 'utf8');
    assert.match(css, /\.blog-content \.table-wrap\{overflow-x:auto/);
    assert.match(css, /\.blog-content \.ta-c\{text-align:center\}/);
  });
});

describe('seo_title (WP-A4)', () => {
  const base = { title: 'SYNTHETIC H1 question?', slug: 'test-seo-title', description: 'd', date: '2026-01-07', category: 'personal' };
  const bodyHtml = markdownToHtml('## One\n\nText.');

  test('seo_title is the whole <title>, og:title and twitter:title; the H1 and headline keep title', () => {
    const html = generateBlogPost({ ...base, seo_title: 'SYNTHETIC search title' }, bodyHtml, [], { team: [] });
    assert.match(html, /<title>SYNTHETIC search title<\/title>/);
    assert.match(html, /<meta property="og:title" content="SYNTHETIC search title">/);
    assert.match(html, /<meta name="twitter:title" content="SYNTHETIC search title">/);
    assert.match(html, /<h1 class="hero__title">SYNTHETIC H1 question\?<\/h1>/);
    assert.match(html, /"headline": "SYNTHETIC H1 question\?"/);
  });

  test('without seo_title the title keeps the brand suffix (no change for other posts)', () => {
    const html = generateBlogPost(base, bodyHtml, [], { team: [] });
    assert.match(html, /<title>SYNTHETIC H1 question\? \| The Way Agency<\/title>/);
    assert.match(html, /<meta property="og:title" content="SYNTHETIC H1 question\? \| The Way Agency">/);
  });

  test('seo_title is escaped where it lands', () => {
    const html = generateBlogPost({ ...base, seo_title: 'A "quoted" & <b>' }, bodyHtml, [], { team: [] });
    assert.match(html, /<title>A &quot;quoted&quot; &amp; &lt;b&gt;<\/title>/);
  });
});
