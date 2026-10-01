/**
 * The renderer applies the review gate (sage-server BL-07, AIA-018).
 *
 * scripts/generate-blog.js is the step that actually publishes a page: the
 * deploy build runs it on every push to main and renders every markdown post
 * whose date has passed. Before BL-07 fix round 2 it printed "Reviewed by"
 * from whatever review lines a file's front matter carried, and rendered posts
 * the publisher had refused, so a reviewer could be credited with no click in
 * SAGE at all. These tests run the real generator (and, end to end, the real
 * publisher) against a temp copy of the site tree with synthetic data:
 *
 *   - a 'planned' post past its date with review lines renders with no credit,
 *     in any spelling of the review keys the generator's parser accepts;
 *   - an entry in 'error' (approved_bytes_changed) neither renders nor credits;
 *   - a hold, an unknown status and a file claiming another post's slug do not
 *     render;
 *   - "Reviewed by" renders only for an approval SAGE signed whose bytes are
 *     the ones on disk: the approval itself before the publisher runs, the
 *     publisher's credit record after; a hand-typed approval or credit record,
 *     a changed file, or a build without the secret credits no one.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const { signApproval } = require('../scripts/lib/review-credit');

const SECRET = 'TEST-vector-secret-0123456789abcdef0123';
const sha = (s) => crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
const body = Array.from({ length: 240 }, (_, i) => `word${i}`).join(' ');
const post = (slug, extra = '', date = '2026-01-07') => `---\ntitle: SYNTHETIC ${slug}\nslug: ${slug}\ndescription: SYNTHETIC description for ${slug}\nauthor: The Way Agency\ndate: ${date}\n${extra}---\n\n${body}\n`;
const REVIEWER = { name: 'Test Reviewer C', slug: 'test-reviewer-c', email: 'test-reviewer-c@example.com', title: 'Licensed Test Agent' };
const TEAM = [{ name: REVIEWER.name, slug: REVIEWER.slug, email: REVIEWER.email, title: REVIEWER.title, license_states: ['KY'] }];
const REVIEW_LINES = `reviewer: ${REVIEWER.name}\nreviewer_slug: ${REVIEWER.slug}\nreviewer_title: Licensed Agent\nreviewed_date: 2025-12-01\n`;
const assigned = { reviewer: REVIEWER.name, reviewer_slug: REVIEWER.slug, reviewer_email: REVIEWER.email, review_sent_date: '2025-12-20' };

function approved(slug, md, patch = {}) {
  const entry = {
    slug, title: `SYNTHETIC ${slug}`, publish_date: '2026-01-07', status: 'approved', ...assigned,
    approved_by: REVIEWER.name, approved_by_email: REVIEWER.email, approved_date: '2025-12-23', approved_sha256: sha(md),
  };
  entry.approval_mac = signApproval(entry, SECRET);
  return { ...entry, ...patch };
}

/** A temp site tree with the generator, the publisher and their libraries. */
function makeSite({ year1 = [], existing = [], files = {} }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-review-gate-'));
  for (const dir of ['scripts/lib', 'data', 'src/blog', 'build/blog']) fs.mkdirSync(path.join(tmp, dir), { recursive: true });
  for (const f of ['generate-blog.js', 'shared-templates.js', 'publish-scheduled-posts.js']) {
    fs.copyFileSync(path.join(REPO, 'scripts', f), path.join(tmp, 'scripts', f));
  }
  for (const f of fs.readdirSync(path.join(REPO, 'scripts', 'lib'))) {
    fs.copyFileSync(path.join(REPO, 'scripts', 'lib', f), path.join(tmp, 'scripts', 'lib', f));
  }
  fs.copyFileSync(path.join(REPO, 'data', 'locations.json'), path.join(tmp, 'data', 'locations.json'));
  fs.writeFileSync(path.join(tmp, 'data', 'team.json'), JSON.stringify({ team: TEAM }));
  fs.writeFileSync(path.join(tmp, 'data', 'content-calendar.json'), JSON.stringify({ existing_posts: existing, year1 }, null, 2));
  for (const [name, md] of Object.entries(files)) fs.writeFileSync(path.join(tmp, 'src', 'blog', name.endsWith('.md') ? name : `${name}.md`), md);
  const env = (secret) => {
    const e = { ...process.env };
    delete e.BLOG_REVIEW_TOKEN_SECRET;
    if (secret) e.BLOG_REVIEW_TOKEN_SECRET = secret;
    return e;
  };
  const run = (script, { secret = SECRET } = {}) => spawnSync(process.execPath, [path.join(tmp, 'scripts', script)], { encoding: 'utf8', env: env(secret), cwd: tmp });
  const page = (slug) => {
    const f = path.join(tmp, 'build', 'blog', `${slug}.html`);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  };
  const calendar = () => JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'content-calendar.json'), 'utf8'));
  const clean = () => fs.rmSync(path.join(tmp, 'build', 'blog'), { recursive: true, force: true });
  return { tmp, run, page, calendar, clean, done: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

const credits = (html) => /Reviewed by/.test(html) || /"reviewedBy"/.test(html);

describe('generate-blog renders no review claim without a signed approval', () => {
  let site;
  let gen;
  const approvedMd = post('test-approved-due');
  const changedBase = post('test-error-changed');
  before(() => {
    site = makeSite({
      year1: [
        { slug: 'test-planned-past', title: 'SYNTHETIC planned', publish_date: '2026-01-07', status: 'planned', ...assigned },
        { slug: 'test-spellings', title: 'SYNTHETIC spellings', publish_date: '2026-01-07', status: 'in-review', ...assigned },
        { ...approved('test-error-changed', changedBase), status: 'error', error_reason: 'approved_bytes_changed' },
        { slug: 'test-held', title: 'SYNTHETIC held', publish_date: '2026-01-07', status: 'changes-requested', ...assigned },
        { slug: 'test-unknown', title: 'SYNTHETIC unknown', publish_date: '2026-01-07', status: 'awaiting-legal', ...assigned },
        { slug: 'test-future', title: 'SYNTHETIC future', publish_date: '2099-01-07', status: 'planned', ...assigned },
        approved('test-approved-due', approvedMd),
        approved('test-approved-unsigned', post('test-approved-unsigned'), { approval_mac: undefined }),
        { slug: 'test-short', title: 'SYNTHETIC short', publish_date: '2026-01-07', status: 'planned' },
      ],
      existing: [
        // An old post, published long ago, with review lines and no credit record.
        { slug: 'test-legacy', title: 'SYNTHETIC legacy', publish_date: '2026-01-01', status: 'published', ...assigned },
      ],
      files: {
        'test-planned-past': post('test-planned-past', REVIEW_LINES),
        // Every spelling generate-blog.js's parser reads as a key once trimmed.
        'test-spellings': post('test-spellings', ` reviewer: ${REVIEWER.name}\n\treviewer_slug: ${REVIEWER.slug}\nreviewed_date : 2025-12-01\nReviewer: ${REVIEWER.name}\n reviewed_by: ${REVIEWER.name}\n`),
        'test-error-changed': `${changedBase.replace('---\n\n', `${REVIEW_LINES}---\n\n`)}\nAn AI-added paragraph the reviewer never saw.\n`,
        'test-held': post('test-held', REVIEW_LINES),
        'test-unknown': post('test-unknown'),
        'test-future': post('test-future', '', '2026-01-07'),
        'test-approved-due': approvedMd,
        'test-approved-unsigned': post('test-approved-unsigned'),
        'test-short': `---\ntitle: SYNTHETIC short\nslug: test-short\ndescription: d\ndate: 2026-01-07\n---\n\nToo short.\n`,
        'test-legacy': post('test-legacy', REVIEW_LINES, '2026-01-01'),
        'test-uncalendared': post('test-uncalendared', REVIEW_LINES),
        // Another file claiming a calendar post's slug, to render at its URL.
        'zz-impostor.md': post('test-held'),
      },
    });
    gen = site.run('generate-blog.js');
  });
  after(() => site.done());

  test('the generator runs cleanly', () => {
    assert.equal(gen.status, 0, gen.stdout + gen.stderr);
  });

  test('a planned post past its date renders, with review lines in its front matter, and credits no one', () => {
    const html = site.page('test-planned-past');
    assert.ok(html, gen.stdout);
    assert.ok(!credits(html), 'no "Reviewed by" and no reviewedBy without an approval in SAGE');
    assert.ok(!html.includes(REVIEWER.name), 'the reviewer is not named anywhere on the page');
  });

  test('a review key with leading whitespace, another case or a space before the colon credits no one', () => {
    const html = site.page('test-spellings');
    assert.ok(html, gen.stdout);
    assert.ok(!credits(html));
    assert.ok(!html.includes(REVIEWER.name));
  });

  test('an entry in error (approved_bytes_changed) neither renders nor credits', () => {
    assert.equal(site.page('test-error-changed'), null);
    assert.match(gen.stdout, /test-error-changed\.html.*approved_bytes_changed/);
  });

  test('a held post, an unknown status and a post not yet due do not render', () => {
    assert.equal(site.page('test-held'), null);
    assert.equal(site.page('test-unknown'), null);
    assert.equal(site.page('test-future'), null, 'the calendar date governs, not the file\'s own date:');
    assert.equal(site.page('test-short'), null, 'a post the publisher would refuse as not ready');
  });

  test('another file cannot render at a calendar post\'s URL around its hold', () => {
    assert.match(gen.stdout, /zz-impostor\.md.*belongs to the calendar post/);
    assert.equal(site.page('test-held'), null);
  });

  test('an approval SAGE signed, for the bytes on disk, credits the reviewer before the publisher runs', () => {
    const html = site.page('test-approved-due');
    assert.ok(html, gen.stdout);
    assert.match(html, new RegExp(`Reviewed by <a href="/about/team.html#${REVIEWER.slug}"[^>]*>${REVIEWER.name}</a>, ${REVIEWER.title} on December 23, 2025`));
    assert.match(html, /"reviewedBy"/);
  });

  test('a hand-typed approval (no approval_mac) does not render at all', () => {
    assert.equal(site.page('test-approved-unsigned'), null);
    assert.match(gen.stdout, /test-approved-unsigned\.html.*approval_unsigned/);
  });

  test('a published post with review lines but no credit record renders without them', () => {
    const html = site.page('test-legacy');
    assert.ok(html);
    assert.ok(!credits(html));
  });

  test('a post that is not on the calendar renders, and credits no one', () => {
    const html = site.page('test-uncalendared');
    assert.ok(html);
    assert.ok(!credits(html));
  });
});

describe('an unreadable calendar', () => {
  test('fails open for publication (the blog does not vanish) and closed for credit (no byline)', () => {
    const md = post('test-unreadable');
    const site = makeSite({ year1: [approved('test-unreadable', md)], files: { 'test-unreadable': md } });
    try {
      fs.writeFileSync(path.join(site.tmp, 'data', 'content-calendar.json'), '{ not json');
      const gen = site.run('generate-blog.js');
      assert.match(gen.stdout, /content-calendar\.json could not be read.*no reviewer is credited/);
      const html = site.page('test-unreadable');
      assert.ok(html, gen.stdout + gen.stderr);
      assert.ok(!credits(html));
    } finally {
      site.done();
    }
  });
});

describe('end to end: publisher then renderer', () => {
  test('the credit survives publishing, and is dropped by any later change, a forged record, or a build without the secret', () => {
    const md = post('test-e2e');
    const silent = post('test-e2e-silent', REVIEW_LINES);
    const site = makeSite({
      year1: [
        approved('test-e2e', md),
        { slug: 'test-e2e-silent', title: 'SYNTHETIC silent', publish_date: '2026-01-07', status: 'in-review', ...assigned },
      ],
      files: { 'test-e2e': md, 'test-e2e-silent': silent },
    });
    try {
      const pub = site.run('publish-scheduled-posts.js');
      assert.equal(pub.status, 0, pub.stdout + pub.stderr);
      const entry = site.calendar().year1.find((p) => p.slug === 'test-e2e');
      assert.equal(entry.status, 'published');
      assert.ok(entry.credited_sha256 && entry.credit_mac);

      let gen = site.run('generate-blog.js');
      assert.equal(gen.status, 0, gen.stdout + gen.stderr);
      assert.match(site.page('test-e2e'), /Reviewed by .*Test Reviewer C/);
      assert.ok(!credits(site.page('test-e2e-silent')), 'silence names no reviewer');

      // A build without the secret cannot verify the credit, so prints none.
      site.clean();
      gen = site.run('generate-blog.js', { secret: null });
      assert.ok(site.page('test-e2e'), 'the post still renders');
      assert.ok(!credits(site.page('test-e2e')));
      assert.match(gen.stdout, /BLOG_REVIEW_TOKEN_SECRET is not set/);

      // A forged credit record: typed to match the file, with no valid MAC.
      const calPath = path.join(site.tmp, 'data', 'content-calendar.json');
      const cal = site.calendar();
      const forged = cal.year1.find((p) => p.slug === 'test-e2e-silent');
      Object.assign(forged, {
        status: 'published', approved_by: REVIEWER.name, approved_by_email: REVIEWER.email, approved_date: '2025-12-23',
        approved_sha256: sha(silent), approval_mac: 'x'.repeat(43),
        credited_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(site.tmp, 'src', 'blog', 'test-e2e-silent.md'))).digest('hex'),
        credit_mac: 'y'.repeat(43),
      });
      fs.writeFileSync(calPath, JSON.stringify(cal, null, 2));
      // ...and review lines put back into the published file by hand.
      const silentPath = path.join(site.tmp, 'src', 'blog', 'test-e2e-silent.md');
      fs.writeFileSync(silentPath, silent);
      forged.credited_sha256 = sha(silent);
      fs.writeFileSync(calPath, JSON.stringify(cal, null, 2));
      site.clean();
      site.run('generate-blog.js');
      assert.ok(!credits(site.page('test-e2e-silent')), 'a hand-typed credit record credits no one');

      // Any change to the credited file after publishing drops the byline.
      const e2ePath = path.join(site.tmp, 'src', 'blog', 'test-e2e.md');
      fs.appendFileSync(e2ePath, '\nA later edit nobody reviewed.\n');
      site.clean();
      site.run('generate-blog.js');
      assert.ok(site.page('test-e2e'));
      assert.ok(!credits(site.page('test-e2e')));
    } finally {
      site.done();
    }
  });
});
