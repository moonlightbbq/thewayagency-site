/**
 * Extensionless internal links and the link-structure gates (LOCAL-01, TECH-01,
 * BLOG-03; priority-hubs section 4). The one URL helper is
 * scripts/lib/site-urls.js canonicalHref (never a second canonical-href.js).
 * The gates run against small synthetic builds in os.tmpdir(); nothing here
 * reads or writes build/.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { canonicalHref } = require('../scripts/lib/site-urls');
const { markdownToHtml } = require('../scripts/generate-blog');
const { internalLinkProblems } = require('../scripts/lib/internal-links-check');
const { readSite, breadcrumbProblems, htmlHubLinkProblems, clickDepthProblems, DEPTH_LIMITS } = require('../scripts/lib/link-structure-check');

describe('canonicalHref (scripts/lib/site-urls.js)', () => {
  test('content links lose .html and /index.html, keeping query and fragment', () => {
    assert.equal(canonicalHref('/insurance/owensboro-ky.html'), '/insurance/owensboro-ky');
    assert.equal(canonicalHref('/insurance/owensboro-ky.html#auto'), '/insurance/owensboro-ky#auto');
    assert.equal(canonicalHref('/blog/index.html'), '/blog/');
    assert.equal(canonicalHref('/contact.html'), '/contact');
    assert.equal(canonicalHref('/industries/roofing-contractors.html'), '/industries/roofing-contractors');
  });
  test('anything that is not a site-relative path comes back unchanged', () => {
    for (const s of ['/intake/?product=home', 'https://www.thewayagency.com/x.html', 'tel:+15024135335', 'sms:+15024135335', '#faq', '//cdn.example/x.html', 'mailto:zz.privacycheck@example.com']) {
      assert.equal(canonicalHref(s), s, s);
    }
  });
  test('blog markdown links render extensionless; the markdown text is not changed', () => {
    const md = 'See our [Owensboro page](/insurance/owensboro-ky.html#auto) and [home insurance](/personal/home.html).';
    const html = markdownToHtml(md);
    assert.match(html, /<a href="\/insurance\/owensboro-ky#auto">Owensboro page<\/a>/);
    assert.match(html, /<a href="\/personal\/home">home insurance<\/a>/);
    assert.match(markdownToHtml('[x](https://example.com/a.html)'), /href="https:\/\/example\.com\/a\.html"/);
    assert.match(markdownToHtml('[x](javascript:alert(1))'), /href="#"/);
  });
});

describe('internal-link data is consistent (scripts/lib/internal-links-check.js)', () => {
  test('the repository data passes', () => {
    assert.deepEqual(internalLinkProblems(ROOT), []);
  });

  function fixtureRoot(mutate) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twa-links-'));
    fs.mkdirSync(path.join(dir, 'data'));
    fs.mkdirSync(path.join(dir, 'src', 'blog'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src', 'pages', 'blog'), { recursive: true });
    const data = {
      'landing-pages.json': { cities: [{ slug: 'owensboro-ky', city: 'Owensboro', state: 'KY', context_sections: [{ heading: 'Auto insurance', body: '' }] }], counties: [{ slug: 'daviess-county-ky', county_name: 'Daviess County', state: 'KY', context_sections: [] }], industries: [{ slug: 'restaurants', name: 'Restaurants' }] },
      'internal-links.json': { guides: { '/personal/auto': [{ slug: 'good-post', anchor: 'A good post' }] }, nearby: { 'owensboro-ky': ['daviess-county-ky'] }, related_industries: { gl: ['restaurants'] }, blocked_guides: { 'held-post': 'BLOG-02' } },
      'locations.json': { hub_tiers: { 'owensboro-ky': 'priority' } },
      'products.json': { commercial: [{ id: 'gl' }] },
    };
    mutate(data);
    for (const [f, v] of Object.entries(data)) fs.writeFileSync(path.join(dir, 'data', f), JSON.stringify(v));
    fs.writeFileSync(path.join(dir, 'src', 'blog', 'good-post.md'), '---\ntitle: x\n---\n');
    fs.writeFileSync(path.join(dir, 'src', 'blog', 'held-post.md'), '---\ntitle: x\n---\n');
    fs.writeFileSync(path.join(dir, '_redirects'), '/blog/retired-post /blog/good-post 301\n');
    fs.writeFileSync(path.join(dir, 'src', 'blog', 'retired-post.md'), '---\ntitle: x\n---\n');
    return dir;
  }
  test('the fixture itself is clean', () => {
    assert.deepEqual(internalLinkProblems(fixtureRoot(() => {})), []);
  });
  test('each rule fails on its defect', () => {
    const cases = [
      [(d) => { d['internal-links.json'].guides['/personal/auto'].push({ slug: 'held-post', anchor: 'Held' }); }, /blocked/],
      [(d) => { d['internal-links.json'].guides['/personal/auto'].push({ slug: 'retired-post', anchor: 'Retired' }); }, /retired/],
      [(d) => { d['internal-links.json'].guides['/personal/auto'].push({ slug: 'no-such-post', anchor: 'Missing' }); }, /no source file/],
      [(d) => { d['internal-links.json'].guides['/personal/auto'].push({ slug: 'good-post', anchor: 'click here' }); }, /descriptive anchor/],
      [(d) => { d['internal-links.json'].guides['/personal/auto.html'] = []; }, /extensionless/],
      [(d) => { d['internal-links.json'].guides['/health/medicare'] = [{ slug: 'medicare-open-enrollment-2027', anchor: 'OEP' }]; }, /Medicare/],
      [(d) => { d['internal-links.json'].nearby['owensboro-ky'].push('atlantis-ky'); }, /not a hub/],
      [(d) => { d['internal-links.json'].related_industries.gl.push('bakeries'); }, /not an industry/],
      [(d) => { d['locations.json'].hub_tiers['owensboro-ky'] = 'top'; }, /not priority, secondary or tertiary/],
      [(d) => { d['landing-pages.json'].cities[0].tier = 'priority'; }, /hub_tiers only/],
      [(d) => { d['landing-pages.json'].cities[0].context_sections.push({ heading: 'Auto again', body: '' }); }, /duplicate context_sections/],
      [(d) => { d['landing-pages.json'].counties[0].context = 'See <a href="/insurance/owensboro-ky.html">the page</a>'; }, /\.html form/],
      [(d) => { d['landing-pages.json'].counties[0].context = 'See <a href="/insurance/owensboro-ky#homeowners">homes</a>'; }, /no section with that id/],
    ];
    for (const [mutate, want] of cases) {
      const problems = internalLinkProblems(fixtureRoot(mutate));
      assert.ok(problems.some((p) => want.test(p)), `expected ${want} in ${JSON.stringify(problems)}`);
    }
  });
});

describe('link-structure gates (scripts/lib/link-structure-check.js, validate-build.js check 13)', () => {
  const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
  const trail = (...items) => ld({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map((item, i) => ({ '@type': 'ListItem', position: i + 1, name: String(i), ...(item ? { item } : {}) })) });
  const O = 'https://www.thewayagency.com';
  function site(pages) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twa-build-'));
    for (const [rel, html] of Object.entries(pages)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), html);
    }
    return readSite(dir);
  }
  const good = () => ({
    'index.html': '<a href="/insurance/owensboro-ky">O</a><a href="/insurance/mt-washington-ky">M</a><a href="/about/locations">L</a><a href="/commercial/">C</a>',
    'about/locations.html': '<a href="/insurance/daviess-county-ky">D</a><a href="/insurance/shepherdsville-ky">S</a>',
    'commercial/index.html': '<a href="/industries/">I</a>',
    'industries/index.html': `<a href="/industries/roofing-contractors">R</a>${trail(O + '/', O + '/commercial/', null)}`,
    'industries/roofing-contractors.html': trail(O + '/', O + '/commercial/', O + '/industries/', null),
    'insurance/owensboro-ky.html': trail(O + '/', O + '/about/locations', null),
    'insurance/mt-washington-ky.html': '',
    'insurance/daviess-county-ky.html': '',
    'insurance/shepherdsville-ky.html': '',
  });
  test('a clean site passes every gate', () => {
    const s = site(good());
    assert.deepEqual(breadcrumbProblems(s), []);
    assert.deepEqual(htmlHubLinkProblems(s), []);
    assert.deepEqual(clickDepthProblems(s), []);
  });
  test('two trails, a dead parent and a .html item each fail', () => {
    const p = good();
    p['insurance/owensboro-ky.html'] += trail(O + '/', O + '/insurance/', null);
    p['insurance/mt-washington-ky.html'] = trail(O + '/', O + '/insurance/mt-washington-ky.html');
    const problems = breadcrumbProblems(site(p));
    assert.ok(problems.some((x) => /owensboro-ky\.html: 2 BreadcrumbList/.test(x)), problems.join('\n'));
    assert.ok(problems.some((x) => /\/insurance\/ is not a built page/.test(x)), problems.join('\n'));
    assert.ok(problems.some((x) => /mt-washington-ky\.html ends in \.html/.test(x)), problems.join('\n'));
  });
  test('an internal link to a hub .html URL fails', () => {
    const p = good();
    p['about/locations.html'] += '<a href="/insurance/owensboro-ky.html">O</a>';
    assert.equal(htmlHubLinkProblems(site(p)).length, 1);
  });
  test('click depth over the limit and an orphaned hub fail', () => {
    const p = good();
    p['index.html'] = '<a href="/about/locations">L</a><a href="/commercial/">C</a>';
    p['about/locations.html'] = '<a href="/insurance/owensboro-ky">O</a><a href="/insurance/mt-washington-ky">M</a><a href="/insurance/shepherdsville-ky">S</a>';
    const problems = clickDepthProblems(site(p));
    assert.ok(problems.includes('/insurance/owensboro-ky: click depth 2 (max 1)'), problems.join('\n'));
    assert.ok(problems.includes('/insurance/daviess-county-ky: orphaned (no link path from the homepage)'), problems.join('\n'));
    assert.equal(DEPTH_LIMITS['/insurance/shepherdsville-ky'], 2);
  });
});
