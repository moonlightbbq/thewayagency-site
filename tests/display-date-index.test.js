/**
 * A back-posted entry (owner 2026-11-27): a published post whose calendar entry
 * carries display_date is listed on the blog index under that date and sorted
 * by it, not by the later publish_date it went live on. Real generator, temp
 * site tree, synthetic posts.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const body = Array.from({ length: 240 }, (_, i) => `word${i}`).join(' ');

test('the index card shows and sorts by display_date', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'display-date-index-'));
  try {
    for (const dir of ['scripts/lib', 'data', 'src/blog', 'build/blog']) fs.mkdirSync(path.join(tmp, dir), { recursive: true });
    for (const f of ['generate-blog.js', 'shared-templates.js']) fs.copyFileSync(path.join(REPO, 'scripts', f), path.join(tmp, 'scripts', f));
    for (const f of fs.readdirSync(path.join(REPO, 'scripts', 'lib'))) fs.copyFileSync(path.join(REPO, 'scripts', 'lib', f), path.join(tmp, 'scripts', 'lib', f));
    fs.copyFileSync(path.join(REPO, 'data', 'locations.json'), path.join(tmp, 'data', 'locations.json'));
    fs.copyFileSync(path.join(REPO, 'data', 'entity.json'), path.join(tmp, 'data', 'entity.json'));
    fs.writeFileSync(path.join(tmp, 'data', 'team.json'), JSON.stringify({ team: [] }));
    const posts = [
      // Went live 2026-01-20 but shows 2025-10-14: sorts last, labelled October 2025.
      { slug: 'test-dd-back', publish_date: '2026-01-20', display_date: '2025-10-14', md: '2025-10-14' },
      { slug: 'test-dd-new', publish_date: '2026-01-10', md: '2026-01-10' },
      { slug: 'test-dd-mid', publish_date: '2025-12-01', md: '2025-12-01' },
    ];
    const year1 = posts.map((p) => ({ slug: p.slug, title: `SYNTHETIC ${p.slug}`, publish_date: p.publish_date, ...(p.display_date ? { display_date: p.display_date } : {}), status: 'published' }));
    fs.writeFileSync(path.join(tmp, 'data', 'content-calendar.json'), JSON.stringify({ existing_posts: [], year1 }, null, 2));
    for (const p of posts) {
      fs.writeFileSync(path.join(tmp, 'src', 'blog', `${p.slug}.md`),
        `---\ntitle: SYNTHETIC ${p.slug}\nslug: ${p.slug}\ndescription: SYNTHETIC description\nauthor: The Way Agency\ndate: ${p.md}\n---\n\n## One\n\n${body}\n`);
    }
    const env = { ...process.env };
    delete env.BLOG_REVIEW_TOKEN_SECRET; delete env.CF_PAGES; delete env.CF_PAGES_BRANCH;
    const run = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'generate-blog.js')], { encoding: 'utf8', env, cwd: tmp });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const index = fs.readFileSync(path.join(tmp, 'build', 'blog', 'index.html'), 'utf8');
    const order = [...index.matchAll(/href="\/blog\/(test-dd-[a-z]+)" class="card blog-card"/g)].map((m) => m[1]);
    assert.deepEqual(order, ['test-dd-new', 'test-dd-mid', 'test-dd-back']);
    const card = index.slice(index.indexOf('href="/blog/test-dd-back"'));
    assert.match(card.slice(0, 1200), /October 2025/);
    assert.doesNotMatch(card.slice(0, 1200), /January 2026/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
