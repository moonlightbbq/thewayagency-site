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
 *      "javascript:", no event-handler or srcdoc attribute, no script URL, and
 *      no script, iframe, object, embed, form (and the like) inside the post's
 *      <article>. The page template carries no inline handler of its own (the
 *      Copy Link button is wired by src/js/app.js), so the guard needs no
 *      exceptions. Inside a post (its <article>, or a page with no
 *      <article>) only the elements the generator puts there are allowed and
 *      no comment, so the guard reads the post as a browser does: every
 *      payload from both BL-54 reviews is here, checked against jsdom with
 *      scripting off and on, and whatever jsdom would run from a post, the
 *      guard refuses (it may also refuse markup a browser shows as text: it
 *      fails closed). Inside the post attributes are allowlisted too, so no
 *      site script can be turned on it through a data-* attribute (the third
 *      review's testimonial gadget; src/js/app.js no longer writes that JSON
 *      as HTML either). Outside the post, in the template, its two readings
 *      are a backstop, not a proof;
 *   3. blog-content-guard.js refuses a post whose text says "javascript:"
 *      (SAGE before it commits, the site before it renders), and the same text
 *      in a calendar entry or backlog candidate (the content queue does not
 *      schedule it, the data check reports it, the renderer does not render
 *      its post), so neither a post nor a calendar topic can halt every
 *      deploy through the build guard's page-wide rule.
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
const { blogHtmlProblems, startTags, POST_ELEMENTS, POST_ATTRIBUTES } = require('../scripts/lib/blog-html-guard');
const contentGuard = require('../scripts/lib/blog-content-guard');
const queue = require('../scripts/lib/content-queue');
const os = require('os');
const { spawnSync } = require('child_process');

/**
 * What jsdom would run in `html` (the BL-54 reviewers' probes, probe2.js):
 * event-handler attributes, script URLs in URL attributes, srcdoc, inline
 * script text (SVG too), active elements in the body, and any alert a script
 * actually ran. scripting: parse with the scripting flag on (jsdom runScripts
 * 'dangerously', in its sandbox with a silent console and no resource
 * loading), which is when <noscript> content is text.
 */
function jsdomDanger(html, { scripting = false } = {}) {
  const { VirtualConsole } = require('jsdom');
  const ran = [];
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}<p>tail</p></body></html>`, {
    url: 'https://www.thewayagency.com/blog/test-probe',
    virtualConsole: new VirtualConsole(),
    ...(scripting ? { runScripts: 'dangerously', beforeParse(w) { w.alert = (x) => ran.push(`alert ${x}`); } } : {}),
  });
  const out = [];
  try {
    for (const el of dom.window.document.querySelectorAll('*')) {
      for (const a of el.attributes) {
        if (/^on/i.test(a.name)) out.push(`${el.localName}[${a.name}]`);
        if (/^(href|src|action|formaction|xlink:href|data|srcset|poster|background|ping|cite|codebase|manifest|icon)$/i.test(a.name)) {
          let p;
          try { p = new URL(a.value.trim(), 'https://www.thewayagency.com/').protocol; } catch { p = '?'; }
          if (p === 'javascript:' || p === 'vbscript:') out.push(`${el.localName}[${a.name}]=${p}`);
        }
        if (a.name === 'srcdoc') out.push(`${el.localName}[srcdoc]`);
      }
      if (el.localName === 'script' && el.textContent.trim()) out.push(`${el.namespaceURI.includes('svg') ? 'svg ' : ''}inline <script>: ${el.textContent.trim().slice(0, 30)}`);
      if (['iframe', 'frame', 'object', 'embed', 'base', 'link', 'meta', 'form', 'portal', 'applet'].includes(el.localName) && el.closest('body')) out.push(`<${el.localName}> in body`);
    }
  } finally {
    dom.window.close();
  }
  return [...out, ...ran];
}

// A built blog page's shape: the template's own head and scripts outside the
// post's <article>, the post inside it.
const pageWith = (inArticle) => `<!DOCTYPE html><html lang="en"><head><title>SYNTHETIC | The Way Agency</title><meta name="description" content="SYNTHETIC"><link rel="stylesheet" href="/src/css/base.css"><script type="application/ld+json">{"@type":"Article"}</script><script>(function(){var t=1;if(t<2){window.dataLayer=[];}})();</script></head><body><noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-TEST" height="0" width="0"></iframe></noscript><main id="main"><article class="product-content blog-content">${inArticle}</article></main><script src="/src/js/app.js" defer></script></body></html>`;

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

// The BL-54 review's probes (probe-guard.js, probe-noscript.js), verbatim.
const REVIEW_PAYLOADS = [
  '<!--><img src=x onerror=alert(1)><p>a --> b</p>',
  '<!---><img src=x onerror=alert(1)>',
  '<!-- a --!><img src=x onerror=alert(1)>',
  '<svg><title><img src=x onerror=alert(1)></title></svg>',
  '<svg><style><img src=x onerror=alert(1)></style></svg>',
  '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
  '<script>alert(document.cookie)</script>',
  '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>',
  '<object data="javascript:alert(1)"></object>',
  '<embed src="data:text/html,x">',
  '<a href="jav&#x0A;ascript:alert(1)">x</a>',
  '<a href="&#0000106avascript:alert(1)">x</a>',
  '<a href="&Tab;javascript:alert(1)">x</a>',
  '<a href="j&NewLine;avascript:alert(1)">x</a>',
  '<img src=x onerror=alert(1)//>',
  '<a href=x/onclick=alert(1)>',
  '<a href="x"onclick="alert(1)">y</a>',
  '<textarea><img src=x onerror=alert(1)></textarea>',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
  '<title><img src=x onerror=alert(1)></title>',
  '<xmp><img src=x onerror=alert(1)></xmp>',
  '<a href="java\u0001script:alert(1)">x</a>',
];
// probe-md.js: link targets through the markdown renderer.
const REVIEW_TARGETS = [
  'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', ' javascript:alert(1)', '\x01javascript:alert(1)',
  '\x00javascript:alert(1)', '\u00a0javascript:alert(1)', '\u200bjavascript:alert(1)', '\ufeffjavascript:alert(1)', '\u2028javascript:alert(1)',
  'java&#x09;script:alert(1)', '&#106;avascript:alert(1)', 'javascript&colon;alert(1)', 'javascript%3Aalert(1)',
  'data:text/html,<script>alert(1)</script>', 'vbscript:x', '//evil.example/x', '\\\\evil.example/x', '/\\evil.example/x',
  'https://ok.example/" onclick="x', "https://ok.example/' onclick='x", 'https://ok.example/x "title"', "https://ok.example/x 'title'",
  'https://ok.example/*a*b', 'https://ok.example/**a**', 'https:javascript:alert(1)', 'http:/\\/evil', 'HTTPS://OK.example',
  'mailto:a@b.example?subject=x&body=y', 'tel:+1502', 'sms:+1502?&body=hi', 'blob:https://x', 'filesystem:x', 'jar:x',
  'intent://x#Intent;scheme=javascript;end', 'x-javascript:alert(1)', 'javascript:', 'javas\u0000cript:alert(1)',
  'ja\u212avascript:x', // U+212A KELVIN SIGN
];

// The second BL-54 review's payloads (bl54r2/cases2.js), verbatim: raw-text and
// comment desyncs inside foreign content, entity spellings, odd tag shapes.
const REVIEW2_PAYLOADS = [
  // requested
  '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
  '<svg><noscript><img src=x onerror=alert(1)></noscript></svg>',
  '<svg><noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript></svg>',
  '<noscript><svg><noscript><img src=x onerror=alert(1)></noscript></svg></noscript>',
  '<a href=" jav&#x09;ascript:alert(1)">x</a>',
  '<img srcset="javascript:alert(1) 1x">',
  '<svg><a xlink:href=javascript:alert(1)><text>x</text></a></svg>',
  '<svg><a href=javascript:alert(1)><text>x</text></a></svg>',
  '<iframe src="https://evil.example/"></iframe>',
  '<p style="background:url(javascript:alert(1))">x</p>',
  '<p style="width:expression(alert(1))">x</p>',
  '<link rel=import href="https://evil.example/x.html">',
  '<base href="https://evil.example/">',
  // desync: R2 enters raw text at a foreign element; R1 enters a comment inside a real HTML raw-text element
  '<svg><title><textarea><!--</textarea><img src=x onerror=alert(1)></title>-->',
  '<svg><style><p><textarea><!--</textarea><img src=x onerror=alert(1)></style>-->',
  '<svg><noscript><p><textarea><!--</textarea><img src=x onerror=alert(1)></noscript>-->',
  '<svg><plaintext><p><textarea><!--</textarea><img src=x onerror=alert(1)>-->',
  '<svg><title><textarea><a title="</textarea><img src=x onerror=alert(1)>"></title>',
  '<svg><title><style><!--</style><img src=x onerror=alert(1)></title>-->',
  '<svg><title><noscript><!--</noscript><img src=x onerror=alert(1)></title>-->',
  '<svg><title><textarea><!--</textarea><script>alert(1)</script></title>-->',
  '<svg><title><textarea><!--</textarea><iframe srcdoc="<script>alert(1)</script>"></iframe></title>-->',
  '<svg><desc><textarea><!--</textarea><img src=x onerror=alert(1)></desc>--></svg>',
  '<math><mtext><textarea><!--</textarea><img src=x onerror=alert(1)>--></mtext></math>',
  '<svg><iframe><p><textarea><!--</textarea><img src=x onerror=alert(1)></iframe>-->',
  '<svg><xmp><p><textarea><!--</textarea><img src=x onerror=alert(1)></xmp>-->',
  '<svg><script><p><textarea><!--</textarea><img src=x onerror=alert(1)></script>-->',
  // CDATA in foreign content
  '<svg><![CDATA[><img src=x onerror=alert(1)>]]></svg>',
  // misc
  '<svg><animate attributeName=href to=javascript:alert(1) /><a><text>x</text></a></svg>',
  '<svg><set attributeName=href to="javascript:alert(1)"/></svg>',
  '<a href="&#x6a;&#x61;&#x76;&#x61;&#x73;&#x63;&#x72;&#x69;&#x70;&#x74;&#x3a;alert(1)">x</a>',
  '<a href="javascript&#58alert(1)">x</a>',
  '<a href="&#106avascript:alert(1)">x</a>',
  '<a href="&#X6A;avascript:alert(1)">x</a>',
  '<a href="j&#97vascript&#x3A;alert(1)">x</a>',
  '<a href="&NewLine;&Tab;javascript&colon;alert(1)">x</a>',
  '<a href="jav&#x0D;ascript:alert(1)">x</a>',
  '<a href="\u000cjavascript:alert(1)">x</a>',
  '<a href="javascript&#0000058alert(1)">x</a>',
  '<a href="javas&#99;ript:alert(1)">x</a>',
  '<a href="jav&#x41;script:alert(1)">x</a>',
  '<a href="&#x0;javascript:alert(1)">x</a>',
  '<a href="&#0;javascript:alert(1)">x</a>',
  '<form><button formaction="javascript&colon;alert(1)">x</button></form>',
  '<object data="&#106;avascript:alert(1)"></object>',
  '<embed src="javascript&colon;alert(1)">',
  '<math href="javascript&colon;alert(1)"><mi>x</mi></math>',
  '<isindex action="javascript&colon;alert(1)">',
  '<a href="javascript&#x3a;alert(1)">x</a>',
  '<a href="jav&Tab;ascript&colon;alert(1)">x</a>',
  '<a href="jav&tab;ascript:alert(1)">x</a>',
  '<a href="&#x09;&#x0a;javascript:alert(1)">x</a>',
  '<a href="&#x1;javascript:alert(1)">x</a>',
  '<a href="&#x20;&#x0b;javascript:alert(1)">x</a>',
  '<a href="javascript&#58;alert(1)">x</a>',
  '<a href="javascript&#x3A&#x61;lert(1)">x</a>',
  '<a href="javascript&COLON;alert(1)">x</a>',
  '<a href="javascript&Colon;alert(1)">x</a>',
  '<a href="ja&#x76;ascript&#x3a;alert(1)">x</a>',
  // end tag attributes / weird tags
  '</p onclick=x><img src=x onerror=alert(1)>',
  '<img/src=x/onerror=alert(1)>',
  '<img src=x onerror\u000c=alert(1)>',
  '<img src=x\u000bonerror=alert(1)>',
  '<img src=x onerror=alert(1)>',
  '<img src="x"\u000conerror=alert(1)>',
  '<img src=x =onerror=alert(1)>',
  '<img src=x ="" onerror=alert(1)>',
  '<img src=x "onerror=alert(1)>',
  '<img src=x \'onerror=alert(1)>',
  '<img src=x <onerror=alert(1)>',
  '<img src=x onerror =alert(1)>',
  '<img \u0000onerror=alert(1) src=x>',
  '<img src=x on\u0000error=alert(1)>',
  '<a href="/"\u0000onclick=alert(1)>x</a>',
  // raw text closers with odd endings
  '<textarea></textarea\u000b><img src=x onerror=alert(1)>',
  '<title></title\u000c><img src=x onerror=alert(1)>',
  '<style></style\u000c><img src=x onerror=alert(1)>',
  '<textarea></TEXTAREA><img src=x onerror=alert(1)>',
  '<script>//</script\t><img src=x onerror=alert(1)>',
  // nested select/template contexts
  '<select><style><!--</style><img src=x onerror=alert(1)>-->',
  '<template><style><!--</style><img src=x onerror=alert(1)>--></template>',
  '<table><style><!--</style><img src=x onerror=alert(1)>-->',
  '<frameset onload=alert(1)>',
  '<body onload=alert(1)>',
  '<html onmouseover=alert(1)>',
  '<svg onload=alert(1)>',
  '<details open ontoggle=alert(1)>',
  '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  '<meta http-equiv="refresh" content="0;url=https://evil.example/">',
];

describe('the BL-54 review payloads, cross-checked against jsdom', () => {
  test('inside a post (its <article>, or a page with no <article>), whatever jsdom would run from a review payload, scripting off or on, the guard refuses', () => {
    for (const payload of [...REVIEW_PAYLOADS, ...REVIEW2_PAYLOADS]) {
      const danger = [...jsdomDanger(payload), ...jsdomDanger(payload, { scripting: true })];
      if (!danger.length) continue;
      assert.ok(blogHtmlProblems(pageWith(payload), 'blog/fixture.html').length > 0, `in a post, not refused: ${payload} (jsdom: ${danger.join(', ')})`);
      assert.ok(blogHtmlProblems(payload, 'fixture').length > 0, `bare, not refused: ${payload} (jsdom: ${danger.join(', ')})`);
    }
  });

  test('each review payload is refused (the ones jsdom shows as text fail closed), and none passes in a post', () => {
    for (const payload of REVIEW_PAYLOADS) {
      if (payload === '<a href=x/onclick=alert(1)>' || payload.includes('java\u0001script')) continue; // harmless: no attribute, no scheme (both readings agree with jsdom)
      assert.ok(blogHtmlProblems(pageWith(payload), 'blog/fixture.html').length > 0, payload);
    }
  });

  test('the comment forms end where the tokenizer ends them: <!-->, <!--->, --!>', () => {
    for (const payload of ['<!--><img src=x onerror=alert(1)>', '<!---><img src=x onerror=alert(1)>', '<!-- a --!><img src=x onerror=alert(1)>']) {
      assert.match(blogHtmlProblems(pageWith(payload), 'blog/fixture.html').join(' '), /<img> has an event-handler attribute onerror=/, payload);
    }
    // A comment is refused inside the post; in the template its content is not markup.
    assert.match(blogHtmlProblems(pageWith('<!-- <img src=x onerror=alert(1)> -->'), 'blog/fixture.html').join(' '), /a comment, DOCTYPE or CDATA inside the post's <article>/);
    assert.deepEqual(blogHtmlProblems(pageWith('<p>x</p>').replace('<main id="main">', '<!-- <img src=x onerror=alert(1)> --><main id="main">'), 'blog/fixture.html'), []);
  });

  test('<noscript> is read both ways: with scripting on, a "</noscript>" inside an attribute value ends it', () => {
    const payload = '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>';
    assert.deepEqual(jsdomDanger(payload), []);
    assert.deepEqual(jsdomDanger(payload, { scripting: true }), ['img[onerror]']);
    assert.match(blogHtmlProblems(pageWith(payload), 'blog/fixture.html').join(' '), /onerror=/);
  });

  test('inside the post only the generator\'s elements are allowed (POST_ELEMENTS); every other element, and any comment, is refused; srcdoc anywhere', () => {
    for (const tag of POST_ELEMENTS) assert.deepEqual(blogHtmlProblems(pageWith(`<${tag}></${tag}>`), 'blog/fixture.html'), [], tag);
    for (const tag of ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'portal', 'form', 'base', 'meta', 'link', 'style', 'title', 'textarea', 'noscript', 'xmp', 'plaintext', 'noembed', 'noframes', 'template', 'math', 'select', 'table', 'input', 'details', 'video', 'audio', 'source', 'isindex', 'desc', 'foreignobject', 'animate', 'set', 'use', 'image', 'text', 'body', 'html']) {
      assert.match(blogHtmlProblems(pageWith(`<${tag}></${tag}>`), 'blog/fixture.html').join(' '), new RegExp(`<${tag}> inside the post's <article>`), tag);
    }
    for (const c of ['<!-- x -->', '<!---->', '<!-->', '<![CDATA[x]]>', '<!x>', '<?x?>', '</ x>']) {
      assert.match(blogHtmlProblems(pageWith(`<p>a</p>${c}<p>b</p>`), 'blog/fixture.html').join(' '), /a comment, DOCTYPE or CDATA inside the post's <article>/, c);
    }
    assert.match(blogHtmlProblems(pageWith('<svg><script>alert(1)</script></svg>'), 'blog/fixture.html').join(' '), /<script> inside the post's <article>/);
    assert.match(blogHtmlProblems('<html><body><div srcdoc="x"></div></body></html>', 'blog/fixture.html').join(' '), /srcdoc/);
  });

  test('the second review\'s real page: a generated post carrying the desync payload is refused (jsdom runs its script)', () => {
    const body = markdownToHtml(`${Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')}\n\n## One\n\nText.`);
    for (const payload of [
      '<svg><title><textarea><!--</textarea><script>window.__ran=1</script></title>-->',
      '<svg><title><textarea><!--</textarea><img src=x onerror="window.__ran=2"></title>-->',
    ]) {
      const html = generateBlogPost({ title: 'SYNTHETIC', slug: 'test-x', description: 'SYNTHETIC', date: '2026-01-07' }, body + payload, []);
      const got = blogHtmlProblems(html, 'blog/test-x.html');
      assert.ok(got.some((p) => /<title> inside the post's <article>/.test(p)), JSON.stringify(got));
    }
  });

  test('every review link target renders with no handler, no extra attribute and an allowed scheme; a target whose text says "javascript:" is refused upstream', () => {
    const ALLOWED = new Set(['http:', 'https:', 'mailto:', 'tel:', 'sms:']);
    for (const t of REVIEW_TARGETS) {
      const html = markdownToHtml(`[x](${t})`);
      assert.deepEqual(jsdomDanger(html), [], JSON.stringify(t));
      const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
      for (const a of dom.window.document.querySelectorAll('a')) {
        assert.deepEqual([...a.attributes].map((x) => x.name), ['href'], JSON.stringify(t));
        assert.ok(ALLOWED.has(new URL(a.getAttribute('href'), 'https://www.thewayagency.com/blog/p').protocol), `${JSON.stringify(t)} -> ${a.getAttribute('href')}`);
      }
      dom.window.close();
      const post = `---\ntitle: SYNTHETIC\nslug: test-target\ndate: 2026-01-07\n---\n\n[x](${t})\n`;
      if (/javascript:/i.test(t)) {
        assert.match(String(contentGuard.frontMatterProblem(post)), /"javascript:"/, JSON.stringify(t));
      } else {
        assert.deepEqual(blogHtmlProblems(pageWith(html), 'blog/fixture.html'), [], JSON.stringify(t));
      }
    }
  });
});

describe('blog-content-guard.js: a post that says "javascript:" never reaches the build (NIT 2)', () => {
  test('refused in the body, in front matter, in any case; a post without it is not', () => {
    const post = (fm, body) => `---\ntitle: SYNTHETIC title\nslug: test-script-text\n${fm}date: 2026-01-07\n---\n\n${body}\n`;
    for (const md of [post('', 'See [x](https:javascript:alert(1)).'), post('', 'JavaScript: an aside.'), post('description: JAVASCRIPT: x\n', 'Body.'), `[x](\u2028javascript:alert(1))`]) {
      assert.match(String(contentGuard.frontMatterProblem(md)), /the post carries the text "javascript:"/, md);
    }
    assert.equal(contentGuard.frontMatterProblem(post('', 'See [the report](https://www.weather.gov/x) and Java scripts.')), null);
  });
});

describe('calendar topic text that says "javascript:" never reaches a built page (second review, NIT 1; calprobe.js)', () => {
  const TITLE = 'SYNTHETIC Phishing links: why "javascript:" in a link is a red flag';
  const candidate = (over = {}) => ({ slug: 'test-cal-a', title: 'SYNTHETIC title', primary_keyword: 'synthetic keyword', status: 'approved', seasonality_window: null, target_location_pages: [], ...over });

  test('scriptTextProblem reads every string of an entry or candidate', () => {
    assert.match(String(contentGuard.scriptTextProblem({ title: TITLE })), /"javascript:"/);
    assert.match(String(contentGuard.scriptTextProblem({ description: 'x', nested: { brief: ['JAVASCRIPT: y'] } })), /"javascript:"/);
    assert.equal(contentGuard.scriptTextProblem({ title: 'SYNTHETIC Do You Need Flood Insurance?' }), null);
  });

  test('the content queue does not schedule such a candidate (the site\'s fill-slots and SAGE\'s queue adapter both use it)', () => {
    const ctx = queue.buildSchedulingContext({ year1: [], slots: [], existing_posts: [] });
    for (const c of [candidate({ title: TITLE }), candidate({ description: 'see javascript:void(0)' })]) {
      const r = queue.scoreCandidate(c, '2026-08-12', ctx, {}, { hasMarkdown: () => false });
      assert.equal(r.eligible, false);
      assert.match(r.reasons.join(' '), /"javascript:"/);
    }
    assert.equal(queue.scoreCandidate(candidate(), '2026-08-12', ctx, {}, { hasMarkdown: () => false }).eligible, true);
    const cal = { year1: [], slots: [{ date: '2026-08-15', state: 'reserved', locked_slug: null, locked_at: null, reserved_at: '2026-08-01' }], existing_posts: [] };
    const backlog = { candidates: [candidate({ title: TITLE })] };
    const { locked } = queue.fillSlots(cal, backlog, '2026-08-01', {}, { hasMarkdown: () => false });
    assert.deepEqual(locked, []);
    assert.deepEqual(cal.year1, []);
  });

  test('check-data-integrity: an error in the calendar and for an approved candidate; a warning for a proposed, on-hold or rejected one (run on a temporary copy of data/)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl54-calendar-text-'));
    try {
      fs.cpSync(path.join(ROOT, 'data'), path.join(dir, 'data'), { recursive: true });
      fs.cpSync(path.join(ROOT, 'scripts', 'lib'), path.join(dir, 'scripts', 'lib'), { recursive: true });
      fs.copyFileSync(path.join(ROOT, 'scripts', 'check-data-integrity.js'), path.join(dir, 'scripts', 'check-data-integrity.js'));
      for (const d of ['src/blog', 'src/pages/blog']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
      const run = () => spawnSync(process.execPath, [path.join(dir, 'scripts', 'check-data-integrity.js')], { encoding: 'utf8' });
      assert.equal(run().status, 0, 'the repository data passes');
      const calPath = path.join(dir, 'data', 'content-calendar.json');
      const cal = JSON.parse(fs.readFileSync(calPath, 'utf8'));
      cal.year1 = [...(cal.year1 || []), { slug: 'test-cal-a', title: TITLE, description: 'SYNTHETIC d', publish_date: '2099-01-07', status: 'planned' }];
      fs.writeFileSync(calPath, `${JSON.stringify(cal, null, 2)}\n`);
      const bPath = path.join(dir, 'data', 'content-backlog.json');
      const b = JSON.parse(fs.readFileSync(bPath, 'utf8'));
      const realCandidates = b.candidates || [];
      b.candidates = [...realCandidates, ...['proposed', 'on-hold', 'rejected'].map((status) => candidate({ slug: `test-cal-${status}`, status, description: 'javascript: x' }))];
      fs.writeFileSync(bPath, `${JSON.stringify(b, null, 2)}\n`);
      // Only non-approved candidates: warnings, and the data check still passes.
      fs.writeFileSync(calPath, `${JSON.stringify({ ...cal, year1: cal.year1.filter((p) => p.slug !== 'test-cal-a') }, null, 2)}\n`);
      let r = run();
      assert.equal(r.status, 0, r.stdout);
      for (const status of ['proposed', 'on-hold', 'rejected']) {
        assert.match(r.stdout, new RegExp(`! content-backlog\\.json: "test-cal-${status}" \\(${status}\\) it carries the text "javascript:", which the site build refuses on any blog page; the queue will not schedule it and SAGE will not approve it`));
      }
      // An approved candidate and a calendar entry: errors.
      b.candidates = [...b.candidates, candidate({ slug: 'test-cal-approved', status: 'approved', description: 'javascript: x' })];
      fs.writeFileSync(bPath, `${JSON.stringify(b, null, 2)}\n`);
      fs.writeFileSync(calPath, `${JSON.stringify(cal, null, 2)}\n`);
      r = run();
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stdout, /✗ content-calendar\.json: "test-cal-a": it carries the text "javascript:"/);
      assert.match(r.stdout, /✗ content-backlog\.json: "test-cal-approved" is approved but it carries the text "javascript:"/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a post whose calendar entry carries it is not rendered, so the index and Related Articles never print it (calprobe.js)', () => {
    const { renderDecision } = require('../scripts/lib/review-credit');
    const md = '---\ntitle: SYNTHETIC\nslug: test-cal-a\ndate: 2026-01-07\n---\n\nbody\n';
    const d = renderDecision({ slug: 'test-cal-a', title: TITLE, status: 'published', publish_date: '2026-01-07' }, Buffer.from(md), [], {
      today: '2026-10-04', isKnownStatus: () => true, isPublishable: () => true, isHeld: () => false,
    });
    assert.equal(d.render, false);
    assert.match(d.why, /unsafe_calendar_text/);
  });
});

// The third BL-54 review's gadget payloads (bl54r3/gadget.js), verbatim:
// only allowlisted elements, but a data-* attribute a site script consumed.
const GADGET_PAYLOADS = [
  `<div data-testimonials='[{"text":"<img src=x onerror=window.__ran=1>"}]'></div>`,
  `<div data-testimonials="[{&quot;text&quot;:&quot;&lt;img src=x onerror=window.__ran=2&gt;&quot;}]"></div>`,
  `<div data-testimonials='[{"name":"<img src=x onerror=window.__ran=3>"}]' data-testimonial-mode="grid"></div>`,
  `<section data-testimonials='[{"text":"<svg><svg onload=window.__ran=4>"}]'></section>`,
  `<svg><a href="&#106;avascript:window.__ran=5"><path d="M0 0"/></a></svg>`,
  `<img src=x onerror=window.__ran=6>`,
];

describe('attributes inside the post are allowlisted (third review: site-script gadgets)', () => {
  test('every gadget payload is refused, in a post and in a generated page', () => {
    const body = markdownToHtml(`${Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')}\n\n## One\n\nText.`);
    GADGET_PAYLOADS.forEach((payload, i) => {
      assert.ok(blogHtmlProblems(pageWith(payload), 'blog/fixture.html').length > 0, payload);
      const html = generateBlogPost({ title: 'SYNTHETIC', slug: `test-p${i}`, description: 'SYNTHETIC', date: '2026-01-07' }, body + payload, []);
      assert.ok(blogHtmlProblems(html, `blog/test-p${i}.html`).length > 0, payload);
    });
    assert.match(blogHtmlProblems(pageWith(GADGET_PAYLOADS[0]), 'blog/fixture.html').join(' '), /<div data-testimonials> inside the post's <article>/);
  });

  test('the generator\'s attributes pass; any other attribute, every data-* but data-copy-link among them, is refused', () => {
    const all = POST_ATTRIBUTES.map((a) => `${a}="${a === 'href' ? '/x' : a === 'src' ? '/x.jpg' : 'x'}"`).join(' ');
    assert.deepEqual(blogHtmlProblems(pageWith(`<p ${all}>x</p>`), 'blog/fixture.html'), []);
    for (const attr of ['data-testimonials', 'data-testimonial-mode', 'data-field', 'data-x', 'srcset', 'title', 'formaction', 'ping', 'is', 'form', 'action', 'xlink:href', 'tabindex', 'hidden', 'popover', 'contenteditable', 'name', 'value']) {
      assert.ok(blogHtmlProblems(pageWith(`<p ${attr}="x">x</p>`), 'blog/fixture.html').includes(`blog/fixture.html: <p ${attr}> inside the post's <article>; the generator puts only ${POST_ATTRIBUTES.join(', ')} on elements in a post`), attr);
    }
  });
});

describe('src/js/app.js writes testimonial JSON as text, never as markup (third review: the sink)', () => {
  const APP = fs.readFileSync(path.join(ROOT, 'src', 'js', 'attribution.js'), 'utf8') + '\n;\n'
    + fs.readFileSync(path.join(ROOT, 'src', 'js', 'app.js'), 'utf8');
  async function run(markup) {
    const { VirtualConsole } = require('jsdom');
    const dom = new JSDOM(`<!doctype html><html><body>${markup}</body></html>`, {
      url: 'https://www.thewayagency.com/test-testimonials',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      virtualConsole: new VirtualConsole(),
      beforeParse(w) {
        w.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ chatEnabled: false }) });
        w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
        w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
        w.scrollTo = () => {};
      },
    });
    dom.window.eval(APP);
    await new Promise((r) => setTimeout(r, 20));
    return dom;
  }
  const handlers = (doc) => [...doc.querySelectorAll('*')].flatMap((el) => [...el.attributes].filter((a) => /^on/i.test(a.name)).map((a) => `${el.localName}[${a.name}]`));

  test('the review\'s payloads, in carousel, grid and single mode, make no element and no handler: the text shows as typed', async () => {
    for (const [payload, typed] of [
      [GADGET_PAYLOADS[0], '<img src=x onerror=window.__ran=1>'],
      [GADGET_PAYLOADS[1], '<img src=x onerror=window.__ran=2>'],
      [GADGET_PAYLOADS[2], '<img src=x onerror=window.__ran=3>'],
      [GADGET_PAYLOADS[3], '<svg><svg onload=window.__ran=4>'],
      [`<div data-testimonials='[{"text":"<img src=x onerror=window.__ran=7>","product_lines":["<img src=x onerror=window.__ran=8>"]}]' data-testimonial-mode="single"></div>`, '<img src=x onerror=window.__ran=7>'],
    ]) {
      const dom = await run(payload);
      try {
        const doc = dom.window.document;
        assert.deepEqual(handlers(doc), [], payload);
        assert.equal(doc.querySelectorAll('.twa-testimonial-card img, .twa-testimonial-card svg').length, 0, payload);
        assert.ok(doc.querySelector('.twa-testimonial-card'), `a card renders: ${payload}`);
        assert.ok(doc.querySelector('.twa-testimonial-card').textContent.includes(typed), payload);
      } finally {
        dom.window.close();
      }
    }
  });

  test('a real-shaped testimonial renders as before: stars, quoted text, name and product labels', async () => {
    const items = [{ text: 'SYNTHETIC They found us a better rate & kept our coverage.', name: 'Test Client A.', rating: 4, product_lines: ['auto', 'home_owners'] }];
    const dom = await run(`<div data-testimonials='${JSON.stringify(items).replace(/'/g, '&#39;')}' data-testimonial-mode="single"></div>`);
    try {
      const card = dom.window.document.querySelector('.twa-testimonial-card');
      assert.equal(card.querySelector('p').textContent, '"SYNTHETIC They found us a better rate & kept our coverage."');
      assert.equal(card.querySelector('span[style*="font-weight:600"]').textContent, 'Test Client A.');
      assert.equal(card.querySelector('span[style*="FBBC05"]').textContent, '★'.repeat(4));
      assert.deepEqual([...card.querySelectorAll('span[style*="eff6ff"]')].map((x) => x.textContent), ['Auto', 'Home owners']);
    } finally {
      dom.window.close();
    }
  });
});

describe('a post using every generator feature passes the guard (third review NIT 2)', () => {
  test('em, h4, hr, a stat highlight, callouts, a featured image, the FAQ, the table of contents, Related Coverage and the CTA', () => {
    const md = [
      `${Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')} with *emphasis* and **strong** text and [a link](/personal/home.html).`,
      '## First section', 'Text.', '#### A small heading', 'Text.',
      '---',
      '!!!stat 42% | of SYNTHETIC homes',
      '> **Key takeaway:** SYNTHETIC callout.',
      '> **Tip:** SYNTHETIC tip.',
      '- one\n- two',
      '1. first',
      '## Second section', 'Text.', '## Third section', 'Text.', '## Fourth section', 'Text.',
    ].join('\n\n');
    const html = generateBlogPost({
      title: 'SYNTHETIC every feature', slug: 'test-every-feature', description: 'SYNTHETIC', date: '2026-01-07',
      image: '/src/assets/images/blog/test-every-feature.jpg', image_alt: 'SYNTHETIC alt', related_page: '/personal/home.html', category: 'personal',
    }, markdownToHtml(md), [{ question: 'SYNTHETIC question?', answer: 'SYNTHETIC answer.' }]);
    for (const tag of ['em', 'h4', 'hr', 'blockquote', 'figure', 'img', 'nav', 'section', 'button', 'svg', 'strong', 'li']) assert.match(html, new RegExp(`<${tag}[ >]`), tag);
    assert.match(html, /stat-highlight/);
    assert.match(html, /fetchpriority="high"/);
    assert.deepEqual(blogHtmlProblems(html, 'blog/test-every-feature.html'), []);
  });
});

describe('blogHtmlProblems: what it leaves alone', () => {
  test('the template around a post: its head, its scripts, GTM\'s noscript iframe and a comment, all outside the <article>', () => {
    assert.deepEqual(blogHtmlProblems(pageWith('<p>SYNTHETIC body</p>'), 'blog/fixture.html'), []);
    assert.deepEqual(blogHtmlProblems(pageWith('<p>SYNTHETIC body</p>').replace('<main id="main">', '<!-- <a onclick=x> --><main id="main">'), 'blog/fixture.html'), []);
  });
  test('neutralized text inside the post: escaped attribute values, prose, comments, links the renderer allows', () => {
    for (const inArticle of [
      '<img alt="a&quot; onerror=&quot;alert(1)" src="/x.jpg">',
      '<p>Click on the link; it is on=time.</p>',
      '<img src="data:image/png;base64,iVBORw0KGgo=" alt="">',
      '<a href="https://twitter.com/intent/tweet?text=x&amp;url=https://www.thewayagency.com/blog/x">s</a>',
      '<a href="tel:+15025550100">c</a><a href="sms:+15025550100">t</a><a href="mailto:zz.test@example.com">e</a>',
      '<button type="button" data-copy-link="https://www.thewayagency.com/blog/x">Copy Link</button>',
      '<a href=x/onclick=alert(1)>y</a>',
      '<a href="java\u0001script:alert(1)">a control inside the word is no scheme</a>',
      '<svg width="14" height="14" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
    ]) {
      assert.deepEqual(blogHtmlProblems(pageWith(inArticle), 'blog/fixture.html'), [], inArticle);
      assert.deepEqual(jsdomDanger(inArticle), [], inArticle);
    }
  });
  test('the blog listing page (no post of its own) keeps its own filter script in <main>', () => {
    const listing = '<html><head><meta name="description" content="x"></head><body><main><div id="blogGrid"></div><script>(function(){var grid=document.getElementById("blogGrid");})();</script></main></body></html>';
    assert.deepEqual(blogHtmlProblems(listing, 'blog/index.html', { listing: true }), []);
    assert.ok(blogHtmlProblems(listing, 'blog/index.html').length > 0, 'without listing: true, a page with no <article> is checked whole');
  });
});

describe('the guard is wired where a deploy is decided', () => {
  const src = (f) => fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf8');
  test('build.js (Cloudflare Pages runs it; SAGE publish pushes skip CI) throws on any problem, after the entity schema guard', () => {
    const build = src('build.js');
    assert.match(build, /require\('\.\/lib\/blog-html-guard'\)/);
    assert.match(build, /blogProblems\.push\(\.\.\.blogHtmlProblems\(fs\.readFileSync\(path\.join\(blogDir, name\), 'utf8'\), `blog\/\$\{name\}`, \{ listing: name === 'index\.html' \}\)\)/);
    assert.match(build, /throw new Error\(`Blog HTML guard failed/);
    assert.ok(build.indexOf('Blog HTML guard failed') > build.indexOf('Entity schema guard failed'));
  });
  test('validate-build.js (CI) reports every problem as an error, and fails when it finds no blog page', () => {
    const vb = src('validate-build.js');
    assert.match(vb, /for \(const p of blogHtmlProblems\(fs\.readFileSync\(path\.join\(blogDir, name\), 'utf8'\), `blog\/\$\{name\}`, \{ listing: name === 'index\.html' \}\)\) \{ error\(/);
    assert.match(vb, /if \(blogPages === 0\) error\(/);
  });
  test('the guard requires nothing (CI safe-build runs without npm ci)', () => {
    assert.deepEqual(src('lib/blog-html-guard.js').match(/require\(['"][^'"]+['"]\)/g), null);
  });
  test('the page template has no inline handler left to allowlist', () => {
    assert.doesNotMatch(src('generate-blog.js'), /\son[a-z]+="/);
  });
});
