/**
 * Health and Medicare posts are held out of the blog RSS feed (and only the
 * feed) until PR #63's Medicare corrections are live (scripts/lib/feed-hold.js;
 * remove this test with that file). The generator runs over a temp site tree
 * with synthetic posts: a held post is the NEWEST, yet the feed skips it and
 * still lists 20 posts; its page and the blog index still render.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { feedHoldReason, isHeldFromFeed, HELD_SLUGS } = require('../scripts/lib/feed-hold');
const { feedProblems } = require('../scripts/lib/url-hygiene');

const REPO = path.join(__dirname, '..');
const O = 'https://www.thewayagency.com';

test('the rule holds the two Medicare posts and health-tagged posts, and nothing else', () => {
  for (const slug of ['medicare-enrollment-guide-louisville-2026', 'medicare-open-enrollment-2027']) {
    assert.ok(HELD_SLUGS.includes(slug));
    assert.ok(isHeldFromFeed({ slug }), slug);
  }
  assert.ok(isHeldFromFeed({ slug: 'x', category: 'health' }));
  assert.ok(isHeldFromFeed({ slug: 'x', category: 'life_health' }));
  assert.ok(isHeldFromFeed({ slug: 'group-health-insurance-small-business-kentucky' }));
  assert.ok(isHeldFromFeed({ slug: 'x', title: 'Medicaid in Kentucky' }));
  assert.ok(isHeldFromFeed({ slug: 'x', tags: 'kentucky, kynect' }));
  assert.ok(isHeldFromFeed({ slug: 'x', tags: ['seniors', 'health-insurance'] }));
  assert.ok(isHeldFromFeed({ slug: 'x', tags: '[medicare, louisville]' }));
  assert.equal(feedHoldReason({ slug: 'surety-bonds-explained', title: 'Surety Bonds Explained', category: 'commercial', tags: 'bonds, kentucky' }), '');
  assert.equal(feedHoldReason({ slug: 'healthcare-workers-auto', title: 'Auto tips' }), '', 'whole words only');
  assert.equal(feedHoldReason({}), '');
});

test('the generator leaves held posts out of the feed only', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-hold-'));
  try {
    for (const dir of ['scripts/lib', 'data', 'src/blog', 'build/blog']) fs.mkdirSync(path.join(tmp, dir), { recursive: true });
    for (const f of ['generate-blog.js', 'shared-templates.js']) fs.copyFileSync(path.join(REPO, 'scripts', f), path.join(tmp, 'scripts', f));
    for (const f of fs.readdirSync(path.join(REPO, 'scripts', 'lib'))) fs.copyFileSync(path.join(REPO, 'scripts', 'lib', f), path.join(tmp, 'scripts', 'lib', f));
    fs.copyFileSync(path.join(REPO, 'data', 'locations.json'), path.join(tmp, 'data', 'locations.json'));
    fs.writeFileSync(path.join(tmp, 'data', 'team.json'), JSON.stringify({ team: [] }));
    const body = Array.from({ length: 240 }, (_, i) => `word${i}`).join(' ');
    // Two held posts (newest), then 22 ordinary ones, oldest last.
    const posts = [
      { slug: 'medicare-open-enrollment-2027', date: '2026-02-28', extra: 'tags: medicare, 2027\n' },
      { slug: 'test-hold-tagged', date: '2026-02-27', extra: 'category: health\n' },
      ...'abcdefghijklmnopqrstuv'.split('').map((l, i) => ({ slug: `test-hold-${l}`, date: `2026-01-${String(22 - i).padStart(2, '0')}`, extra: 'tags: auto, kentucky\n' })),
    ];
    const year1 = posts.map((p) => ({ slug: p.slug, title: `SYNTHETIC ${p.slug}`, publish_date: p.date, status: 'published' }));
    fs.writeFileSync(path.join(tmp, 'data', 'content-calendar.json'), JSON.stringify({ existing_posts: [], year1 }, null, 2));
    for (const p of posts) {
      fs.writeFileSync(path.join(tmp, 'src', 'blog', `${p.slug}.md`),
        `---\ntitle: SYNTHETIC ${p.slug}\nslug: ${p.slug}\ndescription: SYNTHETIC description\nauthor: The Way Agency\ndate: ${p.date}\n${p.extra}---\n\n## One\n\n${body}\n`);
    }
    const env = { ...process.env };
    delete env.BLOG_REVIEW_TOKEN_SECRET; delete env.CF_PAGES; delete env.CF_PAGES_BRANCH;
    const run = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'generate-blog.js')], { encoding: 'utf8', env, cwd: tmp });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const feed = fs.readFileSync(path.join(tmp, 'build', 'blog', 'feed.xml'), 'utf8');
    const links = [...feed.matchAll(/<link>([^<]+)<\/link>/g)].map((m) => m[1]).filter((l) => l.startsWith(`${O}/blog/`) && l !== `${O}/blog/`);
    const listed = posts.slice(2, 22).map((p) => p.slug);
    assert.deepEqual(links, listed.map((s) => `${O}/blog/${s}`));
    // No item for a held post (its title may still appear as a Related Articles
    // card inside another item's text; that is a title, not the post).
    for (const slug of ['medicare-open-enrollment-2027', 'test-hold-tagged']) {
      assert.ok(!feed.includes(`<link>${O}/blog/${slug}</link>`), slug);
      assert.ok(!feed.includes(`${O}/blog/${slug}.html</guid>`), slug);
    }
    assert.deepEqual(feedProblems(feed, { routes: new Set(posts.map((p) => `/blog/${p.slug}`)), expectedSlugs: listed }), []);
    // Only the feed: the held posts still render and stay in the blog index.
    const index = fs.readFileSync(path.join(tmp, 'build', 'blog', 'index.html'), 'utf8');
    for (const slug of ['medicare-open-enrollment-2027', 'test-hold-tagged']) {
      assert.ok(fs.existsSync(path.join(tmp, 'build', 'blog', `${slug}.html`)), slug);
      assert.ok(index.includes(`/blog/${slug}`), slug);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
