/**
 * BLOG-05 consolidation (content-accuracy WP-C): a retired post takes ONE 301
 * hop to its keeper, from both its extensionless and its .html URL, and is gone
 * from every place that would list or link it. Reads the repo, never build/.
 *
 * RETIRED grows as merge-map rows ship: row 1 in Deploy 1, rows 2-7 and 9-12
 * in Deploy 2 (owner decision D4; row 12 also D14). Row 8 (the Louisville
 * Medicare guide) stays live until Medicare AEP closes on 2026-12-07.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { LEGACY_BLOG_PAGES } = require('../scripts/lib/legacy-blog-pages');

const ROOT = path.join(__dirname, '..');

/** slug -> keeper slug */
const RETIRED = Object.freeze({
  'workers-comp-kentucky': 'workers-comp-requirements-kentucky-2026', // row 1
  'how-to-read-declarations-page': 'understanding-your-insurance-declarations-page', // row 2
  'what-is-liability-insurance': 'liability-limits-how-much-enough', // row 3
  'bundling-home-auto': 'bundling-home-auto-insurance-savings', // row 4 (legacy page)
  'home-vs-landlord-insurance': 'landlord-insurance', // row 5 (legacy page into a frozen keeper)
  'cyber-safety': 'cyber-insurance-small-business-essentials', // row 6 (legacy page)
  'mt-washington-auto-insurance': 'best-auto-insurance-rates-mt-washington-ky', // row 7
  'ohio-river-flood-risk-henderson-owensboro': 'owensboro-flood-risk-neighborhood-fema-zones-2026', // row 9
  'flood-insurance-ohio-river-valley-2026': 'owensboro-flood-risk-neighborhood-fema-zones-2026', // row 10
  'bowling-green-tornado-lessons-coverage': 'tornado-season', // row 11 (frozen keeper)
  'how-independent-agents-use-data-better-rates': 'how-independent-agents-save-money', // row 12
});

/** Merge-map row 8: gated until AEP closes (2026-12-07) and its keeper moves to Markdown. */
const GATED = Object.freeze({ 'medicare-enrollment-guide-louisville-2026': 'medicare-enrollment-guide' });

function rules() {
  const lines = fs.readFileSync(path.join(ROOT, '_redirects'), 'utf8').split('\n');
  const out = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const [from, to, code] = t.split(/\s+/);
    out.push({ from, to, code, line: i + 1 });
  });
  return out;
}

describe('consolidation redirects (BLOG-05)', () => {
  const all = rules();
  // Top-most match wins on Cloudflare Pages: no earlier rule (a splat or a
  // placeholder) may catch the retired URL first.
  const catches = (r, url) => r.from.startsWith('/') && new RegExp(`^${r.from.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/:[a-z]+/gi, '[^/]+')}$`).test(url);

  for (const [slug, keeper] of Object.entries(RETIRED)) {
    test(`${slug}: /blog/${slug} and /blog/${slug}.html each 301 straight to /blog/${keeper}`, () => {
      for (const from of [`/blog/${slug}`, `/blog/${slug}.html`]) {
        const matches = all.filter((r) => r.from === from);
        assert.equal(matches.length, 1, `${from}: exactly one rule`);
        const [r] = matches;
        assert.equal(r.code, '301', from);
        assert.equal(r.to, `/blog/${keeper}`, `${from}: extensionless keeper`);
        assert.ok(!all.some((x) => x.from === r.to || x.from === `${r.to}.html`), `${r.to} is not itself redirected (single hop)`);
        const earlier = all.find((x) => x.line < r.line && catches(x, from));
        assert.equal(earlier, undefined, `${from} is caught first by line ${earlier && earlier.line}`);
      }
    });

    test(`${slug}: the keeper exists and is not retired`, () => {
      const md = fs.existsSync(path.join(ROOT, 'src', 'blog', `${keeper}.md`));
      assert.ok(md || Object.prototype.hasOwnProperty.call(LEGACY_BLOG_PAGES, `${keeper}.html`), keeper);
      assert.ok(!Object.prototype.hasOwnProperty.call(RETIRED, keeper));
    });

    test(`${slug}: no source file, no frozen-list entry; archived, not deleted`, () => {
      assert.ok(!fs.existsSync(path.join(ROOT, 'src', 'blog', `${slug}.md`)));
      assert.ok(!fs.existsSync(path.join(ROOT, 'src', 'pages', 'blog', `${slug}.html`)));
      assert.ok(!Object.prototype.hasOwnProperty.call(LEGACY_BLOG_PAGES, `${slug}.html`));
      assert.ok(fs.existsSync(path.join(ROOT, 'archive', 'blog', `${slug}.html`)) || fs.existsSync(path.join(ROOT, 'archive', 'blog', `${slug}.md`)));
    });

    test(`${slug}: its calendar entry is 'retired' to the keeper and keeps a primary_keyword`, () => {
      const cal = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'content-calendar.json'), 'utf8'));
      const entries = [...(cal.existing_posts || []), ...(cal.year1 || [])].filter((p) => p && p.slug === slug);
      assert.equal(entries.length, 1);
      assert.equal(entries[0].status, 'retired');
      assert.equal(entries[0].retired_to, keeper);
      assert.match(String(entries[0].retired_on), /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(entries[0].primary_keyword);
    });
  }

  test('no markdown post or data file links to a retired slug', () => {
    const slugs = Object.keys(RETIRED);
    const re = new RegExp(`/blog/(?:${slugs.join('|')})(?:\\.html)?(?=[)"'#?\\s<]|$)`);
    const files = [
      ...fs.readdirSync(path.join(ROOT, 'src', 'blog')).filter((f) => f.endsWith('.md')).map((f) => path.join('src', 'blog', f)),
      ...fs.readdirSync(path.join(ROOT, 'data')).filter((f) => f.endsWith('.json')).map((f) => path.join('data', f)),
    ];
    for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), re, f);
  });

  test('the /post/ cyber-safety rule goes straight to the cyber keeper (one hop)', () => {
    const r = all.find((x) => x.from === '/post/cyber-safety-for-small-businesses-prevention-checklist');
    assert.equal(r.to, '/blog/cyber-insurance-small-business-essentials');
  });

  test('every calendar entry marked retired with a keeper is in RETIRED, so nothing is retired without its 301', () => {
    const cal = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'content-calendar.json'), 'utf8'));
    for (const e of [...(cal.existing_posts || []), ...(cal.year1 || [])]) {
      if (e && e.status === 'retired' && e.retired_to) assert.equal(RETIRED[e.slug], e.retired_to, e.slug);
    }
  });

  for (const [slug, keeper] of Object.entries(GATED)) {
    test(`${slug} (row 8, gated): still live and published, no active redirect, keeper untouched`, () => {
      assert.ok(fs.existsSync(path.join(ROOT, 'src', 'blog', `${slug}.md`)));
      assert.ok(!all.some((r) => r.from === `/blog/${slug}` || r.from === `/blog/${slug}.html`), 'no active rule before 2026-12-07');
      const cal = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'content-calendar.json'), 'utf8'));
      const e = [...(cal.existing_posts || []), ...(cal.year1 || [])].find((p) => p && p.slug === slug);
      assert.equal(e.status, 'published');
      assert.ok(Object.prototype.hasOwnProperty.call(LEGACY_BLOG_PAGES, `${keeper}.html`), 'the keeper is still the frozen page');
    });
  }
});
