/**
 * scripts/lib/site-urls.js and scripts/lib/url-hygiene.js (url-hygiene spec
 * 3.1, 3.9): the URL helper, the _redirects checker (TECH-07) and the feed
 * checker (TECH-05), on fixtures only.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { pagePath, pageUrl, routeOfFile, SITE_ORIGIN } = require('../scripts/lib/site-urls');
const { isHtmlFileUrl, redirectProblems, parseRedirects, feedProblems } = require('../scripts/lib/url-hygiene');

describe('site-urls', () => {
  test('pagePath drops .html and /index.html and keeps the rest', () => {
    for (const [input, want] of [
      ['/personal/auto.html', '/personal/auto'],
      ['/about/team.html#test-member', '/about/team#test-member'],
      ['/blog/index.html', '/blog/'],
      ['/index.html', '/'],
      ['/personal/home.html?a=1&amp;b=2', '/personal/home?a=1&amp;b=2'],
    ]) assert.equal(pagePath(input), want, input);
    for (const same of ['/personal/', '/contact', '/src/css/base.css?v=1', 'https://example.com/x.html', '//evil.example/x.html', 'tel:+15024135335', '#faq']) {
      assert.equal(pagePath(same), same, same);
    }
    assert.equal(pagePath(pagePath('/a/b.html')), '/a/b');
  });
  test('pageUrl and routeOfFile', () => {
    assert.equal(pageUrl('/contact.html'), `${SITE_ORIGIN}/contact`);
    assert.equal(pageUrl(`${SITE_ORIGIN}/blog/index.html`), `${SITE_ORIGIN}/blog/`);
    assert.equal(pageUrl(SITE_ORIGIN), SITE_ORIGIN);
    assert.equal(pageUrl('https://example.com/x.html'), 'https://example.com/x.html');
    assert.equal(routeOfFile('about/team.html'), '/about/team');
    assert.equal(routeOfFile('blog/index.html'), '/blog/');
    assert.equal(routeOfFile('index.html'), '/');
  });
  test('isHtmlFileUrl', () => {
    assert.ok(isHtmlFileUrl('/a/b.html'));
    assert.ok(isHtmlFileUrl('/a/index.html?x=1'));
    assert.ok(isHtmlFileUrl(`${SITE_ORIGIN}/a.html#f`));
    assert.ok(!isHtmlFileUrl('/a/b'));
    assert.ok(!isHtmlFileUrl('/src/x.html'));
    assert.ok(!isHtmlFileUrl('https://example.com/a.html'));
  });
});

describe('redirectProblems (TECH-07)', () => {
  const routes = new Set(['/', '/b', '/life/', '/health/medicaid', '/insurance/louisville-ky', '/intake/', '/contact']);
  const files = new Set(['intake/index.html', 'b.html']);
  const one = (text, r = routes, f = files) => redirectProblems(text, r, f);

  test('flags a .html and an /index.html destination', () => {
    assert.match(one('/a /b.html 301').join('\n'), /names a \.html file/);
    assert.match(one('/a /life/index.html 301').join('\n'), /names a \.html file/);
  });
  test('flags a host rule and the undocumented 301! status', () => {
    const p = one('https://thewayagency.com/* https://www.thewayagency.com/:splat 301!');
    assert.equal(p.length, 1);
    assert.match(p[0], /cannot match a host/);
    assert.match(one('/a /b 301!').join('\n'), /not one Pages supports/);
  });
  test('flags a static rule below a splat that matches it first', () => {
    const p = one('/life-health/* /life/ 301\n/life-health/medicaid /health/medicaid 301');
    assert.equal(p.length, 1);
    assert.match(p[0], /_redirects:2 .*unreachable, line 1/);
  });
  test('flags a self-redirect, a multi-hop chain and a destination that is not a built page', () => {
    assert.match(one('/x /x 301').join('\n'), /redirects to itself/);
    const chain = one('/old /older 301\n/older /b 301');
    assert.equal(chain.length, 1);
    assert.match(chain[0], /_redirects:1 .*multi-hop/);
    assert.match(one('/a /life 301').join('\n'), /not a page the build serves.*308s it to \/life\//);
    assert.match(one('/a /nowhere 301').join('\n'), /not a page the build serves/);
  });
  test('flags a 200 rewrite to a file the build does not have', () => {
    assert.match(one('/portal/* /portal/index.html 200').join('\n'), /rewrite target is not a built file/);
  });
  test('accepts the rewrites, a query destination and a mid-pattern splat', () => {
    assert.deepEqual(one([
      '/intake/* /intake/index.html 200',
      '/quote /intake/?agent=test-agent 301',
      '/locations/*-louisville-ky /insurance/louisville-ky 301',
      '/home / 301',
      '/contact-us /contact 301',
      '/life-health/medicaid /health/medicaid 301',
      '/life-health/* /life/ 301',
    ].join('\n')), []);
  });
  test('a missing status is 302, as Pages applies it', () => {
    assert.equal(parseRedirects('/a /b')[0].status, 302);
    assert.deepEqual(one('/a /b'), []);
  });
});

describe('feedProblems (TECH-05)', () => {
  const item = (slug, date, { link, guid, perma = false } = {}) => `<item><title>t</title>
    <link>${link || `${SITE_ORIGIN}/blog/${slug}`}</link>
    <guid${perma ? '' : ' isPermaLink="false"'}>${guid || `${SITE_ORIGIN}/blog/${slug}.html`}</guid>
    <pubDate>${new Date(date + 'T12:00:00Z').toUTCString()}</pubDate></item>`;
  const feed = (...items) => `<rss><channel>${items.join('')}</channel></rss>`;
  const routes = new Set(['/blog/test-a', '/blog/test-b', '/blog/test-c']);

  test('accepts newest first, extensionless links, old .html guids with isPermaLink="false"', () => {
    assert.deepEqual(feedProblems(feed(item('test-b', '2026-01-03'), item('test-a', '2026-01-02')), { routes, expectedSlugs: ['test-b', 'test-a'] }), []);
  });
  test('flags increasing pubDates (a deliberately mis-ordered feed)', () => {
    assert.match(feedProblems(feed(item('test-a', '2026-01-02'), item('test-b', '2026-01-03')), { routes }).join('\n'), /newest first/);
  });
  test('flags a .html <link> and a permalink guid that differs from the link', () => {
    assert.match(feedProblems(feed(item('test-a', '2026-01-02', { link: `${SITE_ORIGIN}/blog/test-a.html` })), { routes }).join('\n'), /names a \.html file/);
    assert.match(feedProblems(feed(item('test-a', '2026-01-02', { perma: true })), { routes }).join('\n'), /permalink <guid>/);
  });
  test('flags a feed that is not the expected newest posts, and more than 20 items', () => {
    assert.match(feedProblems(feed(item('test-a', '2026-01-02')), { routes, expectedSlugs: ['test-c', 'test-a'] }).join('\n'), /expected the 2 newest/);
    const many = Array.from({ length: 21 }, () => item('test-a', '2026-01-02'));
    assert.match(feedProblems(feed(...many)).join('\n'), /21 items/);
  });
});
