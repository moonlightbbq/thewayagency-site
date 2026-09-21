/**
 * The byline is a trust signal on a regulated-industry page, so it is held to
 * evidence rather than to whatever field happens to be populated.
 *
 * The template used to print `Reviewed by ${author}` unconditionally. That put
 * a professional-review claim on all 73 published posts: 41 credited "The Way
 * Agency" with reviewing itself, and 28 put a named licensed agent against a
 * review with no record it ever happened. Two calendar entries additionally
 * carried reviewer names ("Kelly Bartley", "Audrey Phelps") that were never
 * employees.
 *
 * The rule these tests hold: authorship is always safe to state, review is
 * stated ONLY when a named reviewer and the date they signed off are both on
 * the post. A post with no recorded reviewer makes no review claim at all.
 */
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BLOG_SRC = path.join(ROOT, 'src', 'blog');
const BLOG_BUILD = path.join(ROOT, 'build', 'blog');

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

describe('blog byline states only what the post can evidence', () => {
  before(() => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'generate-blog.js')], {
      encoding: 'utf8',
      cwd: ROOT,
    });
    assert.equal(r.status, 0, `generate-blog.js failed:\n${r.stdout}\n${r.stderr}`);
  });

  test('no page claims review without both a named reviewer and a sign-off date', () => {
    const offenders = [];
    for (const file of fs.readdirSync(BLOG_BUILD).filter(f => f.endsWith('.html') && f !== 'index.html')) {
      const html = fs.readFileSync(path.join(BLOG_BUILD, file), 'utf8');
      if (!/Reviewed by/.test(html)) continue;

      const mdPath = path.join(BLOG_SRC, `${file.replace(/\.html$/, '')}.md`);
      if (!fs.existsSync(mdPath)) { offenders.push(`${file}: claims review but has no source markdown`); continue; }

      const meta = frontmatter(fs.readFileSync(mdPath, 'utf8'));
      const reviewer = meta.reviewer || meta.reviewed_by;
      if (!reviewer || !meta.reviewed_date) {
        offenders.push(`${file}: claims review (reviewer=${reviewer || 'none'}, reviewed_date=${meta.reviewed_date || 'none'})`);
      }
    }
    assert.deepEqual(offenders, [], `pages claiming an unevidenced review:\n  ${offenders.join('\n  ')}`);
  });

  test('the agency is never credited as a Person in Article structured data', () => {
    const offenders = [];
    for (const file of fs.readdirSync(BLOG_BUILD).filter(f => f.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(BLOG_BUILD, file), 'utf8');
      // A Person node whose name is the agency itself is a false authorship claim.
      if (/"@type":\s*"Person",\s*\n\s*"name":\s*"The Way Agency"/.test(html)) offenders.push(file);
    }
    assert.deepEqual(offenders, [], `agency typed as Person in JSON-LD: ${offenders.join(', ')}`);
  });

  test('every post still states who wrote it', () => {
    const missing = fs.readdirSync(BLOG_BUILD)
      .filter(f => f.endsWith('.html') && f !== 'index.html')
      .filter(f => !/Written by/.test(fs.readFileSync(path.join(BLOG_BUILD, f), 'utf8')));
    assert.deepEqual(missing, [], `posts with no authorship line: ${missing.join(', ')}`);
  });

  test('a post carrying both reviewer and date does render the review line', () => {
    // Guards the other direction: the honesty rule must not suppress a review
    // that genuinely happened, or recording one becomes pointless.
    const generate = fs.readFileSync(path.join(ROOT, 'scripts', 'generate-blog.js'), 'utf8');
    assert.match(generate, /hasReview\s*=\s*Boolean\(reviewerName && meta\.reviewed_date\)/,
      'the review gate should depend on both the reviewer and the sign-off date');
    assert.match(generate, /\$\{hasReview \?/, 'the review line should be gated on hasReview');
  });
});
