/**
 * scripts/builders/sitemap.js (TECH-04; url-hygiene spec 3.7 Step 1) over a
 * fixture build/ in a temp directory: indexable self-canonical pages only,
 * lastmod only where the page states a full date, no changefreq/priority,
 * byte-identical output across runs.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { generateSitemap, HELD_FOR_OWNER } = require('../scripts/builders/sitemap');
const { LEGACY_BLOG_PAGES } = require('../scripts/lib/legacy-blog-pages');

const O = 'https://www.thewayagency.com';
const LEGACY = Object.keys(LEGACY_BLOG_PAGES).find((f) => f !== 'index.html');

const page = (route, { robots = null, canonical = O + route, ld = null } = {}) => `<!doctype html><html><head><title>t</title>
${robots ? `<meta name="robots" content="${robots}">` : ''}
${canonical ? `<link rel="canonical" href="${canonical}">` : ''}
${ld ? `<script type="application/ld+json">${JSON.stringify(ld)}</script>` : ''}
</head><body><main>x</main></body></html>`;
const article = (published, modified) => ({ '@context': 'https://schema.org', '@type': 'Article', headline: 'SYNTHETIC', datePublished: published, dateModified: modified });

function fixture() {
  const build = fs.mkdtempSync(path.join(os.tmpdir(), 'sitemap-test-'));
  const files = {
    'index.html': page('/'),
    'about/team.html': page('/about/team'),
    'privacy.html': page('/privacy'),
    'blog/index.html': page('/blog/'),
    'blog/test-a.html': page('/blog/test-a', { ld: article('2026-02-01', '2026-02-03') }),
    'blog/test-b.html': page('/blog/test-b', { ld: { '@graph': [article('2026-01-10', '2026-01-10')] } }),
    'blog/test-partial.html': page('/blog/test-partial', { ld: article('2026-01', '2026-03') }),
    [`blog/${LEGACY}`]: page(`/blog/${LEGACY.replace(/\.html$/, '')}`, { ld: article('2023-08-05', '2023-08-05') }),
    'intake/index.html': page('/intake/', { robots: 'noindex, nofollow' }),
    '404.html': page('/404', { canonical: null }),
    'about/careers.html': page('/about/careers'),
    'about/careers/apply.html': page('/about/careers/apply'),
    'about/careers/intern.html': page('/about/careers/intern'),
    'elsewhere.html': page('/elsewhere', { canonical: O + '/privacy' }),
    'src/assets/x.html': page('/src/assets/x'),
  };
  for (const [rel, html] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(build, rel)), { recursive: true });
    fs.writeFileSync(path.join(build, rel), html);
  }
  return build;
}

test('lists indexable self-canonical pages with true dates only', () => {
  const build = fixture();
  try {
    generateSitemap(build);
    const xml = fs.readFileSync(path.join(build, 'sitemap.xml'), 'utf8');
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].slice(O.length));
    assert.deepEqual(locs, ['/', '/about/careers', '/about/team', '/blog/', `/blog/${LEGACY.replace(/\.html$/, '')}`, '/blog/test-a', '/blog/test-b', '/blog/test-partial', '/privacy']);
    const lastmods = Object.fromEntries([...xml.matchAll(/<loc>([^<]+)<\/loc>\n    <lastmod>([^<]+)<\/lastmod>/g)].map((m) => [m[1].slice(O.length), m[2]]));
    // The frozen legacy post states dateModified = datePublished only as a default: no lastmod.
    assert.deepEqual(lastmods, { '/blog/': '2026-02-01', '/blog/test-a': '2026-02-03', '/blog/test-b': '2026-01-10' });
    assert.doesNotMatch(xml, /<changefreq>|<priority>|\.html<\/loc>/);
  } finally {
    fs.rmSync(build, { recursive: true, force: true });
  }
});

test('the apply form and job pages stay out until the owner decides (url-hygiene D4, TRUST-09)', () => {
  assert.deepEqual([...HELD_FOR_OWNER].sort(), ['/about/careers/apply', '/about/careers/employee-benefits-leader', '/about/careers/intern', '/about/careers/pc-insurance-agent']);
});

test('two runs give byte-identical output, whatever the files\' mtimes', () => {
  const build = fixture();
  try {
    generateSitemap(build);
    const first = fs.readFileSync(path.join(build, 'sitemap.xml'));
    const old = new Date('2020-01-01T00:00:00Z');
    (function touch(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) touch(full); else fs.utimesSync(full, old, old);
      }
    })(build);
    generateSitemap(build);
    assert.ok(first.equals(fs.readFileSync(path.join(build, 'sitemap.xml'))));
  } finally {
    fs.rmSync(build, { recursive: true, force: true });
  }
});
