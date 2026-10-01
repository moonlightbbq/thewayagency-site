/**
 * The "Reviewed by" byline is stamped only for a review that happened.
 *
 * The licensed review is ADVISORY for publishing (scripts/lib/calendar-
 * status.js): a post whose reviewer never replied still publishes on its date.
 * But it used to publish crediting that reviewer anyway ("review by no
 * objection"), so silence put a licensed agent's name on text they may never
 * have read. Since BL-06 / AIA-002 the publisher stamps reviewer fields only
 * when the calendar entry records approved_by (sage's blog-review reply
 * handler sets approved_by and approved_date when the reviewer replies
 * "Approved"), and reviewed_date is the approval date.
 *
 * Runs the real script against a temp copy of the site tree with synthetic
 * data, so nothing in this repo is touched.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');

function frontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

const body = Array.from({ length: 240 }, (_, i) => `word${i}`).join(' ');
const post = (slug) => `---\ntitle: SYNTHETIC ${slug}\ndescription: SYNTHETIC description for ${slug}\ndate: 2026-01-07\n---\n\n${body}\n`;

describe('publish-scheduled-posts reviewer stamp', () => {
  let tmp;
  let calendar;
  let run;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-review-stamp-'));
    fs.mkdirSync(path.join(tmp, 'scripts', 'lib'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'src', 'blog'), { recursive: true });
    fs.copyFileSync(path.join(REPO, 'scripts', 'publish-scheduled-posts.js'), path.join(tmp, 'scripts', 'publish-scheduled-posts.js'));
    fs.copyFileSync(path.join(REPO, 'scripts', 'lib', 'calendar-status.js'), path.join(tmp, 'scripts', 'lib', 'calendar-status.js'));
    fs.writeFileSync(path.join(tmp, 'data', 'team.json'), JSON.stringify({
      team: [{ name: 'Test Reviewer B', slug: 'test-reviewer-b', title: 'Licensed Test Agent' }],
    }));
    fs.writeFileSync(path.join(tmp, 'data', 'content-calendar.json'), JSON.stringify({
      year1: [
        // Sent for review, no reply: publishes (advisory) but claims no review.
        {
          slug: 'test-silent-review', title: 'SYNTHETIC silent', publish_date: '2026-01-07', status: 'in-review',
          reviewer: 'Test Reviewer B', reviewer_slug: 'test-reviewer-b', review_sent_date: '2025-12-20',
        },
        // The reviewer replied "Approved": publishes crediting them.
        {
          slug: 'test-approved-review', title: 'SYNTHETIC approved', publish_date: '2026-01-07', status: 'approved',
          reviewer: 'Test Reviewer B', reviewer_slug: 'test-reviewer-b', review_sent_date: '2025-12-20',
          approved_by: 'Test Reviewer B', approved_date: '2025-12-23',
        },
      ],
    }, null, 2));
    for (const slug of ['test-silent-review', 'test-approved-review']) {
      fs.writeFileSync(path.join(tmp, 'src', 'blog', `${slug}.md`), post(slug));
    }
    run = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'publish-scheduled-posts.js')], { encoding: 'utf8' });
    calendar = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'content-calendar.json'), 'utf8'));
  });

  after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  test('both posts publish (the review stays advisory)', () => {
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.deepEqual(calendar.year1.map((p) => p.status), ['published', 'published']);
  });

  test('a post the reviewer never answered carries no review byline', () => {
    const meta = frontmatter(fs.readFileSync(path.join(tmp, 'src', 'blog', 'test-silent-review.md'), 'utf8'));
    for (const k of ['reviewer', 'reviewer_slug', 'reviewer_title', 'reviewed_date']) {
      assert.equal(meta[k], undefined, `${k} must not be stamped without an approval`);
    }
  });

  test('an approved post credits the reviewer with their real title and the approval date', () => {
    const meta = frontmatter(fs.readFileSync(path.join(tmp, 'src', 'blog', 'test-approved-review.md'), 'utf8'));
    assert.equal(meta.reviewer, 'Test Reviewer B');
    assert.equal(meta.reviewer_slug, 'test-reviewer-b');
    assert.equal(meta.reviewer_title, 'Licensed Test Agent');
    assert.equal(meta.reviewed_date, '2025-12-23');
  });
});
