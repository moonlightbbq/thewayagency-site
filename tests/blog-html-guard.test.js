/**
 * A blog page runs no script it was not built with (sage-server BL-54,
 * AIA-089).
 *
 * AI-written posts reach this site as markdown that SAGE commits to main, and
 * the site serves them on the domain that hosts the intake forms, under a CSP
 * that still allows 'unsafe-inline'. Two controls, both tested here:
 *
 *   1. the renderer (scripts/generate-blog.js markdownToHtml): a body link
 *      prints only an allowlisted scheme (http, https, mailto, tel, sms) or a
 *      scheme-less target, and nothing in a link target can close its
 *      attribute;
 *   2. the guard (scripts/lib/blog-html-guard.js), which scripts/build.js
 *      (Cloudflare builds; SAGE's publish commits skip CI) and
 *      scripts/validate-build.js (CI) run over build/blog/*.html: no
 *      "javascript:", no event-handler attribute, no script URL. The page
 *      template carries no inline handler of its own (the Copy Link button is
 *      wired by src/js/app.js), so the guard needs no exceptions.
 *
 * Fixtures only, synthetic data: node --test runs suites in parallel and
 * build-gate-wiring.test.js rebuilds build/, so nothing here reads build/.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const { markdownToHtml, generateBlogPost } = require('../scripts/generate-blog');
const { blogHtmlProblems, startTags } = require('../scripts/lib/blog-html-guard');

const hrefOf = (html) => {
  const a = startTags(html).find((t) => t.tag === 'a');
  return a ? a.attrs : null;
};

describe('markdownToHtml: link targets (criterion 4)', () => {
  test('[x](javascript:alert(1)) prints no javascript: href', () => {
    const html = markdownToHtml('[x](javascript:alert(1))');
    assert.doesNotMatch(html, /javascript:/i);
    assert.deepEqual(hrefOf(html), [{ name: 'href', value: '#' }]);
    assert.deepEqual(blogHtmlProblems(html, 'fixture'), []);
  });

  test('[x](" onmouseover="a) injects no attribute', () => {
    const html = markdownToHtml('[x](" onmouseover="a)');
    assert.deepEqual(hrefOf(html), [{ name: 'href', value: '#' }], 'the <a> has exactly one attribute: href="#"');
    assert.doesNotMatch(html, /onmouseover/);
    assert.deepEqual(blogHtmlProblems(html, 'fixture'), []);
  });

  test('every other scheme, and every way of hiding one, prints "#"', () => {
    for (const target of [
      'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', ' javascript:alert(1)', 'vbscript:msgbox(1)',
      'data:text/html;base64,PHNjcmlwdD4=', 'file:///etc/hosts', 'ftp://example.com/x', 'chrome://settings', 'blob:https://example.com/x',
      '/x" onclick="alert(1)', "/x' onclick='alert(1)", '/x onclick=alert(1)', '/x<script>', '/x`y',
    ]) {
      const html = markdownToHtml(`[x](${target})`);
      assert.equal(hrefOf(html)[0].value, '#', JSON.stringify(target));
      assert.equal(hrefOf(html).length, 1, JSON.stringify(target));
      assert.deepEqual(blogHtmlProblems(html, 'fixture'), [], JSON.stringify(target));
    }
  });

  test('a character reference is decoded once, as the browser does: &#106;avascript: stays a harmless relative URL', () => {
    const html = markdownToHtml('[x](&#106;avascript:alert(1))');
    assert.deepEqual(blogHtmlProblems(html, 'fixture'), []);
    assert.doesNotMatch(html, /href="javascript:/i);
  });

  test('the allowed targets print unchanged (site paths extensionless, as before)', () => {
    const cases = [
      ['https://www.fema.gov/flood-maps', 'https://www.fema.gov/flood-maps'],
      ['http://example.com/a?b=1&c=2', 'http://example.com/a?b=1&amp;c=2'],
      ['mailto:zz.test@example.com', 'mailto:zz.test@example.com'],
      ['tel:+15025550100', 'tel:+15025550100'],
      ['sms:+15025550100', 'sms:+15025550100'],
      ['/personal/home.html', '/personal/home'],
      ['/insurance/owensboro-ky.html#auto', '/insurance/owensboro-ky#auto'],
      ['#faq', '#faq'],
      ['?product=home', '?product=home'],
      ['related-post', 'related-post'],
    ];
    for (const [target, href] of cases) {
      const html = markdownToHtml(`[x](${target})`);
      assert.deepEqual(hrefOf(html), [{ name: 'href', value: href }], target);
      assert.deepEqual(blogHtmlProblems(html, 'fixture'), [], target);
    }
  });
});

describe('the rendered page (generateBlogPost)', () => {
  const meta = {
    title: 'SYNTHETIC "quoted" title" onmouseover="alert(1)', slug: 'test-guarded-post',
    description: 'SYNTHETIC d" onfocus="alert(1)', date: '2026-01-07', image_alt: 'a" onerror="alert(1)',
    tags: 'x" onclick="y, storm', cta_title: '<img src=x onerror=alert(1)>', cta_text: 'javascript&colon;alert(1)',
  };
  const body = `${Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')}\n\n## One\n\nSee [the report](https://www.weather.gov/test-report) and [this](javascript:alert(1)) and [that](" onmouseover="a).\n\n## Two\n\nText.\n\n## Three\n\nText.`;
  const html = generateBlogPost(meta, markdownToHtml(body), [{ question: 'Q" onclick="x', answer: '<a href="#" onclick="x">A</a>' }]);

  test('hostile front matter, body links and FAQ text render as text: the guard finds nothing to refuse', () => {
    assert.deepEqual(blogHtmlProblems(html, 'blog/test-guarded-post.html'), []);
  });

  test('text that literally says "javascript:" (here a FAQ answer) renders escaped, and the page-wide rule still refuses the page: fail closed', () => {
    const page = generateBlogPost(meta, markdownToHtml(body), [{ question: 'Q', answer: '<a href="javascript:alert(1)">A</a>' }]);
    const got = blogHtmlProblems(page, 'blog/test-guarded-post.html');
    assert.equal(got.length, 1, JSON.stringify(got));
    assert.match(got[0], /"javascript:" in the page/);
    assert.doesNotMatch(page, /href="javascript:/i);
  });

  test('the template carries no inline event handler: Copy Link is a data-copy-link button', () => {
    assert.ok(!startTags(html).some((t) => t.attrs.some((a) => a.name.startsWith('on'))));
    const btn = startTags(html).find((t) => t.attrs.some((a) => a.name === 'data-copy-link'));
    assert.ok(btn, 'a Copy Link button');
    assert.equal(btn.attrs.find((a) => a.name === 'data-copy-link').value, 'https://www.thewayagency.com/blog/test-guarded-post');
  });

  test('src/js/app.js wires Copy Link: a click copies the page URL', async () => {
    const APP = fs.readFileSync(path.join(ROOT, 'src', 'js', 'attribution.js'), 'utf8') + '\n;\n'
      + fs.readFileSync(path.join(ROOT, 'src', 'js', 'app.js'), 'utf8');
    const copied = [];
    const dom = new JSDOM(html, {
      url: 'https://www.thewayagency.com/blog/test-guarded-post',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      beforeParse(w) {
        w.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ chatEnabled: false }) });
        w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
        w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
        w.scrollTo = () => {};
        Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: (t) => { copied.push(t); return Promise.resolve(); } }, configurable: true });
      },
    });
    const w = dom.window;
    try {
      w.eval(APP);
      await new Promise((r) => setTimeout(r, 20));
      const btn = w.document.querySelector('[data-copy-link]');
      btn.click();
      await new Promise((r) => setTimeout(r, 0));
      assert.deepEqual(copied, ['https://www.thewayagency.com/blog/test-guarded-post']);
      assert.equal(btn.textContent, 'Copied!');
    } finally {
      w.close();
    }
  });
});

describe('blogHtmlProblems: what it refuses (criterion 4: validate-build fails on these)', () => {
  const refuses = (html, re) => {
    const got = blogHtmlProblems(html, 'blog/fixture.html');
    assert.ok(got.some((p) => re.test(p)), `expected ${re} in ${JSON.stringify(got)} for ${html}`);
  };
  test('a javascript: href', () => refuses('<p><a href="javascript:alert(1)">x</a></p>', /javascript: URL|"javascript:" in the page/));
  test('an injected event-handler attribute', () => refuses('<p><a href="" onmouseover="a">x</a></p>', /event-handler attribute onmouseover=/));
  test('handlers a text search would miss', () => {
    for (const html of ['<a/onclick=x>y</a>', '<a\nonclick="x">y</a>', '<img src=x ONERROR=y>', '<a title="a>b" onclick="x">y</a>', '<svg><animate onbegin=x /></svg>', '<a href=/x onclick=y>z</a>']) {
      refuses(html, /event-handler attribute on[a-z]+=/);
    }
  });
  test('script URLs however they are spelled', () => {
    for (const html of [
      '<a href="&#106;avascript:alert(1)">x</a>', '<a href="&#x6A;avascript:alert(1)">x</a>', '<a href="java&#x09;script:alert(1)">x</a>',
      '<a href="javascript&colon;alert(1)">x</a>', '<a href=" JAVASCRIPT:alert(1)">x</a>', '<iframe src="vbscript:x"></iframe>', '<form action="java\nscript:x"></form>',
    ]) {
      refuses(html, /(javascript|vbscript): URL|"javascript:" in the page/);
    }
  });
  test('a data: URL as a link or form target', () => {
    refuses('<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>', /data: URL/);
    refuses('<button formaction="data:text/html,x">x</button>', /data: URL/);
  });
  test('"javascript:" anywhere in the page, inline script included', () => {
    refuses('<script>location = "javascript:alert(1)";</script>', /"javascript:" in the page/);
  });
});

describe('blogHtmlProblems: what it leaves alone', () => {
  test('neutralized text: escaped attribute values, script and style bodies, comments and prose', () => {
    for (const html of [
      '<img alt="a&quot; onerror=&quot;alert(1)" src="/x.jpg">',
      '<meta name="description" content="Turn on=the lights">',
      '<script type="application/ld+json">{"a":"\\u003ca onclick=x\\u003e"}</script>',
      '<script>if (a<b && c) { d.onload = e; }</script>',
      '<style>a<b{}</style>',
      '<!-- <a onclick=x> -->',
      '<p>Click on the link; it is on=time.</p>',
      '<img src="data:image/png;base64,iVBORw0KGgo=" alt="">',
      '<a href="https://twitter.com/intent/tweet?text=x&amp;url=https://www.thewayagency.com/blog/x">s</a>',
      '<a href="tel:+15025550100">c</a><a href="sms:+15025550100">t</a><a href="mailto:zz.test@example.com">e</a>',
      '<button type="button" data-copy-link="https://www.thewayagency.com/blog/x">Copy Link</button>',
    ]) {
      assert.deepEqual(blogHtmlProblems(html, 'blog/fixture.html'), [], html);
    }
  });
});

describe('the guard is wired where a deploy is decided', () => {
  const src = (f) => fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf8');
  test('build.js (Cloudflare Pages runs it; SAGE publish pushes skip CI) throws on any problem, after the entity schema guard', () => {
    const build = src('build.js');
    assert.match(build, /require\('\.\/lib\/blog-html-guard'\)/);
    assert.match(build, /blogProblems\.push\(\.\.\.blogHtmlProblems\(fs\.readFileSync\(path\.join\(blogDir, name\), 'utf8'\), `blog\/\$\{name\}`\)\)/);
    assert.match(build, /throw new Error\(`Blog HTML guard failed/);
    assert.ok(build.indexOf('Blog HTML guard failed') > build.indexOf('Entity schema guard failed'));
  });
  test('validate-build.js (CI) reports every problem as an error, and fails when it finds no blog page', () => {
    const vb = src('validate-build.js');
    assert.match(vb, /for \(const p of blogHtmlProblems\(fs\.readFileSync\(path\.join\(blogDir, name\), 'utf8'\), `blog\/\$\{name\}`\)\) \{ error\(/);
    assert.match(vb, /if \(blogPages === 0\) error\(/);
  });
  test('the guard requires nothing (CI safe-build runs without npm ci)', () => {
    assert.deepEqual(src('lib/blog-html-guard.js').match(/require\(['"][^'"]+['"]\)/g), null);
  });
  test('the page template has no inline handler left to allowlist', () => {
    assert.doesNotMatch(src('generate-blog.js'), /\son[a-z]+="/);
  });
});
