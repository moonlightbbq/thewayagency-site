/**
 * The calendar status vocabulary is a CROSS-REPO contract.
 *
 * sage writes statuses into data/content-calendar.json (since BL-07 it sets
 * 'approved' only when the assigned reviewer approves the exact text in SAGE,
 * never on an email reply, and commits it). This repo
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

const { PUBLISHABLE_STATUSES, TERMINAL_STATUSES, HOLD_STATUSES, isPublishable, isKnownStatus, isHeld, heldSlugs, loadHeldSlugs } =
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

describe('the reviewer hold (BL-07)', () => {
  test("'changes-requested' is known, held, and does NOT publish", () => {
    // sage writes it when the assigned reviewer asks for changes. If it were
    // publishable the post would go live over the reviewer's objection; if it
    // were unknown the publisher would treat it as a contract breach.
    assert.equal(isKnownStatus('changes-requested'), true);
    assert.equal(isHeld('changes-requested'), true);
    assert.equal(isPublishable('changes-requested'), false);
  });

  test('publishable, terminal and hold sets are disjoint', () => {
    for (const s of HOLD_STATUSES) {
      assert.equal(PUBLISHABLE_STATUSES.has(s), false, `"${s}" is held and publishable`);
      assert.equal(TERMINAL_STATUSES.has(s), false, `"${s}" is held and terminal`);
    }
  });

  test('heldSlugs picks held entries from year1 and existing_posts', () => {
    const cal = {
      year1: [
        { slug: 'test-held-a', status: 'changes-requested' },
        { slug: 'test-review-b', status: 'in-review' },
        { slug: 'test-approved-c', status: 'approved' },
      ],
      existing_posts: [{ slug: 'test-held-d', status: 'changes-requested' }, { slug: 'test-live-e', status: 'published' }],
    };
    assert.deepEqual([...heldSlugs(cal)].sort(), ['test-held-a', 'test-held-d']);
    assert.deepEqual([...heldSlugs({})], []);
  });

  test('loadHeldSlugs never throws: missing holds nothing, unreadable is reported', () => {
    const fake = (files) => ({ existsSync: (p) => p in files, readFileSync: (p) => files[p] });
    assert.deepEqual(loadHeldSlugs('/x/cal.json', fake({})), { held: new Set(), error: null });
    const bad = loadHeldSlugs('/x/cal.json', fake({ '/x/cal.json': '{ not json' }));
    assert.equal(bad.held.size, 0);
    assert.match(bad.error, /JSON/);
    const good = loadHeldSlugs('/x/cal.json', fake({ '/x/cal.json': JSON.stringify({ year1: [{ slug: 'test-held-a', status: 'changes-requested' }] }) }));
    assert.deepEqual([...good.held], ['test-held-a']);
    assert.equal(good.error, null);
  });
});

describe('the contract holds across both repos', () => {
  test('every status sage writes is one this repo knows', () => {
    // Read the statuses sage assigns straight out of its source. If sage adds
    // one, this fails here instead of a post going quietly unpublished.
    // (sage-server BL-07 writes 'approved' and the 'changes-requested' hold:
    // between sage's deploy and this repo's merge of the hold vocabulary, a
    // host run against ../sage-main fails here, which is the alarm working.)
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
