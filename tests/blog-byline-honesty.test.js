/**
 * The byline is a trust signal on a regulated-industry page, so it is held to
 * evidence rather than to whatever field happens to be populated.
 *
 * The template used to print `Reviewed by ${author}` unconditionally. That put
 * a professional-review claim on all 73 published posts: 41 credited "The Way
 * Agency" with reviewing itself, and 28 put a named licensed agent against a
 * review with no record it ever happened. Two calendar entries additionally
 * carried reviewer surnames ("Bartley", "Phelps") that were never employees.
 *
 * The rule: authorship is always safe to state, review is stated ONLY when a
 * named reviewer and the date they signed off are both recorded. A post with
 * no recorded reviewer makes no review claim at all.
 *
 * These assertions read sources rather than build output on purpose. Both
 * generate-blog.js and build.js write build/blog, and node --test runs suites
 * in parallel processes — a suite that builds races build-gate-wiring.test.js
 * and reports that collision as a byline failure.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BLOG_SRC = path.join(ROOT, 'src', 'blog');
const STATIC_PAGES = path.join(ROOT, 'src', 'pages', 'blog');
const GENERATOR = path.join(ROOT, 'scripts', 'generate-blog.js');

function frontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

function posts() {
  return fs.readdirSync(BLOG_SRC)
    .filter(f => f.endsWith('.md'))
    .map(f => ({ file: f, meta: frontmatter(fs.readFileSync(path.join(BLOG_SRC, f), 'utf8')) }));
}

describe('blog byline states only what the post can evidence', () => {
  test('no post records a reviewer without the date they signed off', () => {
    const offenders = posts()
      .filter(p => (p.meta.reviewer || p.meta.reviewed_by) && !p.meta.reviewed_date)
      .map(p => p.file);
    assert.deepEqual(offenders, [], `reviewer recorded with no sign-off date: ${offenders.join(', ')}`);
  });

  test('no post records a sign-off date with nobody attached to it', () => {
    const offenders = posts()
      .filter(p => p.meta.reviewed_date && !(p.meta.reviewer || p.meta.reviewed_by))
      .map(p => p.file);
    assert.deepEqual(offenders, [], `review date with no reviewer named: ${offenders.join(', ')}`);
  });

  test('every recorded reviewer is a real person on the team', () => {
    const team = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'team.json'), 'utf8')).team;
    const names = new Set(team.map(t => t.name));
    const offenders = posts()
      .filter(p => p.meta.reviewer && !names.has(p.meta.reviewer))
      .map(p => `${p.file} (${p.meta.reviewer})`);
    assert.deepEqual(offenders, [], `reviewer not on team.json: ${offenders.join(', ')}`);
  });

  test('some post actually credits a reviewer', () => {
    // Guards the other direction: suppressing reviews that genuinely happened
    // makes recording one pointless.
    const credited = posts().filter(p => p.meta.reviewer && p.meta.reviewed_date);
    assert.ok(credited.length > 0, 'no post credits a reviewer — the backfill did not land');
  });

  test('the hand-maintained pages make no review claim', () => {
    // These 12 bypass the generator entirely, so the template rule cannot
    // reach them. They name the people who WROTE those posts.
    const offenders = fs.readdirSync(STATIC_PAGES)
      .filter(f => f.endsWith('.html'))
      .filter(f => /Reviewed by/.test(fs.readFileSync(path.join(STATIC_PAGES, f), 'utf8')));
    assert.deepEqual(offenders, [], `static pages claiming review: ${offenders.join(', ')}`);
  });

  test('the generator gates the review line on both reviewer and date', () => {
    const src = fs.readFileSync(GENERATOR, 'utf8');
    assert.match(src, /hasReview\s*=\s*Boolean\(reviewerName && meta\.reviewed_date\)/,
      'the review gate should depend on both the reviewer and the sign-off date');
    assert.match(src, /\$\{hasReview \?/, 'the visible review line should be gated on hasReview');
    assert.match(src, /"reviewedBy"/, 'structured data should carry reviewedBy when there is a review');
    assert.ok(!/Reviewed by \$\{authorLink\}/.test(src),
      'the author must never be rendered as the reviewer');
  });

  test('the agency is never typed as a Person in Article structured data', () => {
    const src = fs.readFileSync(GENERATOR, 'utf8');
    assert.match(src, /meta\.author_slug \?/, 'author schema should branch on whether a person is named');
    assert.match(src, /"@type":\s*"Organization"/, 'agency-authored posts should use Organization');
  });
});
