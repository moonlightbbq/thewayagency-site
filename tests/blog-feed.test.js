/**
 * The blog RSS feed (TECH-05), from the real generator over a temp site tree
 * with synthetic posts: the 20 newest posts, newest first, each <link> the
 * extensionless URL, each guid the old .html string with isPermaLink="false"
 * (so readers do not re-announce old items). The slugs run a..v while the
 * dates run the other way, so the old alphabetical slice fails this test.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { feedProblems } = require('../scripts/lib/url-hygiene');

const REPO = path.join(__dirname, '..');
const O = 'https://www.thewayagency.com';
const body = Array.from({ length: 240 }, (_, i) => `word${i}`).join(' ');
const letters = 'abcdefghijklmnopqrstuv'.split('');
// test-feed-a is the NEWEST (2026-01-22), test-feed-v the oldest (2026-01-01).
const posts = letters.map((l, i) => ({ slug: `test-feed-${l}`, date: `2026-01-${String(22 - i).padStart(2, '0')}` }));

test('the feed lists the 20 newest posts, newest first, at extensionless URLs', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-feed-'));
  try {
    for (const dir of ['scripts/lib', 'data', 'src/blog', 'build/blog']) fs.mkdirSync(path.join(tmp, dir), { recursive: true });
    for (const f of ['generate-blog.js', 'shared-templates.js']) fs.copyFileSync(path.join(REPO, 'scripts', f), path.join(tmp, 'scripts', f));
    for (const f of fs.readdirSync(path.join(REPO, 'scripts', 'lib'))) fs.copyFileSync(path.join(REPO, 'scripts', 'lib', f), path.join(tmp, 'scripts', 'lib', f));
    fs.copyFileSync(path.join(REPO, 'data', 'locations.json'), path.join(tmp, 'data', 'locations.json'));
    fs.writeFileSync(path.join(tmp, 'data', 'team.json'), JSON.stringify({ team: [] }));
    const year1 = posts.map((p) => ({ slug: p.slug, title: `SYNTHETIC ${p.slug}`, publish_date: p.date, status: 'published' }));
    fs.writeFileSync(path.join(tmp, 'data', 'content-calendar.json'), JSON.stringify({ existing_posts: [], year1 }, null, 2));
    for (const p of posts) {
      fs.writeFileSync(path.join(tmp, 'src', 'blog', `${p.slug}.md`),
        `---\ntitle: SYNTHETIC ${p.slug}\nslug: ${p.slug}\ndescription: SYNTHETIC description\nauthor: The Way Agency\ndate: ${p.date}\n---\n\n## One\n\n${body}\n`);
    }
    const env = { ...process.env };
    delete env.BLOG_REVIEW_TOKEN_SECRET; delete env.CF_PAGES; delete env.CF_PAGES_BRANCH;
    const run = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'generate-blog.js')], { encoding: 'utf8', env, cwd: tmp });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const feed = fs.readFileSync(path.join(tmp, 'build', 'blog', 'feed.xml'), 'utf8');
    const links = [...feed.matchAll(/<link>([^<]+)<\/link>/g)].map((m) => m[1]).filter((l) => l.startsWith(`${O}/blog/test-`));
    assert.deepEqual(links, posts.slice(0, 20).map((p) => `${O}/blog/${p.slug}`));
    const guids = [...feed.matchAll(/<guid isPermaLink="false">([^<]+)<\/guid>/g)].map((m) => m[1]);
    assert.deepEqual(guids, posts.slice(0, 20).map((p) => `${O}/blog/${p.slug}.html`));
    const routes = new Set(posts.map((p) => `/blog/${p.slug}`));
    assert.deepEqual(feedProblems(feed, { routes, expectedSlugs: posts.map((p) => p.slug) }), []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
