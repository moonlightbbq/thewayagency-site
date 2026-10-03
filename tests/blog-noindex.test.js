/**
 * BLOG-08 (content-accuracy WP-A6, C6; owner decision D14): a post with
 * `noindex: true` in its front matter still renders (200), carries robots
 * "noindex, follow", and is left out of the sitemap and the 404 suggestions.
 * The /blog/ index, Related Articles and the feed leave it out too
 * (generate-blog.js build steps 2 and 3, checked on the real build by
 * validate-build.js). The IVANS and customer-lifetime-value posts carry the
 * flag; the data post's unverified "Real examples" are gone.
 *
 * Pure: renders in memory or in a temp tree, never writes build/.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { generateBlogPost, markdownToHtml, parseFrontMatter } = require('../scripts/generate-blog');
const { isNoindex } = require('../scripts/lib/blog-noindex');
const { generateSitemap } = require('../scripts/builders/sitemap');

const ROOT = path.join(__dirname, '..');
const ROBOTS = '<meta name="robots" content="noindex, follow">';
const body = markdownToHtml('Synthetic body text for the noindex test.');
const render = (patch) => generateBlogPost({ title: 'SYNTHETIC noindex', slug: 'test-noindex', description: 'd', date: '2026-03-27', ...patch }, body, [], { team: [] });

describe('noindex front-matter flag (BLOG-08)', () => {
  test('noindex: true emits robots "noindex, follow" once, after the canonical', () => {
    const html = render({ noindex: 'true' });
    assert.equal(html.split(ROBOTS).length - 1, 1);
    assert.ok(html.indexOf(ROBOTS) > html.indexOf('<link rel="canonical"'));
    assert.match(render({ noindex: 'True' }), /noindex, follow/);
  });

  test('absent, false or anything else: no robots meta', () => {
    for (const v of [undefined, 'false', '', 'yes', 'no']) assert.ok(!render({ noindex: v }).includes('name="robots"'), String(v));
    assert.equal(isNoindex({}), false);
    assert.equal(isNoindex(null), false);
  });

  test('the sitemap skips a noindexed blog page and keeps the others', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sitemap-noindex-'));
    try {
      fs.mkdirSync(path.join(tmp, 'blog'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'blog', 'kept-post.html'), render({ slug: 'kept-post' }));
      fs.writeFileSync(path.join(tmp, 'blog', 'hidden-post.html'), render({ slug: 'hidden-post', noindex: 'true' }));
      generateSitemap(tmp, { products: {}, landingData: { cities: [], industries: [] }, seoData: {}, portalPages: [], SRC: tmp, carriers: null });
      const xml = fs.readFileSync(path.join(tmp, 'sitemap.xml'), 'utf8');
      assert.match(xml, /\/blog\/kept-post</);
      assert.doesNotMatch(xml, /hidden-post/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('the 404 suggestions skip a noindexed blog page', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-404-noindex-'));
    try {
      for (const dir of ['scripts', 'data', 'build/blog']) fs.mkdirSync(path.join(tmp, dir), { recursive: true });
      fs.copyFileSync(path.join(ROOT, 'scripts', 'generate-404-data.js'), path.join(tmp, 'scripts', 'generate-404-data.js'));
      fs.writeFileSync(path.join(tmp, 'data', 'products.json'), JSON.stringify({ personal: [] }));
      fs.writeFileSync(path.join(tmp, 'data', 'landing-pages.json'), JSON.stringify({ cities: [], industries: [] }));
      fs.writeFileSync(path.join(tmp, 'build', 'blog', 'kept-post.html'), render({ slug: 'kept-post' }));
      fs.writeFileSync(path.join(tmp, 'build', 'blog', 'hidden-post.html'), render({ slug: 'hidden-post', noindex: 'true' }));
      const run = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'generate-404-data.js')], { encoding: 'utf8' });
      assert.equal(run.status, 0, run.stdout + run.stderr);
      const urls = JSON.parse(fs.readFileSync(path.join(tmp, 'build', '404-suggestions.json'), 'utf8')).map((s) => s.url);
      assert.ok(urls.includes('/blog/kept-post.html'));
      assert.ok(!urls.some((u) => u.includes('hidden-post')));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('agency-operations posts (BLOG-08, D14 default)', () => {
  const cal = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'content-calendar.json'), 'utf8'));
  const entry = (slug) => [...(cal.existing_posts || []), ...(cal.year1 || [])].find((p) => p && p.slug === slug);

  for (const slug of ['what-is-ivans-insurance-data', 'insurance-customer-lifetime-value-explained']) {
    test(`${slug}: noindex: true, and its calendar entry stays published (the URL keeps returning 200)`, () => {
      const { meta } = parseFrontMatter(fs.readFileSync(path.join(ROOT, 'src', 'blog', `${slug}.md`), 'utf8'));
      assert.equal(isNoindex(meta), true);
      assert.equal(entry(slug).status, 'published');
    });

    test(`${slug}: no markdown post or data file links it`, () => {
      const re = new RegExp(`/blog/${slug}(?:\\.html)?(?=[)"'#?\\s<]|$)`);
      for (const f of fs.readdirSync(path.join(ROOT, 'src', 'blog')).filter((x) => x.endsWith('.md'))) {
        assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'src', 'blog', f), 'utf8'), re, f);
      }
      for (const f of fs.readdirSync(path.join(ROOT, 'data')).filter((x) => x.endsWith('.json'))) {
        assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'), re, f);
      }
    });
  }

  test('the data post\'s unverified "Real examples" appear in no post, archived or not', () => {
    const dirs = [path.join(ROOT, 'src', 'blog'), path.join(ROOT, 'archive', 'blog')].filter((d) => fs.existsSync(d));
    for (const dir of dirs) {
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
        const text = fs.readFileSync(path.join(dir, f), 'utf8');
        assert.doesNotMatch(text, /Real examples: how data found better coverage|fifteen to twenty percent lower|renewal with a thirty percent increase/, f);
      }
    }
  });
});
