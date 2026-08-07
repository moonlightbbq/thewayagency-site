/**
 * The calendar status vocabulary is a CROSS-REPO contract.
 *
 * sage writes statuses into data/content-calendar.json (blog-reviews.js sets
 * 'approved' on a reviewer's "Approved" reply, and commits it). This repo
 * decides what publishes. Nothing tested the seam, so the two ends drifted:
 * the publisher recognised planned/in-review/in-draft and skipped 'approved'
 * with a bare `continue` — no error, no red run. occupiedDates() still counted
 * the slot as filled, so no queue invariant fired either.
 *
 * Approving a post was what stopped it from publishing. It survived because no
 * reviewer reply had ever been processed in production, and because the
 * sage-side test asserts only that the write happens — it cannot see that this
 * repo refuses to act on it.
 *
 * These tests are the contract. If sage introduces a new status, one of them
 * fails here rather than a post going quietly unpublished.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { PUBLISHABLE_STATUSES, TERMINAL_STATUSES, isPublishable, isKnownStatus } =
  require('../scripts/lib/calendar-status');

const ROOT = path.resolve(__dirname, '..');

describe('publishable statuses', () => {
  test("'approved' publishes — the regression", () => {
    // Before the fix this was false, and that single false silently stopped
    // any post whose reviewer actually replied.
    assert.equal(isPublishable('approved'), true);
  });

  test('the advisory gate: no reply still publishes', () => {
    // A reviewer on vacation must never silently empty a slot.
    assert.equal(isPublishable('in-review'), true);
  });

  test('planned and in-draft publish', () => {
    assert.equal(isPublishable('planned'), true);
    assert.equal(isPublishable('in-draft'), true);
  });

  test('terminal statuses do not publish', () => {
    assert.equal(isPublishable('published'), false);
    assert.equal(isPublishable('error'), false);
  });

  test('an unknown status is neither publishable nor known', () => {
    assert.equal(isPublishable('rejected-by-legal'), false);
    assert.equal(isKnownStatus('rejected-by-legal'), false);
  });

  test('publishable and terminal sets do not overlap', () => {
    for (const s of PUBLISHABLE_STATUSES) {
      assert.equal(TERMINAL_STATUSES.has(s), false, `"${s}" is in both sets`);
    }
  });
});

describe('the contract holds across both repos', () => {
  test('every status sage writes is one this repo knows', () => {
    // Read the statuses sage assigns straight out of its source. If sage adds
    // one, this fails here instead of a post going quietly unpublished.
    const blogReviews = path.resolve(ROOT, '..', 'sage-main', 'src', 'email', 'blog-reviews.js');
    if (!fs.existsSync(blogReviews)) {
      // sage is not checked out beside this repo (CI runners, fresh clones).
      // Skipping is honest; the assertion below still pins our own side.
      return;
    }
    const src = fs.readFileSync(blogReviews, 'utf8');
    const written = [...src.matchAll(/\bentry\.status\s*=\s*['"]([a-z-]+)['"]/g)].map(m => m[1]);
    assert.ok(written.length > 0, 'expected blog-reviews.js to assign at least one status');
    for (const s of written) {
      assert.equal(isKnownStatus(s), true,
        `sage writes status "${s}" but this repo does not know it — the seam that broke publishing`);
    }
  });

  test('every status on the live calendar is known', () => {
    const cal = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'content-calendar.json'), 'utf8'));
    const all = [...(cal.year1 || []), ...(cal.existing_posts || [])];
    const unknown = [...new Set(all.map(p => p && p.status).filter(s => s && !isKnownStatus(s)))];
    assert.deepEqual(unknown, [], `unknown statuses on the live calendar: ${unknown.join(', ')}`);
  });

  test('the publisher reads the shared vocabulary, not a local list', () => {
    // Guards the specific shape of the bug: a hardcoded status list in the
    // publisher that can drift from what sage writes.
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'publish-scheduled-posts.js'), 'utf8');
    assert.match(src, /require\(['"]\.\/lib\/calendar-status['"]\)/);
    assert.doesNotMatch(src, /status !== 'planned' && post\.status !== 'in-review'/);
  });

  test('reconcile-calendar shares it too', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'reconcile-calendar.js'), 'utf8');
    assert.match(src, /require\(['"]\.\/lib\/calendar-status['"]\)/);
    assert.doesNotMatch(src, /new Set\(\['planned', 'in-review', 'in-draft'\]\)/);
  });
});
