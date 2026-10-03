/**
 * TECH-02 (url-hygiene PR-1): the site prints extensionless internal URLs.
 * Pages serves /x from x.html and 308s /x.html -> /x, so every .html link is a
 * redirect hop. Nothing here reads or writes build/.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { productSlugFromRelatedPage, intakeHref, generateBlogPost, markdownToHtml } = require('../scripts/generate-blog');
const { htmlFileUrlsInHtml, htmlFileUrlsInText, mainRange } = require('../scripts/lib/url-hygiene');
const { rewriteLinks, rewritePage, builtPagePaths } = require('../scripts/codemods/extensionless-links');
const { renderNav, renderFooter } = require('../scripts/shared-templates');

const BODY = '## One\n\nSee [home cover](/personal/home.html#coverage).\n\n## Two\n\nText.\n\n## Three\n\nText.\n\n## Four\n\nText.';
const render = (meta) => generateBlogPost(
  { title: 'SYNTHETIC test post', slug: 'test-ext-links', description: 'd', date: '2026-01-07', category: 'personal', ...meta },
  markdownToHtml(BODY), [], { team: [] });

describe('mid-post CTA keeps its ?product= prefill whatever form related_page takes (TECH-02 step 1)', () => {
  test('productSlugFromRelatedPage accepts the .html and the extensionless form', () => {
    for (const [line, slug] of [['personal', 'auto'], ['commercial', 'general-liability'], ['life', 'term-life'], ['health', 'dental-vision']]) {
      assert.equal(productSlugFromRelatedPage(`/${line}/${slug}.html`), slug);
      assert.equal(productSlugFromRelatedPage(`/${line}/${slug}`), slug);
    }
  });
  test('no prefill for an absent, general or non-product related_page', () => {
    for (const v of [undefined, null, '', 'null', '/personal/', '/contact', '/insurance/owensboro-ky', '/blog/x.html', '/personal/auto/extra']) {
      assert.equal(productSlugFromRelatedPage(v), null, String(v));
      assert.equal(intakeHref(v), '/intake/', String(v));
    }
  });
  test('intakeHref is the same for both forms', () => {
    assert.equal(intakeHref('/personal/auto.html'), '/intake/?product=auto');
    assert.equal(intakeHref('/personal/auto'), '/intake/?product=auto');
  });
});

describe('a generated blog post prints only extensionless internal URLs', () => {
  for (const related of ['/personal/auto.html', '/personal/auto']) {
    test(`related_page ${related}`, () => {
      const html = render({ related_page: related });
      assert.match(html, /href="\/intake\/\?product=auto"[^>]*>Get a Free Quote</, 'mid-post CTA keeps the prefill');
      assert.match(html, /<a href="\/intake\/\?product=auto" class="btn btn--primary btn--lg">Get a Quote<\/a>/, 'bottom CTA keeps the prefill');
      assert.match(html, /<a href="\/personal\/auto" class="card"/, 'Related Coverage card is extensionless');
      assert.match(html, />Auto<\/h3>/, 'card title unchanged');
      assert.match(html, /href="\/personal\/home#coverage"/, 'body link canonicalised at render time');
      assert.match(html, /href="\/contact" class="btn/);
      assert.ok(html.includes('https://www.thewayagency.com/blog/test-ext-links'), 'share URLs');
      assert.deepEqual(htmlFileUrlsInHtml(html), [], 'no .html URL anywhere in the page');
    });
  }
});

describe('shared nav and footer', () => {
  test('carry no .html links', () => {
    const office = { street: 'PO Box 1', city: 'Testville', state: 'KY', zip: '40000', phone: '(502) 413-5335' };
    assert.deepEqual(htmlFileUrlsInHtml(renderNav() + renderFooter(office, null)), []);
  });
});

describe('htmlFileUrlsInHtml (scripts/lib/url-hygiene.js)', () => {
  const page = `<a href="/about/team.html#test-member">t</a><a href='/privacy.html'>p</a>
<script type="application/ld+json">{"itemListElement":[{"item":"https://www.thewayagency.com/personal/auto.html"}]}</script>
<a href="https://twitter.com/intent/tweet?url=https://www.thewayagency.com/blog/x.html">s</a>
<button onclick="navigator.clipboard.writeText('https://www.thewayagency.com/blog/x.html')">c</button>
<script>fetch('/api', { body: JSON.stringify({ page: '/contact.html' }) });</script>
<p>[flood](/personal/flood.html)</p>
<a href="/personal/auto">ok</a><a href="/src/x.html">asset</a><a href="https://example.com/a.html">ext</a><a href="tel:+15024135335">c</a>`;
  test('reports attribute, JSON-LD and absolute www URLs; never a JS value, plain text, assets or other hosts', () => {
    const hits = htmlFileUrlsInHtml(page);
    assert.deepEqual(hits.map((h) => [h.kind, h.url]), [
      ['attr', '/about/team.html#test-member'],
      ['attr', '/privacy.html'],
      ['jsonld', 'https://www.thewayagency.com/personal/auto.html'],
      ['absolute', 'https://www.thewayagency.com/blog/x.html'],
      ['absolute', 'https://www.thewayagency.com/blog/x.html'],
    ]);
  });
  test('skip ranges leave a <main> out', () => {
    const html = `<nav><a href="/terms.html">t</a></nav><main><a href="/privacy.html">p</a></main><footer><a href="/contact.html">c</a></footer>`;
    assert.equal(htmlFileUrlsInHtml(html).length, 3);
    assert.deepEqual(htmlFileUrlsInHtml(html, { skip: [mainRange(html)] }).map((h) => h.url), ['/terms.html', '/contact.html']);
  });
  test('text files: absolute URLs and markdown links', () => {
    assert.deepEqual(htmlFileUrlsInText('- https://www.thewayagency.com/about/team.html\n- [x](/personal/home.html)\n- https://www.thewayagency.com/about/team').map((h) => h.url),
      ['https://www.thewayagency.com/about/team.html', '/personal/home.html']);
  });
});

describe('codemod scripts/codemods/extensionless-links.js', () => {
  const FROM = ['/about/team.html', '/privacy.html', '/blog/index.html', '/index.html', '/contact.html', '/personal/auto.html'];
  test('rewrites built pages in hrefs and absolute URLs, keeps fragments and queries, and is idempotent', () => {
    const before = `<a href="/about/team.html#x">a</a> <a href='/privacy.html'>b</a> <a href="/blog/index.html">c</a>
<a href="/index.html?a=1">d</a> "url": "https://www.thewayagency.com/personal/auto.html", <link href="/src/css/x.html">
<a href="/not-a-page.html">e</a> page: '/contact.html', <!-- /about/team.html -->`;
    const once = rewriteLinks(before, FROM);
    assert.equal(once.text, `<a href="/about/team#x">a</a> <a href='/privacy'>b</a> <a href="/blog/">c</a>
<a href="/?a=1">d</a> "url": "https://www.thewayagency.com/personal/auto", <link href="/src/css/x.html">
<a href="/not-a-page.html">e</a> page: '/contact.html', <!-- /about/team.html -->`);
    assert.equal(once.count, 5);
    const twice = rewriteLinks(once.text, FROM);
    assert.equal(twice.text, once.text);
    assert.equal(twice.count, 0);
  });
  test('--exclude-compliance-main leaves <main> alone; --only-compliance-main touches only <main>', () => {
    const html = `<nav><a href="/privacy.html">n</a></nav><main class="x"><a href="/contact.html">m</a></main><footer><a href="/privacy.html">f</a></footer>`;
    assert.equal(rewritePage(html, FROM, { main: 'exclude' }).text, `<nav><a href="/privacy">n</a></nav><main class="x"><a href="/contact.html">m</a></main><footer><a href="/privacy">f</a></footer>`);
    assert.equal(rewritePage(html, FROM, { main: 'only' }).text, `<nav><a href="/privacy.html">n</a></nav><main class="x"><a href="/contact">m</a></main><footer><a href="/privacy.html">f</a></footer>`);
  });
  test('the page list comes from the build, assets excluded', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-links-'));
    try {
      for (const f of ['index.html', 'about/team.html', 'blog/index.html', 'src/assets/x.html']) {
        fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
        fs.writeFileSync(path.join(tmp, f), '<!DOCTYPE html>');
      }
      assert.deepEqual(builtPagePaths(tmp).sort(), ['/about/team.html', '/blog/index.html', '/index.html']);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
